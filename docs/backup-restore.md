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

## Supabase → 새 PostgreSQL 데이터 이관 (Phase 10 리허설의 뼈대)

아직 스크립트가 없다(다음 단계). 원칙만 적어 둔다:

- Supabase에서 `trips` · `trip_members` · `auth.users(id,email)`를 내보내고 **id를 그대로** 넣는다(`users.id` = Supabase user id, `trips.id` uuid 그대로). 외래키·소유권이 안 깨진다(§13).
- 이관 뒤 검증(§79·§80): 사용자 수 · 여행 수(삭제 포함/제외) · 멤버 수 · 여행별 `(client_id, revision)` 쌍이 양쪽에서 같은가 · 임의 표본의 `data` jsonb가 같은가.
- 검증이 통과한 뒤에만 `TC_MIGRATION_TRIP=NEW_BACKEND`. Supabase는 read-only로 일정 기간 보존한다(§102).
