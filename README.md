# 🗺 Trip Canvas

대화로 만드는 멀티시티 여행 동선 플래너 (PWA).
"입력은 대화로, 출력은 지도로" — 도시별 색상 핀, 일자별 필터, 동선 연결을 지원합니다.

## 기능

- **계정 로그인·클라우드 저장**: 이메일·비밀번호 로그인(Supabase Auth). 가입 시 프로젝트 설정에 따라 확인 메일 인증이 필요할 수 있음. 로그인하면 여행이 계정에 저장돼 어느 기기서든 열림(개인별 RLS 격리). 로그아웃 상태에선 로컬(localStorage)로 동작
- **붙여넣기로 초안**: 정해진 형식으로 직접 붙여넣기(AI 없이 즉시, 좌표 자동조회: 국내 카카오·해외 구글) / 토글을 켜면 자연어를 Claude가 정리 (개인 API 키는 브라우저에만 저장)
- **동선 지도**: 도시별/일자별 색상 전환, Day 필터, 방문 순서 연결선, 일자 간 이동선
- **현지 시간대 일정**: 여행/일자별 IANA 시간대와 DST를 반영하고, 대중교통을 구간별 예상 출발시각으로 조회
- **앱 내 편집**: 드래그&드롭으로 일자·명소 순서 변경(일자 간 이동 포함, 모바일 터치 지원), 화살표 연속 이동, 명소 추가(검색/지도 클릭)·삭제, 일자 관리, 메모
- **여행 모드**: 시작일 기준 오늘 일정 자동 표시 + Google 지도 길찾기 연결
- **여행 다중 관리**: 여러 여행 생성, JSON 내보내기/가져오기, 압축 공유 링크
- **PWA**: 홈 화면 설치 (오프라인 지도는 Google 약관상 미지원 — 앱 셸만 캐시)

## 구조

```
├── index.html      # 마크업
├── app.js          # 앱 로직
├── sync.js         # 동기화 병합·삭제 상태 전이
├── routing.js      # Google/Kakao 라우팅 transport·fallback
├── api/            # 서버 전용 Vercel Functions
├── supabase/       # 검토 후 적용할 DB migration/RLS
├── scripts/        # secret/version 일관성 검사와 버전 bump
├── test/, e2e/     # Node 단위·통합 테스트와 Playwright E2E
├── style.css       # 스타일
├── sw.js           # 서비스 워커 (오프라인 캐시 전략)
├── manifest.json   # PWA 매니페스트
└── icon-*.png      # 앱 아이콘
```

Supabase의 테이블·RLS·낙관적 동시성 RPC는 `supabase/migrations/`에서 관리합니다. 운영 DB에는 저장소만 보고 바로 적용하지 말고 [`docs/supabase-migrations.md`](docs/supabase-migrations.md)의 schema diff와 staging 검증을 먼저 수행해야 합니다.

모듈 의존성과 점진적 ES module 전환 원칙은 [`docs/architecture.md`](docs/architecture.md)에 정리되어 있습니다.
UI 토큰, 반응형 패널과 핵심 컴포넌트 규칙은 [`docs/ui-design-system.md`](docs/ui-design-system.md)에 정리되어 있습니다.

빌드 도구 없음 — 정적 파일 그대로 배포합니다.
지도: Google Maps JS SDK / 장소 검색: 카카오 로컬(국내)·Google Places(해외) / 저장: localStorage + Supabase
Google Maps와 Kakao JavaScript 브라우저 키는 `app.js` 상단 상수이며 도메인 제한(리퍼러/플랫폼)이 필수입니다. Kakao Mobility REST 키는 정적 파일에 두지 않고 Vercel 서버 함수의 `KAKAO_REST_API_KEY` 환경변수로만 관리합니다. 자세한 운영 기준은 [`docs/security.md`](docs/security.md)를 참고하세요.

## 로컬 실행

서비스 워커 때문에 http 서버로 열어야 합니다:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

정적 서버에서는 Kakao Mobility 자차 경로 프록시가 없으므로, 해당 기능까지 로컬에서 확인할 때는 Vercel CLI로 실행합니다.

```bash
vercel dev --listen 8000
```

## 테스트와 배포

```bash
npm ci
npm run check:syntax
npm run check:version
npm run check:types
npm test
npx playwright install chromium   # 최초 1회
npm run test:e2e
```

작업 브랜치의 Draft PR과 Vercel Preview에서 검증한 뒤 required CI가 통과하면 `main`에 merge합니다. `main` merge가 Vercel Production 배포를 시작합니다. branch protection 설정과 롤백 절차는 [`docs/deployment-workflow.md`](docs/deployment-workflow.md)를 참고하세요.

## 릴리스 체크리스트

- [ ] 런타임 변경 시 `npm run bump:version` 실행 후 `npm run check:version` 통과
- [ ] 폰에서 프리뷰 URL 확인 후 merge
