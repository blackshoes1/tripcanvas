#!/usr/bin/env bash
# 관리형 DB로 가는 복원 경로를 **합성 데이터로** 끝까지 밟아 본다(docs/managed-db-migration.md Phase A).
#
#   TARGET_DATABASE_URL=<비어 있는 관리형 staging DB> scripts/rehearse-restore-managed.sh
#
# 원본 = 이 기계의 1회용 로컬 클러스터(합성 데이터) → deploy/backup.sh(실제 백업 스크립트) → restore-to-target.sh(관리형)
# → verify-db(전수 대조). 운영 데이터·운영 주소를 쓰지 않는다. 대상은 비어 있어야 하고(스크립트가 확인), 끝나도 비우지 않는다 —
# 사람이 결과를 보고 지운다. 종료 코드는 restore-to-target.sh와 같다(0 PASS · 1 FAIL · 2 미완료).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL(비어 있는 관리형 staging DB)이 필요하다}"
export TC_PGDIR
TC_PGDIR=$(mktemp -d /tmp/tc-restore-managed.XXXXXX)
export TC_PGPORT=5498
cleanup() { scripts/pg-local.sh stop; rm -rf "$TC_PGDIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
scripts/pg-local.sh start
eval "$(scripts/pg-local.sh env)"
pgbin=$(dirname "$TC_PSQL")
export PGHOST="$TC_PGDIR" PGPORT="$TC_PGPORT" PGUSER=postgres
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD DATABASE_URL
"$TC_PSQL" -X -v ON_ERROR_STOP=1 -d postgres -c 'CREATE DATABASE tc_source' >/dev/null
source_url="postgresql://postgres@localhost/tc_source?host=$TC_PGDIR&port=$TC_PGPORT"
DATABASE_URL="$source_url" npm --prefix next run db:migrate >"$TC_PGDIR/migrate.log" 2>&1 || { cat "$TC_PGDIR/migrate.log"; exit 1; }
"$TC_PSQL" -X -v ON_ERROR_STOP=1 -d tc_source -f scripts/rehearse-seed.sql >/dev/null
started=$SECONDS
# 전환 당일의 마지막 덤프와 같은 조건 — 덤프 뒤에 원본을 건드리지 않는다(BACKUP_RECORD=0). 아니면 기록 한 행 때문에 대조가 실패한다
PATH="$pgbin:$PATH" PGDATABASE=tc_source BACKUP_DIR="$TC_PGDIR" BACKUP_RECORD=0 sh deploy/backup.sh
dump=$(ls "$TC_PGDIR"/tripcanvas-*.dump | head -1)
set +e
PG_RESTORE="$pgbin/pg_restore" PSQL="$pgbin/psql" SOURCE_DATABASE_URL="$source_url" TARGET_DATABASE_URL="$TARGET_DATABASE_URL" \
  scripts/restore-to-target.sh "$dump"
code=$?
set -e
case "$code" in
  0) echo "PASS 합성 데이터: 로컬 → 백업 → 관리형 복원 → 마이그레이션 → 전수 대조 일치 ($((SECONDS - started))초)";;
  2) echo "INCOMPLETE 합성 데이터: 복원은 됐지만 대조에 SKIP이 있다 — 위 표를 본다";;
  *) echo "FAIL 합성 데이터: 관리형 복원 경로가 통과하지 못했다";;
esac
echo "운영 데이터·운영 규모·오프사이트 복제·API 로그인/저장은 검증하지 않았다."
exit "$code"
