#!/usr/bin/env bash
# scripts/nas-deploy.sh — `origin/main`을 NAS API에 배포한다. tailnet 안의 기기(맥)에서 저장소 폴더에서 실행한다.
#
# 왜 스크립트인가 (2026-09-19): 새벽 2:11 배포는 docker build가 성공했는데 내용이 #239였다.
# `git fetch`가 돌지 않아 맥의 `origin/main`이 전날 것이었고, `git archive origin/main`은 그걸 그대로 담았다.
# 로그는 전부 초록이라 "재빌드했는데도 옛 규칙"이 몇 시간을 먹었다. 그래서 이 스크립트는
#   1) fetch가 실패하면 멈추고        2) 담은 커밋을 찍고
#   3) 그 커밋을 이미지 라벨·환경변수(TC_REVISION)로 박고
#   4) 빌드 뒤 컨테이너 라벨과 `GET /api/health`의 `revision`이 같은 커밋인지 확인한다.
# 하나라도 어긋나면 0이 아닌 코드로 끝난다 — "올렸는데 안 바뀜"이 조용히 지나가지 않게.
#
# 사용:  scripts/nas-deploy.sh [--migrate] [--realtime]
#   --migrate   마이그레이션을 추가했을 때. migrate 이미지도 다시 빌드해 한 번 돌리고 종료 코드 0을 확인한다.
#   --realtime  realtime/ 을 바꿨을 때. 사이드카도 다시 빌드한다.
# 환경변수: NAS_HOST(nas) · NAS_DIR(~/tripcanvas) · NAS_DOCKER(/usr/local/bin/docker) · NAS_SUDO(sudo)
#          · REF(origin/main) · API_URL(https://bokbok9.tail8b977f.ts.net)
# ⚠️ deploy/.env는 추적되지 않아 아카이브에 없다 — NAS 것이 그대로 남는다. .env를 고쳤으면 --force-recreate는 따로.
set -euo pipefail

NAS_HOST="${NAS_HOST:-nas}"
NAS_DIR="${NAS_DIR:-~/tripcanvas}"            # 원격 셸이 ~ 를 푼다
NAS_DOCKER="${NAS_DOCKER:-/usr/local/bin/docker}"
NAS_SUDO="${NAS_SUDO:-sudo}"
REF="${REF:-origin/main}"
API_URL="${API_URL:-https://bokbok9.tail8b977f.ts.net}"
COMPOSE_FILE="deploy/docker-compose.yml"

services=(api)
for arg in "$@"; do
  case "$arg" in
    --migrate) services+=(migrate) ;;
    --realtime) services+=(realtime) ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "모르는 인자: $arg (--migrate | --realtime)" >&2; exit 2 ;;
  esac
done

say(){ printf '\n▶ %s\n' "$*"; }
die(){ printf '\n✗ %s\n' "$*" >&2; exit 1; }
nas(){ ssh "$NAS_HOST" "$@"; }
dk(){ echo "$NAS_SUDO $NAS_DOCKER"; }

# 1) fetch — 실패하면 여기서 끝. 옛 origin/main을 담는 일이 없게.
say "git fetch origin"
git fetch origin || die "git fetch 실패 — 네트워크나 remote 설정을 본다. 옛 $REF 로 배포하지 않는다."
sha="$(git rev-parse "$REF")" || die "$REF 를 찾지 못했다"
short="${sha:0:7}"
say "배포할 커밋: $short ($REF)  $(git log -1 --format=%s "$sha")"
if [ -n "$(git status --short --untracked-files=no)" ]; then
  echo "  (참고) 작업 트리에 커밋되지 않은 변경이 있다 — 아카이브는 $REF 커밋만 담으므로 그 변경은 배포되지 않는다."
fi

# 2) 아카이브 — HEAD가 아니라 확인한 커밋을 담는다.
tgz="$(mktemp -t tc-main.XXXXXX).tgz"
trap 'rm -f "$tgz"' EXIT
git archive --format=tar "$sha" | gzip > "$tgz"
say "아카이브 $(du -h "$tgz" | cut -f1) → $NAS_HOST:~/tc-main.tgz"
scp -O -q "$tgz" "$NAS_HOST:~/tc-main.tgz"

# 3) NAS에 풀고, 푼 소스가 그 커밋인지 표식으로 남긴다.
nas "cd $NAS_DIR && tar -xzf ~/tc-main.tgz && rm ~/tc-main.tgz && printf '%s\n' '$sha' > .tc-revision"
say "NAS 소스 표식: $(nas "cat $NAS_DIR/.tc-revision")"

# 4) 빌드 — 커밋 SHA를 TC_REVISION으로 넣어 이미지 라벨과 런타임 환경변수에 박는다.
say "docker compose build ${services[*]}"
nas "cd $NAS_DIR && $NAS_SUDO env TC_REVISION=$sha $NAS_DOCKER compose -f $COMPOSE_FILE build ${services[*]}" \
  || die "build 실패 — 위 로그의 ERROR 줄을 본다. 옛 이미지가 그대로 돈다."

for svc in "${services[@]}"; do
  label="$(nas "$(dk) image inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' tripcanvas-$svc")"
  [ "$label" = "$sha" ] || die "이미지 tripcanvas-$svc 의 revision 라벨이 $label 이다 (기대 $short) — 빌드가 새 이미지를 만들지 않았다."
done
say "이미지 라벨 확인: ${services[*]} = $short"

# 5) migrate는 한 번 돌고 끝나는 컨테이너 — 종료 코드 0만이 성공이다.
if [[ " ${services[*]} " == *" migrate "* ]]; then
  say "migrate 실행"
  nas "cd $NAS_DIR && $NAS_SUDO $NAS_DOCKER compose -f $COMPOSE_FILE up -d migrate"
  code="$(nas "$(dk) wait tripcanvas-migrate-1")"
  nas "$(dk) logs --tail=15 tripcanvas-migrate-1" || true
  [ "$code" = "0" ] || die "migrate 종료 코드 $code — 스키마가 적용되지 않았다. api를 올리지 않는다."
fi

# 6) api(·realtime) 올리기
up=(api); [[ " ${services[*]} " == *" realtime "* ]] && up+=(realtime)
say "docker compose up -d ${up[*]}"
nas "cd $NAS_DIR && $NAS_SUDO $NAS_DOCKER compose -f $COMPOSE_FILE up -d ${up[*]}"

running="$(nas "$(dk) inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' tripcanvas-api-1")"
[ "$running" = "$sha" ] || die "떠 있는 api 컨테이너의 revision이 $running 이다 (기대 $short) — 옛 컨테이너가 그대로 돌고 있다."

# 7) 밖에서 확인 — 살아 있고(401) 서버 스스로 말하는 revision이 같은 커밋이다.
say "$API_URL 확인 (최대 90초)"
ok=""
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/v1/trips" || true)"
  rev="$(curl -s "$API_URL/api/health" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' || true)"
  if [ "$code" = "401" ] && [ "$rev" = "$sha" ]; then ok=1; break; fi
  sleep 3
done
[ -n "$ok" ] || die "API 확인 실패 — /api/v1/trips=$code, /api/health revision=${rev:-없음} (기대 401, $short)"
say "완료 — API $short 가 돌고 있다. 앱은 화면을 당겨 새로고침한다."
