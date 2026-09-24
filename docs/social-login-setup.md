# With J 소셜 로그인 설정

## 현재 상태

Google·Apple·네이버·카카오 연결 코드가 웹(정적/Next)과 iOS에 들어 있다. Google 웹·iOS 클라이언트 ID는 등록해 코드와 설정 예시에 반영했다. Google 웹용 Client Secret은 NAS 운영 `.env`에 설정·형식 확인했다(값은 문서나 저장소에 기록하지 않는다). Apple·네이버·카카오의 개발자 설정은 아직 준비가 필요하다. 실제 제공자 로그인과 스토어 심사는 미검증이며, 운영 배포도 별도다. 기존 이메일 로그인은 유지한다.

서버에 각 제공자의 ID와 Secret이 모두 설정돼야 버튼이 나타난다. 키의 유효성까지 설정 API가 검사하는 것은 아니므로, 버튼 노출만으로 연결 완료를 판단하지 않는다.

## 공통 서버 설정

`deploy/.env`(NAS) 또는 API 호스팅의 비밀 환경 변수에 아래 값을 넣는다. 로컬은 `next/.env.local`을 사용한다. 커밋·채팅·앱 번들·NEXT_PUBLIC 변수에 비밀을 넣지 않는다.

```dotenv
OAUTH_GOOGLE_CLIENT_ID=457039812975-jijh2qrbb4q8qc6k0n9efcj3drt4q5kp.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_APPLE_CLIENT_ID=
OAUTH_APPLE_CLIENT_SECRET=
OAUTH_NAVER_CLIENT_ID=
OAUTH_NAVER_CLIENT_SECRET=
OAUTH_KAKAO_CLIENT_ID=
OAUTH_KAKAO_CLIENT_SECRET=
```

기존 `AUTH_SECRET`, `DATABASE_URL`, `API_BASE_URL`, `WEB_BASE_URL`, 허용 웹 출처 설정과 메일 발송 설정을 유지한다. 네이버처럼 이메일 추가 확인이 필요한 로그인은 메일 발송이 필수다. NAS compose는 `env_file: .env`로 전달하므로 값 변경 후 API 컨테이너 재생성이 필요하다. 전체 배포는 [NAS 릴리스 절차](nas-release.md)를 따른다.

등록할 콜백은 **웹 프런트 주소가 아니라 API 주소**다. 현재 구성 기준:

| 제공자 | Redirect / Callback / Return URL |
|---|---|
| Google | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/google` |
| Apple | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/apple` |
| 네이버 | `https://bokbok9.tail8b977f.ts.net/api/auth/callback/naver` |
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

[네이버 개발자센터](https://developers.naver.com/)에서 네이버 로그인 애플리케이션을 만들고 서비스 URL과 위 Callback URL을 등록한다. 이메일을 사용하도록 구성하고 Client ID/Secret을 서버에 넣는다. 테스트 사용자 및 공개 서비스 검수 절차를 완료한다. [연동 문서](https://better-auth.com/docs/authentication/naver).

현재 인증 라이브러리의 네이버 응답에는 검증된 이메일 표시가 없어, 최초 로그인은 With J 확인 메일을 거친다. 링크를 누른 뒤 같은 네이버 계정으로 다시 로그인한다. 메일 주소만 같다는 이유로 검증되지 않은 계정을 기존 여행에 연결하지 않는다.

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
- 네이버 최초 이메일 확인 및 재시도, Apple 재로그인·이메일 가리기 확인.
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
