# Backend Architecture — TripCanvas API

이관의 최종 모양과 계층 규칙. 이관 현황·인벤토리는 `docs/supabase-migration.md`, 배포는 `docs/nas-deployment.md`.

## 최종 목표

```
Web ── iOS ── Widget ── Watch ── Extensions
                  ↓
            TripCanvas API   (next/ — Route Handlers)
        ┌─────────┼─────────┐
      Auth     Domain    Realtime
        └─────────┼─────────┘
              PostgreSQL
                  │
            Object Storage (필요해질 때)
```

클라이언트는 PostgreSQL에 직접 접근하지 않는다. NAS IP·DB 호스트를 모르고 `api.<domain>` 하나만 안다(§73).

## 계층 (§2·§6)

```
Route Handler   next/src/app/api/**           HTTP만: 인증 호출 · zod 검증 · 응답/오류 계약. 비즈니스 로직 금지
Application     next/src/server/application/  use case 오케스트레이션 (TripService · TripAuthorizationService)
Domain          adaptive.js · lib.js · collab.js · price.js (저장소 루트, 웹과 같은 단일 소스) + next/src/server/domain/
Repository      next/src/server/repositories/ 인터페이스 — application은 이것만 본다
Infrastructure  next/src/server/infrastructure/ PostgreSQL(Drizzle) · Supabase(레거시 경로) · (Auth · Realtime · Storage · Mail 예정)
```

**판단은 저장소 루트의 순수 모듈이 한다.** `adaptive.js`(TripState·NextAction·Suggestion·Replan) · `collab.js`(역할·합의) · `price.js`(가격 판정) ·
`lib.js`(정규화)를 `@legacy/*`로 그대로 import 한다. 이관은 **Infrastructure만 바꾼다** — 이 모듈들을 다시 쓰지 않는다(§39·§97).

## 요청 하나의 흐름

```
Authorization: Bearer <token>
  → server/auth  TokenVerifier.verify → RequestContext { userId, email, sessionId }   (도메인은 JWT payload를 모른다, §16)
  → server/api   zod 검증 → ApiError(VALIDATION_ERROR)
  → application  TripService.update(ctx, id, doc, expectedRevision)
       ├ TripAuthorizationService.canEdit(userId, tripRowId)   ← RLS 대체(§22~24). 규칙은 collab.js
       └ TripRepository.updateCas(...)                          ← 트랜잭션 · select for update · revision CAS
  → Response  { schemaVersion, trip, document }  /  { code, message, details?, error }
```

### 인증 (Phase A)

`server/auth/supabaseJwt.ts` — Supabase access token을 **서버가 직접** 검증한다: 비대칭 키(ES256/RS256)는 JWKS, HS256은 `SUPABASE_JWT_SECRET`이 있을 때만.
issuer `${SUPABASE_URL}/auth/v1` · audience `authenticated`. 로컬 검증이 실패하면 `withRemoteFallback`이 예전처럼 `getUser()`로 한 번 더 확인하고 경고를 남긴다 —
전환 첫날 전 사용자가 401을 받는 사고를 막는 안전장치다. `TokenVerifier`는 인터페이스라 Phase 8의 새 Auth는 구현만 바꾼다.

### 인가

DB에는 RLS가 없다(새 DB). `TripAuthorizationService`가 `roleOf → canRead/canEdit/canManageMembers/canDelete`를 판정하고
테스트가 OWNER·EDITOR·VIEWER·비멤버·내보내진 멤버를 API 경계에서 검증한다(§83). PostgreSQL role 분리는 MVP에서 하지 않는다(§25).

### 오류 계약 (§29·§30)

`{ code, message, details?, error }` — `error`는 `code`와 같은 값으로, 기존 iOS `APIErrorBody`가 읽는 필드다(§27).
`UNAUTHORIZED 401 · FORBIDDEN 403 · NOT_FOUND 404 · VALIDATION_ERROR 400 · CONFLICT 409 · STALE_VERSION 409 · RATE_LIMITED 429 · INTERNAL_ERROR 500`.
`details.revision`은 최상위 `revision`으로도 올린다(기존 `REVISION_CONFLICT` 계약과 같은 자리). 기존 라우트의 코드(`TRIP_NOT_FOUND` 등)는 바꾸지 않는다.

### 낙관적 동시성 (§91)

`trips.revision`. 쓰기는 마지막에 읽은 `expectedRevision`을 싣고, 다르면 `STALE_VERSION`(현재 revision 동봉) — 조용히 덮어쓰지 않는다.
삭제는 tombstone(`deleted_at` + revision 증가). `force`는 충돌 카드에서 사용자가 고른 경우에만.

## Repository 계약 (§9)

| 인터페이스 | 메서드 | 구현 |
|---|---|---|
| `TripRepository` | `listVisible` · `findVisible`(소유한 쪽 우선) · `create`(OWNER 멤버 행까지 한 트랜잭션) · `updateCas` · `tombstoneCas` | `PgTripRepository` · `LegacyTripRepository`(Supabase) · `DualReadTripRepository` · `MemoryTripRepository`(테스트) |
| `MembershipRepository` | `roleOf` · `wasMember` · `add` · `setStatus` | 같은 세 구현 |
| `UserRepository` | `ensure`(멱등) · `findById` | `PgUserRepository` |
| `CollabRepository` | 멤버·초대·후보·반응·코멘트·활동 저장과 뷰 조회(이름표·집계는 SQL) — 활동 기록은 같은 트랜잭션에서 | `PgCollabRepository` |
| `CollabApi`(application 계약) | RPC 21종에 대응하는 use case | `CollabService`(새 DB, 판정은 application) · `LegacySupabaseCollabService`(RPC 1:1) |
| Adaptive · Pricing | `SuggestionFeedback` · `NotificationLog` · `Device` · `Memory` · `PriceObservation` | `pgAdaptiveRepositories` · `pgPriceObservationRepository` (+ 레거시는 기존 Gateway, `composeGateway`가 조립) |

application/domain 코드에 SQL·ORM 쿼리를 쓰지 않는다. 새 구현은 `pgRepositories.test.ts`(PGlite)와 `tripService.test.ts`(메모리)가 같은 결론을 내야 한다.

## 데이터베이스

- 스키마는 `infrastructure/database/schema.ts`(Drizzle) 하나. SQL은 `npm run db:generate`가 만들고 `npm run db:migrate`(drizzle-kit)가 적용한다 — 손으로 SQL을 치지 않는다(§62).
- 운영 Supabase 스키마를 그대로 옮겼다. `trips.id`는 운영과 같은 uuid, `users.id`는 Supabase user id를 보존한다(§13).
- `auth.uid()` 기본값·RLS·security definer RPC는 없다 — 호출자는 API가 알고 규칙은 application이 판정한다.
- 테스트는 **PGlite**(PostgreSQL WASM) 위에서 같은 마이그레이션을 적용한다 — 로컬 PostgreSQL 없이 SQL이 실제로 검증된다.
- 운영은 node-postgres Pool(프로세스당 하나, `infrastructure/database/client.ts`).

## 이관 레지스트리 (§35·§77)

`TC_MIGRATION_<DOMAIN>=LEGACY|DUAL_READ|NEW_BACKEND`. `DATABASE_URL`이 없으면 전부 LEGACY. `route-deps.ts`가 요청마다 이 값으로 저장소를 고른다.
롤백은 값을 되돌리는 것뿐이다(§78) — 단 새 DB에 쓴 뒤 LEGACY로 돌아가면 그 사이 변경은 Supabase에 없다(`docs/supabase-migration.md` 롤백 절).

## 실시간 (`server/realtime/`)

별도 프로세스(사이드카)다 — Next Route Handler는 WebSocket 업그레이드를 다루지 않는다. Vercel은 API만 띄우고 NAS는 둘 다 띄운다.

```
trip_activity INSERT
  → 트리거 tc_notify_activity (마이그레이션 0004) — pg_notify는 트랜잭션이라 커밋된 뒤에만 나간다
  → pgListener  전용 연결로 LISTEN(Pool 금지). 끊기면 다시 붙고 status()로 알린다 — 끊긴 LISTEN은 조용하다
  → hub         접속 상태 기계: AUTH(첫 프레임) → SUBSCRIBE(멤버십 확인) → 방송. 토큰 만료·죽은 접속 정리
  → server      ws/http 배선과 /health 뿐
```

페이로드는 `{type, tripId, id, kind, mine}` 뿐이다(§44). `mine`은 구독자마다 계산해 붙이고, 내부 식별자(`trips.id`)와 다른 사람의 user id는 나가지 않는다. 구독 권한은 API와 **같은 규칙·같은 Repository**(`TripRepository.findVisible`)로 판정한다.

## 자체 Auth (`server/auth/`, Phase 8)

better-auth가 계정·세션·토큰을 소유하고(§18) 우리는 정책과 **연결**만 갖는다.

```
/api/auth/*  →  better-auth (가입·확인·로그인·재설정·세션)
                  ↓ auth_user / auth_session / auth_account / auth_verification
betterAuthVerifier  세션 → resolveDomainUser → RequestContext(userId = 도메인 users.id)
compositeVerifier   Supabase 토큰 · 자체 세션을 함께 받는다(전환기, §14)
```

- `users`(도메인)와 `auth_user`(라이브러리)는 분리하고 `users.auth_user_id`로 잇는다(§12·§13). `users.id`가 Supabase user id 그대로라 기존 참조가 안 깨진다.
- **확인된 이메일로만 잇는다** — 계정 탈취 방지(`identity.ts`).
- 메일은 교체 가능한 어댑터(`infrastructure/mail/`): SMTP(§21) 또는 콘솔. 쿨다운 데코레이터가 반복 발송을 막는다(§67).
- `TokenVerifier` 인터페이스 덕분에 라우트·실시간 허브는 어느 Auth로 들어왔는지 모른다(§16).

## 아직 Infrastructure에 없는 것

| 어댑터 | 계획 |
|---|---|
| Storage | Phase 7 — 현재 쓰는 곳이 없어 새 기능 전까지 보류. 들어오면 MinIO + `object_key`만 저장(§51) |

## 테스트 (§81~§86)

| 층 | 어디 | 무엇 |
|---|---|---|
| Repository(DB) | `pgRepositories.test.ts` | PGlite에 마이그레이션 적용 → 소유한 쪽 우선 · CAS · tombstone · 나간 사람 |
| Application | `tripService.test.ts` · `tripAuthorization.test.ts` · `dualRead.test.ts` | 메모리 저장소로 use case · 권한 5종 · dual read 규칙 |
| Auth | `supabaseJwt.test.ts` · `withRemoteFallback.test.ts` | ES256 JWKS · HS256 · issuer/audience/만료/서명 거절 · 폴백 |
| API 경계 | `tripRoutes.test.ts` | 401/400/403/404/409 + 응답 계약 |
| 자체 Auth | `betterAuthVerifier.test.ts`(PGlite+better-auth 실제 가입→확인→로그인) · `identity.test.ts` · `cooldownMailService.test.ts` · `compositeVerifier.test.ts` | 이메일 확인 전 연결 거부 · 기존 사용자 이관 · 쿨다운 · 전환기 검증 |
| 실시간 | `hub.test.ts` · `events.test.ts` · `pgListener.test.ts` · `pgNotify.test.ts`(PGlite) · `server.test.ts`(진짜 WebSocket) | 인증·구독 권한·방송·토큰 만료·재연결·트리거 |
| 레거시 보존 | `handlers.test.ts` · `swiftParity.test.ts` | 기존 `/api/v1` 계약이 그대로다 |

`cd next && npm test` — CI의 Next 잡이 돈다(PGlite는 Linux 러너에서도 그대로).
