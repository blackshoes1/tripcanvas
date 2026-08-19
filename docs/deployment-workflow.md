# PR·CI 기반 배포

## 권장 흐름

1. 작업별 브랜치와 Draft PR을 만든다.
2. Vercel Preview에서 외부 API·모바일·PWA를 수동 확인한다.
3. GitHub CI의 syntax, lint, type, unit, integration, secret scan, audit, E2E를 모두 통과시킨다.
4. Draft를 Ready for review로 바꾸고 승인 후 merge한다.
5. `main` merge가 Vercel Production 배포를 시작한다. 배포 후 메뉴 버전과 핵심 흐름을 확인한다.

## GitHub branch protection 설정(수동)

Repository Settings → Branches 또는 Rulesets에서 `main`에 다음을 설정한다.

- pull request 없이 merge 금지
- required approvals 1명 이상(혼자 운영하면 최소한 PR + CI 필수)
- required status checks: `Quality`, `E2E`
- branch must be up to date before merging
- force push와 branch deletion 금지
- 관리자의 우회는 긴급 복구에만 사용하고 사유 기록

이 저장소 변경은 branch protection이나 Vercel 설정을 자동 변경하지 않는다.

## 실패와 롤백

Preview가 실패하면 merge하지 않는다. Production 회귀는 해당 PR을 revert하는 새 PR로 복구한다. DB migration은 git revert가 아니라 이전 스키마와 호환되는 forward migration을 작성하며, migration 적용 전에 백업한다.
