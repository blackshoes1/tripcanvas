# NAS 릴리스 — 머지 순서와 복구 확인

> **2026-09-19부터 API 배포는 자동이다.** `main` 머지 → `release.yml`(게이트 → GHCR `:<커밋 SHA>` → `production` 태그) →
> NAS cron(5분)의 `scripts/nas-deploy.sh`(pull → migrate → api·realtime → 헬스체크 → revision 확인).
> 파이프라인 자체 — 지금 무엇이 도는지 · 실패 · 롤백 · 멈춤 · 최초 설정 — 는 [NAS 배포](nas-deployment.md)의
> "배포 — main 머지가 곧 배포다"가 맡는다. 이 문서는 **무엇을 어떤 순서로 머지하고, 머지 뒤 무엇을 확인하는가**만 다룬다.
> 머지가 곧 운영 배포이므로 머지는 사람이 판단한다.

⚠️ **NAS에서 손으로 `docker compose … build`·`up`을 하지 않는다.** 이 문서의 예전 판(2026-09-08)은 NAS에 소스를 풀어
빌드하라고 했다. 지금 운영 compose(`deploy/docker-compose.yml`)에는 `build:`가 없어 `build`는 아무것도 만들지 않고,
이어지는 `up`은 `deploy/.env`에 남은 **옛 `TC_IMAGE_TAG`** 를 그대로 띄운다 — 명령은 전부 성공하는데 옛 코드가 도는,
2026-09-19 사고와 같은 모양이다. 손으로 띄울 일이 있으면 `nas-deploy.sh --sha <SHA>`이고, 레지스트리가 죽었을 때의
비상 빌드는 nas-deployment.md의 "비상 — 레지스트리가 죽었을 때만"에만 있다.

## 머지 하나가 움직이는 것

```
PR merge → main ─┬→ Vercel: 정적 웹 + api/ 함수                                          ← 약 1분
                 └→ release.yml: 게이트(ci.yml) → 이미지(api·tools :<SHA>) → production 태그
                        → NAS cron(5분): pull → migrate → api·realtime → 헬스체크 → revision  ← 수십 분 뒤
```

- **웹이 먼저 나간다.** API는 게이트·이미지 빌드·cron을 지나야 한다(게이트·빌드만 수십 분 — `migration-policy.md`).
  그동안 새 웹은 옛 API를 부른다. 아래 "API 먼저"가 필요한 이유다.
- `ios/**` · `docs/**` · `**.md` · iOS 워크플로만 바뀐 머지에는 `release.yml`이 돌지 않는다(`paths-ignore`).
  그 밖의 경로는 전부 API 배포 대상이다 — 빼는 목록이라 루트에 새 엔진 파일이 생겨도 저절로 들어간다.
- NAS 배포가 실패하면 스크립트가 직전 커밋으로 스스로 되돌리고, 교체까지 간 실패였다면 그 커밋을 자동으로 다시 시도하지
  않는다(nas-deployment.md "배포가 실패하면"). **웹은 되돌아가지 않는다.**

## 대상 판정

```bash
npm run deployment:plan -- <지금-NAS에-도는-커밋> <머지할-커밋>
```

지금 도는 커밋은 `ssh nas '~/tripcanvas/scripts/nas-deploy.sh --status'`의 `도는 revision`, 밖에서는 `/api/health`의 `revision`이다.
도구는 커밋 차이만 읽는다 — 배포하지 않고, 환경변수·운영 상태를 읽지 않으며, 미커밋 변경은 넣지 않는다. 삭제·이동한 파일도
기존 경로로 판정한다. `next/`는 통째로 API 대상으로 잡으므로 테스트·문서만 바뀌어도 표시될 수 있다.

| 대상 | 머지하면 | 사람이 할 일 |
|---|---|---|
| 루트 웹 자산 (`vercel`) | Vercel이 바로 배포한다 | `npm run bump:version`. 새 API에 기대면 **아래 "API 먼저"** |
| 엔진·Next API·실시간·의존성 (`nas-images`) | 같은 머지가 NAS까지 자동 배포한다 | 머지 뒤 확인(아래). 응답 필드는 **더하기만** 하고, 옛 웹·앱이 쓰는 필드의 삭제·의미 변경은 클라이언트 전환 뒤로 미룬다 |
| DB migration (`nas-schema`) | 그 커밋의 `migrate`가 api보다 먼저 돈다 | **하위호환이어야 한다** — 이미지 롤백은 스키마를 되돌리지 않는다. `npm run check:migrations`(게이트)가 PR에서 막고, 파괴적 변경은 [`migration-policy.md`](migration-policy.md)의 손 절차(자동 배포 정지 → 새 백업 → `--sha`)로 |
| Compose·백업 (`nas-config`) | `nas-deploy.sh`가 그 커밋의 `deploy/docker-compose.yml`·`backup.sh`를 받아 `up -d` 한다 | `deploy/.env`는 NAS 것이 진실이고 배포가 고치는 줄은 `TC_IMAGE_TAG` 하나다 — **새 환경변수는 머지 전에** NAS `.env`에 넣는다(늦었으면 넣고 `--force`). 머지 뒤 `backup`까지 전체 상태 확인 |
| 관리형 구성 (`managed-config`) | 운영에는 아무 일도 없다 | `managed-staging.yml`(수동)로 staging에서 확인 — `deployment-workflow.md` |
| iOS (`ios`) | 아무것도 배포되지 않는다 | 계약·기기 검증 후 TestFlight 별도. 새 API가 필요하면 그 API가 돈 뒤에 |

## API 먼저 — 새 API가 필요한 웹은 PR 둘

**한 PR로는 안 된다.** 같은 머지에서 웹은 약 1분, API는 수십 분 뒤라 그 사이 새 웹이 없는 라우트를 부르고(404),
NAS 배포가 실패해 직전 커밋으로 돌아가면 그 상태가 **그대로 남는다.** 그래서 나눈다.

1. **API PR을 먼저 머지한다.** 서버 쪽만(라우트·필드·마이그레이션) 담고, 옛 웹·앱이 그대로 돌아야 한다(필드는 더하기만,
   마이그레이션은 하위호환).
2. **그 커밋이 NAS에서 도는지 확인한다.** Actions *Release* 요약에 승격된 커밋이 찍히고, NAS가 5분 안에 받아 간다.

   ```bash
   ssh nas '~/tripcanvas/scripts/nas-deploy.sh --status'   # 기록된 현재 · 도는 revision · 컨테이너 이미지 · production 태그가 같은가
   curl -s https://bokbok9.tail8b977f.ts.net/api/health | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p'   # 밖에서 한 줄로
   git fetch && git merge-base --is-ancestor <API-머지-SHA> <도는-revision> && echo 들어 있다   # 뒤에 다른 머지가 겹쳤을 때
   ```

   `실패로 적힌 SHA`가 나오거나, `production 태그`와 `도는 revision`이 30분 넘게 다르면 멈춘다 — **웹을 머지하지 않는다**
   (`deploy/deploy.log`, nas-deployment.md "배포가 실패하면").
3. 새 라우트를 **실제로** 불러 본다 — 비인증 401만으로 성공을 판정하지 않는다(아래 "머지 뒤 확인" 3).
4. **웹 PR을 머지한다**(`npm run bump:version` 포함). 폰에서 ☰ 버전 → 로그인 → 그 기능.

iOS도 같은 순서다 — API가 돌기 전에 TestFlight로 내보내지 않는다. 새 라우트의 404를 빈 데이터로 처리하지 않는지도 본다.
응답의 `schemaVersion`은 응답 계약 버전이지 배포 커밋·기능 지원 목록이 아니다 — "이 기능이 있는 서버인가"는 revision으로 본다.

## 머지 뒤 확인

자동 배포는 헬스체크(`/api/health`의 DB)와 revision(api 컨테이너 이미지의 라벨 · api·realtime이 말하는 revision)까지 보고
성공을 적는다. 그 너머는 사람이 본다.

1. `nas-deploy.sh --status`의 네 SHA(기록된 현재 · 도는 revision · 컨테이너 이미지 · production 태그)가 같은가.
2. 마이그레이션을 넣었다면 DB의 적용 이력이 저장소와 맞는가 — `drizzle.__drizzle_migrations`의 마지막 `created_at`과
   `next/src/server/infrastructure/database/migrations/meta/_journal.json`의 마지막 `when`. 이미지 버전만으로 DB 적용을 보장하지 않는다.

   ```bash
   ssh nas "sudo /usr/local/bin/docker exec tripcanvas-postgres-1 psql -U tripcanvas -d tripcanvas -Atc \
     'select max(created_at) from drizzle.__drizzle_migrations'"
   ```

3. 밖에서(tailnet 밖 — nas-deployment.md "손으로 확인하는 법") `/api/health`의 DB 상태, `/api/v1/trips`의 비인증 401,
   `https://tripcanvas-ai.vercel.app/api/health-watch`의 결과(`HEALTHY`, 실시간 `101`)를 본다. 이어서 검증 계정으로 로그인 →
   여행 읽기 → 임시 여행 저장 → 다른 클라이언트 재조회 → 실시간 갱신을 확인한다. 401만으로 저장 성공을 판정하지 않는다.
   운영 검증 데이터 생성은 승인된 범위에서만 한다.
4. 웹을 바꿨다면 폰에서 ☰ 버전·로그인·저장. 앱 배포는 별도다.

전체 `docker inspect`나 `compose config`를 로그에 남기지 않는다 — 환경변수 비밀이 나온다. 필요한 필드만 본다.

## 복귀 방법

- **웹:** revert PR로 되돌린다. NAS API는 호환 상태로 둔다(API가 더하기만 했다면 옛 웹도 그대로 돈다).
- **API:** 고친 커밋을 머지해 앞으로 가는 것이 기본이다. 급하면 `ssh nas '~/tripcanvas/scripts/nas-deploy.sh --sha <이전-커밋-40자리-SHA>'`
  — production 태그와 다른 커밋이라 자동 배포가 그 커밋에 **고정**되고, 푸는 것은 사람이다(`rm deploy/.deploy-disabled`,
  nas-deployment.md "롤백"). 이미지만 돌아가고 스키마는 앞선 채로 남는다 — 그 스키마 위에서 이전 이미지가 도는지 먼저 본다.
  비밀(`deploy/.env`)은 현재 운영 값을 유지한다.
- **스키마:** git revert로 DB가 돌아가지 않는다. 호환 가능한 forward migration을 우선한다.
- **데이터:** 손실·오염 시 쓰기 중단(`TC_READ_ONLY=1`) → 원본 보존 → 별도 DB에 덤프 복구 → 무결성·앱 검증 → 승인 후 전환.
  복구 시점 이후 변경은 별도로 처리한다 — [`backup-restore.md`](backup-restore.md).
- **Supabase 전환:** NAS 신규 데이터는 Supabase에 없다. 플래그·API 주소 변경만으로 안전한 복귀가 되지 않으며,
  차이 데이터 처리·사용자 재인증·허용 손실 결정이 선행되어야 한다.

이미지는 Actions가 저장소 루트를 컨텍스트로 빌드한다(`release.yml`). `.env`·백업·로컬 의존성·생성물을 빼는 것은 루트
`.dockerignore`다 — Git에서 무시하는 것과 Docker에서 제외하는 것은 별개다. [Docker 빌드 컨텍스트 문서](https://docs.docker.com/build/concepts/context/#dockerignore-files)
