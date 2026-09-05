# NAS 배포 — TripCanvas API

> **2026-09-04 — 프로덕션이 여기다.** 웹(`tripcanvas-ai.vercel.app`)이 부르는 API는 NAS의
> `https://bokbok9.tail8b977f.ts.net` 이고, 데이터는 NAS PostgreSQL이다. Vercel에는 정적 웹만 남았다.
> Vercel의 `tripcanvas-api` 프로젝트는 지우지 않았다 — **롤백 대상**이다(아래 "롤백").

## 공개 주소는 Tailscale Funnel이다 — 도메인이 없다

Vercel 함수는 tailnet 안의 PostgreSQL에 닿을 수 없다. 그래서 API를 NAS에서 돌리는데, 도메인이 없어 Caddy가 인증서를 못 받는다.
**Tailscale Funnel**이 `*.ts.net` 이름에 HTTPS를 붙여 공개해 준다 — TLS는 Tailscale이 끝내고 NAS의 로컬 포트로 넘긴다.

```bash
sudo tailscale funnel --bg 3000                  # /      → api
sudo tailscale funnel --bg --set-path=/ws 3001   # /ws    → realtime 사이드카
sudo tailscale funnel status                     # "Available on the internet:" 확인
```

⚠️ **tailnet 안에서 한 curl은 Funnel을 지나지 않는다** — MagicDNS가 같은 이름을 100.x로 풀어 버린다.
공개 경로는 tailnet 밖(폰의 셀룰러 등)에서 확인해야 한다. 켜자마자 폰에서 "클라우드 동기화 실패"가 났던 것도 이 구간이었다.

⚠️ 가용성이 집 NAS에 걸린다. NAS가 꺼지거나 Tailscale이 끊기면 **저장이 안 된다**(로컬 편집은 보존되고 복구되면 올라간다).

## 구성 (§52~§56)

`deploy/docker-compose.yml`

| 서비스 | 이미지 | 역할 | 노출 |
|---|---|---|---|
| `reverse-proxy` | caddy:2 | HTTPS 자동 발급, `api:3000`으로 전달 | **80·443만 외부** |
| `api` | `next/Dockerfile` (target `runtime`) | Next standalone, `/api/v1/*` · `/api/health` | 내부 3000 |
| `realtime` | `next/Dockerfile` (target `realtime`) | WebSocket 사이드카 `/ws` — pg_notify를 듣고 중계 | 내부 3001 |
| `migrate` | `next/Dockerfile` (target `migrate`) | `drizzle-kit migrate` 일회 실행. 성공해야 `api`가 뜬다 | — |
| `postgres` | postgres:17 | source of truth | 내부 네트워크만(5432 비공개, §54) |
| `backup` | postgres:17 | 매일 `pg_dump` → `BACKUP_DIR` | — |

`internal` 네트워크는 `internal: true`라 인터넷과 단절돼 있다. MinIO·Redis는 필요해질 때 같은 방식으로 붙인다(§46·§47·§55).

### 운영은 파일 하나로 뜬다

```bash
cd ~/tripcanvas
sudo docker compose -f deploy/docker-compose.yml up -d
```

> **2026-09-05 실제 NAS(DS920+, DSM Linux 4.4)에서 검증됐다.** migrate 성공 · postgres·api·realtime healthy ·
> `backup`이 첫 덤프를 씀 · `/api/health` 정상. 그때 드러난 함정은 아래 **NAS의 실제 환경**에 적었다.

override를 겹치지 않는다. Funnel이 넘겨주는 **호스트 루프백 publish(`127.0.0.1:3000`·`3001`)가 운영 compose 안에**
있기 때문이다.

> 2026-09-04~09-05에는 그 publish가 `docker-compose.staging.yml`에만 있어서, 그 파일을 빼고 올리면 Funnel이 닿을 곳이
> 없어 **API가 통째로 죽었다**(폰에서 "클라우드 저장 실패"). 검증용 override가 운영을 떠받치고 있던 것이고,
> 2026-09-05에 publish를 운영 compose로 옮겨 끝냈다.

겹치는 파일은 둘 다 **선택**이고 용도가 다르다:

| override | 언제 | 무엇을 |
|---|---|---|
| `docker-compose.staging.yml` | 복원 리허설·데이터 이관처럼 **DB에 직접 붙어야 할 때만** | postgres를 `127.0.0.1:15432`에 낸다 |
| `docker-compose.caddy.yml` | 도메인 + Caddy로 갈 때 (**오늘은 안 씀**) | 80·443과 reverse-proxy |

⚠️ 예전처럼 두 파일을 겹쳐 올려 둔 상태에서 위 명령으로 바꿀 때는 **남은 컨테이너를 정리한다** —
compose는 파일에서 사라진 서비스를 저절로 지우지 않는다:

```bash
sudo docker compose -f deploy/docker-compose.yml up -d --remove-orphans
sudo docker compose -f deploy/docker-compose.yml ps        # postgres·api·realtime·backup만 남는다
```

`reverse-proxy`가 돌고 있었다면 이때 내려간다. 80·443을 쓰던 것도 함께 풀린다.

## NAS의 실제 환경 — 처음 붙는 사람이 걸리는 것들

여기 적힌 것은 전부 2026-09-05에 실제로 걸렸던 것이다.

| 함정 | 실제 |
|---|---|
| **`~/tripcanvas`는 git 클론이 아니다** | `.git`이 없고 **NAS에 git도 깔려 있지 않다.** `git pull`로 배포할 수 없다 — 파일을 보내야 한다 |
| **비로그인 셸의 PATH가 짧다** | `/usr/bin:/bin:/usr/sbin:/sbin`뿐이라 `docker`가 안 잡힌다. `ssh nas 'docker …'`는 실패하고 **`/usr/local/bin/docker`** 전체 경로를 써야 한다 |
| **docker 그룹이 없다** | 소켓이 `root:root`(`srw-rw----`)다. `synogroup --member docker`는 그룹 자체가 없어 성립하지 않는다 |
| **sudo에 비밀번호가 필요하다** | `administrators` 소속이어도 그렇다. 자동화하려면 `/etc/sudoers.d/`에 NOPASSWD를 두어야 한다 (⚠️ docker 접근은 **사실상 root**다 — 범위 제한은 실수 방지용이지 권한 축소가 아니다) |
| **`visudo`가 없다** | 문법 검사를 건너뛰게 된다. 파일을 쓴 뒤 `sudo -n /usr/local/bin/docker version`으로 실제 동작을 확인한다 |
| **SFTP가 막혀 있다** | 그냥 `scp`는 `Connection closed`로 끊긴다. **`scp -O`**(레거시 프로토콜)를 쓴다 |
| **macOS의 `rsync`는 openrsync다** | `-e` 처리가 달라 ssh 인증이 깨진다. 파일 몇 개면 `scp -O`가 낫다 |
| **볼륨이 둘이다** | DB는 `/volume1/@docker/volumes/...`, 홈은 `/volume2`다. **백업은 반드시 다른 볼륨에** 둔다(§60) |

### 파일 배포

git이 없으므로 맥에서 보낸다:

```bash
scp -O deploy/docker-compose.yml deploy/docker-compose.staging.yml deploy/docker-compose.caddy.yml \
    nas:~/tripcanvas/deploy/
# API 코드를 바꿨으면 해당 소스도 보내고 다시 빌드한다
sudo docker compose -f deploy/docker-compose.yml build api
sudo docker compose -f deploy/docker-compose.yml up -d api
```

`~/.ssh/config`에 별칭을 두면 편하다(`Host nas` / `HostName bokbok9.tail8b977f.ts.net` / `User <계정>`).

⚠️ **`deploy/.env`는 보내지 않는다.** 비밀이 들어 있고 NAS 것이 진실이다.

## 환경변수

`deploy/.env.example` → `deploy/.env`. 비밀은 Git에 올리지 않는다(§58). `api`는 이 파일과 `DATABASE_URL`(compose가 조립)을 받는다.

| 변수 | 뜻 |
|---|---|
| `API_DOMAIN` | **`docker-compose.caddy.yml`을 겹칠 때만.** 오늘의 ingress는 Funnel이라 운영에는 없어도 된다 |
| `POSTGRES_*` | DB 계정 |
| `TC_MIGRATION_TRIP` | 이관 레지스트리. staging은 `NEW_BACKEND`, 프로덕션 전환 전에는 `LEGACY` |
| `NEXT_PUBLIC_SUPABASE_*` · `SUPABASE_JWT_SECRET` | Phase A — Supabase 토큰 검증 |
| `BACKUP_DIR` · `BACKUP_KEEP_DAYS` | 덤프 위치 · 보관 일수. ⚠️ **DB와 다른 볼륨**이어야 한다 — DB는 `/volume1`에 있으므로 `/volume2/...`를 쓴다(§60) |

## 처음 띄울 때

```bash
cp deploy/.env.example deploy/.env      # 값 채우기
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs migrate     # "[✓] migrations applied" 류의 성공 로그
# 공개 주소는 Funnel의 ts.net 이름이다(도메인 아님) — tailnet 밖에서 확인할 것(§7)
curl -s https://bokbok9.tail8b977f.ts.net/api/health                        # {"ok":true,"api":"ok","database":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://bokbok9.tail8b977f.ts.net/api/v1/trips   # 401 — 정상(인증 요구)
```

확인 순서: `migrate`가 성공했는가 → `api` healthcheck가 healthy인가 → 401이 오는가 → 실제 Supabase 토큰으로 `/api/v1/trips`가 200인가 → `realtime` 헬스가 `LISTENING`인가.

⚠️ 실시간 헬스가 `RECONNECTING`이면 **503**이다. 끊긴 LISTEN은 오류를 내지 않고 이벤트만 영원히 안 오므로, 이 값을 모니터링에 넣는다.

## 빌드 주의

- 컨텍스트는 **저장소 루트**다(`context: ..`) — 판단 엔진(`adaptive.js` 등)이 루트에 있어 `next/`만으로는 빌드가 안 된다(Vercel의 "Include files outside root"와 같은 이유).
- `TC_STANDALONE=1`일 때만 `output: 'standalone'`. `outputFileTracingRoot`가 루트라 standalone 안 경로가 `next/server.js`다.
- `migrate` 타깃은 devDependencies(drizzle-kit)를 포함한 빌드 스테이지를 그대로 쓴다 — 런타임 이미지에는 싣지 않는다.
- Alpine 이미지에 `wget`이 있어 healthcheck에 쓴다.

## 프로덕션 전환 순서 (§101)

```
NAS Backend 완성 ✓ → staging 검증 ✓ → 데이터 이관 리허설 ✓(docs/backup-restore.md) → Web staging ✓ → iOS staging ✓(TCApiBaseURL — 2026-09-04, docs/staging-verification.md)
→ 실사용 테스트 → 프로덕션 DB 이관 → TC_MIGRATION_TRIP=NEW_BACKEND → Supabase read-only → 관찰 → Supabase 종료(일정 기간 보존, §102)
```

## 롤백 (2026-09-04 전환 기준)

전환 스위치는 **웹의 API 주소 두 줄**이다(`api.js`·`auth.js`의 `DEFAULT_BASE`). Vercel의 `tripcanvas-api`는 살아 있고 여전히 Supabase를 본다.

```
DEFAULT_BASE 를 https://tripcanvas-api.vercel.app 로 되돌리고 → main 푸시 → Vercel 재배포 (약 1분)
```

⚠️ 되돌리는 순간 **전환 후 NAS에 쌓인 변경은 사라진다**(Supabase에 없다). 그래서 관찰 기간에는 Supabase를 읽기전용으로 만들지 않고, 되돌릴 일이 생기면 NAS 쪽 변경을 먼저 확인한다(§79·§80).
NAS 안에서의 되돌리기(`TC_MIGRATION_*=LEGACY` + `api` 재시작)는 API가 다시 Supabase를 보게 하는 것이라 데이터를 잃지 않지만, 그때는 NAS를 거칠 이유가 없다.

## 아직 없는 것

- MinIO — Phase 7(현재 필요 없음)
- 오프사이트 백업 복제 — NAS 쪽 설정(Hyper Backup 등). `docs/backup-restore.md`
