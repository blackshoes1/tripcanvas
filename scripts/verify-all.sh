#!/usr/bin/env bash
# 릴리스 게이트를 이 기계에서 그대로 돌린다.
#
# GitHub Actions가 서 있을 때(러너 미기동·결제 중단 등) 게이트가 사라지지 않게 하는 것이 목적이다.
# 단계는 .github/workflows/ci.yml(Quality·Next workspace·E2E)과 ios.yml을 그대로 따라간다 —
# 워크플로를 고치면 여기도 같이 고친다.
#
#   scripts/verify-all.sh            전부
#   scripts/verify-all.sh web        루트(Quality + E2E)만
#   scripts/verify-all.sh next       Next 워크스페이스만
#   scripts/verify-all.sh ios        iOS만 (macOS + Xcode + xcodegen 필요)
#
# 통과/실패를 끝에 표로 찍고, 하나라도 실패하면 1로 끝난다.
set -uo pipefail
cd "$(dirname "$0")/.."

SCOPE="${1:-all}"
RESULTS=()
FAILED=0

step() {                        # step <이름> <명령...>
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  if "$@"; then
    RESULTS+=("PASS  $name")
  else
    RESULTS+=("FAIL  $name")
    FAILED=1
  fi
}

skip() { RESULTS+=("SKIP  $1 — $2"); printf '\n\033[2m▶ %s (건너뜀: %s)\033[0m\n' "$1" "$2"; }

want() { [ "$SCOPE" = all ] || [ "$SCOPE" = "$1" ]; }

# ── 루트: Quality ─────────────────────────────────────────────────────────────
if want web; then
  step "구문 검사"            npm run check:syntax
  step "버전 동기(sw.js ↔ index.html)" npm run check:version
  step "lint"                 npm run lint
  step "시크릿 스캔"          npm run security:scan
  step "타입 검사(tsc)"       npm run check:types
  step "유닛 테스트"          npm run test:unit
  step "통합 테스트"          npm run test:integration

  # RLS는 진짜 PostgreSQL이 있어야 판정이 의미가 있다 — 없으면 테스트가 스스로 skip하므로
  # "돌렸는데 0건 통과"를 초록으로 착각하지 않도록 여기서도 건너뛴 것으로 표시한다.
  if scripts/pg-local.sh status >/dev/null 2>&1 || command -v initdb >/dev/null 2>&1; then
    step "RLS(실제 PostgreSQL)"  bash -c 'scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && npm run test:rls 2>&1 | tee /tmp/tc-rls.log && grep -q "# skipped 0" /tmp/tc-rls.log'
  else
    skip "RLS(실제 PostgreSQL)" "로컬 PostgreSQL 바이너리 없음"
  fi

  step "의존성 감사(high)"    npm audit --audit-level=high
  step "E2E(Playwright)"      npm run test:e2e
fi

# ── Next 워크스페이스 ─────────────────────────────────────────────────────────
if want next; then
  if [ -d next/node_modules ]; then
    step "next: lint"         npm --prefix next run lint
    step "next: 타입 검사"    npm --prefix next run check:types
    step "next: 테스트"       npm --prefix next test
    step "next: build"        npm --prefix next run build
    step "next: tools:build"  npm --prefix next run tools:build
  else
    skip "next 워크스페이스" "next/node_modules 없음 — npm --prefix next ci"
  fi
fi

# ── iOS ──────────────────────────────────────────────────────────────────────
if want ios; then
  if [ "$(uname)" = Darwin ] && command -v xcodebuild >/dev/null 2>&1 && command -v xcodegen >/dev/null 2>&1; then
    SIM=$(xcrun simctl list devices available | awk -F' \\(' '/^ +iPhone/ { sub(/^ +/, "", $1); print $1; exit }')
    if [ -z "$SIM" ]; then
      skip "iOS" "사용 가능한 iPhone 시뮬레이터 없음"
    else
      echo "사용할 시뮬레이터: $SIM"
      NOSIGN=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=)
      step "iOS: XcodeGen"    bash -c 'cd ios && xcodegen generate'
      step "iOS: 빌드 + XCTest" bash -c "cd ios && xcodebuild test -project TripCanvas.xcodeproj -scheme TripCanvas -destination 'platform=iOS Simulator,name=$SIM' ${NOSIGN[*]}"
      step "iOS: Release 빌드" bash -c "cd ios && xcodebuild build -project TripCanvas.xcodeproj -scheme TripCanvas -destination 'generic/platform=iOS Simulator' -configuration Release ${NOSIGN[*]}"
      step "iOS: 무료 스펙 생성" bash -c 'cd ios && xcodegen generate --spec project-free.yml'
    fi
  else
    skip "iOS" "macOS + Xcode + xcodegen 필요"
  fi
fi

printf '\n\033[1m── 결과 ──\033[0m\n'
for r in "${RESULTS[@]}"; do
  case "$r" in
    PASS*) printf '\033[32m%s\033[0m\n' "$r" ;;
    FAIL*) printf '\033[31m%s\033[0m\n' "$r" ;;
    *)     printf '\033[2m%s\033[0m\n' "$r" ;;
  esac
done

if [ "$FAILED" -ne 0 ]; then printf '\n\033[31m게이트 실패 — merge하지 않는다.\033[0m\n'; exit 1; fi
printf '\n\033[32m게이트 통과.\033[0m\n'
