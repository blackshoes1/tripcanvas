# R2 staging 앱 검증

> 이관은 **"같다"** 까지 왔다(R1 · R2 이관 부분 — `docs/backup-restore.md`). 남은 질문은 하나다:
> **옮겨진 데이터 위에서 앱이 그대로 도는가.** 스크립트가 판정하는 것은 데이터고, 여기서 판정하는 것은 동작이다.

확인할 것은 넷이다 — **로그인 · 저장 · 협업 · 롤백.** 하나라도 통과하지 못하면 전환하지 않는다(§79).

## 규칙 셋

1. **한 번에 한 가지만 바꾼다.** 이 검증에서 바꾸는 것은 **저장소(레지스트리)뿐**이다. Auth는 Supabase 그대로 둔다 — `AUTH_SECRET`을 넣지 않는다. 자체 Auth 전환(PR11)은 별개의 결정이고, 섞으면 무엇이 깨졌는지 가릴 수 없다.
2. **운영 Supabase는 읽기만.** 이관기는 원본에 쓰지 않는다. 다만 **롤백 검증(5단계)만은 다르다** — 그때는 staging API가 운영에 쓸 수 있다. 그 절에 따로 적는다.
3. **운영 웹(`tripcanvas-ai.vercel.app`)을 staging에 붙이지 않는다.** 같이 쓰는 사람이 staging DB를 보게 된다. 웹은 로컬에서 연다.

## 준비 — NAS에 저장소를 올리고 포트를 연다

⚠️ 0단계는 노트북에서 NAS의 `15432`로 붙는데, 그 포트를 여는 것이 아래 override다. 그래서 **override가 0단계보다 먼저**다.
그리고 `api`·`realtime`은 `build: context: ..`로 **저장소 루트에서** 빌드한다(판단 엔진 `adaptive.js`가 루트에 있다) — deploy 파일만 옮겨 둔 NAS에서는 빌드가 안 된다.

**NAS에 저장소 통째로.** Synology에 git이 없으면 맥에서 tar로 보낸다 — macOS 15의 `rsync`는 openrsync라 ssh 인증이 어긋나 `Permission denied`가 난다. `scp`는 SFTP 서브시스템이 없어 `-O`가 필요하다. tar가 제일 덜 걸린다.

```bash
# 맥
cd <저장소> && tar --exclude=node_modules --exclude=.git --exclude=.next --exclude=test-results -czf - . \
  | ssh <계정>@<NAS tailscale IP> 'mkdir -p ~/tripcanvas && tar -xzf - -C ~/tripcanvas'
# "Ignoring unknown extended header keyword" 경고는 macOS 확장속성이라 무해하다
```

**기존 `.env`를 새 위치로.** 경로는 떠 있는 컨테이너의 라벨에서 꺼낸다 — 직접 찾지 않는다.

```bash
# NAS
cp "$(sudo docker inspect tripcanvas-postgres-1 --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')/.env" ~/tripcanvas/deploy/.env
grep -c '^POSTGRES_PASSWORD=' ~/tripcanvas/deploy/.env     # 1
```

compose에 `name: tripcanvas`가 박혀 있어 **디렉터리가 바뀌어도 같은 프로젝트**다 — 떠 있던 postgres를 그대로 붙잡는다.

⚠️ **`.env`의 `POSTGRES_PASSWORD`가 실제 DB 비밀번호와 같은지 먼저 확인한다.** 볼륨 최초 생성 때 값이 굳고, 뒤에 `alter user`로 바꿨다면 `.env`는 옛 값이다. 그러면 `migrate`가 **오류 문구 없이** `applying migrations...`에서 죽고(`Exited (1)`), `api`·`realtime`은 `depends_on` 때문에 `Created`에서 영영 안 뜬다. postgres의 healthcheck(`pg_isready`)는 인증을 안 해서 `healthy`로 보인다 — 속기 딱 좋다. 판정은 한 줄이다:

```bash
cd ~/tripcanvas && sudo docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml run --rm --entrypoint sh migrate \
  -c 'node -e "const{Client}=require(\"pg\");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>{console.log(\"CONNECT OK\");process.exit(0)}).catch(e=>{console.error(\"CONNECT FAIL:\",e.message);process.exit(1)})"'
```

`CONNECT FAIL: password authentication failed`면 비밀번호를 **URI에 안전한 문자(영숫자와 `. _ ~ -`)** 로 새로 정해 양쪽을 맞춘다 — compose가 `DATABASE_URL`을 문자열로 조립해서 `@ : / ?`가 들어가면 또 깨진다. 컨테이너 안 psql은 소켓으로 붙어 옛 비밀번호가 필요 없다:

```bash
read -r -p "새 DB 비밀번호: " PW
```
```bash
printf "alter user tripcanvas with password '%s';\n" "$PW" | sudo docker exec -i tripcanvas-postgres-1 psql -U tripcanvas -d tripcanvas
cd ~/tripcanvas/deploy && grep -v '^POSTGRES_PASSWORD=' .env > .t && printf 'POSTGRES_PASSWORD=%s\n' "$PW" >> .t && mv .t .env && unset PW
```

**postgres부터 override로.** 0단계엔 이것만 있으면 된다.

```bash
cd ~/tripcanvas
sudo docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up -d postgres
sudo docker ps --format '{{.Names}}\t{{.Ports}}' | grep postgres      # 127.0.0.1:15432->5432
```

**맥에는 `next` 빌드.** 기기가 바뀌었으면 `node_modules`·`dist-tools`가 없다: `cd <저장소>/next && npm ci && npm run tools:build`.

## 0. staging DB를 실데이터로 채운다

R1·R2는 `--trial`이라 되돌렸다. 앱 검증은 되돌려진 트랜잭션 위에서 할 수 없으므로 **여기서 한 번은 커밋한다.**
원본은 **운영 Supabase를 직접** 가리켜도 된다 — 이관기는 원본에 `select` 세 종류만 보내고, R1이 그렇게 통과했다.
Session pooler URI는 이 꼴이고, 정확한 호스트는 대시보드 **Connect → Session pooler**에 있다(`aws-0-`인 프로젝트도 있다):

```
postgres://postgres.<ref>:<DB비밀번호>@aws-1-<region>.pooler.supabase.com:5432/postgres?uselibpqcompat=true&sslmode=require
```

⚠️ **`uselibpqcompat=true`를 빼지 말 것.** 요즘 `pg`는 `sslmode=require`를 `verify-full`로 해석해서 Supabase 인증서 체인에 걸린다
(`SELF_SIGNED_CERT_IN_CHAIN`). 이 옵션이 예전(libpq) 뜻으로 되돌린다 — 암호화는 하되 체인 검증은 하지 않는다.

명령은 **환경변수와 함께 한 줄로** 넣는다(맥에서 돌린다 — NAS엔 `node_modules`가 없다):

```bash
cd <저장소>/next && npm ci && npm run tools:build
# 아래 두 줄은 각각 한 줄이다. 줄 끝 백슬래시로 나누면 붙여넣다 끊겨 환경변수가 실리지 않는다
DATABASE_URL='postgres://tripcanvas:<NAS비번>@<NAS tailscale IP>:15432/tripcanvas' npm run db:migrate
LEGACY_DATABASE_URL='<위 pooler URI>' DATABASE_URL='postgres://tripcanvas:<NAS비번>@<NAS tailscale IP>:15432/tripcanvas' npm run migrate:import -- --apply --reset
```

작은따옴표로 감싸야 URI 안의 `&`가 백그라운드로 새지 않는다. zsh에는 `read -p`가 없다(`no coprocess`) — 쓰려면 `read "PW?..."`다.

`--apply`는 `--trial`과 **같은 경로**를 지난다 — 다른 것은 마지막에 커밋하느냐뿐이다. 검증도 커밋 전 같은 트랜잭션에서 돌아, 어긋나면 아무것도 쓰이지 않고 종료 코드가 1이다.

⚠️⚠️ **검증은 "원본이 운영인가"를 묻지 않는다.** 원본과 대상의 행 수·내용이 같은지만 본다 — 낡은 사본을 가리키면 **조용히 통과한다.**
그래서 이관기가 시작할 때 어디를 읽고 어디에 쓰는지 한 줄 찍는다. 그 줄이 `postgres@…pooler.supabase.com/postgres`가 아니면 멈춘다:

```
[migration] 원본 postgres@52.x.x.x/postgres  →  대상 tripcanvas@10.x.x.x/tripcanvas
```

⚠️ **대상이 staging인지도 눈으로 확인한다.** 원본과 대상 URI가 같으면 스크립트가 거부하지만, 그 앞의 실수(운영을 대상으로 적음)는 막아 주지 않는다.

⚠️ 이 시점부터 **staging DB는 버려도 되는 DB다.** 전환 당일 `--apply --reset`이 다시 비우고 채우므로, 아래에서 만드는 초대·후보·코멘트는 그때 전부 사라진다.

## 1. 배선 — 웹이 staging API를 보게 한다

가장 짧은 길은 **SSH 로컬 포워딩**이다. `app.js`는 hostname이 `localhost`면 API를 `http://localhost:3000`으로 잡고(`app.js:3467`), CORS 기본 허용 목록에 `http://localhost:8000`이 이미 들어 있다(`next/src/server/api/cors.ts`). **코드도 설정도 건드릴 것이 없다.**

```bash
# NAS — 빌드(DS920+에서 몇 분) → api·realtime만 올린다. reverse-proxy는 뺀다: 도메인이 없어 Caddy가 인증서를 못 받는다
cd ~/tripcanvas
sudo docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml build api realtime
sudo docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up -d api realtime
sudo docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'        # api Up · 127.0.0.1:3000->3000
curl -s http://127.0.0.1:3000/api/health                              # Next 부팅에 10초쯤 — 3초 만에 찍으면 000이다

# 노트북 — 두 포트를 당겨 온다. keepalive가 없으면 조용히 끊긴다(아래 ⚠️)
ssh -N -o ServerAliveInterval=30 -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 <NAS>
python3 -m http.server 8000     # 저장소 루트에서 — http://localhost:8000
```

`-N`은 명령 없이 터널만 여는 옵션이라 **성공하면 아무것도 안 찍고 멈춰 있는 것이 정상**이다. 그 창은 검증 내내 살아 있어야 한다.

⚠️ **Synology sshd는 `AllowTcpForwarding no`가 기본이다.** 터널 창에 `channel N: open failed: administratively prohibited`가 반복되면 그것이다. 열린 세션은 닫지 말고(잠기면 여기서 되돌린다):

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
sudo sed -i 's/^#\?AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config
sudo grep -i allowtcpforwarding /etc/ssh/sshd_config      # 줄이 없으면 echo 'AllowTcpForwarding yes' | sudo tee -a /etc/ssh/sshd_config
sudo synosystemctl restart sshd                            # DSM 7. 기존 세션은 유지된다
```

⚠️ **터널은 소리 없이 죽는다.** 실제로 로그인·목록은 됐는데 잠시 뒤 저장만 "클라우드 저장 실패"가 났고, 서버·데이터는 멀쩡했다 — 그사이 터널이 끊긴 것이다. `curl localhost:3000/api/health`가 `000`이면 다른 것을 의심하기 전에 터널 창부터 본다(`pgrep -fl "ssh -N"`).

`deploy/.env`에서 이번에 바꾸는 값:

| 변수 | staging 값 | 왜 |
|---|---|---|
| `TC_MIGRATION_TRIP` · `_COLLAB` · `_ADAPTIVE` · `_PRICING` | `NEW_BACKEND` | 새 DB가 진실이어야 이 검증에 의미가 있다 |
| `REALTIME_URL` | `ws://localhost:3001/ws` | **브라우저가 보는 주소**다 — 터널 너머의 사이드카. 운영은 `wss://<도메인>/ws` |
| `AUTH_SECRET` | **넣지 않는다** | 넣는 순간 Auth까지 함께 바뀐다(규칙 1) |
| `TRUSTED_ORIGINS` | 비워 둔다 | 기본값에 `http://localhost:8000`이 있다. **넣는 순간 기본값은 쓰이지 않는다** — 넣으려면 이 주소를 직접 포함시킬 것 |

⚠️ 코드가 실제로 보는 레지스트리 도메인은 **`TRIP`·`COLLAB`·`ADAPTIVE`·`PRICING` 넷뿐이다**(`route-deps.ts`·`composeGateway.ts`). 나머지(`AUTH`·`BOOKING`·`REALTIME`·`STORAGE`)는 자리만 잡아 둔 것이라 값을 바꿔도 아무 일도 일어나지 않는다. 실시간을 고르는 것은 `REALTIME`이 아니라 **`COLLAB` + `REALTIME_URL`** 이다(`meRoutes.resolveRealtime`).

⚠️ 도메인이 없어 staging에서는 Caddy(HTTPS)를 쓰지 않는다. tailnet 안의 http로 보므로 `ws://`도 브라우저가 막지 않는다 — 페이지가 https였다면 `wss://`만 허용된다. 운영은 https·wss 한 쌍이다.

⚠️ SSH 터널 대신 tailnet 주소(`http://<tailscale IP>:3000`)로 직접 붙을 수도 있지만, 그때는 웹이 그 주소를 알아야 한다 — `app.js`보다 먼저 도는 인라인 스크립트로 `window.__TC_API_BASE`를 심어야 하고, 그 편집은 **커밋하지 않는다.** 터널 쪽이 흔적을 남기지 않는다.

배선 확인 — 세 줄이면 끝난다:

```bash
curl -s localhost:3000/api/health                            # {"ok":true,"api":"ok","database":"ok",...}
curl -s localhost:3000/api/v1/auth-config                    # {"provider":"SUPABASE",...}
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/v1/trips   # 401 — 정상(인증 요구)
```

## 2. 로그인

| 확인 | 기대 | 어긋나면 |
|---|---|---|
| `/api/v1/auth-config` | `provider: "SUPABASE"` | `TRIPCANVAS`면 `AUTH_SECRET`이 섞여 들어갔다. 빼고 `api` 재시작 |
| 로그인(운영 계정 그대로) | 헤더에 이름이 뜬다 | 콘솔에 `getUser` 경고가 보이면 프로젝트가 HS256이다 — `SUPABASE_JWT_SECRET`을 넣는다 |
| `/api/v1/me` | 여행 목록·역할이 **운영과 같은 개수** | 아래 ⚠️ |
| 여행 하나 열기 | 일정·지도·비용이 그대로 | 문서 내용이 다르면 이관 검증이 놓친 것 — 즉시 중단하고 `verify` 리포트부터 다시 본다 |

R1 기준 수치: `trips` 8 중 tombstone 3 → `/me`에는 **5개**, `trip_members` 9(ACTIVE), `trip_snapshots` 98.

⚠️ **여행이 0개로 보이는 것이 첫 증상이라면 Auth가 아니라 이관을 의심한다.** 새 DB 경로는 요청마다 `users` 행을 `ensure`한다(`route-deps.ts`) — 이관 전에 로그인하면 **빈 사용자 행만 생기고 여행이 없다.** 로그인은 성공하므로 Auth 문제로 오해하기 쉽다.

## 3. 저장

```bash
psql "$TARGET" -c "select client_id, revision, updated_at, deleted_at from trips order by updated_at desc limit 5;"
```

- [ ] 장소 하나 추가 → 저장 → 위 쿼리에서 그 여행의 `revision`이 **1 오른다**
- [ ] **서로 모르는 두 클라이언트**(일반 창 + 시크릿 창, 같은 계정)에서 같은 여행을 열고 양쪽에서 편집 → 뒤늦은 쪽에 **충돌 카드**가 뜬다(409 `STALE_VERSION` → `api.js`가 예전 CAS 모양으로 옮긴다). 조용히 덮어쓰면 실패다
- [ ] 여행 삭제 → `deleted_at`이 찍히고 다른 창에서 사라진다(tombstone)
- [ ] 되돌리기(undo) → **충돌 카드(remote-deleted)가 뜨고 [이 기기 버전]을 고르면** 복원돼 다시 목록에 나온다
- [ ] 버전 이력 패널 → 이관된 스냅샷이 보인다(`GET /api/v1/trips/:id/snapshots`)

⚠️ **같은 브라우저의 탭 둘로는 충돌이 안 난다.** 탭들이 localStorage를 공유해서, B 탭이 편집하기 전에 A의 변경을 storage 이벤트로 먼저 받아 버린다("다른 탭의 변경을 불러왔습니다"). 그건 탭 간 동기화가 동작한 것이지 CAS 검증이 아니다 — 충돌은 시크릿 창이나 다른 기기로 본다.

⚠️ **되돌리기가 카드 없이 곧장 복원되면 그게 오히려 이상하다.** 되살리려는 PUT을 서버가 tombstone 행이라 거절하고(`updateCas`의 `deletedAt` 검사), 레거시 `sync_trip`도 같은 규칙이었다(`202609020001_trip_collaboration.sql:209`). 카드에서 기기 버전을 고르면 `force`로 올라간다.

⚠️ **예약 가격 기능은 만지지 않는다.** 가격 관측은 웹이 아직 Supabase를 직접 부른다(`app.js:2249`) — staging에서 관측을 남기면 **운영 Supabase에 쓴다.** 이관 대상 밖의 유일한 쓰기 경로다.

## 4. 협업

두 계정이 필요하다(운영 계정 그대로 쓴다 — Auth는 Supabase다). 두 번째 계정은 다른 브라우저 프로필이나 시크릿 창으로 연다.

- [ ] 소유자: 초대 만들기 → `#join=<token>` 링크
- [ ] **로그아웃 상태**에서 그 링크 열기 → 이름·기간·역할만 보이고 본문은 없다(`invite_preview`는 토큰 없이 나간다)
- [ ] 두 번째 계정으로 수락 → 멤버 2명, 역할 EDITOR
- [ ] VIEWER로 낮춘 뒤 저장 시도 → 막히고(42501) **재시도 루프에 들어가지 않는다**(`isForbiddenError`)
- [ ] 후보 담기 · 반응(MUST/OK/PASS) · 코멘트 — 보기 권한도 의견은 낼 수 있다
- [ ] 공유받은 쪽의 "삭제"가 **나가기**(`leave_trip`)로 동작한다

실시간:

```bash
curl -s localhost:3000/api/v1/me -H "Authorization: Bearer <토큰>" | grep -o '"realtime".*'
# {"realtime":{"provider":"TRIPCANVAS","url":"ws://localhost:3001/ws"}}

docker compose -f deploy/docker-compose.yml exec realtime wget -qO- localhost:3001/health
# {"ok":true,"listener":"LISTENING",...}
```

- [ ] 두 창을 나란히 두고 한쪽에서 후보를 담으면 다른 쪽 보드가 **다시 읽어 갱신된다**(내용은 payload가 아니라 API에서 온다)
- [ ] 사이드카를 내려도(`stop realtime`) 앱은 그대로 돈다 — 탭 복귀 pull 폴백

⚠️ `listener`가 `RECONNECTING`이면 **503이고 조용한 고장이다** — 끊긴 LISTEN은 오류를 내지 않고 이벤트만 영원히 안 온다. 이 값을 눈으로 확인하고 넘어간다.

⚠️ `provider`가 `NONE`이면 `REALTIME_URL`이 비었고, `SUPABASE`면 `TC_MIGRATION_COLLAB`이 아직 `LEGACY`다. 서버는 켜진 척하지 않으므로 이 값이 곧 진단이다.

## 5. 롤백

```bash
# deploy/.env 의 TC_MIGRATION_* 를 전부 LEGACY 로
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up -d api
```

- [ ] `/api/v1/me`의 `realtime.provider`가 `SUPABASE`로 돌아온다
- [ ] 여행 목록이 다시 **운영 Supabase의 것**으로 보인다(staging에서 만든 편집은 없다)
- [ ] 다시 `NEW_BACKEND`로 올려도 staging DB의 내용이 그대로다

⚠️⚠️ **LEGACY로 되돌린 staging API는 운영 Supabase에 그대로 쓴다.** 이 단계에서는 **읽기만 한다.** 저장까지 꼭 봐야 한다면 버릴 여행 하나를 만들고 확인한 뒤 지운다 — 기존 여행을 편집하지 않는다.

staging 동안 새 DB에 쌓은 변경은 Supabase에 없다. 그것이 롤백의 비용이고, 그래서 전환 후 관찰 기간에는 Supabase를 read-only로 만들지 않는다(§102).

## 통과 기준

- [ ] 0단계 `--apply` 검증 통과(개수·고아·내용·소유권)
- [ ] 1단계 배선 3줄(health · auth-config · 401)
- [ ] 2단계 로그인 — 여행 개수·역할이 운영과 같다
- [ ] 3단계 저장 — revision 증가 · 충돌 카드 · tombstone · 버전 이력
- [ ] 4단계 협업 — 초대·수락·권한 거절·후보·실시간(LISTENING)
- [ ] 5단계 롤백 — LEGACY로 돌아가고 다시 올라온다

전부 통과하면 `docs/backup-restore.md`의 R2 행을 **통과**로 바꾸고, 걸린 시간과 막힌 곳을 그 문서에 남긴다.

## 증상 → 볼 곳

| 증상 | 볼 곳 |
|---|---|
| 여행이 0개 | 이관 여부(2단계 ⚠️). `select count(*) from trips` |
| 로그인은 되는데 모든 API가 401 | 토큰은 Supabase인데 `SUPABASE_JWT_SECRET`이 필요한 프로젝트다 — `api` 로그의 경고 |
| 브라우저 콘솔에 CORS 오류 | `TRUSTED_ORIGINS`를 설정했고 그 안에 `http://localhost:8000`이 없다 |
| 웹이 운영 API를 부른다 | 터널이 끊겼고 hostname이 localhost가 아니다 — 주소창이 `localhost:8000`인지 |
| 실시간만 안 온다 | `/me`의 provider → 사이드카 `/health`의 `listener` 순서로 |
| 저장이 42501 | 역할이 VIEWER다. 의도한 것이 아니면 `trip_members`의 role |
| `docker compose port`가 비어 있다 | override 없이 올렸다 — `-f deploy/docker-compose.staging.yml`을 빠뜨렸는지 |
| curl이 **전부** `000` | 터널이 죽었다. `pgrep -fl "ssh -N"` → 없으면 keepalive 붙여 다시. NAS 안에서 `curl 127.0.0.1:3000/api/health`가 200이면 확실히 터널이다 |
| 터널 창에 `administratively prohibited` | sshd의 `AllowTcpForwarding no` — 1단계 ⚠️ |
| `api`·`realtime`이 `Created`에서 안 움직인다 | `migrate`가 죽었다(`sudo docker logs tripcanvas-migrate-1`). 오류 문구 없이 `applying migrations...`에서 끝났으면 **`.env` 비밀번호 불일치** — 준비 절의 CONNECT 판정 한 줄 |
| `rsync`가 `Permission denied`인데 `ssh`는 된다 | macOS 15의 rsync(openrsync). tar over ssh로 |
| "여행 N개"가 운영과 다르다 | 계정별로 센다 — 운영 8건 중 tombstone 3을 뺀 5는 **계정 셋의 합**이지 한 계정의 수가 아니다. 같은 계정으로 운영 웹을 열어 세는 것이 기준 |

## 실행 기록

### 2026-09-04 — NAS(DS920+) 0~3단계 · 컨테이너 Chromium 2~4단계

**NAS에서 사람이**: 준비(저장소 tar 전송 · `.env` 비밀번호 불일치 → 재설정 · `AllowTcpForwarding`) → 0단계 `--apply --reset`(3 · 8 · 98) → 1단계 배선 3줄 → 2단계 로그인·**여행 4개 = 운영 4개** → 3단계 저장·삭제·복원·이력 ok. 충돌은 같은 브라우저 탭으로 시도해 "다른 탭의 변경을 불러왔습니다"만 봤다(위 ⚠️ — 검증이 아니다). 4·5단계는 NAS에서 아직 안 밟았다.

막힌 곳은 전부 **배선**이었고 서버·데이터 결함은 없었다: 터널 keepalive 없이 끊김 → "클라우드 저장 실패"(재연결 후 바로 저장됨).

**컨테이너에서 Chromium으로**: 같은 스택(정적 웹 :8000 · Next API :3000 `NEW_BACKEND` · 실시간 :3001 · PostgreSQL 16)을 띄우고 이관된 모양 그대로 시드했다 —
`users`·`trips`를 **직접 insert**(소유자 멤버 행 없음) · 스냅샷 3건 · B가 EDITOR인 공유 여행. Auth만 대역이다: `SUPABASE_JWT_SECRET`을 테스트 값으로 두고 HS256 토큰을 찍어
`window.supabase` 자리에 세션만 주는 가짜 클라이언트를 넣었다(e2e의 `fakeSupabase`와 같은 수법). **데이터 호출은 전부 진짜 API·DB**다. 독립 컨텍스트 넷(A · A의 두 번째 기기 · B · 로그아웃)으로 **14/14 통과**:

| | 결과 |
|---|---|
| 2 로그인·목록 | 여행 2개, 역할 OWNER·OWNER, "클라우드 동기화 완료" · 장소 카드 25 |
| 3-1 저장 | revision 7 → 8 |
| 3-2 충돌 | 뒤늦은 기기에 카드, 서버 revision 안 덮임 |
| 3-3 삭제 → 되돌리기 | tombstone → 카드(remote-deleted) → [이 기기 버전] → 복원 |
| 3-4 버전 이력 | 이관 3 + 저장분 1 = 4행 |
| 4-1~3 초대·미리보기·수락 | 로그아웃 미리보기는 기간·역할만 · 수락 후 A 목록에 B(EDITOR) |
| 4-4 VIEWER 저장 | **PUT 0회** — 클라이언트가 `canEdit`에서 막아 보내지도 않는다 · roleBar 표시 |
| 4-5 후보·반응·코멘트 | DB 1 / 2 / 1 |
| 4 실시간 | B 반응 → A 보드 새로고침 없이 갱신 · 사이드카 `LISTENING` |
| 4-6 나가기 | `status=LEFT`, 여행은 그대로 |

**5단계 롤백(NAS)**: `.env`의 `TC_MIGRATION_*` 넷을 `LEGACY`로 → `up -d api` → 시크릿 창에서 보니 **운영 데이터가 그대로** 보였고, `NEW_BACKEND`로 되돌리니 staging 편집이 다시 나왔다. 통과.

### 그때 드러난 것 — 검증이 통과했는데 멤버 한 명이 없었다

롤백 뒤 함께하기에서 **공유 멤버(`복구`, EDITOR)가 사라져 있었다.** 운영과 대조하니 세 테이블이 조금씩 뒤처져 있었다:
`trip_members` 9 → 8 · `trip_activity` 31 → 30 · `hotel_price_snapshots` 38 → 34.

- 이관 자체는 멀쩡했다. 그날의 `--apply`가 **운영이 아니라 낡은 사본을 원본으로 읽었고**, 검증은 원본·대상만 비교하므로 그대로 통과했다.
- 운영을 가리켜 다시 돌리니 `trip_members 9행 → 9건`으로 맞았다(개수·고아·내용 전부 ok, 3초).
- RLS 때문이 아님을 먼저 배제했다: 운영은 RLS가 켜져 있지만 `postgres` 역할은 `BYPASSRLS`라 pooler로 붙으면 9행이 다 보인다. `pgSource`의 읽기도 `select *` 한 줄이라 거르는 것이 없다.
- 그래서 **원본·대상 신원을 시작할 때 찍는 한 줄**을 이관기에 넣었다(`describeConnection`). 전환 당일 같은 실수를 반복하지 않기 위해서다.

이것이 이번 리허설이 실제로 잡아낸 유일한 사고이고, 잡힌 곳이 staging이라 리허설이 제 몫을 했다.

### iOS staging도 같은 날 통과했다

웹과 달리 iOS는 자동 감지가 없다 — `Info.plist`의 `TCApiBaseURL`을 바꿔야 한다(`AppEnvironment.swift`). `ios/project.yml`에서 두 줄만 고치고 **커밋하지 않는다**:

```yaml
        TCApiBaseURL: "http://localhost:3000"   # 시뮬레이터는 맥의 localhost를 그대로 쓴다(터널 필요)
        NSAppTransportSecurity:
          NSAllowsLocalNetworking: true          # http라서 ATS 예외가 필요하다
```

```bash
brew install xcodegen
cd ios && xcodegen generate && open TripCanvas.xcodeproj
# 되돌리기: git checkout ios/project.yml && cd ios && xcodegen generate
```

확인된 것: **로그인**(운영 Supabase 토큰을 staging API가 검증) · **여행 목록 4개** · **오늘 화면**(`/api/v1/trips/:id/today`가 판단한 순서·시각·지도) · **이동시간 "(예상)" 표기**(`travelTimeSource != .routed` — 서버엔 구간 캐시가 없어 직선거리 추정이다).

⚠️ 시뮬레이터가 `Application failed preflight checks`로 실행을 거부하면 앱이 아니라 시뮬레이터 상태다:
`xcrun simctl shutdown all; xcrun simctl erase all` 뒤 다시. 그래도 막히면 entitlements(App Group·푸시)가 없는 `project-free.yml`로 본체 앱만 만든다.

확인된 것 하나 더: `member_count`는 레거시 `my_trip_roles`도 `trip_members` ACTIVE 행 수라(`202609020001:250`), 소유자 행이 없는 이관 여행의 인원 표시는 **전과 같다** — 회귀가 아니다.

## 검증이 끝나면

- staging DB는 손댄 상태다. 전환 당일 `--apply --reset`이 비우고 다시 채우므로 **정리할 것은 없다.**
- ~~staging override는 운영 전환 전에 뺀다~~ — **2026-09-04 전환 뒤로는 빼면 안 된다.** Funnel이 호스트의 `3000`·`3001`로 넘기는데 그 포트를 내는 것이 이 override다. 빼면 API가 죽는다(`docs/nas-deployment.md`).
- iOS staging까지 끝났으므로(위 실행 기록) 다음은 **전환 당일 순서**다(`docs/backup-restore.md`). 오늘 확인한 것들이 그대로 쓰인다 — 원본 신원 한 줄 · `--apply --reset` · 커밋 전 검증.
- 그때는 검증이 끝나면 포트를 닫는 게 맞았지만, 지금은 같은 override가 운영을 떠받치고 있다 — 닫아도 되는 것은 postgres의 `15432`뿐이다.
