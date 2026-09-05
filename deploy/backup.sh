#!/bin/sh
# 매일 pg_dump(§59~§61). 압축 custom 포맷 — pg_restore로 되돌린다. 복구 절차와 리허설은 docs/backup-restore.md.
#
# ⚠️ **실패는 반드시 시끄러워야 한다.** 조용히 멈춘 백업이 가장 위험하다 —
#    없다는 걸 필요한 순간에 처음 알게 된다. 그래서 실패하면 아무것도 "wrote"라고 말하지 않고 1로 끝난다.
set -eu

# 재부팅 직후에는 postgres가 아직 안 떠 있다. compose의 depends_on(service_healthy)은
# **데몬 재시작에는 적용되지 않아서**, 부팅 때 이 컨테이너가 DB보다 먼저 뜬다(2026-09-05에 실제로 그랬다).
i=0
until pg_isready -q 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[backup] postgres를 5분 기다렸지만 응답이 없다 — 이번 회차를 건너뛴다" >&2
    exit 1
  fi
  sleep 5
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/backups/tripcanvas-${STAMP}.dump

# ⚠️ `pg_dump … && mv …`로 쓰면 set -e가 걸리지 않는다(&& 목록의 실패는 '검사된' 것으로 친다).
# 그래서 예전에는 덤프가 실패해도 그 아래 echo가 그대로 돌아 "wrote"라고 거짓말했다.
if ! pg_dump --format=custom --no-owner --no-privileges --file="$OUT.tmp"; then
  rm -f "$OUT.tmp"
  echo "[backup] pg_dump 실패 — 덤프를 남기지 않았다" >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"
echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# 지난 회차가 남긴 찌꺼기(.tmp)와 보관 기간이 지난 덤프 정리.
# .tmp는 완성되지 않은 파일이라 백업이 아니다 — 오프사이트로 복제되지 않게 치운다.
find /backups -name 'tripcanvas-*.dump.tmp' -mmin +60 -delete
find /backups -name 'tripcanvas-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
