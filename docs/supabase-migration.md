# Supabase → 독립 Backend 이관

목표는 Supabase를 즉시 없애는 것이 아니다. **현재 서비스를 깨뜨리지 않으면서** Supabase 의존을 기능 단위로 하나씩 걷어내고,
PostgreSQL + 독립 Auth + TripCanvas API 중심의 자체 Backend로 옮기는 것이다(Strangler). 최종 목표 구조와 계층 규칙은
`docs/backend-architecture.md`, NAS 배포는 `docs/nas-deployment.md`, 백업은 `docs/backup-restore.md`.

기준 문장: **Domain은 TripCanvas의 것이다. Infrastructure는 교체 가능해야 한다.**

## 이관 레지스트리 (현재 상태)

도메인별 source of truth. 환경변수 `TC_MIGRATION_<DOMAIN>`으로 바꾼다(`next/src/server/config/migrationRegistry.ts`). `DATABASE_URL`이 없으면 전부 `LEGACY`다.

| 도메인 | 상태 | 비고 |
|---|---|---|
| AUTH | LEGACY | Supabase Auth 토큰을 새 API가 **직접 검증**한다(Phase A). 로그인 UI·토큰 발급은 그대로 Supabase |
| TRIP | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | 목록·상세·생성·수정(CAS)·삭제(tombstone)가 새 Repository로 준비됨. `TC_MIGRATION_TRIP`으로 전환·롤백 |
| ITINERARY (Day·Spot) | LEGACY | 여행 문서(jsonb) 안에 있어 TRIP과 함께 움직인다 |
| BOOKING | LEGACY | 문서 안(`trip.bookings`) + `hotel_price_snapshots` |
| PRICING | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | `/api/v1` 가격 관측 읽기(`listPriceObservations`)는 새 Repository 준비됨(`TC_MIGRATION_PRICING`). **크론(`api/track-hotel-prices.js`, service_role)과 웹의 직접 insert는 아직 Supabase** — 관측을 쓰는 쪽이 옮겨 오기 전까지 새 DB는 이관된 과거 관측만 갖는다 |
| ADAPTIVE (Today·Suggestion·Replan) | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | 판단은 이미 `/api/v1`(adaptive.js). 저장(`suggestion_feedback`·`notification_log`·`device_tokens`·`trip_memories`)이 새 Repository로 준비됨(`TC_MIGRATION_ADAPTIVE`). DUAL_READ는 거절·알림 키의 **합집합**(잃으면 같은 알림이 두 번 간다) |
| COLLAB | LEGACY | 웹이 RPC 16종을 직접 부른다 |
| REALTIME | LEGACY | `trip_activity` INSERT 구독(웹만) |
| STORAGE | — | **쓰지 않는다**(사진 원본은 기기에만) |

## Phase 0 — Supabase 사용 인벤토리 (2026-09-03)

### 요약

| 구분 | 레거시 웹(`app.js` 등) | Next 워크스페이스 | iOS | 합계 |
|---|---|---|---|---|
| Auth 호출 | 4 | 4 | GoTrue REST 2종(password·refresh_token) | 8 + iOS |
| 테이블 직접 조회 | 7 | 24 | **0** | 31 (7개 테이블) |
| RPC 호출 지점 | 23 | 3 | **0** | 26 (19개 함수) |
| Realtime 채널 | 1 | 0 | 0 | 1 |
| Storage | 0 | 0 | 0 | **0** |
| 클라이언트 생성 | 1 (`app.js:3464`) | 2 (브라우저 싱글턴 · 서버 요청별) | 0 (SDK 없음) | 3 |
| service_role 사용 | `api/track-hotel-prices.js` (REST 4회) | 레거시 핸들러 재사용 | 0 | 1 파일 |

**iOS는 이미 API 전용이다.** Swift Supabase SDK가 없고(`ios/project.yml`에 패키지 0), Supabase는 `AuthStore.swift`의 GoTrue
`POST /auth/v1/token`(`password`·`refresh_token`)으로만 쓴다. 데이터는 전부 `/api/v1` 9개 엔드포인트(`Services/TripService.swift`).
토큰은 기기 전용 Keychain(`supabase.session`), 위젯·워치·공유 확장은 자격증명 없이 App Group 스냅샷만 읽는다.
→ iOS 이관은 **Phase 8(Auth 교체)에서 로그인 엔드포인트만 바꾸면 끝난다.** 하드코딩된 값은 `AppEnvironment.swift:12,18,23`(API URL·Supabase URL·publishable 키).

### Auth (8)

| 위치 | 호출 |
|---|---|
| `app.js:3465` | `sb.auth.onAuthStateChange` — 계정이 바뀔 때만 `syncOnLogin` |
| `app.js:3681` / `:3698` / `:3706` | `signOut` · `signInWithPassword` · `signUp` |
| `next/src/features/cloud/hooks/useCloudAuth.ts:33,48,54` | `onAuthStateChange` · `signInWithPassword` · `signOut` |
| `next/src/features/trip-state/services/supabaseGateway.ts:34` | `sb.auth.getUser()` — **서버의 bearer 검증**(→ Phase A에서 JWT 직접 검증으로 대체) |

세션은 SDK가 `localStorage`의 `sb-gdnhrwtfidjimtabgovh-auth-token`에 둔다. 동기화 메타는 `tripcanvas_sync_v2`(레거시·Next 공용) · `tripcanvas_synced`(v1) · `tripcanvas_join_v1`(초대 대기).

### 테이블 직접 조회 (31, 테이블 7)

| 테이블 | 위치 | 연산 |
|---|---|---|
| `trips` | `app.js:3652`, `:3761` · `cloudSync.ts:199` · `supabaseGateway.ts:63`, `:78` | select만 (쓰기는 전부 RPC) |
| `trip_snapshots` | `app.js:3555,3557,3559,3567,3578` · `tripSnapshots.ts:23,36,40,47,58` | insert · select · delete (버전 이력 15개 유지) |
| `hotel_price_snapshots` | `app.js:2247`(insert), `:2259` · `priceCloud.ts:24` · `supabaseGateway.ts:117` | insert · select |
| `suggestion_feedback` | `supabaseGateway.ts:106`, `:197` | select · upsert |
| `notification_log` | `supabaseGateway.ts:132`, `:143` | select · upsert(ignoreDuplicates) |
| `device_tokens` | `supabaseGateway.ts:153`, `:192` | upsert · delete |
| `trip_memories` | `supabaseGateway.ts:166`, `:179`, `:184` | select · insert (client_key 멱등) |

### RPC (26 지점, 19 함수)

| 함수 | 호출 위치 |
|---|---|
| `sync_trip` | `app.js:3514` · `cloudSync.ts:76` · `supabaseGateway.ts:92` |
| `tombstone_trip` | `app.js:3597` · `cloudSync.ts:139` |
| `my_trip_roles` | `app.js:3722` · `supabaseGateway.ts:41` |
| `list_trip_members` · `manage_trip_member` · `leave_trip` | `app.js:3823` · `:3854` · `:4428` |
| `create_trip_invite` · `list_trip_invites` · `revoke_trip_invite` · `invite_preview`(anon 가능) · `accept_trip_invite` | `app.js:3884` · `:3863` · `:3873` · `:4468,4495` · `:4504` |
| `list_trip_candidates` · `add_trip_candidate` · `react_to_candidate` · `manage_trip_candidate` | `app.js:3940` · `:4227` · `:4245` · `:4273,4341` |
| `list_candidate_comments` · `add_candidate_comment` · `delete_candidate_comment` | `app.js:4122` · `:4131` · `:4143` |
| `list_trip_activity` · `list_trip_preferences` · `set_trip_preference` | `app.js:4158,4212` · `:4355` · `:4402` |

함께하기 RPC 16종은 **레거시 웹만** 부른다. Next는 `sync_trip`·`tombstone_trip`·`my_trip_roles`뿐.

### Realtime (1)

`app.js:4185` — `sb.channel('trip-activity-<id>').on('postgres_changes', {event:'INSERT', table:'trip_activity', filter:'trip_id=eq.<id>'})`.
payload는 신호로만 쓰고 내용은 `list_trip_activity`로 다시 읽는다(400ms 디바운스). 퍼블리케이션에는 `trip_activity`만 실려 있다.

### Storage (0)

없다. `trip_memories.asset_refs`는 iOS PhotosPicker 식별자뿐이다. → Phase 7(MinIO)은 **새 기능이 생기기 전까지 필요 없다**.

### Vercel 함수

`api/track-hotel-prices.js:65-70` — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`로 PostgREST를 직접 호출(RLS 우회). 모든 사용자의 `trips`를 읽고 `hotel_price_snapshots`를 대신 쓴다. 문지기는 `CRON_SECRET` 하나. 저장소에서 유일한 service_role 경로.

### DB 스키마 (마이그레이션 10개)

| 테이블 | 만든 곳 | 핵심 제약 |
|---|---|---|
| `trips` | `202608190001` | `unique(user_id, client_id)` · `revision > 0` · `deleted_at` tombstone. **운영 `id`는 uuid**(저장소 파일은 bigint) |
| `trip_snapshots` | `202608190001` | 소유자 전용 |
| `hotel_price_snapshots` | `202608250001` | append-only, `auth.uid()` 기본값 없음(크론이 대신 씀) |
| `suggestion_feedback` | `202608310001` | `unique(user_id, trip_client_id, day_iso, suggestion_key)` |
| `device_tokens` · `notification_log` | `202608310002` | `unique(user_id, device_id)` · `unique(user_id, dedupe_key)` |
| `trip_memories` | `202608310003` | `unique(user_id, client_key)` |
| `trip_members` · `trip_invites` | `202609020001` | `unique(trip_id, user_id)` · `token_hash unique`(원문 없음) · `prefs`(0004) |
| `trip_candidates` · `candidate_reactions` | `202609020002` | `unique(candidate_id, user_id)` |
| `trip_comments` · `trip_activity` | `202609020003` | 활동은 트리거가 쓴다 · realtime 퍼블리케이션 |

⚠️ 운영에는 `202608310001~3`이 **적용돼 있지 않다**(2026-09-02 확인).

Supabase 전용 의존:

| 의존 | 어디에 | 대체 계획 |
|---|---|---|
| `auth.uid()` | 10개 파일 전부 — 컬럼 기본값 · 정책 · 함수 본문 | 새 DB에는 없다. **호출자는 API가 알고**(`RequestContext.userId`) Repository가 명시적으로 넣는다 |
| `auth.users` FK | 모든 `user_id` 컬럼 | 자체 `users` 테이블. **id는 Supabase user id를 그대로 보존** — 외래키·소유권이 안 깨진다 |
| RLS 정책 (트리거 `tc_trips_lock_owner` 포함) | `trips` · 멤버 · 후보 · 코멘트 · 활동 · 취향 | 새 DB는 RLS를 켜지 않는다. 같은 규칙을 `TripAuthorizationService`(application)가 판정하고 테스트가 OWNER/EDITOR/VIEWER/비멤버/내보내진 멤버를 각 API에서 검증한다 |
| security definer RPC 21종 (오류 42501·22023 + hint) | `202609020001~5` | Application Service + Repository 트랜잭션. 오류는 `FORBIDDEN`·`VALIDATION_ERROR`로 매핑 |
| `supabase_realtime` 퍼블리케이션 | `202609020003:297` | Phase 6 — 커밋 후 이벤트 발행 → WebSocket. 페이로드는 id·종류·version만 |
| `extensions.pgcrypto` (`gen_random_bytes`·`digest`) | 초대 토큰 | Node `crypto`에서 만들고 해시만 저장(같은 sha256 hex) |
| `anon` · `authenticated` 역할 | grant/revoke 전부 | 새 DB에는 앱 역할 하나. `invite_preview`의 anon 허용은 API에서 인증 없는 라우트로 |
| `auth.jwt()` · `auth.role()` · `storage.*` | — | 쓰지 않는다 |

테스트 대역: `test/rls/supabase-stub.sql`이 `anon`·`authenticated`·`auth.users`·`auth.uid()`(`request.jwt.claims`의 sub)·pgcrypto를 흉내 내고,
`test/rls.integration.test.js`가 로컬 PostgreSQL(`TC_PSQL`·`TC_PGHOST`·`TC_PGPORT`)에 bigint·uuid 두 모양으로 마이그레이션을 두 번 적용해 약 120개 기대값을 판정한다.

## 단계 계획

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 인벤토리 (위) | ✅ |
| 1 | Backend foundation — PostgreSQL 스키마 · Drizzle · Repository · 요청 컨텍스트 · 오류 계약 · health | ✅ PR1 (`7fa65d4`) |
| 2 | Supabase JWT 검증 · 인가 서비스 | ✅ PR2 (`5aa853a`) |
| 3 | Trip API (목록·상세·생성·수정·삭제) — 레지스트리로 분기 | ✅ PR3 (`bfe6cba`) — Day·Spot·예약 문서는 여행 문서 안이라 함께. **데이터 이관 전이라 프로덕션은 LEGACY** |
| 4 | Adaptive 저장소(제안 거절·알림·기기·기록) · Pricing 관측 Repository | ✅ PR5·PR6 — 기존 핸들러의 Gateway를 `composeGateway`가 레지스트리로 조립. 크론의 service_role 쓰기는 남아 있다(아래) |
| 5 | Collaboration (멤버·초대·후보·반응·코멘트·제안·활동) API | PR7 |
| 6 | Realtime WebSocket | PR8 |
| 7 | Storage (MinIO) — **현재 쓰는 곳이 없어 새 기능 전까지 보류** | PR9 |
| 8 | 새 Auth (가입·인증메일·세션·재설정) · 기존 사용자 이관 · 웹/iOS 전환 | PR10·PR11 |
| 9 | 웹 Supabase 클라이언트 제거 · iOS GoTrue 호출 제거 | PR12·PR13 |
| 10 | 데이터 이관 리허설 · NAS 프로덕션 · 롤백 테스트 · Supabase read-only → 종료 | PR14 |

## 지금 할 수 있는 것 / 아직 못 하는 것

- 새 API(`POST /api/v1/trips` · `GET/PUT/DELETE /api/v1/trips/:id`)는 레지스트리가 `LEGACY`여도 동작한다 — Supabase를 같은 Repository 계약으로 감쌌기 때문이다. 웹·iOS가 `sync_trip` 대신 이 API로 옮겨 탈 수 있다(PR12·PR13의 준비).
- Supabase 토큰은 서버가 직접 검증한다. 로컬 검증이 실패하면 예전처럼 `getUser`로 확인하고 **경고 로그**를 남긴다 — 그 로그가 보이면 프로젝트가 HS256이므로 `SUPABASE_JWT_SECRET`을 넣는다.
- 가격 크론 `api/track-hotel-prices.js`는 모든 사용자의 여행을 읽어 관측을 쓰는 **시스템 작업**이라 사용자 토큰 모델에 맞지 않는다. 새 backend로 옮길 때는 서비스 계정 경로(내부 전용 라우트 + `CRON_SECRET`)로 다시 만든다 — Phase 10 전에.
- `NEW_BACKEND`·`DUAL_READ`는 코드·테스트가 있지만 **데이터 이관 스크립트가 아직 없다**(Phase 10). staging에서 빈 DB로 먼저 돌려 본다.
- 미검증: `next/Dockerfile`·`deploy/docker-compose.yml`(작성 환경에 Docker 없음), 실제 PostgreSQL 서버(테스트는 PGlite), 실제 Supabase JWKS 응답(테스트는 로컬 키).

## 롤백

각 도메인은 환경변수 하나로 돌아간다(`TC_MIGRATION_TRIP=LEGACY`). 새 PostgreSQL에 쓴 뒤 레거시로 돌아가면 그 사이 변경은 Supabase에 없다 —
그래서 `NEW_BACKEND` 전환은 **데이터 이관 직후, 검증 스크립트가 통과한 뒤**에만 한다(Phase 10). `DUAL_READ`는 이관 기간에만 쓴다.
