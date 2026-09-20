# Render managed staging 검증 기록

> 상태: 2026-09-17 기준 **부분 완료**. 프로덕션에는 영향 없음.

관리형 인프라 전환 준비 코드가 실제 외부 provider에서도 동작하는지 확인하기 위해 Render에 격리된 staging 리소스를 만들었다.

## 생성한 리소스

| 역할 | 이름 | 리전 | 상태 |
|---|---|---|---|
| PostgreSQL | `withj-staging-postgres` | Singapore | available |
| API | `withj-api-staging` | Singapore | 생성 및 빌드 진행 |
| Realtime | `withj-realtime-staging` | Singapore | 생성 및 빌드 진행 |

- PostgreSQL: PostgreSQL 17, free staging instance
- API URL: `https://withj-api-staging.onrender.com`
- Realtime URL: `https://withj-realtime-staging.onrender.com`
- 두 서비스 모두 `main`의 `6b3cc4c98054c44ed57288fa640a30a9b8a24dfa`를 기준으로 생성했다.
- auto deploy는 껐다. 이후 `main` 변경이 자동으로 staging에 반영되지 않는다.

## API 서비스 설정

Build:

```bash
cd next && npm ci && npm run build && npm run tools:build
```

Start:

```bash
cd next && npm start
```

설정된 공개 주소:

```text
API_BASE_URL=https://withj-api-staging.onrender.com
REALTIME_URL=wss://withj-realtime-staging.onrender.com/ws
REALTIME_HEALTH_URL=https://withj-realtime-staging.onrender.com/health
```

`TC_MIGRATION_TRIP/COLLAB/ADAPTIVE/PRICING=NEW_BACKEND`와 staging 전용 `AUTH_SECRET`도 설정했다. 실제 값은 문서에 남기지 않는다.

## Realtime 서비스 설정

Build:

```bash
cd next && npm ci && npm run tools:build
```

Start:

```bash
cd next && REALTIME_PORT=$PORT npm run realtime
```

API와 같은 staging 전용 `AUTH_SECRET`을 사용한다.

## 현재 막힌 지점

Render ChatGPT 연동으로 PostgreSQL 생성은 가능했지만, 연결 비밀번호와 connection string은 도구 응답에 노출되지 않는다. `get_postgres`에서도 DB 이름·사용자·리전·상태만 반환된다.

따라서 아래 값은 아직 API/realtime에 주입하지 않았다.

```text
DATABASE_URL
REALTIME_DATABASE_URL
MIGRATE_DATABASE_URL
```

Render의 read-only SQL 도구도 이 staging DB에 대해 TLS 연결 오류(`SSL/TLS required`)를 반환해서 마이그레이션을 대신 실행할 수 없었다.

이 제한은 애플리케이션 코드 문제가 아니라 현재 연결 도구의 credential/connection-string 노출 범위다.

## 다음 단계

Render Dashboard의 `withj-staging-postgres`에서 connection string을 확인한 뒤 다음을 수행한다.

1. `withj-api-staging`
   - `DATABASE_URL=<Render internal connection string>`
2. `withj-realtime-staging`
   - `DATABASE_URL=<같은 DB internal connection string>`
   - `REALTIME_DATABASE_URL=<LISTEN 가능한 직접 연결 주소>`
3. 마이그레이션
   - `MIGRATE_DATABASE_URL=<소유자/직접 연결 주소>`로 `cd next && npm run db:migrate`
4. API와 realtime 재배포
5. 확인

```bash
curl -s https://withj-api-staging.onrender.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://withj-api-staging.onrender.com/api/v1/trips
```

기대값:

- `/api/health`: DB 연결 이후 `HEALTHY` 또는 백업 미구성 때문에 `DEGRADED`
- 인증 없는 `/api/v1/trips`: `401`
- realtime `/health`: LISTEN 연결 성공
- WebSocket `/ws`: upgrade 성공

그 다음 합성 데이터를 restore하고 `npm run verify:db`로 전수 대조한다.

## 프로덕션 영향

없음.

- 기존 NAS API 주소 변경 안 함
- 운영 PostgreSQL 변경 안 함
- DNS 변경 안 함
- iOS API base 변경 안 함
- Supabase fallback 변경 안 함
- NAS 종료 안 함

이 문서는 staging 검증 기록이며 production cutover 승인을 뜻하지 않는다.
