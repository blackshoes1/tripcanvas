# With J 소셜 로그인 설정

## 현재 상태

Google·Apple·카카오 연결 코드가 웹(정적/Next)과 iOS에 들어 있다. **네이버는 숨겼다**(2026-10-02, 아래 [네이버](#네이버)). Google 웹·iOS 클라이언트 ID는 등록해 코드와 설정 예시에 반영했다. Google 웹용 Client Secret은 NAS 운영 `.env`에 설정·형식 확인했다(값은 문서나 저장소에 기록하지 않는다). Apple·카카오의 개발자 설정은 아직 준비가 필요하다. 실제 제공자 로그인과 스토어 심사는 미검증이며, 운영 배포도 별도다. 기존 이메일 로그인은 유지한다.

서버에 각 제공자의 ID와 Secret이 모두 설정돼야 버튼이 나타난다(네이버는 설정해도 나타나지 않는다). 키의 유효성까지 설정 API가 검사하는 것은 아니므로, 버튼 노출만으로 연결 완료를 판단하지 않는다.

## 공통 서버 설정

`deploy/.env`(NAS) 또는 API 호스팅의 비밀 환경 변수에 아래 값을 넣는다. 로컬은 `next/.env.local`을 사용한다. 커밋·채팅·앱 번들·NEXT_PUBLIC 변수에 비밀을 넣지 않는다.

```dotenv
OAUTH_GOOGLE_CLIENT_ID=457039812975-jijh2qrbb4q8qc6k0n9efcj3drt4q5kp.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_APPLE_CLIENT_ID=
OAUTH_APPLE_CLIENT_SECRET=
# 네이버는 숨겨 두었다 — 지금 이미지는 읽지 않지만 .env에 두지 않는다(아래 네이버 절)
# OAUTH_NAVER_CLIENT_ID=
# OAUTH_NAVER_CLIENT_SECRET=
OAUTH_KAKAO_CLIENT_ID=
OAUTH_KAKAO_CLIENT_SECRET=
```

기존 `AUTH_SECRET`, `DATABASE_URL`, `API_BASE_URL`, `WEB_BASE_URL`, 허용 웹 출처 설정과 메일 발송 설정을 유지한다. 제공자가 확인되지 않은 이메일을 주면 With J 확인 메일을 거치므로 메일 발송 설정이 필요하다. NAS compose는 `env_file: .env`로 전달하므로 값 변경 후 API 컨테이너 재생성이 필요하다. 전체 배포는 [NAS 릴리스 절차](nas-release.md)를 따른다.

등록할 콜백은 **웹 프런트 주소가 아니라 API 주소**다. 현재 구성 기준:

| 제공자 | Redirect / Callback / Return URL |
|---|---|
| Google | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/google` |
| Apple | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/apple` |
| 네이버(숨김 — 다시 켤 때만) | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/naver` |
| 카카오 | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/kakao` |

API 도메인을 이전하면 개발자 콘솔과 서버 설정을 함께 바꾼다. `WEB_BASE_URL`은 로그인 완료 후 돌아갈 웹 주소다. 웹에서 시작한 경우 서버 허용 출처에 포함된 시작 출처로 돌아간다. 임의 주소·와일드카드를 허용하지 않는다.

## 제공자 등록

### Google

[Google Cloud 콘솔](https://console.cloud.google.com/)에서 OAuth 동의 화면을 설정하고 **웹 애플리케이션** OAuth 클라이언트를 만든다. 위 Google 콜백을 등록하고 ID/Secret을 서버에 넣는다. 테스트 상태에서는 테스트 사용자를 등록한다. 이메일·프로필 범위로 확인한다. iOS는 Google 공식 SDK를 사용한다. iOS 클라이언트의 번들 ID는 `com.fromj.trip`이며, 아래 두 ID를 같은 Google Cloud 프로젝트에서 관리한다. 서버 ID를 수신 대상으로 발급된 ID token을 HTTPS로 서버에 보내며, Better Auth가 서명·발급자·수신 대상·만료·nonce를 검증한 후 With J 세션을 발급한다. iOS 클라이언트 ID 자체를 서버의 수신 대상으로 추가하지 않는다. [연동 문서](https://better-auth.com/docs/authentication/google).

Google 설정값(비밀이 아닌 공개 식별자):

| 용도 | 값 |
|---|---|
| iOS `GIDClientID` | `457039812975-oj50jeo2dm4k27shc8rpi8bpojd4ml8s.apps.googleusercontent.com` |
| 서버 `GIDServerClientID` / `OAUTH_GOOGLE_CLIENT_ID` | `457039812975-jijh2qrbb4q8qc6k0n9efcj3drt4q5kp.apps.googleusercontent.com` |
| iOS 콜백 URL scheme | `com.googleusercontent.apps.457039812975-oj50jeo2dm4k27shc8rpi8bpojd4ml8s` |

iOS 설정은 `ios/project.yml`과 `ios/project-free.yml`에 반영돼 있다. 번들 ID를 바꾼 무료 서명 빌드는 그 ID에 맞는 별도 iOS OAuth 클라이언트가 필요하다. 로그인 후 Google SDK 자격 증명은 지우고 기존 With J 세션만 Keychain에 보관한다. Google 동의 화면이 테스트 상태라면 실제 사용할 계정을 테스트 사용자로 등록한다. [Google 공식 iOS 설정](https://developers.google.com/identity/sign-in/ios/start-integrating), [서버 인증 안내](https://developers.google.com/identity/sign-in/ios/backend-auth).

**다음 단계:** NAS `deploy/.env`에 웹용 Client Secret을 저장했고 값은 출력하지 않고 존재·형식만 확인했다. 예시 파일을 고쳐도 운영 환경 변수는 자동 변경되지 않는다. Secret을 채팅이나 앱에 넣지 않는다. 이 변경의 서버·앱 배포 후 실계정 로그인을 확인한다.

### Apple

[Apple Developer](https://developer.apple.com/account/)에서 기존 App ID `com.fromj.trip`에 Sign in with Apple을 구성하고, 별도 Services ID를 해당 App ID에 연결한다. Services ID가 이번 브라우저 흐름의 `OAUTH_APPLE_CLIENT_ID`다. API 도메인과 위 Return URL을 등록한다.

Sign in with Apple 키(.p8), Key ID, Team ID로 ES256 서명 client secret JWT를 생성해 `OAUTH_APPLE_CLIENT_SECRET`에 넣는다. 발급 절차와 생성 예제는 [공식 연동 문서](https://better-auth.com/docs/authentication/apple)를 따른다. JWT는 최대 약 6개월 제한이 있어 만료 전에 교체해야 한다. .p8 원본은 비밀 저장소에 보관한다. localhost 대신 HTTPS 테스트 도메인을 사용한다.

‘이메일 가리기’ 주소는 기존 이메일과 다를 수 있다. 다른 주소를 같은 사람이라고 추정해 합치지 않는다. 최초 승인·재로그인·이메일 가리기·연결 해제 후 재가입을 각각 실기기로 확인한다. 이번 구현은 시스템 브라우저 방식이며 네이티브 Apple 자격 증명 직접 전달 방식은 포함하지 않는다.

### 네이버

**숨김(2026-10-02).** 서버가 네이버를 켜지도 알리지도 않는다 — `OAUTH_NAVER_*`가 있어도 읽지 않고(`next/src/server/auth/socialProviders.ts`의 `SOCIAL_PROVIDERS`에 없다) 서버 로그에 경고만 남긴다. 그래서 `auth-config`에 실리지 않고, `/api/auth/social/start?provider=naver`는 400이며, 웹·iOS에는 버튼이 없다(두 클라이언트는 서버가 알린 제공자만 그린다).

⚠️ **NAS `deploy/.env`에서 `OAUTH_NAVER_*`를 지운다.** 숨김은 코드에만 있고 `.env`는 이미지 밖에 있다 — 키를 남겨 둔 채 `nas-deploy.sh --sha`로 숨기기 전(2026-10-02 이전) 커밋으로 롤백하면, 다른 이유로 되돌렸어도 그 이미지가 키를 다시 읽어 `auth-config`가 네이버를 알리고 웹·iOS에 버튼이 돌아온다(클라이언트에 네이버 이름이 남아 있다). 서버 로그의 `OAUTH_NAVER_*` 경고가 남아 있다는 신호다.

왜: 인증 라이브러리(better-auth)의 네이버 매핑은 `emailVerified`를 **언제나 false**로 준다. With J는 확인된 이메일로만 계정을 잇는다(제공자 `requireEmailVerification`, `trustedProviders: []`, `finishSocialLogin`의 `emailVerified` 확인). 그 결과 이메일로 가입한 기존 사용자는 네이버로 **늘 실패**하고("account not linked"), 처음 온 사람도 확인 메일을 누른 뒤 한 번 더 로그인해야 한다. 신뢰 규칙을 풀지 않고 버튼을 숨겼다.

숨기기 전에 네이버로 가입한 사람이 있었다면(운영에 네이버 키가 들어간 적이 없다면 없다): 발급된 세션은 만료까지 그대로이고, 이후에는 이메일 로그인 화면의 **비밀번호 재설정**으로 비밀번호를 정해 이메일로 들어온다(라이브러리가 비밀번호 계정을 새로 만든다). 같은 확인된 이메일의 Google 로그인으로도 이어진다.

다시 켜려면:

1. **확인된 이메일이라는 근거를 먼저 마련한다** — 신뢰 규칙(위 세 곳)을 풀어서 켜지 않는다. 예: 이미 로그인한 계정에서 네이버를 명시적으로 연결하는 흐름(better-auth `linkSocial`)을 만들거나, 네이버 응답이 확인 여부를 주게 되면 매핑을 그 값으로 바꾼다.
2. `SOCIAL_PROVIDERS`에 `'naver'`를 되돌리고 `readSocialProviders`의 경고를 지운다. 숨김을 지키는 테스트(`socialHandoff.test.ts` · `config/env.test.ts` · `api/v1/auth-config/route.test.ts`)의 기대값도 함께 바꾼다.
3. [네이버 개발자센터](https://developers.naver.com/)에서 네이버 로그인 애플리케이션을 만들고 서비스 URL과 위 Callback URL을 등록한다. 이메일을 사용하도록 구성하고 Client ID/Secret을 서버에 넣은 뒤 API를 재생성한다. 테스트 사용자 및 공개 서비스 검수 절차를 완료한다. [연동 문서](https://better-auth.com/docs/authentication/naver).
4. 클라이언트는 고칠 것이 없다 — 웹 `auth.js`의 `SOCIAL_LABELS`와 iOS `SocialSignIn.Provider`에 네이버 이름이 남아 있어, 서버가 알리면 버튼이 다시 나온다.

메일 주소만 같다는 이유로 검증되지 않은 계정을 기존 여행에 연결하지 않는다.

### 카카오

[카카오 개발자센터](https://developers.kakao.com/)에서 With J용 앱의 카카오 로그인을 활성화하고 Redirect URI를 등록한다. `OAUTH_KAKAO_CLIENT_ID`에는 **REST API 키**, Secret에는 카카오 로그인 Client Secret을 넣는다. 지도용 JavaScript/네이티브 키와 구분한다.

이메일 동의 항목과 필요한 권한을 설정한다. 이메일 제공 권한 신청·비즈 앱 조건 등은 [카카오 설정 안내](https://developers.kakao.com/docs/ko/kakaologin/prerequisite)를 확인한다. 이메일이 없는 응답으로 임의 계정을 만들지 않는다. 기존 다른 서비스 앱을 재사용하려면 동의 화면의 서비스명·운영 주체·등록 플랫폼이 With J에 적절한지 먼저 확인한다.

## iOS 출시 전 확인

iOS 앱에서 Google 로그인을 활성화해 App Store에 제출하려면 [Apple의 로그인 서비스 심사 기준 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)에 맞는 동등한 로그인 선택지를 함께 제공해야 한다. 현재 Apple 로그인은 개발자 설정 전이라 버튼이 숨겨진다. TestFlight에서 Google을 시험할 수는 있지만 App Store 심사 전에는 Apple 로그인 등록·실계정 검증을 끝낸다.

## 동작과 검증

Google iOS 로그인은 공식 SDK가 발급한 ID token을 HTTPS로 서버에 보내고, Better Auth가 검증한 후 With J 세션을 발급한다. 웹·iOS의 다른 제공자는 Better Auth가 OAuth state·제공자 응답·계정·세션을 처리한다. 서버 콜백에서 60초짜리 암호화 일회용 교환권을 발급하고, 로그인 요청을 시작한 클라이언트가 PKCE 증명으로 교환한다. 세션 토큰은 HTTPS 응답으로만 받고 URL에 넣지 않는다. iOS는 기존 Keychain과 세션 확인 경로를 사용한다. 기존 인증 테이블을 사용하므로 새 DB 마이그레이션은 없다.

제공자별 등록 후 다음을 모두 확인한다:

- 웹과 실기기: 신규 가입 → 로그아웃 → 재로그인 → 기존 여행 조회·저장·실시간 연결.
- 기존 이메일 계정: 검증된 같은 이메일만 기존 계정에 연결되는지 확인.
- 동의 취소, 이메일 미동의, 네트워크 실패, 만료, 콜백 재사용 때 로그인되지 않는지 확인.
- 네이버 버튼이 웹·iOS 어디에도 없는지(서버 로그에 `OAUTH_NAVER_*` 경고가 있으면 `.env`에서 지운다), Apple 재로그인·이메일 가리기 확인.
- 비활성 제공자 버튼 숨김, 기존 이메일 가입·로그인·비밀번호 재설정 유지.

자동 테스트는 제공자 응답을 대체한 흐름 및 교환권 검증이다. 실제 서비스 로그인 성공을 대신하지 않는다. 배포 전 `npm run verify:all`과 제공자 실계정 확인을 완료한다. 문제 시 해당 제공자의 ID/Secret을 제거하고 API를 재생성하면 버튼이 숨겨진다. 이미 발급한 세션을 일괄 폐기하는 동작은 아니다.

## 로컬 검증 기록 (2026-09-24)

- 소셜 로그인 서버 테스트 8개, 웹 인증 테스트 23개 통과.
- iOS XCTest 469개 및 Release 시뮬레이터 빌드 통과.
- 루트 타입·lint, Next 타입·lint·build·tools:build, 정적 웹 E2E 및 Next API E2E 통과.
- 전체 게이트 첫 실행은 Next DB 테스트 시간 초과로 실패했다. 새 테스트의 타입 오류는 수정 후 타입 검사를 다시 통과했다. 병렬 수를 줄인 전체 재실행에서도 시간 초과 및 샌드박스 소켓 제한이 발생했다. 따라서 전체 게이트 통과로 기록하지 않는다.
- 실계정 OAuth와 TestFlight 확인은 남아 있다. 이후 Google 클라이언트 ID는 등록됐으며 Client Secret 설정은 별도다. 운영에는 배포하지 않았다.
- 제한된 동시 실행·타임아웃 확대·소켓 권한을 적용한 재검증도 일부 시간 초과가 남았다(14개 파일 중 9개 통과, 5개 실패). 소셜 로그인 및 기존 이메일 인증 테스트는 개별 실행에서 통과했지만, 릴리스 전 전체 게이트 재확인이 필요하다.

### Google 네이티브 연결 검증 (2026-09-24)

Google SDK 및 웹/iOS ID 적용 후 iOS 기존 테스트 469개와 Release 빌드가 통과했다. 추가 전송 테스트 2개도 통과했다. 서버 ID token 검증 테스트 6개(정상·수신 대상·발급자·만료·서명·nonce), Next 타입 검사와 해당 테스트 lint가 통과했다. 실계정 로그인 및 운영 배포는 아직 수행하지 않았다.
