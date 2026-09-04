# Supabase → 독립 Backend 이관

목표는 Supabase를 즉시 없애는 것이 아니다. **현재 서비스를 깨뜨리지 않으면서** Supabase 의존을 기능 단위로 하나씩 걷어내고,
PostgreSQL + 독립 Auth + TripCanvas API 중심의 자체 Backend로 옮기는 것이다(Strangler). 최종 목표 구조와 계층 규칙은
`docs/backend-architecture.md`, NAS 배포는 `docs/nas-deployment.md`, 백업은 `docs/backup-restore.md`.

기준 문장: **Domain은 TripCanvas의 것이다. Infrastructure는 교체 가능해야 한다.**

## 이관 레지스트리 (현재 상태)

도메인별 source of truth. 환경변수 `TC_MIGRATION_<DOMAIN>`으로 바꾼다(`next/src/server/config/migrationRegistry.ts`). `DATABASE_URL`이 없으면 전부 `LEGACY`다.

| 도메인 | 상태 | 비고 |
|---|---|---|
| AUTH | LEGACY (자체 Auth 준비됨) | Supabase 토큰을 새 API가 **직접 검증**한다(Phase A). 자체 Auth(better-auth)가 `/api/auth/*`에 올라가 있고 두 토큰이 함께 통한다 — `AUTH_SECRET`이 없으면 꺼진 채다. 로그인 화면 전환은 PR11 |
| TRIP | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | 목록·상세·생성·수정(CAS)·삭제(tombstone)가 새 Repository로 준비됨. `TC_MIGRATION_TRIP`으로 전환·롤백 |
| ITINERARY (Day·Spot) | LEGACY | 여행 문서(jsonb) 안에 있어 TRIP과 함께 움직인다 |
| BOOKING | LEGACY | 문서 안(`trip.bookings`) + `hotel_price_snapshots` |
| PRICING | **NEW_BACKEND** (2026-09-04) | 읽기·쓰기 모두 `/api/v1/trips/:id/prices`. 웹의 Supabase 직접 경로는 없어졌다. ⚠️ 크론(`api/track-hotel-prices.js`)은 **스케줄을 껐다** — Supabase의 `trips`를 읽고 그쪽에 쓰던 것이라, 서비스 계정 경로로 다시 만들기 전까지는 앱의 하루 1회 확인이 대신한다 |
| ADAPTIVE (Today·Suggestion·Replan) | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | 판단은 이미 `/api/v1`(adaptive.js). 저장(`suggestion_feedback`·`notification_log`·`device_tokens`·`trip_memories`)이 새 Repository로 준비됨(`TC_MIGRATION_ADAPTIVE`). DUAL_READ는 거절·알림 키의 **합집합**(잃으면 같은 알림이 두 번 간다) |
| COLLAB | LEGACY (→ `NEW_BACKEND` 가능) | 협업 API 20개 라우트. LEGACY면 같은 라우트가 Supabase RPC 어댑터로 돈다(판정은 RPC). **웹은 이제 API를 지난다**(PR12) — Supabase RPC 직접 호출 없음 |
| REALTIME | LEGACY (→ `NEW_BACKEND` 가능) | 자체 WebSocket 사이드카 준비됨(아래). 새 DB가 진실일 때만 의미가 있다 — 협업이 LEGACY면 새 DB에 활동 행이 안 쌓인다. 웹은 아직 Supabase Realtime을 쓴다(PR12) |
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
| 5 | Collaboration (멤버·초대·후보·반응·코멘트·제안·활동) API | ✅ PR7 — 새 DB 5 테이블 + `CollabService`(RPC 21종의 판정을 application으로) + 라우트 14 파일 + 레거시 RPC 어댑터. 활동 기록은 트리거 대신 Repository가 같은 트랜잭션에서. 그룹 제안(`buildGroupProposal`)은 순수 미리보기라 클라이언트에 그대로 남는다 |
| 6 | Realtime WebSocket | ✅ PR8 — 트리거 pg_notify → LISTEN → 허브 → 구독자. 서버 완성, 웹 전환은 PR12 |
| 7 | Storage (MinIO) — **현재 쓰는 곳이 없어 새 기능 전까지 보류** | PR9 |
| 8 | 새 Auth (가입·인증메일·세션·재설정) · 기존 사용자 이관 · 웹/iOS 전환 | ✅ PR10(기반) — 아래. 기존 사용자 이관·웹/iOS 전환은 PR11 |
| 9 | 웹 Supabase 클라이언트 제거 · iOS GoTrue 호출 제거 | 🔸 PR12 — 웹의 **데이터 접근이 전부 API를 지난다**(동기화·함께하기·버전 이력·역할). 남은 것: 로그인·가격 관측·Supabase 실시간 폴백 |
| 10 | 데이터 이관 리허설 · NAS 프로덕션 · 롤백 테스트 · Supabase read-only → 종료 | PR14 — **R0 완료**(이관·검증 스크립트 + 21개 테스트, CI에서 매번). R1·R2는 접속 정보가 있는 환경에서. **리허설 방식 확정**: `pg_dump` 직접 추출 · 전환 시 전면 중단(증분 동기화 없음) · R0/R1/R2 3단계. 절차는 `docs/backup-restore.md` |

## 협업 API (PR7)

| 라우트 | RPC 대응 |
|---|---|
| `GET /api/v1/trips/:id/members` · `PATCH …/members/:memberId {action,value}` · `POST …/members/leave` | `list_trip_members` · `manage_trip_member` · `leave_trip` |
| `GET/PUT /api/v1/trips/:id/preferences` | `list_trip_preferences` · `set_trip_preference` |
| `GET/POST /api/v1/trips/:id/invites` · `DELETE …/invites/:inviteId` | `list_trip_invites` · `create_trip_invite` · `revoke_trip_invite` |
| `GET /api/v1/invites/:token`(익명 가능) · `POST /api/v1/invites/:token/accept` | `invite_preview` · `accept_trip_invite` |
| `GET/POST /api/v1/trips/:id/candidates` · `PATCH …/candidates/:cid {action,value}` · `PUT …/candidates/:cid/reaction` | `list_trip_candidates` · `add_trip_candidate` · `manage_trip_candidate` · `react_to_candidate` |
| `GET/POST …/candidates/:cid/comments` · `DELETE …/comments/:commentId` | `list_candidate_comments` · `add_candidate_comment` · `delete_candidate_comment` |
| `GET /api/v1/trips/:id/activity?limit=` | `list_trip_activity` |

응답 모양은 RPC 반환형(snake_case)과 같다 — 웹이 옮겨 탈 때 화면 코드가 바뀌지 않게. 차이 하나: 새 backend는 남의 여행을 **NOT_FOUND**로 답하고, 레거시 어댑터는 RPC 그대로(빈 목록 또는 42501→FORBIDDEN).

## 실시간 (PR8)

```
trip_activity INSERT → 트리거 pg_notify(커밋 시점) → LISTEN(전용 연결) → 허브 → 구독자
```

Supabase Realtime을 대신한다. **PostgreSQL이 진실이고 소켓은 알림 채널일 뿐이다**(§45) — 사이드카가 죽어도 앱은 그대로 돌고, 클라이언트는 탭 복귀·패널 열기에 API로 다시 읽는 폴백을 그대로 쓴다.

| | |
|---|---|
| 주소 | `wss://<API_DOMAIN>/ws` (Caddy가 `realtime:3001`로 넘긴다) |
| 인증 | 접속 후 **첫 프레임** `{"type":"AUTH","token":"<bearer>"}`. 쿼리스트링에 토큰을 싣지 않는다(프록시·접근 로그에 남는다). 제한 시간 10초 |
| 구독 | `{"type":"SUBSCRIBE","tripId":"<client_id>"}` — **서버가 멤버십을 확인한 뒤에만** 열린다(§41). 아니면 `FORBIDDEN` |
| 받는 것 | `{"type":"ACTIVITY","tripId","id","kind","mine"}` — 이게 전부다(§44). 내용은 API로 다시 읽는다 |
| 수명 | 토큰이 만료되면 끊는다(4440). PING에 PONG이 없으면 끊는다(4408). 닫힘 코드: 4401 인증 실패 · 4408 시간 초과 · 4440 토큰 만료 |
| 헬스 | `GET /health` — LISTEN이 붙어 있지 않으면 **503**이다(끊긴 채 조용히 살아 있지 않게) |

트리거 페이로드에는 제목·본문·문서가 없고, `actorId`는 서버 안에서만 쓴다 — 구독자마다 `mine`을 계산해 붙이고 다른 사람의 user id는 내보내지 않는다.

## 자체 Auth (PR10)

라이브러리는 **better-auth 1.7.2**다. 비밀번호 해시·세션 토큰·인증/재설정 토큰을 직접 설계하지 않는다(§18) — 우리는 정책만 정한다.

| | |
|---|---|
| 경로 | `/api/auth/*` (가입·확인·로그인·로그아웃·세션·재설정). `AUTH_SECRET`+`DATABASE_URL`이 없으면 **404** |
| 세션 | 웹은 쿠키, iOS는 `Authorization: Bearer <세션 토큰>`(bearer 플러그인) — 같은 세션이다(§70) |
| 이메일 확인 | 가입 시 발송, **확인 전에는 로그인 불가**. 링크는 `/api/auth/verify-email` |
| 비밀번호 재설정 | `POST /api/auth/request-password-reset` → 메일 → `/api/auth/reset-password/:token` |
| rate limit | DB 저장소(`auth_rate_limit`) — 재시작에도 유지된다(§66) |
| 메일 쿨다운 | (이메일, 종류)당 60초. 건너뛸 때 **오류를 내지 않는다** — 가입 여부를 밖에서 알아낼 통로가 되면 안 된다(§67) |
| 메일 | 외부 SMTP(§21). 설정이 없으면 링크가 서버 로그로 떨어진다 — 조용히 삼키지 않는다 |

### 계정 연결이 이관의 핵심이다 (§13·§19)

`users`(도메인)와 `auth_user`(라이브러리)는 **분리**돼 있고 `users.auth_user_id`로 이어진다.

- `users.id`는 **Supabase user id 그대로**다. 그래서 `trips.user_id`·`trip_members.user_id`·후보·코멘트·기록의 참조가 하나도 안 깨진다.
- 기존 사용자는 **같은 이메일로 가입해 이메일을 확인하면** 예전 사용자 행에 이어지고 여행이 그대로 따라온다.
- ⚠️ 이어 주는 조건은 **확인된 이메일뿐**이다. 확인 전에 이어 주면 남의 이메일로 가입해 그 사람의 여행을 가져가는 계정 탈취가 된다. `identity.ts`와 better-auth 양쪽에서 막는다.
- 비밀번호 해시는 옮기지 않는다(§19) — Supabase의 해시에 접근할 수 없고 위험한 변환을 하지 않는다. 기존 사용자는 확인 메일 또는 재설정으로 새 비밀번호를 정한다.

### 남은 것

- iOS의 로그인 화면은 그대로 Supabase다. 전환은 PR13.

## 웹 로그인 전환 (PR11)

웹의 로그인이 `auth.js` 하나를 지난다. Supabase Auth와 자체 Auth를 **같은 모양**으로 감싸므로 app.js는 어느 쪽인지 모른다.

**어느 Auth를 쓸지는 서버가 정한다.** `GET /api/v1/auth-config`(토큰 없이, `no-store`)가 `provider`를 준다 —
`AUTH_SECRET`·`DATABASE_URL`이 있어 자체 Auth 인스턴스가 실제로 조립됐을 때만 `TRIPCANVAS`다.
웹이 고르게 두면, 서버에 자체 Auth가 꺼져 있는데 웹만 그쪽으로 로그인하려다 **아무 데도 못 들어가는** 상태가 된다(실시간 제공자를 서버가 정하는 것과 같은 이유).
응답을 못 받으면 `SUPABASE`로 남는다 — 옛 배포·오프라인에서 오늘의 동작이 이어진다.

**그래서 이 커밋만으로는 아무것도 바뀌지 않는다.** 운영에는 `AUTH_SECRET`이 없으므로 `provider`는 `SUPABASE`고,
로그인 경로는 예전 그대로다. 켜는 것은 환경변수를 넣는 별도의 결정이다.

### 예전 사용자가 들어오는 길 (§19)

비밀번호 해시는 **옮기지 않는다.** 자체 Auth로 넘어가면 기존 3명은 비밀번호가 없다.

```
로그인 시도 → INVALID_CREDENTIALS → "예전 계정이면 비밀번호를 새로 정해줘" + [비밀번호 재설정]
→ 메일의 링크로 새 비밀번호 → 이메일이 확인됨 → resolveDomainUser가 users 행에 연결 → 여행 그대로
```

- 실패를 "틀렸다"로만 끝내면 그 사람은 영영 못 들어온다. 그래서 `showAuthError`가 재설정 안내를 함께 연다.
- **계정이 있는지 알려주지 않는다.** 재설정 요청은 이메일이 있든 없든, 네트워크가 끊겨도 같은 답이다 — 계정 유무를 떠보는 데 쓰이지 않게.
- 이어 붙이는 판정은 서버(`server/auth/identity.ts`)가 하고, **확인된 이메일로만** 잇는다.

### 세션은 bearer다 — 쿠키가 아니다

정적 웹(`tripcanvas-ai`)과 API(`tripcanvas-api`)가 다른 출처라, 쿠키를 쓰려면 `Allow-Credentials`를 켜야 한다.
켜지 않기로 했으므로(§72의 판단) 웹도 iOS와 같이 bearer 토큰을 쓴다 — `set-auth-token` 헤더로 받아 `tripcanvas_auth_v1`에 둔다.
Supabase JS도 지금 localStorage에 토큰을 두므로 이 점은 달라지지 않는다. CSRF(§71)는 쿠키를 쓰지 않아 해당 사항이 없다.

- 네트워크 오류로는 토큰을 버리지 않는다 — 오프라인에서 로그아웃당하지 않게. 죽은 토큰(401)만 지운다.
- 로그아웃은 로컬 세션을 **먼저** 지운다 — 서버 호출이 실패해도 이 기기에서는 끝나야 한다.
- 제공자를 정하면(`use`) 들고 있던 세션은 버린다 — 다른 Auth의 사용자를 이어서 들고 있으면 로그인한 것처럼 보이면서 아무것도 못 한다.

### 메일 발송은 확인됐다 (2026-09-04)

`npm run mail:test`로 **실제로 보내고 받은편지함에 도착하는 것**까지 확인했다(스팸함 아님). 발신은 Gmail 앱 비밀번호다 —
도메인이 없어 `no-reply@…`를 쓸 수 없기 때문이고, 사용자 3명 규모에는 충분하다. 도메인이 생기면 `SMTP_*` 네 줄만 바꾸면 되고 코드는 그대로다.

```
SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
SMTP_USER=<계정>          SMTP_PASSWORD=<앱 비밀번호 16자, Google 계정에서 발급>
MAIL_FROM=Trip Canvas <같은 계정>      # Gmail은 SMTP_USER와 다른 발신자를 거절한다
```

⚠️ **`API_BASE_URL`을 함께 넣어야 한다.** 없으면 기본값 `http://localhost:3000`이 쓰여 **메일 속 링크가 localhost가 된다**(`config/env.ts`).
자체 Auth를 켤 때 `AUTH_SECRET`·`SMTP_*`와 **한 묶음**으로 넣는다.

### 실시간 사이드카도 자체 Auth 세션을 받는다

`AUTH_SECRET`을 넣는 순간 웹·iOS는 better-auth 세션 토큰을 들고 온다. 사이드카가 그걸 모르면 **Auth를 넘기는 순간 실시간이 통째로 끊긴다** —
로그인·저장은 되는데 알림만 안 오는, 원인을 찾기 어려운 고장이다.

better-auth는 ESM 전용이고 사이드카는 CommonJS로 컴파일된다(`tsconfig.tools.json`). 그래서 라이브러리를 끌어오는 대신
**같은 세션을 DB로 판정한다**(`auth/sessionTokenVerifier.ts`). 사이드카가 알아야 할 것은 "이 토큰이 살아 있는 세션인가, 누구의 것인가"뿐이고,
그건 저장소 질문이지 Auth 라이브러리 질문이 아니다.

```
bearer = <token>.<base64(HMAC-SHA256(AUTH_SECRET, token))>
auth_session.token 에는 **서명 없는 token만** 들어 있다
```

- 서명도 확인한다. 확인하지 않아도 DB 조회만으로 인증 강도는 같지만(토큰 자체가 비밀이다), 그러면 사이드카가 **API보다 무른 문**이 된다.
- 이메일 미확인·만료·로그아웃된 세션은 API와 **같은 규칙**으로 거절한다. `resolveDomainUser`를 그대로 쓴다.
- ⚠️ 이 토큰 모양은 better-auth가 정한 것이지 우리가 설계한 것이 아니다(§18). 라이브러리가 바꾸면 사이드카가 조용히 전원을 막게 되므로,
  **진짜 better-auth로 세션을 만들어** 이 검증기가 그것을 받아들이는지 확인하는 파리티 테스트가 가정을 붙들고 있다.
- ⚠️ API와 사이드카는 **같은 `AUTH_SECRET`**을 써야 한다. 다르면 모든 서명이 어긋나 아무도 실시간에 못 붙는다. 켜는 조건도 같다(`newAuthEnabled`).

## 웹의 Supabase 제거 (PR12)

정적 웹이 **함께하기와 버전 이력**을 TripCanvas API로 부른다. 서버 레지스트리가 `LEGACY`면 API가 다시 Supabase를 부르므로
데이터는 그대로 있고 앞단만 바뀌었다 — 이것이 Strangler의 실제 모습이다.

| | |
|---|---|
| 여행 동기화 | `GET /api/v1/sync/trips`(문서·tombstone 포함) · `PUT/POST/DELETE /trips`. `TC_API.sync`가 예전 `sync_trip`/`tombstone_trip`의 반환 모양으로 옮긴다 |
| 역할·실시간 | `GET /api/v1/me` — 역할·인원(`my_trip_roles` 대체)과 **어느 실시간을 쓸지**를 한 번에 준다 |
| 클라이언트 | `api.js`(`TC_API`) — `{data,error}`를 돌려주고 **예외를 던지지 않는다**. 호출부의 모양을 바꾸지 않으려는 설계다 |
| 오류 | 서버의 `FORBIDDEN`을 Supabase가 주던 `42501`/403으로 옮긴다 — `collab.js`의 `isForbiddenError`와 '재시도하지 않는다' 규칙이 그대로 동작한다 |
| 토큰 | Supabase 세션의 access token을 그대로 싣는다(서버가 직접 검증, Phase A). **초대 미리보기만 토큰 없이** 나간다(§6) |
| 주소 | `API_BASE` — 운영은 **`bokbok9.tail8b977f.ts.net`(NAS, 2026-09-04 전환)**, localhost는 `:3000`, 테스트는 `window.__TC_API_BASE` |
| CORS | 두 프로젝트가 다른 출처라 필요하다. `TRUSTED_ORIGINS`에 있는 출처만 허용하고 `*`를 쓰지 않는다(§72, `next/src/proxy.ts`) |

### 실시간은 서버가 고른다

협업 데이터가 아직 Supabase에 있으면 자체 사이드카에는 **보낼 이벤트가 없다**(트리거가 새 DB에만 있다).
클라이언트가 스스로 고르면 "실시간이라 표시해 놓고 아무것도 안 오는" 상태가 되므로, 레지스트리를 아는 서버가 정한다.

| `/me`의 realtime | 웹이 하는 일 |
|---|---|
| `SUPABASE` (COLLAB=LEGACY) | 예전 그대로 Supabase 채널. 이때만 `supabaseTripId`(내부 trips.id)를 함께 받는다 |
| `TRIPCANVAS` (COLLAB≠LEGACY + `REALTIME_URL`) | 자체 WebSocket에 붙어 **client_id로 구독**한다 — 내부 id가 필요 없다 |
| `NONE` (주소 없음) | 실시간 없이 "새로고침으로 갱신". 켜진 척하지 않는다 |

`mine`은 자체 실시간에서는 **서버가 구독자마다 계산해** 붙인다(남의 user id를 내보내지 않는다). Supabase 채널은 행을 통째로 주므로 클라이언트가 판정한다.

### 동기화는 웹의 CAS 로직을 한 줄도 바꾸지 않았다

`sync_trip`/`tombstone_trip`은 `{applied, conflict, revision, data, deleted_at}`을 준다. 이 앱에서 가장 위험한 코드(충돌 보존·base revision 유지)가 그 모양에 기대고 있어, **번역을 `api.js`에 두고 `app.js`는 그대로 뒀다.**

- 충돌은 오류가 아니라 CAS의 정상 결과다 — 서버가 409(`STALE_VERSION`/`CONFLICT`)에 **현재 문서와 deletedAt**을 실어 주면 어댑터가 행으로 바꾼다. 충돌 카드가 원격본을 보여줘야 하기 때문이다.
- 권한 오류(403)와 그 밖의 실패는 **던진다** — 호출부가 forbidden으로 멈추거나 재시도한다.
- 처음 올리는 여행(revision 없음)과 서버에 없는 여행(404)은 새로 만든다 — 예전 RPC의 upsert와 같다.
- 삭제는 서버에 없어도 성공이다(멱등).
- `GET /api/v1/sync/trips`는 `/trips`(요약)와 달리 **문서 전체와 tombstone**을 준다 — 다른 기기가 지운 여행을 병합해야 한다.

**아직 Supabase에 남은 것**과 이유:

- **로그인·세션** — 자체 Auth 전환은 PR11이다
- ~~**가격 관측**~~ — 옮겼다(2026-09-04, `/api/v1/trips/:id/prices`). 이제 웹에 Supabase 직접 호출은 없다

## 지금 할 수 있는 것 / 아직 못 하는 것

- 새 API(`POST /api/v1/trips` · `GET/PUT/DELETE /api/v1/trips/:id`)는 레지스트리가 `LEGACY`여도 동작한다 — Supabase를 같은 Repository 계약으로 감쌌기 때문이다. 웹·iOS가 `sync_trip` 대신 이 API로 옮겨 탈 수 있다(PR12·PR13의 준비).
- Supabase 토큰은 서버가 직접 검증한다. 로컬 검증이 실패하면 예전처럼 `getUser`로 확인하고 **경고 로그**를 남긴다 — 그 로그가 보이면 프로젝트가 HS256이므로 `SUPABASE_JWT_SECRET`을 넣는다.
- `trip_snapshots`(여행 버전 이력)를 새 DB에 채웠다 — `/api/v1/trips/:id/snapshots`. 이관 대상에도 들어 있다.
- 가격 크론 `api/track-hotel-prices.js`는 모든 사용자의 여행을 읽어 관측을 쓰는 **시스템 작업**이라 사용자 토큰 모델에 맞지 않는다. 전환하며 **스케줄을 껐고**(`vercel.json`), 새 backend에 서비스 계정 경로(내부 전용 라우트 + `CRON_SECRET`)로 다시 만든다. 그때까지 서버 쪽 자동 추적은 없다 — 앱의 하루 1회 확인만 돈다.
- 데이터 이관은 **R1·R2를 모두 통과했다**(2026-09-04). R1은 실데이터 예행(NAS PostgreSQL 17, 183행, 1초, 개수·고아·내용 일치), R2는 덤프 복원 경로에 이어 **staging 앱 검증까지**(로그인·저장·협업·롤백 — NAS + 컨테이너 Chromium 14/14). 절차와 결과는 `docs/staging-verification.md`, 추출·복원과 Synology 함정은 `docs/backup-restore.md`.
- R2가 실제로 잡아낸 사고 하나: 이관기가 **낡은 사본을 원본으로 읽었는데 검증이 통과했다**(검증은 원본·대상이 같은지만 본다). 이제 시작할 때 `[migration] 원본 <계정@호스트/DB> → 대상 …`을 찍는다 — 전환 당일 그 줄부터 읽는다.
- **전환 완료 (2026-09-04)** — 같은 날 저녁, 운영 데이터를 NAS PostgreSQL로 옮기고(`--apply --reset`, 커밋 전 검증 통과) 웹의 `DEFAULT_BASE`를 `https://bokbok9.tail8b977f.ts.net`으로 바꿔 배포했다(`tc-v173`). 폰에서 로그인·저장 확인. Vercel에는 정적 웹만 남고, `tripcanvas-api` 프로젝트는 **롤백 대상**으로 살려 두었다.
  - 공개 주소는 **Tailscale Funnel**이다 — 도메인을 사지 않고 `*.ts.net`에 HTTPS를 얻는다. Vercel 함수가 tailnet 안의 DB에 닿을 수 없어 API를 NAS로 옮긴 것이다(`docs/nas-deployment.md`).
  - ⚠️ tailnet **안에서** 한 curl은 Funnel을 지나지 않는다(MagicDNS가 100.x로 푼다). 공개 경로는 tailnet 밖에서 확인해야 한다.
  - ⚠️ 이제 가용성이 집 NAS에 걸린다. 그리고 **iOS는 아직 Vercel API**를 가리킨다(`TCApiBaseURL`) — 옮기기 전까지 두 클라이언트가 서로 다른 데이터를 본다.
  - 여전히 Supabase에 쓰는 것: **가격 관측**(`app.js:2249` — 쓰기 엔드포인트가 아직 없다).
- 미검증: 실제 Supabase JWKS 응답(테스트는 로컬 키). `next/Dockerfile`·`deploy/docker-compose.yml`과 실제 PostgreSQL 경로는 이번 전환으로 운영에서 돌고 있다.

## 롤백

각 도메인은 환경변수 하나로 돌아간다(`TC_MIGRATION_TRIP=LEGACY`). 새 PostgreSQL에 쓴 뒤 레거시로 돌아가면 그 사이 변경은 Supabase에 없다 —
그래서 `NEW_BACKEND` 전환은 **데이터 이관 직후, 검증 스크립트가 통과한 뒤**에만 한다(Phase 10). `DUAL_READ`는 이관 기간에만 쓴다.
