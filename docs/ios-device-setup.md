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
   에서 키를 만든다 — **역할은 `Admin`** (App Manager 로는 안 된다, 아래 주의 참고).
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

`테스터에게 보일 변경 사항`에 적은 것은 폰의 TestFlight에 **테스트할 내용**으로 뜬다
(`scripts/testflight-notes.js`가 App Store Connect API로 넣는다 — `xcodebuild`는 바이너리만 올린다).
비우면 그 칸이 빈 채로 올라가고, 폰에서는 뭐가 바뀐 빌드인지 알 수 없다.

빌드 번호는 실행 번호가 자동으로 들어간다 — 같은 번호는 두 번 못 올리는데 손으로 하면 반드시 잊는다.
App Store Connect 처리에 보통 5~15분, 그다음 폰의 TestFlight 앱에 뜬다.
첫 업로드라면 **TestFlight → 내부 테스트**에 자기 계정을 테스터로 추가해야 보인다.

### 업로드는 성공했는데 폰에 안 뜰 때

순서대로 본다. 위쪽일수록 흔하다.

| 증상 | 원인 | 할 일 |
|---|---|---|
| App Store Connect에 빌드가 있고 **"수출 규정 준수 정보 누락"** | 빌드마다 묻는 암호화 질문에 답을 안 했다 | 빌드 옆 **관리** → "표준 암호화만 사용" → 저장. `ITSAppUsesNonExemptEncryption`을 Info.plist에 넣어 두면(2026-09-06부터 넣었다) 다시 안 묻는다 |
| 빌드가 **"처리 중"**에서 멈춰 있음 | 정상 — 보통 5~15분 | 기다린다 |
| 빌드는 보이는데 **폰의 TestFlight에 없음** | 내부 테스트 그룹에 내 계정이 없다 | TestFlight → 내부 테스트 → 그룹에 테스터 추가 |
| 폰에 **옛 빌드만** 보임 | 새 빌드가 그룹에 배포되지 않았다 | 그룹에서 빌드를 고른다 |
| TestFlight 앱 자체에 앱이 없음 | 초대 메일을 안 받았다 | 테스터로 추가된 주소로 온 초대를 수락한다 |

### 이메일은 오는데 푸시가 안 올 때

**앱의 `자동 업데이트`가 켜져 있으면 푸시가 안 온다.** TestFlight가 조용히 설치하고 알리지 않는다 —
"새 빌드가 있어요"는 사람이 눌러서 받아야 할 때만 보내는 알림이다.

⚠️ 설치가 안 된 앱과 비교하면 착각하기 쉽다. 설치가 안 된 앱은 **자동으로 업데이트할 대상이 없어서**
언제나 알림이 온다. 같은 기기·같은 계정인데 한쪽만 푸시가 오는 이유가 대개 이것이다.

푸시를 받고 싶으면 TestFlight → 그 앱 → **자동 업데이트를 끈다.** 둘 다는 안 된다.
(자동 업데이트는 iOS가 충전 중·Wi-Fi 같은 때에 알아서 하므로 즉시가 아니다 — 몇 시간 걸리기도 한다)

⚠️ **수출 규정 준수는 업로드 로그에 아무 흔적도 남기지 않는다.** 워크플로는 초록인데 폰에는 영영 안 뜬다.

> 인증서·프로비저닝 프로파일을 따로 만들 필요가 없다. API 키만 있으면 Xcode가 필요한 것을
> 알아서 만들고 내려받는다(`-allowProvisioningUpdates`). `.p12`를 주고받는 일도 없다.
>
> ⚠️ **그래서 키 역할이 `Admin` 이어야 한다.** 인증서·프로파일을 만드는 일이라
> **Certificates, Identifiers & Profiles** 접근이 필요한데 `App Manager` 에는 그 권한이 없다.
> 역할은 나중에 바꿀 수 없으니, App Manager 로 만들었다면 그 키를 취소하고 Admin 으로 새로 만든다
> (Issuer ID는 그대로, Key ID와 `.p8` 만 새로 넣으면 된다).

### Actions를 못 쓸 때 — 이 Mac에서 직접 올리기

러너가 안 도는 동안에는(과금 중단 등) 위 버튼이 **잡을 시작조차 못 한다** — `docs/ci.md`.
그때는 같은 순서를 로컬에서 돌린다:

```bash
source ~/.tripcanvas-testflight.env     # KEY_ID · ISSUER_ID · TEAM_ID (저장소 밖에 둔다)
BUILD=6 NOTES='무엇이 바뀌었는지' scripts/testflight-upload.sh
```

- `.p8`은 `~/private_keys/AuthKey_<KeyID>.p8`에 두고 `chmod 600`. **저장소에는 넣지 않는다.**
- `BUILD`는 직접 준다. 같은 번호는 두 번 못 올리므로 Actions의 run number와 **한 줄에 세는 것이 안전하다** —
  `gh run list --workflow=ios-testflight.yml`의 가장 큰 번호보다 크게.
- 스크립트가 하는 일은 워크플로와 같다: XcodeGen → **서명 없는** Release 아카이브 → 배포용 서명 + 업로드.
  아카이브에서 자동 서명을 켜지 않는 이유도 같다(개발용 프로파일은 등록된 기기를 요구한다).
- 실패가 `Cloud signing permission error`나 `No profiles for ...`면 **API 키 역할이 Admin이 아닌 것**이다.
  스크립트가 그 경우를 알아보고 먼저 알려 준다.

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
- **`Cloud signing permission error` / `No profiles for '...' were found` (export 단계)**
  → **API 키 역할이 `Admin` 이 아니다.** 프로파일을 만들려면 Certificates, Identifiers & Profiles
  접근이 필요한데 `App Manager` 에는 없다. 역할은 바꿀 수 없으니 Admin 키를 새로 만들어
  `APPSTORE_KEY_ID` 와 `APPSTORE_PRIVATE_KEY` 를 교체한다 (Issuer ID는 그대로)
- **인증 오류** → `.p8` 내용을 `BEGIN` 줄부터 `END` 줄까지 줄바꿈까지 통째로 넣었는지 확인
- **`Your team has no devices from which to generate a provisioning profile`**
  → 메시지가 헷갈리는데 **기기를 등록하라는 뜻이 아니다.** Xcode가 배포용이 아니라
  **개발용(App Development)** 프로파일을 만들려 해서 나는 오류다. 개발용은 등록된 기기를
  요구하고, App Store 배포용은 요구하지 않는다. 워크플로는 이걸 피하려고 **archive를 서명 없이**
  만들고 **export에서만 배포용으로 서명**한다 — archive 단계에 `-allowProvisioningUpdates` 나
  자동 서명을 되살리면 이 오류가 다시 난다

### `xcodegen: command not found`

`brew install xcodegen`. Homebrew가 없으면 [brew.sh](https://brew.sh) 먼저.

XcodeGen을 안 쓰고 싶으면 Xcode에서 iOS App 프로젝트를 새로 만들고 `ios/TripCanvas/` 폴더를
통째로 추가해도 된다 (Bundle ID·Deployment Target은 `project.yml` 값을 참고).

### 여행이 하나도 안 보인다 (로그인은 됐는데)

API 주소를 잘못 보고 있을 가능성이 높다. `/api/v1` 은 정적 웹(`tripcanvas-ai`)이 아니라
**별도 Next 프로젝트**(`tripcanvas-api`)가 서빙한다. 정적 웹을 가리키면 모든 호출이 404가 되는데
앱에는 오류가 아니라 **"여행 없음"** 으로 보인다.

`ios/project.yml` 의 `TCApiBaseURL` 이 `https://bokbok9.tail8b977f.ts.net` (NAS, 2026-09-04 전환) 인지 확인한다.

---

## 설정을 바꾸고 싶을 때

기본값은 프로덕션을 가리킨다. 로컬 서버로 붙이려면 `ios/project.yml` 의 Info.plist 속성을 고친다:

| 키 | 기본값 | 언제 바꾸나 |
|---|---|---|
| `TCApiBaseURL` | `https://bokbok9.tail8b977f.ts.net` (NAS) | 로컬 API 서버로 붙을 때. http라면 `NSAppTransportSecurity: {NSAllowsLocalNetworking: true}` 도 함께. **로그인(`/api/auth/*`)도 이 주소로 간다** |
| `TCWebBaseURL` | `https://tripcanvas-ai.vercel.app/` | 초대 링크가 가리킬 웹 주소 |
| `TCGoogleMapsKey` · `TCKakaoNativeKey` | 저장소의 네이티브 키 | 다른 키를 쓸 때. **번들 ID 제한**이라 무료 스펙으로 번들 ID를 바꿨으면 콘솔의 제한에 그 값도 넣어야 한다 |

코드 쪽 기본값은 `ios/TripCanvas/App/AppEnvironment.swift` 의 `AppConfig` 에 있다.

> `TCSupabaseURL`·`TCSupabaseAnonKey`는 **2026-09-05에 없어졌다.** 로그인이 웹과 같은 자체 Auth로 옮겨가면서
> 앱에서 Supabase를 쓰지 않는다. 예전 빌드에서 올라온 Keychain 세션은 앱이 지우고 한 번 다시 묻는다.
>
> 지도 네이티브 키는 바이너리에 어차피 들어가므로 **번들 ID 제한이 실제 방어선**이다.
> service role 키나 Provider 비밀키는 **앱에 절대 넣지 않는다** — 그건 서버에만 둔다.
