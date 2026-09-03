# NAS 배포 — TripCanvas API

> ⚠️ 이 구성은 **Docker가 없는 환경에서 작성돼 실행해 보지 않았다.** 첫 배포는 아래 "처음 띄울 때"의 확인 절차를 그대로 밟을 것.
> 오늘의 프로덕션은 여전히 Vercel(`tripcanvas-api.vercel.app`)이다. NAS는 staging으로 먼저 쓴다(§101).

## 구성 (§52~§56)

`deploy/docker-compose.yml`

| 서비스 | 이미지 | 역할 | 노출 |
|---|---|---|---|
| `reverse-proxy` | caddy:2 | HTTPS 자동 발급, `api:3000`으로 전달 | **80·443만 외부** |
| `api` | `next/Dockerfile` (target `runtime`) | Next standalone, `/api/v1/*` · `/api/health` | 내부 3000 |
| `migrate` | `next/Dockerfile` (target `migrate`) | `drizzle-kit migrate` 일회 실행. 성공해야 `api`가 뜬다 | — |
| `postgres` | postgres:17 | source of truth | 내부 네트워크만(5432 비공개, §54) |
| `backup` | postgres:17 | 매일 `pg_dump` → `BACKUP_DIR` | — |

`internal` 네트워크는 `internal: true`라 인터넷과 단절돼 있다. MinIO·Redis는 필요해질 때 같은 방식으로 붙인다(§46·§47·§55).

## 환경변수

`deploy/.env.example` → `deploy/.env`. 비밀은 Git에 올리지 않는다(§58). `api`는 이 파일과 `DATABASE_URL`(compose가 조립)을 받는다.

| 변수 | 뜻 |
|---|---|
| `API_DOMAIN` | Caddy가 인증서를 받을 도메인. 클라이언트는 이 주소만 안다 |
| `POSTGRES_*` | DB 계정 |
| `TC_MIGRATION_TRIP` | 이관 레지스트리. staging은 `NEW_BACKEND`, 프로덕션 전환 전에는 `LEGACY` |
| `NEXT_PUBLIC_SUPABASE_*` · `SUPABASE_JWT_SECRET` | Phase A — Supabase 토큰 검증 |
| `BACKUP_DIR` · `BACKUP_KEEP_DAYS` | 덤프 위치(DB 볼륨과 다른 곳) · 보관 일수 |

## 처음 띄울 때

```bash
cp deploy/.env.example deploy/.env      # 값 채우기
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs migrate     # "[✓] migrations applied" 류의 성공 로그
curl -s https://$API_DOMAIN/api/health                       # {"ok":true,"api":"ok","database":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" https://$API_DOMAIN/api/v1/trips   # 401 — 정상(인증 요구)
```

확인 순서: `migrate`가 성공했는가 → `api` healthcheck가 healthy인가 → 401이 오는가 → 실제 Supabase 토큰으로 `/api/v1/trips`가 200인가.

## 빌드 주의

- 컨텍스트는 **저장소 루트**다(`context: ..`) — 판단 엔진(`adaptive.js` 등)이 루트에 있어 `next/`만으로는 빌드가 안 된다(Vercel의 "Include files outside root"와 같은 이유).
- `TC_STANDALONE=1`일 때만 `output: 'standalone'`. `outputFileTracingRoot`가 루트라 standalone 안 경로가 `next/server.js`다.
- `migrate` 타깃은 devDependencies(drizzle-kit)를 포함한 빌드 스테이지를 그대로 쓴다 — 런타임 이미지에는 싣지 않는다.
- Alpine 이미지에 `wget`이 있어 healthcheck에 쓴다.

## 프로덕션 전환 순서 (§101)

```
NAS Backend 완성 → staging 검증(위 확인 절차) → 데이터 이관 리허설(docs/backup-restore.md) → Web staging → iOS staging(TCApiBaseURL)
→ 실사용 테스트 → 프로덕션 DB 이관 → TC_MIGRATION_TRIP=NEW_BACKEND → Supabase read-only → 관찰 → Supabase 종료(일정 기간 보존, §102)
```

롤백: `TC_MIGRATION_TRIP=LEGACY`로 되돌리고 `api` 재시작. 단 새 DB에 쓴 뒤라면 그 변경은 Supabase에 없다 — 전환 직후 관찰 기간에는 두 쪽을 비교한다(§79·§80).

## 아직 없는 것

- Realtime(WebSocket) 서비스 — Phase 6. Caddy에 `/ws` 경로를 더해 사이드카로 붙일 자리
- MinIO — Phase 7(현재 필요 없음)
- 오프사이트 백업 복제 — NAS 쪽 설정(Hyper Backup 등). `docs/backup-restore.md`
