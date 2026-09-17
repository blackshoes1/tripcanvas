# 관리형 PostgreSQL로 데이터 옮기기

NAS PostgreSQL(원본) → 관리형 PostgreSQL(대상). 설계 배경은 [`managed-infrastructure.md`](managed-infrastructure.md), 당일 순서는
[`production-cutover.md`](production-cutover.md), 되돌리기는 [`disaster-recovery.md`](disaster-recovery.md).

**방식은 정해져 있다: `pg_dump`(custom) → 비어 있는 대상에 `pg_restore` → 마이그레이션을 코드와 맞춤 → 전수 대조.**
Supabase→NAS 때(`backup-restore.md`)와 같은 철학이고 도구만 바뀐다 — 그때는 스키마가 달라 행 단위 이관기(`migrate:import`)가 필요했지만,
이번엔 **같은 스키마의 PostgreSQL 둘**이라 `pg_dump`/`pg_restore`가 그대로 진실을 옮긴다.

## 왜 dual write · 논리 복제가 아닌가

| 방법 | 판단 |
|---|---|
| 짧은 write freeze + 마지막 덤프 | **채택.** 사용자 수 명, 하루 쓰기 수십 건. 정지 창은 분 단위(복원 1초 + 대조 수 초 + 클라이언트 전환). 도구가 전부 있고 리허설로 같은 경로를 밟는다 |
| 논리 복제(logical replication) | NAS 쪽 `wal_level=logical` 재시작 + 퍼블리케이션/구독 + 시퀀스는 복제되지 않아 따로 맞춰야 한다. 정지 창을 초 단위로 줄이지만 그만큼의 가치가 없다 |
| dual write | 두 DB의 divergence를 앱이 관리해야 한다 — 가장 위험한 부분을 새로 만드는 셈. `backup-restore.md`가 이미 같은 이유로 거부했다 |

## 도구

| 명령 | 무엇 |
|---|---|
| `deploy/backup.sh` | `pg_dump --format=custom --no-owner --no-privileges`. `BACKUP_SOURCE_URL`로 원격도 뜬다. `BACKUP_RECORD=0`이면 성공 기록을 남기지 않는다(마지막 덤프용) |
| `scripts/restore-to-target.sh <dump>` | **비어 있는** 대상에만 복원(표가 있으면 거부) → `db:migrate` → `SOURCE_DATABASE_URL`이 있으면 대조까지. 종료 0 PASS · 1 FAIL · 2 대조 못 함 |
| `scripts/verify-db-migration.sh` (`npm --prefix next run verify:db`) | 전수 대조. 아래 표 |
| `scripts/rehearse-restore-managed.sh` | 합성 데이터로 위 경로를 관리형 대상에 끝까지 |

### 전수 대조가 보는 것

`SOURCE_DATABASE_URL`·`TARGET_DATABASE_URL` 두 연결에 `set time zone 'UTC'`와 `select`만 보낸다. 검사마다 PASS/FAIL/SKIP이고 **하나라도 SKIP이면 INCOMPLETE(종료 2)** — 통과가 아니다.

| 그룹 | 검사 |
|---|---|
| `tables` | 표 목록·개수. 대상에만 있는 표는 **비어 있을 때만** 통과(새 마이그레이션) · 원본에만 있으면 FAIL |
| `columns` · `columns.defaults` | 이름·타입·nullable · 기본값/identity |
| `rows` | 표별 행 수 |
| `content` | 표별 `md5(정렬한 to_jsonb(행))` — 공통 컬럼 기준. 한 글자만 달라도 걸린다 |
| `jsonb` | jsonb 컬럼별(문서·prefs·offers…) 건수 + 본문 해시 |
| `revision` | `revision` 컬럼: 행수/최대/합계 |
| `timestamps` | `updated_at`·`created_at`의 max — 대상이 낡았으면 그렇게 말한다 |
| `aggregates` | `role`·`status`·`kind`·`provider`·`reaction` 분포, `deleted_at` 활성/tombstone |
| `constraints` | PK · FK · unique · check 정의 집합, 그리고 **대상의 FK 고아 행** |
| `indexes` | 인덱스 정의 집합 |
| `sequences` | 시퀀스 값 일치 + **다음 삽입이 중복키로 죽지 않는가**(max(id) ≤ 시퀀스) |
| `journal` | `drizzle.__drizzle_migrations`: 원본 ⊆ 대상, 대상 = 저장소 journal |

리포트에 연결 문자열·계정은 없다. 시작할 때 `원본 계정@호스트/DB → 대상 …` 한 줄을 stderr에 찍는다 —
**검증은 "원본이 운영인가"를 묻지 않는다.** 낡은 사본을 가리켜도 조용히 통과한다(2026-09-04에 실제로 그랬다). 그 줄부터 읽는다.

### 리허설에서 배운 것 (2026-09-17, 로컬 PostgreSQL 16 둘로)

- `deploy/backup.sh`는 덤프를 **완성한 뒤** `ops_backup_runs`에 한 행 남긴다. 그 행은 덤프에 없으므로 원본이 대상보다 한 행 많아지고 대조가 **정직하게 실패했다**(`rows.ops_backup_runs 2 ≠ 1`). 그래서 마지막 덤프는 `BACKUP_RECORD=0`으로 뜬다.
- 같은 이유로 **대조하는 동안 원본에 어떤 요청도 들어가면 안 된다.** 읽기 요청도 `users.last_seen_at`과 `auth_rate_limit`을 바꾼다(`pgUserRepository.ensure`). 점검 모드(쓰기만 차단)로는 부족하고, 마지막 덤프 앞에서 옛 API를 **멈춘다**.
- 두 DB의 시각 문자열을 비교하므로 세션 time zone을 맞춘다(스크립트가 한다). PostgreSQL 16↔17처럼 버전이 달라도 `to_jsonb` 문자열은 같았다 — 다만 운영 전환은 **같은 메이저 버전(17)** 으로 간다.

## Phase A — 복원 리허설 (운영을 건드리지 않는다)

전제: 관리형 **staging** DB가 비어 있다. 운영 NAS는 읽기만 한다.

```bash
# 0) 합성 데이터로 경로부터 — 관리형 DB·TLS·계정 권한이 맞는지 여기서 걸린다
TARGET_DATABASE_URL='<staging 직접 주소>' scripts/rehearse-restore-managed.sh      # PASS 여야 한다. 끝나면 staging DB를 비운다(drop/recreate)

# 1) 운영 덤프를 NAS에서 받는다(최신 성공 덤프. 운영 DB에 새 부하를 주지 않는다)
scp -O nas:/volume2/backups/tripcanvas/tripcanvas-<최신>.dump /tmp/ops.dump

# 2) 비어 있는 staging에 복원 + 마이그레이션 + 대조 — 원본은 **그 덤프를 복원한 NAS 사본**이 아니라 운영 NAS(읽기)로 잡아도 된다.
#    다만 덤프 이후 운영이 바뀌었으면 rows/timestamps가 어긋난다 — 그건 도구가 맞는 것이다. 어긋난 표가 '그 사이 쓰인 것'뿐인지 읽는다
SOURCE_DATABASE_URL='<NAS 직접 주소(15432 override)>' TARGET_DATABASE_URL='<staging 직접 주소>' scripts/restore-to-target.sh /tmp/ops.dump
```

- 대상이 비어 있지 않으면 스크립트가 거부한다. **운영에 `--clean`으로 붓는 길은 없다.**
- 마이그레이션 계정과 앱 계정을 갈랐다면 `MIGRATE_DATABASE_URL`도 준다(`db:migrate`가 그것을 먼저 쓴다).
- `SELF_SIGNED_CERT_IN_CHAIN`이 나면 주소에 `?uselibpqcompat=true&sslmode=require`.

통과 기준: `verify:db`가 **PASS**(SKIP 0). 그다음 [`production-cutover.md`](production-cutover.md) Phase B(staging API를 이 DB에 붙여 앱 검증).

## Phase C — 마지막 동기화 (전환 당일)

정지 창을 만드는 것은 이 단계다. 순서와 예상 시간:

| 단계 | 명령 | 예상 |
|---|---|---|
| 1. 점검 모드 | NAS `.env`에 `TC_READ_ONLY=1` → `up -d --force-recreate api`. 웹은 "점검 중이에요 — 잠시 후 자동으로 다시 저장합니다", 편집은 기기에 남는다 | 1분 |
| 2. 옛 API·실시간 정지 | `docker compose stop api realtime backup` — 읽기도 원본을 바꾸므로(위) 대조 전에는 멈춘다 | 10초 |
| 3. 마지막 덤프 | NAS에서 `BACKUP_RECORD=0 sh deploy/backup.sh`(compose `run --rm backup`으로 같은 환경) | 초 단위(운영 60KB급) |
| 4. 복원 + 마이그레이션 + 대조 | 노트북에서 `SOURCE_DATABASE_URL=<NAS 15432> TARGET_DATABASE_URL=<관리형 primary, 비어 있음> scripts/restore-to-target.sh <덤프>` | 1분 |
| 5. 판정 | **PASS가 아니면 전환하지 않는다** — `disaster-recovery.md` Case 3(잘못된 migration) 절차로 옛 스택을 올린다 | — |

정지 창 = 2~5단계 ≈ **5분 안쪽**. 그 사이 웹·앱은 "서버에 닿지 못했어요(편집은 그대로)"이고, 다시 붙으면 revision CAS로 올라간다.

⚠️ 관리형 primary는 **이 시점에 처음 채워진다.** 앞선 리허설로 채운 staging DB를 primary로 승격하지 않는다 — 리허설 데이터가 섞인다.

## 데이터 손실 창

- 마지막 덤프(3단계) 뒤에 원본에 쓰인 것: **없다** — 그 전에 API를 멈췄다.
- 점검 모드(1단계)와 정지 사이에 사용자가 시도한 쓰기: 클라이언트가 들고 있다가 새 API에 재시도한다(웹 15초 주기·iOS는 사람이 다시 누름).
- 따라서 이 절차의 RPO는 0이다. 손실은 **절차를 어기고** 대조 없이 전환했을 때만 생긴다.
