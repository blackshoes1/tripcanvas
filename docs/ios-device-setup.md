# 내 아이폰에 TripCanvas 올리기

폰에 앱을 올리는 두 가지 길이 있다. **유료 Developer Program이 있으면 첫 번째 길이 훨씬 편하다** —
Mac 앞에 앉을 필요가 없다.

목차: [가장 빠른 길](#가장-빠른-길--testflight-xcode를-안-연다) · [준비물](#준비물) ·
[Xcode로 직접 설치](#xcode로-직접-설치) · [기기 점검 체크리스트](#기기-점검-체크리스트) ·
[무료 Apple ID로 하려면](#무료-apple-id로-하려면) · [오류가 났을 때](#오류가-났을-때) ·
[설정 바꾸기](#설정을-바꾸고-싶을-때)

---

## 가장 빠른 길 — TestFlight (Xcode를 안 연다)

CI가 빌드해서 TestFlight에 올리고, 폰의 TestFlight 앱에서 받는다. 이후 새 버전도 버튼 한 번이다.

### 처음 한 번만 (10분)

1. [App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
   에서 키를 만든다 (역할: **App Manager**).
   **`.p8` 파일은 그때 딱 한 번만 받을 수 있다** — 잘 보관할 것
2. 같은 화면의 **Issuer ID** 와 방금 만든 **Key ID** 를 적어둔다
3. [developer.apple.com → Membership](https://developer.apple.com/account#MembershipDetailsCard) 에서
   **Team ID**(10자리)를 적어둔다
4. App Store Connect → **My Apps → + → New App** 으로 앱 레코드를 만든다 (Bundle ID: `com.fromj.trip`)
5. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret** 으로 네 개를 넣는다:

   | 이름 | 값 |
   |---|---|
   | `APPSTORE_ISSUER_ID` | 1번 화면의 Issuer ID |
   | `APPSTORE_KEY_ID` | 만든 키의 Key ID |
   | `APPSTORE_PRIVATE_KEY` | `.p8` 파일 **내용 전체** — `BEGIN` 줄부터 `END` 줄까지 줄바꿈까지 그대로 |
   | `APPLE_TEAM_ID` | Team ID (10자리) |

### 올릴 때마다

GitHub → **Actions → iOS TestFlight → Run workflow**.

빌드 번호는 실행 번호가 자동으로 들어간다 — 같은 번호는 두 번 못 올리는데 손으로 하면 반드시 잊는다.
App Store Connect 처리에 보통 5~15분, 그다음 폰의 TestFlight 앱에 뜬다.
첫 업로드라면 **TestFlight → 내부 테스트**에 자기 계정을 테스터로 추가해야 보인다.

> 인증서·프로비저닝 프로파일을 따로 만들 필요가 없다. API 키만 있으면 Xcode가 필요한 것을
> 알아서 만들고 내려받는다(`-allowProvisioningUpdates`). `.p12`를 주고받는 일도 없다.

### 그래도 Xcode가 필요한 경우

- **디버깅** — 콘솔 로그를 보거나 중단점을 걸어야 할 때
- **위치 시뮬레이션** — 실제로 이동하지 않고 Travel Mode를 볼 때
- 업로드 전에 **빠르게 확인**하고 싶을 때 (TestFlight는 처리에 10분쯤 걸린다)

---

## 준비물

Xcode로 직접 설치할 때만 필요하다. TestFlight로만 받을 거면 폰과 Apple ID면 된다.

| 무엇 | 비고 |
|---|---|
| **Mac** | Xcode가 macOS에서만 돈다 |
| **Xcode 15 이상** | App Store에서 설치. 10GB 넘으니 미리 받아둘 것 |
| **iPhone (iOS 17 이상)** | 앱이 `@Observable`·Live Activity를 써서 17이 최소다 |
| **케이블** | 첫 설치는 유선이 확실하다 |

---

## Xcode로 직접 설치

### 1. XcodeGen 설치

Xcode 프로젝트 파일은 저장소에 넣지 않는다(손으로 고치면 잘 깨진다). `project.yml` 명세에서 만들어 쓴다.

```bash
brew install xcodegen
```

> `brew: command not found` 라면 먼저 [Homebrew](https://brew.sh)를 설치한다.

### 2. 프로젝트 만들기

```bash
cd ios
xcodegen generate
open TripCanvas.xcodeproj
```

### 3. 폰에서 개발자 모드 켜기

iOS 16부터 필요하다. **설정 → 개인정보 보호 및 보안 → 개발자 모드 → 켬** → 재시동.

> 이 항목이 안 보이면, Mac에 케이블로 한 번 연결한 뒤 다시 보면 나타난다.

### 4. 폰 연결하고 신뢰

케이블로 연결하면 폰에 "이 컴퓨터를 신뢰하시겠습니까?" → **신뢰** → 암호 입력.

### 5. 서명 — 모든 타깃에

Xcode 왼쪽에서 **TripCanvas** 프로젝트 클릭 → **TARGETS** 에서 아래 다섯을 **하나씩** 골라
**Signing & Capabilities → Team** 을 같은 팀으로 지정한다.

```
TripCanvas   TripCanvasWidgets   TripCanvasShare   TripCanvasWatch   TripCanvasTests
```

**본체만 고르고 위젯을 빼먹는 것이 가장 흔한 실수다** — 빌드가 서명에서 멈춘다.

그리고 [Apple Developer 콘솔](https://developer.apple.com/account/resources/identifiers/list/applicationGroup)에서
App Group `group.com.fromj.trip` 를 만들어 둔다. 이 문자열은 세 군데가 정확히 같아야 한다:

| 어디 | 값 |
|---|---|
| `ios/project.yml` 의 각 타깃 entitlements | `group.com.fromj.trip` |
| 코드 `TripCanvasShared/SharedSnapshotStore.swift` 의 `appGroupId` | `group.com.fromj.trip` |
| Developer 콘솔에 등록된 App Group | `group.com.fromj.trip` |

하나라도 다르면 **오류 없이 조용히** 위젯이 빈 화면으로 뜬다.

### 6. 실행

Xcode 상단 가운데 실행 대상에서 **내 아이폰**을 고르고 `⌘R`.

### 7. 첫 실행은 거부된다 (정상)

폰에서 **설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 →** 내 Apple ID → **신뢰**.
그다음 홈 화면에서 앱을 연다.

---

## 기기 점검 체크리스트

설치가 됐으면 실제로 도는지 확인한다. 폰을 손에 들고 순서대로 짚어가는 목록이다.
안 되는 항목은 **어디서 멈췄는지**를 적어두면 고치기 쉽다.

### 핵심 (여기가 안 되면 나머지는 볼 필요 없다)

- [ ] 앱이 홈 화면에 뜬다 — 아이콘이 **회색 기본 아이콘이 아니라 TripCanvas 핀 아이콘**이다
- [ ] 앱이 켜진다 (첫 화면에서 안 멈춘다)
- [ ] 로그인된다 (웹과 같은 계정)
- [ ] 여행 목록에 **웹에서 만든 여행**이 보인다
- [ ] Today 화면에 오늘 일정이 보인다
- [ ] 앱을 완전히 껐다 켜도 **로그인이 유지된다**

### 적응형 흐름

- [ ] NextAction이 보인다
- [ ] Suggestion이 보인다 / Accept / Skip
- [ ] Replan 미리보기
- [ ] 일정 완료 처리

### 네트워크

- [ ] Wi-Fi
- [ ] 셀룰러
- [ ] **비행기 모드** — 마지막 Today가 보이고, 오프라인 표시가 뜬다. 무한 로딩에 빠지지 않는다
- [ ] 느린 네트워크 (설정 → 개발자 → Network Link Conditioner)

### 시각 (여행 앱에서 제일 자주 틀리는 곳)

- [ ] **폰 시간대 = 서울, 여행 시간대 = 마드리드** — 일정 시각이 현지 기준으로 맞게 보인다
- [ ] 폰 시간대를 마드리드로 바꿔도 같은 시각이 보인다
- [ ] 23:30 일정 / 00:30 호텔 도착이 **엉뚱한 날짜로 넘어가지 않는다**

> 폰 시간대 바꾸기: 설정 → 일반 → 날짜 및 시간 → 자동 설정 끄기 → 시간대

### 위치

- [ ] 위치 권한을 **거부**해도 앱의 핵심 기능이 쓰인다
- [ ] 권한을 허용하면 Travel Mode가 위치를 쓴다
- [ ] "정확한 위치" 끔 상태에서도 안 깨진다
- [ ] Travel Mode를 30분 켜둬도 배터리가 눈에 띄게 닳지 않는다

### 알림 · 위젯 · 확장

- [ ] 알림 권한 요청이 **첫 실행이 아니라** 알림이 쓸모 있어지는 시점에 뜬다
- [ ] 알림이 실제로 온다 / 탭하면 해당 화면으로 간다
- [ ] 위젯을 홈 화면에 추가할 수 있다 (로그인 전 / 여행 없음 / 오프라인에서도 깨지지 않는다)
- [ ] 잠금화면 Live Activity가 뜨고 갱신되고 끝난다
- [ ] Safari에서 링크를 **공유 → TripCanvas** 로 보낼 수 있다
- [ ] Siri: "TripCanvas에서 오늘 일정 보기"
- [ ] Watch에 앱이 설치되고 다음 일정이 보인다

---

## 무료 Apple ID로 하려면

유료 프로그램 없이도 **본체 앱만** 폰에 올릴 수 있다. 제약이 크니 유료 계정이 있으면 위쪽 길을 쓴다.

|  | 무료 Apple ID | 유료 Developer Program |
|---|---|---|
| 본체 앱 (로그인·Today·Travel Mode) | ✅ | ✅ |
| 위젯 · 잠금화면 · Dynamic Island | ❌ | ✅ |
| 공유 확장 · Apple Watch | ❌ | ✅ |
| 원격 푸시 | ❌ (로컬 알림은 됨) | ✅ |
| 설치 유효기간 | **7일** | 1년 |
| TestFlight | ❌ | ✅ |

App Group과 푸시 권한이 유료 프로그램에서만 발급되기 때문이다. **앱 코드는 손대지 않아도 된다** —
App Group 접근은 권한이 없으면 `nil`로 떨어지고 Live Activity는 조용히 건너뛰도록 짜여 있다.

```bash
cd ios
xcodegen generate --spec project-free.yml
open TripCanvasFree.xcodeproj
```

그다음은 위 [Xcode로 직접 설치](#xcode로-직접-설치)의 3~7번과 같다 (타깃이 하나뿐이라 서명도 하나만).

---

## 오류가 났을 때

### `Signing for "TripCanvas" requires a development team`

Team을 안 골랐다. TARGETS → Signing & Capabilities → Team.
**타깃마다 따로 골라야 한다** — 본체만 고르고 위젯을 빼먹는 경우가 가장 흔하다.

### `Failed to register bundle identifier`

같은 Bundle ID를 다른 사람(또는 예전 내 계정)이 이미 썼다.
`ios/project-free.yml` 의 `PRODUCT_BUNDLE_IDENTIFIER` 를 겹치지 않게 바꾼다:

```yaml
PRODUCT_BUNDLE_IDENTIFIER: com.fromj.trip.내닉네임
```

바꾼 뒤 `xcodegen generate --spec project-free.yml` 을 다시 돌린다.

### 폰이 목록에 안 뜬다

1. 케이블 연결 확인 (충전 전용 케이블은 안 된다)
2. 폰에서 **이 컴퓨터를 신뢰** 했는지
3. **개발자 모드**가 켜져 있는지 → 켠 뒤 **재시동 필요**
4. Xcode → Window → Devices and Simulators 에서 보이는지

### `Untrusted Developer` / 앱이 안 열린다

폰: 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 내 Apple ID → **신뢰**.

### 앱이 7일 뒤 안 열린다

무료 계정의 정상 동작이다. Mac에 연결해 `⌘R` 로 다시 설치하거나, 유료 계정 + TestFlight로 간다.

### 위젯이 목록에 안 나온다

순서대로 의심한다:

1. **무료 계정인가?** → App Group이 없어서 정상적으로 안 뜬다
2. 앱을 **한 번은 실행**했는가? 위젯은 앱이 App Group에 써 둔 값을 읽는다 — 쓴 게 없으면 안 뜬다
3. App Group 문자열이 세 곳에서 같은가? (위 서명 단계의 표)
4. 위젯 타깃에 Team이 지정돼 있는가?

### 위젯이 뜨는데 내용이 비어 있다

App Group은 붙었는데 값이 없는 상태다. 앱을 열어 Today를 한 번 보고 나서 위젯을 다시 본다.
그래도 비어 있으면 App Group 문자열 불일치를 의심한다 — 이 경우 **오류가 나지 않고 조용히 빈다.**

### 푸시 토큰이 안 나온다 / 알림이 안 온다

- 시뮬레이터에서는 원격 푸시가 안 온다. **실기기로 확인한다**
- 무료 계정은 원격 푸시가 없다 (로컬 알림은 된다)
- 알림 권한을 거부한 적이 있으면: 설정 → TripCanvas → 알림에서 다시 켠다
- **TestFlight 빌드에서만 안 온다면** `aps-environment` 문제인데, 이건 구성별로 갈라 뒀다 —
  Debug는 `development`, Release는 `production`. Xcode에서 Release로 빌드해 확인해 본다

### TestFlight 업로드가 실패한다

- **`No profiles for 'com.fromj.trip' were found`** → App Store Connect에 앱 레코드를 안 만들었다
  (My Apps → + → New App, Bundle ID `com.fromj.trip`)
- **`already been used`** → 같은 빌드 번호를 두 번 올렸다. CI는 실행 번호를 쓰므로 보통 안 나지만,
  손으로 올렸다면 올린다
- **인증 오류** → API 키 역할이 **App Manager** 인지, `.p8` 내용을 `BEGIN` 줄부터 `END` 줄까지
  줄바꿈까지 통째로 넣었는지 확인

### `xcodegen: command not found`

`brew install xcodegen`. Homebrew가 없으면 [brew.sh](https://brew.sh) 먼저.

XcodeGen을 안 쓰고 싶으면 Xcode에서 iOS App 프로젝트를 새로 만들고 `ios/TripCanvas/` 폴더를
통째로 추가해도 된다 (Bundle ID·Deployment Target은 `project.yml` 값을 참고).

### 여행이 하나도 안 보인다 (로그인은 됐는데)

API 주소를 잘못 보고 있을 가능성이 높다. `/api/v1` 은 정적 웹(`tripcanvas-ai`)이 아니라
**별도 Next 프로젝트**(`tripcanvas-api`)가 서빙한다. 정적 웹을 가리키면 모든 호출이 404가 되는데
앱에는 오류가 아니라 **"여행 없음"** 으로 보인다.

`ios/project.yml` 의 `TCApiBaseURL` 이 `https://tripcanvas-api.vercel.app` 인지 확인한다.

---

## 설정을 바꾸고 싶을 때

기본값은 프로덕션을 가리킨다. 로컬 서버로 붙이려면 `ios/project.yml` 의 Info.plist 속성을 고친다:

| 키 | 기본값 | 언제 바꾸나 |
|---|---|---|
| `TCApiBaseURL` | `https://tripcanvas-api.vercel.app` | 로컬 API 서버로 붙일 때 |
| `TCSupabaseURL` | 비움 → 코드 기본값 | 다른 Supabase 프로젝트를 볼 때 |
| `TCSupabaseAnonKey` | 비움 → 코드 기본값 | 위와 같음 |

코드 쪽 기본값은 `ios/TripCanvas/App/AppEnvironment.swift` 의 `AppConfig` 에 있다.

> Supabase anon 키는 **공개용**이다 (웹도 같은 값을 들고 있고, 데이터는 RLS가 지킨다).
> service role 키나 Provider 비밀키는 **앱에 절대 넣지 않는다** — 그건 서버 함수에만 둔다.
