#!/bin/sh
# 매일 pg_dump(§59~§61). 압축 custom 포맷 — pg_restore로 되돌린다. 복구 절차와 리허설은 docs/backup-restore.md.
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/backups/tripcanvas-${STAMP}.dump
pg_dump --format=custom --no-owner --no-privileges --file="$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"
# 보관 기간이 지난 덤프 정리
find /backups -name 'tripcanvas-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
