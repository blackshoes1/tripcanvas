# TripCanvas iOS (SwiftUI)

여행을 **실행하는** 앱. 여기서 답하는 것은 "지금 무엇을 하면 되는가"다.

계획도 앱에서 한다 — **일정 편집(일자·장소) · 지도·장소 검색 · 예약 편집 · 함께하기가 네이티브로 들어왔다**
(`Features/Plan` · `Features/Map` · `Features/Booking` · `Features/Collab`). 웹뷰로 감싸는 길은 택하지 않았다.

> ## 검증 상태
>
> **시뮬레이터 빌드·실행 확인됨** — 로그인하면 웹에서 만든 여행이 그대로 보인다.
> Windows에서 작성해 처음 Mac에서 열었을 때 나온 컴파일 오류(플랫폼 격리 · 프로토콜 요구사항 ·
> 접근 수준 · 매크로 충돌 · SDK 인자 순서)는 모두 잡혔다.
>
> **CI가 자동으로 보는 것** (`.github/workflows/ios.yml`, `ios/` 변경 시에만 — macOS 러너는 10배 과금):
> XcodeGen 생성 · 전 타깃 컴파일 · **XCTest** · Release 빌드 · 무료 스펙 생성.
> 서명 없이 시뮬레이터로만 돌기 때문에 Apple 계정 없이 돌아간다.
>
> **CI가 못 보는 것**: 서명 · 실기기 설치 · 실제 푸시 도착 · 위젯/Live Activity 실제 표시 ·
> Archive · TestFlight. 이건 기기에서만 확인된다 — [docs/ios-device-setup.md](../docs/ios-device-setup.md)
> 의 체크리스트를 쓴다.
>
> **TestFlight는 눌러서 올린다**: Actions → *iOS TestFlight* → Run workflow.
> App Store Connect API 키 네 개를 저장소 시크릿에 넣어두면 Xcode를 열 일이 없다(문서 참고).
>
> 서버 쪽(`/api/v1`)은 별도로 검증됐다 — `next` 워크스페이스의 계약 테스트가 통과하고,
> 배포된 라우트는 `curl` 로 바로 확인할 수 있다.

## 일정 편집 (Features/Plan)

여행 문서를 **원문 그대로** 들고 아는 필드만 덮어 읽고 쓴다(`Core/Models/JSONValue.swift` · `TripDocument.swift`).
아는 필드만 담은 구조체로 디코딩하면 웹이 쓰는 `who`·`split`·`reunion`·`hours`·`flight`가 앱에서 한 번 저장할 때마다
사라진다. 기본값(PLANNED·must:false·빈 값)도 새로 써 넣지 않는다 — 웹의 `normalizeSpot`과 같은 규칙이다.

- 저장 버튼이 없다. 바꾸면 곧바로 `PUT /api/v1/trips/:id`(revision CAS)로 올라가고, **실패하면 화면을 되돌린다.**
- 충돌(다른 기기가 먼저 저장)은 조용히 덮어쓰지 않는다 — 무엇이 사라지는지 말하고 사용자가 고른다.
- 보기 권한(VIEWER)은 편집 진입점이 아예 뜨지 않는다.
- ⚠️ 판단은 여전히 서버다. 여기서 하는 것은 **문서 편집**뿐이고 ETA·앵커·추천은 `/api/v1`이 준 것을 그린다.

## 지도·장소 검색 (Features/Map)

웹과 같은 듀얼 엔진이다 — **국내는 카카오맵 SDK, 해외는 Google Maps SDK**(`MapEngineView`, 판정은 `lib.js`의 `inKorea`와 같다).
검색도 같은 규칙(`isKoreanSearch`)으로 가른다. 키 세 종류가 서로 다른 곳에 산다:

| 무엇 | 어디서 | 키 |
|---|---|---|
| 국내 지도 | 앱, 카카오맵 SDK | 카카오 **네이티브 앱 키** (`TCKakaoNativeKey`, 번들 ID 제한) |
| 해외 지도 | 앱, Maps SDK for iOS | 구글 **iOS 키** (`TCGoogleMapsKey`, 번들 ID 제한) |
| 국내 검색 | **서버** `GET /api/v1/places/search` | 카카오 REST 키 — 앱에 넣을 수 없다(제한 불가) |
| 해외 검색 | 앱, Places API (New) REST | 구글 iOS 키 + `X-Ios-Bundle-Identifier` 헤더 |

- 웹 키(리퍼러·도메인 제한)는 앱에서 거부된다. 구글 키는 제한을 한 종류만 걸 수 있어 **웹 키와 iOS 키가 따로**다.
- 무료 스펙에서 번들 ID를 바꿔 쓰면 콘솔(구글·카카오 둘 다)의 제한에 그 값도 넣어야 폰에서 지도가 뜬다. 안 넣으면 오류 없이 지도만 비어 있다(카카오는 `authenticationFailed` 로그).
- 카카오 SDK는 POI 탭 신원을 주지 않는다(웹과 같은 제약) — 국내 지도에서 고른 자리는 좌표뿐이고 이름은 사용자가 쓴다. 해외는 POI를 탭하면 `placeId`·이름이 온다.
- 좌표 역추적(이름 추측)은 하지 않는다 — 웹의 `reverseSpot`은 최후 수단이고, 여기서는 아예 없다.
- ⚠️ `PlaceSearchModel.swift`의 `inKorea`·`isKoreanSearch`·`cityFromGoogle`·`catFromGoogle`은 `lib.js`의 **복사본**이다. 규칙을 바꿀 때 `lib.js`를 먼저 고치고 여기를 따라 맞춘다.

## 예약 편집 (Features/Booking)

예약(`trip.bookings`)은 **여행 문서의 일부**라 장소와 같은 길로 저장된다 — `TripPlanViewModel`이 `PUT /api/v1/trips/:id`(revision CAS)로
올리고, 실패하면 되돌리고, 충돌이면 묻는다. 목록은 서버 요약(`GET /bookings` — 가격 상태가 붙어 온다)을 읽고, 저장한 뒤 요약을 다시 읽는다.
모델은 `Core/Models/TripBooking.swift`(`lib.js`의 `normalizeBooking`과 같은 모양) — 시세 조회가 남긴 `ptoken`·`enName`·`saved`는 앱이 모르는 채로 보존된다.

- 검증은 웹 `bkSave`·서버 `validateBookingDraft`와 **같은 규칙**이다: 이름·가격 필수, 숙박은 추적 on이면 기간 필수·체크아웃은 체크인 뒤,
  **렌터카 당일 대여는 정상**(같은 날이면 픽업 시각 < 반납 시각). 문장도 웹 toast와 같다(`BookingDraftError.message`).
- 연결은 **한 예약당 한 곳**: 숙박은 숙소로 표시한 장소(`spot.bookingId`), 렌터카는 픽업·반납 장소(`carPickupId`·`carReturnId`).
  저장할 때 이 예약을 가리키던 옛 연결을 모두 풀고 새로 맺는다. 빼면 연결도 함께 푼다.
- 반납 지점은 (장소, 공항코드) **한 쌍**이다(`returnPoint` — `lib.js`의 `carReturnPoint`). 둘 다 비었을 때만 픽업과 같다.
- 이름·기간(identity)이 바뀌면 `ptoken`을 지운다(웹과 같다) — provider 매핑을 다시 찾아야 한다.
- 가격 관측·시세 비교·재예약 기록은 여기 없다. 저장하면 서버가 추적하고, 결과는 목록의 가격 칩이 보여준다. 자동 재예약은 하지 않는다.
- 장소 편집에 **숙소** 토글이 생겼다(`spot.stay` — 웹의 체크박스와 같다). 그날의 종료 기준점이 되고 숙박 예약과 이을 수 있다.

## 함께하기 (Features/Collab)

멤버 · 초대 · 여행 취향 · 최근 활동(`CollabView`)과 가고 싶은 곳(`CandidateBoardView`), 초대 참여(`JoinInviteView`).
**접근 제어의 경계는 DB(RLS·RPC)고 여기는 화면 판정만 한다** — 여기서 '편집 가능'이라 해도 서버가 거절하면 그게 답이다.
판정은 `Core/Models/CollabModel.swift`(순수)에 모여 있고 화면은 배선만 한다.

- 한 줄 규칙: **보기 권한은 의견만 낸다 — 여행에 내용을 만들지는 않는다.** 반응·한마디·취향은 활성 멤버 전원,
  후보 추가·일정 반영은 편집 권한, 초대·역할·내보내기는 주최자. 후보를 **빼는** 기준은 역할이 아니라 '누가 냈는가'다.
- 후보와 반응은 여행 문서가 아니라 제 테이블에 산다(`/candidates`) — 넷이 동시에 하트를 눌러도 리비전 CAS가 서로를 걷어차지 않는다.
  반응은 **낙관적**이고 서버가 거절하면 되돌린다.
- **일정에 넣기는 문서 저장이 먼저다**: 최신 문서를 읽어 고른 날 **맨 뒤**에 붙이고(CAS 저장) 그다음 후보를 `SCHEDULE`로 표시한다.
  표시가 실패해도 "일정에는 넣었지만 표시를 못 바꿨다"고 정직하게 말한다. ⚠️ 인기순 자동 반영은 없다(§12·§79).
- 갈린 후보(MUST와 PASS가 같이)는 자동으로 빼지 않는다 — 카드가 세 선택지를 보이고 사람이 고른다. '제외'는 **상태**라 되돌릴 수 있다.
- ⚠️ **합의 점수(0~100)는 내부값이다 — 화면에는 문장만**(§21·§22). 테스트가 문장에 숫자가 없음을 확인한다.
  '다들 좋아해요'는 전원이 의견을 냈고 아무도 PASS하지 않았을 때만이다.
- 초대 링크는 **웹 주소**(`…/#join=<토큰>`)로 만든다 — 받는 사람에게 앱이 없을 수 있다. 토큰만 싣고 여행 id·역할·만료는 서버가 찾는다.
  받는 쪽은 딥링크(`tripcanvas://join/<토큰>`)로 열거나 링크를 붙여넣는다. 형식이 어긋나면 서버에 보내지 않는다.
- 이름표는 서버가 만든다 — **계정 이메일은 여행에 절대 나오지 않는다**(§69).
- ⚠️ `CollabModel.swift`는 `collab.js`의 **복사본**이다. 규칙을 바꿀 때 `collab.js`를 먼저 고치고 여기를 따라 맞춘다
  (`test/collab.test.js` ↔ `CollabModelTests`).
- 아직 없는 것: **실시간**(웹은 활동 기록 이벤트를 받지만 앱은 당겨서 새로고침한다) · 지도에서 바로 후보 담기 ·
  그룹 제안 카드(`buildGroupProposal`) · 분리 일정.

## 로그인 (Core/Auth)

**웹(`auth.js`)과 같은 서버·같은 계약**이다 — `/api/auth/sign-in/email` · `sign-up/email` · `get-session` ·
`request-password-reset` · `sign-out`. Supabase GoTrue를 직접 부르던 경로는 없앴다(2026-09-05).

- 세션은 **bearer 토큰 하나**다. 교차 출처라 쿠키를 쓰지 않고 **refresh 그랜트도 없다** —
  401을 만나면 `get-session`으로 "이 세션이 아직 사는가"를 묻고, 죽었으면 로그인 화면으로 돌려보낸다.
- Keychain 계정 이름은 `withj.auth.session.v1`(제공자 중립). 예전 이름 `supabase.session`은 **지우기만 한다**.
- ⚠️ **예전 Supabase 세션을 자체 Auth 세션으로 변환하지 않는다.** 다른 Auth가 발급한 토큰을 이어서 들고 있으면
  로그인한 것처럼 보이면서 아무것도 못 한다. 지우고 "로그인 방식이 변경되어 한 번만 다시 로그인해 주세요 —
  저장된 여행은 그대로 유지됩니다"라고 말한다.
- 이메일 확인 전에는 로그인이 열리지 않는다(`requireEmailVerification`). 가입은 세션을 주지 않고 확인 메일만 보낸다.
- 기존 사용자는 **같은 이메일로 다시 가입 → 확인 → 기존 여행 연결**이다(비밀번호 해시를 옮기지 않는다).
  연결은 **확인된 이메일에서만** 일어난다 — 서버 `auth/identity.ts`.
- ⚠️ `AuthError.from(status:body:)`는 `auth.js`의 `toError`와 **같은 규칙의 복사본**이다.
  규칙을 바꿀 때 `auth.js`를 먼저 고치고 여기를 따라 맞춘다.
- **새 비밀번호를 정하는 화면은 웹에만 있다** — 재설정 메일의 링크가 웹(`#reset=`)으로 간다.
  앱은 요청까지 하고 "메일의 링크에서 정해주세요"라고 안내한다.

## 함께하기 — 지도에서 담기와 그룹 제안

- **지도에서 고른 자리는 바로 공유되지 않는다**(§37). 검색 결과를 고르면 후보 담기 칸의 **초안**만 채워지고,
  `후보로 담기`를 눌러야 일행에게 간다. 탭 한 번으로 남에게 알림이 가면 지도를 편하게 못 만진다.
  좌표·`placeId`·주소가 함께 담기므로 나중에 "어느 날에 넣을지"를 계산할 수 있다.
- **그룹 제안은 서버가 만든다**(§35). `GET /api/v1/trips/:id/group-proposal`이 `collab.js`의
  `buildGroupProposal`을 그대로 부르고 앱은 문장을 그리기만 한다 — 같은 규칙을 Swift로 다시 만들면
  웹과 앱이 같은 상황에서 다른 날을 말하게 된다.
  ⚠️ 합의 점수는 계약에 없다. 수락하면 **문서 저장이 먼저**고 후보 표시가 그다음이며, 여러 곳을 넣어도
  문서는 **한 번만** 저장한다(픽마다 저장하면 스스로 revision 충돌을 만든다).

## 판단은 서버가, 표현은 iOS가

웹의 `NextActionEngine`·`TripState`·`Replan`을 Swift로 다시 만들지 않았다. 두 벌을 두면 같은 상황에서
서로 다른 답을 하게 된다. iOS는 `/api/v1/trips/:id/today` 한 번으로 판단 결과를 받아 **그리기만 한다.**

```
             adaptive.js  (단 하나의 엔진)
                   │
        ┌──────────┴──────────┐
   레거시 웹 · Next 웹      /api/v1  →  iOS
```

iOS가 스스로 판단하는 것은 표시 형식뿐이다: 분(minutes) → "18:40", 상태 → 색/문구, 오프라인이면 캐시 표시.

## 빌드

Xcode 프로젝트 파일은 손으로 쓰면 깨지기 쉬워 [XcodeGen](https://github.com/yonaskolb/XcodeGen) 명세(`project.yml`)로 둔다.

```bash
brew install xcodegen
cd ios && xcodegen generate && open TripCanvas.xcodeproj
```

XcodeGen을 쓰고 싶지 않다면 Xcode에서 iOS App 프로젝트를 새로 만들고 `TripCanvas/` 폴더를 그대로 추가해도 된다
(Bundle ID·Deployment Target은 `project.yml`의 값을 참고).

- 최소 iOS 17 (`@Observable` 사용)
- 외부 의존성은 **지도 SDK 둘뿐**(SPM: `googlemaps/ios-maps-sdk` · `kakao-mapsSDK/KakaoMapsSDK-SPM`). 나머지는 REST + `URLSession`이다
  — 로그인도 SDK 없이 `/api/auth/*`를 직접 부른다

## 무료 Apple ID로 내 아이폰에서 실행

> 처음이라면 **[docs/ios-device-setup.md](../docs/ios-device-setup.md)** 를 따라가는 편이 빠르다 —
> 준비물부터 기기 점검 체크리스트·자주 나는 오류까지 순서대로 적어 두었다.

App Group(`group.com.fromj.trip`)과 푸시(`aps-environment`)는 **유료 Developer Program에서만** 발급된다.
무료 Apple ID로 `project.yml` 을 쓰면 서명에서 막힌다. 그래서 본체 앱만 만드는 `project-free.yml` 을 따로 둔다.

```bash
cd ios && xcodegen generate --spec project-free.yml && open TripCanvasFree.xcodeproj
```

1. **폰**: 설정 → 개인정보 보호 및 보안 → **개발자 모드** 켜기 → 재시동 (iOS 16+)
2. 케이블로 Mac에 연결하고 폰에서 **이 컴퓨터를 신뢰** 선택
3. **Xcode**: TARGETS → TripCanvas → Signing & Capabilities → **Team** 에서 Personal Team 선택
4. 상단 destination 에서 **내 아이폰** 선택 후 `⌘R`
5. 첫 실행은 거부된다 — **폰**: 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → **신뢰**

무료 계정의 제약:

- **7일 뒤 만료** — 다시 `⌘R` 로 설치해야 열린다
- 위젯 · 잠금화면 · 공유 확장 · Watch 는 **뜨지 않는다** (App Group이 없어 상태를 주고받지 못한다)
- 원격 푸시는 오지 않는다. 로컬 알림은 동작한다
- `failed to register bundle identifier` 가 나오면 `project-free.yml` 의 `PRODUCT_BUNDLE_IDENTIFIER` 를
  겹치지 않는 값으로 바꾼다 (예: `com.fromj.trip.<본인닉>`)

앱 코드는 손대지 않아도 된다 — App Group 접근은 `UserDefaults?` 라 권한이 없으면 `nil` 로 떨어지고,
Live Activity 는 `areActivitiesEnabled` 가 false 라 조용히 건너뛴다.

## 설정

`TripCanvas/App/AppEnvironment.swift`의 `AppConfig`가 기본값을 들고 있다 — API는 **NAS**(`https://bokbok9.tail8b977f.ts.net`, Tailscale Funnel이 HTTPS를 붙인다. 2026-09-04 전환)이고
**로그인도 같은 서버**다. 로컬 서버로 붙을 때는 `Info.plist`의 `TCApiBaseURL`을 덮어쓴다 — http라면 ATS 예외(`NSAllowsLocalNetworking`)도 함께 넣는다.

## 구조

```
App/          진입점·환경·설정
Core/
  Models/     contract.ts를 그대로 옮긴 Codable (알 수 없는 enum 값은 .unknown으로 떨어진다)
  Networking/ URLSession + Bearer + 오류 매핑
  Auth/       TripCanvas Auth(`/api/auth/*`) + Keychain 세션
  Storage/    마지막 Today 캐시 (오프라인 읽기)
  Location/   단발성 위치 조회 (연속 추적 없음)
Features/     Trips · Today · Plan(일정 편집) · Map(듀얼 엔진 지도·검색) · Booking(예약 목록·편집) ·
              Collab(멤버·초대·취향·활동 · 후보 보드 · 초대 참여) · Suggestions · Replan
Services/     TripService (API 호출을 화면에서 감춘다)
DesignSystem/ 간격·타이포·공용 컴포넌트
Tests/        디코딩·상태 계산·ViewModel
```

## 네이티브 계층 (Travel Mode · Push · Live Activity · Widget)

판단은 여전히 서버(= 저장소 루트 `adaptive.js`)가 한다. 네이티브가 하는 일은 **언제 물어볼지**와
**어떻게 보여줄지**뿐이다.

| 무엇 | 어디 | 규칙 |
|---|---|---|
| Travel Mode | `Features/TravelMode/TravelModeController.swift` | 켜져 있을 때만 먼저 말을 건다. 시계로 polling하지 않고 앱 전환·사용자 동작·알림 열기에만 갱신 |
| 출발 알림 | `Core/Push/PushService.swift` | 기기가 판단하는 것(`origin: DEVICE`)만 로컬 알림. `dedupeKey`가 식별자라 같은 상황은 한 번만 뜬다 |
| 잠금화면 | `TripCanvasWidgets/` + `TripCanvasShared/TripCanvasActivityAttributes.swift` | `stateVersion`이 같으면 **갱신하지 않는다**. 오류가 나도 마지막 상태를 유지 |
| 위젯 | `TripCanvasWidgets/TripCanvasWidgets.swift` | 네트워크·인증 없음. 앱이 App Group에 써 둔 압축본만 읽고, 30분이 지나면 받은 시각을 함께 표시 |
| 위치 | `Core/Location/LocationProvider.swift` + `LocationPrimerView` | 첫 실행에 묻지 않는다. 필요한 순간에 이유를 먼저 말하고 단발성으로만 조회 |

서버는 `GET /api/v1/trips/:id/travel-state` 하나로 Today + Trip Pulse + 출발 계획 + 알림 계획 +
잠금화면/위젯 압축본을 준다. 여행 중에 endpoint를 연달아 부르는 것이 곧 배터리다.

⚠️ `NSSupportsLiveActivities`·App Group·`aps-environment`는 `project.yml`에 선언돼 있지만
**APNs 키와 서명은 각자 설정해야 한다.** 서버 → APNs 실제 발송은 아직 붙이지 않았다 —
서버는 "무엇을 보낼 만한가"(`notifications`)까지만 계산하고, 지금은 기기가 그중 자기 몫만 로컬로 띄운다.

## 확장 표면 (Siri · 공유 · Watch · 기록)

| 무엇 | 어디 | 규칙 |
|---|---|---|
| App Intents | Features/Intents/TripCanvasIntents.swift | 판단을 넣지 않는다. 서비스를 부르고 짧게 답한다. "지금 일정 완료"는 대상이 하나로 정해질 때만 |
| Action Router | Core/Routing/ActionRouter.swift | Siri·Push·위젯·Watch·공유가 **같은 딥링크 체계 하나**를 쓴다 |
| Share Extension | TripCanvasShare/ | 파싱하지 않는다. 받은 것을 큐에 넣고 바로 닫는다 — 네트워크가 없어도 유실되지 않게 |
| Booking Import | 서버 /api/v1/import/* | 미리보기까지만. 저장은 사용자가 확인한 뒤 별도 요청 |
| Apple Watch | TripCanvasWatch/ | 축소판이 아니다. "다음 뭐지?" 하나만. App Group 압축본만 읽는다 |
| Trip Memory | 서버 /api/v1/trips/:id/memories | 어느 일정인지 서버가 시각·위치로 짚는다. 사진 원본은 올리지 않는다 |

## 이번 단계에서 하지 않은 것

Apple Watch · Siri/App Intents · Share Extension · 서버발 APNs 발송 · Live Activity remote update ·
연속 위치 추적 · 백그라운드 geofencing · 완전 offline-first · 자동 예약/결제 · 실시간 항공/교통 API.
구조상 막히지 않도록 자리는 열어 두었다: 알림 계획에 `origin: SERVER` 항목이 이미 나오고,
`notification_log`가 중복을 막고, `TravelActivityState`는 ActivityKit이 그대로 쓰는 모양이다.
