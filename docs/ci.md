# CI — 필수 게이트와 실패 판별

## 필수 게이트

merge 전에 통과해야 하는 것은 다음이 전부다. `.github/workflows/ci.yml`(**Quality** · **Next workspace** · **E2E**)과
`ios.yml`(**Build + unit tests (simulator)**, `ios/` 변경 시)이 이걸 돌린다.

| 게이트 | 워크플로 잡 | 로컬 |
|---|---|---|
| 구문 · 버전 동기 · lint · 시크릿 · `tsc` · 유닛 · 통합 · RLS · `npm audit` | Quality | `scripts/verify-all.sh web` |
| lint · `tsc` · vitest · `next build` · `tools:build` | Next workspace | `scripts/verify-all.sh next` |
| Playwright | E2E | `scripts/verify-all.sh web` |
| XcodeGen · 컴파일 · XCTest · Release 빌드 · 무료 스펙 | iOS | `scripts/verify-all.sh ios` |

`npm run verify:all` 은 셋을 한 번에 돌리고, 끝에 PASS/FAIL/SKIP 표를 찍는다.
**돌릴 수 없는 단계는 PASS가 아니라 SKIP으로 표시된다** — 로컬 PostgreSQL이 없으면 RLS가 그렇다.

> ### merge 규칙
>
> **필수 체크가 실패(또는 미실행) 상태이면 merge하지 않는다.**
> 실패가 코드 때문이 아니라 러너·인프라 때문이라면, 그 사실과 대신 무엇으로 검증했는지를
> PR에 남기고 사람이 판단한다. 붉은 체크를 이유 없이 넘기지 않는다.

## 실패를 먼저 분류한다

빨간 체크를 코드 오류로 단정하지 않는다. 잡이 **시작조차 못 한** 실패가 코드 실패와 똑같이 빨갛게 보인다.

```
gh run view <run-id>              # ANNOTATIONS를 먼저 본다
gh run view <run-id> --log-failed # 로그가 없으면 잡이 시작되지 않은 것이다
```

분류:

| 증상 | 분류 | 대응 |
|---|---|---|
| 잡이 몇 초 만에 끝나고 로그가 없음, ANNOTATIONS에 계정/러너 메시지 | 러너·과금 | 코드를 고치지 않는다. 원인을 풀고 재실행 |
| `Dependency audit`이 `audit endpoint returned an error`로 실패 | npm 레지스트리 | 취약점이 아니다. 워크플로가 **그 오류일 때만** 3번까지 다시 시도한다(2026-09-06 추가) — 그래도 빨가면 재실행 |
| 특정 스텝에서 컴파일·테스트 실패 로그 | 코드 | 최소 수정 |
| `npm ci` 실패 | 의존성·lockfile | lockfile 동기 확인 |
| 매번 다른 스텝에서 시간 초과 | 러너 성능·flaky | 재현부터 |

## 지나간 실패 — GitHub Actions 과금 중단 (2026-09-05 ~ 2026-09-06, 해소)

PR #131 이후 **모든 잡이 2초 만에 실패**했다. 로그는 없고 주석만 남는다:

```
The job was not started because recent account payments have failed
or your spending limit needs to be increased.
```

Quality · Next workspace · iOS 셋 다 같은 이유이고 E2E는 `needs: quality` 때문에 skip된다.
Vercel 배포는 별개 시스템이라 초록으로 남는다 — **Vercel success를 CI success로 읽지 않는다.**

- 코드 문제가 아니다. 이 상태에서 워크플로 파일을 고쳐도 초록이 되지 않는다.
- 푸는 것은 저장소 코드가 아니라 계정이다: GitHub → Settings → **Billing & plans** 에서 결제 수단·지출 한도를 정리한 뒤
  `gh run rerun <run-id>` 로 다시 돌린다.
- ⚠️ macOS 러너(iOS 워크플로)는 비공개 저장소에서 **분당 10배**로 과금된다. 한도를 다시 세울 때 이걸 감안한다.
- 풀리기 전까지는 `npm run verify:all` 결과를 PR 본문에 적고, 무엇을 못 돌렸는지(RLS 등)를 함께 밝힌다.
- **TestFlight 업로드도 같이 막혔다** — `iOS TestFlight` 워크플로도 잡을 시작조차 못 했다.
  러너를 못 쓰는 동안의 우회로는 `scripts/testflight-upload.sh`다(이 Mac에서 같은 순서로 올린다) —
  `docs/ios-device-setup.md`.

### 어떻게 풀렸나 (2026-09-06)

결제를 정리하는 대신 **저장소를 공개로 바꿨다.** 공개 저장소는 Actions 표준 러너가 무료라
지출 한도·결제 실패에 걸리지 않는다. 바꾼 직후 확인한 것:

| | 결과 |
|---|---|
| `iOS TestFlight` run #5 | **success** — 0.1.0 (5) 업로드, 4분 48초 |
| `CI` (Quality · Next workspace · E2E) | **success** — 셋 다 |

따라 오는 것 둘:

- **branch protection이 공짜가 됐다.** 지금까지 `main` 직접 푸시를 막는 곳이 `.githooks/pre-push`
  하나뿐이었는데(클론마다 `git config core.hooksPath .githooks`가 필요했다) 이제 서버가 막을 수 있다.
  `docs/deployment-workflow.md`
- ⚠️ **`app.js`의 지도 키가 공개 저장소에 그대로 있다**(`GMAPS_KEY`·`KAKAO_KEY`). 정적 HTML로 이미
  배포돼 있어 새로 새는 것은 아니지만, 이제 스크래퍼가 자동으로 긁어간다. **도메인·리퍼러 제한이
  유일한 방어선**이므로 살아 있는지 확인하고 예산 알림을 유지한다.

## ⚠️ 저장소를 private으로 되돌리면 iOS CI·TestFlight가 멈춘다 (2026-09-07)

private 저장소에서는 **macOS 러너가 10배로 과금**된다. Free 플랜의 월 2,000분은 macOS 기준 **200분**이고,
이 앱 빌드가 한 번에 8~9분이므로 **월 22번 남짓**이면 한도가 끝난다.

한도가 끝나면 이렇게 보인다 — **이게 찾기 어려운 이유다**:

```
Archive + upload: failure   (시작 5초 만에, 단계가 하나도 실행되지 않음)
```

- 워크플로 **로그가 비어 있다.** 단계가 시작조차 안 했으므로 볼 로그가 없다.
- `gh api .../jobs`의 `steps`가 **빈 배열**이고 `annotations`는 **404**다. API로는 이유를 알 수 없다.
- 이유는 **실행 페이지 맨 위 배너**에만 뜬다(`The job was not started because …`).
- 같은 시각 ubuntu 잡(Quality·Next workspace·E2E)은 **멀쩡히 돈다** — 그래서 "CI가 죽었나?"로 안 보인다.

실제로 2026-09-07 06:17 UTC 실행은 성공했고 06:38부터 macOS 잡이 전부 즉시 실패했다.
저장소를 public으로 되돌리자 같은 워크플로가 그대로 통과했다.

### 판정법

```bash
gh run list --workflow=ios.yml --limit 5 --json createdAt,status,conclusion
gh api repos/blackshoes1/tripcanvas --jq .visibility
```

macOS 잡만, 5~10초 만에, 로그 없이 실패한다면 **거의 항상 과금·러너 배정 문제**지 코드 문제가 아니다.

### private을 유지하면서 자동화하려면

| 방법 | 비용 | 비고 |
|---|---|---|
| **맥을 셀프호스티드 러너로** | 0원 | 맥이 깨어 있어야 한다. `runs-on: [self-hosted, macOS]` · 서명 자산이 로컬에 남는다. **private일 때 권장되는 구성**(공개 저장소에서는 남의 PR이 내 기계에서 도는 위험이 있다) |
| Actions 지출 한도 설정 | macOS 3코어 $0.08/분 → 월 $10 ≈ 14회 | 결제수단 등록 필요 |
| Xcode Cloud | 유료 개발자 계정에 월 25시간 포함 | 새 시스템을 익혀야 한다 |
