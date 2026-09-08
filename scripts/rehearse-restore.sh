#!/usr/bin/env bash
# 합성 데이터만 사용. 새 로컬 소켓 클러스터에서 dump → restore → migrate → 내용 비교.
# 운영 주소/덤프를 받지 않으며 종료 시 자신이 만든 클러스터만 지운다.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -ne 0 ]; then echo "usage: $0 (합성 데이터 전용)" >&2; exit 2; fi
export TC_PGDIR
TC_PGDIR=$(mktemp -d /tmp/tc-restore.XXXXXX)
export TC_PGPORT=5499
cleanup() { scripts/pg-local.sh stop; rm -rf "$TC_PGDIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
scripts/pg-local.sh start
eval "$(scripts/pg-local.sh env)"
pgbin=$(dirname "$TC_PSQL")
export PGHOST="$TC_PGDIR" PGPORT="$TC_PGPORT" PGUSER=postgres
# 환경에 남은 운영 접속 설정을 쓰지 않는다.
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD DATABASE_URL
"$TC_PSQL" -X -v ON_ERROR_STOP=1 -d postgres -c 'CREATE DATABASE tc_source' -c 'CREATE DATABASE tc_restored' >/dev/null
source_url="postgresql://postgres@localhost/tc_source?host=$TC_PGDIR&port=$TC_PGPORT"
target_url="postgresql://postgres@localhost/tc_restored?host=$TC_PGDIR&port=$TC_PGPORT"
DATABASE_URL="$source_url" npm --prefix next run db:migrate >"$TC_PGDIR/migrate.log" 2>&1 || { cat "$TC_PGDIR/migrate.log"; exit 1; }
"$TC_PSQL" -X -v ON_ERROR_STOP=1 -d tc_source >/dev/null <<'SQL'
INSERT INTO users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000001','owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','viewer@example.invalid');
INSERT INTO trips(id,user_id,client_id,data,revision) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','restoretest',
  '{"id":"restoretest","name":"복구 리허설","days":[{"spots":[]}],"futureField":{"keep":true}}',7);
INSERT INTO trips(user_id,client_id,data,revision,deleted_at) VALUES
 ('00000000-0000-4000-8000-000000000001','deletedtest','{"id":"deletedtest","days":[]}',3,now());
INSERT INTO trip_members(trip_id,user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','OWNER'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','VIEWER');
INSERT INTO trip_snapshots(user_id,client_id,name,data,source_revision) VALUES
 ('00000000-0000-4000-8000-000000000001','restoretest','복구 리허설','{"futureField":{"keep":true}}',7);
SQL
# 표 전체(인증·마이그레이션 이력 포함)의 행 수·내용과 시퀀스를 비교한다. 개인정보는 출력하지 않는다.
cat >"$TC_PGDIR/fingerprint.sql" <<'SQL'
SELECT format('SELECT %L || ''|'' || count(*) || ''|'' || coalesce(md5(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text)), ''empty'') FROM %I.%I t;',
 schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename
\gexec
SELECT schemaname || '.' || sequencename || '|' || coalesce(last_value::text,'unused')
FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename;
SQL
"$TC_PSQL" -XAt -v ON_ERROR_STOP=1 -d tc_source -f "$TC_PGDIR/fingerprint.sql" >"$TC_PGDIR/before"
started=$SECONDS
PATH="$pgbin:$PATH" PGDATABASE=tc_source BACKUP_DIR="$TC_PGDIR" sh deploy/backup.sh
"$pgbin/pg_restore" -d tc_restored --single-transaction --exit-on-error --no-owner --no-privileges "$TC_PGDIR"/tripcanvas-*.dump
DATABASE_URL="$target_url" npm --prefix next run db:migrate >"$TC_PGDIR/migrate-restored.log" 2>&1 || { cat "$TC_PGDIR/migrate-restored.log"; exit 1; }
"$TC_PSQL" -XAt -v ON_ERROR_STOP=1 -d tc_restored -f "$TC_PGDIR/fingerprint.sql" >"$TC_PGDIR/after"
diff -u "$TC_PGDIR/before" "$TC_PGDIR/after"
echo "PASS 합성 데이터: dump → restore → migrate → 전체 표 내용·시퀀스 일치 ($((SECONDS-started))초)"
echo "운영 덤프·오프사이트 복제·API 로그인/저장·운영 RTO는 검증하지 않았다."
