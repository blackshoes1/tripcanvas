# 관리형 런타임 배포 파일 (deploy/managed)

여기 있는 것은 **애플리케이션 코드가 아니라 한 provider의 배포 설정**이다. 앱은 `DATABASE_URL`·`AUTH_SECRET`·`API_BASE_URL`·
`REALTIME_URL` 같은 환경변수만 알고, 어느 회사 위에서 도는지 모른다(`docs/managed-infrastructure.md`).
provider가 바뀌면 이 폴더만 바뀐다.

| 파일 | 무엇 |
|---|---|
| `fly.api.toml` | Fly.io — API 앱(`next/Dockerfile`의 `runtime` 타깃). `/api/health`로 헬스체크 |
| `fly.realtime.toml` | Fly.io — 실시간 사이드카 앱(`realtime` 타깃). 잠들지 않는다(`min_machines_running = 1`) — LISTEN이 끊기면 알림이 영영 안 온다 |
| `env.managed.example` | 두 앱에 넣을 환경변수 **이름** 목록. 값은 provider의 시크릿 저장소에만 둔다 |
| `../../.github/workflows/managed-staging.yml` | **버튼을 눌러야** 도는 staging 배포. 시크릿이 없으면 시작하지 않고, 값을 출력하지 않는다 |

## 왜 컨테이너 런타임인가

- API는 응답을 보낸 **뒤에** 배경에서 구간 캐시를 채운다(`legFiller`, fire-and-forget). 요청이 끝나면 얼어붙는 서버리스 함수에서는 그 작업이 끊긴다.
- 실시간은 WebSocket + PostgreSQL `LISTEN` 연결을 **계속** 들고 있어야 한다. 서버리스 함수 하나를 WebSocket 서버처럼 쓰지 않는다.
- 이미지는 이미 있다(`next/Dockerfile`, NAS와 같은 것). 관리형 런타임은 그 이미지를 그대로 받는다.

## 처음 한 번 (staging)

```bash
fly apps create withj-api-staging      --org <org>
fly apps create withj-realtime-staging --org <org>
# 비밀은 파일에 두지 않는다 — 콘솔 또는 아래처럼 표준 입력으로. 셸 히스토리에 값이 남지 않게 read로 받는다
read -r -s -p "DATABASE_URL: " V; printf '%s' "$V" | fly secrets set DATABASE_URL=- --app withj-api-staging; unset V
```

`env.managed.example`의 이름을 하나씩 넣는다. **API와 실시간은 같은 `AUTH_SECRET`·같은 DB**를 봐야 한다 — 다르면 아무도 실시간에 못 붙는다.

## 배포

```bash
# 저장소 루트에서 — Docker 컨텍스트가 루트여야 판단 엔진(adaptive.js 등)이 이미지에 들어간다
fly deploy . --config deploy/managed/fly.api.toml      --app withj-api-staging      --remote-only --build-arg TC_REVISION="$(git rev-parse HEAD)"
fly deploy . --config deploy/managed/fly.realtime.toml --app withj-realtime-staging --remote-only --build-arg TC_REVISION="$(git rev-parse HEAD)"
```

또는 GitHub Actions → *Managed staging deploy* → Run workflow. 마이그레이션은 앱이 아니라 **사람이** 돌린다:

```bash
cd next && MIGRATE_DATABASE_URL='<소유자 계정 직접 주소>' npm run db:migrate
```

## 확인 (밖에서)

```bash
curl -s https://withj-api-staging.fly.dev/api/health | head -c 800        # status HEALTHY · components.realtime ok · backup ok
curl -s -o /dev/null -w '%{http_code}\n' https://withj-api-staging.fly.dev/api/v1/trips   # 401
curl -s --http1.1 -o /dev/null -w '%{http_code}\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://withj-realtime-staging.fly.dev/ws   # 101
```

⚠️ 앱 이름·리전·머신 크기·`flyctl` 플래그는 **provider 콘솔·문서에서 그때의 값으로 확인**한다. 이 파일들은 작성 시점의 예시이고,
작성 환경에서 Fly에 실제로 배포해 보지는 않았다(`docs/managed-infrastructure.md`의 검증 표).
