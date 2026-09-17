# 프로덕션 cutover — NAS → 관리형 인프라

> ⚠️ **이 문서의 어떤 단계도 승인 없이 실행하지 않는다.** 코드·스크립트·staging 구성은 준비돼 있다([`managed-infrastructure.md`](managed-infrastructure.md)).
> 실행은 사람이, 순서대로, 체크하며 한다. 되돌리는 절차는 [`disaster-recovery.md`](disaster-recovery.md)에 있고 **각 단계를 시작하기 전에 그 단계의 롤백을 읽는다.**

전체 그림:

```
A 복원 리허설 ──▶ B staging 앱 검증 ──▶ C 마지막 동기화(정지 창) ──▶ D 클라이언트 전환 ──▶ E 관찰 ──▶ NAS 역할 변경
  운영 안 건드림     운영 안 건드림        5분 안쪽                    웹 재배포·앱 릴리스   ≥2주       backup-only
```

## 준비 — 한 번만

- [ ] Provider 계정·프로젝트: 런타임(api·realtime) + PostgreSQL 17 (`managed-infrastructure.md` §4에서 고른 것). 리전은 한국에서 가까운 곳
- [ ] DB 계정 둘: **소유자**(마이그레이션·복원용, `MIGRATE_DATABASE_URL`) · **앱**(`DATABASE_URL`). 하나만 주는 provider면 그대로 쓰되 문서에 적는다
- [ ] 네트워크 제한: DB는 공개 인터넷에 무제한 노출하지 않는다 — provider의 IP 제한/사설망에 런타임과 NAS(백업)의 egress만 허용. 런타임 egress IP가 고정이 아니면 그 사실을 적고 TLS + 비밀번호 강도로 버틴다
- [ ] TLS: 연결 문자열이 `sslmode=require`(`pg` 체인 문제면 `uselibpqcompat=true`)
- [ ] 시크릿을 provider 저장소에 넣는다(`deploy/managed/env.managed.example`의 이름 전부). **`AUTH_SECRET`은 NAS 운영 값과 같아야** 재로그인이 없다. 저장소·로그·채팅에 값을 남기지 않는다
- [ ] `API_BASE_URL` = 새 API 공개 주소 · `TRUSTED_ORIGINS` = `https://tripcanvas-ai.vercel.app,http://localhost:8000` · `WEB_BASE_URL` = `https://tripcanvas-ai.vercel.app` · `REALTIME_URL` = `wss://<realtime>/ws` · `REALTIME_DATABASE_URL` = 직접 주소 · `REALTIME_HEALTH_URL`
- [ ] uptime 모니터의 대상은 그대로 `https://tripcanvas-ai.vercel.app/api/health-watch`. Vercel 환경변수 `TC_WATCH_BASE`·`TC_WATCH_REALTIME_BASE`를 전환 순간에 바꿀 수 있게 준비(Preview에서 먼저 확인)

## Phase A — 복원 리허설 (운영 무영향)

[`managed-db-migration.md`](managed-db-migration.md) Phase A 그대로.

- [ ] `scripts/rehearse-restore-managed.sh` → **PASS**
- [ ] 운영 덤프 → staging DB 복원 → `verify:db` **PASS**(SKIP 0). 어긋난 표가 "덤프 이후 운영이 쓴 것"뿐인지 읽는다
- [ ] 걸린 시간을 적는다(RTO 근거)

## Phase B — staging 앱 검증 (운영 무영향)

staging 런타임(api·realtime)을 staging DB에 붙인다. 배포는 GitHub Actions *Managed staging deploy* 또는 `deploy/managed/README.md`.
운영 웹(`tripcanvas-ai.vercel.app`)을 staging에 붙이지 않는다 — 로컬 웹(`python3 -m http.server 8000`)에 `window.__TC_API_BASE`를 심어 본다(`staging-verification.md` 규칙 3).

- [ ] `GET /api/health` → `status: HEALTHY`, `components.database ok`, `components.realtime ok`(LISTEN이 **직접 연결**로 붙었다), `backup`은 아직 `unconfigured`여도 된다
- [ ] `GET /api/v1/trips` → 401 · `GET /api/v1/auth-config` → `provider: TRIPCANVAS`
- [ ] 로그인(운영 계정 그대로 — 같은 `AUTH_SECRET`·같은 세션 행) → **재로그인 없이** 여행 목록이 운영과 같은 개수
- [ ] 여행 상세 · 저장(revision +1) · 두 클라이언트 충돌 카드 · 삭제(tombstone) · 되돌리기
- [ ] 협업: 초대 미리보기(로그아웃) · 수락 · VIEWER 저장 거절(42501, 재시도 안 함) · 후보·반응·코멘트 · 나가기
- [ ] 가격 관측(`/prices`) 읽기·쓰기
- [ ] Today · Travel State · 제안 수락/거절 · 다시 맞추기 미리보기 · 계획 미리보기
- [ ] 실시간: 두 창에서 후보 반응 → 상대 창 갱신. 사이드카를 내려도(`fly scale count 0` 등) 앱이 새로고침 폴백으로 돈다 → 다시 올린다
- [ ] iOS: `ios/project.yml`의 `TCApiBaseURL`을 staging으로 바꿔(커밋하지 않는다) 시뮬레이터에서 로그인·목록·오늘·저장. 계약 파리티는 CI(`swiftParity`)가 이미 본다
- [ ] 점검 모드: `TC_READ_ONLY=1`로 재시작 → PUT 503 `MAINTENANCE`, GET 200, 웹 토스트 "점검 중이에요" → 끄고 재시작
- [ ] 백업 경로: NAS에서 `docker-compose.backup-only.yml`을 staging DB로 한 번 돌려 덤프가 생기고 `/api/health`의 `backup`이 `ok`로 바뀐다
- [ ] 위 결과와 걸린 시간을 `staging-verification.md`의 실행 기록 형식으로 남긴다

## Phase C — 마지막 동기화 (정지 창, 5분 안쪽)

사전: 관리형 **primary** DB를 새로 만든다(비어 있음 — staging DB를 승격하지 않는다). 프로덕션 런타임(api·realtime)을 배포하되 **아직 트래픽은 없다**(웹·앱이 NAS를 본다). 그 런타임의 `/api/health`가 `database ok`인 것을 본다.

- [ ] **공지** — 사용자에게 "몇 분간 저장이 안 될 수 있다"
- [ ] C1 NAS `.env`에 `TC_READ_ONLY=1` → `sudo docker compose -f deploy/docker-compose.yml up -d --force-recreate api` → 밖에서 PUT이 503인지, `/api/health`가 `readOnly: true`인지
- [ ] C2 30초 기다린다(진행 중이던 쓰기가 끝나게) → `sudo docker compose -f deploy/docker-compose.yml stop api realtime backup`
- [ ] C3 마지막 덤프: `sudo docker compose -f deploy/docker-compose.yml run --rm -e BACKUP_RECORD=0 backup sh /backup.sh` → 파일명·크기를 적는다
- [ ] C4 노트북에서 `SOURCE_DATABASE_URL=<NAS 15432> TARGET_DATABASE_URL=<primary 소유자 주소> scripts/restore-to-target.sh <덤프>` → **`DB 검증: 통과` · `PASS N · FAIL 0 · SKIP 0`**. 첫 줄의 `원본 …@… → 대상 …@…`이 맞는지 눈으로
- [ ] C5 통과가 아니면 **여기서 멈춘다** → [`disaster-recovery.md`](disaster-recovery.md) Case 3(옛 스택 재기동, `TC_READ_ONLY` 해제). 관리형 primary는 비운다

## Phase D — 클라이언트 전환

- [ ] D1 프로덕션 런타임 `/api/health` → `HEALTHY`(realtime ok). `GET /api/v1/trips` 401
- [ ] D2 **웹**: `api.js`·`auth.js`의 `DEFAULT_BASE` 두 줄을 새 주소로 + `npm run bump:version` → PR → CI → merge(Vercel 재배포 약 1분). 폰에서 ☰ 버전 확인 → 로그인 상태 유지 → 여행 열기 → 장소 하나 저장 → revision 증가
- [ ] D3 **감시**: Vercel 환경변수 `TC_WATCH_BASE`=새 API, `TC_WATCH_REALTIME_BASE`=새 실시간 → 재배포 → `/api/health-watch`가 `HEALTHY`
- [ ] D4 **iOS**: `ios/project.yml`·`project-free.yml`의 `TCApiBaseURL` + `AppEnvironment.swift`의 fallback을 새 주소로 → 버전 올림 → *iOS TestFlight* 워크플로 → 실기기에서 로그인 유지·목록·저장 확인 → 심사 제출. **옛 앱은 계속 NAS 주소를 본다** — 아래 D5
- [ ] D5 **옛 주소 유지(앱 전환 기간)**: NAS를 `TC_READ_ONLY` 해제 후 다시 올리되 **DB를 관리형 primary로 가리키는 프록시 모드**로 — `.env`의 `DATABASE_URL`을 관리형 주소로 바꿔 `api`만 올린다(`postgres`·`realtime` 컨테이너는 내려 둔다). 옛 앱 사용자는 NAS 주소 → 관리형 DB로 저장되어 **두 클라이언트가 같은 데이터를 본다.** NAS 장애는 이때 옛 앱에만 영향이다. 새 앱이 스토어에 나가고 옛 앱 사용이 끝나면 내린다
- [ ] D6 NAS 백업 역할 시작: `deploy/.env`에 `BACKUP_SOURCE_URL`(관리형 직접 주소) → `sudo docker compose -f deploy/docker-compose.backup-only.yml up -d` → 첫 덤프 · 관리형 `/api/health`의 `backup: ok`

## Phase E — 관찰 (최소 2주)

- [ ] 매일: `/api/health-watch` HEALTHY · 관리형 `/api/health`의 `backup` · provider 스냅샷 존재 · NAS 덤프 파일
- [ ] 1주 안에 한 번: NAS의 최신 덤프로 `scripts/restore-to-target.sh`를 **빈 임시 DB**에 → PASS (복구해 본 백업만 백업이다)
- [ ] 옛 iOS 앱 트래픽이 0이 된 뒤: NAS의 옛 `api` 프록시 모드를 내린다(D5). Funnel은 그대로 둬도 된다(NAS 접근용)
- [ ] 관찰이 끝나면 NAS의 `docker-compose.yml` 스택은 **내리되 볼륨은 지우지 않는다**(`down` — `-v` 금지). 마지막 NAS DB 덤프를 오프라인 보관
- [ ] `docs/architecture.md`·`README.md`의 topology를 "전환 완료"로 갱신하고 이 문서의 상태 줄을 바꾼다

## 하지 않는 것

- 이 PR·이 작업은 위 어느 것도 실행하지 않았다. DNS·프로덕션 API 주소·NAS 종료·Supabase 삭제·프로덕션 마이그레이션·main merge·TestFlight는 전부 **별도 승인**이다.
- 인기순·자동 판단으로 전환하지 않는다. 각 체크는 사람이 눈으로 본 결과다.
