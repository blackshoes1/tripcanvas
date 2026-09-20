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
# 통과/실패/미실행을 끝에 표로 찍는다. 실패는 1, 미실행은 2로 끝난다.
set -uo pipefail
cd "$(dirname "$0")/.."

SCOPE="${1:-all}"
case "$SCOPE" in all|web|next|ios) ;; *) echo "usage: $0 [all|web|next|ios]" >&2; exit 2 ;; esac
RESULTS=()
FAILED=0
SKIPPED=0

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

skip() { SKIPPED=1; RESULTS+=("SKIP  $1 — $2"); printf '\n\033[2m▶ %s (건너뜀: %s)\033[0m\n' "$1" "$2"; }

want() { [ "$SCOPE" = all ] || [ "$SCOPE" = "$1" ]; }

# ── 파리티 픽스처가 커밋된 것과 같은지 ──
# ⚠️ `swiftParity.test.ts`는 픽스처를 **읽지 않고 덮어쓴다.** 그래서 계약을 바꾸고 픽스처를
#    커밋하지 않으면, CI 러너가 제 손으로 다시 써서 초록이 된다. 커밋해야 `ios/**` 경로가 걸려
#    iOS 워크플로가 돌고 Swift가 검사된다 — 안 그러면 Swift는 **검사되지 않은 채로 남는다.**
#    2026-09-19 새벽 사고(빌드 성공·로그 초록·내용은 옛 커밋)와 같은 종류라 게이트로 막는다.
PARITY_FIXTURES=ios/TripCanvasTests/Fixtures
check_parity_fixtures() {
  local dirty
  dirty=$(git status --porcelain -- "$PARITY_FIXTURES" 2>/dev/null || true)
  if [ -n "$dirty" ]; then
    echo "파리티 픽스처가 방금 다시 쓰여 커밋된 것과 달라졌다 — 계약이 바뀌었다는 뜻이다." >&2
    echo "커밋해야 ios/** 경로가 걸려 iOS 워크플로가 돌고 Swift가 검사된다:" >&2
    echo "$dirty" >&2
    return 1
  fi
  return 0
}

# ── 루트: Quality ─────────────────────────────────────────────────────────────
if want web; then
  step "구문 검사"            npm run check:syntax
  step "버전 동기(sw.js ↔ index.html)" npm run check:version
  step "lint"                 npm run lint
  step "시크릿 스캔"          npm run security:scan
  step "마이그레이션 하위호환"  npm run check:migrations
  step "타입 검사(tsc)"       npm run check:types
  step "유닛 테스트"          npm run test:unit
  step "통합 테스트"          npm run test:integration

  # RLS는 진짜 PostgreSQL이 있어야 판정이 의미가 있다 — 없으면 테스트가 스스로 skip하므로
  # "돌렸는데 0건 통과"를 초록으로 착각하지 않도록 여기서도 건너뛴 것으로 표시한다.
  if scripts/pg-local.sh env >/dev/null 2>&1; then
    step "RLS(실제 PostgreSQL)"  bash -o pipefail -c 'scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && log=$(mktemp) && { npm run test:rls 2>&1 | tee "$log"; } && grep -q "# skipped 0" "$log"; result=$?; rm -f "${log:-}"; exit "$result"'
  else
    skip "RLS(실제 PostgreSQL)" "로컬 PostgreSQL 바이너리 없음"
  fi

  # 복구해 본 백업만 백업이다(docs/backup-restore.md) — 실제 pg_dump/pg_restore/마이그레이션/전수 대조를 합성 데이터로 밟는다
  if ! scripts/pg-local.sh env >/dev/null 2>&1; then
    skip "복구 리허설(합성·실제 PostgreSQL)" "로컬 PostgreSQL 바이너리 없음"
  elif [ ! -d next/node_modules ]; then
    skip "복구 리허설(합성·실제 PostgreSQL)" "next/node_modules 없음(drizzle-kit) — npm --prefix next ci"
  else
    step "복구 리허설(합성·실제 PostgreSQL)" npm run rehearse:restore
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
    step "next: 파리티 픽스처 커밋 확인" check_parity_fixtures
    step "next: build"        npm --prefix next run build
    step "next: tools:build"  npm --prefix next run tools:build
    step "next: API 연결 E2E" npm run test:e2e:next
  else
    skip "next 워크스페이스" "next/node_modules 없음 — npm --prefix next ci"
  fi
fi

# ── iOS ──────────────────────────────────────────────────────────────────────
if want ios; then
  if [ "$(uname)" = Darwin ] && command -v xcodebuild >/dev/null 2>&1 && command -v xcodegen >/dev/null 2>&1; then
    # ⚠️ 이름이 아니라 **UDID**로 고른다. `-destination`에 이름만 주면 xcodebuild가 그 이름을
    # **최신 런타임에서** 찾는데, 여기서 고른 이름은 `simctl`이 먼저 뱉은 런타임의 것이다.
    # 런타임이 둘 이상인 기계에서는 둘이 어긋나 `Unable to find a device matching…`으로 죽는다
    # (CI 러너는 런타임이 하나라 드러나지 않는다).
    SIM_LINE=$(xcrun simctl list devices available | awk '/^ +iPhone/ { print; exit }')
    SIM_ID=$(printf '%s\n' "$SIM_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')
    SIM=$(printf '%s\n' "$SIM_LINE" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*\(.*//')
    if [ -z "$SIM_ID" ]; then
      skip "iOS" "사용 가능한 iPhone 시뮬레이터 없음"
    else
      echo "사용할 시뮬레이터: $SIM ($SIM_ID)"
      NOSIGN=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=)
      step "iOS: XcodeGen"    bash -c 'cd ios && xcodegen generate'
      step "iOS: 빌드 + XCTest" bash -c "cd ios && xcodebuild test -project TripCanvas.xcodeproj -scheme TripCanvas -destination 'id=$SIM_ID' ${NOSIGN[*]}"
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
if [ "$SKIPPED" -ne 0 ]; then printf '\n게이트 미완료 — SKIP을 해소하기 전에는 통과가 아니다.\n'; exit 2; fi
printf '\n\033[32m게이트 통과.\033[0m\n'
