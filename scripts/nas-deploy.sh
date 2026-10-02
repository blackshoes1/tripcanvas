#!/usr/bin/env bash
# scripts/nas-deploy.sh — **NAS에서** 도는 운영 배포 (pull 방식, 2026-09-19)
#
#   main 머지 → GitHub Actions가 GHCR에 :<커밋 SHA> 이미지를 올리고 `production` 태그를 옮긴다
#            → (여기) NAS cron이 5분마다 그 태그를 보고 바뀌었으면 받아서 띄운다
#
# 사람이 하는 정상 배포 작업은 **PR을 main에 머지하는 것뿐**이다.
#
# 왜 이렇게 바뀌었나: 예전에는 맥에서 소스를 묶어 보내 NAS에서 빌드했다. 2026-09-19 새벽,
# 맥의 `origin/main`이 전날 것이라 **빌드는 성공했는데 내용이 옛 커밋**이었고 로그는 전부 초록이었다.
# 이제 NAS는 **빌드하지 않는다**. 커밋 SHA로 이름 붙은 이미지를 받아 띄우고, 띄운 뒤
# `/api/health`의 `revision`이 그 SHA인지 **확인한 다음에야** 성공으로 적는다.
#
# 쓰기:
#   scripts/nas-deploy.sh                 # cron이 부르는 정상 경로(바뀐 게 없으면 즉시 종료)
#   scripts/nas-deploy.sh --sha <SHA>     # 특정 커밋으로 (롤백·비상 수동 배포) — production이 아니면 고정한다
#   scripts/nas-deploy.sh --force         # 같은 SHA라도, 실패로 적힌 커밋이라도 다시 띄운다
#   scripts/nas-deploy.sh --status        # 지금 무엇이 도는지만 보고 끝
#
# 실패한 커밋은 적어 두고 자동으로는 다시 시도하지 않는다. 손 롤백은 deploy/.deploy-disabled로 고정한다.
# 멈춤(.deploy-disabled·DEPLOY_DISABLED=1)은 자동 경로만 세운다 — 손 --sha·--force는 진행하고, 멈춤은 사람이 rm으로 푼다.
#
# 환경변수로 바꿀 수 있는 것(기본값은 이 NAS 기준):
#   TC_DOCKER("sudo /usr/local/bin/docker") · TC_REPO · TC_DEPLOY_DIR · TC_DEPLOY_LOG
#   TC_API_HEALTH · TC_RT_HEALTH · TC_HEALTH_TIMEOUT · DEPLOY_DISABLED
#
# ⚠️ 비밀은 출력하지 않는다 — `deploy/.env`의 내용을 echo하거나 `set -x`를 켜지 않는다.
set -euo pipefail

REPO="${TC_REPO:-blackshoes1/tripcanvas}"
DEPLOY_DIR="${TC_DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" 2>/dev/null && pwd || echo "$HOME/tripcanvas/deploy")}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
STATE_FILE="$DEPLOY_DIR/.deploy-state"
DISABLED_FILE="$DEPLOY_DIR/.deploy-disabled"
ROLLBACK_DIR="$DEPLOY_DIR/.rollback"
LOG_FILE="${TC_DEPLOY_LOG:-$DEPLOY_DIR/deploy.log}"
LOCK_FILE="${TC_DEPLOY_LOCK:-$DEPLOY_DIR/.deploy.lock}"
DOCKER="${TC_DOCKER:-sudo /usr/local/bin/docker}"
API_HEALTH="${TC_API_HEALTH:-http://127.0.0.1:3000/api/health}"
RT_HEALTH="${TC_RT_HEALTH:-http://127.0.0.1:3001/health}"
HEALTH_TIMEOUT="${TC_HEALTH_TIMEOUT:-180}"
RAW="https://raw.githubusercontent.com/$REPO"
API="https://api.github.com/repos/$REPO"

TARGET_SHA=""; FORCE=0; STATUS_ONLY=0
MANUAL=0; MANUAL_SHA=0    # 사람이 준 명령인가(--sha·--force) — cron은 인자 없이 부른다
ORIG_ARGS=("$@")          # 자기 갱신 뒤 같은 인자로 다시 시작하기 위해 보관한다
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) TARGET_SHA="${2:-}"; MANUAL=1; MANUAL_SHA=1; shift 2 ;;
    --force) FORCE=1; MANUAL=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "모르는 인자: $1" >&2; exit 2 ;;
  esac
done

# ── 로그: 한 줄에 하나, 시각과 함께. 나중에 "그때 무슨 일이었나"를 여기서 읽는다 ──
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" >&2; }
die() { log "✗ $*"; exit 1; }
compose() { $DOCKER compose -f "$COMPOSE_FILE" "$@"; }

# JSON 한 칸 꺼내기 — NAS에 jq가 없을 수 있다
json_str() { printf '%s' "${1:-}" | tr ',' '\n' | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'; }

# ── 배포 상태(deploy/.deploy-state) ──
# ⚠️ **다른 판의 이 스크립트도 같은 파일을 읽고 쓴다**(자기 갱신이 판을 오간다). `. 파일`로 읽으므로
#    옛 판에게 새 키(FAILED_*)는 그냥 변수로 남고, 새 판은 새 키가 없는 옛 파일을 빈 값으로 읽는다.
#    옛 판이 다시 쓰면 FAILED_*가 사라지는데 — 그때는 그 커밋을 한 번 더 시도할 뿐이다.
read_state() {
  CURRENT_SHA=""; PREVIOUS_SHA=""; DEPLOYED_AT=""; FAILED_SHA=""; FAILED_AT=""
  [ -f "$STATE_FILE" ] && . "$STATE_FILE" || true
  CURRENT_SHA="${CURRENT_SHA:-}"; PREVIOUS_SHA="${PREVIOUS_SHA:-}"; DEPLOYED_AT="${DEPLOYED_AT:-}"
  FAILED_SHA="${FAILED_SHA:-}"; FAILED_AT="${FAILED_AT:-}"
}

# 지금 변수들을 그대로 적는다 — 성공은 CURRENT·PREVIOUS·DEPLOYED_AT을, 실패는 FAILED_*만 바꾼 뒤 부른다
write_state() {
  umask 077
  cat > "$STATE_FILE" <<EOF
# scripts/nas-deploy.sh가 쓴다 — 손으로 고치지 않는다
CURRENT_SHA=$CURRENT_SHA
PREVIOUS_SHA=$PREVIOUS_SHA
DEPLOYED_AT=$DEPLOYED_AT
FAILED_SHA=$FAILED_SHA
FAILED_AT=$FAILED_AT
EOF
}

# ── 자동 배포 멈춤: deploy/.deploy-disabled 또는 DEPLOY_DISABLED=1(환경변수·deploy/.env) ──
# 멈춰 있으면 이유와 **다시 켜는 법**을 한 줄로 찍고 0, 아니면 1.
# 손 롤백이 남긴 파일이면 무엇에 고정했는지(PINNED_SHA)도 말한다 — 파일은 `touch`로도 만들므로 읽기만 한다.
# ⚠️ 고정한 뒤 손으로 다른 커밋(--force·--sha <production>)을 띄워도 파일은 그대로다(멈춤은 사람이 푼다).
#    그때 "X에 고정했다"만 말하면 돌지 않는 커밋을 가리키게 되므로, 기록된 현재 SHA(read_state)와 다르면 함께 말한다.
disabled_reason() {
  local flag pinned
  flag="${DEPLOY_DISABLED:-}"
  if [ -z "$flag" ] && [ -f "$ENV_FILE" ]; then
    flag=$(grep -E '^DEPLOY_DISABLED=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
  fi
  if [ -f "$DISABLED_FILE" ]; then
    pinned=$(sed -n 's/^PINNED_SHA=//p' "$DISABLED_FILE" 2>/dev/null | tail -1 || true)
    if [ -n "$pinned" ] && [ -n "${CURRENT_SHA:-}" ] && [ "$pinned" != "$CURRENT_SHA" ]; then
      printf '자동 배포가 멈춰 있다 — 손으로 %s에 고정했지만 지금은 %s가 돈다. 다시 켜기: rm %s' \
        "${pinned:0:7}" "${CURRENT_SHA:0:7}" "$DISABLED_FILE"
    elif [ -n "$pinned" ]; then
      printf '자동 배포가 멈춰 있다 — 손으로 %s에 고정했다. 다시 켜기: rm %s' "${pinned:0:7}" "$DISABLED_FILE"
    else
      printf '자동 배포가 멈춰 있다(deploy/.deploy-disabled). 다시 켜기: rm %s' "$DISABLED_FILE"
    fi
    return 0
  fi
  if [ "$flag" = "1" ]; then
    printf '자동 배포가 멈춰 있다(DEPLOY_DISABLED=1). 다시 켜기: deploy/.env와 환경변수에서 그 값을 지운다'
    return 0
  fi
  return 1
}

# ── 손 롤백 고정: production이 아닌 커밋을 손으로 띄웠으면 자동 배포를 멈춘다 ──
# 안 그러면 production 태그는 그대로라 다음 cron이 5분 안에 production으로 되돌린다.
# 멈춤 파일을 쓰는 이유: **옛 판의 스크립트도 이 파일이 있으면 자동 배포를 하지 않는다**(내용은 보지 않는다).
pin_auto_deploy() {
  local prod="${PROD_SHA:0:7}"
  cat > "$DISABLED_FILE" <<EOF
# scripts/nas-deploy.sh --sha가 만들었다: production 태그(${prod:-확인 실패})가 아닌 커밋을 손으로 띄워 자동 배포를 멈췄다.
# 이 파일을 지우면 다음 차례에 production 태그의 커밋으로 돌아간다.
PINNED_SHA=$1
PINNED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  log "  자동 배포를 멈췄다 — ${1:0:7}에 고정(production ${prod:-확인 실패}로 되돌리지 않는다). 다시 켜기: rm $DISABLED_FILE"
}

# ── `deploy/.env`의 TC_IMAGE_TAG 한 줄만 갈아 끼운다(나머지 비밀은 건드리지 않는다) ──
# ⚠️ **이미지가 주인인 값은 .env에 있으면 안 된다.** compose의 `env_file: .env`는 파일을 통째로
#    컨테이너 환경에 넣는데, 그게 이미지에 박힌 ENV를 **덮어쓴다.** 2026-09-19: 맥에서 빌드하던
#    옛 방식이 남긴 `TC_REVISION` 한 줄 때문에, 새 이미지를 제대로 받아 띄우고도 /api/health는
#    옛 커밋을 말했다 — "어느 코드가 도는가"를 보증하려던 장치가 통째로 무력해졌다.
ENV_IMAGE_OWNED="TC_REVISION"

# .env를 이번 배포에 맞춘다: TC_IMAGE_TAG는 이 SHA로, 이미지가 주인인 값은 **지운다**.
# 나머지 줄(비밀 포함)은 손대지 않는다 — 이 파일의 진실은 NAS에 있다.
prepare_env() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE 이 없다 — deploy/.env.example을 복사해 값을 채운다"
  local key
  for key in $ENV_IMAGE_OWNED; do
    if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
      log "! deploy/.env의 $key 줄을 지운다 — 이미지가 주인인 값이라 여기 있으면 이미지의 값을 덮어쓴다"
    fi
  done
  local tmp; tmp=$(mktemp); umask 077
  awk -v tag="$1" -v owned="$ENV_IMAGE_OWNED" '
    BEGIN { n = split(owned, a, " "); for (i = 1; i <= n; i++) drop[a[i]] = 1 }
    /^TC_IMAGE_TAG=/ { print "TC_IMAGE_TAG=" tag; found = 1; next }
    { split($0, kv, "="); if (kv[1] in drop) next }
    { print }
    END { if (!found) print "TC_IMAGE_TAG=" tag }
  ' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  for key in $ENV_IMAGE_OWNED; do
    grep -q "^$key=" "$ENV_FILE" 2>/dev/null && die "deploy/.env에서 $key 를 지우지 못했다 — 손으로 지운 뒤 다시"
  done
  return 0
}

# ── 그 커밋의 compose·backup.sh를 받아 둔다: 이미지와 **같은 커밋**의 설정으로 띄우기 위해 ──
fetch_release_files() {
  local sha="$1" tmp; tmp=$(mktemp -d); local rc=0
  for f in docker-compose.yml backup.sh; do
    curl -fsSL --max-time 30 "$RAW/$sha/deploy/$f" -o "$tmp/$f" || rc=1
  done
  if [ "$rc" != 0 ]; then rm -rf "$tmp"; return 1; fi
  grep -q '^services:' "$tmp/docker-compose.yml" || { rm -rf "$tmp"; return 1; }
  # 지금 것을 먼저 치워 둔다 — GitHub이 죽었을 때 롤백이 이걸 쓴다
  mkdir -p "$ROLLBACK_DIR"
  if [ -f "$COMPOSE_FILE" ]; then cp "$COMPOSE_FILE" "$ROLLBACK_DIR/docker-compose.yml"; fi
  if [ -f "$DEPLOY_DIR/backup.sh" ]; then cp "$DEPLOY_DIR/backup.sh" "$ROLLBACK_DIR/backup.sh"; fi
  cat "$tmp/docker-compose.yml" > "$COMPOSE_FILE"
  cat "$tmp/backup.sh" > "$DEPLOY_DIR/backup.sh"; chmod +x "$DEPLOY_DIR/backup.sh"
  rm -rf "$tmp"
}

# ── 배포 스크립트 자신을 그 커밋의 것으로 맞춘다(2026-09-20) ──
# 예전에는 바뀐 것을 `deploy/nas-deploy.sh.new`로 받아 두고 사람이 손으로 복사하기를 기다렸다.
# 그 한 단계를 잊으면 **옛 스크립트가 5분마다 돌며 매번 같은 실패를 되풀이한다** — 실제로 그렇게 됐다.
#
# ⚠️ 돌고 있는 파일을 그 자리에서 덮어쓰지 않는다. bash는 스크립트를 조금씩 읽어 가며 실행해서,
#    내용이 발밑에서 바뀌면 엉뚱한 줄을 실행한다. 그래서 **같은 디렉터리**에 받아 문법을 검사한 뒤
#    rename으로 바꾼다 — 옛 inode는 그대로라 지금 프로세스는 끝까지 옛 내용을 읽는다.
# ⚠️ 새 프로세스가 같은 잠금을 다시 잡아야 하므로 exec 전에 풀어 준다.
# ⚠️ TC_SELF_UPDATED로 한 번만 한다. 안 그러면 두 커밋이 서로를 가리킬 때 무한히 다시 시작한다.
release_lock() {
  case "${LOCK_MODE:-}" in
    flock) exec 9>&- ;;
    dir)   trap - EXIT; rmdir "$LOCK_FILE.d" 2>/dev/null || true ;;
  esac
}

self_update() {
  local sha="$1" self tmp
  self="${BASH_SOURCE[0]}"
  [ -n "${TC_SELF_UPDATED:-}" ] && return 0            # 이미 갈아 끼우고 다시 온 차례다
  tmp=$(mktemp "$(dirname "$self")/.nas-deploy.XXXXXX" 2>/dev/null) || return 0
  if ! curl -fsSL --max-time 30 "$RAW/$sha/scripts/nas-deploy.sh" -o "$tmp" 2>/dev/null; then
    rm -f "$tmp"; return 0                             # 못 받았으면 지금 것으로 계속한다
  fi
  if cmp -s "$tmp" "$self"; then rm -f "$tmp"; return 0; fi
  if ! bash -n "$tmp" 2>/dev/null; then
    log "! 받은 배포 스크립트에 문법 오류가 있다 — 갈아 끼우지 않고 지금 것으로 계속한다"
    rm -f "$tmp"; return 0
  fi
  chmod +x "$tmp" 2>/dev/null || true
  if ! mv -f "$tmp" "$self" 2>/dev/null; then          # 같은 디렉터리라 rename 하나로 끝난다
    cat "$tmp" > "$DEPLOY_DIR/nas-deploy.sh.new" 2>/dev/null || true
    log "! 배포 스크립트를 바꾸지 못했다(권한?) — 확인 후 교체: cp $DEPLOY_DIR/nas-deploy.sh.new $self"
    rm -f "$tmp"; return 0
  fi
  log "  배포 스크립트를 ${sha:0:7}의 것으로 갈아 끼웠다 — 새 스크립트로 다시 시작한다"
  release_lock
  # Bash 3.2의 nounset은 빈 배열 확장도 오류로 처리한다.
  if [ "${#ORIG_ARGS[@]}" -eq 0 ]; then
    TC_SELF_UPDATED=1 exec "$self"
  else
    TC_SELF_UPDATED=1 exec "$self" "${ORIG_ARGS[@]}"
  fi
}

# ── 헬스체크: 컨테이너가 running인지가 아니라 **HTTP로 답하는지**를 본다 ──
# /api/health는 DB가 죽었을 때만 503이다(실시간·백업은 200 DEGRADED) — DB 연결까지 여기서 확인된다.
wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT )) body db
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -fsS --max-time 5 "$API_HEALTH" 2>/dev/null || true)
    if [ -n "$body" ]; then
      db=$(json_str "$body" database)
      if [ "$db" = "ok" ]; then HEALTH_BODY="$body"; return 0; fi
    fi
    sleep 5
  done
  HEALTH_BODY="${body:-}"
  return 1
}

# ── 도는 컨테이너가 **어느 이미지**로 떴는지: 환경변수를 거치지 않는 두 번째 증인 ──
# /api/health의 revision 하나만 보면 .env가 그 값을 덮어썼을 때 거짓을 참으로 읽는다(2026-09-19).
container_image_revision() {
  local cid img
  cid=$(compose ps -q "$1" 2>/dev/null | head -1) || return 1
  [ -n "$cid" ] || return 1
  img=$($DOCKER inspect -f '{{.Image}}' "$cid" 2>/dev/null) || return 1
  [ -n "$img" ] || return 1
  $DOCKER inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$img" 2>/dev/null
}

# ── revision 검증: GitHub·이미지·실제 컨테이너가 같은 커밋인지 ──
# 이게 없으면 "이미지는 새것인데 옛 컨테이너가 돈다"를 못 잡는다.
verify_revision() {
  local want="$1" got_api got_rt rt_body img_rev
  # ① 이미지에 박힌 라벨 — 컨테이너에 들어 있는 **코드 자체**
  img_rev=$(container_image_revision api 2>/dev/null || true)
  if [ -z "$img_rev" ]; then
    log "! 컨테이너 이미지의 revision 라벨을 읽지 못했다 — /api/health만으로 판정한다"
  elif [ "$img_rev" != "$want" ]; then
    log "✗ 도는 api 컨테이너가 다른 커밋의 이미지다: 기대 ${want:0:7}, 실제 ${img_rev:0:7}"; return 1
  fi
  # ② 도는 프로세스가 말하는 것 — 정말 새 이미지로 다시 떴는지
  got_api=$(json_str "$HEALTH_BODY" revision)
  if [ "$got_api" != "$want" ]; then
    log "✗ api revision 불일치: 기대 ${want:0:7}, 실제 ${got_api:-없음}"
    if [ "$img_rev" = "$want" ]; then
      log "  (이미지는 맞다 — deploy/.env에 TC_REVISION 같은 줄이 남아 이미지의 값을 덮어쓰고 있다)"
    fi
    return 1
  fi
  # 실시간은 LISTEN이 끊겨 있으면 503이지만 본문은 준다 — 상태는 경고, **커밋 불일치는 실패**다
  rt_body=$(curl -sS --max-time 5 "$RT_HEALTH" 2>/dev/null || true)
  got_rt=$(json_str "$rt_body" revision)
  if [ -z "$got_rt" ]; then
    log "! 실시간 헬스에 닿지 못했다 — api는 정상이라 배포는 계속한다(앱은 새로고침 폴백)"
  elif [ "$got_rt" != "$want" ]; then
    log "✗ realtime revision 불일치: 기대 ${want:0:7}, 실제 ${got_rt:0:7}"; return 1
  fi
  log "  revision 확인: api=${got_api:0:7} realtime=${got_rt:0:7}"
  return 0
}

# ── 한 SHA를 실제로 띄운다. 성공 0 / 실패 1 ──
# $2가 "rollback"이면 GitHub에 닿지 못해도 치워 둔 compose로 되돌린다 — 장애 중에도 롤백은 돼야 한다
bring_up() {
  local sha="$1" mode="${2:-deploy}"
  log "  설정 내려받기($RAW/${sha:0:7}/deploy/)"
  if ! fetch_release_files "$sha"; then
    if [ "$mode" = "rollback" ] && [ -f "$ROLLBACK_DIR/docker-compose.yml" ]; then
      log "! GitHub에 닿지 못했다 — 치워 둔 compose로 되돌린다"
      cp "$ROLLBACK_DIR/docker-compose.yml" "$COMPOSE_FILE"
      if [ -f "$ROLLBACK_DIR/backup.sh" ]; then cp "$ROLLBACK_DIR/backup.sh" "$DEPLOY_DIR/backup.sh"; fi
    else
      log "✗ 그 커밋의 compose를 받지 못했다"; return 1
    fi
  fi
  prepare_env "$sha"
  log "  이미지 pull"
  local pull_log; pull_log=$(mktemp)
  if ! compose pull api migrate realtime >"$pull_log" 2>&1; then
    log "✗ 이미지 pull 실패(그 커밋의 이미지가 없거나 GHCR에 닿지 못했다)"
    tail -10 "$pull_log" | sed 's/^/    /' | tee -a "$LOG_FILE" >&2 || true
    rm -f "$pull_log"; return 1
  fi
  rm -f "$pull_log"
  log "  이미지 pull 완료"
  # ⚠️ 여기서 migrate가 먼저 돈다(compose의 service_completed_successfully).
  #    마이그레이션이 실패하면 새 api·realtime은 **시작되지 않고** 지금 도는 것이 그대로 남는다.
  log "  migrate → api·realtime 교체"
  UP_ATTEMPTED=1            # 여기부터의 실패는 운영을 건드린 실패다(마이그레이션·교체·부팅)
  if ! compose up -d; then
    log "✗ compose up 실패(마이그레이션 실패일 가능성이 높다) — 아래 로그 참고"
    compose logs --tail=30 migrate 2>&1 | sed 's/^/    /' | tee -a "$LOG_FILE" >&2 || true
    return 1
  fi
  log "  헬스체크(${HEALTH_TIMEOUT}초 안)"
  wait_healthy || { log "✗ 헬스체크 실패: ${HEALTH_BODY:-응답 없음}"; return 1; }
  verify_revision "$sha" || return 1
  return 0
}

print_status() {
  read_state
  local body
  body=$(curl -fsS --max-time 5 "$API_HEALTH" 2>/dev/null || true)
  echo "기록된 현재 SHA : ${CURRENT_SHA:-없음}"
  echo "기록된 직전 SHA : ${PREVIOUS_SHA:-없음}"
  echo "도는 revision   : $(json_str "$body" revision)"
  echo "컨테이너 이미지 : $(container_image_revision api 2>/dev/null || echo '확인 실패')"
  echo "상태            : $(json_str "$body" status) / DB $(json_str "$body" database)"
  local tag; tag=$(remote_target || true)
  echo "production 태그 : ${tag:-확인 실패}"
  if [ -n "$FAILED_SHA" ]; then
    echo "실패로 적힌 SHA : $FAILED_SHA (${FAILED_AT:-시각 모름}) — 자동 배포가 다시 시도하지 않는다. 다시: $0 --force"
  fi
  local why
  if why=$(disabled_reason); then echo "자동 배포       : $why"; else echo "자동 배포       : 켜짐"; fi
}

# ── NAS가 보는 단 하나의 진실: production 태그가 가리키는 커밋 ──
# mutable한 :main 이미지 태그를 보고 판단하지 않는다 — 여기서 커밋 SHA가 바로 나온다.
remote_target() {
  local body sha
  body=$(curl -fsS --max-time 20 -H 'accept: application/vnd.github+json' "$API/git/ref/tags/production" 2>/dev/null || true)
  sha=$(json_str "$body" sha)
  printf '%s' "$sha"
  [ -n "$sha" ]
}

# ─────────────────────────── 시작 ───────────────────────────
mkdir -p "$DEPLOY_DIR"; touch "$LOG_FILE" 2>/dev/null || true

if [ "$STATUS_ONLY" = 1 ]; then print_status; exit 0; fi

# 동시 실행 금지 — 5분 cron이 겹쳐도 배포는 하나만 돈다. 이미 돌고 있으면 **조용히** 비켜 준다.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "이미 배포가 돌고 있다 — 이번 차례는 건너뛴다"; exit 0; }
  LOCK_MODE=flock
else
  # flock이 없는 환경 대비. 30분 넘게 남아 있는 잠금은 죽은 것으로 본다.
  if ! mkdir "$LOCK_FILE.d" 2>/dev/null; then
    if [ -n "$(find "$LOCK_FILE.d" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      rmdir "$LOCK_FILE.d" 2>/dev/null || true; mkdir "$LOCK_FILE.d" 2>/dev/null || exit 0
    else
      echo "이미 배포가 돌고 있다 — 이번 차례는 건너뛴다"; exit 0
    fi
  fi
  trap 'rmdir "$LOCK_FILE.d" 2>/dev/null || true' EXIT
  LOCK_MODE=dir
fi

# 자동 배포 일시 중지 — 장애 대응·파괴적 마이그레이션 직전·손 롤백 고정에 쓴다.
# 세우는 것은 **자동 경로(cron)뿐**이다. 손으로 준 --sha·--force는 진행한다: 멈춰 둔 채 사람이 보면서
# 배포하는 것이 이 장치의 쓰임이고(docs/migration-policy.md), 고정된 뒤의 손 명령까지 막히면
# 멈춤을 풀자마자 cron과 경주하게 된다. 멈춤은 사람이 푼다 — 스크립트는 지우지 않는다.
read_state                # 멈춤 사유가 고정 커밋과 지금 도는 커밋을 견준다
if WHY=$(disabled_reason); then
  if [ "$MANUAL" != 1 ]; then echo "$WHY"; exit 0; fi
  log "! $WHY — 손으로 준 명령이라 진행한다"
fi

PROD_SHA=""
if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA=$(remote_target) || { log "✗ production 태그를 읽지 못했다(GitHub에 닿지 못함) — 다음 차례에 다시"; exit 1; }
  PROD_SHA="$TARGET_SHA"
else
  PROD_SHA=$(remote_target || true)
fi
case "$TARGET_SHA" in
  [0-9a-f]*) [ ${#TARGET_SHA} -eq 40 ] || die "SHA 형식이 아니다: $TARGET_SHA" ;;
  *) die "SHA 형식이 아니다: $TARGET_SHA" ;;
esac

# 손 롤백: --sha가 production 태그와 다르면 띄운 뒤 고정한다(태그를 못 읽었으면 다른 것으로 본다)
PIN=0
if [ "$MANUAL_SHA" = 1 ] && [ "$TARGET_SHA" != "$PROD_SHA" ]; then PIN=1; fi

# 바뀐 게 없으면 **아무것도 하지 않고** 빠르게 끝난다(5분마다 도는 경로다)
if [ "$TARGET_SHA" = "$CURRENT_SHA" ] && [ "$FORCE" != 1 ]; then
  if [ "$PIN" = 1 ]; then pin_auto_deploy "$TARGET_SHA"; fi   # 이미 도는 커밋에 고정만 건다
  exit 0
fi

# 실패로 적힌 production 커밋은 자동으로 다시 시도하지 않는다 — 다시 하려면 사람이 --force(또는 --sha).
# 표준출력 한 줄로 끝낸다: 실패는 그때 배포 기록에 남았고, 5분마다 같은 줄을 쌓지 않는다.
if [ "$MANUAL" != 1 ] && [ -n "$FAILED_SHA" ] && [ "$TARGET_SHA" = "$FAILED_SHA" ]; then
  echo "production ${TARGET_SHA:0:7}는 배포에 실패한 커밋이라(${FAILED_AT:-시각 모름}) 자동으로 다시 시도하지 않는다 — 다시: $0 --force"
  exit 0
fi

# 배포할 게 있을 때만 스크립트를 맞춘다 — 바뀐 게 없는 5분 주기에는 요청을 늘리지 않는다.
# 여기서 갈아 끼우면 이 호출은 돌아오지 않는다(새 스크립트가 이어서 배포한다).
# ⚠️ 손 롤백(고정)은 갈아 끼우지 않고 **지금 스크립트로** 띄운다. 그 커밋의 옛 판은 고정을 모르고
#    (멈춤 파일을 남기지 않는다), 멈춤 파일이 있으면 손 명령까지 막는다 — 배포 도구는 앞으로만 간다.
if [ "$PIN" != 1 ]; then self_update "$TARGET_SHA"; fi

log "── 배포 시작: ${CURRENT_SHA:0:7}${CURRENT_SHA:+ → }${TARGET_SHA:0:7}"
UP_ATTEMPTED=0
if bring_up "$TARGET_SHA"; then
  PREVIOUS_SHA="$CURRENT_SHA"; CURRENT_SHA="$TARGET_SHA"; DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # 고정 배포는 production의 실패 기록을 지우지 않는다 — 고정을 풀면 그 기록이 다시 자동 경로를 지킨다
  if [ "$PIN" != 1 ]; then FAILED_SHA=""; FAILED_AT=""; fi
  write_state
  log "✔ 배포 성공: ${TARGET_SHA:0:7}"
  if [ "$PIN" = 1 ]; then
    pin_auto_deploy "$TARGET_SHA"
  elif WHY=$(disabled_reason); then
    # 멈춘 채 손으로 띄운 배포다. 시작할 때 한 번 말했지만 배포 기록 끝에서 다시 말한다 —
    # production으로 돌아왔으니 고정도 풀렸다고 믿으면, 다음 머지들이 조용히 배포되지 않는다.
    log "! 배포는 끝났지만 멈춤은 그대로다: $WHY"
  fi
  exit 0
fi

# ── 실패: 교체까지 갔으면 그 커밋을 적어 둔다 ──
# 안 적으면 production 태그가 그대로라 5분 뒤 cron이 '교체 → 헬스체크 실패 → 롤백'을 되풀이한다 —
# 실패 한 번이 5분마다 오는 운영 중단이 된다. 교체 전 실패(compose·이미지를 못 받음)는 운영을
# 건드리지 않았고 대개 일시적이라 적지 않는다 — 다음 차례에 다시 해 본다.
# 고정 배포(손 롤백)의 실패도 적지 않는다: 자동 경로가 고를 커밋이 아니고, 적으면 production의 기록을 덮는다.
if [ "$UP_ATTEMPTED" = 1 ] && [ "$PIN" != 1 ]; then
  FAILED_SHA="$TARGET_SHA"; FAILED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  write_state
  log "  ${TARGET_SHA:0:7}를 실패로 적었다 — 자동 배포는 이 커밋을 다시 시도하지 않는다(다음 production 커밋은 그대로 배포된다). 다시: $0 --force"
fi

# ── 실패 → 직전 SHA로 되돌린다 ──
# ⚠️ 이미지만 되돌아간다. **스키마는 앞선 채로 남는다** — 그래서 마이그레이션은 항상
#    하위호환이어야 한다(docs/migration-policy.md). 파괴적 변경이었다면 여기서 멈추고 사람이 본다.
if [ -z "$CURRENT_SHA" ]; then
  log "✗ 배포 실패 — 되돌릴 이전 SHA가 없다(첫 배포). 손으로 확인한다"; exit 1
fi
log "↩ 배포 실패 — ${CURRENT_SHA:0:7}로 되돌린다(스키마는 되돌아가지 않는다)"
if bring_up "$CURRENT_SHA" rollback; then
  log "✔ 롤백 성공: ${CURRENT_SHA:0:7} — ${TARGET_SHA:0:7}는 배포되지 않았다"
else
  log "✗✗ 롤백도 실패했다 — 운영이 내려가 있을 수 있다. 사람이 봐야 한다"
fi
exit 1
