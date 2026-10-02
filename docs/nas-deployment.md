# NAS 배포 — TripCanvas API

> **2026-09-19부터 배포는 자동이다** — `main` 머지 → `release.yml` → GHCR `:<커밋 SHA>` → `production` 태그 → NAS cron(`scripts/nas-deploy.sh`). 파이프라인은 아래 "배포 — main 머지가 곧 배포다"에, 머지 순서(새 API가 필요한 웹은 **API PR 먼저**)와 머지 뒤 확인·복귀는 [NAS 릴리스 절차](nas-release.md)에 있다. NAS에서 손으로 빌드하지 않는다. 아래의 과거 실측 기록은 현재 운영 점검 결과와 구분한다.

> **2026-09-04 — 프로덕션이 여기다.** 웹(`tripcanvas-ai.vercel.app`)이 부르는 API는 NAS의
> `https://bokbok9.tail8b977f.ts.net` 이고, 데이터는 NAS PostgreSQL이다. Vercel에는 정적 웹만 남았다.
> Vercel의 `tripcanvas-api` 프로젝트는 지우지 않았다 — **롤백 대상**이다(아래 "롤백 (2026-09-04 전환 기준)").

> **NAS의 다음 역할 (준비됨, 2026-09-17)**: API·PostgreSQL을 관리형으로 옮기면 NAS는 **오프사이트 백업 목적지**가 된다 —
> `deploy/docker-compose.backup-only.yml`이 관리형 DB의 `pg_dump`를 이 디스크로 당겨 온다. 이 문서의 나머지는 그때까지의(그리고 롤백 대상으로 남는) 운영 스택이다.
> 설계와 순서: `docs/managed-infrastructure.md` · `docs/production-cutover.md`.

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
| `api` | GHCR `…/api:<커밋 SHA>` (`next/Dockerfile` target `runtime`) | Next standalone, `/api/v1/*` · `/api/health` | 호스트 루프백 `127.0.0.1:3000`(Funnel이 넘긴다) |
| `realtime` | GHCR `…/tools:<커밋 SHA>` (target `tools`, 명령만 다르다) | WebSocket 사이드카 `/ws` — pg_notify를 듣고 중계 | 호스트 루프백 `127.0.0.1:3001` |
| `migrate` | GHCR `…/tools:<커밋 SHA>` (target `tools`) | `drizzle-kit migrate` 일회 실행. 성공해야 `api`·`realtime`이 뜬다 | — |
| `postgres` | postgres:17-alpine | source of truth | 내부 네트워크만(5432 비공개, §54) |
| `backup` | postgres:17-alpine | 매일 `pg_dump` → `BACKUP_DIR` | — |

이미지 셋은 `TC_IMAGE_TAG` 하나(커밋 SHA)를 같이 본다 — `release.yml`이 만들고 `nas-deploy.sh`가 `deploy/.env`에 채운다. 운영 compose에는 `build:`가 없다.
`reverse-proxy`(caddy:2, 80·443)는 `docker-compose.caddy.yml`을 겹칠 때만 있다(오늘은 안 씀 — 아래).

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

⚠️ `funnel 443 off/on` 문법은 **없어졌다**. `funnel <target>` · `funnel status` · `funnel reset` 셋뿐이다.

### 실시간(`/ws`)은 경로를 지켜야 한다

사이드카는 **`/ws`에서만** 받는다(`/`는 거절). `--set-path=/ws 3001`처럼 포트만 주면 Tailscale이 경로를 **떼고** 넘겨서
502가 난다. 대상에 경로를 붙여야 한다:

```
|-- /   proxy http://127.0.0.1:3000
|-- /ws proxy http://127.0.0.1:3001/ws      ← 경로가 붙어야 한다
```

#### 업그레이드로 풀린 것 (2026-09-06)

경로를 고쳐도 WebSocket 업그레이드가 502였다. 평범한 GET은 404(사이드카가 `/` 거절)로 지나가서
프록시·라우팅은 맞고 **업그레이드만** 실패했다. 별도 포트(8443)로 바로 물려도 같은 502라
경로 마운트가 아니라 **tailscaled 1.58.2(2024-02)** 자체가 원인이었다.

**1.102.3으로 올리니 101이 됐다.** Synology 패키지 센터의 Tailscale은 1.58.2에 멈춰 있으므로
[pkgs.tailscale.com/stable](https://pkgs.tailscale.com/stable/)의 `tailscale-x86_64-<버전>-dsm7.spk`를
DSM 패키지 센터 → 수동 설치로 올린다(신뢰 수준을 **모든 게시자**로 잠깐 내려야 한다).
업그레이드 후 funnel 설정은 그대로 살아남았다.

밖에서 확인하는 법은 아래 감시(`/api/health-watch`)의 `checks.realtime.status`가 **101**인지 보는 것이다.

> 그동안(그리고 앞으로 실시간이 죽었을 때도) 실시간은 폴백(당겨서 새로고침)으로 동작한다 —
> 앱·웹 모두 그렇게 설계돼 있다. 그래서 실시간만 죽은 상태는 `200 DEGRADED`이고 알림을 울리지 않는다.

### 감시 — `GET /api/health-watch` (Vercel)

**우리 인프라 중 tailnet 밖에 있는 것은 Vercel뿐이다.** 그래서 외부 경로 감시는 거기서 돈다:

```
https://tripcanvas-ai.vercel.app/api/health-watch
```

NAS의 `/api/health`·`/api/v1/trips`(401)·`/ws`(업그레이드)를 **바깥에서** 찔러 보고 상태 코드로 답한다:

| 응답 | 뜻 | 알림 |
|---|---|---|
| `200 HEALTHY` | 전부 정상 | — |
| `200 DEGRADED` | 실시간·백업·점검 모드처럼 폴백이 있는 것만 어긋남(`degradedReasons`에 무엇인지) — 기능은 산다 | 울리지 않는다 |
| **`503 UNAVAILABLE`** | **저장 경로가 죽었다 — 사용자가 여행을 저장할 수 없다** | 울린다 |

감시 대상은 Vercel 환경변수로 옮긴다: `TC_WATCH_BASE`(API) · `TC_WATCH_REALTIME_BASE`(실시간이 다른 호스트일 때) · `TC_WATCH_WS_PATH`. 관리형 전환 때 이 셋만 바꾼다.

> 실시간 하나로 새벽에 깨우지 않는다. 저장과 실시간의 무게가 다르다.

**알림을 받으려면** 무료 uptime 모니터(UptimeRobot·Better Stack 등)를 이 URL에 걸어 둔다 —
503이면 알림이 온다. Vercel 무료 플랜의 크론은 하루 1회라 감시 주기로는 부족하다.

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
| **`~/tripcanvas`는 git 클론이 아니다** | `.git`이 없고 **NAS에 git도 깔려 있지 않다.** `git pull`로 배포할 수 없다 — 그래서 배포 스크립트가 그 커밋의 compose·`backup.sh`·자기 자신을 `raw.githubusercontent.com`에서 받는다(사람이 파일을 보내는 것은 최초 설정뿐이다) |
| **비로그인 셸의 PATH가 짧다** | `/usr/bin:/bin:/usr/sbin:/sbin`뿐이라 `docker`가 안 잡힌다. `ssh nas 'docker …'`는 실패하고 **`/usr/local/bin/docker`** 전체 경로를 써야 한다 |
| **docker 그룹이 없다** | 소켓이 `root:root`(`srw-rw----`)다. `synogroup --member docker`는 그룹 자체가 없어 성립하지 않는다 |
| **sudo에 비밀번호가 필요하다** | `administrators` 소속이어도 그렇다. 자동화하려면 `/etc/sudoers.d/`에 NOPASSWD를 두어야 한다 (⚠️ docker 접근은 **사실상 root**다 — 범위 제한은 실수 방지용이지 권한 축소가 아니다) |
| **`visudo`가 없다** | 문법 검사를 건너뛰게 된다. 파일을 쓴 뒤 `sudo -n /usr/local/bin/docker version`으로 실제 동작을 확인한다 |
| **SFTP가 막혀 있다** | 그냥 `scp`는 `Connection closed`로 끊긴다. **`scp -O`**(레거시 프로토콜)를 쓴다 |
| **macOS의 `rsync`는 openrsync다** | `-e` 처리가 달라 ssh 인증이 깨진다. 파일 몇 개면 `scp -O`가 낫다 |
| **`deploy/.env`가 이미지의 ENV를 이긴다** | compose의 `env_file:`이 파일을 통째로 넣는다. `TC_REVISION` 같은 **이미지가 주인인 값을 여기 두면 안 된다** — 배포 스크립트가 지운다 |
| **`crontab`이 없다** | Synology는 사용자 crontab을 주지 않는다. 주기 실행은 **DSM 작업 스케줄러**로만 건다 |
| **볼륨이 둘이다** | DB는 `/volume1/@docker/volumes/...`, 홈은 `/volume2`다. **백업은 반드시 다른 볼륨에** 둔다(§60) |

### 배포 — main 머지가 곧 배포다 (2026-09-19)

**사람이 하는 정상 배포 작업은 PR을 `main`에 머지하는 것뿐이다.** 그 뒤는 자동이다.

```
PR merge → main
   → GitHub Actions(.github/workflows/release.yml)
       게이트(기존 CI) → GHCR에 이미지 push → `production` 태그를 그 커밋으로 이동
   → NAS cron(5분) → scripts/nas-deploy.sh
       production 태그 확인 → 바뀌었으면 그 커밋의 compose·이미지 pull
       → migrate → api·realtime 교체 → 헬스체크 → revision 확인 → 기록
```

이 사슬의 요점은 **이름이 커밋 SHA 하나로 꿰어져 있다**는 것이다.

```
Git 커밋 = 이미지 태그 = migrate·api·realtime = TC_REVISION = 배포 기록
```

**NAS는 더 이상 빌드하지 않는다.** 이미지를 만드는 곳은 GitHub 하나뿐이다.

왜 이렇게 바뀌었나: 2026-09-19 새벽 배포는 `docker build`가 성공했고 컨테이너도 새로 떴는데 **내용이 #239였다.**
`git fetch`가 돌지 않아 맥의 `origin/main`이 전날 것이었고 `git archive origin/main`은 그걸 그대로 담았다.
로그는 전부 초록이라 원인을 찾는 데 몇 시간이 들었다. 소스를 사람이 날라서 거기서 빌드하는 한 같은 사고가 또 난다.

#### 지금 무엇이 도는지

```bash
ssh nas '~/tripcanvas/scripts/nas-deploy.sh --status'
```

```
기록된 현재 SHA : 6549b93…        ← deploy/.deploy-state
기록된 직전 SHA : e767f29…        ← 롤백 대상
도는 revision   : 6549b93…        ← GET /api/health (도는 프로세스가 말하는 값)
컨테이너 이미지 : 6549b93…        ← 도는 컨테이너 이미지의 OCI 라벨 (코드 자체)
상태            : HEALTHY / DB ok
production 태그 : 6549b93…        ← GitHub이 배포하라고 정한 커밋
자동 배포       : 켜짐            ← 멈춰 있으면 이유와 다시 켜는 법(손 롤백 고정이면 그 커밋)
```

네 SHA가 같으면 정상이다. 실패로 적힌 커밋이 있으면 `실패로 적힌 SHA` 줄이 하나 더 나온다(아래 "배포가 실패하면").

⚠️ **`도는 revision`과 `컨테이너 이미지`가 따로 있는 이유**(2026-09-19): 앞은 환경변수(`TC_REVISION`)를
거쳐 나오고 뒤는 이미지에 박힌 라벨이라 환경변수를 거치지 않는다. compose의 `env_file: deploy/.env`가
파일을 통째로 컨테이너에 넣으면서 **이미지의 `ENV`를 덮어쓰기** 때문에, `.env`에 `TC_REVISION` 한 줄이
남아 있으면 새 이미지를 제대로 띄우고도 `/api/health`는 옛 커밋을 말한다. 실제로 그 일이 일어났다 —
맥에서 빌드하던 옛 방식이 남긴 줄이었다. 지금은 `nas-deploy.sh`가 배포할 때마다 그 줄을 **지우고**,
둘이 갈리면 배포를 실패시킨다(`test/nas-deploy.test.js`). **`production 태그`와 `도는 revision`이 30분 넘게 다르면** 파이프라인이 멈춘 것이다 —
`deploy/deploy.log`를 본다. **밖에서는 자동으로 감시한다**(2026-09-20) — `api/health-watch.js`(Vercel, tailnet 밖)가 `production` 태그와
도는 `revision`을 대조해, 태그가 가리키는 커밋이 30분 넘게 묵었는데도 다른 것이 돌고 있으면 **DEGRADED**로
답한다(`degradedReasons: ["deploy"]`). 저장은 멀쩡하므로 503이 아니다 — 새벽에 깨우지 않는다.
끄려면 `TC_WATCH_REPO=`(빈 값), 기준 시간은 `TC_WATCH_DEPLOY_MAX_AGE_MIN`.

밖에서 한 줄로 볼 때는:

```bash
curl -s https://bokbok9.tail8b977f.ts.net/api/health | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p'
```

#### 배포 기록

`deploy/deploy.log`에 한 줄씩 쌓인다 — 시작·이전/대상 SHA·pull·migrate·컨테이너 교체·헬스체크·revision·성공/실패·롤백.
비밀은 찍지 않는다.

```bash
ssh nas 'tail -40 ~/tripcanvas/deploy/deploy.log'
```

#### 배포가 실패하면 — 실패한 커밋은 다시 시도하지 않는다 (2026-10-02)

배포가 실패하면 스크립트가 **직전 SHA로 스스로 되돌린다.** 실패가 **교체까지 간 뒤**(migrate·컨테이너 교체·
헬스체크·revision 확인)였고 **되돌리기가 성공했다면** 그 커밋을 `deploy/.deploy-state`의 `FAILED_SHA`로 적는다
(직전 커밋은 뜬다 = 환경은 멀쩡하고 커밋이 문제다). 자동 경로는 production
태그가 그 커밋인 동안 **아무것도 하지 않는다** — 표준출력 한 줄만 찍고 0으로 끝난다(스케줄러 오류 메일이 5분마다
오지 않는다. 실패 자체는 그때 `deploy.log`에 남았고 1로 끝났다).

⚠️ 왜: 전에는 실패를 기억하지 않았다. production 태그가 부팅에 실패하는 커밋을 가리키는 동안
'교체 → 최대 180초 헬스체크 실패 → 롤백'이 5분마다 되풀이됐다 — 실패 한 번이 5분마다 오는 운영 중단이었다.

- 고친 커밋을 머지하면 production 태그가 옮겨 가 **그대로 배포된다**. 성공하면 기록을 지운다.
- 같은 커밋을 다시 해 보려면(환경을 고쳤을 때): `ssh nas '~/tripcanvas/scripts/nas-deploy.sh --force'`
  ⚠️ **Actions에서 Release를 다시 돌려도(workflow_dispatch) NAS는 저절로 다시 시도하지 않는다** — 이미지를 다시 만들고
  태그를 같은 SHA로 맞출 뿐이라, cron은 여전히 실패로 적힌 커밋으로 보고 건너뛴다(2026-10-02 전에는 5분 안에 다시
  배포됐다). 이미지를 다시 만들어야 했던 경우에도 그 뒤에 `--force`가 필요하고, `deploy/.env`에 빠진 값을 채운 경우처럼
  고친 것이 NAS 쪽이면 Release를 돌릴 필요 없이 `--force` 하나로 끝난다.
- 교체 **전** 실패(그 커밋의 compose·이미지를 못 받음)는 적지 않는다 — 운영을 건드리지 않았고 대개 GitHub·GHCR이
  잠깐 흔들린 것이라 다음 차례에 다시 해 본다.
- **롤백까지 실패하면** 적지 않는다 — 직전 커밋도 못 떴으면 DB·docker·디스크 같은 환경 탓일 가능성이 크다. 운영은
  이미 내려가 있으니 다음 차례에 다시 해 봐도 잃을 것이 없고, 환경이 돌아오면 그때 배포된다(적어 두면 멀쩡한 커밋이
  사람이 `--force`할 때까지 영영 안 나간다).
- **지금 도는 커밋을 `--force`로 다시 띄우다 실패한 것**도 적지 않는다 — 그 커밋은 방금까지 돌고 있었다. 적으면 도는
  production이 '실패한 커밋'으로 남아, 나중에 고정을 풀었을 때 자동 경로가 그리로 돌아가지 못한다.
- 그동안 `production 태그`와 `도는 revision`이 갈려 있으므로 `health-watch`가 30분 뒤 **DEGRADED로 보인다** — 의도한
  신호지만 **알림은 울리지 않는다**(503만 울린다, 위의 감시 표). 알림은 실패한 그 차례가 1로 끝나며 스케줄러가 한 번 보낸 것이
  전부다 — 그 뒤로는 `--status`나 `health-watch`를 사람이 봐야 안다.

#### 롤백 — 특정 커밋으로 되돌리기 (고정된다)

```bash
ssh nas '~/tripcanvas/scripts/nas-deploy.sh --sha <되돌릴-커밋-40자리-SHA>'
```

production 태그와 **다른** 커밋이면 띄운 뒤 자동 배포를 **고정**한다 — `deploy/.deploy-disabled`에 `PINNED_SHA`를
적는다. 전에는 production 태그가 그대로라 다음 cron이 5분 안에 production으로 되돌렸다. 다시 켜는 법은
배포 기록과 `--status`가 말한다:

```bash
ssh nas 'rm ~/tripcanvas/deploy/.deploy-disabled'   # 고정을 풀면 다음 차례에 production 태그의 커밋으로 돌아간다
```

- 손 롤백은 **지금 스크립트로** 띄운다 — 그 커밋의 옛 스크립트로 갈아 끼우지 않는다. 옛 판은 고정을 모르고,
  멈춤 파일이 있으면 손 명령까지 막는다. production 태그의 커밋을 짚은 `--sha`는 고정하지 않고 평소처럼 갈아 끼운다.
- 손 롤백이 실패하면 고정하지 않고, production의 실패 기록(`FAILED_SHA`)도 덮지 않는다.
- ⚠️ 고정한 뒤 **손으로 production에 돌아와도**(`--force`·`--sha <production SHA>`) 고정은 풀리지 않는다 — 멈춤은
  사람이 `rm`으로 푼다. 안 풀면 다음 머지들이 조용히 배포되지 않는다. 그래서 그 배포의 기록 끝에 "배포는 끝났지만
  멈춤은 그대로다"를 다시 찍고, `--status`·cron은 "X에 고정했지만 지금은 Y가 돈다"고 말한다(돌지 않는 커밋을 고정이라 하지 않는다).
- 멈춤 파일을 쓰는 이유: **옛 판의 스크립트도 이 파일이 있으면 자동 배포를 하지 않는다** — 판이 오가도 고정이 지켜진다.

⚠️ **이미지만 되돌아간다. 스키마는 앞선 채로 남는다.** 그래서 마이그레이션은 항상 하위호환이어야 하고,
CI가 그걸 검사한다 — `docs/migration-policy.md`.

#### 자동 배포 일시 중지

```bash
ssh nas 'touch ~/tripcanvas/deploy/.deploy-disabled'   # 정지 (deploy/.env의 DEPLOY_DISABLED=1도 같다)
ssh nas 'rm ~/tripcanvas/deploy/.deploy-disabled'      # 재개
```

멈춤은 **자동 경로(인자 없는 cron 호출)만** 세운다 — 멈춰 둔 채로도 손으로 준 `--sha`·`--force`는 진행한다.
2026-10-02 전에는 손 명령까지 막혀, 멈춘 채 보면서 배포하는 절차(`docs/migration-policy.md`)가 통하지 않았다.
스크립트는 멈춤을 스스로 풀지 않는다 — 푸는 것은 사람이다.

#### NAS 최초 1회 설정

```bash
# 1) GHCR 로그인 — 이 저장소는 공개라 공개 패키지면 필요 없다.
#    비공개로 바꿀 때만, read:packages **만** 가진 토큰으로. NAS에 쓰기·저장소 권한을 주지 않는다.
# ssh nas 'echo <READ_PACKAGES_TOKEN> | sudo /usr/local/bin/docker login ghcr.io -u <github-id> --password-stdin'

# 2) 배포 스크립트 자리 잡기 — **NAS가 직접 받는다.** 저장소가 공개라 인증이 필요 없고,
#    배포 스크립트 자신도 compose 파일을 같은 경로로 받으므로 이 길이 살아 있어야 한다.
ssh nas 'mkdir -p ~/tripcanvas/scripts \
  && curl -fsSL https://raw.githubusercontent.com/blackshoes1/tripcanvas/main/scripts/nas-deploy.sh \
       -o ~/tripcanvas/scripts/nas-deploy.sh \
  && chmod +x ~/tripcanvas/scripts/nas-deploy.sh \
  && head -1 ~/tripcanvas/scripts/nas-deploy.sh'
#    ⚠️ 맥에서 보내려면 **`scp -O`**다 — 이 NAS는 SFTP가 막혀 있어 그냥 `scp`는 `Connection closed`로 끊긴다:
#    scp -O scripts/nas-deploy.sh nas:~/tripcanvas/scripts/nas-deploy.sh

# 3) 첫 배포를 손으로 한 번 — 여기서 .env의 TC_IMAGE_TAG가 채워진다
ssh nas '~/tripcanvas/scripts/nas-deploy.sh'

# 4) 5분마다 — **DSM 작업 스케줄러**로 건다. 셸에는 방법이 없다:
#    이 NAS에는 `crontab` 명령이 아예 없다(`sh: crontab: command not found`).
#    Synology는 사용자 crontab을 주지 않고 스케줄은 DSM이 관리한다.
```

```
제어판 → 작업 스케줄러 → 생성 → 예약된 작업 → 사용자 정의 스크립트

일반   이름  : TripCanvas 배포
       사용자: root                  ← TC_DOCKER의 sudo가 비밀번호를 묻지 않게 된다
       활성화 ✓

일정   매일 실행 · 00:00 ~ 23:55 · 빈도 5분마다   ← 5분이 없으면 10·15분도 괜찮다

작업   사용자 정의 스크립트:
       /bin/bash /var/services/homes/<계정>/tripcanvas/scripts/nas-deploy.sh

       실행 세부 정보 이메일은 **끈다**(5분마다 온다). 오류 알림만 켠다.
```

스케줄러는 PATH가 짧은 채로 돌린다 — 스크립트가 `docker`를 전체 경로(`/usr/local/bin/docker`)로
부르는 이유가 여기 있다. 등록 뒤 **[실행]** 으로 한 번 손수 돌려 보고 `deploy/deploy.log`를 확인한다
(바뀐 게 없으면 즉시 끝나 로그에 줄이 안 붙는 것이 정상이다 — `--force`로 확인한다).

### 배포 스크립트는 스스로를 갱신한다 (2026-09-20)

배포할 것이 있을 때마다 그 커밋의 `scripts/nas-deploy.sh`를 받아, 지금 것과 다르면 **갈아 끼우고 새 스크립트로
다시 시작한다.** 사람이 할 일은 없다.

⚠️ 예전에는 `deploy/nas-deploy.sh.new`로 받아 두고 사람이 복사하기를 기다렸다. 그 한 단계를 잊어
**옛 스크립트가 5분마다 돌며 같은 실패를 되풀이하는** 일이 실제로 났다. 그래서 자동으로 바꾼다.

안전장치 넷:

- **그 자리에서 덮어쓰지 않는다.** bash는 스크립트를 조금씩 읽어 가며 실행해서, 내용이 발밑에서 바뀌면
  엉뚱한 줄을 실행한다. 같은 디렉터리에 받아 **rename**으로 바꾼다 — 옛 inode는 그대로라 지금 프로세스는
  끝까지 옛 내용을 읽는다.
- **문법을 먼저 검사한다**(`bash -n`). 깨진 스크립트로는 바꾸지 않고 지금 것으로 계속한다.
- **한 번만 한다**(`TC_SELF_UPDATED`). 두 커밋이 서로를 가리켜도 무한히 다시 시작하지 않는다.
- **바뀐 게 없는 주기에는 받지도 않는다.** 5분마다 도는 경로는 여전히 GitHub 요청 하나(`production` 태그)뿐이다.

못 바꿨을 때(권한 등)만 예전처럼 `deploy/nas-deploy.sh.new`에 받아 두고 로그로 알린다.

⚠️ `sudo`가 비밀번호를 묻지 않아야 cron이 돈다. 묻는다면 `TC_DOCKER=/usr/local/bin/docker`로 두고
docker 그룹에 넣거나, 스케줄러를 root로 돌린다.

#### 비상 — 레지스트리가 죽었을 때만

정상 경로는 언제나 GHCR pull이다. GHCR·인터넷이 죽어 손으로 빌드해야 하면:

```bash
ssh nas 'cd ~/tripcanvas && TC_IMAGE_TAG=$(cat deploy/.deploy-state | sed -n "s/^CURRENT_SHA=//p") \
  sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml build'
```

base의 `image:`가 그대로 태그로 붙어 운영이 기대하는 바로 그 태그가 된다. 다음 자동 배포가 GHCR 이미지로 되돌린다.

⚠️ **`deploy/.env`는 NAS 것이 진실이다.** 저장소에 없고, 배포가 건드리는 줄은 `TC_IMAGE_TAG` 하나뿐이다.
`~/.ssh/config`에 별칭을 두면 편하다(`Host nas` / `HostName bokbok9.tail8b977f.ts.net` / `User <계정>`).

## 환경변수

`deploy/.env.example` → `deploy/.env`. 비밀은 Git에 올리지 않는다(§58). `api`는 이 파일과 `DATABASE_URL`(compose가 조립)을 받는다.

⚠️ **지도 키가 없어도 서버는 그대로 돈다** — 경로 조회만 꺼지고 이동시간은 지금처럼 직선 추정이다. 키를 넣으면 그다음 요청부터 실제 도로로 바뀐다.

| 변수 | 뜻 |
|---|---|
| `API_DOMAIN` | **`docker-compose.caddy.yml`을 겹칠 때만.** 오늘의 ingress는 Funnel이라 운영에는 없어도 된다 |
| `POSTGRES_*` | DB 계정 |
| `TC_MIGRATION_TRIP` | 이관 레지스트리. staging은 `NEW_BACKEND`, 프로덕션 전환 전에는 `LEGACY` |
| `NEXT_PUBLIC_SUPABASE_*` · `SUPABASE_JWT_SECRET` | Phase A — Supabase 토큰 검증 |
| `KAKAO_REST_API_KEY` | 국내 경로(카카오내비)·국내 장소 검색. Vercel에 있는 것과 **같은 키**를 복사해 넣는다 |
| `GOOGLE_ROUTES_API_KEY` | 해외 경로(Google Routes)용 **서버 전용** 키. 웹 키(리퍼러 제한)·iOS 키(번들 제한)는 서버에서 거절된다 |
| `LEG_FILL_USER_DAILY` · `LEG_FILL_TOTAL_DAILY` | 위 두 키로 하는 유료 경로 조회의 하루(UTC) 상한 — 사람마다 · 서버 전체(기본 2000 · 10000). 넘으면 조회하지 않고 추정으로 답한다. `0`이면 키를 그대로 두고 유료 조회만 멈춘다. 센 값은 `leg_fill_usage`. ⚠️ **전체 상한에 닿으면 남용한 사람만이 아니라 모두의 도로가 그날(UTC) 끝까지 꺼진다** — 비용 천장을 위해 받아들인 대가다. 로그 `경로 조회 하루 예산에 닿았다`가 보이면 `leg_fill_usage`에서 많이 쓴 `user:` 갈래를 확인한다 |
| `BACKUP_DIR` · `BACKUP_KEEP_DAYS` | 덤프 위치 · 보관 일수. ⚠️ **DB와 다른 볼륨**이어야 한다 — DB는 `/volume1`에 있으므로 `/volume2/...`를 쓴다(§60) |
| `BACKUP_MAX_AGE_HOURS` | `/api/health`가 `ops_backup_runs`의 마지막 성공을 이 시간과 비교한다(기본 26). 넘으면 DEGRADED |
| `TC_READ_ONLY` | 점검(읽기 전용) 모드. **전환 직전 write freeze에만** `1`. 쓰기 라우트가 503 `MAINTENANCE` — `docs/production-cutover.md` |

### ⚠️ `.env`를 고쳤으면 **반드시 다시 띄운다**

`.env`는 **컨테이너가 뜰 때 한 번만 읽힌다.** 파일만 고치면 화면에서는 아무것도 달라지지 않고,
"고쳤는데 왜 안 되지"로 시간을 버린다(2026-09-07에 세 번 연속 이것 때문이었다).

```bash
ssh nas 'cd ~/tripcanvas && sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml up -d --force-recreate api'
```

확인은 **파일이 아니라 컨테이너**를 본다 — 둘의 시각을 비교하면 바로 드러난다:

```bash
ssh nas 'stat -c "%y  .env 수정" ~/tripcanvas/deploy/.env; \
         sudo /usr/local/bin/docker inspect -f "{{.State.StartedAt}}  api 시작" tripcanvas-api-1'
```

⚠️ **`deploy/` 안에서 실행하지 않는다.** compose는 현재 폴더 이름으로 프로젝트를 구분해서,
`deploy`에서 돌리면 기존 컨테이너를 다시 띄우는 게 아니라 **`deploy-api-1`이라는 새 스택**을 만든다
(같은 포트를 둘이 물면서 꼬인다). 항상 `~/tripcanvas`에서.

### 지도 키 — 값이 아니라 **통하는지**를 확인한다

키는 길이가 맞아도 **제한 때문에 거절될 수 있다.** 2026-09-07에 겪은 두 가지:

| 증상 | 원인 |
|---|---|
| `HTTP 400 · API key not valid` | 붙여넣을 때 **끝 한 글자가 잘렸다**(구글 키는 39자) |
| `HTTP 403 · Requests from this iOS client application <empty> are blocked` | **iOS 앱용 키**를 넣었다. 번들 ID로 제한돼 서버에서는 못 쓴다 |

그래서 구글 키는 **두 개**가 된다. 콘솔에서 이름을 갈라 두면 다음에 헷갈리지 않는다:

| 키 | 제한 | 쓰는 곳 |
|---|---|---|
| `withj-ios-maps` | 애플리케이션: **iOS 앱**(`com.fromj.trip`) | `ios/project.yml`의 `TCGoogleMapsKey` |
| `withj-server-routes` | 애플리케이션: **없음** · API: **Routes API만** | NAS `.env`의 `GOOGLE_ROUTES_API_KEY` |

⚠️ 서버 키에 애플리케이션 제한을 걸면 **반드시** 거절된다. 대신 **API 제한(Routes API 하나)** 이 방어선이다.

넣은 뒤에는 **값을 찍지 말고 실제로 불러 본다**(값이 로그·기록에 남으면 그 키는 폐기해야 한다):

```bash
ssh nas "sudo /usr/local/bin/docker exec tripcanvas-api-1 node -e '
const g=process.env.GOOGLE_ROUTES_API_KEY||\"\", k=process.env.KAKAO_REST_API_KEY||\"\";
console.log(\"GOOGLE:\", g.length+\"자\", \"KAKAO:\", k.length+\"자\");
fetch(\"https://routes.googleapis.com/directions/v2:computeRoutes\",{method:\"POST\",
  headers:{\"Content-Type\":\"application/json\",\"X-Goog-Api-Key\":g,\"X-Goog-FieldMask\":\"routes.duration\"},
  body:JSON.stringify({origin:{location:{latLng:{latitude:35.68,longitude:139.76}}},
    destination:{location:{latLng:{latitude:35.65,longitude:139.70}}},travelMode:\"DRIVE\"})})
 .then(async r=>console.log(\"구글:\", r.status, r.ok?\"통함\":(await r.text()).slice(0,120)));
fetch(\"https://apis-navi.kakaomobility.com/v1/directions?origin=126.978,37.5665&destination=129.0756,35.1796\",
  {headers:{Authorization:\"KakaoAK \"+k}}).then(r=>console.log(\"카카오:\", r.status, r.ok?\"통함\":\"거절\"));'"
```

둘 다 200이면 켜진 것이다. 그다음은 **누군가 일자 화면을 열어야** `leg_cache`에 행이 생긴다:

```bash
ssh nas "sudo /usr/local/bin/docker exec tripcanvas-postgres-1 psql -U tripcanvas -d tripcanvas \
  -c 'select provider, count(*), count(*) filter (where fail) as 실패 from leg_cache group by provider;'"
```

## 처음 띄울 때

처음 띄우는 것도 빌드가 아니라 **`scripts/nas-deploy.sh`** 다(위 "NAS 최초 1회 설정"). 운영 compose에는 `build:`가 없어
`docker compose … build`는 아무것도 만들지 않고, `TC_IMAGE_TAG`가 비어 있으면 `up`은 뜨지 않는다(`:?`) — 그 값은 배포 스크립트가 채운다.

```bash
cp deploy/.env.example deploy/.env      # 값 채우기 (TC_IMAGE_TAG는 비워 둔다)
scripts/nas-deploy.sh                   # production 태그의 커밋 이미지를 받아 migrate → api·realtime → 헬스체크 → revision 확인
sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml logs migrate     # "[✓] migrations applied" 류의 성공 로그
# 공개 주소는 Funnel의 ts.net 이름이다(도메인 아님) — tailnet 밖에서 확인할 것(§7)
curl -s https://bokbok9.tail8b977f.ts.net/api/health                        # {"ok":true,"api":"ok","database":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://bokbok9.tail8b977f.ts.net/api/v1/trips   # 401 — 정상(인증 요구)
```

확인 순서: `migrate`가 성공했는가 → `api` healthcheck가 healthy인가 → 401이 오는가 → 실제 로그인 토큰으로 `/api/v1/trips`가 200인가 → `realtime` 헬스가 `LISTENING`인가.

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

전환 스위치는 **웹이 API를 부르는 주소 세 곳**이다. Vercel의 `tripcanvas-api`는 살아 있고 여전히 Supabase를 본다.

| 어디 | 무엇이 쓰나 |
|---|---|
| `vercel.json`의 `/nas/api/*` rewrite 대상 | **운영 웹**(`tripcanvas-ai.vercel.app`)의 데이터 요청 — `app.js`의 `API_BASE`가 이 호스트에서는 같은 출처 `/nas`로 보내고 Vercel이 NAS로 넘긴다(2026-09-24~) |
| `auth.js`의 `DEFAULT_BASE` | 소셜 로그인 시작 — 콜백과 같은 API 출처여야 state 쿠키를 검증한다 |
| `api.js`의 `DEFAULT_BASE` | 그 밖의 출처(Preview 등)의 데이터 요청 |

```
세 곳을 https://tripcanvas-api.vercel.app 로 되돌리고 → PR → merge → Vercel 재배포 (약 1분)
```

⚠️ 2026-09-24 전의 절차(`DEFAULT_BASE` 두 줄만)대로 하면 **운영 웹은 rewrite를 따라 계속 NAS를 본다** — 바뀌는 것은 소셜 로그인 시작과 Preview뿐이다.

⚠️ 되돌리는 순간 **전환 후 NAS에 쌓인 변경은 사라진다**(Supabase에 없다). 그래서 관찰 기간에는 Supabase를 읽기전용으로 만들지 않고, 되돌릴 일이 생기면 NAS 쪽 변경을 먼저 확인한다(§79·§80).
NAS 안에서의 되돌리기(`TC_MIGRATION_*=LEGACY` + `api` 재시작)는 API가 다시 Supabase를 보게 하는 것이라 데이터를 잃지 않지만, 그때는 NAS를 거칠 이유가 없다.

## 아직 없는 것

- MinIO — Phase 7(현재 필요 없음)
- 오프사이트 백업 복제 — NAS 쪽 설정(Hyper Backup 등). `docs/backup-restore.md`
