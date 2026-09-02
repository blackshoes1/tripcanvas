#!/usr/bin/env bash
# 로컬 PostgreSQL로 마이그레이션·RLS를 실제로 돌려 보기 위한 1회용 클러스터.
#
#   scripts/pg-local.sh start   # 클러스터를 만들고 띄운다 (소켓: $TC_PGDIR, 포트: $TC_PGPORT)
#   scripts/pg-local.sh stop
#   scripts/pg-local.sh env     # 테스트가 읽는 환경변수를 출력한다 (eval "$(scripts/pg-local.sh env)")
#
# Supabase가 아니다 — auth.uid()·anon/authenticated 역할·pgcrypto만 흉내 낸 대역(test/rls/supabase-stub.sql)이다.
# 그래도 "RLS가 다른 사용자의 여행을 정말 막는가"는 진짜 PostgreSQL이 판정한다(§94).
# 운영 DB에 적용하는 절차는 docs/supabase-migrations.md.
set -euo pipefail

TC_PGDIR="${TC_PGDIR:-/tmp/tripcanvas-pg}"
TC_PGPORT="${TC_PGPORT:-5499}"
PGBIN="${TC_PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@17/bin; do
    if [ -x "$d/initdb" ]; then PGBIN="$d"; fi
  done
fi
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "PostgreSQL 바이너리(initdb)를 찾지 못했다 — TC_PGBIN=/path/to/bin 으로 알려 주거나 설치할 것" >&2
  exit 2
fi

case "${1:-}" in
  start)
    mkdir -p "$TC_PGDIR"
    if [ ! -f "$TC_PGDIR/data/PG_VERSION" ]; then
      "$PGBIN/initdb" -D "$TC_PGDIR/data" -U postgres --auth=trust -E UTF8 --locale=C >"$TC_PGDIR/initdb.log" 2>&1
    fi
    "$PGBIN/pg_ctl" -D "$TC_PGDIR/data" -l "$TC_PGDIR/server.log" -w \
      -o "-p $TC_PGPORT -k $TC_PGDIR -c listen_addresses=''" start >/dev/null
    echo "postgres 준비됨: TC_PGHOST=$TC_PGDIR TC_PGPORT=$TC_PGPORT TC_PSQL=$PGBIN/psql"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$TC_PGDIR/data" -m fast stop >/dev/null 2>&1 || true
    ;;
  env)
    echo "export TC_PGHOST=$TC_PGDIR TC_PGPORT=$TC_PGPORT TC_PSQL=$PGBIN/psql"
    ;;
  *)
    echo "usage: $0 start|stop|env" >&2; exit 2;;
esac
