#!/usr/bin/env bash
# 원본 PostgreSQL과 대상 PostgreSQL이 **같은가**를 판정한다(호스팅 이전 · 복원 리허설). docs/managed-db-migration.md.
#
#   SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… scripts/verify-db-migration.sh [--ignore=t1,t2] [--json]
#
# 표 목록·컬럼·행 수·내용(md5)·jsonb·revision·시각·집계·PK/FK/unique/check·인덱스·시퀀스·마이그레이션 journal을
# 전수로 비교하고 검사마다 PASS/FAIL/SKIP을 찍는다. 종료 코드 0 PASS · 1 FAIL · 2 INCOMPLETE(SKIP 있음).
# **SKIP은 통과가 아니다.** 어느 쪽에도 쓰지 않는다. 연결 문자열은 출력하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL(원본)이 필요하다}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL(대상)이 필요하다}"
if [ ! -d next/node_modules ]; then echo "next/node_modules 없음 — npm --prefix next ci" >&2; exit 2; fi
# tsc는 오류를 stdout에 찍는다 — 조용히 삼키지 않고 실패했을 때만 그대로 보여 준다
if ! out=$(npm --prefix next run tools:build 2>&1); then printf '%s\n' "$out" >&2; exit 1; fi
cd next && exec node dist-tools/server/migration/verifyDbMain.js "$@"
