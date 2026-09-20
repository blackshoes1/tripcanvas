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
#   scripts/nas-deploy.sh --sha <SHA>     # 특정 커밋으로 (롤백·비상 수동 배포)
#   scripts/nas-deploy.sh --force         # 같은 SHA라도 다시 띄운다
#   scripts/nas-deploy.sh --status        # 지금 무엇이 도는지만 보고 끝
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
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) TARGET_SHA="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --status) STATUS_ONLY=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "모르는 인자: $1" >&2; exit 2 ;;
  esac
done

# ── 로그: 한 줄에 하나, 시각과 함께. 나중에 "그때 무슨 일이었나"를 여기서 읽는다 ──
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" >&2; }
die() { log "✗ $*"; exit 1; }
compose() { $DOCKER compose -f "$COMPOSE_FILE" "$@"; }

# JSON 한 칸 꺼내기 — NAS에 jq가 없을 수 있다
json_str() { printf '%s' "${1:-}" | tr ',' '\n' | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'; }

read_state() {
  CURRENT_SHA=""; PREVIOUS_SHA=""
  [ -f "$STATE_FILE" ] && . "$STATE_FILE" || true
  CURRENT_SHA="${CURRENT_SHA:-}"; PREVIOUS_SHA="${PREVIOUS_SHA:-}"
}

write_state() {
  umask 077
  cat > "$STATE_FILE" <<EOF
# scripts/nas-deploy.sh가 쓴다 — 손으로 고치지 않는다
CURRENT_SHA=$1
PREVIOUS_SHA=$2
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
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
  # 배포 스크립트 자신이 바뀌었으면 알려만 준다 — 돌고 있는 스크립트를 스스로 갈아 끼우지 않는다
  local self; self=$(mktemp)
  if curl -fsSL --max-time 30 "$RAW/$sha/scripts/nas-deploy.sh" -o "$self" 2>/dev/null \
     && ! cmp -s "$self" "${BASH_SOURCE[0]}"; then
    cat "$self" > "$DEPLOY_DIR/nas-deploy.sh.new"
    log "! 배포 스크립트가 바뀌었다 — 확인 후 교체: cp $DEPLOY_DIR/nas-deploy.sh.new ${BASH_SOURCE[0]}"
  fi
  rm -f "$self"
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
fi

# 자동 배포 일시 중지 — 장애 대응·파괴적 마이그레이션 직전에 쓴다
if [ -z "${DEPLOY_DISABLED:-}" ] && [ -f "$ENV_FILE" ]; then
  DEPLOY_DISABLED=$(grep -E '^DEPLOY_DISABLED=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
fi
if [ "${DEPLOY_DISABLED:-}" = "1" ] || [ -f "$DEPLOY_DIR/.deploy-disabled" ]; then
  echo "자동 배포가 중지돼 있다(DEPLOY_DISABLED 또는 deploy/.deploy-disabled)"; exit 0
fi

read_state
if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA=$(remote_target) || { log "✗ production 태그를 읽지 못했다(GitHub에 닿지 못함) — 다음 차례에 다시"; exit 1; }
fi
case "$TARGET_SHA" in
  [0-9a-f]*) [ ${#TARGET_SHA} -eq 40 ] || die "SHA 형식이 아니다: $TARGET_SHA" ;;
  *) die "SHA 형식이 아니다: $TARGET_SHA" ;;
esac

# 바뀐 게 없으면 **아무것도 하지 않고** 빠르게 끝난다(5분마다 도는 경로다)
if [ "$TARGET_SHA" = "$CURRENT_SHA" ] && [ "$FORCE" != 1 ]; then exit 0; fi

log "── 배포 시작: ${CURRENT_SHA:0:7}${CURRENT_SHA:+ → }${TARGET_SHA:0:7}"
if bring_up "$TARGET_SHA"; then
  write_state "$TARGET_SHA" "$CURRENT_SHA"
  log "✔ 배포 성공: ${TARGET_SHA:0:7}"
  exit 0
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
