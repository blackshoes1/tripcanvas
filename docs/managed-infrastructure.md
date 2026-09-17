# 관리형 인프라 전환 — 설계 메모

> **상태 (2026-09-17)**: 코드·마이그레이션·스크립트·문서·staging 구성까지 준비됐다. **프로덕션 전환은 실행하지 않았다.**
> 실제 cutover는 별도 승인 단계다 — [`production-cutover.md`](production-cutover.md). 되돌리기는 [`disaster-recovery.md`](disaster-recovery.md).

한 줄로: **개인 NAS 한 대의 장애를 프로덕션 장애와 분리한다.** API와 PostgreSQL을 관리형 인프라로 옮기고, NAS는 오프사이트 백업과
복구 리허설 대상으로 내려앉는다. `/api/v1` 계약·데이터 모델·revision CAS·판단 엔진은 그대로다 — 바뀌는 것은 **호스팅 위치와 그것을 가리키는 설정**뿐이다.

## 1. 지금의 단일 장애점

```
PWA / iOS ──HTTPS──▶ Tailscale Funnel ──▶ NAS(DS920+)
                                          ├─ api (Next, :3000)
                                          ├─ realtime (WebSocket, :3001)
                                          ├─ postgres:17 (유일한 사본)
                                          └─ backup (매일 pg_dump → 같은 NAS의 다른 볼륨)
```

| 장애 | 사용자에게 | 근거 |
|---|---|---|
| NAS 전원·디스크·DSM 업데이트 | 저장·동기화·Today·협업 전부 중단. 로컬 편집만 남는다 | `docker-compose.yml` — 넷이 한 기계 |
| 집 인터넷 회선 | 같음 | 공개 경로가 집 회선 하나다 |
| Tailscale Funnel 인그레스 | 같음 — **설정이 맞아도 등록이 끊긴 적이 있다**(2026-09-05) | `nas-deployment.md` "Funnel" |
| Docker 데몬·컨테이너 하나 | api가 죽으면 전부, realtime만 죽으면 새로고침 폴백 | — |
| 백업 볼륨 | DB와 **같은 기계**의 다른 볼륨 — 기계가 사라지면 둘 다 사라진다 | `backup-restore.md` |

의존성 인벤토리(코드 기준, 조사 2026-09-17):

- **NAS 의존**: 위 네 컨테이너와 Funnel. `api`·`realtime`·`migrate`는 **볼륨이 없다**(완전히 일회용). 상태는 postgres 볼륨 하나에만 있다.
- **DB 의존**: 앱 코드는 PostgreSQL 13+의 핵심 기능만 쓴다 — 확장(`CREATE EXTENSION`) 0, 역할·GRANT·RLS·`auth.*` 0, plpgsql 함수·트리거 1개(`tc_notify_activity`, SECURITY INVOKER), identity 시퀀스, jsonb, 행 잠금(`FOR UPDATE`). 마이그레이션은 `drizzle-kit migrate`가 `drizzle.__drizzle_migrations`에 기록한다.
- **실시간 의존**: 별도 프로세스가 **전용 `pg.Client`로 `LISTEN tc_realtime`** 을 들고 있다. 클라이언트는 `/api/v1/me`가 주는 `REALTIME_URL`로 붙는다 — 주소는 서버 설정이고 앱 릴리스가 필요 없다.
- **Auth 의존**: better-auth 세션은 **DB의 불투명 토큰 + `AUTH_SECRET` HMAC**이다. 호스트 이름은 토큰에 들어 있지 않다. 같은 DB·같은 비밀이면 **재로그인이 없다.** 옛 iOS 앱의 Supabase 토큰은 `compositeVerifier`가 계속 받는다(그 코드는 이 작업의 대상이 아니다).

## 2. 조사에서 확인한 것

### 런타임 — N개 복제본으로 돌 수 있다

- 런타임에 파일을 쓰는 곳이 없다(`next/src` 전수 grep). 세션·rate limit도 DB(`auth_session`·`auth_rate_limit`)에 있다.
- ⚠️ 응답을 보낸 **뒤에** 구간 캐시를 채우는 작업이 fire-and-forget이다(`route-deps.ts`의 `fillLater`). 요청이 끝나면 얼리는 서버리스 함수에서는 끊긴다 → **컨테이너 런타임**이어야 한다.
- 설정은 프로세스당 한 번 읽는다(`getEnv()` 캐시) — 환경변수를 바꾸면 재시작이다(NAS와 같다).
- 연결: API 풀 `max 5` · 실시간 풀 `max 4` + LISTEN 1. 복제본 N개면 `5N + 5`가 관리형 DB의 연결 한도에 들어가야 한다.
- 레거시 프록시(`api/*.js`)의 IP별 rate limit은 프로세스 메모리다 — 복제본 수만큼 곱해지고, 보안 경계가 아니다(원래 그렇다).

### PostgreSQL — 관리형에서 그대로 돈다, 단 넷을 확인한다

| | 판정 | 확인할 것 |
|---|---|---|
| DDL 전체(11개 마이그레이션) | OK | 없음 — 확장·역할·RLS·이벤트 트리거·`ALTER SYSTEM` 없음 |
| `gen_random_uuid()` | OK(PG13+ 핵심) | PG 버전 ≥ 13 |
| `drizzle` 스키마 생성 | **확인** | 마이그레이션 계정에 `CREATE ON DATABASE` 권한. `MIGRATE_DATABASE_URL`로 소유자 계정을 따로 줄 수 있다 |
| 이관 도구(`importer.ts`)의 `disable trigger`·`truncate` | **확인** | 그 계정이 **표의 소유자**여야 한다(관리형이 비소유 계정을 주면 실패) |
| 실시간 `LISTEN` | **직접 연결 필수** | 트랜잭션 모드 풀러(PgBouncer·Supavisor transaction)를 지나면 **조용히 죽는다**. `REALTIME_DATABASE_URL`에 직접 주소 |
| TLS | DSN으로만 | 코드에 ssl 설정이 없다. `sslmode=require`를 요즘 `pg`는 verify-full로 읽어 체인에 걸린다 → `?uselibpqcompat=true&sslmode=require` (`backup-restore.md`에 실측 기록) |

### 실시간 — 그대로 옮긴다, 재설계하지 않는다

trigger → `pg_notify` → LISTEN → hub → WebSocket 흐름은 관리형에서도 같다. 필요한 것은 **오래 사는 프로세스**(WebSocket + LISTEN)와 **직접 DB 연결**뿐이다.
복제본을 늘려도 된다(각자 LISTEN하고 각자의 소켓에 방송한다). 재접속은 2초 고정 간격이고 놓친 알림은 복구하지 않는다 — 클라이언트 폴백(탭 복귀·패널 열기·수동 새로고침)이 그대로 진실을 다시 읽는다.

### 클라이언트 — 장애 UX는 대체로 안전했고, 하나를 고쳤다

| 상황 | 웹 | iOS |
|---|---|---|
| 서버 5xx·503 | 편집은 localStorage에 남고 15초 뒤 자동 재시도. 토스트 "잠시 후 다시 시도합니다(편집은 그대로)" | 편집기가 초안을 들고 오류를 보인다. 자동 재시도는 없다(사람이 다시 누른다) |
| 409 | 충돌 카드. 덮어쓰지 않는다 | 충돌 배너. 입력은 편집기에 남는다 |
| 목록 실패 | 목록은 localStorage에서 그린다 — "0개"로 보이지 않는다 | "불러오지 못했어요 + 다시 시도" — 빈 목록과 구분한다 |
| **PUT이 404** | ⚠️ **여행을 다시 만든다**(`api.js`의 NOT_FOUND → create) | 로컬을 지우지 않는다 |
| **목록이 200에 빈 배열** | ⚠️ 모든 여행이 "원격에 없음" 충돌 카드 → "클라우드본 사용"을 고르면 **로컬 여행이 지워진다** | "아직 여행이 없어요" |
| **get-session이 5xx** | ⚠️ 토큰을 지워 로그아웃처럼 보였다 — **이번에 고쳤다**(`auth.js`: 401·403만 지운다) | 세션 유지(원래 맞게 돼 있었다) |

마지막 세 줄이 전환 설계를 정했다: **전환 중에 절대 404나 빈 200을 내면 안 되고, 쓰기만 잠깐 막는 503이 맞다.** 그래서 점검(읽기 전용) 모드를 503 `MAINTENANCE`로 만들었다.

### iOS — 호스트가 바뀌면 앱 릴리스가 필요하다

`TCApiBaseURL`은 빌드 시점의 Info.plist 값이고 런타임 재정의가 없다(`AppEnvironment.swift`). 실시간 주소는 `/me`가 주므로 릴리스가 필요 없지만 **API 호스트는 다르다.**
그래서 이번 전환은 **옛 주소가 계속 살아 있는 동안** 새 앱을 내보내는 순서여야 한다 — [`production-cutover.md`](production-cutover.md) Phase D.

## 3. 목표 구조

```
                ┌─────────────┐
                │ PWA / iOS   │   웹: DEFAULT_BASE 두 줄(api.js·auth.js) → 재배포
                └──────┬──────┘   iOS: TCApiBaseURL → 새 빌드(옛 주소는 관찰 기간 동안 살려 둔다)
                       │ HTTPS
                       ▼
        ┌──────────────────────────────┐
        │ 관리형 컨테이너 런타임        │   api(Next standalone) · realtime(WebSocket+LISTEN)
        │ 같은 이미지(next/Dockerfile)  │   /api/health = api·database·realtime·backup·readOnly
        └──────────────┬───────────────┘
                       │ TLS · 직접 연결(LISTEN) / 풀러(API)
                       ▼
        ┌──────────────────────────────┐
        │ 관리형 PostgreSQL (primary)   │   provider 스냅샷/PITR
        └──────────────┬───────────────┘
                       │ pg_dump(6시간) · ops_backup_runs 기록
                       ▼
        ┌──────────────────────────────┐
        │ NAS — secondary               │   deploy/docker-compose.backup-only.yml
        │  오프사이트 백업 · 복구 리허설 │   관찰 기간엔 옛 스택도 롤백 대상으로 유지
        └──────────────────────────────┘
```

NAS의 새 역할(우선순위대로): **① 오프사이트 백업 목적지 ② 주기 pg_dump 저장 ③ 복구 리허설 대상 ④ 진단**. warm standby(복제본)는 만들지 않는다 — 이 규모에서 복제 설정·모니터링 복잡도가 얻는 것보다 크다.
**최소 요구는 하나다: NAS가 완전히 꺼져도 With J가 정상이어야 한다.** 위 구조에서 NAS가 꺼지면 잃는 것은 "오늘의 오프사이트 사본"뿐이고, `/api/health`가 26시간 뒤 `backup: degraded`로 알린다.

## 4. Provider 선택

앱이 provider에 요구하는 것부터 적는다. 이 표를 만족하면 어느 회사든 된다 — 아래 추천은 "이미 쓰고 있어서"가 아니라 이 표로 골랐다.

| 요구 | 왜 |
|---|---|
| 컨테이너를 **계속** 띄우는 런타임(잠들지 않음) | 응답 뒤 배경 작업 · WebSocket · LISTEN |
| Docker 이미지 그대로(빌드 컨텍스트 = 저장소 루트) | `next/Dockerfile`이 이미 있다. 판단 엔진이 루트에 있다 |
| PostgreSQL ≥ 13(운영과 같은 17 권장), 확장 불필요 | 조사 결과 |
| **직접 연결**(풀러 밖) 제공 | LISTEN · `pg_dump` · 마이그레이션 |
| 스냅샷 + 가능하면 PITR | RPO를 하루보다 줄인다 |
| `pg_dump`로 밖에서 받을 수 있을 것 | NAS 오프사이트 사본(2번째 장애 도메인) |
| TLS · IP/네트워크 제한 · 계정 분리 | `security.md` |
| 한국에서 가까운 리전 | 여행 중 해외에서도 쓰지만 편집·계획은 한국에서 한다 |
| 개인 규모 비용 | 사용자 수 명 |

### 추천 (기본안)

| 층 | 선택 | 이유 | 대안 |
|---|---|---|---|
| API + 실시간 런타임 | **Fly.io** (도쿄 `nrt`), 앱 둘(api·realtime), `min_machines_running = 1` | Dockerfile 그대로 · 오래 사는 프로세스 · 앱별 헬스체크 · 시크릿 저장소 · 한국에서 ~30ms · 이 규모에서 월 수 달러. 설정 예시는 `deploy/managed/` | **Railway**(더 단순, 싱가포르) · **Google Cloud Run**(`min-instances=1` 필요, IAM·Cloud SQL 커넥터 추가) · **Render**(싱가포르, Postgres까지 한 회사) |
| PostgreSQL | **관리형 PostgreSQL 17, 서울/도쿄 리전, 직접 연결 + PITR** — 1순위 후보 **Supabase Postgres(서울) — Postgres로만 쓴다**(Auth·RLS·RPC 없음) | 가장 가까운 리전 · 직접 연결과 세션 풀러 둘 다 · PITR(유료 add-on) · 네트워크 제한 · `pg_dump` 가능 · 이관 도구가 이미 이 종류의 풀러와 통했다(`backup-restore.md`) | **AWS RDS 서울**(가장 견고, 설정·비용 큼, 런타임의 고정 egress IP 필요) · **Fly Managed Postgres**(한 회사로 끝남 — 리전·PITR 확인 필요) · **Neon**(자동 정지가 LISTEN과 충돌, 한국 리전 없음) |
| 백업 | provider 스냅샷/PITR **+** NAS의 독립 `pg_dump`(6시간, `docker-compose.backup-only.yml`) | 두 장애 도메인 | 오브젝트 스토리지(B2·S3)를 3번째 사본으로 — 필요해지면 |
| 감시 | `/api/health`(구성요소) + Vercel `api/health-watch.js`(밖에서) + 무료 uptime 모니터 | 이미 있는 것을 방향만 바꾼다 | provider 알림 |

⚠️ **Supabase를 DB로 고르는 것과 "Supabase 레거시 코드"는 별개다.** 롤백 대상인 옛 프로젝트(BaaS: Auth·RLS·RPC)는 그대로 두고, 새 프로젝트는 **PostgreSQL 호스트로만** 쓴다.
두 프로젝트가 같은 콘솔에 보이므로 이름을 분명히 가른다(`withj-legacy-rollback` · `withj-pg-primary`). 이 혼동이 싫으면 2순위(AWS RDS 서울)로 간다 — 앱 코드는 바뀌지 않는다.

⚠️ 위 표의 provider별 사실(리전·PITR 요금·프리티어 정지 정책·IPv4 add-on·풀러 모드·flyctl 플래그)은 **작성 환경에서 확인할 수 없었다**(외부 문서 접근 차단).
**설정 당일 콘솔에서 확인하고 이 표를 고친다.** 확인 전에는 "지원된다"고 가정하지 않는다.

### staging에서 반드시 실측할 것

1. 직접 연결로 `LISTEN`이 살아 있는가 — `/api/health`의 `components.realtime = ok`, 사이드카 `/health`의 `listener = LISTENING`, 그리고 **다른 창에서 후보를 담으면 이쪽이 갱신되는가.**
2. 풀러 주소로 API가 도는가(로그인·저장·충돌·삭제) — `docs/staging-verification.md`의 2~4단계 그대로.
3. `pg_dump`가 밖(NAS)에서 되는가 — `docker-compose.backup-only.yml`로 한 번 받고 `ops_backup_runs`에 행이 생기는가.
4. 복원이 되는가 — `scripts/rehearse-restore-managed.sh`(합성) 그리고 **운영 덤프로** `scripts/restore-to-target.sh` + `verify:db` PASS.
5. 점검 모드 — `TC_READ_ONLY=1`로 PUT이 503 `MAINTENANCE`이고 GET은 200인가, 웹 토스트가 "점검 중"인가.
6. TLS 문자열 — `SELF_SIGNED_CERT_IN_CHAIN`이 나면 `uselibpqcompat=true`.

## 5. 환경변수 계약 (provider 독립)

앱은 아래 이름만 안다. provider는 이 값을 **어디에 저장하느냐**만 다르다. 전체 목록은 `deploy/managed/env.managed.example`, NAS용은 `deploy/.env.example`.

| 이름 | 프로세스 | 뜻 · 주의 |
|---|---|---|
| `DATABASE_URL` | api · realtime · migrate | 앱 연결(풀러 가능). TLS는 이 문자열로만 |
| `REALTIME_DATABASE_URL` | realtime | **LISTEN 전용 직접 연결.** 비우면 `DATABASE_URL` — 풀러면 조용히 죽는다 |
| `MIGRATE_DATABASE_URL` | migrate | 소유자 계정. 비우면 `DATABASE_URL` |
| `AUTH_SECRET` | api · realtime | **같은 값.** 32자 이상 |
| `API_BASE_URL` | api | 공개 주소. better-auth `baseURL`·메일 링크. 호스트 이전 시 **반드시** |
| `TRUSTED_ORIGINS` | api | 적으면 기본값이 사라진다 — 프로덕션 웹 주소 포함 |
| `WEB_BASE_URL` | api | 메일 링크가 도착할 웹. 비우면 `TRUSTED_ORIGINS[0]` |
| `REALTIME_URL` | api | 클라이언트가 붙을 `wss://…/ws` — `/api/v1/me`가 준다 |
| `REALTIME_HEALTH_URL` | api | 사이드카 `/health` 내부 주소 — `/api/health`의 realtime 구성요소 |
| `BACKUP_MAX_AGE_HOURS` | api | `ops_backup_runs` 최신성 판정(기본 26). 비우면 검사 안 함 |
| `TC_READ_ONLY` | api | 점검(읽기 전용) 모드. 전환 직전에만 `1` |
| `TC_MIGRATION_*` | api · realtime | 넷 다 `NEW_BACKEND`. 의미는 "PostgreSQL 저장소 기반 새 backend"이지 호스팅 위치가 아니다 |
| `KAKAO_REST_API_KEY` · `GOOGLE_ROUTES_API_KEY` | api | 서버 전용 키. 없으면 그 기능만 미연결 |
| `SMTP_*` · `MAIL_FROM` | api | 메일 |
| `NEXT_PUBLIC_SUPABASE_URL` · `SUPABASE_JWT_SECRET` | api · realtime | 옛 iOS 앱 토큰 검증(전환기) |
| `BACKUP_SOURCE_URL` · `BACKUP_DESTINATION` · `BACKUP_DIR` · `BACKUP_KEEP_DAYS` | NAS backup | 관리형 DB의 직접 주소 · `nas` · 경로 · 보관 |

새 abstraction layer는 만들지 않았다 — 코드는 이미 provider를 몰랐고, 빠져 있던 것은 **이름 셋**(`REALTIME_DATABASE_URL`·`MIGRATE_DATABASE_URL`·`REALTIME_HEALTH_URL`)과 점검 모드였다.

## 6. 이번 변경으로 들어온 것

| 파일 | 역할 |
|---|---|
| `next/src/server/migration/verifyDb.ts` · `verifyDbMain.ts` · `scripts/verify-db-migration.sh` | **PostgreSQL↔PostgreSQL 전수 대조** — 표·컬럼·행 수·내용(md5)·jsonb·revision·시각·집계·PK/FK/unique/check·인덱스·시퀀스·journal. PASS/FAIL/SKIP, SKIP은 통과가 아니다 |
| `next/src/server/api/health.ts` · `app/api/health/route.ts` | `/api/health`가 `HEALTHY/DEGRADED/UNAVAILABLE` + `components{api,database,realtime,backup}` + `readOnly`. 503은 DB가 죽었을 때뿐 |
| `next/src/server/api/maintenance.ts` · `proxy.ts` · `errors.ts` | **점검(읽기 전용) 모드** — `TC_READ_ONLY=1`이면 `/api/v1/*`·`/api/auth/*`의 쓰기가 503 `MAINTENANCE`(CORS·retry-after 포함) |
| `…/migrations/0011_ops_backup_runs.sql` · `schema.ts` | 백업 성공 기록 표 — `deploy/backup.sh`가 쓰고 `/api/health`가 읽는다 |
| `deploy/backup.sh` · `docker-compose.backup-only.yml` | `BACKUP_SOURCE_URL`로 **원격(관리형) DB를 NAS로** 당겨 오는 백업 + 성공 기록 |
| `scripts/restore-to-target.sh` · `rehearse-restore-managed.sh` · `rehearse-seed.sql` | 덤프 → 비어 있는 대상 복원 → 마이그레이션 → 전수 대조. 합성 데이터로 관리형 경로 리허설 |
| `next/src/server/realtime/main.ts` · `drizzle.config.ts` · `config/env.ts` | `REALTIME_DATABASE_URL` · `MIGRATE_DATABASE_URL` · 새 헬스/백업/점검 설정 |
| `api/health-watch.js` | 감시가 새 `/api/health` 모양을 읽고, 실시간이 다른 호스트여도 찌른다(`TC_WATCH_REALTIME_BASE`). 백업·점검 모드도 DEGRADED로 |
| `auth.js` · `sync.js` | get-session 5xx에 토큰을 지우던 버그 수정 · 점검 중 문구 |
| `deploy/managed/*` · `.github/workflows/managed-staging.yml` | 런타임 배포 예시(Fly)와 **버튼으로만** 도는 staging 배포 |
| `scripts/verify-all.sh` · `.github/workflows/ci.yml` | 게이트에 복구 리허설 단계 추가 |

## 7. 열린 결정 (사람이 정한다)

1. **Provider** — 위 추천을 콘솔에서 확인한 뒤 확정한다. 앱 코드는 어느 쪽이든 같다.
2. **도메인** — 없어도 된다(provider 호스트명으로 간다). 있으면 API 주소가 provider와 독립돼 다음 이전에 **iOS 릴리스가 필요 없어진다.** 이번엔 필수가 아니다.
3. **RPO / RTO** — 기본안은 RPO ≤ 6시간(NAS pg_dump) 또는 PITR 분 단위, RTO 1시간(복원 스크립트 + 재배포). `disaster-recovery.md`.
4. **관찰 기간** — NAS 옛 스택을 롤백 대상으로 유지하는 기간. 최소 2주를 제안한다(그동안 `docker-compose.yml`은 내리지 않는다).
5. **Supabase 롤백 대상(`tripcanvas-api` Vercel)** — 이 전환과 무관하다. 종료 조건은 `system-architecture-review.md` 그대로.
