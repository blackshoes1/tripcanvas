# Trip Canvas — 작업 가이드

대화로 만드는 멀티시티 여행 동선 플래너 (정적 PWA). 빌드 도구 없음 — 파일 그대로 배포.

## Git 워크플로 (중요)

- **`main`에 직접 커밋·푸시하지 않는다.** 브랜치를 만들고 PR로 넣는다:

  ```
  브랜치 → PR → 게이트 통과 → merge → 배포
  ```

  브랜치 이름은 `feat/*` · `fix/*` · `chore/*` · `docs/*` · `release/*`.
- ⚠️ `main` merge는 Vercel 자동 배포와 연결돼 있어 **merge 즉시 프로덕션(`tripcanvas-ai.vercel.app`)에 나간다.** merge 전에 아래 **릴리스 체크리스트**를 반드시 지킬 것. (API·DB는 Vercel 배포로 바뀌지 않는다 — NAS에서 따로 올린다)
- **필수 체크가 빨간 상태로 merge하지 않는다.** 빨간 이유가 코드가 아니라 러너·과금이면 그 사실과 대신 무엇으로 검증했는지를 PR에 남기고 **사람이 판단한다** — `docs/ci.md`
- **여러 기기(집·회사)에서 작업한다.** 세션 시작·커밋 전에 `git fetch`로 `origin/main`이 앞서 있는지 확인하고, 뒤처졌으면 `git pull --ff-only` 후 작업한다.
- **커밋 메시지 제목은 명사형으로 끝낸다.** `… 기능 추가` · `… 오류 수정` · `… 규칙 정리` 처럼 맺는다. `추가한다`·`고쳤다` 같은 서술형 어미로 끝내지 않는다. (본문은 서술형으로 써도 된다 — 제목만 명사형)
- PR 본문은 무엇이 바뀌었는지·왜·사용자와 프로덕션에 무슨 영향인지·무엇으로 검증했는지·되돌리는 법을 적는다. **`테스트 작성됨`과 `테스트 통과`를 섞지 않는다.**

## 배포

- 원격 `main` 푸시 시 **Vercel 자동 배포** (프로젝트 `tripcanvas`, 프로덕션 `tripcanvas-ai.vercel.app`).
- ⚠️ **API는 이제 NAS다**(2026-09-04 전환). 웹이 부르는 주소는 `https://bokbok9.tail8b977f.ts.net`(Tailscale Funnel이 HTTPS를 붙인다)이고 데이터는 NAS PostgreSQL이다. Vercel에는 정적 웹만 남았고, `tripcanvas-api` 프로젝트는 **롤백 대상**으로 남겨 두었다(여전히 Supabase를 본다). 전환 스위치는 `api.js`·`auth.js`의 `DEFAULT_BASE` 두 줄이다 — `docs/nas-deployment.md`.
- ⚠️ 그래서 **가용성이 집 NAS에 걸린다.** NAS가 꺼지거나 Tailscale이 끊기면 저장이 안 된다(로컬 편집은 보존된다). iOS(`TCApiBaseURL`)도 같은 주소로 옮겼다.
- **관리형 인프라 전환은 준비만 됐다(2026-09-17)** — 코드·스크립트·runbook은 `docs/managed-infrastructure.md` · `managed-db-migration.md` · `production-cutover.md` · `disaster-recovery.md`. **프로덕션 cutover·API 주소 변경·NAS 종료·프로덕션 마이그레이션은 별도 승인 없이 하지 않는다.** 앱 코드는 호스팅 위치를 모른다 — `DATABASE_URL`·`REALTIME_DATABASE_URL`(LISTEN 전용 직접 연결)·`MIGRATE_DATABASE_URL`·`API_BASE_URL`·`REALTIME_URL`·`REALTIME_HEALTH_URL`·`BACKUP_MAX_AGE_HOURS`·`TC_READ_ONLY`(점검·읽기 전용 모드 — 쓰기가 503 `MAINTENANCE`)가 전부다. 두 PostgreSQL이 같은지는 `scripts/verify-db-migration.sh`(PASS/FAIL/SKIP — SKIP은 통과가 아니다), 복원은 `scripts/restore-to-target.sh`(비어 있는 대상에만).
- 커밋 author 이메일은 반드시 **GitHub 계정과 매칭되는 유효한 주소**여야 한다 (`blackshoes85@gmail.com`).
  `.local` 등 로컬 호스트 기반 자동 이메일이면 Vercel이 배포를 거부한다.

## 릴리스 체크리스트

- [ ] 웹 자산(`app.js`·`index.html`·`style.css`…)을 바꿨으면 `npm run bump:version` 으로 버전 올리기 (`sw.js`의 `VER`과 `index.html`의 `?v=`를 함께 갱신 — 안 올리면 stale 캐시로 변경이 반영 안 됨)
- [ ] **게이트를 통째로** 통과시킬 것:

```bash
npm run verify:all
```

  루트(구문·버전·lint·시크릿·`tsc`·유닛·통합·RLS·audit·E2E) + `next/`(lint·`tsc`·vitest·build·tools:build) + iOS(XcodeGen·XCTest·Release)를 한 번에 돌리고 끝에 PASS/FAIL/**SKIP** 표를 찍는다.
  범위만 돌리려면 `scripts/verify-all.sh web|next|ios`.
  ⚠️ **SKIP은 통과가 아니다** — 무엇을 못 돌렸는지 PR에 밝힌다.

- [ ] **필수 체크가 빨간 상태로 merge하지 않는다.** 빨간 이유가 코드가 아니라 러너·과금이면 그 사실과 대신 무엇으로 검증했는지를 PR에 남긴다 — `docs/ci.md`
- [ ] **API 배포는 이제 자동이다**(2026-09-19). `main` 머지가 곧 운영 API 배포다 — 사람이 할 일이 없다:

```
PR merge → main → Actions(release.yml): 게이트 → GHCR :<커밋 SHA> → production 태그
                → NAS cron(5분): pull → migrate → api·realtime → 헬스체크 → revision 확인
```

  **NAS는 더 이상 빌드하지 않는다.** 이미지는 GitHub에서만 만들어지고 이름이 커밋 SHA라
  `Git 커밋 = 이미지 = migrate·api·realtime = TC_REVISION = 배포 기록`이 하나로 꿰어져 있다.
  ⚠️ **2026-09-19 새벽 사고가 이 구조를 만들었다** — 맥의 `origin/main`이 전날 것이라 빌드는 성공했는데
  내용이 옛 커밋이었고 로그는 전부 초록이었다. 소스를 사람이 날라 거기서 빌드하는 한 같은 사고가 또 난다.
  **배포 스크립트는 스스로를 갱신한다**(2026-09-20) — 배포할 때마다 그 커밋의 것으로 갈아 끼우고 다시 시작한다
  (같은 디렉터리에 받아 `bash -n` 검사 후 rename, `TC_SELF_UPDATED`로 한 번만). 사람이 복사할 일이 없다.
  확인·롤백·정지는 전부 한 스크립트다 — `docs/nas-deployment.md`:

```bash
ssh nas '~/tripcanvas/scripts/nas-deploy.sh --status'              # 도는 커밋 · production 태그 · 상태
ssh nas '~/tripcanvas/scripts/nas-deploy.sh --sha <40자리 SHA>'    # 특정 커밋으로 롤백
ssh nas 'touch ~/tripcanvas/deploy/.deploy-disabled'               # 자동 배포 정지
```

- [ ] **마이그레이션은 하위호환이어야 한다** — 머지가 운영 DB에 자동 적용되고, **이미지 롤백은 스키마를 되돌리지 않는다.**
  쓰던 컬럼 삭제·개명·`SET NOT NULL`·타입 변경은 `npm run check:migrations`(게이트)가 PR에서 막는다.
  나눠서 한다: expand → deploy → backfill → contract — `docs/migration-policy.md`.
  정말 파괴적 변경을 해야 하면 자동 배포를 세우고 백업을 새로 뜬 뒤 손으로 본다(같은 문서).
- [ ] 푸시 후 폰에서 실제 동작 확인 — ☰ 메뉴 하단의 **버전 표시**로 새 버전이 적용됐는지 먼저 볼 것 (캐시된 옛 버전이면 그 글자를 탭해 갱신)

## 브랜드 — With J / From J

사용자에게 보이는 제품 이름은 **With J**다. `From J`는 앱 이름이 아니라 **J가 사용자에게 보내는 제안의 서명**이다.

```
With J          ← 제품 (앱 이름 · 웹 타이틀 · PWA · 메일 제목 · 화면 문구)
  └─ From J     ← 제안 카드에만 붙는 서명 (`sgKicker`의 `.sgFrom` · iOS `SuggestionCard`)
```

- **기술 식별자는 브랜드를 따라가지 않는다** — 저장소 `tripcanvas` · 번들 ID `com.fromj.trip` · App Group · DB 테이블 · API 경로 · 소스 파일 헤더 주석은 그대로 둔다. 바꾸면 서명·스토어·이관이 깨진다.
- 화면 문구에 내부 용어를 쓰지 않는다: NextAction→**다음** · Suggestion→**From J** · TripPulse→**오늘의 흐름** · Replan→**다시 맞추기** · Collaboration→**같이 짜기** · Candidate→**가고 싶은 곳** · Conflict→**의견이 갈려요** · Travel Mode→**여행 중**.
- J는 계획적·침착하고 먼저 챙기되 **대신 결정하지 않는다.** 제안에는 언제나 빠져나갈 길이 함께 있다.

## 구조

- `index.html` — 마크업 (모달·헤더·재생 HUD 등)
- `app.js` — 앱 로직 전체 (DOM·지도·네트워크)
- `lib.js` — 순수 로직 (파서·거리·시각·앵커·타임라인·정규화 · **분리 구간** `splitSegments`/`whoKey` · **결제 상태** `costPayStateOf`/`payStateTotals` · **여행 준비 메모** `TRIP_NOTE_CATEGORIES`/`normalizeTripNote`). **유닛 테스트 + `tsc` 타입 검사 대상**
- `price.js` — 예약 가격 추적 순수 계산: 실질 절약액·오퍼 조건 매칭(EXACT/EQUIVALENT/SIMILAR)·확정/잠재 절약 판단·호텔 identity 점수 · 렌터카 조건 매칭(carMatchQuality — 차급·변속기·보험·주행거리가 다르면 확정 절약 금지). 예약(`trip.bookings`)은 여행 데이터로 동기화·공유되고, 가격 관측 기록은 기기 로컬 + 로그인 시 **`/api/v1/trips/:id/prices`**(여행과 같은 저장소·같은 권한. 2026-09-04 전환 전에는 Supabase `hotel_price_snapshots` 직접 경로였다). 시세는 `api/hotel-offers.js` 프록시(Metasearch 키 서버 전용)로만 조회 — 키 없으면 미연결 상태를 그대로 표시(가짜 가격 금지). **유닛 테스트 + `tsc` 대상**
- `adaptive.js` — **Adaptive Travel OS 도메인**(순수): 현재 여행 상태(`buildTripState`) · 고정/유동 분류(`commitmentOf`) · 빈 시간 탐지(`findFreeWindows`) · 다음 행동 후보와 순위(`buildCandidates`/`rankNextActions`) · 일정 재구성(`generateReplan`) · 제안(`buildSuggestions`) · 자연어 해석(`parseIntent`) · 출발 안내(`departureAdvice`) · 빈칸 채우기와 하루 flow(`fillGaps`/`planDayFlow`). DOM·네트워크·현재시각을 모르고 전부 인자로 받는다. **유닛 테스트 + `tsc` 대상**
- `intake.js` — **유입 계층**(순수): 공유 분류(`classifyShare`) · 날짜/통화 정규화 · 예약 후보 파싱(`parseBookingCandidate`) · 중복(`findDuplicateBooking`) · 여행 매칭(`matchTripForBooking`) · 기록 연결(`associateMemory`) · **붙여넣은 일정 글 읽기**(`parseItinerary`). **저장은 하지 않는다** — 확인한 것만 저장된다. ⚠️ **사람들은 우리 형식으로 다시 쓰지 않는다** — ChatGPT·Claude가 뱉은 그대로 붙여넣으므로 `stripDecor`(마크다운 `**`·이모지) · `expandTables`(마크다운 표 — 모르면 **그 날이 통째로 사라진다**) · `koTime`(`오후 3시`) · `splitNameDesc`(`점심: 카와카미안` → 이름은 오른쪽)를 먼저 지난다. 이름에 꾸밈이 남으면 지오코딩이 실패해 전부 '위치 지정'이 된다(2026-09-08). **유닛 테스트 + `tsc` 대상**
- `collab.js` — **함께하기(협업)** 순수 로직: 역할 판정(`canEdit/canManage/canLeave/canDelete`) · 초대 링크 만들기/읽기(`#join=`) · 초대 판정 문구 · 권한 오류 판별 · **후보 장소와 반응**(집계 `tallyReactions` · 상태 `candidateMood` · 보드 묶음 `groupCandidates` · `canPropose/canReact/canRemoveCandidate`) · **활동 기록과 실시간**(문장 `activityText` · 묶음 `condenseActivity` · 이벤트 판정 `liveEffects` · 코멘트 권한) · **여행 취향과 합의**(`normPrefs` 서버와 같은 규칙 · `groupContext` · `consensusOf` 점수는 내부값 · `candidateVerdict`) · **충돌과 제안**(`candidateConflict` · `conflictOptions` · `buildGroupProposal` 미리보기) · **함께 움직이지 않는 시간**(참여자 문장 `whoText`/`whoLabels` · `includesMe` · 분리 미리보기 `buildSplitPlan` · 합류 안내 `reunionText`). 접근 제어의 경계는 DB(RLS·RPC)고 여기는 화면 판정만. **유닛 테스트 + `tsc` 대상**
- `style.css` — 스타일
- `api.js` — **TripCanvas API 클라이언트**(여행 동기화·함께하기·버전 이력·역할·실시간). `TC_API.sync`는 예전 `sync_trip`/`tombstone_trip`의 반환 모양(`{applied,conflict,revision,data,deleted_at}`)을 그대로 재현한다 — app.js의 CAS·충돌 로직을 건드리지 않기 위해서다. `{data,error}`를 돌려주고 예외를 던지지 않으며, 서버의 `FORBIDDEN`을 Supabase가 주던 `42501`로 옮겨 기존 권한 처리가 그대로 돌게 한다. 초대 미리보기만 토큰 없이 나간다. **유닛 테스트 + `tsc` 대상**
- `auth.js` — **인증 클라이언트**(PR11). Supabase Auth와 자체 Auth를 같은 모양으로 감싼다 — `{data,error}`에 **코드**(`INVALID_CREDENTIALS`·`EMAIL_NOT_VERIFIED`·`RATE_LIMITED`·`NETWORK`)를 실어 화면이 제공자별 문구를 모르게 한다. 로그인 상태 변화는 `onChange` 하나로 나간다(예전 `onAuthStateChange` 자리). ⚠️ **어느 Auth를 쓸지는 서버가 정한다**(`GET /api/v1/auth-config`) — 답이 없으면 SUPABASE로 남아 오늘의 동작이 이어진다. 자체 Auth 세션은 bearer 토큰(`tripcanvas_auth_v1`)이다: 교차 출처라 쿠키를 쓰지 않는다. **유닛 테스트 + `tsc` 대상**
- `sync.js` — 클라우드 동기화(리비전 CAS·충돌·tombstone). **`tsc` 대상**
- `routing.js` — 경로 조회 transport 격리 (app.js는 `fetchLeg` 호환 shim만 씀). **`tsc` 대상**
- `sw.js` — 서비스 워커 (앱 셸 캐시). `/api/`와 GET 외 요청은 건드리지 않는다
- `manifest.json` · `icon-*.png` — PWA
- `api/` — Vercel 서버 함수(**서버 전용 키**): `kakao-directions.js`(카카오내비 프록시) · `hotel-offers.js`(호텔 시세 메타서치 프록시) · `car-offers.js`(렌터카 시장가 프록시 — Provider 미연결 시 AUTH_REQUIRED, 수동 관측 fallback) · `track-hotel-prices.js`(가격 스냅샷 크론) · `health-watch.js`(**외부 경로 감시** — tailnet 밖에서 NAS를 찔러 보고 저장이 죽으면 503. 실시간만 죽으면 폴백이 있어 200 DEGRADED다. **`production` 태그와 도는 `revision`이 오래 어긋나도 DEGRADED** — 배포가 선 것이다. 우리 인프라 중 tailnet 밖에 있는 것이 Vercel뿐이라 여기 있다)
- `supabase/migrations/` — RLS·동기화 무결성·가격 스냅샷·추천 반응 기록·기기 토큰/발송 기록·여행 기록·**함께하기(멤버·초대·역할 RLS · 후보 장소·반응 · 코멘트·활동 기록·실시간 퍼블리케이션 · 여행별 멤버 취향 · 후보 결정 REJECT/REOPEN · 반응 user_id)** 스키마
- `ios/` — **네이티브 iOS 앱(SwiftUI)** + `TripCanvasWidgets`(위젯·Live Activity 확장) + `TripCanvasShared`(App Group 공유 상태). 웹은 여행을 *계획*하고, iOS는 여행을 *실행*한다. **로그인은 웹과 같은 자체 Auth**(`/api/auth/*`, bearer 세션 · Keychain `withj.auth.session.v1`)다 — Supabase GoTrue 직접 호출은 없앴다(2026-09-05). refresh 그랜트가 없어 401은 `get-session`으로 확인하고, 예전 Supabase 세션은 **변환하지 않고 지운 뒤 한 번 다시 묻는다**. 판단 로직을 Swift로 복제하지 않는다 — `/api/v1`이 준 결과를 그리기만 한다. 계획 화면도 **네이티브로 옮겼다**(일정 편집 `Features/Plan` · 지도·검색 `Features/Map` · 예약 편집 `Features/Booking` · 함께하기 `Features/Collab`). 예약은 문서의 `trip.bookings`라 장소와 같은 CAS 저장 경로를 쓰고, 검증은 웹 `bkSave`와 같은 규칙이다(`TripBooking.swift`). 함께하기는 `/api/v1`의 멤버·초대·후보·코멘트·활동·취향 라우트를 그대로 쓰고 판정은 `CollabModel.swift`(`collab.js`의 복사본 — 규칙을 바꿀 때 `collab.js`를 먼저 고친다)에 모여 있다. 후보를 일정에 넣을 때는 문서 저장이 먼저고 후보 표시가 그다음이며, 표시가 실패해도 일정에는 들어갔다고 말한다. 초대 링크는 웹 주소로 만든다(받는 사람에게 앱이 없을 수 있다). 실시간은 웹과 **같은 사이드카·같은 규약**에 붙는다(`RealtimeClient` — AUTH는 첫 프레임, 토큰을 URL에 싣지 않는다). payload는 신호일 뿐이고 무엇을 다시 읽을지는 `CollabModel.liveEffects`(`collab.js` 복사본, `live-effects.json` 픽스처로 파리티 검사)가 정한다. 붙을지는 서버가 정하고(`/api/v1/me`), 못 붙으면 조용히 당겨서 새로고침으로 간다. 백그라운드에서는 끊는다. 지도는 웹과 같은 듀얼 엔진(국내 카카오맵 SDK · 해외 Google Maps SDK — 처음 들어온 외부 의존성, SPM)이고 키는 **번들 ID로 제한된 네이티브 키**(`TCGoogleMapsKey`·`TCKakaoNativeKey`)다. 국내 검색은 카카오 REST 키를 앱에 못 넣어 서버 `GET /api/v1/places/search`를 지나고, 해외 검색은 iOS 키로 Places API(New)에 직접 묻는다(`ios/README.md` 표). 여행 문서는 아는 필드만 담은 구조체로 디코딩하지 않고 **원문 트리(`JSONValue`)로 들고 아는 필드만 덮어 쓴다** — 그러지 않으면 웹이 쓰는 `who`·`split`·`hours` 같은 필드가 앱 저장 한 번에 사라진다. 저장은 `PUT /api/v1/trips/:id`(revision CAS)이고 실패하면 화면을 되돌린다. 빌드·XCTest는 CI가 시뮬레이터로 본다(`.github/workflows/ios.yml`, `ios/` 변경 시에만 — macOS 러너는 10배 과금). **staging API로도 확인됐다**(2026-09-04 — `TCApiBaseURL`을 터널로 돌려 로그인·여행 목록·오늘 화면). 서명·실기기·푸시·위젯 실제 표시는 여전히 기기에서만 확인된다 (`ios/README.md` · `docs/ios-device-setup.md`)
- `next/src/server/` — **독립 Backend**(Supabase 이관 중, `docs/backend-architecture.md` · `docs/supabase-migration.md`): `auth/`(Supabase JWT 직접 검증 → `RequestContext`) · `api/`(오류 계약 · Trip 라우트) · `application/`(TripService · TripAuthorizationService — RLS 대체) · `repositories/`(인터페이스 · dual read · memory) · `auth/`에 **자체 Auth**(better-auth — `/api/auth/*`, 이메일 확인·세션·재설정. `users.auth_user_id`로 도메인 사용자와 잇고 **확인된 이메일로만** 연결한다) · `infrastructure/mail/`(SMTP 어댑터·쿨다운) · `infrastructure/database/`(Drizzle 스키마 · 마이그레이션 · PostgreSQL Repository, 테스트는 PGlite) · `infrastructure/supabase/`(레거시 경로) · `migration/`(Supabase → 새 DB 데이터 이관·검증. `npm run migrate:import`, 절차는 `docs/backup-restore.md`) · `realtime/`(**WebSocket 사이드카** — `trip_activity` 트리거의 `pg_notify`를 LISTEN해 중계한다. 별도 프로세스: `npm run tools:build && npm run realtime`. 페이로드는 신호뿐이고 내용은 API로 다시 읽는다. ⚠️ CommonJS로 컴파일되므로 ESM 전용인 better-auth를 import하지 않는다 — 자체 Auth 세션은 `auth/sessionTokenVerifier.ts`가 **DB로** 판정한다(서명까지 확인해 API와 같은 기준). API와 **같은 `AUTH_SECRET`**을 써야 하고, 다르면 아무도 실시간에 못 붙는다). Route Handler에 비즈니스 로직을 두지 않는다. 이관 레지스트리 `TC_MIGRATION_<DOMAIN>`(기본 LEGACY, `DATABASE_URL` 없으면 강제 LEGACY)이 요청마다 저장소를 고른다. `deploy/`는 **운영 compose 하나로 뜬다**(`docker compose -f deploy/docker-compose.yml up -d` — 루프백 publish가 안에 있다). override 둘은 선택이고 용도가 다르다: `docker-compose.staging.yml`은 DB에 직접 붙을 때(postgres 15432), `docker-compose.caddy.yml`은 도메인+Caddy 경로(오늘의 ingress는 Tailscale Funnel이라 안 쓴다). **2026-09-05 실제 NAS에서 검증됐다** — `docs/nas-deployment.md`
- `next/src/features/trip-state/` — 웹·iOS 공통 API 계층. `contract.ts`(단일 출처 계약) · `todayView.ts`(엔진 결과를 계약 모양으로) · `dayPlanView.ts`(**일정 화면이 쓰는 하루치** — `dayView.ts`의 계산을 계약 모양으로. ⚠️ **라벨이 아니라 값을 싣는다**: 웹 `DayView`는 `"📏 하루 동선 약 12.4km"` 같은 완성된 문장을 들고 있는데 그걸 보내면 앱이 표기를 정할 수 없다. ⚠️ 타임라인의 '분'은 소수라 **정수로 반올림해서** 보낸다 — 안 그러면 Swift가 `Int` 디코딩에서 죽고 그 사고는 앱 빌드까지 아무도 모른다) · `mutations.ts`(문서 변경 순수 함수) · `handlers.ts`(주입 가능한 라우트 핸들러) · `supabaseGateway.ts`(RLS 아래 읽기·쓰기)
- `scripts/` — `bump-version.js` · `check-version-sync.js` · `check-secrets.js` · `verify-all.sh`(릴리스 게이트를 로컬에서 통째로 — `docs/ci.md`) · `rehearse-restore.sh`(합성 데이터로 dump→restore→migrate→대조, 게이트에 들어 있다) · `restore-to-target.sh` · `rehearse-restore-managed.sh` · `verify-db-migration.sh`(두 PostgreSQL 전수 대조)
- `.githooks/pre-push` — `main` 직접 푸시 차단. **클론마다 `git config core.hooksPath .githooks` 한 번.** 2026-09-06부터 GitHub branch protection이 서버에서도 막으므로(공개 전환) 훅은 유일한 방어가 아니라 **빠른 방어**다 — 서버까지 갔다가 거절당하기 전에 막아 준다(`docs/deployment-workflow.md`)
- `test/` — 순수·통합·API 테스트 (`pure` · `integration` · `adaptive` · `intake` · `collab` · `price` · `routing` · `sync` · `api-*` · `migration` · `rls.integration`(로컬 PostgreSQL이 있을 때만 — `scripts/pg-local.sh`))
- `e2e/` — Playwright 시나리오 (`core-flows` · `pwa` · `accessibility` · `ux-wireframe` · `collab`)
- `proto/` — 실험용 프로토타입. 프로덕션 앱과 무관
- `.github/workflows/ci.yml` — **Quality**(구문 → 버전 동기 → lint → 시크릿 스캔 → `tsc` → 유닛 → 통합 → `npm audit`) + **E2E**(Playwright) 두 잡

라이브러리(CDN): 지도 듀얼 엔진 — 해외 Google Maps JS SDK · 국내 카카오맵 JS SDK · LZString(공유 링크 압축) · SortableJS(드래그) · Supabase(로그인/클라우드 동기화)
검색: 국내 카카오 로컬 · 해외 Google Places (`routedSearch`가 라우팅) · 저장: localStorage + Supabase
지도에서 장소 담기: 해외는 `clickableIcons`로 POI 탭 시 `placeId`를 그대로 받고, **국내는 카카오 SDK가 POI 탭 신원을 주지 않아** 카테고리 검색으로 POI 칩을 직접 깔아 그걸 누르게 한다(`refreshKakaoPOI`). 좌표 역추적(`reverseSpot`)은 둘 다 실패했을 때의 최후 수단이다 — 추측이라 엉뚱한 상호가 들어갈 수 있다.
API 키: app.js 상단 `GMAPS_KEY`(리퍼러 제한)·`KAKAO_KEY`(JS, 플랫폼 도메인 제한)·`KAKAO_REST_KEY`(카카오내비) — `localhost:8000`, `tripcanvas-ai.vercel.app` 등록 필요
localStorage: `tripcanvas_v1`(여행) · `tripcanvas_legs_v4`(구간 캐시, 수단별 키) · `tripcanvas_synced` · `tripcanvas_prices_v1`(예약 가격 관측 기록) · `tripcanvas_suggest_v1`(제안 거절 이력·컨디션 — 여행 데이터가 아니라 기기 로컬) · `tripcanvas_cfg` · `tripcanvas_fx` · `tripcanvas_join_v1`(초대 수락 대기 토큰) · `tripcanvas_auth_v1`(자체 Auth 세션 토큰 — Supabase 모드에서는 쓰지 않는다)
주의: Google 약관상 지도 타일 캐시 금지 → 오프라인 지도 기능 없음 (SW는 앱 셸만 캐시)

## 핵심 개념 (배선 실수가 잦은 곳)

**출발 기준점은 한 함수가 결정한다.** 지도 일자 간 점선·재생·ETA·사이드바·여행 모드가 각자 추론하면 안 된다.

- `dayAnchor(day)` (lib) — 그 날의 종료 기준점: 마지막 숙소 → 없으면 마지막 위치 장소
- `dayStartAnchor(days, di)` (lib) — di일이 **이월받는 출발점**. 숙소 연박(`nights`) 범위를 먼저 보고, 없으면 직전 유효 일자의 `dayAnchor`. `startPolicy:'none'`이면 이월 없음(공항 이동일·야간열차)
- `dayContext(di)` (app) — `{day, anchor, carry, timeline, mode}`를 한 번에 반환. **사이드바·여행 모드·이미지 내보내기는 이걸 쓴다**
- ⚠️ `anchor`와 `carry`를 혼동하지 말 것: **ETA·종료시각 계산은 `anchor`**(숙소가 아니어도 전날 마지막 장소 반영), **화면의 🏠 "전날 숙소" 항목 표시만 `carry`**(숙소일 때만)
- `dayReturnStay(days, di)` (lib) — 하루 끝의 🏠 숙소 복귀. 데이터에 없는 **합성 구간**이라 거리·시간·택시비에만 얹힌다. ⚠️ **일정의 마지막 날에는 붙이지 않는다** — 그날은 돌아가는 날이 아니라 떠나는 날이라, 체크아웃하고 공항으로 간 뒤에 호텔 복귀가 따라붙으면 있지도 않은 이동이 하루 합계에 들어간다. 그래서 복귀를 보는 테스트 픽스처에는 **뒷날을 하나 붙여야** 한다(안 그러면 그 날이 마지막 날이라 null이다).

**렌터카 픽업·반납은 일정에 '표시만' 한다.** 픽업·반납 장소는 자유 텍스트라 **좌표가 없다** → 동선·ETA·앵커·지도에는 넣지 않는다. 표시 경로가 둘이다:

- **일정의 장소와 연결했을 때** — `carSpotLinks(days)` (lib)가 `spot.carPickupId`·`spot.carReturnId`를 역참조한다. 그 장소 행에 `.carbkChip`으로 붙는다. **비행기로 도착한 뒤 그 공항에서 픽업하는 경우가 흔해서**, 연결 없이는 픽업이 도착보다 위에 찍힌다 — 순서를 맞추려면 이 연결을 쓴다. 장소 복사(`copySpot`)는 연결을 떼어낸다(차를 받는 곳은 한 곳).
- **연결 안 했을 때** — `carEventsOn(bookings, iso)` (lib)가 날짜로 파생해 `.spot.carbk` 독립 행으로. 픽업은 장소 목록 앞·반납은 뒤(숙소 복귀 앞). 연결된 이벤트는 이 목록에서 뺀다.

시각은 ETA 칸이 아니라 메타 줄에 — ETA 칸은 '그날 계산된 도착 예상 순서'를 뜻하는데 이 항목은 그 순서에 속하지 않는다. 드래그 인덱스가 어긋나므로 독립 행은 `.spotList` 안에 넣지 않는다.

**당일 대여(픽업일=반납일)는 정상이다.** 체크아웃 규칙(`start>=end` 거부)을 렌터카에 쓰지 않는다 — 같은 날이면 픽업·반납 **시각**이 앞뒤를 가른다(시세 조회도 `pickupAt<returnAt`만 본다).

**반납 지점은 (장소, 공항코드) 한 쌍이다.** `carReturnPoint(b)` (lib) — 둘 중 하나라도 입력돼 있으면 그게 내가 정한 반납 지점이라 픽업에서 물려받지 않는다. 둘 다 비었을 때만 픽업과 동일. **표시(`carEventsOn`)와 시세 조회(`CarMarketProvider`)가 같은 함수를 쓴다** — 반쪽만 물려받으면 `서귀포점 (CJU)` 같은 표기가 나오고, 편도 반납인데 픽업 공항의 시세를 조회하게 된다.

**이동수단은 일자 기본 + 구간별 재정의.** `legModeOf(day, spot)` — 도착 장소의 `legMode`가 있으면 그것, 없으면 일자 기본. (첫날을 비행기로 둬도 도시 내 이동까지 비행기가 되지 않게)
수단: 자차 · 택시 · 대중교통 · 기차 · 도보 · 자전거 · 비행기.
라우팅(`fetchLeg`): 비행기·기차는 **직선거리 기반 추정**(실시간 시각표 없음) · 국내 자차/택시=카카오내비(도로 없으면 인근 도로 스냅) · 국내 대중교통=Google Routes TRANSIT · 국내 도보/자전거=카카오 도로거리 기반 추정 · 해외=Google Routes

**체류 시간을 안 정하면 머무르지 않는다(0분).** 2026-09-06 이전에는 1시간을 먹었다. 계산처가 넷이라 함께 바꾼다 — `computeTimeline`(lib) · `dayEndMin`·`legDepartMinute`(app) · `dayView.ts`(next) · `adaptive.js`.

- ⚠️ **`defaultStayMin`과 `suggestStayMin`을 섞지 말 것**(adaptive). 앞은 *내가 계획한 체류*(0 = 안 정함)이고, 뒤는 *제안할 활동의 예상 소요*(60)다. 제안 소요를 0으로 두면 **어떤 빈 시간에도 무한히 들어간다** — 계획 체류가 0인 장소를 제안할 때도 `suggestStayMin`을 쓴다.
- ⚠️ 입력에서 `parseInt(v)||60` 같은 식을 쓰지 말 것 — **0이 falsy라 0을 넣어도 60이 된다.** 0은 유효한 값이다("들렀다 바로 이동").
- 화면은 '정하지 않음'과 '0분'을 **둘 다 남긴다**. 계산은 같지만 "아직 안 정했다"와 "바로 간다"는 다른 말이다.

**분류와 결제 상태는 다른 축이다.** 분류(`kind`)는 *무엇에 쓴 돈인가*, 결제 상태(`payState`)는 *냈는가*다 — 같은 '숙박'도 예약만 해 둔 것과 이미 결제한 것이 있다.

- 값은 `RESERVED`(예약) · `PAID`(결제) 둘뿐이고, 고르지 않으면 **저장하지 않는다**. 계산에서는 `NONE`(미구분)으로 센다.
- ⚠️ **미구분을 어느 쪽으로도 단정하지 않는다.** 결제로 치면 '이미 쓴 돈'이 부풀고, 예약으로 치면 '남은 지출'이 부풀어 둘 다 거짓말이 된다. 그래서 화면도 값이 있는 상태만 말한다.
- 예약(`trip.bookings`)에서 파생된 하루치는 **언제나 예약**이다(`costPayStateOf(item,'BOOKING')`).
- 상태별 합계는 `payStateTotals`(lib) 하나가 만든다 — 하루(`dayCostSummary().payTotals`)와 여행 전체(`tripCostSummary().payTotals`)가 같은 규칙을 쓴다. **셋을 더하면 합계와 같아야 한다**(금액 미정과 예약이 대신 내는 장소는 더하지 않는다).
- 비용 항목의 **영수증·품목 사진**은 `photos`에 **참조만**(사진 보관함 식별자) 싣는다. 원본 이미지를 문서에 넣지 않는다 — 문서는 저장할 때마다 통째로 오가므로 동기화가 무거워지고 공유 링크가 터진다. 그래서 그 사진은 **담은 기기에서만** 보인다(다른 기기에서는 그 문자열이 아무것도 가리키지 않는다). 최대 10장.

**비용은 '하루치'와 '총액'을 구분한다.** 장소 비용(`spot.cost`)·택시비는 그날 쓰는 돈이지만, 예약(숙박·렌터카·항공)은 여러 날에 걸친 총액이다.

- **가기 전에 낸 돈과 가서 쓰는 돈은 다른 장부다**(2026-09-17). `tripCostSummary()`가 둘로도 나눈다 — `prep`(준비한 비용 = 예약 **전액** 한 줄씩 + 여행 단위 항목 `trip.costItems`) · `onSite`(가서 쓰는 비용 = 날짜별 장소·추가 비용·교통, `dayCostSummary().onSiteKRW`의 합). **둘을 더하면 `totalKRW`와 같다.** `trip.costItems`는 하루 `day.costItems`와 같은 모양·같은 정규화(`normalizeCostItems`)이고 어느 날에도 속하지 않는다(보험·유심·미리 산 입장권). 앱 비용 화면은 이 둘을 세그먼트로 나누고, 정산은 **금액부터 치는** 빠른 입력(`QuickSpendEditor` — 낸 돈이라 결제로 둔다)이 먼저다.
- **예약의 결제 상태는 예약마다 다르다.** `booking.payState`는 `PAID`만 저장하고 없으면 예약이다(`costPayStateOf(b,'BOOKING')`) — 항공은 대개 낸 돈, 현장 결제 호텔은 잡아 둔 돈이라 한쪽으로 단정하면 가계부의 '이미 낸 돈 / 아직 낼 돈'이 거짓말이 된다. 하루치(`bookingShareOn`)·잔액·가계부 줄이 전부 이 값을 따른다.
- **결제일(`paidOn`)이 있으면 날짜가 상태를 정한다**(2026-09-18). 결제일은 '결제 예정일'이다 — 오늘이거나 지났으면 `PAID`, 아직이면 `RESERVED`이고 그때 손으로 고른 `payState`는 보지 않는다(`costPayStateOf(item, source, today)`). 예약·여행 단위 비용·하루 항목 전부 같은 규칙이다. **오늘은 호출부가 넘긴다** — 서버는 Today와 같은 시계(`resolveClock`의 `todayISO`, 여행 시간대·`?date=`로 덮어쓸 수 있다)를 `dayCostPartsOf`·`buildTripCosts`·`buildDayPlanView`에 넣고, 웹은 기기 날짜(`todayISO()`)다. `today`를 안 넘기면 결제일을 판정하지 않고 손으로 고른 상태로 돌아간다. 편집기(웹 `bkSave`/`saveCostItem` · iOS `BookingEditorView`)는 결제일을 두면 `payState`를 **지운다** — 두 답이 갈리면 어느 쪽도 못 믿는다. 응답의 모든 비용 줄에 `paidOn`(없으면 null)이 실린다.
- **예약 결제 항목은 한 편집기·한 목록이다**(2026-09-18). 분류는 하루 비용과 같은 9가지(`COST_CATEGORIES` = iOS `CostCategory`, 같은 순서·같은 이름)이고 셀렉트박스다. **항공·숙박·렌트는 예약**(`trip.bookings`, 웹 `BK_KIND_TYPE`·iOS `CostCategory.bookingType`)이라 기간·조건·링크·가격 추적이 붙고, 나머지는 여행 단위 비용(`trip.costItems`)이다 — 분류가 어디에 저장할지를 정한다. 이미 저장된 항목은 자기 쪽 안에서만 분류를 바꾼다(예약을 식비로 바꾸면 기간·조건·가격 기록이 갈 곳이 없다). 목록(웹 `paymentRows` · iOS `PaymentRow.rows`)은 결제일 최근 순, 결제일 없는 것은 뒤에 등록 순이고 '추가'는 목록 **위**다. 예약도 `photos`(참조만)를 가진다.
- **상태 문구는 '결제 완료 / 결제 예정 / 미구분'이다**(웹 `PAY_STATE_LABEL` = iOS `CostPayState.label`). '예약만 함'·'결제함'은 모호해서 버렸다. 두 장부의 이름은 **예약 결제 금액**(prep) / **현지 결제 금액**(onSite)이고 웹 필터바 전체 비용 내역도 이 둘로 묶는다. 환율 표기는 **원 단위 반올림**이고 엔은 100엔 기준이다("100 JPY ≈ 931원", iOS `TripCostsView.fxLine`).
- **연박 숙소(장소)의 비용도 숙박일 수로 나눈다**(2026-09-18). `stay`이고 `nights`가 2 이상인 장소의 `cost`는 체크인 날부터 `nights`일에 걸쳐 하루치로 잡힌다(`stayCostShares` — 예약 하루치와 같은 나누기 규칙, 통화 최소 단위로 앞날부터 1단위씩). 체크인 날 줄은 `SPOT`(제목 `(1/N박)`), 다음 날들은 **`STAY` 줄**(키 `체크인일.장소인덱스`, 제목 `(k/N박)`)로 이월되고 '장소' 묶음·가서 쓰는 돈에 든다. 고치려면 체크인 날 장소에서 고친다. 1박·숙소 아님·금액 미정은 나누지 않는다. 일자 카드는 하루치(`dayEnteredCostOn`·웹 `dayCostOn`), 여행 전체 합계는 전액(`dayEnteredCost`)이다 — 연박이 일정 밖으로 나가면 예약과 같은 차이가 난다.
- **일자 카드 하루 비용** = 장소 + 택시 + `bookingShareOn(bookings, iso)` (lib)로 날수를 나눈 예약 하루치. **앱 비용 화면의 날짜별 줄도 같은 값**(`cost.total`, 2026-09-18 — 전에는 가서 쓰는 돈만 보여 "웹은 나오는데 앱만 안 나온다"가 됐다)이고, 줄 아래에 `현지 ₩A · 예약 하루치 ₩B`로 가른다. 위의 현지 결제 금액 합계는 여전히 가서 쓰는 돈만이라 날짜별 합계와 다르며, 그 차이를 머리글이 말한다. **숙박과 렌터카만 나눈다** — 숙박은 `[체크인, 체크아웃)`(체크아웃 날엔 숙박비 없음), 렌터카는 `[픽업, 반납]` 양끝 포함. **항공은 나누지 않는다**(한 번 낸 돈이지 하루치가 있는 돈이 아니다 — 왕복을 출발일~귀국일로 잡으면 비행기를 안 타는 날에도 매일 들어갔다, 2026-09-17 수정). 나머지는 앞날부터 1원씩 얹어 하루치의 합이 총액과 정확히 맞는다.
- **필터바 전체 비용** = `tripCostBreakdown()` (app) — 장소 + 택시 + 예약 **전액**. 예약 기간이 일정 밖으로 나가면 하루 합계보다 크다(전체가 실제 총액).
- **환율은 두 곳이 각자 하루 한 번 받는다** — 같은 출처(open.er-api.com USD 기준)·같은 UTC 날짜라 값이 같다. 웹은 기기 `localStorage`(`tripcanvas_fx`, `loadFx`), 앱이 쓰는 API는 **서버**(`server/currency/serverFx.ts` → `fx_rates` 테이블, 마이그레이션 0013)다. 2026-09-18까지 서버는 환율을 받은 적이 없어 앱은 코드에 박힌 근사값(USD 1380원)만 썼다. 응답은 `fxSource`(`API`·`FALLBACK`)와 `fxAsOf`를 실어 앱이 "9월 18일 환율"이라고 말한다 — 오늘 못 받으면 **저장된 최근 날**을 그 날짜와 함께 쓰고, 받은 적이 없을 때만 근사값이다. 근사값을 시세처럼 보이지 않는다.

⚠️ 모바일 필터바는 `overflow-x:auto` **스크롤 컨테이너**다 — 안에 뜬 드롭다운 패널이 잘린다(44px 높이에 갇혀 거의 안 보였다). `.viewMenu .viewMenuPanel`을 `position:fixed`로 빼내 해결했다 — `top:auto`라 정적 위치(칩 바로 아래)는 그대로다. 필터바에 드롭다운을 새로 추가하면 같은 함정에 빠진다.

**새 장소는 '선택한 장소 바로 뒤'에 들어간다.** 삽입 위치는 모달을 **열 때** `editing.after`에 확정한다(`selectedSpot`이 그 일자에 있을 때만). 저장 시 일자를 바꿨거나 선택이 없으면 맨 뒤. 선택 위치는 카드 강조 말고는 눈에 안 보이므로 `＋ N번 뒤에 장소 추가`로 밝히고, 선택은 `render()` 없이 바뀌므로 라벨 갱신을 `applySpotSelection()`에 묶는다.

**시간 3종을 구분한다.** 도착 **예상**(자동 계산) / `at` 도착 **고정**(내가 정한 계획) / `bookAt` **예약·입장 시각**(상대가 정한 약속 — 일찍 도착하면 그 시각까지 대기로 계산, 늦으면 ⚠️).

**밖에서 들어온 것은 확인 없이 저장하지 않는다.** 공유·붙여넣기·사진은 전부 같은 길을 지난다:

```
공유 → classifyShare → parseBookingCandidate → 중복·여행 매칭 → 미리보기 → (사용자 확인) → 저장
```

- 파싱 순서: **구조화된 메타데이터 → 알려진 제공자 → 규칙 파서 → (그다음에야) AI → 수동 입력.** AI가 첫 수단이 아니다.
- **모호하면 추측하지 않는다.** `10/03`처럼 월/일이 갈리면 `ambiguous:true`와 대안을 함께 돌려주고, 그런 후보는 `disposition:AUTO`가 되지 않는다. `$100`도 어느 나라 달러인지 단정하지 않는다.
- 못 읽어도 버리지 않는다 — `rawText`/`rawUrl`을 그대로 돌려줘 메모로 남길 수 있게 한다.
- 중복은 **확신이 있을 때만** 말한다(예약번호 일치 등). 애매하면 중복이라 하지 않는다 — 정상적인 두 번째 예약을 막게 된다.
- 어느 여행인지 **단정하지 않는다**. 점수와 이유를 붙인 후보를 주고 고르게 한다.
- 기록(사진·메모)은 시각 → 위치 순으로 일정을 짚어 준다. 못 짚으면 날짜에만 붙인다 — 억지로 고르지 않는다. **클라이언트가 보낸 activityId를 믿지 않고 서버가 다시 짚는다.**
- 사진 **원본은 서버로 올리지 않는다**. PhotosPicker 식별자(`assetRefs`)만 남긴다.
- 공유 키(`shareIdempotencyKey`)는 앱(`ShareQueue.makeId`)과 서버가 **같은 알고리즘**이어야 한다 — 다르면 같은 공유가 두 번 처리된다. `swiftParity.test.ts`가 이걸 검사한다.

**알림은 적게 보내는 것이 목표다.** 이 앱은 일정 알람 앱이 아니라 여행 흐름 판단 앱이다.

- 판단 순서: `departurePlan`(약속 − 이동 − 안전여유) → `tripPulse`(하루 상태 한 마디) → `notificationPlan`(보낼 만한 것) → `pendingNotifications`(이미 보낸 것 제외). 전부 `adaptive.js`에 있다.
- **알림은 단계(stage)가 바뀔 때만 나간다** — `UPCOMING → READY_TO_LEAVE → LATE_RISK`. `dedupeKey`에 단계가 들어 있어 같은 상황은 두 번 나가지 않는다(`notification_log`의 unique).
- 판단 주체를 나눈다: 위치가 필요한 출발·지연은 **기기**(`origin:'DEVICE'`, 로컬 알림), 일정 전체·가격은 **서버**(`origin:'SERVER'`, APNs). 양쪽이 같이 판단하면 두 번 온다.
- 빈 시간 제안 알림은 **Travel Mode가 켜져 있고**, "오늘은 쉬기"(`suppressUntil`) 중이 아니고, 남은 시간이 충분할 때만.
- ⚠️ `stateVersion`은 **계획이 바뀌었을 때만** 달라진다(시간 경과·`availableMin`은 넣지 않는다). 잠금화면·위젯은 이 값이 같으면 다시 그리지 않는다 — 여기에 시간 의존 값을 넣으면 1분마다 갱신되어 배터리를 먹는다.
- `GET /api/v1/trips/:id/travel-state` 하나로 Today + Pulse + 출발 계획 + 알림 계획 + 잠금화면/위젯 압축본을 받는다. 여행 중 연속 호출은 그대로 배터리다.
- 위치는 쿼리로만 받고 **저장하지 않는다**(`locationUsed`로 무엇을 썼는지만 돌려준다). 위치 history를 남기지 않는다.
- 잠금화면·위젯 압축본에 예약번호·URL·placeId를 넣지 않는다 — 잠긴 화면에 계속 떠 있는 정보다. `swiftParity.test.ts`가 이걸 검사한다.

**엔진은 하나다 — iOS는 클라이언트다.** `adaptive.js`를 Swift로 다시 만들면 두 플랫폼의 답이 갈라진다.

```
            adaptive.js  (판단은 여기서만)
                  │
       ┌──────────┴──────────┐
  레거시 웹 · Next 웹      /api/v1  →  iOS
```

- `/api/v1` 라우트는 `@legacy/adaptive.js`를 **그대로 import** 한다(`next/tsconfig.json`의 `@legacy/*` → 저장소 루트). 새 규칙이 필요하면 `adaptive.js`에 넣는다 — `todayView.ts`에 넣으면 웹과 어긋난다.
- 역할 분리: **단순 조회(Trip·Day·Spot)는 Supabase 직접**, **도메인 판단(Today·Suggestion·Replan)은 서버 API**.
- 쓰기는 전부 `sync_trip` RPC(revision CAS)를 지난다. 같은 요청을 두 번 받아도 결과가 같고(`alreadyApplied`), 다른 기기가 먼저 바꿨으면 409로 알린다 — 조용히 덮어쓰지 않는다.
- 이동시간은 **서버 구간 캐시**(`leg_cache`)에 있는 구간만 실제 도로다. 나머지는 직선거리 추정이고, 구간마다 `source`·화면 전체로는 `travelTimeSource`로 그 사실을 실어 보낸다(**하나라도 추정이면 맨 위는 추정**). 클라이언트는 그때 "예상"이라고 표기한다.
  - ⚠️ **응답을 경로 조회에 묶지 않는다.** 하루치는 이미 조회된 것만 싣고 즉시 나가고, 없는 구간은 응답을 보낸 뒤 `legFiller`가 채운다 — 그 날을 처음 열면 추정이고 다음부터 도로다. 판정은 복제하지 않는다: 서버도 웹 `routing.js`를 그대로 쓰고, 국내는 `/api/kakao-directions` 요청을 가로채 **같은 프록시 코드**를 안에서 돌린다.
  - ⚠️ 키(`GOOGLE_ROUTES_API_KEY`·`KAKAO_REST_API_KEY`)가 없으면 라우터가 `null`이라 예전과 완전히 같다. 잠깐인 실패(프록시 429·업스트림 5xx)는 캐시에 남기지 않는다 — 혼잡이 한 시간짜리 "직선이에요"로 굳으면 안 된다.
- 제안 거절은 `suggestion_feedback` 테이블(RLS)에 날짜와 함께 남는다 — 기기가 바뀌어도 같은 제안이 그날 다시 올라오지 않는다. ⚠️ 레거시 웹은 아직 localStorage를 쓴다(양쪽이 아직 공유되지 않음).
- `next`의 `swiftParity.test.ts`가 **실제 Today 응답 ↔ `ios/.../Contract.swift`** 를 맞춰 보고 `ios/TripCanvasTests/Fixtures/today.json`을 다시 만든다. 계약을 바꾸면 여기가 먼저 깨진다.

**앱의 탭 전환은 앱 복귀가 아니다.** (2026-09-17 "탭을 누를 때마다 로딩" 보고)

- 여행 화면의 모델(`TodayViewModel`·`TripPlanViewModel`·`MapDiscoveryModel`)은 **탭이 아니라 여행이 들고 있다**(`TripHomeView`의 `TripScreenModels`). 탭 화면은 받기만 한다 — 화면이 `@State`로 모델을 만들면 탭을 바꿀 때 뷰와 함께 죽어 돌아올 때마다 서버를 다시 묻는다.
- 탭 진입은 `loadIfStale()`이다: 내용이 있고 방금 받은 것(60초)이면 요청이 0, 오래됐으면 **뒤에서** 새로 받는다(내용이 있으니 로딩 화면으로 바뀌지 않는다). 앱 복귀(`scenePhase`)·당겨서 새로고침은 여전히 `load()`다.
- `지금`은 디스크에 남은 지난번 응답을 **먼저 그린다**(`cachedToday`) — 단, 목록이 아는 revision과 같을 때만이고, 그때 '오프라인' 표시는 붙이지 않는다.
- 지도는 한 번 만들면 **숨기기만 한다**(`TripPlanView.mapMounted` + `MapEngineView.isVisible`). 숨긴 동안 카카오는 `pauseEngine`, 구글은 `isHidden` — 버리지 않으니 다시 보일 때 인증·타일을 되풀이하지 않는다. 처음 열기 전에는 만들지 않는다.
- 탭 바는 **언제나 화면 맨 아래다** — 내용 위에 겹쳐 두고 키보드 안전 영역을 무시한다(`TripHomeView.tabBarHeight`만큼 내용이 위에서 끝난다).

**앱 화면은 정보 위계가 먼저다 — 더 많이가 아니라 지금 필요한 것부터.** (2026-09-18 모바일 UI 정리)

- **지금 = 실행, 일정 = 계획.** `지금`의 다음 일정 카드는 출발·도착·이동·머무름을 **알약(`LegPill`)** 으로만 말하고(`NextActionCard.facts` — 없는 것은 말하지 않는다), 여행 전에는 D-day와 예약 정보로 간다. `일정`은 Day별 목록과 편집이다.
- **일정 상단은 세 줄이다** — 하루 제목(`headline`) · `이동 2시간 27분 · 예상 ₩456,665`(`TripPlanView.summaryLine`) · `이대로면 15:56에 끝나요`. 총 이동거리·머무는 시간 미정·예약할 곳·하루 예산·비용 미정·교통비 안내는 **'오늘 요약 보기'를 눌렀을 때만**(`dayDetails`). 기본 화면에서는 첫 장소가 요약보다 위에 있어야 한다. Day 칩은 고른 날만 요일·제목까지 말하고 나머지는 `Day 2 / 10/26`뿐이다(`TimeFormat.dayChipShort`).
- **이모지와 벡터 아이콘을 한 화면에 섞지 않는다.** 장소 유형은 `SpotCategory.symbol`(SF Symbols), 이동은 `TravelMode.symbol`, 숙소 이월·복귀는 `house.fill`, 고정 시각은 `pin.fill`. `SpotCategory.icon`(이모지)은 웹·공유 문장과 같은 **글자**용으로만 남는다. 이동 정보는 장소보다 가벼운 알약(`LegPill`)이다 — 장소 이름이 언제나 가장 먼저 읽힌다.
- **색은 뜻이다** — `Ink.accent`(누를 것·고른 것) · `Ink.warning`(시간 경고·미정·확인할 것) · `Ink.danger`(오류·삭제·초과·취소) · `Ink.positive`(완료) · `Ink.info`(상대가 정한 것). 화면이 `.orange`·`.red`·`.green`·`.blue`를 직접 부르지 않는다. 늦게 끝나는 것은 경고가 아니다 — 자정을 넘길 때(`overloaded`)만 주의색.
- **지도의 범위(이 날 | 전체)와 검색은 다른 일이다** — 같은 세그먼트에 넣지 않는다(`mapScope` + `mapSearching`). 지도가 뜨기 전에는 스피너만 두지 않고 `MapLoadingPlaceholder`가 무엇을 기다리는지 말한다(실패는 `EmptyStateView`가 따로).
- **'이 날' 지도는 열 때 그날 동선이 통째로 보인다**(2026-09-19). 카메라 규칙은 하나다 — 고른 장소가 있으면 거기로(줌 15·16), 없으면 **핀과 선의 점을 전부 담는 사각형**(`MapBounds.covering(pins:routes:)`)을 맞춘다. 사각형에 선의 점도 넣는 이유는 숙소 복귀(`back`)가 핀이 아니라 선으로만 있어서다. 구글은 bounds fit, 카카오는 bounds fit이 없어 중심 + `MapBounds.zoomLevel(fitting:)`(웹 메르카토르, 256pt 타일)로 간다. 맞추는 때는 **핀이 바뀌었을 때·동선이 처음 도착했을 때·고름을 풀었을 때**뿐이고, 도로가 채워져 선이 바뀔 때는 움직이지 않는다(보고 있는 지도를 흔들지 않는다). ⚠️ `focus`에 첫 장소를 넣지 않는다 — 그러면 첫 장소에 줌인해 나머지 동선이 화면 밖이다(그게 2026-09-19 전 모습). ⚠️ 구글은 뷰가 0×0일 때 fit하면 줌을 못 정한다 — `pendingFit`으로 미뤄 첫 idle에 맞춘다.
- **도시를 건너는 날은 장면으로 나눈다**(`MapScenes`, 2026-09-19). 마드리드 → 세비야 같은 날을 통째로 담으면 사각형이 나라 절반이 돼 도시 안 동선이 점 하나로 뭉친다. 연속한 두 장소가 **25km 이상** 벌어지면 거기서 끊고(`MapScenes.split`), 기본 카메라는 **주 장면**(장소가 가장 많은 묶음, 같으면 뒤쪽 = 잠드는 곳)이다. 지도 위 칩 한 줄(`마드리드 1 · 기차 2시간 30분 · 390km · 세비야 5 · 전체`)로 장면을 바꾸고 전체도 본다 — J가 대신 정하지 않는다. 엔진에는 `frame`(맞출 사각형)만 넘긴다: 핀·선은 그대로 다 그리고 **카메라만** 거기로 간다. 장면 사이 이동은 서버 구간이 있으면 수단·시간·거리, 없으면 직선 거리에 "약"이다. 장소를 고르면 그 장소의 장면이 고른 장면이 되어 고름을 풀면 전체가 아니라 거기로 돌아간다. 장면이 하나인 날은 칩이 없고 예전과 같다.
- 더보기는 설정 앱의 한 줄(아이콘·이름·설명·꺾쇠)이고 행 전체가 눌린다. 큰 카드로 감싸지 않는다.
- **날짜는 숫자로 쳐도 되고 달력을 눌러도 된다**(`DateEntryField` — `ISODateText.parseLoose`가 `20261025`·`2026.10.25`를 받고 8자리가 아니면 연도를 추측하지 않는다). 여행 기간은 **시작일–종료일**로 정하고 일수는 파생이다(iOS 여행·하루 설정·새 여행, 웹 여행 설정의 `#tripEnd` — 일수 칸과 서로 맞춰진다). 시작일이 없는 여행만 일수로 정한다.
- 가고 싶은 곳의 분류(`CandidateCategory` = `collab.js` 목록·순서)는 iOS에서도 담을 때 고르고, 보드에서 거르고(`CandidateCategoryFilter` — '분류 없음'과 '기타'는 다르다), 카드에서 바꾼다(`manageCandidate CATEGORY`). 분류를 모르는 소스 구현은 분류 없이 담는다(프로토콜 기본 구현).
- 예약 화면(`BookingListView`)의 편집기도 비용 화면과 같은 9분류 편집기다 — 예약이 아닌 분류는 `TripPlanViewModel.saveCostItem`으로 `trip.costItems`에 가고, 그 목록은 비용 화면의 예약 결제 금액에 보인다(예약 화면은 가격 추적 예약만 나열한다).

**계산이 늦게 오는 화면은 반쯤 지어 보이지 않는다.** (앱의 일정 화면 — 2026-09-07에 "화면이 튄다"로 드러났다)

앱의 일자 화면은 **둘로** 그려진다: 문서(즉시)와 서버 계산(`dayPlan`, 늦게). 계산에 딸린 것이 많다 —
🏠 전날 숙소 이월 · 렌터카 픽업/반납 · **구간 줄(장소마다)** · 숙소 복귀 · 하루 합계 · "예상이에요" 안내.
문서만으로 목록을 먼저 그렸다가 계산이 들어오면 이것들이 한꺼번에 끼어들어 **줄이 통째로 밀린다.**

- **첫 시도가 끝날 때까지 목록을 짓지 않는다**(`planAttempted(for:)`). 실패도 '시도'다 — 계속 기다리게 두지 않는다.
- **받은 계산은 날마다 기억한다** — 메모리(`plansByDay`) + 디스크(`cachedDayPlan`). 날을 옮길 때마다 다시 받으면 그때마다 목록이 새로 지어진다. ⚠️ 지난 계산을 읽는 조건은 "**그 날의** 것이 없을 때"다 — `plan == nil`로 보면 앞 날 것이 남아 있어 영영 안 읽힌다.
- **문서가 바뀌면(revision) 기억을 버린다.** 편집한 뒤의 옛 시각을 보여 주느니 다시 받는다 — 잠깐이라도 틀린 숫자를 말하는 것이 비어 있는 것보다 나쁘다. 같은 이유로 **새로고침이 실패했다고 이미 보여 준 계산을 지우지도 않는다**(문서가 그대로면).
- **값이 없어도 자리는 잡는다** — 시간 칸은 계산 전에도 폭을 유지한다(폭 0이면 시각이 도착할 때 이름이 옆으로 밀린다).
- **초기 선택은 계산을 기다리지 않는다.** '오늘로 이동'은 이미 아는 값(`TripSummary.todayIndex`)으로 **시작할 때** 정한다 — 계산이 온 뒤에 옮기면 1일차를 보여 줬다가 오늘로 튄다.
- 웹은 계산을 스스로 하므로 이 문제가 없다. **앱만의 규칙**이다.

**Adaptive Travel OS — 상태 → 제안 → 반영은 한 패턴이다.** 일정 추천·일정 재구성·가격 절약이 각자 다른 흐름을 만들면 안 된다.

- 판단은 전부 `adaptive.js`(순수)에 있고 `app.js`는 배선·표시만 한다. 시각·이동시간·영업요일은 **인자로 주입**한다 → 같은 상태면 항상 같은 추천(렌더마다 순서가 바뀌면 안 됨).
- `adaptState(di)`(app)는 `dayContext(di)`의 `anchor`·`timeline`을 **그대로** 넘긴다. 추천이 출발 기준점을 따로 추론하면 화면과 다른 숫자를 말하게 된다.
- 일정 성격: `bookAt`(상대가 정한 약속)·항공·기차 = **FIXED(침범 금지)** · `at`(내가 정한 시각)·숙소·렌터카 = SEMI_FIXED · 나머지 = FLEXIBLE. 재구성은 **고정 보호 → 완료 유지 → `must` 보호 → 낮은 우선순위(`opt`)부터 제거** 순서를 지킨다.
- **장소 우선순위는 화면에서 3단 한 컨트롤이고, 저장은 `must`/`opt` 두 플래그다**(2026-09-20). 고르는 곳은 웹 `#spotPriority`·iOS `SpotPriority` Picker 하나뿐이고, 읽고 쓰는 규칙은 `lib.js`의 `SPOT_PRIORITIES`·`spotPriorityOf`·`applySpotPriority` 한 곳에 있다(iOS는 `Spot.priority`가 같은 규칙을 복제한다 — 순서·문구를 XCTest가 대조한다). 기본값('보통')은 저장하지 않고 **둘이 함께 켜지지 않는다**(둘 다 온 문서는 `normalizeSpot`이 `must`만 남긴다 — 지우는 쪽보다 지키는 쪽이 덜 잃는다).
  ⚠️ 저장 표현을 바꾸지 않는 이유: 엔진의 재구성과 계약(`TripActivity.mustVisit`/`optional`)이 그 두 플래그를 읽는다. 2026-09-20 전에는 **웹이 `opt`만, iOS가 `must`만** 편집할 수 있어, 화면에 없는 이유로 양쪽 추천이 갈렸다.
- 실행 상태는 `spot.status`(`COMPLETED`/`SKIPPED`/`CANCELLED`, 기본 PLANNED는 저장 안 함). **자동 완료 판정은 하지 않는다** — 사용자가 누른다.
- 제안은 한 번에 3(+1)개까지. 불가능한 후보(시간 초과·영업 종료·완료·건너뜀)는 **아예 제외**하고, 넣을 게 없으면 억지로 만들지 말고 쉬는 선택지를 남긴다. 점수는 내부값이고 UI에는 `reasons` 문장만 쓴다.
- 거절(`SKIPPED`)은 `tripcanvas_suggest_v1`에 **그날 날짜와 함께** 저장돼 같은 날 반복되지 않는다. 추천 결과 자체는 여행 데이터에 저장하지 않는다 — 수락한 것만 일정에 반영된다.
- 자연어("오늘 좀 피곤해서 많이 걷기 싫어")는 `parseIntent`로 **옵션(energyLevel·maxTravelMin·walkAverse)만** 바꾼다. 충돌·운영시간·이동시간 판단은 그대로 deterministic 로직이 한다. 못 알아들으면 알아들은 척하지 말고 그렇게 말한다.
- 빈칸 채우기(일부 계획 있음)와 하루 flow(계획 없음)는 **같은 엔진**이다 — `fillGaps`가 창마다 여러 칸을 채우고 `planDayFlow`가 고정 예약과 합쳐 오전/점심/오후/저녁으로 묶는다. 둘 다 **미리보기**이고 수락해야 일정에 들어간다.
- ⚠️ 활동의 시작은 도착 예정(`eta`)이 아니라 `depart`다. 19시 예약을 13시에 "진행 중"으로 보면 그 대기시간이 빈 시간에서 통째로 사라진다.
- UI는 여행 모드(`#travel`) 안의 `#travelSuggest`. 카드 버튼은 inline onclick 없이 `createElement`+`onclick`으로 만든다(장소명 이스케이프 사고 방지).

**함께하기(협업)는 DB가 결정한다 — 화면은 감출 뿐이다.** (`docs/collaboration.md`)

- 여행은 여전히 `trips` 한 행이고 `trips.user_id`가 소유자다. `trip_members`가 EDITOR/VIEWER를 더하고, `trip_invites`는 **토큰 해시만** 저장한다(원문은 만든 순간 한 번만 돌려준다).
- RLS: 읽기는 소유자 OR 활성 멤버 · 쓰기는 소유자 OR EDITOR · 삭제·초대·역할 변경은 소유자만. 정책은 전부 `tc_trip_role()`(security definer) 하나만 부른다 — 정책끼리 서로 참조하면 재귀다. ⚠️ `tc_trips_lock_owner` 트리거가 `user_id` 변경을 막는다 — 정책만으로는 편집자의 소유권 탈취를 못 막는다.
- `sync_trip`/`tombstone_trip`은 멤버를 인식한다. VIEWER 쓰기·멤버의 삭제·나간 사람의 저장은 **42501**(hint에 이유). 클라이언트는 42501을 `forbidden`으로 멈추고 **재시도 루프에 넣지 않는다**(`isForbiddenError`).
- **거절 문구는 서버가 말한 이유가 먼저다**(2026-09-20, `forbiddenText`). 지금 서버는 왜 막았는지를 한국어 문장으로 보내므로(`errors.ts`의 기본값 + 각 서비스의 message) 그걸 그대로 전하고, **문장이 없을 때만** 역할로 짐작한다. 웹·iOS가 같은 규칙을 쓰고 `forbidden-text.json` 픽스처가 대조한다 — 화면마다 제 문장을 두지 않는다(로컬 사전 판정인 웹 `guardEdit`·iOS `canEdit` 가드도 이걸 지난다).
  ⚠️ 사람에게 쓴 문장인지는 **한글이 있는가**로 가른다(`isHumanMessage`) — 레거시 경로는 기계 토큰(`TRIP_FORBIDDEN`)이나 원시 Postgres 영문(`permission denied for table trips`)을 주는데 그건 사용자에게 보이면 안 된다.
  ⚠️ `hint` 갈래는 **레거시 Supabase 전용**이다 — `api.js`의 `toError`가 hint를 싣지 않아 오늘의 서버에서는 닿지 않는다. 2026-09-20 전에는 그 죽은 갈래 때문에 "주최자는 나갈 수 없습니다 — 여행을 삭제하거나 넘겨 주세요" 같은 구체적 안내가 전부 "이 여행을 바꿀 권한이 없어요"로 뭉개졌다.
- 웹: `readOnly()`/`guardEdit()`가 `#v=` 읽기전용과 VIEWER를 한 곳에서 판단한다 — **편집 진입점을 새로 만들면 반드시 이걸 거친다.** 로그아웃·로컬 전용 여행은 항상 소유자(`roleOf`)라 혼자 쓰는 여행은 예전 그대로다.
- 초대 링크는 `#join=<token>` 하나다. 미리보기(`invite_preview`, anon 가능)는 이름·기간·역할까지만 주고, 본문은 `accept_trip_invite`로 멤버가 된 뒤 RLS 아래에서 내려온다. 공유받은 여행의 "삭제"는 `leave_trip`이다.
- 실시간은 `trip_activity` 이벤트로 온다(아래). `pullTrip`은 여전히 폴백이다 — 탭 복귀·패널 열기에 최신본을 당기고, 로컬 편집이 있으면 기존 충돌 카드로 넘긴다(조용히 덮어쓰지 않는다).

**여행 준비 메모는 일정이 아니다.** 비자·입국 준비·교통 이용법·특산품처럼 **날짜에 붙지 않는** 것들은 `trip.notes`에 산다(분류 `cat` 9가지 · `TRIP_NOTE_CATEGORIES`).

- **여행 문서에 넣는다** — 일행이 같이 보고 같이 고쳐야 하므로 기기 로컬(`tripcanvas_cfg`)도, 개인 소유인 여행 기록(`trip_memories`)도 아니다.
- 일자 카드에 끼우지 않는다: 시간을 차지하지 않는 것을 타임라인에 넣으면 동선이 거짓말을 한다.
- 확인한 메모(`done`)는 지우지 않고 가라앉힌다 — 무엇을 이미 챙겼는지가 목록에 남아야 한다. 기본값은 저장하지 않는다.

**후보 장소(가고 싶은 곳)는 아직 일정이 아니다.** 여행 문서가 아니라 `trip_candidates`·`candidate_reactions`에 산다 — 넷이 동시에 하트를 눌러도 리비전 CAS가 서로를 걷어차지 않고, **보기 권한도 의견은 낼 수 있어야** 하고, 한 사람 한 표를 DB(`unique`)가 보장해야 하기 때문이다.

- 한 줄 규칙: **보기 권한은 의견만 낸다 — 여행에 내용을 만들지는 않는다.** 반응(MUST/OK/PASS)은 활성 멤버 전원, 후보 추가·일정 반영은 EDITOR 이상. 후보를 **빼는** 기준은 역할이 아니라 '누가 냈는가'다(제안자 또는 소유자).
- 두 테이블 모두 **읽기 정책만** 있고 쓰기 정책은 없다 — 변경은 전부 RPC(security definer)를 지난다. `add_trip_candidate` · `list_trip_candidates` · `react_to_candidate`(멱등 upsert, `null`이면 거두기) · `manage_trip_candidate`.
- 분류(`category` · `CANDIDATE_CATEGORIES`)는 **표시와 거르기를 위한 것이지 결정이 아니다** — 순위를 바꾸지도, 묶음 규칙을 건드리지도 않는다. '아직 고르지 않음'(null)과 '기타'(ETC)는 다른 상태다. 담을 때 모르는 값이 오면 담기를 실패시키지 않고 고르지 않음으로 떨어뜨리고, 분류만 바꾸는 요청에서는 거절한다(떨어뜨리면 아무 일도 안 한 것이 된다).
- ⚠️ RPC 인자를 더할 때 **기본값이 있어도 `create or replace`는 교체가 아니라 중복 정의(overload)** 다 — 옛 시그니처를 먼저 `drop` 하지 않으면 기존 호출이 `function is not unique`로 죽는다(2026-09-17 `add_trip_candidate`).
- ⚠️ **인기순 자동 반영은 없다**(§12·§79). `sortCandidates`의 관심 순은 **표시일 뿐 결정이 아니고**, 일정에 넣는 것은 언제나 사람이 누른다. 넣을 때도 최적 위치를 추측하지 않고 고른 날 맨 뒤에 붙인다.
- ⚠️ `candidateMood`의 `LOVED`("다들 좋아해요")는 **전원이 의견을 냈고 아무도 PASS하지 않았을 때만**이다 — 둘이 좋다고 넷의 마음을 말하지 않는다. 보드는 결정 못 한 것을 맨 위에 둔다(순위가 아니라 *어디에 한마디가 필요한지*).
- ⚠️ `scheduled_ref`는 장소 id가 아니라 **'2'(2일차) 같은 위치 표시**다 — `normalizeTrip`이 모르는 필드를 떨어뜨려 장소에 안정적인 id가 없다. 그래서 "후보로 되돌리기"는 후보 표시만 되돌리고 일정의 장소는 그대로 둔다.
- 이름표는 `tc_member_label()`이 만든다 — **계정 이메일은 여행에 절대 나오지 않는다**(§69).

**활동 기록과 실시간은 한 테이블이다.** `trip_activity`는 **트리거가 쓴다**(RPC 본문을 건드리지 않는다 — 어떤 경로로 바뀌든 같은 기록). 실시간 퍼블리케이션에는 이 테이블의 INSERT만 실린다 — 여행 문서(jsonb 전체)는 내보내지 않는다.

- 클라이언트는 payload를 **신호로만** 쓴다: `liveEffects`가 무엇을 다시 읽을지 정하고(후보 보드 / 역할·인원 / 문서 pull) 내용은 RPC로 다시 읽는다(§41). 400ms 디바운스. 실시간이 죽어도 앱은 그대로(탭 복귀 pull 폴백). 구독은 보고 있는 여행 하나 — `ensureLiveChannel()`이 렌더마다 불려 전환·로그아웃을 따라간다.
- ⚠️ **활동 행을 UPDATE로 합치지 말 것** — INSERT 구독자가 못 받는다. 읽기 쉬운 묶음(같은 사람의 연속 저장 "(N번)", 같은 후보의 마지막 반응만)은 화면의 `condenseActivity`가 한다(§39).
- ⚠️ 실시간 전역(`liveCh`·`liveKey`…)은 `app.js` **위쪽**(`tripRoles` 곁)에 둔다 — `updateAuthUI()`가 로드 직후 `ensureLiveChannel()`까지 부르므로 아래에 두면 TDZ로 스크립트가 죽는다.
- 무엇을 **안** 남기는가: 소유자 멤버 행 · 제안자 자동 MUST(같은 트랜잭션의 `created_at`으로 구별) · 반응 거두기 · 후보 빼기 · **혼자 쓰는 여행의 저장**(§95). 여행당 최근 300건.
- 알림(toast)은 **남이 후보를 담았을 때와 새 멤버뿐**(§51). 반응·코멘트·일정 변경은 화면 갱신으로 끝. 내 저장(`mine`)은 당기지 않는다.
- ⚠️ 일행의 **일정 변경은 토스트를 띄우지 않는다.** 변경은 이미 화면에 그려져 있고, 일행이 편집을 이어가면 저장마다 같은 문장이 반복된다. 대신 둘로 알린다: 헤더 아래 `#livePresence` 한 줄(누가 바꿨는지 — `condenseActivity`가 연속 저장을 "(N번)"으로 묶고 **쌓이지 않고 갈린다**)과, 바뀐 일자 카드의 `.remoteChanged` 점(그 날을 열면 지워진다 — `remoteChangedDays`). 어느 날이 바뀌었는지는 `changedDayIndexes`가 pull 직전/직후 문서를 비교해 정한다.
- 코멘트는 **후보에만** 붙는다(장소에는 안정적 id가 없다). 의견이라 보기 권한도 남기고, 지우기는 쓴 사람·주최자. 문장은 `activityText`, 이름표는 `tc_member_label()` — 이메일은 없다.
- 반환형이 바뀌는 RPC(`list_trip_candidates`)는 `drop function` 후 `create` — `create or replace`는 반환형 변경을 거부해 마이그레이션 재적용이 깨진다.

**취향은 여행별이고, 합의 점수는 화면에 없다.** `trip_members.prefs`(jsonb)에 산다 — 고정 프로필이 아니다(§18). 서버 `tc_norm_prefs`와 클라이언트 `normPrefs`가 **같은 화이트리스트**라 미리보기와 저장본이 갈리지 않고, 저장 뒤에는 서버가 돌려준 것이 이긴다.

- 취향은 의견이다 — 보기 권한도 남기고 본인 것만 바꾼다. 활동 기록에 남기지 않는다(§38).
- `groupContext`는 정리만 한다(§62): 다수 페이스 · **가장 약한 사람 기준**의 걷기 · 아침/밤 제약 · 함께 관심 · 관심 vs 별로 충돌. 자동으로 빼자고 하지 않는다(§23).
- `consensusOf`는 단순 다수결이 아니다 — MUST/PASS 무게가 다르고 **아직 말하지 않은 사람만큼 확신을 줄인다**. §20의 예(A: MUST2·OK1·PASS1 = CONFLICT, B: MUST1·OK3 = GOOD_MATCH)에서 B가 위다. ⚠️ **점수(0~100)는 내부값이다 — 화면에는 문장만**(§21·§22). 테스트가 문장에 숫자가 없음을 확인한다.
- 카드 배지(`candidateVerdict`)는 **두 명 이상**이 말했을 때만 합의 문장이고, 아니면 2단계의 mood다. 보드는 **묶음이 정렬보다 먼저다** — "관심 순"은 묶음 안에서만 점수 순.
- 취향은 아직 후보 점수에 안 들어간다(후보에 카테고리가 없다). 동선·시간·예약 요소(§20)는 제안 단계에서.

**갈린 후보는 자동으로 빼지 않고, 제안은 미리보기다.** MUST와 PASS가 같이 있으면(`candidateConflict`) 카드가 세 선택지(§24)를 보인다 — 다 같이 방문(기존 일정에 넣기) · 자유시간으로 분리(다음 단계, 안내만) · 이번 일정에서는 제외(`REJECT`). 제외는 **상태**라 의견·한마디가 남고 `REOPEN`으로 돌아온다. 결정은 활동 기록에 한 번만 남는다.

- `buildGroupProposal`은 반대 없고 두 명 이상 말한 후보만 골라 **어느 날**에 넣을지 정한다(좌표 있으면 그 날 마지막 장소에서 가장 가까운 날, 없으면 장소가 적은 날, 위치는 맨 뒤). 같은 입력이면 같은 답. `[일정으로 만들기]`를 눌러야 들어간다(§79) — 제안은 저장되지 않는다.
- ⚠️ 시간·운영시간·예약 충돌은 제안에서 보지 않는다(§63) — 그건 `adaptive.js`의 몫이고, 시간대 배치는 다음 단계다.

**함께 움직이지 않는 시간은 타임라인의 예외다.** 모든 멤버가 늘 같이 다닌다고 가정하지 않는다(§25~§27).

- `spot.who`(참여자 user_id 배열) — **비었으면 모든 여행자다**(§26). 기본값이라 저장하지 않는다.
- `spot.split`(묶음 키) — 같은 키가 **이어지는 구간**이 한 묶음이고, 그 안에서 **참여자가 같은 장소들이 한 가지**다(`whoKey`).
- `spot.reunion` — 갈라졌던 사람들이 다시 만나는 지점. 표시일 뿐이고 시각은 타임라인이 정한다.
- ⚠️ `computeTimeline`이 유일한 계산처다: 한 묶음의 가지는 **전부 같은 출발점에서** 시작하고(나란히 일어나므로 서로를 밀지 않는다), 묶음 다음은 **가장 늦게 끝나는 가지**를 따른다(다 모여야 합류한다). 분리가 없으면 예전과 **완전히 같다** — 테스트가 그것부터 확인한다.
- ⚠️ `splitSegments`(lib)를 화면과 타임라인이 **같이** 쓴다. 화면이 따로 가르면 그림과 시각이 어긋난다.
- ⚠️ 나란한 가지를 `.spotList` 안에서 **열로 쪼개지 않는다.** 드래그 인덱스가 자식 순서로 계산돼서(`onSpotDrop`의 `oldIndex`) 다른 요소를 끼우면 순서가 어긋난다. 줄은 1:1로 두고 CSS(`.spot.inSplit`)와 메타 칩으로 묶어 보인다.
- 장소 모달은 분리 묶음을 **만들지도 지우지도 않는다** — 예약 연결과 같은 이유로 편집 시 그대로 물려준다.
- 분리를 만드는 곳은 갈린 후보의 "자유시간으로 분리" 하나다(`buildSplitPlan`). 가고 싶은 사람은 그 후보로, 나머지는 **자유시간**으로 간다 — 무엇을 할지는 앱이 고르지 않는다(§23). 반응에 `user_id`가 실려 있어야 동명이인이 섞이지 않는다(마이그레이션 `202609020006`).
- **무엇을 할 수 있는지는 `conflictOptions`의 `action`이 말한다**(2026-09-20). `SCHEDULE`·`REJECT`는 서버 액션이고 `SPLIT`은 문서를 바꾸는 동작이라 클라이언트가 `buildSplitPlan`으로 만들어 그 날 **맨 뒤**에 세 줄로 넣는다. 양쪽에 사람이 있어야(`candidateConflict`의 `goers`·`others`) 나눌 수 있고, 없으면 `action`이 `null`이라 버튼이 서지 않는다 — 화면이 따로 판정하지 않는다.
  ⚠️ 낙관적 반응에 **내 `user_id`를 반드시 실어야 한다**(웹 `applyLocalReaction` · iOS `applyingReaction(myId:)`). 안 그러면 내가 MUST를 눌러 만든 충돌인데 그 분리에서 내가 빠진다.
  ⚠️ 2026-09-20 전에는 `action:null`("다음 단계라 안내만")을 웹이 `key==='SPLIT'` 분기로 **우회**했고, 규칙을 그대로 따른 iOS에는 버튼이 없었다. 지금은 규칙이 하나고 iOS는 복사본이며 `split-plan.json` 픽스처가 장소 세 줄의 모양까지 대조한다.
- **네트워크는 적게 — 세 원칙**(2026-09-18, `docs/network-audit.md`). ① **방금 받은 것은 다시 받지 않는다**: 시트 넷(비용·예약·함께하기·가고 싶은 곳)의 모델도 `TripScreenModels`가 들고 열 때는 `loadIfStale(60)`, 앱 복귀도 `loadIfStale`, 같은 문서의 채운 하루치(`legsPending==0`, 이 세션에서 서버가 준 것)는 날을 오가도 다시 묻지 않는다(`fetchedDays`). ② **내 것은 이미 내 화면이다**: `liveEffects`의 `candidates`는 `(후보·반응·코멘트 && !mine) || 문서 변경` — 내 반응·담기·한마디의 에코로 목록을 다시 읽지 않는다(문서 변경은 내 것이어도 읽는다 — 후보 날짜 표시는 서버가 바꾼다). 규칙은 `collab.js`가 소스, iOS는 복사본+픽스처. ③ **바뀐 것만 다시 읽는다**: 함께하기는 `perform(refresh:)`(역할·이름은 멤버+활동, 초대 취소는 초대만), 보드는 인원을 처음 한 번·`MEMBER_*` 때만, 제안은 목록이 바뀌었을 때만, 비용 저장 뒤에는 `/costs`만(PUT 응답이 최신 문서다), 예약 편집기는 문서만(`TripPlanViewModel(loadsPlans:false)`), 웹 한마디 재조회는 `COMMENT_ADDED`가 온 후보만(`liveCommentTargets`). 웹 `pullTrip`은 여행 한 건(`TC_API.sync.get`)이고 `sync.list`는 로그인 병합과 404 뒤 tombstone 확인뿐이다. ⚠️ payload로 집계를 패치하지 않는다 — 무엇을 다시 읽을지만 고른다.
- ⚠️ `ensureMembers`(app)는 목록을 받아도 **다시 그리지 않는다.** `render()`는 순수한 다시 그리기가 아니라 클라우드 동기화까지 건드린다 — 이름표 하나 때문에 저장이 돌면 안 된다. 필요한 곳이 직접 `await` 한다.

**유입 데이터는 반드시 정규화한다.** 가져오기·공유 링크(`#v=`/`#t=`)·클라우드·로컬 로드 **5개 지점 모두** `normalizeTrip()`(lib)을 통과시킨다. 좌표·시각·통화·수단·`startPolicy`를 검증하고 알 수 없는 값은 기본값으로 폴백해 렌더 크래시를 막는다(`schemaVersion` 스탬프).

## 테스트

```bash
npm install          # 최초 1회 (jsdom·playwright·eslint·tsc)
npm test             # 유닛 + 통합
npm run test:e2e     # Playwright (실제 브라우저) — 배포 전 필수
npm run lint && npm run check:types && npm run security:scan
```

- `test/pure.test.js` — lib.js 순수 함수. 새 순수 로직은 **lib.js(또는 price/routing/sync)에 넣고 여기서 테스트**한다
- `test/integration.test.js` — jsdom에 실제 `index.html`+`lib.js`+`sync.js`+`routing.js`+`price.js`+`app.js`를 올려 **배선**을 검증 (anchor/carry 혼동, 엔진 전환, 구간 수단 등). jsdom이 없으면 자동 skip되므로 `npm install`을 잊지 말 것
- `e2e/` — jsdom이 못 잡는 **실제 조작**(클릭·드래그·메뉴·PWA)을 검증한다. 느린 CI에서만 드러나는 문제가 있으므로 로컬 통과만 믿지 말 것
- 실 API 키가 필요한 테스트(`metasearch.integration`)는 키가 없으면 자동 skip된다
- **`lib.js`·`sync.js`·`routing.js`·`price.js`에 추가하는 함수는 JSDoc 타입이 필요**하다 (`npm run check:types`)

## 로컬 실행

서비스 워커·API 키 도메인 제한 때문에 **8000 포트**의 http 서버로 열어야 한다 (다른 포트는 지도·검색이 403):

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 보안 주의

- 공유 링크·가져오기·AI 파싱으로 **외부 데이터가 유입**된다. 사용자 데이터를 `innerHTML`로 출력할 때는 반드시 `esc()`로 이스케이프한다 (XSS 방어).
- **URL을 `href`에 넣을 때는 `safeUrl()`을 쓴다.** `esc()`는 스킴을 막지 못해 `javascript:` 링크가 그대로 통과한다.

## 운영 팁

- Google Cloud 콘솔 결제 예산 알림(예: 월 $5)과 API 사용량 대시보드를 주기적으로 확인할 것 — 키가 정적 HTML에 노출되므로 도메인 제한 유지가 필수.
- 검색 실패는 원인별로 구분해 보여준다(`classifySearchErr`: 인증·할당량·네트워크·무결과). 상세 코드는 콘솔에만 남는다.
