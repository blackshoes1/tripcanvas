# 리팩토링 계획 — 상태 소유자와 중복 계산

기존 동작을 유지하면서 **책임과 상태 변경 경계**를 또렷하게 만드는 것이 목적이다.
전면 재작성·새 기능·새 프레임워크는 하지 않는다. 파일을 나누는 것 자체는 목적이 아니다.

각 단계는 **앞 단계가 머지된 뒤에** 시작한다. 한 PR에 두 단계를 담지 않는다.

---

## 1단계 — iOS 일정 상태 관리 분리 ✅ 완료

### 무엇이 문제였나

`TripPlanViewModel`(601줄)이 여섯 가지를 함께 들고 있었다 — 문서 편집·저장, 날짜별 계산 캐시,
인접 날짜 선조회, 구간 채우기 재시도, 충돌, 실행 취소. 그래서 늦게 온 응답을 버릴지 말지를 정하는
같은 모양의 가드가 **다섯 군데에 흩어져** 있었고, 한 곳을 고칠 때 나머지 넷을 함께 봐야 했다.

```swift
guard day == selectedDay, revision == askedRevision,
      fetched.value.trip.revision == askedRevision else { return }
```

### 어떻게 나눴나

| 타입 | 소유하는 상태 | 변경 시점 |
|---|---|---|
| `TripDocumentStore` | `document` `revision` `role` `isLoading` `loadedAt` `isSaving` `errorMessage` `conflict` `toast` `undo*` `loadGeneration` | 읽기·저장·충돌·되돌리기 |
| `DayPlanCache` | `plansByDay` `cachedAtByDay` `attemptedDays` `prefetching` `retriedLegs` `fetchedDays` `tripRoutes*` | 날 이동·조회 성공·재시도·무효화 |
| `TripPlanViewModel` | `selectedDay` `members` | 사용자 조작 |

**`revision`의 소유자는 `TripDocumentStore` 하나다.** 캐시는 사본을 들지 않고 `DayPlanContext`
프로토콜로 물어본다. 두 곳이 각자 들고 비교하기 시작하면 "어느 쪽이 지금인가"의 답이 갈린다.

화면이 쓰는 `TripPlanViewModel`의 **공개 API는 한 글자도 바꾸지 않았다.** `TripPlanView`(1169줄)와
기존 테스트 74건이 그대로 회귀 방어망이 된다.

### 명시한 규칙

**무효화** — 조건은 하나다. 문서 `revision`이 바뀌면 `invalidate()`가 날짜별 계산·디스크 사본 시각·
시도 여부·재시도 표시·이 세션에서 받은 날·전체 동선을 **전부** 버린다. 옛 시각을 잠깐이라도
보여 주는 것은 비어 있는 것보다 나쁘다. 신호는 `store.onApplied(revisionChanged:)` 한 줄뿐이다.

**늦게 온 응답** — 판정은 `isCurrent(_:day:asked:mustBeVisible:)` **하나**다. 세 가지를 함께 본다:
① 문서가 그대로인가 ② 서버가 계산한 문서가 그 문서인가 ③ (보이는 날만) 아직 그 날을 보고 있는가.
선조회·개요는 보이지 않는 날의 것이라 ③을 보지 않는다.

**Task** — 캐시가 만드는 Task는 **기다리지 않는 것**뿐이다(구간 재시도·선조회·전체 동선 재시도).
취소하지 않고 **깨어나서 판정한다**. 취소를 쓰면 "어느 요청이 살아 있는가"가 취소 토큰과 `revision`
두 곳에 생긴다. 전체 동선만 세대 번호(`tripRoutesGeneration`)를 따로 쓰는데, 이건 요청이 겹칠 때
**로딩 상태를 누가 끄는가**를 가리기 위한 것이라 revision과 역할이 다르다.

### 보존한 동작

일정 기본 화면은 목록 탭 · 날짜 스와이프와 세로 스크롤과 장소 탭의 구분 · 저장 완료를 경로 계산
대기에 묶지 않음 · 이전 날짜·이전 revision 응답이 현재 화면을 덮지 않음 · 저장 실패 시 문서 되돌리고
편집 초안 보존 · 충돌 시 자동 덮어쓰기 없음 · 실행 취소와 후보 보드 연동 · 읽기 전용 권한 ·
원문 JSON의 알 수 없는 필드 보존 · iOS에 도메인 판단 로직을 새로 복제하지 않음.

### 검증

- iOS XCTest **406건 통과 / 0 실패**(기존 405 + 신규 1).
- 신규 회귀 테스트: `testAPrefetchThatArrivesAfterAnEditIsNotKept` — 선조회 응답이 편집 뒤에
  도착하면 쓰지 않는다. 기존 테스트에 없던 구멍이었다.
- **변이 검사**로 테스트에 이빨이 있는지 확인했다. `isCurrent`를 `return true`로 바꾸자
  신규 테스트와 기존 `testAPlanRequestedBeforeSavingCannotOverwriteTheNewCalculation`이 깨졌다.
- ⚠️ 함께 쓰려던 "날짜 왕복 중 응답 순서 뒤바뀜" 테스트는 **같은 변이에서도 통과해서 뺐다.**
  계산 캐시가 날짜별로 키가 나뉘어 있어 다른 날의 응답이 보고 있는 날에 실릴 수 없다 — 구조적으로
  불가능한 것을 테스트로 덮으면 없는 방어를 있다고 믿게 된다. 이 시나리오의 실질은 기존
  `testDoesNotUseAnotherDaysPlan`이 덮는다.

---

## 2단계 — 공통 시간 계산 통합

**범위** — `app.js`의 `dayEndMin()`과 `next/src/features/itinerary/domain/dayView.ts`의
`dayEndMinOf()`를 비교해, 예약 대기·체류·숙소 복귀를 합산하는 **순수 계산**을 공통 엔진으로 옮길 수
있는지 확인한다. 옮길 수 없다면 왜인지를 문서로 남기고 끝낸다 — 억지로 합치지 않는다.

**경계** — 이동시간 조회, 출발 날짜·시각·시간대 처리는 각 호출부에 남기고 **값으로 주입**한다.
체류 시간 계산처가 넷이라는 사실(`computeTimeline`·`dayEndMin`/`legDepartMinute`·`dayView.ts`·
`adaptive.js`)을 먼저 확인할 것.

**의존성** — 1단계와 독립. 다만 3단계보다 먼저 하는 편이 낫다(앱 화면이 계산을 더 많이 읽게 되므로).

**검증 기준** — 체류 미설정과 0분이 **다르게 남는지**, 예약 대기·지각, 숙소 이월·복귀, 빈 일정의
기존 결과가 그대로인지. 합치기 전후로 `test/pure.test.js`와 `next`의 해당 테스트가 같은 값을 내야 한다.
⚠️ 숙소 복귀를 보는 픽스처에는 **뒷날을 하나 붙여야** 한다(마지막 날에는 복귀가 붙지 않는다).

---

## 3단계 — iOS 일정 화면 분리 ✅ 완료

### 무엇이 문제였나

`TripPlanView`가 894줄에 `@State` 22개였다. 날짜 선택·목록·지도·시트가 한 타입 안에 섞여 있어
**어떤 값을 누가 언제 바꾸는지**가 한눈에 보이지 않았다. 지도에서만 쓰는 값(`mapScope`·
`selectedMapSpot`·`selectedMapSpotDay`·`sceneChoice`)도 시트 상태와 같은 자리에 있었다.

### 어떻게 나눴나

| 파일 | 소유하는 상태 | 줄 수 |
|---|---|---|
| `TripPlanView` | 시트·모달(`editor` `viewingSpot` `showsSearch` `showsCosts` …) · `mapMounted` · `goingForward` · `choosingPlaces`/`chosenPlaces` | 894 → **308** |
| `PlanSpotList` (신규) | `summaryExpanded` · `daySwipeIntent` · `isSwipingDay` | 362 |
| `PlanMapSection` (신규) | `mapScope` · `selectedMapSpot` · `selectedMapSpotDay` · `sceneChoice` | 258 |
| `PlanDayPicker` (신규) | 없음 — 받은 값만 그린다 | 89 |
| `SpotRow` (파일 분리) | 없음 | 252 |

부모의 `@State`는 22 → **16개**로 줄었고, 나간 7개는 전부 **쓰는 곳이 하나뿐인** 값이다.
남은 16개는 시트·모달처럼 부모만 열 수 있는 것과, 툴바와 목록이 함께 쓰는 것뿐이다.

### 상태를 복제하지 않기 위해 쓴 장치

**`PlanActions`** — 조각이 부모에게 부탁하는 일 한 벌(`editSpot` `viewSpot` `addAfter`
`moveSpots` `selectDay` `openCosts`). 조각은 시트 상태를 **보지도 쓰지도 않는다.**
같은 시트가 두 곳에서 열리는 일이 구조적으로 불가능해진다.

- `goingForward`는 칩과 스와이프 **둘 다** 바꾸므로 부모가 소유하고, 목록은 읽기만 한다
  (`let`). 쓰기는 `actions.selectDay(day, forward)` 하나를 지난다.
- `choosingPlaces`/`chosenPlaces`는 툴바(부모)와 목록이 함께 쓰므로 `@Binding`이다.
- `motion`·`reduceMotion`은 상태가 아니라 **환경 읽기**라 각자 읽어도 값이 갈리지 않는다.

### 보존한 동작

목록 탭 기본 · 날짜 스와이프와 세로 스크롤과 장소 탭의 구분(`PlanDaySwipeIntent`) ·
편집 모드에서만 삭제(`onDelete`에 nil) · 드래그 인덱스가 어긋나지 않도록 이월/렌터카 줄을
`ForEach` 밖에 두기 · 지도는 한 번 만들면 숨기기만 하기 · 계산 전에는 목록을 짓지 않기 ·
접근성 라벨과 44pt 터치 영역 · 디자인 토큰.

### 검증

- iOS XCTest **406건 통과 / 0 실패**, 빌드·Release 빌드 통과.
- 회귀 테스트를 **더하지 않았다** — 동작이 바뀐 곳이 없고, 뷰 구조 변경은 기존 406건이
  잡지 못하는 영역이다(아래 한계 참고).
- `TripPlanView.summaryLine` → `PlanSpotList.summaryLine`으로 옮기며 `UiPolishTests`의
  참조 한 줄을 함께 고쳤다.

### ⚠️ 이 단계가 확인하지 못한 것

**화면에 실제로 그려지는 모습은 확인하지 못했다.** 일정 화면에 닿으려면 로그인이 필요한데,
사용자 계정으로 앱을 띄우는 것은 이 저장소의 규칙이 금지한다(데모 오염). 빌드와 유닛
테스트까지가 이번에 할 수 있는 검증이다. 레이아웃·전환 애니메이션·스와이프 감각은
**기기나 시뮬레이터에서 사람이 한 번 봐야 한다.**

## 4단계 — 웹 표시와 저장 경계 정리

**범위** — `app.js`의 `render()` 안에서 일어나는 저장 호출과 그 경로 전부.

**경계** — ⚠️ **단순히 저장 호출을 제거하지 않는다.** 지금은 데이터 변경이 `render()`를 지나며
저장되는 경로가 있고, 그 목록을 먼저 만들어 **테스트로 덮은 뒤에** 옮긴다. 데이터가 바뀔 때 저장하고
`render()`는 표시만 하도록 점진적으로 가른다.

`ensureMembers`가 목록을 받아도 다시 그리지 않는 이유가 여기 있다 — `render()`는 순수한 다시 그리기가
아니라 클라우드 동기화까지 건드린다. 그 사실 자체가 이 단계의 과제다.

**의존성** — 독립. 다만 Next가 최종 웹이라는 방향을 고려해 **기존 웹의 대규모 재작성은 피한다.**

**검증 기준** — 옮기기 전에 만든 "이 경로로 바꾸면 저장된다" 테스트가 옮긴 뒤에도 전부 통과.
`e2e/core-flows.spec.js`가 실제 조작으로 확인.

---

## 5단계 — API·Next 페이지 책임 분리

**범위**
- `next/src/features/trip-state/services/handlers.ts`의 요청 처리를 기능별로 나눈다.
- `next/src/app/itinerary/page.tsx`의 반복되는 선택 상태 초기화와 지도 선택·내보내기 흐름을 정리한다.

**경계** — 인증·권한·revision CAS·오류 응답 규칙을 **각각 새로 구현하지 않는다.** 이미 분리된
도메인 계산(`@legacy/adaptive.js`)과 저장소 계층은 그대로 둔다. 판단은 여전히 한 엔진이다.

**의존성** — 2단계가 끝나 있으면 계산 경계가 또렷해져 더 쉽다. 필수는 아니다.

**검증 기준** — `next`의 기존 테스트 + `swiftParity.test.ts`(계약이 바뀌면 여기가 먼저 깨진다) +
API 연결 E2E. 계약·문구·권한·저장 방식이 그대로인지.

---

## 공통 규칙

- 별도 브랜치, 작은 PR, `main` 직접 커밋 금지.
- 기존 API 계약·사용자 문구·디자인·권한·저장 방식은 유지한다.
- 새 프레임워크나 범용 상태 관리 계층을 넣지 않는다.
- 기존에 동작하는 보호 장치를 "단순화"를 이유로 제거하지 않는다.
- 테스트는 **실제 요청 순서와 사용자 동작**을 검증한다. 내부 함수 호출 여부만 보는 테스트는 쓰지 않는다.
  새 테스트를 넣을 때는 **그 테스트가 무엇을 깨뜨려야 깨지는지** 확인한다(1단계의 변이 검사 참고).
- 실행하지 못한 검증은 통과로 표현하지 않는다.
