#!/bin/sh
# 매일 pg_dump(§59~§61). 압축 custom 포맷 — pg_restore로 되돌린다. 복구 절차와 리허설은 docs/backup-restore.md.
#
# ⚠️ **실패는 반드시 시끄러워야 한다.** 조용히 멈춘 백업이 가장 위험하다 —
#    없다는 걸 필요한 순간에 처음 알게 된다. 그래서 실패하면 아무것도 "wrote"라고 말하지 않고 1로 끝난다.
#
# 어디를 덤프하는가: BACKUP_SOURCE_URL(원격 — 관리형 DB의 오프사이트 사본을 NAS가 당겨 올 때)이 있으면 그것,
# 없으면 PG* 환경(compose의 postgres). **주소는 절대 출력하지 않는다.**
set -eu

SOURCE="${BACKUP_SOURCE_URL:-}"
DEST="${BACKUP_DESTINATION:-nas}"
case "$DEST" in *[!a-z0-9_-]*|"") DEST=nas ;; esac

# 재부팅 직후에는 postgres가 아직 안 떠 있다. compose의 depends_on(service_healthy)은
# **데몬 재시작에는 적용되지 않아서**, 부팅 때 이 컨테이너가 DB보다 먼저 뜬다(2026-09-05에 실제로 그랬다).
i=0
until pg_isready -q ${SOURCE:+-d "$SOURCE"} 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[backup] postgres를 5분 기다렸지만 응답이 없다 — 이번 회차를 건너뛴다" >&2
    exit 1
  fi
  sleep 5
done

STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=${BACKUP_DIR:-/backups}
OUT=$BACKUP_DIR/tripcanvas-${STAMP}.dump

# ⚠️ `pg_dump … && mv …`로 쓰면 set -e가 걸리지 않는다(&& 목록의 실패는 '검사된' 것으로 친다).
# 그래서 예전에는 덤프가 실패해도 그 아래 echo가 그대로 돌아 "wrote"라고 거짓말했다.
if ! pg_dump ${SOURCE:+"$SOURCE"} --format=custom --no-owner --no-privileges --file="$OUT.tmp"; then
  rm -f "$OUT.tmp"
  echo "[backup] pg_dump 실패 — 덤프를 남기지 않았다" >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"
echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# 성공 기록 — /api/health가 백업 최신성을 여기서 읽는다(ops_backup_runs, 마이그레이션 0011).
# 기록 실패는 백업 실패가 아니다(덤프는 이미 완성됐다) — 그러나 조용히 넘기지 않고 stderr에 남긴다.
SIZE=$(wc -c < "$OUT" | tr -d ' ')
# BACKUP_RECORD=0 이면 기록하지 않는다 — 전환 당일의 **마지막 덤프**처럼 "덤프 뒤에 원본이 한 글자도 바뀌면 안 되는" 때.
# 기록 한 행이 원본에만 남으면 전수 대조(verify:db)가 정직하게 실패한다.
if [ "${BACKUP_RECORD:-1}" = "0" ]; then
  echo "[backup] BACKUP_RECORD=0 — 성공 기록을 남기지 않는다(원본을 건드리지 않는 덤프)"
elif command -v psql >/dev/null 2>&1; then
  if ! psql ${SOURCE:+"$SOURCE"} -X -q -v ON_ERROR_STOP=1 \
      -c "insert into ops_backup_runs(started_at, finished_at, ok, bytes, destination) values ('$STARTED', now(), true, $SIZE, '$DEST')" >/dev/null 2>&1; then
    echo "[backup] 성공 기록(ops_backup_runs)을 남기지 못했다 — 덤프는 완성됐다. 스키마가 0011 이상인지 확인할 것" >&2
  fi
else
  echo "[backup] psql이 없어 성공 기록(ops_backup_runs)을 남기지 못했다" >&2
fi

# 지난 회차가 남긴 찌꺼기(.tmp)와 보관 기간이 지난 덤프 정리.
# .tmp는 완성되지 않은 파일이라 백업이 아니다 — 오프사이트로 복제되지 않게 치운다.
find "$BACKUP_DIR" -name 'tripcanvas-*.dump.tmp' -mmin +60 -delete
find "$BACKUP_DIR" -name 'tripcanvas-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
