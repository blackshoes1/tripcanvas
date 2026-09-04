# R2 staging 앱 검증

> 이관은 **"같다"** 까지 왔다(R1 · R2 이관 부분 — `docs/backup-restore.md`). 남은 질문은 하나다:
> **옮겨진 데이터 위에서 앱이 그대로 도는가.** 스크립트가 판정하는 것은 데이터고, 여기서 판정하는 것은 동작이다.

확인할 것은 넷이다 — **로그인 · 저장 · 협업 · 롤백.** 하나라도 통과하지 못하면 전환하지 않는다(§79).

## 규칙 셋

1. **한 번에 한 가지만 바꾼다.** 이 검증에서 바꾸는 것은 **저장소(레지스트리)뿐**이다. Auth는 Supabase 그대로 둔다 — `AUTH_SECRET`을 넣지 않는다. 자체 Auth 전환(PR11)은 별개의 결정이고, 섞으면 무엇이 깨졌는지 가릴 수 없다.
2. **운영 Supabase는 읽기만.** 이관기는 원본에 쓰지 않는다. 다만 **롤백 검증(5단계)만은 다르다** — 그때는 staging API가 운영에 쓸 수 있다. 그 절에 따로 적는다.
3. **운영 웹(`tripcanvas-ai.vercel.app`)을 staging에 붙이지 않는다.** 같이 쓰는 사람이 staging DB를 보게 된다. 웹은 로컬에서 연다.

## 0. 준비 — staging DB를 실데이터로 채운다

R1·R2는 `--trial`이라 되돌렸다. 앱 검증은 되돌려진 트랜잭션 위에서 할 수 없으므로 **여기서 한 번은 커밋한다.**

```bash
cd next && npm run tools:build
read -r -p "원본(운영 또는 복원한 사본) URI: " LEGACY
read -r -p "NAS DB 비밀번호: " PW
TARGET="postgres://tripcanvas:$PW@<NAS의 tailscale IP>:15432/tripcanvas"

DATABASE_URL="$TARGET" npm run db:migrate                                          # 스키마 최신화
LEGACY_DATABASE_URL="$LEGACY" DATABASE_URL="$TARGET" npm run migrate:import -- --apply --reset
unset LEGACY PW
```

`--apply`는 `--trial`과 **같은 경로**를 지난다 — 다른 것은 마지막에 커밋하느냐뿐이다. 검증도 커밋 전 같은 트랜잭션에서 돌아, 어긋나면 아무것도 쓰이지 않고 종료 코드가 1이다.

⚠️ **대상이 staging인지 먼저 확인한다.** 원본과 대상이 같으면 스크립트가 거부하지만, 그 앞의 실수(운영을 대상으로 적음)는 막아 주지 않는다.

```bash
psql "$TARGET" -Atc "select current_database(), inet_server_addr(), (select count(*) from trips)"
```

⚠️ 이 시점부터 **staging DB는 버려도 되는 DB다.** 전환 당일 `--apply --reset`이 다시 비우고 채우므로, 아래에서 만드는 초대·후보·코멘트는 그때 전부 사라진다.

## 1. 배선 — 웹이 staging API를 보게 한다

가장 짧은 길은 **SSH 로컬 포워딩**이다. `app.js`는 hostname이 `localhost`면 API를 `http://localhost:3000`으로 잡고(`app.js:3467`), CORS 기본 허용 목록에 `http://localhost:8000`이 이미 들어 있다(`next/src/server/api/cors.ts`). **코드도 설정도 건드릴 것이 없다.**

```bash
# NAS — api·realtime·postgres 포트를 호스트 127.0.0.1에만 낸다(staging 전용 override)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.staging.yml up -d

# 노트북 — 두 포트를 당겨 온다
ssh -N -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 <NAS>
python3 -m http.server 8000     # 저장소 루트에서 — http://localhost:8000
```

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
- [ ] 같은 여행을 두 탭에서 열고 양쪽에서 편집 → 뒤늦은 쪽에 **충돌 카드**가 뜬다(409 `STALE_VERSION` → `api.js`가 예전 CAS 모양으로 옮긴다). 조용히 덮어쓰면 실패다
- [ ] 여행 삭제 → `deleted_at`이 찍히고 다른 탭에서 사라진다(tombstone)
- [ ] 되돌리기(undo)로 복원 → 다시 목록에 나온다
- [ ] 버전 이력 패널 → 이관된 스냅샷이 보인다(`GET /api/v1/trips/:id/snapshots`)

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

## 검증이 끝나면

- staging DB는 손댄 상태다. 전환 당일 `--apply --reset`이 비우고 다시 채우므로 **정리할 것은 없다.**
- staging override는 운영 전환 전에 뺀다 — `-f deploy/docker-compose.staging.yml` 없이 `up -d`. 포트가 다시 닫힌다.
- 다음은 iOS staging(`TCApiBaseURL`)이고, 그다음이 전환 당일 순서다(`docs/backup-restore.md`).
