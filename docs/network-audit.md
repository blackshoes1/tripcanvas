# 네트워크 호출 감사 (2026-09-18)

읽기 전용 감사다. 아래는 전부 코드에서 확인한 사실이고, 추정은 "추정"이라고 적었다. 서버 영속성·DB 변경은 다루지 않는다.
**아직 고친 것은 없다** — 무엇을 줄일 수 있는지의 목록이다. 고칠 때 이 문서의 표를 갱신한다.

## 1. iOS — 화면·이벤트별 호출

| 화면·모델 | 엔드포인트 | 트리거 | 캐시·신선도 가드 |
|---|---|---|---|
| RootView | `GET /api/auth/get-session` | 앱 기동 `.task` (`App/TripCanvasApp.swift:32`) | 1회 (`AuthStore.swift:287-297`) |
| TripListView / TripListViewModel | `GET /api/v1/trips` | 목록 appear `.task` (`Features/Trips/TripListView.swift:188-197`), pull-to-refresh(`:377`), 여행 생성·초대 수락 후(`:215`,`:227`) | **신선도 가드 없음**(`:101-112`). 오프라인 시 디스크 캐시(`Services/TripService.swift:66-75`) |
| TodayView / TodayViewModel | `GET /trips/:id/today` | 탭 진입 `.task`→`loadIfStale(60)` (`Features/Today/TodayView.swift:136-140`), **scenePhase `.active` → 무조건 `load()`** (`:141-143`), pull-to-refresh(`:135`), 충돌 후 재조회(`TodayViewModel.swift:189`) | `loadIfStale`(`TodayViewModel.swift:70-75`) + 디스크 캐시 선표시(`:85-88`). scenePhase 경로만 가드 없음 |
| TodayView → TravelMode | `GET /trips/:id/travel-state` | `loadIfStale`가 실제로 서버를 물었을 때만(`TodayView.swift:139`), scenePhase active(`:142`→`:164-167`), `model.revision` 변화(완료·건너뛰기)마다(`:144-146`), 오류 배너 재시도(`:195`). 여행 중 + 같은 여행일 때만(`:170`) | **타이머 폴링 없음**(`Features/TravelMode/TravelModeController.swift:78-84`), `isRefreshing` 가드(`:85`). 오프라인이면 디스크 캐시(`TripService.swift:220-224`) |
| Today 변경 | `POST .../activities/:id/{complete,skip,reset}`, `POST .../suggestions/{accept,skip}` | 버튼 탭 | 응답에 최신 today 동봉 → **재조회 없음**(`TripService.swift:172-189`) |
| TripPlanView / TripPlanViewModel | `GET /trips/:id` (문서) | 탭 진입 `loadIfStale(60)`(`Features/Plan/TripPlanView.swift:92-95`), pull-to-refresh(`:438`), 오류 재시도(`:189`), 충돌 후 reload(`TripPlanViewModel.swift:407-410`) | `loadIfStale`(`TripPlanViewModel.swift:167-170`) |
| 〃 | `GET /trips/:id/days/:i` | `load()` 끝(`TripPlanViewModel.swift:188`), **`selectedDay` didSet = 일자 칩 탭·스와이프마다**(`:46-51`), 저장 성공 직후(`:518`), `legsPending>0`이면 3초 뒤 1회(`:286-301`) | `plansByDay` 메모는 **그리기용일 뿐** — 조회는 무조건 나간다(`:202-234`) |
| 〃 프리페치 | `GET days/i±1` | 하루치 수신 직후(`:242-248`) | 같은 날 중복 방지(`:244`), 그러나 그 날로 이동하면 다시 조회된다 |
| 〃 전체 지도 | `GET /trips/:id/routes` | 지도 탭 + '전체' 범위 + 화면에 보일 때(`TripPlanView.swift:541-543`) | `tripRoutes==nil` 가드(`TripPlanViewModel.swift:306`), legsPending 1회 재조회(`:316-326`) |
| 〃 이름표 | `GET /trips/:id/members` | 분리(splits) 있는 날 최초 1회(`:194-197`) | `members.isEmpty` 가드 |
| TripOverviewView | `GET days/0…N-1` (N건 팬아웃) | 시트 `.task(id: revision)`(`Features/Plan/TripOverviewView.swift:40`), pull-to-refresh(`:41`) | 이미 받은 날은 건너뜀(`TripPlanViewModel.swift:129`) |
| MapDiscoveryView / MapDiscoveryModel | `GET /trips/:id/candidates` | 지도·검색 패널 `.task`→`loadCandidatesIfStale(60)`(`Features/Map/MapDiscoveryView.swift:24-31`), 담기·되돌리기 직후(`MapDiscoveryModel.swift:157`,`:194`) | `loadCandidatesIfStale`(`:81-84`) |
| 〃 검색 | `GET /api/v1/places/search` 또는 Google `places:searchText` | **버튼·제출만**(`MapDiscoveryView.swift:105`,`:124-125`) | 키 입력마다 조회 없음. 결과 캐시는 없음 |
| PlaceSearchView | 동일 | `.onSubmit(of:.search)`(`Features/Map/PlaceSearchView.swift:72`) | 없음(제출형) |
| PlacePhotoView / PlacePhotoService | Google **3건**: details → media → 이미지 | 장소 정보·입장 시트가 뜰 때마다 `.task(id:)`(`Features/Map/PlacePhotoView.swift:63`), `onDisappear`에 폐기(`:62`) | **캐시 전면 비활성**(`PlacePhotoService.swift:29-33`) |
| AdmissionView | `GET /api/v1/places/details` | 버튼 탭만(`Features/Plan/AdmissionView.swift:83-90`) | 좋음 |
| BookingListView | `GET /trips/:id/bookings` | `.task` 진입마다 `load()`(`Features/Booking/BookingListView.swift:135-138`), refreshable(`:134`), 저장·삭제 후(`:147`,`:153`) | **가드 없음**(`:23-33`) |
| 〃 편집기 열기 | `GET /trips/:id` + `GET days/0` + `GET days/1`(프리페치) | '＋'·'편집' 탭(`:181-188` → `TripPlanViewModel.load()` → `loadPlan()`) | — |
| TripCostsView | `GET /trips/:id` + `GET /trips/:id/costs` | 시트 `.task`(`Features/Plan/TripCostsView.swift:85`), refreshable(`:86`), **저장할 때마다**(`:433`) | **가드 없음**(`:390-416`). `/costs`는 서버가 여행 전체 leg를 읽는 무거운 경로(`handlers.ts:376-390`, `LEG_WAIT_MS=800`) |
| CandidateBoardView / VM | `GET candidates` + `GET members` + `GET group-proposal` = **항상 3건** | 시트 `.task`(`Features/Collab/CandidateBoardView.swift:52-56`), refreshable, 모든 변경(`CandidateBoardViewModel.swift:292-305`), **실시간 이벤트마다**(`:130-137`) | 가드 없음 |
| 〃 한마디 | `GET candidates/:id/comments` | 카드 펼침, 코멘트 추가·삭제 뒤 | — |
| CandidatePlacementSheet | `GET /trips/:id` | 시트 `.task`(`Features/Collab/CandidatePlacementSheet.swift:55`) | — |
| PlanPreviewSection | `POST /trips/:id/plan-preview` | `.task(id: document)` — **날짜·위치 피커를 움직일 때마다**(`Features/Plan/PlanPreviewSection.swift:38`) | generation 취소만, 디바운스 없음 |
| CollabView / CollabViewModel | `GET members` + `invites` + `preferences` + `activity` = **4건** | 시트 `.task`(`Features/Collab/CollabView.swift:62-66`), refreshable, 모든 변경(`CollabViewModel.swift:137-147`) | 가드 없음 |
| RealtimeClient | WS 1본 + `GET /api/v1/me` 1회 | 후보 보드 표시·scenePhase `.active` | `/me`는 서비스 수명 동안 캐시(`TripService.swift:49-55`), 같은 여행 재연결 무시(`RealtimeClient.swift:72`), 백오프 3·6·9·12초 최대 5회 |
| PushService | `POST /api/v1/devices` | APNs 토큰 수신시에만 | 좋음 |
| Widgets / Watch | **네트워크 없음** | App Group 스냅샷만 읽는다 | 좋음 |

부수 확인: iOS에는 `/prices` 호출이 없다(가격 상태는 `/bookings` 요약에 실려 온다). travel-state **폴링은 존재하지 않는다**. 위젯·워치는 자체 네트워크가 없다.

## 2. iOS — 코드로 증명되는 중복·낭비

1. **후보 1건을 일정에 넣는 흐름 = 13~15 왕복**(`Features/Map/MapDiscoveryView.swift:39-49`). 시트 `document`(1) → 피커 조작마다 `plan-preview`(n) → `board.load()` 3건 → `schedule()`이 `document`+`PUT`+`PATCH`(3) → 끝에 다시 `load()` 3건(`CandidateBoardViewModel.swift:226`) → `model.loadCandidates()`(1) → `onReturnFromBoard`→`TripPlanViewModel.load()` = `document`+`days/i`+프리페치 2.
2. **TripCostsView 저장 = 문서 3회 왕복**(`TripCostsView.swift:430-433`): `saveDocument`가 최신 스냅샷을 돌려주는데 곧바로 `load()`가 `GET /trips/:id`를 다시 받아 덮어쓴다. 그 뒤 `/costs`까지 = PUT+GET+GET.
3. **예약 편집기 = 하루치 2건 헛조회**(`BookingListView.swift:181-188`): 문서만 필요한데 `TripPlanViewModel.load()`가 `loadPlan()`을 불러 `days/0` + `days/1`을 받는다.
4. **후보 보드는 내 반응 하나에도 3건**: `handle()`이 `mine`을 보지 않고 `load()`를 부른다(`CandidateBoardViewModel.swift:130-137`). 반응은 이미 낙관 반영돼 있다(`:155-166`).
5. **CollabView는 이름 한 번 바꾸면 4건**(`CollabViewModel.swift:137-147`).
6. **일자 이동마다 `days/:i` 재조회 + 프리페치와 중복**(`TripPlanViewModel.swift:46-51`, `:202-234`, `:242-260`). ⚠️ 테스트가 현재 동작을 의도로 못박고 있다(`TripPlanViewModelTests.swift:636-638`) → 설계 결정 사항.
7. **사진 캐시 0**(`PlacePhotoService.swift:29-33`, `PlacePhotoView.swift:62`): 같은 장소를 두 번 열면 Google 3건이 두 번.
8. **scenePhase `.active`가 전체 `load()`**(`TodayView.swift:141-143`): 몇 초 나갔다 와도 `today` + `travel-state` 2건.
9. **시트형 화면에 `loadIfStale` 없음**: TripCostsView(2건)·BookingListView(1건)·CandidateBoardView(3건)·CollabView(4건).
10. **PlanPreviewSection이 피커 조작마다 POST** — 서버는 한 건마다 dayPlan을 두 번(before/after) 계산한다.

## 3. 웹

- **`pullTrip`이 여행 1건 때문에 전체 동기화 목록을 받는다**: `app.js:4822` → `api.js:215-227` `GET /api/v1/sync/trips` — 모든 여행의 문서 전문. 트리거: 탭 복귀(30초 스로틀), 멤버 패널 열기, 실시간 이벤트(`force`라 스로틀 우회), 멤버 새로고침.
- **실시간 1묶음(400ms 디바운스)이 최대 5종**: `/me` + `sync/trips` + `candidates` + 열려 있는 카드 수만큼 `comments` + `list_trip_activity`. `liveEffects`의 `candidates`가 `mine`을 보지 않는 것은 iOS와 같다(`collab.js:494-502`).
- 구간(leg): localStorage 캐시 + 직렬 큐 + 실패 마커 — 잘 막혀 있다. 다만 실패 마커는 성공시에만 디스크에 남아 세션마다 재시도한다.
- FX 하루 1회, 가격 자동 24시간·수동 15분 쿨다운·실패 60분 백오프 — 문제 없음.
- `pullPriceSnapshots`: 로그인 후 호텔 예약이 있는 여행 수만큼 팬아웃(`app.js:2816-2830`).
- 렌더마다 불리는 것들(`ensureLiveChannel`·`ensureMembers`·`loadPxHealth`)은 가드 덕에 네트워크를 타지 않는다.

## 4. 권고 (순위)

### 지금 바로 안전

| # | 변경 | 절감 | 위험 | 위치 |
|---|---|---|---|---|
| 1 | 비용 저장 후 문서 재조회 제거(PUT 응답 스냅샷 사용, `/costs`만 재조회) | 편집 1회당 GET 1건 | 없음 | `TripCostsView.swift` `saveDocument` |
| 2 | 예약 편집기 진입 시 하루치 조회 제거(문서 전용 경로) | 편집기 1회당 GET 2건 | 없음 | `BookingListView.swift:181-188`, `TripPlanViewModel.load()`의 `loadPlan` 분리 |
| 3 | 시트 4곳에 `loadIfStale(60)` | 재오픈 1회당 각 2·1·3·4건 | 최대 60초 지연(Today/Plan/Map과 같은 규칙) | `TripCostsView:85`, `BookingListView:135`, `CandidateBoardView:52`, `CollabView:62` |
| 4 | 실시간 **내 에코**는 재조회하지 않기(`guard !event.mine`) | 반응·코멘트 1회당 3건 | 없음(낙관 반영 완료) | `CandidateBoardViewModel.swift:130-137` |
| 5 | `PlacePhotoService`에 메모리 LRU(placeId→PlacePhoto) | 같은 장소 재열람 1회당 Google 3건 | 없음(메모리만 — 디스크·문서 저장 금지 규칙 유지) | `PlacePhotoService.swift:22-33` |
| 6 | `PlanPreviewSection` 0.3~0.5초 디바운스 | 피커를 훑는 동안 POST 수 건 → 1건 | 미리보기가 반박자 늦음 | `PlanPreviewSection.swift:38` |
| 7 | scenePhase `.active`를 `loadIfStale`로(또는 백그라운드 체류가 maxAge를 넘겼을 때만 `load`) | 짧은 앱 전환마다 2건 | 다른 기기 변경을 최대 60초 늦게 봄 | `TodayView.swift:141-143` |
| 8 | 웹 `pullTrip`이 `GET /api/v1/trips/:id`를 쓰도록(iOS `document()`와 같은 라우트). `sync.list`는 로그인 병합 전용으로 | 탭 복귀·실시간마다 전 여행 문서 전문 → 1건 | 응답 모양 변환(`revision`/`deletedAt` 계약 유지). CAS 경로는 그대로 | `app.js:4817-4845`, `api.js`에 `sync.get(tripId)` |

### 설계 결정이 필요

| # | 변경 | 절감 | 논점 |
|---|---|---|---|
| 9 | 일자 이동 시 `days/:i` 재조회에 짧은 TTL 또는 직전 응답의 `legsPending==0`이면 생략 | 7일 훑기 6건 → 0~1건 | 테스트가 현재 동작을 의도로 못박음(`TripPlanViewModelTests.swift:636-638`) |
| 10 | 후보 배치 흐름 축약(새 VM의 `board.load()` 제거, `schedule()` 뒤 중복 재조회 제거, `onReturnFromBoard`는 문서만) | 13~15건 → 5~6건 | `schedule()`이 자기 `candidates`에 의존 → 시드 주입 API 필요 |
| 11 | `CandidateBoardViewModel.load()`의 3건 분리(members 최초 1회, group-proposal은 목록이 바뀐 뒤에만) | 변경 1회당 2건 | 인원수·제안 신선도 정책 |
| 12 | `CollabViewModel.perform` 뒤 바뀐 것만 재조회 | 변경 1회당 3건 | 활동 로그 갱신 시점 |
| 13 | 웹 `flushLive`의 코멘트 재조회를 실제 `COMMENT_ADDED`가 온 후보로 한정 | 열린 카드 수만큼 | 이벤트에 후보 id가 실려 오는지 확인 |
| 14 | `liveEffects`에서 `REACTION`이 목록 전체 재조회를 유발하지 않게(집계만 패치) | 파티 규모에 비례 | **`collab.js`가 규칙의 소스**, iOS는 복사본 + parity 테스트 → 웹을 먼저 고치고 iOS를 맞춘다 |
