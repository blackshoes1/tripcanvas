# 잠금화면 실시간 현황의 서버 갱신

앱에서 사용자가 켠 실시간 현황에 ActivityKit 전용 push token이 발급되면, 로그인한 계정의
여행과 함께 API에 등록한다. 계속 실행 중인 NAS API의 worker가 서버의 여행 상태를 계산하고
다음 일정 경계에서 APNs로 보낸다. 앱이 화면에 없어도 iOS가 잠금화면 내용을 갱신할 수 있다.
새 실시간 현황을 원격으로 시작하거나 일반 알림을 띄우는 기능은 아니다.

## 운영 설정

Apple Developer의 해당 팀에서 **Apple Push Notifications service(APNs)** 권한이 있는
인증 키를 준비한다. App Store Connect API 키와 다른 키다. 앱 ID `com.fromj.trip`에
Push Notifications capability가 켜져 있어야 한다. 새 인증 키는 만들 때 한 번만 내려받을 수
있으므로 승인된 비밀 저장소에 보관한다.

운영 NAS의 키는 `Production` · `Topic Specific` · `com.fromj.trip`으로 제한한다.
개발용 Sandbox 푸시는 별도 개발 API 환경에 Sandbox 키를 설정해 확인한다.
운영 전용 키로 Sandbox에 전송하면 Apple이 거절하므로 개발 빌드와 운영 키를 섞지 않는다.

NAS의 Git에서 제외된 `deploy/.env`에 다음 세 값을 모두 설정한다. 실제 값은 채팅·PR·로그에
붙이지 않는다. 예제 파일·저장소·이미지·iOS 번들에 `.p8`이나 비밀키를 넣지 않는다.

| 환경변수 | 값 |
|---|---|
| `APNS_TEAM_ID` | 키가 속한 Apple Developer Team ID(10자리) |
| `APNS_KEY_ID` | APNs 인증 Key ID(10자리) |
| `APNS_PRIVATE_KEY` | `.p8`의 전체 PEM 본문. 실제 개행 또는 문자 그대로의 `\n` 모두 허용 |

운영 compose의 `api.env_file: .env`가 이 값을 API에 전달한다. 별도 서비스나 cron은 필요 없다.
환경변수를 바꾼 뒤에는 [NAS 운영 절차](nas-deployment.md)의 “.env를 고쳤으면 반드시 다시 띄운다”에
따라 API 컨테이너를 다시 만들어야 한다. `restart`만으로는 바뀐 값이 전달되지 않는다.

세 값이 모두 비면 원격 갱신은 꺼져 있다. 일부만 있거나 ES256에 맞지 않는 비밀키이면
정상적인 미설정으로 숨기지 않고 설정 오류를 보고한다. 오류에는 변수 이름만 포함하고
입력값·키 본문을 포함하지 않는다. 공개 health에는 설정 상태만 노출하며 토큰·키는 노출하지 않는다.
실제 키를 로드할 수 있다는 검사는 Apple 계정 권한이나 푸시 도착을 증명하지 않는다.

## 빌드와 APNs 환경

`ios/project.yml`의 Debug `aps-environment`는 `development`, Release는 `production`이다.
앱은 development를 등록 API의 `sandbox`로, production을 `production`으로 보낸다.
서버는 등록된 환경에 따라 `api.sandbox.push.apple.com` 또는 `api.push.apple.com`을 쓴다.
TestFlight·App Store 빌드는 **production**이다. 토큰을 다른 환경에 보내거나 일반 기기 토큰을
ActivityKit 토큰 대신 보내면 동작하지 않는다.

소스의 entitlement 선언·Apple Developer의 Push 활성화·업로드 성공만으로는 배포 앱의
실제 푸시 권한을 확인할 수 없다. TestFlight 업로드는 `scripts/check-ios-signing.py`로
archive와 배포 서명된 IPA를 각각 검사한다. 본체의 실제 서명에 `aps-environment=production`이
있고, 본체·위젯·공유 확장·Watch의 App Group이 프로파일의 허용값과 맞아야 한다.
검사에 실패하면 업로드하지 않으며, 통과한 바로 그 IPA를 전송한다.
서명·프로파일 원문은 로그에 남기지 않는다.

근거: [프로파일과 실제 코드 서명 권한의 차이](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles),
[서명 권한 문제 확인 절차](https://developer.apple.com/library/archive/technotes/tn2415/_index.html).

HTTP/2 요청의 topic은 `com.fromj.trip.push-type.liveactivity`, push type은 `liveactivity`다.
서버는 Node 기본 crypto로 ES256 provider JWT를 만들고 45분 동안 재사용하며 환경별 연결을
재사용한다. `ContentState`의 날짜는 Swift 기본 Codable 형식인 2001년 기준 초로 변환한다.
APNs의 `timestamp`·`stale-date`·`dismissal-date`는 Unix 초다.

## 현재 장소와 다음 출발 안내

`TodayResponse`와 실시간 현황의 선택 필드 `nowFocus`가 지금 먼저 보여 줄 내용을 정한다.
기존 `nextAction`·`nextTitle`·`target`은 이전 앱과의 호환성을 위해 유지한다.
실제 위치나 해당 기기의 유효한 도착 관측으로 현재 장소가 확인되면 그 장소를 먼저 보여 주고,
다음 장소와 출발까지 남은 시간은 보조로 표시한다. 위치가 확인되지 않은 공백에는 장소를
추측하지 않고 다음 출발까지의 여유를 보여 준다.

전환 시각은 서버가 계산한다. 다음 장소의 도착 시각에서 이동 시간과 안전 여유를 뺀 권장
출발 시각을 기준으로, 기존 출발 준비 구간인 12분 전부터 다음 장소 안내를 먼저 보여 준다.
앱은 이 경계에서 다시 조회하고, 앱이 닫혀 있으면 worker가 APNs로 갱신한다. 남은 시간의
초 단위 표시는 기기의 타이머를 쓰며 매분 푸시하지 않는다. `nowFocus` 안의 날짜는 API와
APNs 모두 ISO 문자열로 유지하고, 기존 `ContentState`의 Date 필드 변환은 그대로 둔다.

예정 체류 시간이 지났다는 이유만으로 실제 도착 관측을 버리지 않는다. 이탈·더 새로운 외부
위치·일정 수정·다른 날짜·완료 또는 건너뛰기로 무효화하며, 위치를 방문 완료로 바꾸지는 않는다.
현재 장소 표시가 남아 있어도 오늘의 현재·미래 일정이 모두 끝나면 실시간 현황은 종료한다.

## 실패 처리와 확인

APNs가 200을 반환하면 **Apple이 수락한 것**이다. 기기 도착·표시 성공과 구분한다.
410 또는 잘못된 토큰 응답은 해당 등록을 해제한다. 인증 실패는 사용자 토큰을 지우지 않는다.
429는 지연 후, 5xx는 최소 15분 뒤 다시 예약하며 `Retry-After`가 더 길면 이를 따른다.
본문·토큰·JWT는 오류 로그로 남기지 않고 알려진 오류 코드만 남긴다.

전체 JSON payload가 UTF-8 **4096바이트**를 넘으면 `PayloadTooLarge`로 보내기를 중단한다.
도메인은 10,000자 문자열도 허용하므로 긴 여행명·장소명으로 이 한도에 닿을 수 있다.
서버는 사용자가 적은 이름을 임의로 잘라 보내지 않는다. 해당 항목을 줄인 뒤 앱에서 실시간
현황을 다시 켜서 확인한다. 새 등록 전까지 실패 등록의 무한 재시도는 하지 않는다.

실기기에서는 새 빌드·알맞은 계정으로 여행 중인 일정을 열고 실시간 현황을 켠다.
앱을 화면에서 벗어나게 한 뒤 잠금화면에서 다음 일정·시간대·현지 날짜가 경계 뒤 바뀌는지
확인한다. 토큰 교체, 종료, 로그아웃 뒤 갱신 중단도 확인한다. 이 검증에는 서명된 빌드,
APNs 운영 키, 온라인 iPhone이 필요하다. 모의 전송기·로컬 HTTP/2·시뮬레이터 테스트는
실제 도착을 증명하지 못하며, APNs 수락 후에도 iOS의 예산·연결 상태에 따라 지연될 수 있다.

공식 근거: [ActivityKit push payload와 token](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications),
[provider JWT와 갱신 주기](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
[APNs 응답·재시도 정책](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns),
[APNs 연결 재사용](https://developer.apple.com/documentation/usernotifications/establishing-a-connection-to-apns).

## 등록 API와 예약 수명

자체 Auth의 bearer 세션으로 `POST /api/v1/live-activities`를 호출한다. JSON 모양은 다음과 같다.
실제 토큰 대신 형식 설명을 적었다.

```json
{
  "deviceId": "기기에 저장한 식별자",
  "activityId": "ActivityKit 식별자",
  "tripId": "여행의 client id",
  "pushToken": "ActivityKit이 발급한 토큰의 hex 문자열",
  "environment": "production",
  "startedAtISO": "2026-10-27T09:00:00Z",
  "tokenRevision": 1793091600000
}
```

성공은 `{ "registered": true, "expiresAtISO": "..." }`다. `tokenRevision`은 기기가 토큰을
받을 때마다 영구 저장한 전역 이전 값보다 큰 양의 안전 정수로 만든다. 서버는 같은 기기의
이전 활동·이전 토큰 요청이 늦게 도착해도 최신 등록을 덮어쓰지 않게 비교한다.
기기당 활성 등록 하나, 사용자당 열 개까지 허용한다. APNs 미설정·설정 오류·상시 worker를
실행할 수 없는 배포는 503 `SERVICE_UNAVAILABLE`로 답하며 등록됐다고 응답하지 않는다.

종료는 `DELETE /api/v1/live-activities?deviceId=...&activityId=...`다. 종료 기록은 활동 수명까지
남겨 DELETE보다 늦게 온 POST가 다시 등록하지 못하게 한다. 로그인 원문 bearer를 별도로
저장하지 않고 검증된 자체 Auth 세션 행에 연결한다. 로그아웃으로 세션이 지워지면 등록도
함께 지워진다. 매 발송 직전 세션 만료·메일 확인·현재 여행 접근 권한을 다시 검사한다.

worker는 상시 실행 Node 서버의 Next instrumentation에서 시작하며 5초마다 보낼 예약을
살핀다. DB lease로 여러 API 인스턴스가 같은 등록을 동시에 발송하지 않게 한다. 다음 장소의
시작·종료·출발 준비·출발 시각·여행지 자정에 다시 계산하고, 다른 기기의 문서 수정은 최대 1분마다
확인한다. 내용 지문이 같으면 APNs를 반복 호출하지 않는다. 시간 경계의 전달은 polling 간격과
APNs·기기 상태만큼 지연될 수 있다. 서버의 계산은 저장된 일정과 추정 이동시간을 사용하며
기기 GPS를 계속 추적하거나 유료 경로 API를 호출하지 않는다.

활동은 시작 후 최대 8시간만 등록한다. 여행 중 자정을 지나면 새 날짜의 일정과 Day 표기를
보내고, 여행 기간 밖이면 첫날 미리보기로 돌아가는 대신 활동을 종료한다. 만료된 종료 기록은
작은 묶음으로 정리한다. `TC_READ_ONLY` 점검 모드에서는 worker가 시작하지 않는다.

공개 `/api/health`의 `components.liveActivity`는 미설정(`unconfigured`), worker 실행(`ok`),
설정·실행·APNs 거절 오류(`error`)를 구분한다. 실제 전송 실패는 빈 주기에 숨기지 않고 다음
APNs 수락까지 보존한다. 이 상태 역시 기기 도착 성공을 뜻하지 않는다.

서버 초기화 근거: [Next instrumentation](https://nextjs.org/docs/app/guides/instrumentation).
