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

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

둘 다 공개용이다 — 데이터는 RLS가 지킨다. 서버는 사용자의 bearer 토큰을 그대로 Supabase에 넘겨 RLS 아래에서 읽고 쓴다. **`service_role` 키를 쓰지 않는다.**

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
