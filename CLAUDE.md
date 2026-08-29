# Trip Canvas — 작업 가이드

대화로 만드는 멀티시티 여행 동선 플래너 (정적 PWA). 빌드 도구 없음 — 파일 그대로 배포.

## Git 워크플로 (중요)

- **작업은 `main`에 직접 커밋·푸시한다.** 별도 브랜치·PR 없이 바로 반영한다.
- ⚠️ `main` 푸시는 Vercel 자동 배포와 연결돼 있어 **커밋 즉시 프로덕션(`tripcanvas-ai.vercel.app`)에 나간다.** 푸시 전에 변경을 스스로 검토하고, 아래 **릴리스 체크리스트**를 반드시 지킬 것.
- **여러 기기(집·회사)에서 작업한다.** 세션 시작·커밋 전에 `git fetch`로 `origin/main`이 앞서 있는지 확인하고, 뒤처졌으면 `git pull --ff-only` 후 작업한다.

## 배포

- 원격 `main` 푸시 시 **Vercel 자동 배포** (프로젝트 `tripcanvas`, 프로덕션 `tripcanvas-ai.vercel.app`).
- 커밋 author 이메일은 반드시 **GitHub 계정과 매칭되는 유효한 주소**여야 한다 (`blackshoes85@gmail.com`).
  `.local` 등 로컬 호스트 기반 자동 이메일이면 Vercel이 배포를 거부한다.

## 릴리스 체크리스트

- [ ] `npm run bump:version` 으로 버전 올리기 (`sw.js`의 `VER`과 `index.html`의 `?v=`를 함께 갱신 — 안 올리면 stale 캐시로 변경이 반영 안 됨). `npm run check:version` 으로 동기 확인
- [ ] **아래 검사를 전부** 통과시킬 것 — 특히 `npm run test:e2e`를 빼먹지 말 것 (유닛·통합만 돌리고 배포했다가 실제 조작이 깨진 회귀를 낸 적이 있다)

```bash
npm test && npm run lint && npm run check:types && npm run security:scan && npm run test:e2e
```

- [ ] 푸시 후 폰에서 실제 동작 확인 — ☰ 메뉴 하단의 **버전 표시**로 새 버전이 적용됐는지 먼저 볼 것 (캐시된 옛 버전이면 그 글자를 탭해 갱신)

## 구조

- `index.html` — 마크업 (모달·헤더·재생 HUD 등)
- `app.js` — 앱 로직 전체 (DOM·지도·네트워크)
- `lib.js` — 순수 로직 (파서·거리·시각·앵커·타임라인·정규화). **유닛 테스트 + `tsc` 타입 검사 대상**
- `price.js` — 예약 가격 추적 순수 계산: 실질 절약액·오퍼 조건 매칭(EXACT/EQUIVALENT/SIMILAR)·확정/잠재 절약 판단·호텔 identity 점수 · 렌터카 조건 매칭(carMatchQuality — 차급·변속기·보험·주행거리가 다르면 확정 절약 금지). 예약(`trip.bookings`)은 여행 데이터로 동기화·공유되고, 가격 관측 기록은 기기 로컬 + 로그인 시 `hotel_price_snapshots`. 시세는 `api/hotel-offers.js` 프록시(Metasearch 키 서버 전용)로만 조회 — 키 없으면 미연결 상태를 그대로 표시(가짜 가격 금지). **유닛 테스트 + `tsc` 대상**
- `style.css` — 스타일
- `sync.js` — 클라우드 동기화(리비전 CAS·충돌·tombstone). **`tsc` 대상**
- `routing.js` — 경로 조회 transport 격리 (app.js는 `fetchLeg` 호환 shim만 씀). **`tsc` 대상**
- `sw.js` — 서비스 워커 (앱 셸 캐시). `/api/`와 GET 외 요청은 건드리지 않는다
- `manifest.json` · `icon-*.png` — PWA
- `api/` — Vercel 서버 함수(**서버 전용 키**): `kakao-directions.js`(카카오내비 프록시) · `hotel-offers.js`(호텔 시세 메타서치 프록시) · `car-offers.js`(렌터카 시장가 프록시 — Provider 미연결 시 AUTH_REQUIRED, 수동 관측 fallback) · `track-hotel-prices.js`(가격 스냅샷 크론)
- `supabase/migrations/` — RLS·동기화 무결성·가격 스냅샷 스키마
- `scripts/` — `bump-version.js` · `check-version-sync.js` · `check-secrets.js`
- `test/` — 순수·통합·API 테스트 (`pure` · `integration` · `price` · `routing` · `sync` · `api-*` · `migration`)
- `e2e/` — Playwright 시나리오 (`core-flows` · `pwa` · `accessibility` · `ux-wireframe`)
- `proto/` — 실험용 프로토타입. 프로덕션 앱과 무관
- `.github/workflows/ci.yml` — **Quality**(구문 → 버전 동기 → lint → 시크릿 스캔 → `tsc` → 유닛 → 통합 → `npm audit`) + **E2E**(Playwright) 두 잡

라이브러리(CDN): 지도 듀얼 엔진 — 해외 Google Maps JS SDK · 국내 카카오맵 JS SDK · LZString(공유 링크 압축) · SortableJS(드래그) · Supabase(로그인/클라우드 동기화)
검색: 국내 카카오 로컬 · 해외 Google Places (`routedSearch`가 라우팅) · 저장: localStorage + Supabase
지도에서 장소 담기: 해외는 `clickableIcons`로 POI 탭 시 `placeId`를 그대로 받고, **국내는 카카오 SDK가 POI 탭 신원을 주지 않아** 카테고리 검색으로 POI 칩을 직접 깔아 그걸 누르게 한다(`refreshKakaoPOI`). 좌표 역추적(`reverseSpot`)은 둘 다 실패했을 때의 최후 수단이다 — 추측이라 엉뚱한 상호가 들어갈 수 있다.
API 키: app.js 상단 `GMAPS_KEY`(리퍼러 제한)·`KAKAO_KEY`(JS, 플랫폼 도메인 제한)·`KAKAO_REST_KEY`(카카오내비) — `localhost:8000`, `tripcanvas-ai.vercel.app` 등록 필요
localStorage: `tripcanvas_v1`(여행) · `tripcanvas_legs_v4`(구간 캐시, 수단별 키) · `tripcanvas_synced` · `tripcanvas_prices_v1`(예약 가격 관측 기록) · `tripcanvas_cfg` · `tripcanvas_fx`
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

**시간 3종을 구분한다.** 도착 **예상**(자동 계산) / `at` 도착 **고정**(내가 정한 계획) / `bookAt` **예약·입장 시각**(상대가 정한 약속 — 일찍 도착하면 그 시각까지 대기로 계산, 늦으면 ⚠️).

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
