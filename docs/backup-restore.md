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

### 선행 과제: `trip_snapshots` — 해결됨

운영에는 있는데 새 DB에 없어 이관하면 버전 이력이 사라질 뻔했다. 스키마·Repository·API(`/api/v1/trips/:id/snapshots`)를 채웠고
이관 대상에도 들어 있다. 규칙은 운영 그대로다: 사람마다 제 스냅샷, 여행당 최근 15개.

### 리허설 3단계

운영 DB는 리허설 내내 **읽기만** 한다. 쓰는 쪽은 언제나 사본이다.

| | 무엇으로 | 무엇을 잡는가 | 언제 | 상태 |
|---|---|---|---|---|
| **R0** | 합성 데이터 + PGlite | 스크립트 자체 — 순서·시퀀스·트리거·멱등성 | CI에서 매번 | 통과 |
| **R1** | 운영 데이터(읽기 전용) | 실데이터의 이상값 — 깨진 참조·예상 못 한 null·규모와 소요시간 | 스크립트를 고칠 때마다 | **2026-09-04 통과** |
| **R2** | 덤프 복원 + staging 앱 | 복원 경로와 전환 예행 — 로그인·저장·협업이 도는가, 롤백이 되는가 | 전환 직전 1~2회 | 미실시 |

### R1 1차 결과 (2026-09-03) — 운영 조사

운영 DB를 **읽기만** 해서 이상값을 전수로 훑었다. 새 스키마가 운영보다 훨씬 엄격하기 때문에(NOT NULL·CHECK 10여 개·unique),
데이터가 그 제약에 맞는지가 이관 성패를 가른다.

| | 운영 | |
|---|---|---|
| `auth.users` | 3 | email NULL 0 |
| `trips` | 8 | tombstone 3 · revision≤0 0 · (user,client) 중복 0 |
| `trip_snapshots` | 98 | max id 277 |
| `trip_members` | 9 | role `OWNER,EDITOR` · status `ACTIVE` |
| `trip_invites` | 1 | role `EDITOR` · token_hash 중복 0 |
| `trip_activity` | 4 | kind `MEMBER_JOINED,SCHEDULE_CHANGED` |
| `trip_candidates`·`candidate_reactions`·`trip_comments` | 0 | |
| `hotel_price_snapshots` | 33 | |
| `suggestion_feedback`·`device_tokens`·`notification_log`·`trip_memories` | **테이블 없음** | 운영 미적용 — 정상 |

- **위반 0건.** 고아 참조 0 · NOT NULL 위반 0 · CHECK 위반 0 · unique 중복 0. 옮길 데이터 자체는 손댈 것이 없다.
- 전체 153행. 규모로 인한 문제는 없다 — 소요시간은 초 단위다.
- `trip_snapshots` 98건 중 **18건이 지금 `trips`에 없는 (user, client)** 다. 삭제한 여행의 버전 이력이고,
  새 스키마의 `trip_snapshots`에는 `trips` 외래키가 없어(사용자만 참조) 그대로 옮겨진다. 정상이다.
- ⚠️ 스키마가 한 곳 어긋난다: `trip_snapshots.name` 이 운영은 nullable, 새 스키마는 `NOT NULL default ''`.
  오늘은 NULL이 0건이라 걸리지 않지만 **전환 전에 한 건이라도 생기면 이관이 멈춘다.** 전환 직전에 이 조사를 다시 돌린다.

**이 조사로 찾은 진짜 결함은 데이터가 아니라 스크립트였다** — `importAll`이 트랜잭션이 아니어서
중간에 걸리면 앞 테이블이 커밋된 채 남았다. 위 "전부 아니면 전무"가 그 수정이고, R0에 회귀 테스트를 넣었다.

### R1 2차 결과 (2026-09-04) — 실데이터로 예행 통과

NAS(Synology DS920+)에 PostgreSQL 17을 띄우고 **운영 데이터 그대로** 예행했다. `--trial --reset`.

```
183행 (9개 테이블) · 걸린 시간 1초 · 시퀀스 10개 재설정
개수 전수 일치 · 고아 행 7개 검사 모두 0
내용 trips.data · trips.revision · trip_snapshots.data 해시 일치
```

숫자는 9/3 조사와 같고 `trip_activity` 30(당시 4) · `hotel_price_snapshots` 34(33)만 늘었다 — 그 사이 앱을 쓴 만큼이다.
"원본에 없음" 넷도 그대로다. **이 스크립트로 옮기면 데이터가 그대로 온다**는 것이 실물로 확인됐다.

**아직 예행하지 않은 것: 덤프 → 복원 경로.** 아래처럼 운영을 직접 읽었기 때문이다. 그 경로는 R2에서 처음 돌게 된다.

### 추출 — 사본을 만들 것인가, 운영을 직접 읽을 것인가

**이관기는 원본에 절대 쓰지 않는다.** `pgSource.ts`가 원본에 보내는 SQL은 셋뿐이다:
`select to_regclass(...)` · `select id, email from auth.users` · `select * from public.<표>`.
`importer.ts`의 `truncate`는 대상 트랜잭션이다. 그래서 **R1은 `LEGACY_DATABASE_URL`을 운영에 직접 걸어도 안전하다** — 실제로 그렇게 통과했다.

⚠️ 예전에 여기 적혀 있던 `--data-only` 덤프만으로는 **빈 DB에 복원할 수 없다.** CREATE TABLE이 없다.
사본을 만들려면 스키마도 함께 떠야 하고, Supabase 스키마는 `auth.uid()`·`anon`/`authenticated` 역할을 참조하므로
`test/rls/supabase-stub.sql`을 먼저 적용해야 한다. 순서는 **스텁 → schema.sql → public.sql → users.csv**.

```bash
# 전환 당일에 쓸 스냅샷(과 R2의 복원 예행용)
pg_dump "$SUPABASE_DIRECT_URL" --schema-only --schema=public --no-owner --no-privileges -f dump/schema.sql
pg_dump "$SUPABASE_DIRECT_URL" --data-only   --schema=public --no-owner --no-privileges -f dump/public.sql
# 계정은 id·email만 — 해시·메타데이터는 가져오지 않는다(§19)
psql "$SUPABASE_DIRECT_URL" -Atc "copy (select id, email from auth.users) to stdout with csv" > dump/users.csv
```

`SUPABASE_DIRECT_URL`은 셸 히스토리·로그에 남기지 않는다(§58). NAS가 IPv4면 직접 연결(`db.<ref>.supabase.co`)은
IPv6 전용이라 붙지 않는다 — **Session pooler**(`aws-1-<region>.pooler.supabase.com:5432`, 사용자 `postgres.<ref>`)를 쓴다.

### Synology에서 실제로 막힌 곳 (2026-09-04)

전부 한 번씩 겪었다. R2에서 같은 데서 멈추지 않도록 남긴다.

| 증상 | 원인과 처방 |
|---|---|
| `scp: Connection closed` | Synology sshd에 SFTP 서브시스템이 없다. `scp -O`(예전 프로토콜) |
| `.env` 파싱 오류 (`unexpected character in variable name`) | Windows 체크아웃의 CRLF. `.gitattributes`가 `deploy/**`를 `eol=lf`로 고정한다 |
| compose YAML이 안 열림 | `:?` 기본 오류 메시지 안의 콜론. 값을 따옴표로 감싼다 |
| `no pg_hba.conf entry for host "127.0.0.1"` | **DSM 자체 PostgreSQL이 5432를 이미 쓴다.** 다른 포트(15432 등)로 |
| 포트를 열었는데 안 닿음 | Tailscale이 tailnet 트래픽을 NAS의 **localhost로 넘긴다**. `127.0.0.1:15432:5432`로 publish해야 한다 |
| `docker compose port`가 매핑 없음 | `internal: true` 네트워크에만 붙은 컨테이너는 포트를 못 낸다. `networks: [internal, edge]` |
| 비밀번호를 바꿨는데 인증 실패 | `POSTGRES_PASSWORD`는 **볼륨을 처음 만들 때만** 적용된다. `alter user ... with password`로 직접 바꾼다 |
| 컨테이너 이름 충돌 | 남은 컨테이너가 이름을 잡고 있다. `docker compose down` 후 `up -d` (**`-v`는 붙이지 않는다** — 볼륨이 날아간다) |

### 돌리는 방법

**R0**는 테스트다 — 손으로 돌릴 것이 없다.

```bash
cd next && npm test -- src/server/migration     # 이관기·검증·원본 21개 시나리오
```

**R1**은 원본을 가리키고 CLI를 돌린다. 세 단계가 **같은 경로**를 지난다 — 다른 것은 마지막에 커밋하느냐뿐이라, 예행이 통과했는데 당일에 처음 보는 오류가 나지 않는다.

원본은 운영(Session pooler) 또는 복원한 사본 어느 쪽이어도 된다 — 이관기는 원본에 쓰지 않는다(위 "추출").
대상은 NAS의 PostgreSQL이고, 노트북에서 붙으려면 `127.0.0.1:15432`로 publish해 tailnet으로 닿는다.

```bash
cd next && npm run tools:build
read -r -p "Supabase URI: " LEGACY     # 히스토리에 남기지 않는다
read -r -p "NAS DB 비밀번호: " PW
TARGET="postgres://tripcanvas:$PW@<NAS의 tailscale IP>:15432/tripcanvas"

DATABASE_URL="$TARGET" npm run db:migrate                                    # 대상에 스키마
LEGACY_DATABASE_URL="$LEGACY" DATABASE_URL="$TARGET" npm run migrate:import  # 1) 세어만 본다
LEGACY_DATABASE_URL="$LEGACY" DATABASE_URL="$TARGET" npm run migrate:import -- --trial --reset
# 3) 실제로 (전환 당일)
LEGACY_DATABASE_URL=… DATABASE_URL=… npm run migrate:import -- --apply --reset
```

원본과 대상이 같으면 시작하지 않는다. 계정 테이블이 `auth.users`가 아니면 `LEGACY_USERS_TABLE=public.legacy_users`로 알려 준다.

**전부 아니면 전무다.** 이관 전체가 한 트랜잭션이고, **검증도 커밋 전에 같은 트랜잭션 안에서** 돈다.
어긋나면 아무것도 쓰이지 않고 종료 코드가 1이다 — "통과하지 못하면 전환하지 않는다"를 사람이 리포트를 읽고 지키는 대신 도구가 지킨다.
나눠서 커밋하면 14개 테이블 중 7번째에서 걸렸을 때 **반쯤 채워진 DB**가 남고, 그것을 중단 시간에 수습해야 한다.

⚠️ `setval`은 트랜잭션을 따르지 않는다 — 되돌려도 시퀀스 값은 남는다. 그래서 예행에서는 시퀀스를 건드리지 않고 무엇을 맞출지만 보고한다.

### 이관 스크립트가 반드시 다뤄야 할 것

R0가 이 항목들을 전부 테스트로 잡는다(`next/src/server/migration/`). 하나라도 빠지면 전환 후에야 드러난다.

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
