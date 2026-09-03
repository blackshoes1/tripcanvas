# 백업과 복구 (§59~§61)

백업이 있다고 끝이 아니다 — **복구해 본 백업만 백업이다.**

## 무엇을

| 대상 | 방법 | 주기 |
|---|---|---|
| PostgreSQL | `deploy/backup.sh` — `pg_dump --format=custom` → `BACKUP_DIR/tripcanvas-<UTC>.dump` | 매일(`backup` 컨테이너), `BACKUP_KEEP_DAYS` 보관 |
| PostgreSQL 볼륨 | NAS 스냅샷 | NAS 설정 |
| 오프사이트 | `BACKUP_DIR`를 외부(클라우드/다른 NAS)로 복제 | NAS 설정(Hyper Backup 등) |
| 비밀 | `deploy/.env` — 별도 비밀 관리(백업 볼륨에 평문으로 두지 않는다) | 변경 시 |

`BACKUP_DIR`는 **DB 볼륨과 다른 곳**이어야 한다(§60). 같은 디스크 한 개가 죽으면 둘 다 잃는다.

## 복구

```bash
# 1. 새 PostgreSQL(같은 메이저 버전)
docker compose -f deploy/docker-compose.yml up -d postgres
# 2. 최신 덤프 복원 (--clean: 기존 객체 정리, --if-exists: 처음이어도 오류 없이)
docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_restore -U tripcanvas -d tripcanvas --clean --if-exists --no-owner --no-privileges < backups/tripcanvas-<UTC>.dump
# 3. 마이그레이션 — 덤프가 옛 스키마면 여기서 따라잡는다
docker compose -f deploy/docker-compose.yml run --rm migrate
# 4. 무결성 확인
docker compose -f deploy/docker-compose.yml exec postgres psql -U tripcanvas -d tripcanvas -c \
  "select (select count(*) from users) users, (select count(*) from trips where deleted_at is null) trips, (select count(*) from trip_members where status='ACTIVE') members;"
curl -s https://$API_DOMAIN/api/health
```

## 복구 리허설 (§61) — 분기마다, 그리고 데이터 이관 직전에

1. 어제 덤프를 **별도 컨테이너**(예: `postgres-rehearsal`)에 복원한다.
2. `migrate`를 그 DB에 돌린다.
3. 아래 숫자를 운영과 비교한다: `users` · `trips`(삭제 제외) · `trip_members`(ACTIVE) · 여행별 `revision` 최댓값.
4. 임의 사용자 하나의 여행을 `/api/v1/trips`로 읽어 문서가 열리는지 본다(레지스트리 `NEW_BACKEND`, staging 토큰).
5. 걸린 시간을 기록한다 — 그것이 RTO다.

## Supabase → 새 PostgreSQL 데이터 이관과 리허설 (Phase 10)

전환 방식은 정해져 있다: **추출은 `pg_dump` 직접 연결, 전환 시점에는 앱을 완전히 내린다.**
전면 중단이 가능하므로 증분 동기화(dual write)를 만들지 않는다 — divergence 위험이 가장 큰 부분이 통째로 사라진다(§33).

### ⚠️ 선행 과제: `trip_snapshots`

운영에는 있고 새 DB에는 **없다**. 웹의 여행 버전 이력(여행당 15개, `app.js`·`tripSnapshots.ts`)이 이 테이블에 산다.
지금 이관하면 사용자의 버전 이력이 사라진다. **스키마·Repository·저장/조회 경로를 먼저 채운 뒤에** 리허설을 시작한다.

### 리허설 3단계

운영 DB는 리허설 내내 **읽기만** 한다. 쓰는 쪽은 언제나 사본이다.

| | 무엇으로 | 무엇을 잡는가 | 언제 |
|---|---|---|---|
| **R0** | 합성 데이터 + PGlite | 스크립트 자체 — 순서·시퀀스·트리거·멱등성 | CI에서 매번 |
| **R1** | 운영 스냅샷 사본 | 실데이터의 이상값 — 깨진 참조·예상 못 한 null·규모와 소요시간 | 스크립트를 고칠 때마다 |
| **R2** | R1 결과 + staging 앱 | 전환 예행 — 로그인·저장·협업이 실제로 도는가, 롤백이 되는가 | 전환 직전 1~2회 |

### 추출

```bash
# 운영 Supabase(직접 연결). 읽기만 한다
pg_dump "$SUPABASE_DIRECT_URL" --data-only --schema=public --no-owner --no-privileges -f dump/public.sql
# 계정은 id·email만 — 해시·메타데이터는 가져오지 않는다(§19)
psql "$SUPABASE_DIRECT_URL" -Atc "copy (select id, email from auth.users) to stdout with csv" > dump/users.csv
```

`SUPABASE_DIRECT_URL`은 셸 히스토리·로그에 남기지 않는다(§58).

### 이관 스크립트가 반드시 다뤄야 할 것

R0가 이 항목들을 전부 테스트로 잡는다. 하나라도 빠지면 전환 후에야 드러난다.

1. **identity 시퀀스 재설정.** 협업·adaptive 테이블(`trip_members`·`trip_invites`·`trip_candidates`·`candidate_reactions`·`trip_comments`·`trip_activity`·`suggestion_feedback`·`device_tokens`·`notification_log`)이 자동 증가 id를 쓴다. 기존 id를 그대로 넣은 뒤 `setval`을 하지 않으면 **전환 후 첫 쓰기가 중복키로 죽는다.**
2. **알림 트리거 끄기.** `trip_activity` import는 행마다 `pg_notify`를 쏜다(마이그레이션 0004). import 동안 `alter table trip_activity disable trigger tc_notify_activity`, 끝나면 되돌린다.
3. **FK 순서**: `users → trips → trip_members → trip_invites → trip_candidates → candidate_reactions → trip_comments → trip_activity → trip_snapshots → (adaptive·pricing)`.
4. **운영에 없는 테이블 3개.** `suggestion_feedback` · `device_tokens`/`notification_log` · `trip_memories`는 운영에 적용돼 있지 않다(2026-09-02 확인). 원본이 비어 있는 것이 정상이므로 스크립트는 **"없음"과 "실패"를 구분**해야 한다.
5. **`auth.users` → `users`**: `id`를 그대로 보존하고 `email`만 옮긴다. `auth_user_id`는 null — 각자 새 Auth로 가입해 이메일을 확인할 때 이어진다(§13·§19).
6. **멱등성**: 두 번 돌려도 같은 결과여야 R1을 반복할 수 있다.

### 검증 스크립트가 리허설의 본체다 (§79·§80)

"돌았다"가 아니라 **"같다"**를 판정한다. 표본이 아니라 전수로 본다.

| 검사 | 방법 |
|---|---|
| 개수 | 테이블별 행 수를 양쪽에서 세어 비교 |
| 관계 무결성 | 고아 행 0 — 멤버→여행, 반응→후보, 코멘트→후보, 여행→사용자 |
| 내용 동일성 | 여행별 `(client_id, revision)` 쌍 집합 + `data` jsonb 해시 집계 비교 (한 글자만 달라도 걸린다) |
| 소유권 | `trips.user_id` 집합이 전부 `users.id`에 있는가 |

결과는 사람이 읽는 리포트로 남긴다. **통과하지 못하면 전환하지 않는다**는 기준선이다.

### 전환 당일 순서

```
공지 → 앱 내리기(정적 웹·API) → pg_dump → import → 검증 스크립트 통과 확인
→ TC_MIGRATION_* 전환 → 앱 올리기 → 실사용 확인(로그인·여행 열기·저장·협업)
```

되돌리기: `TC_MIGRATION_*`를 `LEGACY`로 되돌리고 앱 재시작. 그 사이 새 DB에 쌓인 변경은 버린다.
**관찰 기간에는 Supabase를 읽기전용으로 만들지 않는다** — 되돌릴 여지를 남긴다. 관찰이 끝난 뒤에 read-only → 종료 순서다(§102).
