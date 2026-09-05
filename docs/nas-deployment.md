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

## Funnel — 외부 경로가 죽으면 아무도 모른다

**2026-09-05에 실제로 죽어 있었다.** tailnet 안에서는 전부 정상으로 보였고, 폰(LTE)으로 눌러 보고서야 알았다.

### 왜 안 보였나

- `tailscale status`·`funnel status`·`/api/health` 모두 정상이었다. **설정이 맞아도 인그레스 등록이 끊길 수 있다.**
- ⚠️ **tailnet 안에서 한 curl은 Funnel을 지나지 않는다.** MagicDNS가 같은 이름을 100.x로 풀어 버려서, 개발 기기에서
  아무리 확인해도 외부 경로를 검증한 것이 아니다.
- ⚠️ 맥이 NAS를 **exit node로 쓰고 있으면** `--resolve`로 공인 IP를 찍어도 무효다 — 트래픽이 NAS를 한 바퀴 돌고,
  공유기가 hairpinning을 지원하지 않으면 타임아웃이 난다(`tailscale netcheck`의 `HairPinning: false`).

### 되살리는 법

인그레스 등록이 끊겼을 때는 `reset` 후 다시 건다:

```bash
sudo /var/packages/Tailscale/target/bin/tailscale funnel reset
sudo /var/packages/Tailscale/target/bin/tailscale funnel --bg 3000
sudo /var/packages/Tailscale/target/bin/tailscale funnel --bg --set-path=/ws http://127.0.0.1:3001/ws
```

⚠️ `funnel 443 off/on` 문법은 **없어졌다**(1.58 기준). `funnel <target>` · `funnel status` · `funnel reset` 셋뿐이다.

### 실시간(`/ws`)은 경로를 지켜야 한다

사이드카는 **`/ws`에서만** 받는다(`/`는 거절). `--set-path=/ws 3001`처럼 포트만 주면 Tailscale이 경로를 **떼고** 넘겨서
502가 난다. 대상에 경로를 붙여야 한다:

```
|-- /   proxy http://127.0.0.1:3000
|-- /ws proxy http://127.0.0.1:3001/ws      ← 경로가 붙어야 한다
```

> ⚠️ **2026-09-05 현재 미해결**: 경로를 고쳐도 WebSocket 업그레이드는 502다. 평범한 GET은 404(정상)로 지나가므로
> 프록시·라우팅은 맞고 **업그레이드만** 실패한다. tailnet 안(serve)에서도 같아 Funnel 인그레스가 아니라
> **tailscaled 1.58.2(2024-02)의 문제**로 보인다. → 업그레이드 또는 별도 포트(8443) 노출을 검토.
> 그동안 실시간은 폴백(당겨서 새로고침)으로 동작한다 — 앱·웹 모두 그렇게 설계돼 있다.

### 감시 — `GET /api/health-watch` (Vercel)

**우리 인프라 중 tailnet 밖에 있는 것은 Vercel뿐이다.** 그래서 외부 경로 감시는 거기서 돈다:

```
https://tripcanvas-ai.vercel.app/api/health-watch
```

NAS의 `/api/health`·`/api/v1/trips`(401)·`/ws`(업그레이드)를 **바깥에서** 찔러 보고 상태 코드로 답한다:

| 응답 | 뜻 | 알림 |
|---|---|---|
| `200 UP` | 전부 정상 | — |
| `200 DEGRADED` | 실시간만 죽음 — 폴백(당겨서 새로고침)이 있어 기능은 산다 | 울리지 않는다 |
| **`503 DOWN`** | **저장 경로가 죽었다 — 사용자가 여행을 저장할 수 없다** | 울린다 |

> 실시간 하나로 새벽에 깨우지 않는다. 저장과 실시간의 무게가 다르다.

**알림을 받으려면** 무료 uptime 모니터를 이 URL에 걸어 둔다 — 503이면 알림이 온다.
Vercel 무료 플랜의 크론은 하루 1회라 감시 주기로는 부족하다. **아직 걸려 있지 않다 — 아래 절차는 사람이 한 번 해야 한다.**

#### 알림 걸기 (한 번만 하면 된다)

이 감시는 **상태 코드만 보면 된다.** 본문 키워드 규칙도, 인증도, 헤더도 필요 없다 — 어느 서비스든 기본 HTTP 모니터 하나면 끝난다.

| 후보 | 무료로 주는 것 | 주의 |
|---|---|---|
| **UptimeRobot** | 모니터 50개 · **5분** 고정 주기 | 2024-12부터 무료는 **개인·비상업 용도만**이다. 이 프로젝트가 수익을 내기 시작하면 유료로 옮겨야 한다 |
| **Better Stack** | 모니터 10개 · **3분** 주기 · 무료에도 on-call/에스컬레이션 | 모니터 수가 적다(여기는 하나면 되니 상관없다) |

어느 쪽이든 설정은 같다:

1. **HTTP(S) 모니터 하나**를 만들고 URL은 위의 `https://tripcanvas-ai.vercel.app/api/health-watch`, 메서드는 `GET`.
2. **주기는 무료의 최소값**(UptimeRobot 5분 · Better Stack 3분). 탐지는 주기만큼 늦는다 — 5분이면 최악 4분 59초 동안은 죽은 줄 모른다. 그 정도면 충분하다고 보고 시작한다.
3. **"정상"은 2xx다** — 기본값 그대로 두면 `503 DOWN`에서 울린다. 손댈 것이 없다.
   ⚠️ **본문 키워드 규칙을 걸지 말 것.** `200 DEGRADED`(실시간만 죽음)까지 울리게 되어, *실시간 하나로 새벽에 깨우지 않는다*는 위 표의 결정이 깨진다. 무게를 상태 코드에 실어 둔 이유가 그것이다.
4. **알림 채널은 이메일 하나**로 시작한다. "N번 연속 실패 후 알림"을 고를 수 있으면 **2회**로 — 배포 중 한 번의 순간 오류로 깨지 않게.
5. **이름을 제목만 보고 알 수 있게** 짓는다: `With J — 저장 경로(외부)`. 새벽 3시에 알림 제목만 보고 무엇이 죽었는지 알아야 한다.

걸고 나서 **반드시 두 번 확인한다**:

- 등록 직후 수동 체크 → `UP`이 떠야 한다. (안 뜨면 지금 실제로 죽어 있는 것이다 — 위 "손으로 확인하는 법"으로 확인한다)
- 한 번은 **정말 울리는지** 본다. NAS에서 Funnel을 잠깐 내리고(`tailscale funnel off`) 알림이 오는지, 되돌리면 복구 알림이 오는지. **안 울리는 감시는 없는 것과 같다** — 2026-09-05에 우리가 겪은 것이 정확히 그 상태였다.

⚠️ 이 감시는 **Vercel이 살아 있어야 돈다.** Vercel이 죽으면 알림도 오지 않는다 — 다만 그때는 정적 웹이 함께 죽어 사용자가 먼저 안다.
비용은 걱정하지 않아도 된다: 5분 주기면 함수 호출이 하루 288회다.

사람이 볼 때도 같은 URL이면 된다:

```bash
curl -s https://tripcanvas-ai.vercel.app/api/health-watch | head -20
```

⚠️ 비밀은 아무것도 나오지 않는다 — 공개 주소와 살았나/죽었나뿐이다(§47).

### 손으로 확인하는 법 (반드시 tailnet 밖에서)

```bash
# 공인 IP를 직접 찍어 인그레스 경로를 그대로 지난다
IP=$(dig +short @8.8.8.8 bokbok9.tail8b977f.ts.net A | head -1)
curl -m 20 --resolve "bokbok9.tail8b977f.ts.net:443:$IP" https://bokbok9.tail8b977f.ts.net/api/health
```

⚠️ exit node를 쓰고 있으면 이것도 무효다 — 폰의 LTE가 가장 확실하다.
⚠️ WebSocket을 볼 때는 **`--http1.1`을 줘야 한다.** HTTP/2로는 업그레이드가 성립하지 않아 엉뚱한 404로 보인다.

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
