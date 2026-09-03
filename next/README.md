# tripcanvas-next — `/api/v1` 배포

웹·iOS가 함께 쓰는 API 계층. 판단은 저장소 루트의 `adaptive.js`가 하고 여기는 그것을 그대로 import 한다(`@legacy/*` → `../*`).

## Vercel 프로젝트가 둘이다

| 프로젝트 | Root Directory | 도메인 | 내용 |
|---|---|---|---|
| `tripcanvas` | (루트) | `tripcanvas-ai.vercel.app` | 정적 PWA + `api/*.js` 함수 |
| `tripcanvas-api` | `next` | `tripcanvas-api.vercel.app` | Next.js — `/api/v1/*` |

**정적 웹 프로젝트는 `/api/v1`을 서빙하지 않는다.** iOS 앱(`TCApiBaseURL`)은 반드시 API 프로젝트를 가리켜야 한다 — 정적 쪽을 가리키면 모든 호출이 404가 되고, 앱에는 "여행 없음"으로 보인다.

## 프로젝트 설정 (놓치면 전부 404)

- **Framework Preset**: Next.js
- **Root Directory**: `next`
- **Include files outside the root directory**: **Enabled** — 끄면 `@legacy/adaptive.js`를 못 찾아 빌드가 실패한다. 판단 엔진이 저장소 루트에 있고, 웹과 iOS가 같은 답을 내는 근거가 이 구조다.
- **Skip deployments when there are no changes to the root directory**: Enabled — `next/` 밖만 바뀐 커밋은 이 프로젝트를 다시 빌드하지 않는다. **설정을 바꾼 뒤에는 `next/` 안을 건드리는 커밋이나 수동 Redeploy가 있어야 반영된다.**

프로젝트 설정을 바꿔도 이미 떠 있는 배포에는 적용되지 않는다. 설정 화면에 `Configuration Settings in the current Production deployment differ from your current Project Settings` 경고가 보이면 아직 반영 전이라는 뜻이다.

## `.vercelignore` 는 두 프로젝트가 함께 읽는다

저장소 루트의 `.vercelignore` 하나를 **두 Vercel 프로젝트가 공유한다.** 여기에 `next` 를 넣으면 API 프로젝트의 업로드에서 `next/package.json` 까지 사라져 빌드 로그에 이렇게 뜬다:

```
Found .vercelignore (repository root)
Removed 204 ignored files defined in .vercelignore
Error: No Next.js version detected.
```

Root Directory 설정이 맞아도 이 메시지가 나온다 — 파일 자체가 없어서다.

그래서 `next` 는 제외하지 않는다. 대신 **정적 사이트가 소스를 서빙하지 않도록** 루트 `vercel.json` 의 `redirects` 가 `/next/*` 를 막는다(저장소가 비공개라 소스가 공개로 열리면 안 된다). **둘 중 하나만 바꾸면 뚫리거나 깨진다.**

## 환경변수

**Vercel 대시보드 → `tripcanvas-api` 프로젝트 → Settings → Environment Variables.** (정적 웹 `tripcanvas` 쪽이 아니다.)

| 이름 | 값 | 없으면 |
|---|---|---|
| `TRUSTED_ORIGINS` | `https://tripcanvas-ai.vercel.app` (쉼표로 여러 개) | ⚠️ **웹이 이 API를 못 부른다** — 브라우저가 교차 출처 요청을 막는다 |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개용 키 — 데이터는 RLS가 지킨다. **`service_role` 키를 쓰지 않는다** | 레거시 프로젝트로 붙는다(기본값이 코드에 있다) |
| `SUPABASE_JWT_SECRET` | 프로젝트 JWT secret | HS256 토큰이면 서버 로그에 폴백 경고가 뜬다 |
| `DATABASE_URL` · `TC_MIGRATION_*` | 독립 PostgreSQL과 이관 레지스트리 | 전부 LEGACY(오늘의 동작) |
| `AUTH_SECRET` · `API_BASE_URL` · `SMTP_*` | 자체 Auth(PR10) | `/api/auth/*`가 404 |
| `REALTIME_URL` | 실시간 사이드카 주소 | 웹이 Supabase 실시간을 그대로 쓴다 |

전체 목록과 설명은 `.env.example`. 로컬은 `next/.env.local`에 같은 이름으로 둔다.

### ⚠️ TRUSTED_ORIGINS는 먼저 넣고 배포한다

정적 웹(`tripcanvas-ai.vercel.app`)과 이 API(`tripcanvas-api.vercel.app`)는 **다른 출처**다. 웹의 여행 동기화·함께하기가
전부 이 API를 지나므로, 이 값이 없으면 **로그인해도 여행이 안 뜨고 저장도 안 된다.**

- 경로나 끝 슬래시를 붙이지 않는다 — 브라우저가 보내는 `Origin` 헤더와 **글자 그대로** 비교한다
- 로컬에서 `python3 -m http.server 8000`으로 열어 본다면 `http://localhost:8000`도 함께 넣는다
- 값을 바꾼 뒤에는 **재배포해야 반영된다.** 이 프로젝트는 "Skip deployments when there are no changes to the root directory"가
  켜져 있어 `next/` 밖만 바뀐 커밋은 다시 빌드하지 않는다 — 값만 바꿨다면 대시보드에서 **Redeploy**를 누른다

확인:

```bash
curl -si -X OPTIONS https://tripcanvas-api.vercel.app/api/v1/me -H "Origin: https://tripcanvas-ai.vercel.app" | grep -i access-control
```

허용된 출처면 `access-control-allow-origin`이 그대로 돌아오고, 모르는 출처면 그 헤더가 없다(브라우저가 막는다).

## 살아 있는지 확인

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tripcanvas-api.vercel.app/api/v1/trips
```

- `401` — 정상. 라우트가 살아 있고 인증을 요구한다.
- `404` — Root Directory 설정이 반영되지 않았다.
- `200`인데 HTML — Deployment Protection(Vercel Authentication)이 켜져 있다. 끄지 않으면 앱이 로그인 페이지를 받는다.

## 로컬

```bash
npm install && npm run dev
```

## 독립 Backend (Supabase 이관)

`src/server/`가 새 backend 계층이다 — `docs/backend-architecture.md`. 오늘의 Vercel 배포에는 `DATABASE_URL`이 없으므로 새 경로는 어디서도 불리지 않는다(이관 레지스트리 강제 `LEGACY`). 달라진 것은 하나: **Supabase 토큰을 서버가 직접 검증**하고, 실패하면 예전처럼 `getUser`로 확인한다(경고 로그).

```
TC_MIGRATION_TRIP=LEGACY|DUAL_READ|NEW_BACKEND   # 기본 LEGACY
DATABASE_URL=postgres://...                      # 있어야 LEGACY 외 값이 유효
SUPABASE_JWT_SECRET=                             # 프로젝트가 HS256이면 필요(경고 로그가 알려 준다)
```

```bash
npm run db:generate   # schema.ts → migrations/*.sql
npm run db:migrate    # DATABASE_URL에 적용 (drizzle-kit)
```

NAS 배포는 `deploy/`와 `docs/nas-deployment.md`(미검증).
