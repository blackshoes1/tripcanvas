#!/usr/bin/env bash
# pg_dump(custom) 덤프를 **비어 있는** 대상 PostgreSQL에 복원 → 마이그레이션을 코드와 맞춤 → (원본이 있으면) 전수 대조.
# 관리형 DB로 옮길 때의 복원 경로다(docs/managed-db-migration.md). 운영 DB에 --clean으로 덮어쓰지 않는다.
#
#   TARGET_DATABASE_URL=… [SOURCE_DATABASE_URL=…] scripts/restore-to-target.sh <tripcanvas-YYYY….dump> [--ignore=t1,t2]
#
# 종료 코드: 0 복원+대조 PASS · 1 실패 · 2 대조를 못 했다(SOURCE_DATABASE_URL 없음 또는 SKIP 있음). **2는 통과가 아니다.**
# 연결 문자열은 출력하지 않는다 — 시작할 때 `계정@호스트/DB` 한 줄만 찍는다(어디에 붓는지 사람이 확인한다).
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then echo "usage: TARGET_DATABASE_URL=… $0 <dump.custom> [--ignore=…]" >&2; exit 2; fi
shift
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL(비어 있는 대상 DB)이 필요하다}"
if [ -n "${SOURCE_DATABASE_URL:-}" ] && [ "$SOURCE_DATABASE_URL" = "$TARGET_DATABASE_URL" ]; then
  echo "[restore] 원본과 대상이 같다 — 중단" >&2; exit 1
fi
PSQL="${PSQL:-psql}"; PG_RESTORE="${PG_RESTORE:-pg_restore}"

ident=$("$PSQL" "$TARGET_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 \
  -c "select current_user || '@' || coalesce(host(inet_server_addr()), 'local') || '/' || current_database()")
echo "[restore] 대상 $ident  ←  $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"

# 비어 있는 DB에만 붓는다. 표가 하나라도 있으면 운영이거나 지난 리허설이다 — 새 DB를 만들어 지정한다.
tables=$("$PSQL" "$TARGET_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c "select count(*) from pg_tables where schemaname in ('public','drizzle')")
if [ "$tables" != "0" ]; then
  echo "[restore] 대상이 비어 있지 않다(표 ${tables}개) — 덮어쓰지 않는다. 비어 있는 DB를 새로 만들어 지정할 것" >&2; exit 1
fi

started=$SECONDS
"$PG_RESTORE" -d "$TARGET_DATABASE_URL" --single-transaction --exit-on-error --no-owner --no-privileges "$DUMP"
echo "[restore] 복원 완료 ($((SECONDS - started))초). 마이그레이션을 코드와 맞춘다 — 덤프가 옛 스키마여도 여기서 따라잡는다"
DATABASE_URL="$TARGET_DATABASE_URL" npm --prefix next run db:migrate >/dev/null

if [ -z "${SOURCE_DATABASE_URL:-}" ]; then
  echo "[restore] SOURCE_DATABASE_URL이 없어 대조를 하지 않았다 — 복원했다는 것과 같다는 것은 다르다. 종료 2"
  exit 2
fi
echo "[restore] 원본과 전수 대조한다"
set +e
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" TARGET_DATABASE_URL="$TARGET_DATABASE_URL" scripts/verify-db-migration.sh "$@"
code=$?
set -e
echo "[restore] 대조 종료 코드 $code (0 PASS · 1 FAIL · 2 SKIP 있음)"
exit "$code"
