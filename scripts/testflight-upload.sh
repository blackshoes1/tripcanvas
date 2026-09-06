#!/usr/bin/env bash
# 이 Mac에서 TestFlight로 올린다 — `.github/workflows/ios-testflight.yml`과 **같은 순서**다.
#
# 왜 있나: 평소에는 GitHub Actions로 올린다(버튼 한 번, 빌드 번호도 자동). 하지만 러너를 못 쓰는
# 동안에는(과금 중단 등) 올릴 방법이 아예 없어진다. 그때 쓰는 길이다 — `docs/ci.md`의 판단과 같다.
#
# ⚠️ 비밀은 이 저장소에 들어오지 않는다. `.p8`은 홈 디렉터리에 두고 여기서는 **경로만** 쓴다.
#    키 내용을 출력하지 않고, 인자로도 받지 않는다(셸 히스토리에 남는다).
#
# ── 준비 (처음 한 번) ─────────────────────────────────────────────────────────
#   1. App Store Connect에서 받은 `.p8`을 아래 경로에 둔다 (역할은 **Admin**이어야 한다):
#        ~/private_keys/AuthKey_<KeyID>.p8      chmod 600
#   2. 저장소 **밖에** 값 파일을 만든다 — 예: ~/.tripcanvas-testflight.env
#        export APPSTORE_KEY_ID=...
#        export APPSTORE_ISSUER_ID=...
#        export APPLE_TEAM_ID=...
#      (GitHub Secrets에 넣은 것과 같은 값이다. 저장소 안에 두지 않는다)
#
# ── 올릴 때 ──────────────────────────────────────────────────────────────────
#   source ~/.tripcanvas-testflight.env
#   BUILD=6 NOTES='무엇이 바뀌었는지' scripts/testflight-upload.sh
#
#   NOTES는 폰의 TestFlight에 '테스트할 내용'으로 뜬다. 비우면 그 칸이 빈 채로 올라간다.
#
#   BUILD(빌드 번호)는 **직접 준다.** 같은 번호는 두 번 못 올리는데, 기본값을 추측하면
#   조용히 충돌한다. Actions의 run number와 한 줄에 세는 것이 안전하다
#   (`gh run list --workflow=ios-testflight.yml` 의 가장 큰 번호보다 크게).
set -euo pipefail

cd "$(dirname "$0")/.."
IOS_DIR="$PWD/ios"
WORK="${TMPDIR:-/tmp}/tripcanvas-testflight"

fail(){ echo "✖ $*" >&2; exit 1; }

[ -n "${BUILD:-}" ] || fail "BUILD(빌드 번호)를 주세요 — 예: BUILD=6 $0"
case "$BUILD" in (*[!0-9]*|'') fail "BUILD는 정수여야 합니다: $BUILD";; esac

MISSING=""
for v in APPSTORE_KEY_ID APPSTORE_ISSUER_ID APPLE_TEAM_ID; do
  [ -n "${!v:-}" ] || MISSING="$MISSING $v"
done
[ -z "$MISSING" ] || fail "다음 값이 없습니다:$MISSING — 이 파일 맨 위 '준비' 절 참고"

KEY="$HOME/private_keys/AuthKey_${APPSTORE_KEY_ID}.p8"
[ -f "$KEY" ] || fail "API 키가 없습니다: $KEY
   App Store Connect에서 받은 .p8을 그 경로에 두고 chmod 600 하세요."

command -v xcodegen >/dev/null || fail "xcodegen이 없습니다 — brew install xcodegen"

echo "▸ TestFlight 업로드 — com.fromj.trip · 빌드 $BUILD"

# 1) 프로젝트 생성 (저장소에는 .xcodeproj를 넣지 않는다)
( cd "$IOS_DIR" && xcodegen generate >/dev/null )

# 2) 아카이브는 **서명 없이** 만든다.
#    여기서 자동 서명을 켜면 Xcode가 개발용 프로파일을 만들려 하고, 그건 등록된 기기를 요구해
#    기기가 없는 팀에서는 "your team has no devices"로 죽는다. 배포용 프로파일은 기기가 필요 없다.
rm -rf "$WORK"; mkdir -p "$WORK"
echo "▸ 아카이브 (Release, 서명 없음)"
( cd "$IOS_DIR" && xcodebuild archive \
    -project TripCanvas.xcodeproj -scheme TripCanvas -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$WORK/TripCanvas.xcarchive" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    CURRENT_PROJECT_VERSION="$BUILD" ) > "$WORK/archive.log" 2>&1 \
  || { tail -30 "$WORK/archive.log"; fail "아카이브 실패 — 전체 로그: $WORK/archive.log"; }

APP="$WORK/TripCanvas.xcarchive/Products/Applications/TripCanvas.app"
VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Info.plist")
GOT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Info.plist")
[ "$GOT" = "$BUILD" ] || fail "빌드 번호가 안 박혔습니다 (기대 $BUILD, 실제 $GOT)"
echo "  $VER ($GOT)"

# 3) 서명과 업로드는 여기서 한 번에. method=app-store-connect라 **배포용** 프로파일을 받는다.
cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "▸ 서명 + 업로드"
if ! xcodebuild -exportArchive \
    -archivePath "$WORK/TripCanvas.xcarchive" \
    -exportOptionsPlist "$WORK/ExportOptions.plist" \
    -exportPath "$WORK/export" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$KEY" \
    -authenticationKeyID "$APPSTORE_KEY_ID" \
    -authenticationKeyIssuerID "$APPSTORE_ISSUER_ID" > "$WORK/upload.log" 2>&1; then
  tail -30 "$WORK/upload.log"
  echo "" >&2
  # 이 실패는 Apple 메시지가 엉뚱한 곳을 가리킨다 — 번들 ID나 앱 레코드 문제로 읽히지만 실제로는 키 권한이다.
  if grep -qE "Cloud signing permission error|No profiles for" "$WORK/upload.log"; then
    echo "→ 먼저 API 키 역할부터 보세요: **Admin**이어야 합니다." >&2
    echo "  -allowProvisioningUpdates가 프로파일을 직접 만드는데 App Manager에는 그 권한이 없습니다." >&2
    echo "  역할은 나중에 못 바꿉니다 — Admin으로 키를 새로 만드세요(Issuer ID는 그대로)." >&2
  fi
  fail "업로드 실패 — 전체 로그: $WORK/upload.log"
fi

# 바이너리만 올리면 폰에서 뭐가 바뀐 빌드인지 알 수 없다. NOTES가 있으면 채운다.
# ⚠️ 여기서 실패해도 업로드는 이미 성공이다 — 스크립트를 실패로 끝내지 않는다.
if [ -n "${NOTES:-}" ]; then
  echo "▸ 테스트할 내용 채우기"
  APPSTORE_PRIVATE_KEY_PATH="$KEY" TC_BUILD_NUMBER="$BUILD" TC_WHATS_NEW="$NOTES" \
    node "$PWD/scripts/testflight-notes.js" || echo "  (못 채웠습니다 — 빌드는 올라갔습니다)"
fi

echo "✔ 올렸습니다 — App Store Connect 처리에 5~15분, 그다음 폰의 TestFlight에 뜹니다."
echo "  첫 업로드라면 TestFlight → 내부 테스트에 자기 계정을 테스터로 추가해야 보입니다."
