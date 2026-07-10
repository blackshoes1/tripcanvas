# Trip Canvas — 작업 가이드

대화로 만드는 멀티시티 여행 동선 플래너 (단일 파일 PWA). 빌드 도구 없음 — 정적 파일 그대로 배포.

## Git 워크플로 (중요)

- **`main`에 직접 커밋·푸시하지 않는다.** 작업은 항상 새 브랜치에서 시작한다.
  - 브랜치 이름: `feat/…`, `fix/…`, `chore/…` 형식
- 작업이 끝나면 브랜치를 푸시하고 **PR을 생성**한다 (`gh pr create`).
- 리뷰/머지는 GitHub의 PR에서 진행한다.
- 이유: `main` 푸시가 Vercel 자동 배포와 연결돼 있어, 검토 전 변경이 곧바로 프로덕션에 나가는 것을 막기 위함.

## 배포

- 원격 `main` 머지 시 **Vercel 자동 배포** (프로젝트 `tripcanvas`, 프로덕션 `tripcanvas-ai.vercel.app`).
- 커밋 author 이메일은 반드시 **GitHub 계정과 매칭되는 유효한 주소**여야 한다 (`blackshoes85@gmail.com`).
  `.local` 등 로컬 호스트 기반 자동 이메일이면 Vercel이 배포를 거부한다.

## 릴리스 체크리스트

- [ ] `sw.js`의 `VER` 값 올리기 (서비스 워커 캐시 갱신에 필수 — 안 올리면 stale 캐시로 변경이 반영 안 됨)
- [ ] 폰에서 프리뷰 URL 확인 후 merge

## 구조

- `index.html` — 앱 본체 (UI + 로직 단일 파일)
- `sw.js` — 서비스 워커 (오프라인 캐시 전략)
- `manifest.json` — PWA 매니페스트
- `icon-*.png` — 앱 아이콘

라이브러리(CDN): 지도 듀얼 엔진 — 해외 Google Maps JS SDK · 국내(스팟 과반이 한국) 카카오맵 JS SDK · LZString(공유 링크 압축) · SortableJS(드래그) · Supabase(로그인/클라우드 동기화)
검색: 국내 카카오 로컬 · 해외 Google Places (라우팅) · 저장: localStorage + Supabase
API 키: index.html 상단 GMAPS_KEY(리퍼러 제한)·KAKAO_KEY(플랫폼 도메인 제한) — localhost:8000, tripcanvas-ai.vercel.app 등록 필요
주의: Google 약관상 지도 타일 캐시 금지 → 오프라인 지도 기능 없음 (SW는 앱 셸만 캐시)

## 로컬 실행

서비스 워커 때문에 http 서버로 열어야 한다:

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 보안 주의

- 공유 링크(`#t=`)·가져오기·AI 파싱으로 **외부 데이터가 유입**된다. 사용자 데이터를 `innerHTML`로 출력할 때는 반드시 `esc()`로 이스케이프한다 (XSS 방어).
