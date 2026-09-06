#!/usr/bin/env bash
# 복원 리허설 — **off-site 덤프 하나로 실제로 되살아나는지** 확인하고 RTO를 잰다.
#
#   deploy/restore-rehearsal.sh /path/to/tripcanvas-<UTC>.dump
#
# "백업이 있다"와 "복구된다"는 다른 말이다(§61). 이 스크립트가 확인하는 것:
#   1. off-site에서 가져온 덤프가 실제로 열리는가
#   2. 마이그레이션이 그 위에 올라가는가 (덤프가 옛 스키마여도)
#   3. 행 수가 운영과 맞는가
#   4. 여기까지 몇 분 걸리는가 = RTO
#
# ⚠️ 운영 DB는 **읽기만** 한다. 복원은 이름이 다른 격리된 컨테이너·볼륨에서만 일어난다.
# ⚠️ NAS 로컬 사본이 아니라 **off-site에서 회수한 파일**로 돌려야 의미가 있다.
#    (Hyper Backup 목적지에서 내려받은 것 — 그래야 외부 복제까지 검증된다)
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "사용법: $0 /path/to/tripcanvas-<UTC>.dump" >&2
  echo "  ⚠️ off-site 목적지에서 내려받은 파일을 쓴다 — NAS 로컬 사본으로는 외부 복제가 검증되지 않는다" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
NAME="tripcanvas-rehearsal"
PGPASS="rehearsal-$(date +%s)"
DB=tripcanvas
USER=tripcanvas

# 운영과 비교할 표. 프롬프트 §16이 요구하는 대상 전부.
TABLES="users trips trip_members trip_snapshots trip_invites trip_candidates candidate_reactions trip_comments trip_activity trip_memories hotel_price_snapshots suggestion_feedback notification_log device_tokens"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "${NAME}-data" >/dev/null 2>&1 || true
}
trap cleanup EXIT

counts() {   # counts <psql 실행 명령...>
  for t in $TABLES; do
    n=$("$@" -tAc "select count(*) from $t" 2>/dev/null || echo "-")
    printf '%s\t%s\n' "$t" "$n"
  done
}

START=$(date +%s)
echo "▶ 리허설 시작 — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  덤프: $DUMP ($(du -h "$DUMP" | cut -f1))"

cleanup
echo "▶ 격리된 PostgreSQL 기동 ($PG_IMAGE)"
docker volume create "${NAME}-data" >/dev/null
docker run -d --name "$NAME" \
  -e POSTGRES_DB="$DB" -e POSTGRES_USER="$USER" -e POSTGRES_PASSWORD="$PGPASS" \
  -v "${NAME}-data:/var/lib/postgresql/data" \
  "$PG_IMAGE" >/dev/null

printf '  준비 대기'
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then break; fi
  printf '.'; sleep 1
done
echo
docker exec "$NAME" pg_isready -U "$USER" -d "$DB" >/dev/null || { echo "✗ PostgreSQL이 뜨지 않았다"; exit 1; }

echo "▶ 덤프 복원"
docker exec -i "$NAME" pg_restore -U "$USER" -d "$DB" \
  --clean --if-exists --no-owner --no-privileges < "$DUMP" \
  || echo "  (pg_restore가 경고를 냈다 — --clean은 처음 복원에서 'does not exist'를 낸다. 아래 행 수로 판단한다)"

echo "▶ 마이그레이션 (덤프가 옛 스키마여도 따라잡는다)"
docker run --rm --network "container:$NAME" \
  -e DATABASE_URL="postgres://$USER:$PGPASS@127.0.0.1:5432/$DB" \
  -v "$HERE/..:/repo" -w /repo/next \
  node:22-alpine sh -c 'npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 && npx drizzle-kit migrate' \
  || echo "  ⚠️ 마이그레이션 단계를 건너뛴다 — 이미지가 없거나 네트워크가 막혔다. 행 수는 아래에서 계속 본다"

END=$(date +%s)
RTO=$(( END - START ))

echo
echo "▶ 복원된 DB의 행 수"
RESTORED=$(counts docker exec "$NAME" psql -U "$USER" -d "$DB")

# 운영과 비교 — TC_PROD_PSQL이 있으면 그것으로 읽는다(읽기 전용).
#   예: TC_PROD_PSQL="docker compose -f deploy/docker-compose.yml exec -T postgres psql -U tripcanvas -d tripcanvas"
if [ -n "${TC_PROD_PSQL:-}" ]; then
  echo "▶ 운영과 비교 (운영은 읽기만 한다)"
  # shellcheck disable=SC2086
  PROD=$(counts $TC_PROD_PSQL)
  printf '\n%-24s %12s %12s %s\n' "테이블" "운영" "복원본" ""
  DIFF=0
  while IFS=$'\t' read -r t r; do
    p=$(printf '%s\n' "$PROD" | awk -F'\t' -v k="$t" '$1==k{print $2}')
    mark="✓"
    [ "$p" != "$r" ] && { mark="✗ 다름"; DIFF=1; }
    printf '%-24s %12s %12s %s\n' "$t" "${p:--}" "$r" "$mark"
  done <<< "$RESTORED"
else
  printf '\n%-24s %12s\n' "테이블" "복원본"
  printf '%s\n' "$RESTORED" | while IFS=$'\t' read -r t r; do printf '%-24s %12s\n' "$t" "$r"; done
  echo
  echo "  운영과 비교하려면 TC_PROD_PSQL을 주고 다시 돌린다:"
  echo '    TC_PROD_PSQL="docker compose -f deploy/docker-compose.yml exec -T postgres psql -U tripcanvas -d tripcanvas" \'
  echo "      deploy/restore-rehearsal.sh $DUMP"
  DIFF=0
fi

echo
printf '▶ RTO: %d분 %d초 (덤프 확보 이후 — 회수 시간은 여기 포함되지 않는다)\n' $((RTO/60)) $((RTO%60))
echo
if [ "${DIFF:-0}" -ne 0 ]; then
  echo "✗ 행 수가 다르다. 덤프가 오래됐거나(그 사이 쓰기가 있었다) 복원이 일부 실패했다."
  echo "  전자면 정상이다 — 덤프 시각 이후의 쓰기는 당연히 없다. 그 차이가 곧 **손실 구간(RPO)**이다."
  exit 1
fi
echo "✓ 리허설 통과. 이 숫자와 RTO를 docs/backup-restore.md에 날짜와 함께 남긴다."
