# NAS 릴리스와 복구 확인

운영 실행은 승인 후 한다. GitHub merge는 웹과 Vercel 함수만 배포한다. API뿐 아니라 공통 루트 엔진, `next/`, Docker 구성 변경도 NAS 대상일 수 있다.

## 변경 대상 판정

```bash
npm run deployment:plan -- <현재-NAS-배포-커밋> <검증한-대상-커밋>
```

도구는 커밋 차이를 읽고 대상만 출력한다. 배포하지 않으며 환경변수·운영 상태를 읽지 않는다. 미커밋 변경은 포함하지 않는다. 삭제·이동한 파일도 기존 경로를 기준으로 판정한다. `next/`는 안전하게 전체를 NAS 이미지 대상으로 잡으므로 테스트·문서만 바뀌어도 표시될 수 있다.

| 변경 | 필요한 조치 |
|---|---|
| 루트 웹 자산 | 버전 갱신 + Vercel 배포 |
| 공통 엔진·Next API·서비스·실시간·의존성 | 같은 커밋의 `migrate`, `api`, `realtime` 빌드 |
| DB migration | 백업 확인, 구버전 코드 호환 검토, 새 migrate 이미지 실행 |
| Compose·백업 | 구성 변경 반영 후 `backup` 포함 전체 서비스 상태 확인 |
| iOS | 계약·기기 검증과 앱 별도 배포 |

## 순서

1. `npm run verify:all`을 실행한다. FAIL=1, SKIP=2는 통과가 아니다. 운영 덤프 복구·실기기 검증은 이 명령과 별개다.
2. API 변경은 기존 웹·iOS도 받아야 한다. 새 필드는 기본적으로 추가하고, 기존 필드 삭제·의미 변경은 클라이언트 전환 뒤로 미룬다. 새 라우트의 404를 빈 데이터로 처리하지 않는지 확인한다. 현재 `schemaVersion`은 응답 계약 버전이며 배포 커밋·기능 지원 목록이 아니다.
3. 백업 최신 성공과 복구 가능한 사본을 확인하고, 파괴적 migration은 별도 중단 계획을 세운다. 구버전 앱과 공존할 수 있는 추가형 migration을 먼저 적용한다.
4. 검증한 커밋의 아카이브를 새 소스 디렉터리에 푼다. 기존 디렉터리에 덮어 풀면 삭제된 코드가 남을 수 있다. 운영 `.env`와 백업 절대 경로는 별도로 유지하고, 기존 Compose 프로젝트 이름 `tripcanvas` 및 DB 볼륨을 바꾸지 않는다.
5. 웹이 새 API를 요구한다면 **merge 전에 승인된 API 커밋을 먼저 배포**한다. 아래 명령은 NAS 소스 디렉터리에서 실행한다. `TC_REVISION`은 그 아카이브를 만든 전체 커밋 SHA로 설정한다.

```bash
export TC_REVISION=<검증한-전체-커밋-SHA>
sudo env TC_REVISION="$TC_REVISION" /usr/local/bin/docker compose -f deploy/docker-compose.yml build migrate api realtime
# build 성공 후에만 다음 단계. 각 명령이 실패하면 중단한다.
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml up -d postgres
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml run --rm migrate
# migration 성공 후 전체를 올린다. backup을 누락하지 않는다.
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml up -d
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml ps -a
```

처음 실행한 migrate와 compose가 의존성으로 다시 실행한 migrate는 같은 이력을 읽는 멱등 실행이다. 과거에 성공한 컨테이너만 보고 새 스키마 적용을 생략하지 않는다. 이 명령 묶음은 자동 rollback을 하지 않는다.

6. 이미지의 `org.opencontainers.image.revision` 라벨과 실행 중인 컨테이너의 이미지 ID를 대조한다. `migrate`, `api`, `realtime` 모두 같은 SHA여야 한다. `unknown`은 버전 확인 실패다. 전체 `docker inspect`나 `compose config`를 로그에 남기면 환경변수 비밀이 나올 수 있으므로 필요한 필드만 조회한다.

```bash
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml images
sudo /usr/local/bin/docker inspect --format '{{.Image}}' <컨테이너-ID>
sudo /usr/local/bin/docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' <이미지-ID>
```

7. `drizzle.__drizzle_migrations`의 마지막 적용 시각과 `next/src/server/infrastructure/database/migrations/meta/_journal.json`의 마지막 `when`을 대조한다. 이미지 버전만으로 DB 적용을 보장하지 않는다.
8. 외부에서 `/api/health`의 DB 상태, `/api/v1/trips`의 비인증 401, `/api/health-watch`의 WS 결과를 확인한다. 이어서 검증 계정으로 로그인 → 여행 읽기 → 임시 여행 저장 → 다른 클라이언트 재조회 → 실시간 갱신을 확인한다. 401만으로 저장 성공을 판정하지 않는다. 운영 검증 데이터 생성은 승인된 범위에서만 한다.
9. 필수 체크와 API 호환 검증 후 웹 PR을 merge하고, 폰에서 웹 버전·로그인·저장을 확인한다. 앱 배포는 별도다.

## 복귀 방법

- **웹 코드:** revert PR로 이전 동작을 되돌리되, NAS API는 호환 상태로 유지한다.
- **NAS 코드:** 이전에 검증한 소스·이미지 버전으로 되돌린다. 현재 DB 스키마와 호환되는지 먼저 확인한다. 비밀은 현재 운영 값을 유지한다.
- **스키마:** git revert로 DB가 돌아가지 않는다. 호환 가능한 forward migration을 우선한다.
- **데이터:** 손실·오염 시 쓰기 중단 → 원본 보존 → 별도 DB에 덤프 복구 → 무결성·앱 검증 → 승인 후 전환. 복구 시점 이후 변경은 별도로 처리한다.
- **Supabase 전환:** NAS 신규 데이터는 Supabase에 없다. 플래그·API 주소 변경만으로 안전한 복귀가 되지 않으며, 차이 데이터 처리·사용자 재인증·허용 손실 결정이 선행되어야 한다.

Docker 빌드 제외는 루트 `.dockerignore`가 담당한다. `COPY . .` 전에 `.env`, 백업, 로컬 의존성과 생성물을 제외한다. Git에서 무시하는 것과 Docker에서 제외하는 것은 별개다. [Docker 빌드 컨텍스트 문서](https://docs.docker.com/build/concepts/context/#dockerignore-files)
