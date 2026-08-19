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

- [ ] `sw.js`의 `VER` 값 올리기 + `index.html`의 `?v=` 쿼리도 **같은 값**으로 (안 올리면 stale 캐시로 변경이 반영 안 됨)
- [ ] `node --test` 통과 확인 (아래 **테스트** 참고)
- [ ] 푸시 후 폰에서 실제 동작 확인 — ☰ 메뉴 하단의 **버전 표시**로 새 버전이 적용됐는지 먼저 볼 것 (캐시된 옛 버전이면 그 글자를 탭해 갱신)

## 구조

- `index.html` — 마크업 (모달·헤더·재생 HUD 등)
- `app.js` — 앱 로직 전체 (DOM·지도·네트워크)
- `lib.js` — 순수 로직 (파서·거리·시각·앵커·타임라인·정규화). **유닛 테스트 + `tsc` 타입 검사 대상**
- `style.css` — 스타일
- `sw.js` — 서비스 워커 (앱 셸 캐시)
- `manifest.json` · `icon-*.png` — PWA
- `test/` — `pure.test.js`(lib 순수 함수) · `integration.test.js`(jsdom으로 app.js 배선 검증)
- `proto/` — 실험용 프로토타입 (`maplibre-play.html`). 프로덕션 앱과 무관
- `.github/workflows/ci.yml` — 구문 검사 → `tsc`(lib.js) → `node --test`

라이브러리(CDN): 지도 듀얼 엔진 — 해외 Google Maps JS SDK · 국내 카카오맵 JS SDK · LZString(공유 링크 압축) · SortableJS(드래그) · Supabase(로그인/클라우드 동기화)
검색: 국내 카카오 로컬 · 해외 Google Places (`routedSearch`가 라우팅) · 저장: localStorage + Supabase
API 키: app.js 상단 `GMAPS_KEY`(리퍼러 제한)·`KAKAO_KEY`(JS, 플랫폼 도메인 제한)는 브라우저용. Kakao Mobility REST 키는 서버 전용 `KAKAO_REST_API_KEY` 환경변수로만 관리한다. 로컬에서 국내 자차 경로까지 확인하려면 `vercel dev --listen 8000`을 사용한다.
localStorage: `tripcanvas_v1`(여행) · `tripcanvas_legs_v4`(구간 캐시, 수단별 키) · `tripcanvas_synced` · `tripcanvas_cfg` · `tripcanvas_fx`
주의: Google 약관상 지도 타일 캐시 금지 → 오프라인 지도 기능 없음 (SW는 앱 셸만 캐시)

## 핵심 개념 (배선 실수가 잦은 곳)

**출발 기준점은 한 함수가 결정한다.** 지도 일자 간 점선·재생·ETA·사이드바·여행 모드가 각자 추론하면 안 된다.

- `dayAnchor(day)` (lib) — 그 날의 종료 기준점: 마지막 숙소 → 없으면 마지막 위치 장소
- `dayStartAnchor(days, di)` (lib) — di일이 **이월받는 출발점**. 숙소 연박(`nights`) 범위를 먼저 보고, 없으면 직전 유효 일자의 `dayAnchor`. `startPolicy:'none'`이면 이월 없음(공항 이동일·야간열차)
- `dayContext(di)` (app) — `{day, anchor, carry, timeline, mode}`를 한 번에 반환. **사이드바·여행 모드·이미지 내보내기는 이걸 쓴다**
- ⚠️ `anchor`와 `carry`를 혼동하지 말 것: **ETA·종료시각 계산은 `anchor`**(숙소가 아니어도 전날 마지막 장소 반영), **화면의 🏠 "전날 숙소" 항목 표시만 `carry`**(숙소일 때만)

**이동수단은 일자 기본 + 구간별 재정의.** `legModeOf(day, spot)` — 도착 장소의 `legMode`가 있으면 그것, 없으면 일자 기본. (첫날을 비행기로 둬도 도시 내 이동까지 비행기가 되지 않게)
수단: 자차 · 택시 · 대중교통 · 기차 · 도보 · 자전거 · 비행기.
라우팅(`fetchLeg`): 비행기·기차는 **직선거리 기반 추정**(실시간 시각표 없음) · 국내 자차/택시=카카오내비(도로 없으면 인근 도로 스냅) · 국내 대중교통=Google Routes TRANSIT · 국내 도보/자전거=카카오 도로거리 기반 추정 · 해외=Google Routes

**시간 3종을 구분한다.** 도착 **예상**(자동 계산) / `at` 도착 **고정**(내가 정한 계획) / `bookAt` **예약·입장 시각**(상대가 정한 약속 — 일찍 도착하면 그 시각까지 대기로 계산, 늦으면 ⚠️).

**유입 데이터는 반드시 정규화한다.** 가져오기·공유 링크(`#v=`/`#t=`)·클라우드·로컬 로드 **5개 지점 모두** `normalizeTrip()`(lib)을 통과시킨다. 좌표·시각·통화·수단·`startPolicy`를 검증하고 알 수 없는 값은 기본값으로 폴백해 렌더 크래시를 막는다(`schemaVersion` 스탬프).

## 테스트

```bash
npm install     # 최초 1회 (jsdom — 통합 테스트용)
node --test     # 순수 + 통합 테스트
```

- `test/pure.test.js` — lib.js 순수 함수. 새 순수 로직은 **lib.js에 넣고 여기서 테스트**한다
- `test/integration.test.js` — jsdom에 실제 `index.html`+`lib.js`+`app.js`를 올려 **배선**을 검증 (anchor/carry 혼동, 엔진 전환, 구간 수단 등). jsdom이 없으면 자동 skip되므로 `npm install`을 잊지 말 것
- CI(`ci.yml`)는 구문 검사 → `tsc`로 lib.js JSDoc 타입 검사 → 테스트를 돌린다. **lib.js에 추가하는 함수는 JSDoc 타입이 필요**하다

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
