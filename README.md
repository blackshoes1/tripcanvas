# 🗺 With J

여행을 **같이 계획하고**, 여행 중에 **다음을 챙겨주는** 앱. 웹(PWA)과 네이티브 iOS 앱이 같은 API를 본다.

> 저장소 이름 `tripcanvas`는 내부 식별자다 — 번들 ID·DB 테이블·API 경로와 함께 그대로 둔다.

## 지금의 프로덕션 구조

```
                    브라우저 (PWA)              iPhone (SwiftUI)
                         │                            │
                         └───────────┬────────────────┘
                                     │  HTTPS
                        Tailscale Funnel (bokbok9.tail8b977f.ts.net)
                                     │
                            NAS ─────┴─────────────────────┐
                             │                             │
                     127.0.0.1:3000 (api)        127.0.0.1:3001 (realtime)
                             │                             │
                             └──────► PostgreSQL ◄─────────┘
```

| 층 | 무엇 | 어디 |
|---|---|---|
| 웹 | 정적 PWA (빌드 도구 없음) | Vercel · `tripcanvas-ai.vercel.app` |
| API | Next.js `/api/v1/*` · `/api/auth/*` | **NAS** (Docker) |
| 인증 | **자체 Auth**(better-auth) — 이메일 확인 · bearer 세션 · 비밀번호 재설정 | NAS API |
| DB | **PostgreSQL** — source of truth | NAS (internal 네트워크만) |
| 실시간 | WebSocket 사이드카 (`trip_activity`의 `pg_notify` 중계) | NAS |
| 공개 경로 | **Tailscale Funnel** — 도메인·Caddy가 아니다 | — |
| iOS | 네이티브 SwiftUI + **같은 API** | 앱 |
| Supabase | **이관 자산 · 롤백 대상** — 아래 참고 | — |

⚠️ **가용성이 집 NAS에 걸린다.** NAS가 꺼지거나 Tailscale이 끊기면 저장이 안 된다(로컬 편집은 보존된다).

### Supabase는 어디까지 남아 있나

2026-09-04에 데이터·API가 NAS로 옮겨 갔고 2026-09-05에 iOS 로그인이 자체 Auth로 넘어왔다. 남은 것은 **전환기 자산**이다.

| 분류 | 위치 | 왜 남아 있나 |
|---|---|---|
| Production runtime — 서버 | `next/src/server/auth/supabaseJwt.ts` · `compositeVerifier.ts` · `remoteSupabaseUser.ts` · `withRemoteFallback.ts` | **아직 필요하다.** 업데이트하지 않은 옛 iOS 앱이 Supabase 토큰을 보낸다. 서버가 두 종류를 모두 받는다 |
| Legacy fallback — 서버 | `next/src/server/infrastructure/supabase/*` · 이관 레지스트리 `TC_MIGRATION_<DOMAIN>` | 도메인별로 저장소를 고른다(`LEGACY` ↔ `NEW_BACKEND`) |
| 실행되지 않는 분기 — 웹 | `auth.js` · `app.js` · `api.js` · `collab.js` | 서버가 `provider: TRIPCANVAS`를 주므로 타지 않는다. 롤백을 위해 남겨 둔 코드 |
| **iOS 런타임** | **없음 (0)** | 2026-09-05 제거. 남은 문자열은 옛 Keychain 항목을 *지우는* 이름뿐 |
| 이관 도구 | `next/src/server/migration/*` | Supabase → PostgreSQL 데이터 이관·검증 |
| 스키마 원본 | `supabase/migrations/*` | RLS·RPC의 역사. 새 스키마는 `next/src/server/infrastructure/database/migrations/` |
| 롤백 대상 | Vercel `tripcanvas-api` 프로젝트 | 여전히 Supabase를 본다. NAS가 길게 죽으면 여기로 되돌린다 |

전환 스위치는 `api.js`·`auth.js`의 `DEFAULT_BASE` 두 줄이다 — [`docs/nas-deployment.md`](docs/nas-deployment.md).

## 기능

- **계정 로그인·클라우드 저장** — 이메일·비밀번호. **이메일 확인 전에는 로그인이 열리지 않는다.** 로그인하면 여행이 계정에 저장돼 어느 기기서든 열리고, 로그아웃 상태에선 로컬(localStorage)로 동작
- **같이 짜기(협업)** — 초대 링크로 멤버를 부르고 역할(주최자/편집/보기)을 나눈다. **가고 싶은 곳** 후보 보드 · 반응 · 한마디 · 여행별 취향 · 활동 기록 · 실시간 반영. 의견이 갈리면 자동으로 빼지 않고 선택지를 보인다
- **여행 중(Travel Mode)** — 오늘 무엇을 하면 되는지. 다음 행동 제안 · 빈 시간 채우기 · 일정 다시 맞추기 · 출발 안내. 판단은 서버 한 곳(`adaptive.js`)에서만 하고 웹과 iOS가 같은 답을 받는다
- **예약과 가격** — 숙박·렌터카·항공을 일정과 연결하고, 같은 조건의 시세를 관측해 실질 절약액을 계산한다. Provider가 연결되지 않았으면 미연결 상태를 그대로 보인다(**가짜 가격을 만들지 않는다**)
- **동선 지도** — 국내 카카오맵 · 해외 Google Maps 듀얼 엔진. 도시/일자별 색상, Day 필터, 방문 순서 연결선, 일자 간 이동선
- **현지 시간대 일정** — 여행/일자별 IANA 시간대와 DST를 반영하고, 대중교통을 구간별 예상 출발시각으로 조회
- **붙여넣기로 초안** — 정해진 형식으로 즉시(AI 없이, 좌표 자동조회) / 토글을 켜면 자연어를 Claude가 정리
- **iOS 앱** — 일정 편집 · 지도 · 장소 검색 · 예약 · 함께하기 · Today · 위젯 · Live Activity · Watch · 공유 시트
- **PWA** — 홈 화면 설치 (오프라인 지도는 Google 약관상 미지원 — 앱 셸만 캐시)

## 구조

```
├── index.html · app.js · style.css   웹 화면과 배선
├── lib.js                            순수 로직 (파서·거리·시각·앵커·타임라인·정규화)
├── adaptive.js                       판단 엔진 (오늘·제안·재구성) — 웹과 iOS의 단일 출처
├── collab.js · intake.js · price.js  협업 판정 · 유입 파싱 · 가격 계산 (전부 순수)
├── api.js · auth.js · sync.js · routing.js   API·인증 클라이언트, 동기화 CAS, 경로 조회
├── sw.js · manifest.json · icon-*.png        PWA
├── api/                              Vercel 서버 함수 (서버 전용 키 프록시)
├── next/                             독립 Backend (API · 자체 Auth · 실시간 · 이관 도구)
├── ios/                              네이티브 iOS 앱 + 위젯 · 공유 · Watch
├── deploy/                           NAS docker compose · 백업
├── supabase/migrations/              Supabase 시절 스키마 (이관 원본)
├── scripts/                          버전·시크릿 검사, 릴리스 게이트 러너
└── test/ · e2e/                      유닛·통합 테스트와 Playwright
```

핵심 설계 원칙과 배선 함정은 [`CLAUDE.md`](CLAUDE.md)에 모여 있다 — **코드를 고치기 전에 그것부터 읽는다.**

| 문서 | 무엇 |
|---|---|
| [`docs/ci.md`](docs/ci.md) | 필수 게이트와 실패 원인 분류 |
| [`docs/nas-deployment.md`](docs/nas-deployment.md) | NAS 운영 — compose · Funnel · 환경변수 |
| [`docs/backend-architecture.md`](docs/backend-architecture.md) | 독립 Backend 설계 |
| [`docs/supabase-migration.md`](docs/supabase-migration.md) | Supabase 이관 계획과 진행 |
| [`docs/backup-restore.md`](docs/backup-restore.md) | 백업과 복원 절차 |
| [`docs/collaboration.md`](docs/collaboration.md) | 함께하기 규칙과 권한 |
| [`docs/security.md`](docs/security.md) | 키 관리와 보안 기준 |
| [`docs/architecture.md`](docs/architecture.md) · [`docs/ui-design-system.md`](docs/ui-design-system.md) | 모듈 의존성 · UI 토큰 |
| [`ios/README.md`](ios/README.md) · [`docs/ios-device-setup.md`](docs/ios-device-setup.md) | iOS 앱과 실기기 설치 |

API 키: Google Maps·카카오 JS 브라우저 키는 `app.js` 상단 상수이며 **도메인 제한(리퍼러/플랫폼)이 필수**다.
카카오 REST 키는 정적 파일에 두지 않고 서버 환경변수로만 관리한다. iOS는 **번들 ID로 제한된 별도 네이티브 키**를 쓴다.

## 로컬 실행

서비스 워커와 API 키 도메인 제한 때문에 **8000 포트**로 열어야 한다 (다른 포트는 지도·검색이 403):

```bash
python3 -m http.server 8000     # → http://localhost:8000
```

카카오내비 자차 경로까지 확인하려면 서버 함수가 필요하다:

```bash
vercel dev --listen 8000
```

## 테스트와 배포

```bash
npm ci
npm run verify:all              # 루트 + next/ + iOS 게이트를 통째로
```

끝에 PASS/FAIL/**SKIP** 표가 나온다. **SKIP은 통과가 아니다** — 무엇을 못 돌렸는지 PR에 밝힌다.
범위만 돌리려면 `scripts/verify-all.sh web|next|ios`.

브랜치 → PR → 필수 CI 통과 → merge. `main` merge가 Vercel Production 배포를 시작한다(정적 웹).
**API·DB는 Vercel 배포로 바뀌지 않는다** — NAS에서 따로 올린다.
자세한 건 [`docs/deployment-workflow.md`](docs/deployment-workflow.md) · [`docs/ci.md`](docs/ci.md).

## 릴리스 체크리스트

- [ ] 웹 자산을 바꿨으면 `npm run bump:version` (`sw.js`의 `VER`과 `index.html`의 `?v=`를 함께 갱신)
- [ ] `npm run verify:all` 통과 — SKIP 항목은 PR에 밝힌다
- [ ] **필수 체크가 빨간 상태로 merge하지 않는다**
- [ ] 푸시 후 폰에서 확인 — ☰ 메뉴 하단의 버전 표시로 새 버전이 적용됐는지 먼저 볼 것
