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

## 이번 단계에서 하지 않은 것

Push · Widget · Live Activity · Dynamic Island · Apple Watch · 연속 위치 추적 · 완전 offline-first ·
자동 예약/결제. `TravelActivityState`(Live Activity가 그대로 쓸 compact state)와 위치 주입 지점만 열어 두었다.
