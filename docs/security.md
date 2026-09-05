# 보안 운영 기준

## 브라우저 키와 서버 비밀키

- `GMAPS_KEY`: Google Maps JavaScript/Routes 브라우저 키다. HTTP referrer를 프로덕션, Vercel Preview, 로컬 개발 주소로 제한하고 필요한 Maps JavaScript API, Places API, Routes API만 허용한다.
- `KAKAO_KEY`: Kakao JavaScript 키다. Kakao Developers의 플랫폼 웹 도메인에 프로덕션·Preview·로컬 개발 주소만 등록한다.
- iOS 네이티브 키(`TCGoogleMapsKey`·`TCKakaoNativeKey`): **번들 ID로 제한**된 별도 키다. 웹 키(리퍼러/도메인 제한)는 앱에서 거부되고, 구글 키는 제한을 한 종류만 걸 수 있어 웹 키와 iOS 키가 따로다. 값은 바이너리에 어차피 들어가므로 **번들 ID 제한이 실제 방어선**이다 — 콘솔(구글·카카오 둘 다)에 제한이 실제로 걸려 있는지 주기적으로 확인한다.
- Supabase publishable key: 공개 클라이언트 식별자다. **더 이상 프로덕션 데이터의 경계가 아니다** — 데이터는 NAS PostgreSQL에 있고 권한은 API의 `TripAuthorizationService`가 판정한다(RLS는 Supabase 시절의 경계였다). 롤백 대상(`tripcanvas-api`)에서만 의미가 있다.
- `KAKAO_REST_API_KEY`: Kakao Mobility REST 비밀키다. Vercel 서버 환경변수에만 설정하며 Preview/Production 환경을 구분한다.

기존에 정적 파일에 들어 있던 Kakao REST 키는 Git 이력과 배포 캐시에 남을 수 있다. 코드 배포 후 Kakao Developers에서 키를 회전하고 새 값을 Vercel 환경변수에 설정해야 한다.

### 공개 저장소 전환 후 — 브라우저 키 실측 (2026-09-06)

2026-09-06에 저장소를 공개로 바꿨다(`docs/ci.md`). 브라우저 키는 **원래도 배포된 번들에 들어 있어**
devtools를 열면 누구나 볼 수 있었다 — 바뀐 것은 *가능성*이 아니라 **발견 속도**다. 공개 저장소는
키를 자동으로 긁는 스캐너의 1차 대상이다.

제한이 실제로 걸려 있는지 밖에서 찔러 확인했다:

| 시험 | 결과 |
|---|---|
| Google 키 + 리퍼러 **없이** Places API | **차단** — `API_KEY_HTTP_REFERRER_BLOCKED` |
| Google 키 + 리퍼러를 **프로덕션 주소로 위조** | ⚠️ **통과** — 실제 검색 결과가 돌아온다 |
| Kakao JS 키 + **등록 안 된** 도메인 | **차단** — `AccessDeniedError: domain mismatched!` |
| Kakao JS 키 + 리퍼러를 **프로덕션 주소로 위조** | ⚠️ **통과** — SDK가 그대로 내려온다 |

**즉 두 제한 모두 `Referer` 헤더 하나에 걸려 있고, 그 헤더는 호출하는 쪽이 정한다.**
제한은 "지나가는 봇"을 막지, 저장소를 읽고 한 줄 더 쓰는 사람을 막지 못한다.
그러니 방어를 *접근 차단*이 아니라 **피해 한도**로 세운다:

1. **할당량 상한** — Google Cloud → API 및 서비스 → 할당량에서 Maps JavaScript · Places · Routes에
   **일일 상한**을 실제 사용량의 몇 배 수준으로 건다. 이게 유일한 하드 리밋이다.
2. **예산 알림** — 결제 예산(예: 월 $5)과 임계 알림. 상한이 있어도 알림으로 먼저 안다.
3. **API 제한** — 키가 Maps JavaScript · Places · Routes **셋만** 부를 수 있게 잠근다.
   키가 새도 쓸 수 있는 범위가 그만큼이다.
4. **리퍼러 목록 최소화** — 프로덕션·Preview·`localhost:8000`만. 넓은 와일드카드를 두지 않는다.
5. **주기 회전** — 값이 바뀌면 긁어간 사본이 죽는다. `app.js` 상단 두 줄과 콘솔만 바꾸면 된다.

⚠️ **서버 비밀키는 이야기가 다르다.** `KAKAO_REST_API_KEY`는 도메인 제한이 없어 유출되면 그대로 쓰인다.
이 키는 과거 `app.js`에 있었고(`ae1357f`·`7b1f41a`, `6cc9846`에서 프록시 뒤로 옮김) **그 이력이 이제 공개다.**
아직 회전하지 않았다면 지금 회전한다 — Git 이력은 지워도 포크·캐시에 남는다.

**구조적으로 없애는 유일한 길**은 Places·Routes 호출을 서버 프록시 뒤로 넣는 것이다
(`api/kakao-directions.js`가 이미 그 모양이다). 지도 타일을 그리는 Maps JavaScript SDK는
브라우저 키가 원리상 필요하므로 완전히 없앨 수는 없다.

## Directions 프록시 방어선

`/api/kakao-directions`는 POST와 같은 origin 요청만 받고, 1KB 이하 JSON의 위·경도를 검증한다. upstream 응답은 앱에 필요한 필드만 반환하며 8초 뒤 중단한다. 함수 인스턴스별 30회/분 완화 제한은 실수로 생긴 요청 폭주를 줄일 뿐, 여러 서버리스 인스턴스에 걸친 보안 경계가 아니다.

배포 전 Vercel Firewall에서 `/api/kakao-directions`에 IP 기반 rate limit을 설정한다. 초기 권장값은 60초당 30회이며 정상 사용량을 관찰해 조정한다. 더 세밀한 사용자별 제한이 필요하면 인증 토큰과 Vercel KV 같은 공유 저장소를 함께 사용한다.

## 보안 헤더와 CSP

`vercel.json`은 MIME sniffing, iframe embedding, referrer, 불필요한 브라우저 권한을 제한한다. 현재 HTML과 동적 마크업에 inline handler/style이 많고 Google/Kakao 지도 SDK가 여러 호스트를 사용하므로, 검증 없이 엄격한 CSP를 넣으면 앱이 중단된다. 다음 단계는 inline handler 제거 → Report-Only CSP 수집 → 지도/인증/폰트 호스트 최소화 → enforce 전환 순서다.

CDN 라이브러리는 정확한 버전과 SRI(Subresource Integrity, 내려받은 파일이 기대한 해시와 같은지 브라우저가 확인하는 장치)를 사용한다. CDN 파일은 서비스 워커 설치 필수 목록에서 제외해 외부 장애가 새 앱 셸 설치까지 막지 않게 했다. 운영 오류 기록은 범주·코드·시각만 세션에 최대 20건 보존하며 URL, API 응답 본문, 여행 데이터, 키는 수집하지 않는다.

## 인증 세션

- 자체 Auth(better-auth) 세션은 **bearer 토큰**이다 — 교차 출처라 쿠키를 쓰지 않는다. 웹은 `localStorage`의 `tripcanvas_auth_v1`, iOS는 Keychain `withj.auth.session.v1`(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, 기기 전용·백업 안 됨).
- **이메일 확인 전에는 로그인이 열리지 않는다**(`requireEmailVerification`). 남의 이메일로 가입해 그 사람의 여행을 가져가는 길을 막는다.
- 비밀번호 재설정 요청은 **있는 이메일인지 알려주지 않는다** — 계정 존재 여부를 떠보는 데 쓰이지 않게 성공/실패를 구분하지 않는다.
- 서버는 전환기 동안 **Supabase 토큰과 자체 Auth 세션을 모두** 받는다(`compositeVerifier`). 하나가 죽어도 다음이 본다.
- ⚠️ 실시간 사이드카는 API와 **같은 `AUTH_SECRET`**을 써야 한다. 다르면 아무도 실시간에 붙지 못한다.

## 네트워크 경계 (NAS)

- PostgreSQL은 `internal: true` 도커 네트워크에만 있다 — 호스트에도, 인터넷에도 나오지 않는다.
- api·realtime은 **`127.0.0.1`에만** publish한다(0.0.0.0 아님). 인터넷 노출은 Tailscale Funnel이 담당한다.
- ⚠️ 127.0.0.1 바인딩이어도 **tailnet 안의 기기에서는 닿는다** — Tailscale이 tailnet 트래픽을 localhost로 넘기기 때문이다. tailnet 멤버십 자체가 접근 권한이다.
- 복원 리허설용 postgres 포트(`docker-compose.staging.yml`, 15432)는 쓰고 나면 반드시 내린다.
