# TripCanvas iOS (SwiftUI)

여행을 **실행하는** 앱. 계획·편집·예약 관리는 웹이 하고, 여기서는 "지금 무엇을 하면 되는가"에 답한다.

> ## ⚠️ 이 코드는 아직 한 번도 컴파일되지 않았다
>
> 작성 환경이 Windows라 Xcode·Swift 툴체인·시뮬레이터가 없었다. 아래 소스는 계약(`next/src/features/trip-state/domain/contract.ts`)에
> 맞춰 작성했지만 **빌드·실행·테스트 검증을 거치지 않았다.** Mac에서 처음 열면 컴파일 오류가 나올 수 있고,
> 그건 정상이다 — 먼저 빌드를 통과시킨 뒤 동작을 확인할 것.
>
> 반대로 **서버 쪽(`/api/v1`)은 전부 검증됐다** — `next` 워크스페이스에서 29개 계약 테스트가 통과한다.
> iOS가 붙기 전에도 `curl`로 응답을 그대로 확인할 수 있다.

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

## 설정

`TripCanvas/App/AppConfig.swift`의 기본값은 프로덕션(`https://tripcanvas-ai.vercel.app`)과 기존 Supabase 프로젝트를 가리킨다.
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
