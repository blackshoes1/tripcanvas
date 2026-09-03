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
| PRICING | LEGACY (→ `DUAL_READ` → `NEW_BACKEND` 가능) | `/api/v1` 가격 관측 읽기(`listPriceObservations`)는 새 Repository 준비됨(`TC_MIGRATION_PRICING`). **크론(`api/track-hotel-prices.js`, service_role)과 웹의 직접 insert는 아직 Supabase** — 관측을 쓰는 쪽이 옮겨 오기 전까지 새 DB는 이관된 과거 관측만 갖는다 |
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
| 9 | 웹 Supabase 클라이언트 제거 · iOS GoTrue 호출 제거 | 🔸 PR12 진행 중 — 함께하기 RPC 16종과 버전 이력이 API로 옮겨졌다. 남은 것: 여행 동기화(`sync_trip`)·`my_trip_roles`·실시간·가격 관측·로그인 |
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

- 실시간 사이드카는 아직 Supabase 검증만 한다. better-auth가 ESM 전용이고 사이드카는 CommonJS로 컴파일되기 때문이다 — AUTH를 실제로 넘길 때(PR11) 사이드카를 ESM으로 바꾼다.
- 웹·iOS의 로그인 화면은 그대로 Supabase다. 전환은 PR11.
- CSRF(§71)는 better-auth의 기본 보호에 기대고 있다. 쿠키 기반 웹 전환(PR12) 때 실제 출처 설정과 함께 확인한다.

## 웹의 Supabase 제거 (PR12)

정적 웹이 **함께하기와 버전 이력**을 TripCanvas API로 부른다. 서버 레지스트리가 `LEGACY`면 API가 다시 Supabase를 부르므로
데이터는 그대로 있고 앞단만 바뀌었다 — 이것이 Strangler의 실제 모습이다.

| | |
|---|---|
| 클라이언트 | `api.js`(`TC_API`) — `{data,error}`를 돌려주고 **예외를 던지지 않는다**. 호출부의 모양을 바꾸지 않으려는 설계다 |
| 오류 | 서버의 `FORBIDDEN`을 Supabase가 주던 `42501`/403으로 옮긴다 — `collab.js`의 `isForbiddenError`와 '재시도하지 않는다' 규칙이 그대로 동작한다 |
| 토큰 | Supabase 세션의 access token을 그대로 싣는다(서버가 직접 검증, Phase A). **초대 미리보기만 토큰 없이** 나간다(§6) |
| 주소 | `API_BASE` — 운영은 `tripcanvas-api.vercel.app`, localhost는 `:3000`, 테스트는 `window.__TC_API_BASE` |
| CORS | 두 프로젝트가 다른 출처라 필요하다. `TRUSTED_ORIGINS`에 있는 출처만 허용하고 `*`를 쓰지 않는다(§72, `next/src/proxy.ts`) |

**아직 Supabase에 남은 것**과 이유:

- **로그인·세션** — 자체 Auth 전환은 PR11이다
- **여행 동기화**(`sync_trip`·`tombstone_trip`·목록·`pullTrip`) — CAS·충돌 처리가 가장 위험한 코드다. 따로 옮긴다
- **`my_trip_roles`와 실시간** — 실시간 채널이 이 호출이 주는 내부 `trip_id`를 쓴다. 둘은 함께 옮겨야 한다
- **가격 관측**(`hotel_price_snapshots`) — 쓰기 엔드포인트가 아직 없다

## 지금 할 수 있는 것 / 아직 못 하는 것

- 새 API(`POST /api/v1/trips` · `GET/PUT/DELETE /api/v1/trips/:id`)는 레지스트리가 `LEGACY`여도 동작한다 — Supabase를 같은 Repository 계약으로 감쌌기 때문이다. 웹·iOS가 `sync_trip` 대신 이 API로 옮겨 탈 수 있다(PR12·PR13의 준비).
- Supabase 토큰은 서버가 직접 검증한다. 로컬 검증이 실패하면 예전처럼 `getUser`로 확인하고 **경고 로그**를 남긴다 — 그 로그가 보이면 프로젝트가 HS256이므로 `SUPABASE_JWT_SECRET`을 넣는다.
- `trip_snapshots`(여행 버전 이력)를 새 DB에 채웠다 — `/api/v1/trips/:id/snapshots`. 이관 대상에도 들어 있다.
- 가격 크론 `api/track-hotel-prices.js`는 모든 사용자의 여행을 읽어 관측을 쓰는 **시스템 작업**이라 사용자 토큰 모델에 맞지 않는다. 새 backend로 옮길 때는 서비스 계정 경로(내부 전용 라우트 + `CRON_SECRET`)로 다시 만든다 — Phase 10 전에.
- `NEW_BACKEND`·`DUAL_READ`는 코드·테스트가 있지만 **데이터 이관 스크립트가 아직 없다**(Phase 10). staging에서 빈 DB로 먼저 돌려 본다.
- 미검증: 실제 SMTP 발송(테스트는 어댑터를 가짜로 넣는다), `next/Dockerfile`·`deploy/docker-compose.yml`(작성 환경에 Docker 없음), 실제 PostgreSQL 서버(테스트는 PGlite — 실시간 트리거·LISTEN은 PGlite에서 진짜로 돌지만 `pg` 드라이버 경로는 미검증), 실제 Supabase JWKS 응답(테스트는 로컬 키).

## 롤백

각 도메인은 환경변수 하나로 돌아간다(`TC_MIGRATION_TRIP=LEGACY`). 새 PostgreSQL에 쓴 뒤 레거시로 돌아가면 그 사이 변경은 Supabase에 없다 —
그래서 `NEW_BACKEND` 전환은 **데이터 이관 직후, 검증 스크립트가 통과한 뒤**에만 한다(Phase 10). `DUAL_READ`는 이관 기간에만 쓴다.
