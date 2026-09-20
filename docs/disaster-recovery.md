# 장애 복구와 롤백 (관리형 인프라)

전제 구조는 [`managed-infrastructure.md`](managed-infrastructure.md) §3. 여기서는 **무엇이 죽었을 때 무엇을 누르는가**만 적는다.
각 케이스는 같은 여섯 칸이다: 발동 조건 · 운영자 명령 · 기대 결과 · 데이터 손실 창 · 확인 · 앞으로 가는 복구.

원칙 셋:

1. **되돌리는 것과 앞으로 가는 것 중 데이터를 덜 잃는 쪽을 고른다.** 관리형 primary에 쌓인 변경은 NAS에 없다 — cutover 뒤의 "옛 주소로 되돌리기"는 그 변경을 버리는 결정이다.
2. **덮어쓰지 않는다.** 복원은 언제나 비어 있는 DB에 하고(`restore-to-target.sh`가 거부한다), 대조(`verify:db`)가 PASS일 때만 트래픽을 옮긴다.
3. **조용히 실패하지 않는다.** 503은 클라이언트가 편집을 지키고 재시도하는 신호다. 404와 빈 200이 위험하다(`managed-infrastructure.md` §2).

## 백업 전략과 목표

| | |
|---|---|
| 사본 1 | provider 스냅샷/PITR — 같은 장애 도메인(그 provider) |
| 사본 2 | NAS의 독립 `pg_dump`(`docker-compose.backup-only.yml`, 기본 6시간, `BACKUP_KEEP_DAYS` 30일) — 다른 장애 도메인(집) |
| 사본 3(선택) | NAS의 `BACKUP_DIR`를 오브젝트 스토리지로 복제(Hyper Backup 등) — 집이 통째로 사라지는 경우 |
| **RPO** | PITR이 있으면 분 단위, 없으면 NAS 덤프 주기(≤ 6시간). 목표를 사람이 정한다 — 기본안 **6시간** |
| **RTO** | 새 DB 만들기 + `restore-to-target.sh`(운영 60KB급은 초 단위) + 런타임 `DATABASE_URL` 교체·재시작 + 확인 ≈ **1시간 안쪽**(리허설 시간을 적어 갱신) |
| 보관 | provider 정책 + NAS 30일 |
| 암호화 | 전송은 TLS(`sslmode=require`). NAS 디스크 암호화·오프사이트 복제의 암호화는 NAS 설정 |
| 검증 | **복구해 본 백업만 백업이다** — 주 1회 `restore-to-target.sh`를 빈 임시 DB에 + `verify:db`. `/api/health`의 `backup`이 26시간 안의 성공 기록을 본다 |

## Case 1 — 관리형 API 장애, DB 정상

| | |
|---|---|
| 발동 | `/api/health-watch` 503 UNAVAILABLE 이고 provider 콘솔에서 DB는 정상. 또는 배포 직후 앱이 뜨지 않음 |
| 명령 | ① 직전 이미지로 롤백: `fly releases --app <api>` → `fly deploy --image <직전>` (provider의 동등 명령). ② 런타임 자체가 죽었으면 **NAS 프록시 모드**: NAS `.env`의 `DATABASE_URL`을 관리형 직접 주소로, `TC_READ_ONLY` 해제, `up -d api realtime`(postgres 컨테이너는 올리지 않는다) → 웹 `DEFAULT_BASE`를 NAS 주소로 되돌려 재배포 |
| 기대 | ①은 1~2분. ②는 웹 재배포 포함 5분. 데이터는 그대로 관리형 primary |
| 손실 창 | **0** — DB가 살아 있다. 장애 시간 동안의 편집은 클라이언트가 들고 있다가 올린다 |
| 확인 | `/api/health` HEALTHY · 로그인 유지 · 저장 revision 증가 · `/api/health-watch` HEALTHY |
| 앞으로 | 원인을 고친 이미지를 staging에 먼저 → 관리형에 재배포 → 웹을 다시 관리형 주소로. NAS 프록시 모드는 내린다 |

## Case 2 — 관리형 DB 장애

| | |
|---|---|
| 발동 | `/api/health` `database: error`(503) 가 provider 장애 공지·재시작으로 수 분 안에 풀리지 않을 때 |
| 명령 | ① provider PITR/스냅샷 복원으로 **새 인스턴스**를 만든다(원본은 두고). ② 그것이 안 되면 NAS 최신 덤프로: `TARGET_DATABASE_URL=<새 빈 DB> scripts/restore-to-target.sh <NAS 최신 덤프>`(대조는 원본이 죽어 SKIP → 종료 2 — 그 사실을 적는다). ③ 런타임의 `DATABASE_URL`·`REALTIME_DATABASE_URL`·`MIGRATE_DATABASE_URL`을 새 DB로 → 재시작. ④ 그것도 안 되면 NAS 스택 전체 기동(`docker-compose.yml`, postgres 포함)에 ②의 덤프를 붓고 웹을 NAS 주소로 |
| 기대 | ①은 RPO 분 단위. ②는 RPO ≤ 덤프 주기(6시간) |
| 손실 창 | 마지막 복구 지점 이후의 쓰기. **말해야 한다** — 사용자에게 "몇 시 이후 저장이 돌아갔을 수 있다" |
| 확인 | `verify:db`는 원본이 없어 못 한다 → 대신 `journal.target=repo` PASS, 표별 행 수가 마지막 리허설 기록과 비슷한지, 로그인·목록·저장 |
| 앞으로 | 새 인스턴스를 primary로 확정 → NAS 백업의 `BACKUP_SOURCE_URL` 갱신 → 첫 덤프 · `ops_backup_runs` 기록 확인 |

## Case 3 — 잘못된 마이그레이션 (cutover 당일 대조 실패 포함)

| | |
|---|---|
| 발동 | `restore-to-target.sh`/`verify:db`가 FAIL·INCOMPLETE. 또는 배포 뒤 API 오류율 상승과 `journal` 불일치 |
| 명령 | **cutover 중이면**: 트래픽을 옮기지 않았으므로 NAS를 되살린다 — `.env`에서 `TC_READ_ONLY` 제거 → `up -d api realtime backup` → 관리형 primary는 `drop database` 후 재생성(리허설 자료를 남기지 않는다). **운영 중이면**: git revert가 DB를 되돌리지 않는다 — 호환 forward migration을 만든다(`deployment-workflow.md`). 데이터가 깨졌으면 Case 2 ①(PITR로 마이그레이션 직전 시점) |
| 기대 | cutover 중: 5분 안에 NAS 원상복구, 손실 0. 운영 중: forward migration 배포 |
| 손실 창 | cutover 중 0. 운영 중 PITR 시점 이후 |
| 확인 | NAS `/api/health` HEALTHY(`readOnly: false`) · 저장 됨 |
| 앞으로 | 실패한 검사 줄을 그대로 issue에 붙인다. 스키마 차이면 마이그레이션을, 데이터 차이면 덤프 시점을 의심한다 |

## Case 4 — Auth 문제 (로그인·세션)

| | |
|---|---|
| 발동 | 전환 뒤 전원이 로그아웃 상태거나 401 폭증. 메일 링크가 엉뚱한 호스트 |
| 명령 | 순서대로 확인: ① `AUTH_SECRET`이 NAS 운영 값과 같은가(다르면 모든 세션 서명이 어긋난다 — 같은 값으로 교체·재시작, 세션은 DB에 그대로 있어 되살아난다) ② `API_BASE_URL`이 새 공개 주소인가 ③ `TRUSTED_ORIGINS`에 `https://tripcanvas-ai.vercel.app`이 있는가(CORS 실패는 브라우저에 '네트워크 오류'로 보인다) ④ `WEB_BASE_URL` ⑤ 실시간 앱의 `AUTH_SECRET`도 같은가 |
| 기대 | 설정 교체 + 재시작(1~2분)으로 복구. 사용자 재로그인 없음 |
| 손실 창 | 0(세션·계정은 DB). 단 ①을 잘못 바꿔 새 값으로 로그인한 사용자가 있었다면 그 세션은 원래 값으로 돌아갈 때 끊긴다 — 재로그인 안내 |
| 확인 | 시크릿 창에서 로그인 · `get-session` 200 · 재설정 메일 링크 호스트 |
| 앞으로 | 위 다섯 값을 `production-cutover.md` 준비 절에 체크리스트로 유지 |

## Case 5 — 실시간만 장애

| | |
|---|---|
| 발동 | `/api/health` DEGRADED + `components.realtime: error`, 또는 `/api/health-watch` `degradedReasons: ["realtime"]`. 앱은 정상 |
| 명령 | 급하지 않다 — 새벽에 하지 않는다. ① 사이드카 재시작 ② `REALTIME_DATABASE_URL`이 **직접** 주소인지(풀러면 LISTEN이 조용히 죽는다) ③ `/health`의 `listener` ④ 그래도 안 되면 `REALTIME_URL`을 비워 재시작 — `/api/v1/me`가 `NONE`을 주고 클라이언트가 "새로고침으로 갱신"으로 정직하게 전환한다 |
| 기대 | 사용자 영향: 갱신이 자동이 아니라 새로고침. 저장·협업은 그대로 |
| 손실 창 | 0 |
| 확인 | `components.realtime ok` · 두 창 갱신 |
| 앞으로 | 원인이 풀러면 직접 주소로 고정. 반복되면 재접속 간격(2초 고정)에 백오프를 넣는다 |

## Case 6 — 클라이언트가 새 endpoint에 붙지 못함

| | |
|---|---|
| 발동 | 전환 뒤 웹 콘솔 CORS/네트워크 오류, 옛 iOS 앱 "클라우드 저장 실패", 특정 망(회사·해외 통신사)에서만 실패 |
| 명령 | 웹: `TRUSTED_ORIGINS`(Case 4 ③) → 그래도 안 되면 `DEFAULT_BASE`를 NAS 주소로 되돌려 재배포하되 **NAS는 프록시 모드**(Case 1 ②)여야 데이터가 갈라지지 않는다. iOS 옛 앱: NAS 프록시 모드가 살아 있는 한 정상 — 내렸다면 다시 올린다. 새 앱: 새 빌드의 `TCApiBaseURL` 오타·ATS(`http`) 확인 |
| 기대 | 두 주소가 **같은 DB**를 보므로 어느 주소로 붙어도 데이터는 하나 |
| 손실 창 | 0. 붙지 못한 동안의 편집은 클라이언트에 남는다 |
| 확인 | 두 주소 모두 `/api/health` HEALTHY · 같은 계정으로 양쪽에서 같은 여행 |
| 앞으로 | 도메인이 있으면 이 케이스가 사라진다(주소가 provider와 독립) — `managed-infrastructure.md` §7 |

## cutover 전체를 되돌리기 (관찰 기간 중)

관리형 → NAS로 완전히 돌아가야 한다면(예: provider 비용·정책 문제):

1. 관리형 API를 `TC_READ_ONLY=1`로 → 옛 API·실시간 정지와 같은 이유로 **런타임 정지**
2. 관리형 primary를 `deploy/backup.sh`(`BACKUP_SOURCE_URL`, `BACKUP_RECORD=0`)로 덤프
3. NAS의 postgres 볼륨은 **cutover 시점 것이라 낡았다** — 새 볼륨(또는 `drop database` 후 재생성)에 `restore-to-target.sh` → `verify:db`(원본 = 관리형, 읽기) PASS
4. NAS `.env`의 `DATABASE_URL`을 로컬 postgres로 되돌리고 스택 전체 기동 → 웹 `DEFAULT_BASE` → 감시 `TC_WATCH_BASE` → iOS는 새 릴리스
5. 손실 창 0(2단계 전에 쓰기를 막았다)

이것이 "예전 주소로 바꾸면 된다"가 아닌 이유다 — **데이터가 관리형에 있고, 그것을 먼저 가져와야** 주소를 바꿀 수 있다.
