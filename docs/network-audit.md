# 네트워크 호출 감사 (2026-09-18)

아래 §1~§3은 **감사 시점(고치기 전)**의 사실이다 — 무엇이 얼마나 나갔는지의 기록으로 남긴다. 추정은 "추정"이라고 적었다.
서버 영속성·DB 변경은 다루지 않는다. **§4가 무엇을 어떻게 고쳤는지**다(같은 날 적용). 서버 코드는 바꾸지 않았다 — 전부 클라이언트다.

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

## 4. 적용 결과 (2026-09-18 · 권고 14건 전부)

원칙은 셋이다. **방금 받은 것은 다시 받지 않는다**(Today·Plan·Map과 같은 60초 규칙을 시트에도) · **내 것은 이미 내 화면이다**(내 반응·담기·한마디의 에코는 읽지 않는다 — 문서 변경은 예외) · **바뀐 것만 다시 읽는다**(변경 뒤 전부를 읽지 않는다).
판정 규칙의 소스는 여전히 `collab.js`(`liveEffects`)이고 iOS는 복사본 + `live-effects.json` 파리티다. 서버 응답의 내용을 믿는 곳은 없다 — 무엇을 다시 읽을지만 바뀌었다.

### 지금 바로 안전 (1–8)

| # | 변경 | 전 → 후 | 어디 |
|---|---|---|---|
| 1 | 비용 저장 뒤 문서를 다시 받지 않는다 — PUT 응답이 최신 문서다. `/costs`만 다시 받는다 | 편집 1회 PUT+GET+GET → PUT+GET | `TripCostsView.saveDocument` → `loadCosts()` |
| 2 | 예약 편집기는 문서만 연다 — `TripPlanViewModel(loadsPlans: false)`가 하루치·앞뒤 미리 받기를 끈다 | 편집기 1회 3건 → 1건 | `BookingListView.openEditor`, `TripPlanViewModel.loadsPlans` |
| 3 | 시트 넷(비용·예약·함께하기·가고 싶은 곳)의 모델을 **여행 화면이 든다**(`TripScreenModels`). 열 때는 `loadIfStale(60)` | 재오픈 1회 2·1·3·4건 → 0 (60초 안) | `TripHomeView` · `TripCostsMemory` · `BookingListViewModel.loadIfStale` · `CollabViewModel.loadIfStale` · `CandidateBoardViewModel.loadIfStale`. 뷰는 `shared:`로 받고, 없으면(지도에서 여는 보드) 예전처럼 제 것을 만든다 |
| 4 | 내 반응·담기·한마디의 에코는 읽지 않는다 — **규칙 자체**를 바꿨다(`liveEffects`: `candidates = (후보 종류 && !mine) \|\| 문서 변경`). 웹·iOS 같이 | 내 반응 1회 3건(iOS) · 최대 5종(웹) → 0 | `collab.js` → 픽스처 → `CollabModel.liveEffects` |
| 5 | 장소 사진 메모리 LRU(40곳). '사진 없음'도 기억, 실패는 기억 안 함. 디스크·문서에는 여전히 안 남긴다 | 같은 장소 재열람 Google 3건 → 0 | `PlacePhotoService.remembered/remember` |
| 6 | 일정 미리보기 0.4초 디바운스 — `.task(id:)`가 취소되는 성질을 쓴다 | 피커 훑는 동안 n건 → 1건 | `PlanPreviewSection` |
| 7 | 앱 복귀는 `loadIfStale` — 여행 모드 갱신(`travel-state`)은 켜져 있으면 그대로(위치·시각이 바뀌었다) | 짧은 앱 전환 2건 → 0 (여행 중 1건) | `TodayView.onChange(scenePhase)` |
| 8 | 웹 `pullTrip`이 `GET /api/v1/trips/:id` 한 건(`TC_API.sync.get`). 404면 그때만 `sync.list`로 tombstone을 본다(삭제는 목록에만 남는다 — 예전 '삭제됨' 충돌 카드 유지) | 탭 복귀·실시간마다 전 여행 문서 전문 → 1건 | `api.js sync.get` · `app.js pullTrip` |

### 설계 결정 (9–14) — 이렇게 정했다

| # | 결정 | 전 → 후 | 어디 |
|---|---|---|---|
| 9 | 일자 이동 시 **이 세션에서 서버로부터 받은** 같은 문서(revision)의 하루치이고 `legsPending == 0`이면 다시 묻지 않는다. 디스크 캐시·오프라인 사본은 해당 없음(한 번은 서버가 확인한다). 채울 구간이 남은 날은 옮기면 받는다. 문서가 바뀌면 `apply`가 전부 버린다 | 7일 훑기 6건 → 0~1건 | `TripPlanViewModel.fetchedDays`. 테스트 `testMovingBetweenFetchedDaysDoesNotAskAgain`·`testMovingToADayWithPendingLegsStillAsks` |
| 10 | 지도의 배치 흐름: 보드를 **지도가 아는 후보로 시작**(`seed:`)하고 끝의 재조회를 끈다(`reloadAfter: false`). `onReturnFromBoard`(부모 일정 `load()`)는 그대로 — 문서가 바뀌었으니 하루치는 받아야 한다 | 13~15건 → 6건(+앞뒤 미리 받기 2) | `MapDiscoveryView` · `CandidateBoardViewModel(seed:)`·`schedule(reloadAfter:)` |
| 11 | 보드 `load()`: 인원은 **처음 한 번**과 `MEMBER_*` 이벤트 때만, 그룹 제안은 **목록이 바뀌었을 때만**(`before != candidates`) 다시 묻는다. 거절한 제안은 그대로 다시 올리지 않는다 | 변경 1회 3건 → 1건 | `CandidateBoardViewModel.load/loadMembers/handle` |
| 12 | 함께하기 `perform(refresh:)`: 역할·내보내기·이름은 멤버+활동, 초대 취소는 초대만(활동에 안 남는다). 취향 저장은 전부터 취향만 다시 읽었다 | 변경 1회 4건 → 1~2건 | `CollabViewModel.reload(CollabRefresh)` |
| 13 | 웹 `flushLive`의 한마디 재조회는 **`COMMENT_ADDED`가 실제로 온 후보만**(`liveCommentTargets`). 이벤트에 후보 id가 없으면(자체 실시간은 `{type,tripId,id,kind,mine}` 신호뿐이다) 열린 카드 전부 — 모르면 맞는 쪽으로 | 반응 하나에 열린 카드 수만큼 → 0 | `collab.js liveCommentTargets` · `app.js flushLive` |
| 14 | `REACTION`은 **내 것이면** 목록 재조회를 부르지 않는다(4번과 같은 규칙). 남의 반응은 여전히 목록을 다시 읽는다 — 집계를 payload로 패치하지 않는다(§41 "payload는 신호"). 파티 규모에 비례하는 부분은 400ms 디바운스가 그대로 묶는다 | 내 반응 에코 3건 → 0 | `collab.js liveEffects` · `liveEffectsParity.test.ts` · `RealtimeTests` |

### 바꾸지 않은 것(알고 둔다)

- 같은 계정을 **두 기기**에서 쓰면 한쪽의 반응·담기가 다른 쪽 보드에 실시간으로 안 들어온다(에코로 보여 거른다) — 문서 변경(`pull`)이 이미 그렇듯 시트를 다시 열거나 당겨서 새로고침으로 받는다.
- 자체 실시간 payload에 후보 id를 싣지 않았다(서버 변경·NAS 재배포가 필요하고, 13번이 그것 없이도 대부분을 줄인다). 실으면 `liveCommentTargets`가 그대로 그 후보만 고른다.
- `sync.list`(전체 목록)는 로그인 병합과 404 뒤 tombstone 확인에만 남는다.
