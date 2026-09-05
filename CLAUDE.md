# Trip Canvas — 작업 가이드

대화로 만드는 멀티시티 여행 동선 플래너 (정적 PWA). 빌드 도구 없음 — 파일 그대로 배포.

## Git 워크플로 (중요)

- **작업은 `main`에 직접 커밋·푸시한다.** 별도 브랜치·PR 없이 바로 반영한다.
- ⚠️ `main` 푸시는 Vercel 자동 배포와 연결돼 있어 **커밋 즉시 프로덕션(`tripcanvas-ai.vercel.app`)에 나간다.** 푸시 전에 변경을 스스로 검토하고, 아래 **릴리스 체크리스트**를 반드시 지킬 것.
- **여러 기기(집·회사)에서 작업한다.** 세션 시작·커밋 전에 `git fetch`로 `origin/main`이 앞서 있는지 확인하고, 뒤처졌으면 `git pull --ff-only` 후 작업한다.
- **커밋 메시지 제목은 명사형으로 끝낸다.** `… 기능 추가` · `… 오류 수정` · `… 규칙 정리` 처럼 맺는다. `추가한다`·`고쳤다` 같은 서술형 어미로 끝내지 않는다. (본문은 서술형으로 써도 된다 — 제목만 명사형)

## 배포

- 원격 `main` 푸시 시 **Vercel 자동 배포** (프로젝트 `tripcanvas`, 프로덕션 `tripcanvas-ai.vercel.app`).
- ⚠️ **API는 이제 NAS다**(2026-09-04 전환). 웹이 부르는 주소는 `https://bokbok9.tail8b977f.ts.net`(Tailscale Funnel이 HTTPS를 붙인다)이고 데이터는 NAS PostgreSQL이다. Vercel에는 정적 웹만 남았고, `tripcanvas-api` 프로젝트는 **롤백 대상**으로 남겨 두었다(여전히 Supabase를 본다). 전환 스위치는 `api.js`·`auth.js`의 `DEFAULT_BASE` 두 줄이다 — `docs/nas-deployment.md`.
- ⚠️ 그래서 **가용성이 집 NAS에 걸린다.** NAS가 꺼지거나 Tailscale이 끊기면 저장이 안 된다(로컬 편집은 보존된다). iOS(`TCApiBaseURL`)도 같은 주소로 옮겼다.
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
- [ ] 푸시 후 폰에서 실제 동작 확인 — ☰ 메뉴 하단의 **버전 표시**로 새 버전이 적용됐는지 먼저 볼 것 (캐시된 옛 버전이면 그 글자를 탭해 갱신)

## 구조

- `index.html` — 마크업 (모달·헤더·재생 HUD 등)
- `app.js` — 앱 로직 전체 (DOM·지도·네트워크)
- `lib.js` — 순수 로직 (파서·거리·시각·앵커·타임라인·정규화). **유닛 테스트 + `tsc` 타입 검사 대상**
- `price.js` — 예약 가격 추적 순수 계산: 실질 절약액·오퍼 조건 매칭(EXACT/EQUIVALENT/SIMILAR)·확정/잠재 절약 판단·호텔 identity 점수 · 렌터카 조건 매칭(carMatchQuality — 차급·변속기·보험·주행거리가 다르면 확정 절약 금지). 예약(`trip.bookings`)은 여행 데이터로 동기화·공유되고, 가격 관측 기록은 기기 로컬 + 로그인 시 **`/api/v1/trips/:id/prices`**(여행과 같은 저장소·같은 권한. 2026-09-04 전환 전에는 Supabase `hotel_price_snapshots` 직접 경로였다). 시세는 `api/hotel-offers.js` 프록시(Metasearch 키 서버 전용)로만 조회 — 키 없으면 미연결 상태를 그대로 표시(가짜 가격 금지). **유닛 테스트 + `tsc` 대상**
- `adaptive.js` — **Adaptive Travel OS 도메인**(순수): 현재 여행 상태(`buildTripState`) · 고정/유동 분류(`commitmentOf`) · 빈 시간 탐지(`findFreeWindows`) · 다음 행동 후보와 순위(`buildCandidates`/`rankNextActions`) · 일정 재구성(`generateReplan`) · 제안(`buildSuggestions`) · 자연어 해석(`parseIntent`) · 출발 안내(`departureAdvice`) · 빈칸 채우기와 하루 flow(`fillGaps`/`planDayFlow`). DOM·네트워크·현재시각을 모르고 전부 인자로 받는다. **유닛 테스트 + `tsc` 대상**
- `intake.js` — **유입 계층**(순수): 공유 분류(`classifyShare`) · 날짜/통화 정규화 · 예약 후보 파싱(`parseBookingCandidate`) · 중복(`findDuplicateBooking`) · 여행 매칭(`matchTripForBooking`) · 기록 연결(`associateMemory`). **저장은 하지 않는다** — 확인한 것만 저장된다. **유닛 테스트 + `tsc` 대상**
- `collab.js` — **함께하기(협업)** 순수 로직: 역할 판정(`canEdit/canManage/canLeave/canDelete`) · 초대 링크 만들기/읽기(`#join=`) · 초대 판정 문구 · 권한 오류 판별 · **후보 장소와 반응**(집계 `tallyReactions` · 상태 `candidateMood` · 보드 묶음 `groupCandidates` · `canPropose/canReact/canRemoveCandidate`) · **활동 기록과 실시간**(문장 `activityText` · 묶음 `condenseActivity` · 이벤트 판정 `liveEffects` · 코멘트 권한) · **여행 취향과 합의**(`normPrefs` 서버와 같은 규칙 · `groupContext` · `consensusOf` 점수는 내부값 · `candidateVerdict`) · **충돌과 제안**(`candidateConflict` · `conflictOptions` · `buildGroupProposal` 미리보기). 접근 제어의 경계는 DB(RLS·RPC)고 여기는 화면 판정만. **유닛 테스트 + `tsc` 대상**
- `style.css` — 스타일
- `api.js` — **TripCanvas API 클라이언트**(여행 동기화·함께하기·버전 이력·역할·실시간). `TC_API.sync`는 예전 `sync_trip`/`tombstone_trip`의 반환 모양(`{applied,conflict,revision,data,deleted_at}`)을 그대로 재현한다 — app.js의 CAS·충돌 로직을 건드리지 않기 위해서다. `{data,error}`를 돌려주고 예외를 던지지 않으며, 서버의 `FORBIDDEN`을 Supabase가 주던 `42501`로 옮겨 기존 권한 처리가 그대로 돌게 한다. 초대 미리보기만 토큰 없이 나간다. **유닛 테스트 + `tsc` 대상**
- `auth.js` — **인증 클라이언트**(PR11). Supabase Auth와 자체 Auth를 같은 모양으로 감싼다 — `{data,error}`에 **코드**(`INVALID_CREDENTIALS`·`EMAIL_NOT_VERIFIED`·`RATE_LIMITED`·`NETWORK`)를 실어 화면이 제공자별 문구를 모르게 한다. 로그인 상태 변화는 `onChange` 하나로 나간다(예전 `onAuthStateChange` 자리). ⚠️ **어느 Auth를 쓸지는 서버가 정한다**(`GET /api/v1/auth-config`) — 답이 없으면 SUPABASE로 남아 오늘의 동작이 이어진다. 자체 Auth 세션은 bearer 토큰(`tripcanvas_auth_v1`)이다: 교차 출처라 쿠키를 쓰지 않는다. **유닛 테스트 + `tsc` 대상**
- `sync.js` — 클라우드 동기화(리비전 CAS·충돌·tombstone). **`tsc` 대상**
- `routing.js` — 경로 조회 transport 격리 (app.js는 `fetchLeg` 호환 shim만 씀). **`tsc` 대상**
- `sw.js` — 서비스 워커 (앱 셸 캐시). `/api/`와 GET 외 요청은 건드리지 않는다
- `manifest.json` · `icon-*.png` — PWA
- `api/` — Vercel 서버 함수(**서버 전용 키**): `kakao-directions.js`(카카오내비 프록시) · `hotel-offers.js`(호텔 시세 메타서치 프록시) · `car-offers.js`(렌터카 시장가 프록시 — Provider 미연결 시 AUTH_REQUIRED, 수동 관측 fallback) · `track-hotel-prices.js`(가격 스냅샷 크론)
- `supabase/migrations/` — RLS·동기화 무결성·가격 스냅샷·추천 반응 기록·기기 토큰/발송 기록·여행 기록·**함께하기(멤버·초대·역할 RLS · 후보 장소·반응 · 코멘트·활동 기록·실시간 퍼블리케이션 · 여행별 멤버 취향 · 후보 결정 REJECT/REOPEN)** 스키마
- `ios/` — **네이티브 iOS 앱(SwiftUI)** + `TripCanvasWidgets`(위젯·Live Activity 확장) + `TripCanvasShared`(App Group 공유 상태). 웹은 여행을 *계획*하고, iOS는 여행을 *실행*한다. **로그인은 웹과 같은 자체 Auth**(`/api/auth/*`, bearer 세션 · Keychain `withj.auth.session.v1`)다 — Supabase GoTrue 직접 호출은 없앴다(2026-09-05). refresh 그랜트가 없어 401은 `get-session`으로 확인하고, 예전 Supabase 세션은 **변환하지 않고 지운 뒤 한 번 다시 묻는다**. 판단 로직을 Swift로 복제하지 않는다 — `/api/v1`이 준 결과를 그리기만 한다. 계획 화면도 **네이티브로 옮겼다**(일정 편집 `Features/Plan` · 지도·검색 `Features/Map` · 예약 편집 `Features/Booking` · 함께하기 `Features/Collab`). 예약은 문서의 `trip.bookings`라 장소와 같은 CAS 저장 경로를 쓰고, 검증은 웹 `bkSave`와 같은 규칙이다(`TripBooking.swift`). 함께하기는 `/api/v1`의 멤버·초대·후보·코멘트·활동·취향 라우트를 그대로 쓰고 판정은 `CollabModel.swift`(`collab.js`의 복사본 — 규칙을 바꿀 때 `collab.js`를 먼저 고친다)에 모여 있다. 후보를 일정에 넣을 때는 문서 저장이 먼저고 후보 표시가 그다음이며, 표시가 실패해도 일정에는 들어갔다고 말한다. 초대 링크는 웹 주소로 만든다(받는 사람에게 앱이 없을 수 있다). 앱에는 아직 실시간이 없다 — 당겨서 새로고침한다. 지도는 웹과 같은 듀얼 엔진(국내 카카오맵 SDK · 해외 Google Maps SDK — 처음 들어온 외부 의존성, SPM)이고 키는 **번들 ID로 제한된 네이티브 키**(`TCGoogleMapsKey`·`TCKakaoNativeKey`)다. 국내 검색은 카카오 REST 키를 앱에 못 넣어 서버 `GET /api/v1/places/search`를 지나고, 해외 검색은 iOS 키로 Places API(New)에 직접 묻는다(`ios/README.md` 표). 여행 문서는 아는 필드만 담은 구조체로 디코딩하지 않고 **원문 트리(`JSONValue`)로 들고 아는 필드만 덮어 쓴다** — 그러지 않으면 웹이 쓰는 `who`·`split`·`hours` 같은 필드가 앱 저장 한 번에 사라진다. 저장은 `PUT /api/v1/trips/:id`(revision CAS)이고 실패하면 화면을 되돌린다. 빌드·XCTest는 CI가 시뮬레이터로 본다(`.github/workflows/ios.yml`, `ios/` 변경 시에만 — macOS 러너는 10배 과금). **staging API로도 확인됐다**(2026-09-04 — `TCApiBaseURL`을 터널로 돌려 로그인·여행 목록·오늘 화면). 서명·실기기·푸시·위젯 실제 표시는 여전히 기기에서만 확인된다 (`ios/README.md` · `docs/ios-device-setup.md`)
- `next/src/server/` — **독립 Backend**(Supabase 이관 중, `docs/backend-architecture.md` · `docs/supabase-migration.md`): `auth/`(Supabase JWT 직접 검증 → `RequestContext`) · `api/`(오류 계약 · Trip 라우트) · `application/`(TripService · TripAuthorizationService — RLS 대체) · `repositories/`(인터페이스 · dual read · memory) · `auth/`에 **자체 Auth**(better-auth — `/api/auth/*`, 이메일 확인·세션·재설정. `users.auth_user_id`로 도메인 사용자와 잇고 **확인된 이메일로만** 연결한다) · `infrastructure/mail/`(SMTP 어댑터·쿨다운) · `infrastructure/database/`(Drizzle 스키마 · 마이그레이션 · PostgreSQL Repository, 테스트는 PGlite) · `infrastructure/supabase/`(레거시 경로) · `migration/`(Supabase → 새 DB 데이터 이관·검증. `npm run migrate:import`, 절차는 `docs/backup-restore.md`) · `realtime/`(**WebSocket 사이드카** — `trip_activity` 트리거의 `pg_notify`를 LISTEN해 중계한다. 별도 프로세스: `npm run tools:build && npm run realtime`. 페이로드는 신호뿐이고 내용은 API로 다시 읽는다. ⚠️ CommonJS로 컴파일되므로 ESM 전용인 better-auth를 import하지 않는다 — 자체 Auth 세션은 `auth/sessionTokenVerifier.ts`가 **DB로** 판정한다(서명까지 확인해 API와 같은 기준). API와 **같은 `AUTH_SECRET`**을 써야 하고, 다르면 아무도 실시간에 못 붙는다). Route Handler에 비즈니스 로직을 두지 않는다. 이관 레지스트리 `TC_MIGRATION_<DOMAIN>`(기본 LEGACY, `DATABASE_URL` 없으면 강제 LEGACY)이 요청마다 저장소를 고른다. `deploy/`(docker-compose · Caddy · 백업)는 **미검증**(`docs/nas-deployment.md`)
- `next/src/features/trip-state/` — 웹·iOS 공통 API 계층. `contract.ts`(단일 출처 계약) · `todayView.ts`(엔진 결과를 계약 모양으로) · `mutations.ts`(문서 변경 순수 함수) · `handlers.ts`(주입 가능한 라우트 핸들러) · `supabaseGateway.ts`(RLS 아래 읽기·쓰기)
- `scripts/` — `bump-version.js` · `check-version-sync.js` · `check-secrets.js` · `verify-all.sh`(릴리스 게이트를 로컬에서 통째로 — `docs/ci.md`)
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

**렌터카 픽업·반납은 일정에 '표시만' 한다.** 픽업·반납 장소는 자유 텍스트라 **좌표가 없다** → 동선·ETA·앵커·지도에는 넣지 않는다. 표시 경로가 둘이다:

- **일정의 장소와 연결했을 때** — `carSpotLinks(days)` (lib)가 `spot.carPickupId`·`spot.carReturnId`를 역참조한다. 그 장소 행에 `.carbkChip`으로 붙는다. **비행기로 도착한 뒤 그 공항에서 픽업하는 경우가 흔해서**, 연결 없이는 픽업이 도착보다 위에 찍힌다 — 순서를 맞추려면 이 연결을 쓴다. 장소 복사(`copySpot`)는 연결을 떼어낸다(차를 받는 곳은 한 곳).
- **연결 안 했을 때** — `carEventsOn(bookings, iso)` (lib)가 날짜로 파생해 `.spot.carbk` 독립 행으로. 픽업은 장소 목록 앞·반납은 뒤(숙소 복귀 앞). 연결된 이벤트는 이 목록에서 뺀다.

시각은 ETA 칸이 아니라 메타 줄에 — ETA 칸은 '그날 계산된 도착 예상 순서'를 뜻하는데 이 항목은 그 순서에 속하지 않는다. 드래그 인덱스가 어긋나므로 독립 행은 `.spotList` 안에 넣지 않는다.

**당일 대여(픽업일=반납일)는 정상이다.** 체크아웃 규칙(`start>=end` 거부)을 렌터카에 쓰지 않는다 — 같은 날이면 픽업·반납 **시각**이 앞뒤를 가른다(시세 조회도 `pickupAt<returnAt`만 본다).

**반납 지점은 (장소, 공항코드) 한 쌍이다.** `carReturnPoint(b)` (lib) — 둘 중 하나라도 입력돼 있으면 그게 내가 정한 반납 지점이라 픽업에서 물려받지 않는다. 둘 다 비었을 때만 픽업과 동일. **표시(`carEventsOn`)와 시세 조회(`CarMarketProvider`)가 같은 함수를 쓴다** — 반쪽만 물려받으면 `서귀포점 (CJU)` 같은 표기가 나오고, 편도 반납인데 픽업 공항의 시세를 조회하게 된다.

**이동수단은 일자 기본 + 구간별 재정의.** `legModeOf(day, spot)` — 도착 장소의 `legMode`가 있으면 그것, 없으면 일자 기본. (첫날을 비행기로 둬도 도시 내 이동까지 비행기가 되지 않게)
수단: 자차 · 택시 · 대중교통 · 기차 · 도보 · 자전거 · 비행기.
라우팅(`fetchLeg`): 비행기·기차는 **직선거리 기반 추정**(실시간 시각표 없음) · 국내 자차/택시=카카오내비(도로 없으면 인근 도로 스냅) · 국내 대중교통=Google Routes TRANSIT · 국내 도보/자전거=카카오 도로거리 기반 추정 · 해외=Google Routes

**비용은 '하루치'와 '총액'을 구분한다.** 장소 비용(`spot.cost`)·택시비는 그날 쓰는 돈이지만, 예약(숙박·렌터카·항공)은 여러 날에 걸친 총액이다.

- **일자 카드 하루 비용** = 장소 + 택시 + `bookingShareOn(bookings, iso)` (lib)로 날수를 나눈 예약 하루치. 숙박은 `[체크인, 체크아웃)`(체크아웃 날엔 숙박비 없음), 렌터카·항공은 `[시작, 종료]` 양끝 포함. 나머지는 앞날부터 1원씩 얹어 하루치의 합이 총액과 정확히 맞는다.
- **필터바 전체 비용** = `tripCostBreakdown()` (app) — 장소 + 택시 + 예약 **전액**. 예약 기간이 일정 밖으로 나가면 하루 합계보다 크다(전체가 실제 총액).

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
- 서버에는 구간 캐시가 없어 이동시간이 **직선거리 추정**이다. 응답의 `travelTimeSource`로 그 사실을 실어 보내고 클라이언트가 "예상"이라고 표기한다.
- 제안 거절은 `suggestion_feedback` 테이블(RLS)에 날짜와 함께 남는다 — 기기가 바뀌어도 같은 제안이 그날 다시 올라오지 않는다. ⚠️ 레거시 웹은 아직 localStorage를 쓴다(양쪽이 아직 공유되지 않음).
- `next`의 `swiftParity.test.ts`가 **실제 Today 응답 ↔ `ios/.../Contract.swift`** 를 맞춰 보고 `ios/TripCanvasTests/Fixtures/today.json`을 다시 만든다. 계약을 바꾸면 여기가 먼저 깨진다.

**Adaptive Travel OS — 상태 → 제안 → 반영은 한 패턴이다.** 일정 추천·일정 재구성·가격 절약이 각자 다른 흐름을 만들면 안 된다.

- 판단은 전부 `adaptive.js`(순수)에 있고 `app.js`는 배선·표시만 한다. 시각·이동시간·영업요일은 **인자로 주입**한다 → 같은 상태면 항상 같은 추천(렌더마다 순서가 바뀌면 안 됨).
- `adaptState(di)`(app)는 `dayContext(di)`의 `anchor`·`timeline`을 **그대로** 넘긴다. 추천이 출발 기준점을 따로 추론하면 화면과 다른 숫자를 말하게 된다.
- 일정 성격: `bookAt`(상대가 정한 약속)·항공·기차 = **FIXED(침범 금지)** · `at`(내가 정한 시각)·숙소·렌터카 = SEMI_FIXED · 나머지 = FLEXIBLE. 재구성은 **고정 보호 → 완료 유지 → `must` 보호 → 낮은 우선순위(`opt`)부터 제거** 순서를 지킨다.
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
- 웹: `readOnly()`/`guardEdit()`가 `#v=` 읽기전용과 VIEWER를 한 곳에서 판단한다 — **편집 진입점을 새로 만들면 반드시 이걸 거친다.** 로그아웃·로컬 전용 여행은 항상 소유자(`roleOf`)라 혼자 쓰는 여행은 예전 그대로다.
- 초대 링크는 `#join=<token>` 하나다. 미리보기(`invite_preview`, anon 가능)는 이름·기간·역할까지만 주고, 본문은 `accept_trip_invite`로 멤버가 된 뒤 RLS 아래에서 내려온다. 공유받은 여행의 "삭제"는 `leave_trip`이다.
- 실시간은 `trip_activity` 이벤트로 온다(아래). `pullTrip`은 여전히 폴백이다 — 탭 복귀·패널 열기에 최신본을 당기고, 로컬 편집이 있으면 기존 충돌 카드로 넘긴다(조용히 덮어쓰지 않는다).

**후보 장소(가고 싶은 곳)는 아직 일정이 아니다.** 여행 문서가 아니라 `trip_candidates`·`candidate_reactions`에 산다 — 넷이 동시에 하트를 눌러도 리비전 CAS가 서로를 걷어차지 않고, **보기 권한도 의견은 낼 수 있어야** 하고, 한 사람 한 표를 DB(`unique`)가 보장해야 하기 때문이다.

- 한 줄 규칙: **보기 권한은 의견만 낸다 — 여행에 내용을 만들지는 않는다.** 반응(MUST/OK/PASS)은 활성 멤버 전원, 후보 추가·일정 반영은 EDITOR 이상. 후보를 **빼는** 기준은 역할이 아니라 '누가 냈는가'다(제안자 또는 소유자).
- 두 테이블 모두 **읽기 정책만** 있고 쓰기 정책은 없다 — 변경은 전부 RPC(security definer)를 지난다. `add_trip_candidate` · `list_trip_candidates` · `react_to_candidate`(멱등 upsert, `null`이면 거두기) · `manage_trip_candidate`.
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
