# 독립 Backend 1차 — Foundation · Supabase JWT 호환 · Trip API (설계)

전체 이관 계획(Phase 0~10, PR1~PR14)은 `docs/supabase-migration.md`에 있다. 이 문서는 그중 **첫 사이클(PR1·PR2·PR3)** 의 설계다.
목표는 Supabase 제거가 아니라 **Trip 도메인의 데이터 소유권을 자체 API·PostgreSQL 안으로 가져오되, 오늘의 웹·iOS가 한 줄도 바뀌지 않아도 그대로 도는 것**이다.

## 범위

| PR | 내용 | 완료 조건 |
|---|---|---|
| PR1 | Backend foundation — 독립 PostgreSQL 스키마(users·trips·trip_members) · Drizzle ORM · Repository · 요청 컨텍스트 · 오류 계약 · health · 이관 레지스트리 | 스키마가 실제 PostgreSQL(PGlite)에서 적용되고 Repository 테스트 통과 |
| PR2 | Supabase JWT 호환 인증 + 인가 서비스 | JWKS(ES256/RS256)·HS256 둘 다 검증 · OWNER/EDITOR/VIEWER/비멤버/내보내진 멤버 판정 테스트 통과 |
| PR3 | Trip API — 목록·상세·생성·수정(CAS)·삭제(tombstone) 를 새 backend로 · 기존 `/api/v1` 라우트의 Trip 읽기/쓰기를 레지스트리로 분기 | 레지스트리 `LEGACY`에서 기존 동작 그대로(handlers.test 그대로 통과) · `NEW_BACKEND`에서 같은 계약으로 응답 |

**하지 않는 것**: 웹·iOS 클라이언트 변경 · 새 Auth 시스템(Phase 8) · Realtime(Phase 6) · Storage(Phase 7) · Booking/Pricing/Collab 테이블 이관(PR5~PR7) · 데이터 이관 스크립트(PR14) · DB 전체 재설계.

## 위치: Next.js 워크스페이스 안의 `next/src/server/`

`tripcanvas-api`(Vercel, Root `next`)가 이미 `/api/v1`을 서빙하고 계약·핸들러·테스트·CI가 거기 있다. 새 Backend는 **같은 앱의 Route Handler 뒤**에 둔다 — 별도 서비스를 하나 더 만들면 계약이 둘이 된다. NAS에서는 같은 Next 앱을 Docker(standalone)로 띄운다. Realtime WebSocket은 Phase 6에서 사이드카 또는 custom server로 붙인다(문서화만).

```
next/src/server/
  config/        env.ts(환경변수) · migrationRegistry.ts(도메인별 LEGACY|DUAL_READ|NEW_BACKEND)
  api/           errors.ts(오류 계약·HTTP 매핑) · context.ts(RequestContext) · respond.ts · validate.ts(zod)
  auth/          TokenVerifier 인터페이스 · supabaseJwt.ts(JWKS + HS256 폴백) · authenticate.ts
  domain/trip/   Trip 집합체 타입 · 역할 규칙(canRead/canEdit/canDelete) · CAS 판정(순수)
  application/   trip/TripService.ts(use case) · authorization/TripAuthorizationService.ts
  repositories/  인터페이스(UserRepository·TripRepository·MembershipRepository) + memory/ (테스트용)
  infrastructure/database/  drizzle client · schema.ts · migrations/(SQL) · pg*Repository.ts
  infrastructure/supabase/  legacyTripRepository.ts(레거시 경로 — 사용자 토큰으로 RLS 아래 조회)
```

Route Handler에는 비즈니스 로직을 두지 않는다: `route.ts → authenticate → TripService → Repository`.

## 데이터

독립 PostgreSQL 스키마는 **운영 Supabase 스키마를 그대로 옮긴다**(`trips.id`는 운영과 같은 `uuid`). 바꾸는 것은 셋뿐이다.

1. `auth.users` 참조 → 자체 `users(id uuid, email, legacy_supabase_user_id, created_at, last_seen_at)`. **id는 Supabase user id를 그대로 쓴다**(§13 — 외래키가 안 깨진다). `legacy_supabase_user_id`는 새 Auth로 갈 때 매핑 기록용.
2. RLS·`auth.uid()`·security definer RPC → **애플리케이션 인가**(§22~24). DB에는 RLS를 켜지 않는다 — API가 유일한 입구다(§24). PostgreSQL role 분리는 하지 않는다(§25).
3. `sync_trip`/`tombstone_trip`의 규칙은 `PgTripRepository.save/tombstone`가 **트랜잭션 + `select … for update`** 로 같은 결과를 낸다: CAS(expectedRevision ≠ revision → conflict) · 삭제된 행은 conflict · 소유한 쪽 우선 · **나간/내보내진 사람의 저장은 복제가 아니라 거절**(`tc_was_member` 규칙) · VIEWER 쓰기 거절 · 삭제는 소유자만. 소유자 멤버 행은 트리거가 아니라 **같은 트랜잭션에서 애플리케이션이** 만든다.

`client_id`는 지금처럼 **사용자별 유일**(`unique(user_id, client_id)`)이다. API의 `tripId`는 계속 `client_id`다 — 클라이언트가 바뀌지 않는다.

마이그레이션은 Drizzle Kit이 만든 SQL을 `drizzle-orm`의 `migrate()`로 적용한다(§62 — 코드로 관리). 테스트는 **PGlite**(진짜 PostgreSQL을 WASM으로) 위에서 같은 마이그레이션을 적용해 돌린다 — 로컬에 PostgreSQL이 없어도 SQL이 실제로 검증된다. 운영은 `pg`(node-postgres).

## 인증 (Phase A, §14~16)

`Authorization: Bearer <Supabase access token>` 을 서버가 **직접 검증**한다(지금은 `sb.auth.getUser()`로 Supabase에 물어본다).

- 새 Supabase 프로젝트는 비대칭 키(ES256/RS256) — `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`(jose `createRemoteJWKSet`, 캐시).
- 구형 HS256 토큰은 `SUPABASE_JWT_SECRET`이 있을 때만 검증한다(없으면 그 토큰은 거절).
- `iss`가 `${SUPABASE_URL}/auth/v1`, `aud`가 `authenticated`인지 본다.
- 결과 `RequestContext = { userId, legacySupabaseUserId, email?, sessionId?, tokenSource: 'supabase' }`. 도메인 코드는 JWT payload를 모른다(§16).
- `TokenVerifier`는 인터페이스다 — Phase 8의 새 Auth는 다른 구현을 꽂는다.
- PostgreSQL이 설정돼 있으면 첫 요청에서 `users` 행을 만든다(`ensureUser`). 없으면 만들지 않는다(레거시 전용 배포).

## 인가 (§22~24, §41)

`TripAuthorizationService.roleOf(userId, tripRowId)`: 소유자 → OWNER · 활성 멤버 → 그 역할 · 아니면 null. LEFT/REMOVED는 null이고 `wasMember`로 따로 안다.
`canRead = role != null` · `canEdit = OWNER|EDITOR` · `canDelete/canManageMembers = OWNER`. 규칙은 `collab.js`(웹과 같은 판정)를 그대로 쓴다.

## API

기존 라우트는 그대로. 새로 더하는 것:

| 라우트 | 하는 일 | 오류 |
|---|---|---|
| `GET /api/v1/trips/:id` | 여행 문서 전체 + revision + role + memberCount | NOT_FOUND |
| `POST /api/v1/trips` | 새 여행 `{ trip }` → normalizeTrip → 저장(revision 1). id가 이미 내 것이면 CONFLICT | VALIDATION_ERROR · CONFLICT |
| `PUT /api/v1/trips/:id` | `{ trip, expectedRevision }` CAS 저장 | STALE_VERSION(현재 revision 동봉) · FORBIDDEN · NOT_FOUND |
| `DELETE /api/v1/trips/:id?expectedRevision=` | tombstone. 소유자만 | FORBIDDEN · STALE_VERSION |
| `GET /api/health` | `{ ok, api, database: 'ok'\|'unconfigured'\|'error' }` | — |

오류 본문(§29·§30): `{ code, message, details?, error }` — `error`는 기존 iOS `APIErrorBody`가 읽는 필드라 **같은 값을 두 번** 싣는다(구버전 앱 호환). 새 코드: `UNAUTHORIZED · FORBIDDEN · NOT_FOUND · VALIDATION_ERROR · CONFLICT · STALE_VERSION · RATE_LIMITED · INTERNAL_ERROR`. 기존 라우트의 코드(`TRIP_NOT_FOUND` 등)는 바꾸지 않는다(모바일 호환, §27).

기존 `/api/v1` 핸들러의 `Gateway`는 그대로 두고, `route-deps.ts`에서 **Trip 읽기·쓰기(listTrips/getTrip/saveTrip)만 레지스트리에 따라** 새 Repository로 바꿔 끼운다(Strangler). 나머지(제안 거절·가격·알림·기기·기록)는 Supabase 그대로(PR5·PR6).

## 이관 레지스트리 (§35·§77·§78)

환경변수 `TC_MIGRATION_TRIP=LEGACY|DUAL_READ|NEW_BACKEND` (기본 `LEGACY`). `DATABASE_URL`이 없으면 무조건 `LEGACY`.
`DUAL_READ`: 새 PostgreSQL에서 먼저 찾고 없으면 레거시에서 읽는다(쓰기는 새 쪽). 롤백은 값을 되돌리는 것뿐이다.
다른 도메인(AUTH·BOOKING·PRICING·COLLAB·REALTIME·STORAGE)은 이번에 전부 `LEGACY`로 고정돼 있고 레지스트리에 이름만 있다.

## 테스트

- 순수/서비스: vitest + in-memory Repository (CAS 충돌 · 권한 · 나간 사람 · 생성/수정/삭제 · 오류 매핑 · 레지스트리 · 검증).
- 인증: jose로 만든 ES256 키의 JWKS(로컬 `createLocalJWKSet`)와 HS256 비밀로 서명한 토큰 — 만료·잘못된 iss/aud·서명 불일치 거절.
- DB: PGlite 위에서 마이그레이션 적용 → `PgTripRepository` 시나리오(소유자 우선 · 멤버 인식 CAS · 나간 사람 거절 · 삭제는 소유자만) — `test/rls/collaboration.sql`의 1단계 기대값과 같은 결론.
- 라우트: 새 Trip 라우트를 in-memory로 끝까지(401/403/404/409/422).
- 기존 `handlers.test.ts`는 손대지 않고 그대로 통과해야 한다(레거시 동작 보존, §95).

## 문서·배포 산출물

`docs/backend-architecture.md` · `docs/supabase-migration.md`(인벤토리 보고서 + 레지스트리 + 단계 현황) · `docs/nas-deployment.md` · `docs/backup-restore.md` · `deploy/`(docker-compose · Caddyfile · backup 스크립트 · `next/Dockerfile`) · `next/.env.example`. Docker는 이 작성 환경에 없어 **미검증**으로 표시한다.
