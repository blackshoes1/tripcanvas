# TripCanvas iOS (SwiftUI)

여행을 **실행하는** 앱. 계획·편집·예약 관리는 웹이 하고, 여기서는 "지금 무엇을 하면 되는가"에 답한다.

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
- 외부 의존성 없음 — Supabase Auth도 REST + `URLSession`으로 직접 부른다 (SDK를 넣지 않았다)

## 무료 Apple ID로 내 아이폰에서 실행

> 처음이라면 **[docs/ios-device-setup.md](../docs/ios-device-setup.md)** 를 따라가는 편이 빠르다 —
> 준비물부터 기기 점검 체크리스트·자주 나는 오류까지 순서대로 적어 두었다.

App Group(`group.ai.tripcanvas.ios`)과 푸시(`aps-environment`)는 **유료 Developer Program에서만** 발급된다.
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
  겹치지 않는 값으로 바꾼다 (예: `ai.tripcanvas.ios.<본인닉>`)

앱 코드는 손대지 않아도 된다 — App Group 접근은 `UserDefaults?` 라 권한이 없으면 `nil` 로 떨어지고,
Live Activity 는 `areActivitiesEnabled` 가 false 라 조용히 건너뛴다.

## 설정

`TripCanvas/App/AppEnvironment.swift`의 `AppConfig`가 기본값을 들고 있다 — API는 `https://tripcanvas-api.vercel.app`(정적 웹이 아니다), Supabase는 기존 프로젝트.
로컬 서버로 붙일 때는 `Info.plist`의 `TCApiBaseURL`을 덮어쓴다.

## 구조

```
App/          진입점·환경·설정
Core/
  Models/     contract.ts를 그대로 옮긴 Codable (알 수 없는 enum 값은 .unknown으로 떨어진다)
  Networking/ URLSession + Bearer + 오류 매핑
  Auth/       Supabase Auth REST + Keychain 세션
  Storage/    마지막 Today 캐시 (오프라인 읽기)
  Location/   단발성 위치 조회 (연속 추적 없음)
Features/     Trips · Today · Suggestions · Replan · Booking · Map
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
