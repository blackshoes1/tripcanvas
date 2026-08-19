# 보안 운영 기준

## 브라우저 키와 서버 비밀키

- `GMAPS_KEY`: Google Maps JavaScript/Routes 브라우저 키다. HTTP referrer를 프로덕션, Vercel Preview, 로컬 개발 주소로 제한하고 필요한 Maps JavaScript API, Places API, Routes API만 허용한다.
- `KAKAO_KEY`: Kakao JavaScript 키다. Kakao Developers의 플랫폼 웹 도메인에 프로덕션·Preview·로컬 개발 주소만 등록한다.
- Supabase publishable key: 공개 클라이언트 식별자다. 데이터 보호는 키 은닉이 아니라 RLS가 담당한다.
- `KAKAO_REST_API_KEY`: Kakao Mobility REST 비밀키다. Vercel 서버 환경변수에만 설정하며 Preview/Production 환경을 구분한다.

기존에 정적 파일에 들어 있던 Kakao REST 키는 Git 이력과 배포 캐시에 남을 수 있다. 코드 배포 후 Kakao Developers에서 키를 회전하고 새 값을 Vercel 환경변수에 설정해야 한다.

## Directions 프록시 방어선

`/api/kakao-directions`는 POST와 같은 origin 요청만 받고, 1KB 이하 JSON의 위·경도를 검증한다. upstream 응답은 앱에 필요한 필드만 반환하며 8초 뒤 중단한다. 함수 인스턴스별 30회/분 완화 제한은 실수로 생긴 요청 폭주를 줄일 뿐, 여러 서버리스 인스턴스에 걸친 보안 경계가 아니다.

배포 전 Vercel Firewall에서 `/api/kakao-directions`에 IP 기반 rate limit을 설정한다. 초기 권장값은 60초당 30회이며 정상 사용량을 관찰해 조정한다. 더 세밀한 사용자별 제한이 필요하면 인증 토큰과 Vercel KV 같은 공유 저장소를 함께 사용한다.

## 보안 헤더와 CSP

`vercel.json`은 MIME sniffing, iframe embedding, referrer, 불필요한 브라우저 권한을 제한한다. 현재 HTML과 동적 마크업에 inline handler/style이 많고 Google/Kakao 지도 SDK가 여러 호스트를 사용하므로, 검증 없이 엄격한 CSP를 넣으면 앱이 중단된다. 다음 단계는 inline handler 제거 → Report-Only CSP 수집 → 지도/인증/폰트 호스트 최소화 → enforce 전환 순서다.
