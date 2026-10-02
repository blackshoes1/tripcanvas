# PR·CI 기반 배포

## 흐름

```
feat/* · fix/* · chore/* · docs/*  →  PR  →  게이트  →  merge  →  배포
```

1. 작업별 브랜치와 Draft PR을 만든다. **`main`에 직접 커밋·푸시하지 않는다.**
2. Vercel Preview에서 외부 API·모바일·PWA를 수동 확인한다.
3. 새 API를 요구하는 웹은 PR을 둘로 나눈다 — **API PR을 먼저 merge**하고, NAS에서 그 커밋이 도는지(`nas-deploy.sh --status` 또는 `/api/health`의 `revision`) 확인한 뒤 웹 PR을 merge한다. 한 PR이면 웹이 API보다 먼저 나간다([NAS 릴리스 절차](nas-release.md)). 게이트를 통과시킨다 — `npm run verify:all`(루트 + `next/` + iOS). CI가 살아 있으면 GitHub Actions가 같은 것을 본다.
   **SKIP은 통과가 아니다** — 무엇을 못 돌렸는지 PR에 밝힌다.
4. Draft를 Ready for review로 바꾸고 merge한다. **빨간 체크 위에서 merge하지 않는다.**
5. `main` merge가 Vercel Production 배포(정적 웹·`api/` 함수, 약 1분)를 시작한다. 배포 후 메뉴 버전과 핵심 흐름을 확인한다.
   **API·DB도 같은 merge로 나간다** — `release.yml`(게이트 → GHCR `:<커밋 SHA>` → `production` 태그) → NAS cron(5분)이
   받아 migrate → api·realtime을 바꾼다. 게이트·이미지 빌드를 지나므로 웹보다 늦고, 앱·문서만 바뀐 merge에는 돌지 않는다(`docs/nas-deployment.md`).

## Branch protection — 적용한 값 (2026-10-02 활성화)

> `trip canvas` ruleset(18573903)을 활성화했다. 적용 범위는 `refs/heads/main`이고 우회 계정은 없다. 현재 설정은 `gh api repos/blackshoes1/tripcanvas/rulesets/18573903`로 확인한다.

`main`은 GitHub branch protection으로 잠갔다(2026-10-02). 이전에는 **비공개 + 무료 플랜**이라 이 기능이 403이었고
로컬 훅이 유일한 방어였는데, **저장소를 공개로 바꾸면서** 쓸 수 있게 됐다(그 결정과 대가는 `docs/ci.md`).

| 규칙 | 값 |
|---|---|
| PR 없이 `main` 푸시 | **금지** (승인 필요 수는 0 — 혼자 쓰는 저장소라 자기 PR을 승인할 수 없다) |
| 필수 통과 체크 | `Quality` · `Next workspace` · `E2E` · `Docker image build` |
| 최신 상태 강제(strict) | **켬** — 병합할 최신 main 위에서 검사를 통과해야 한다 |
| 관리자에게도 적용 | **켬** — 이걸 끄면 소유자 혼자 쓰는 저장소에서는 규칙이 없는 것과 같다 |
| 강제 푸시 · 브랜치 삭제 | 금지 |
| 대화(리뷰 코멘트) 해결 | 필수 |

⚠️ **`Docker image build`도 필수다**(2026-10-02). `main` 머지가 곧 운영 API 배포라, 운영 이미지가 안 만들어지는
PR이 들어가면 `release.yml`이 이미지 단계에서 멈추고 자동 배포가 통째로 선다 — 그걸 머지 전에 막는다. PR마다 돈다(경로 조건이 없다). ruleset의 필수 체크에 실제로 등록했고 Actions 앱의 결과만 받는다.

⚠️ **iOS 워크플로는 필수 체크에 넣지 않았다.** `ios/` 변경에만 도는데 필수로 걸면 웹만 고친 PR이
영영 안 오는 체크를 기다리며 멈춘다. iOS·`collab.js` 변경에는 macOS CI의 Debug·XCTest·Release 통과를 병합 전에 확인한다.

⚠️ **이제 merge가 CI를 기다린다.** 열자마자 머지하던 흐름이 몇 분 늦어진다 — 그게 이 규칙의 값이다.
정말 급하면 설정에서 잠시 끄고, 왜 그랬는지 남긴다.

### 로컬 pre-push 훅 — 여전히 켠다

서버가 막고 있으면 훅은 **유일한 방어가 아니라 빠른 방어**다. 서버까지 갔다가 거절당하는 대신
푸시하기 전에 막아 준다. 서버 보호가 꺼져 있으면(위 ⚠️) 훅이 **유일한 방어**다. 클론마다 한 번 켠다:

```bash
git config core.hooksPath .githooks
```

`main` 푸시는 Vercel 자동 배포와 연결돼 있어 **즉시 프로덕션에 나간다** — 실수 한 번의 값이 크다.
긴급 복구에는 `git push --no-verify`로 우회할 수 있고, 그때는 왜 그랬는지 남긴다.

⚠️ 훅은 **이 기계에서만** 돈다. 다른 기기(집·회사)에서도 위 명령을 한 번씩 실행한다.

### Pro로 올린 뒤 켤 것 (그대로 옮겨 적기)

Repository Settings → Branches 또는 Rulesets에서 `main`에:

- pull request 없이 merge 금지
- required approvals 1명 이상(혼자 운영하면 최소한 PR + CI 필수)
- **required status checks**: `Quality` · `E2E` · `Next workspace` · `Build + unit tests (simulator)`
- branch must be up to date before merging
- force push와 branch deletion 금지
- 관리자의 우회는 긴급 복구에만 사용하고 사유 기록

⚠️ **required checks를 켜기 전에 Actions 과금 문제를 먼저 푼다.** 지금 켜면 잡이 시작되지 못해
아무것도 merge할 수 없게 된다 — `docs/ci.md`.

이 저장소 변경은 branch protection이나 Vercel 설정을 자동 변경하지 않는다.

## 관리형 런타임 (준비됨 · 프로덕션은 아직 NAS)

- `.github/workflows/managed-staging.yml`은 **버튼을 눌러야** 돈다(workflow_dispatch). `managed-staging` 환경의 시크릿이 없으면 시작하지 않고, 값을 출력하지 않는다. 프로덕션은 이 워크플로로 배포하지 않는다.
- `npm run deployment:plan`이 `deploy/managed/**`·그 워크플로 변경을 `managed-config`로 따로 알린다.
- 전환 자체(프로덕션 DB cutover · API 주소 변경 · NAS 종료)는 [`production-cutover.md`](production-cutover.md)의 체크리스트를 사람이 승인 후 순서대로 한다. 이 저장소의 어떤 자동화도 그것을 대신 하지 않는다.

## 실패와 롤백

Preview가 실패하면 merge하지 않는다. Production 회귀는 해당 PR을 revert하는 새 PR로 복구한다. DB migration은 git revert가 아니라 이전 스키마와 호환되는 forward migration을 작성하며, migration 적용 전에 백업한다.
