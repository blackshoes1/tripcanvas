# 🗺 With J

**With J**는 여행을 같이 계획하고, 여행 중에는 다음에 뭘 하면 좋을지 챙겨주는 앱이다. 웹(PWA)과 네이티브 iOS 앱이 같은 API를 사용한다.

- 프로덕션 웹: https://tripcanvas-ai.vercel.app — 현재 배포된 웹 버전(`tc-vNNN`)은 ☰ 메뉴 맨 아래에서 확인할 수 있다
- 저장소: https://github.com/blackshoes1/tripcanvas

> **이름 정리.** 사용자에게 보이는 제품 이름은 **With J**다. `From J`는 앱 이름이 아니라 J가 사용자에게 보내는 **제안 카드의 서명**이다.
> 저장소 이름 `tripcanvas`는 내부 식별자라 번들 ID(`com.fromj.trip`)·DB 테이블·API 경로·소스 파일 헤더 주석과 함께 그대로 유지한다.
> 이 이름들은 서명·스토어·이관과 연결돼 있어서 함부로 바꾸면 안 된다.

## 이 앱이 하는 일

With J에서 가장 중요하게 보는 건 크게 세 가지다.

**먼저 동선을 현실적으로 계산한다.** 장소를 순서대로 넣으면 이동수단별 실제 이동시간을 기준으로 도착 예상 시각을 계산한다. 국내 자차·택시는 카카오내비, 해외는 Google Routes를 사용한다.
전날 숙소에서 이어지는 출발점, 하루가 끝난 뒤 숙소로 돌아가는 구간, 렌터카 픽업·반납까지 한 타임라인에서 다룬다.
시각은 자동 계산된 **도착 예상**, 내가 직접 정한 **도착 고정**(`at`), 예약처가 정한 **예약·입장 시각**(`bookAt`)을 따로 구분한다.
예약보다 일찍 도착하면 그때까지 대기로 잡고, 늦을 것 같으면 ⚠️로 표시한다.

**일행과 같이 짤 수 있다.** 초대 링크로 멤버를 부르고 주최자/편집/보기 역할을 나눈다. 아직 일정에 넣지 않은 **가고 싶은 곳**은 후보 보드에서 같이 본다.
여러 명이 동시에 반응해도 서로의 저장을 덮어쓰지 않고, 의견이 갈린 후보는 앱이 임의로 빼지 않는다. 대신 같이 가기·자유시간으로 나누기·이번 일정에서 빼기처럼 사람이 고를 수 있는 선택지를 보여 준다.
취향은 계정 전체가 아니라 여행마다 따로 관리하고, 합의 점수도 숫자 대신 문장으로 보여 준다.

**여행 중에는 지금 필요한 것만 보여 주려고 한다.** 오늘의 흐름·다음 행동·빈 시간 채우기·다시 맞추기·출발 안내는 서버의 `adaptive.js`가 판단하고, 웹과 iOS가 같은 결과를 받는다.
알림도 일정마다 반복해서 울리는 방식이 아니라 상태가 바뀔 때만 보낸다.
J는 먼저 챙기되 대신 결정하지 않는 쪽을 원칙으로 삼고 있어서, 제안에는 항상 무시하거나 다른 선택을 할 수 있는 길을 남긴다.

## 지금의 프로덕션 구조

```
                    브라우저 (PWA)              iPhone (SwiftUI)
                         │                            │
                         └───────────┬────────────────┘
                                     │  HTTPS
                        Tailscale Funnel
                                     │
                            NAS ─────┴─────────────────────┐
                             │                             │
                     127.0.0.1:3000 (api)        127.0.0.1:3001 (realtime)
                             │                             │
                             └──────► PostgreSQL ◄─────────┘
                                          │
                                       backup (매일 pg_dump)
```

| 층 | 무엇 | 어디 |
|---|---|---|
| 웹 | 정적 PWA — 빌드 도구 없이 파일 그대로 배포 | Vercel · `tripcanvas-ai.vercel.app` |
| 서버 함수 | `api/*.js` — 카카오내비·호텔/렌터카 시세 프록시, 외부 경로 감시(`health-watch`) | Vercel |
| API | Next.js `/api/v1/*` · `/api/auth/*` — 웹·iOS가 함께 쓰는 API | **NAS** (Docker, 루프백 3000) |
| 인증 | **자체 Auth**(better-auth) — 이메일 확인 · bearer 세션 · 비밀번호 재설정 | NAS API |
| DB | **PostgreSQL 17** — source of truth, 스키마는 Drizzle 마이그레이션으로 관리 | NAS (내부 네트워크만, 외부 노출 없음) |
| 실시간 | WebSocket 사이드카 — `trip_activity` 트리거의 `pg_notify`를 LISTEN해 중계 | NAS (루프백 3001) |
| 백업 | `deploy/backup.sh` — 매일 `pg_dump --format=custom`, 보관 일수는 `BACKUP_KEEP_DAYS`. 성공은 `ops_backup_runs`에 남고 `/api/health`가 최신성을 본다 | NAS `backup` 컨테이너 |
| 공개 경로 | **Tailscale Funnel** — 도메인이 없어 Caddy가 인증서를 받을 수 없어서 TLS는 Tailscale이 처리 | — |
| iOS | 네이티브 SwiftUI(iOS 17+) + 위젯 · Live Activity · 공유 확장 · Watch — **같은 API** 사용 | 앱 |
| Supabase | **이관 자산 · 롤백 대상** — 아래 참고 | — |

현재 구조의 가장 큰 약점은 **가용성이 집 NAS에 걸려 있다는 점**이다. NAS가 꺼지거나 Tailscale 연결이 끊기면 저장이 안 된다. 다만 로컬 편집은 보존되고, 다시 연결되면 리비전 CAS를 통해 올라간다.
tailnet 밖에서 이 상태를 확인할 수 있는 곳은 Vercel뿐이라 `api/health-watch.js`가 외부에서 NAS를 확인한다. 저장 경로가 죽으면 503 UNAVAILABLE, 실시간·백업·점검 모드만 어긋났을 때는 폴백이 있어서 200 DEGRADED를 반환한다.

> **관리형 인프라 전환 — 준비됨, 실행 전 (2026-09-17).** 위 단일 장애점을 없애기 위해 API·PostgreSQL을 관리형으로 옮기고 NAS를
> 오프사이트 백업으로 내리는 작업의 코드·스크립트·runbook이 들어왔다. **프로덕션은 아직 NAS다** — 전환은 별도 승인으로 사람이 순서대로 한다.
> 설계 [`docs/managed-infrastructure.md`](docs/managed-infrastructure.md) · 데이터 이전 [`docs/managed-db-migration.md`](docs/managed-db-migration.md) ·
> 당일 체크리스트 [`docs/production-cutover.md`](docs/production-cutover.md) · 롤백·DR [`docs/disaster-recovery.md`](docs/disaster-recovery.md).

### 왜 지금 구조가 됐나

처음에는 정적 파일 몇 개와 Supabase(로그인·동기화)로 시작했다. 이후 협업·여행 중 판단·가격 추적이 붙으면서 RPC와 RLS만으로 다루기 어려운 부분이 많아졌다.
Vercel 함수가 tailnet 안쪽 DB에 접근할 수 없어서 API를 집 NAS로 옮겼고(**2026-09-04**), 다음 날 iOS 로그인도 자체 Auth로 전환했다(2026-09-05).
지금 Supabase는 업데이트하지 않은 옛 앱의 토큰을 받아 주는 역할과, NAS가 오래 장애가 났을 때 돌아갈 롤백 경로로 남아 있다.

### Supabase는 어디까지 남아 있나

| 분류 | 위치 | 왜 남아 있나 |
|---|---|---|
| Production runtime — 서버 | `next/src/server/auth/supabaseJwt.ts` · `compositeVerifier.ts` · `remoteSupabaseUser.ts` · `withRemoteFallback.ts` | **아직 필요하다.** 업데이트하지 않은 옛 iOS 앱이 Supabase 토큰을 보내기 때문에 서버가 두 종류를 모두 받는다 |
| Legacy fallback — 서버 | `next/src/server/infrastructure/supabase/*` · 이관 레지스트리 `TC_MIGRATION_<DOMAIN>` | 도메인(TRIP·COLLAB·ADAPTIVE·PRICING)별로 저장소를 고른다. 운영은 전부 `NEW_BACKEND` |
| 실행되지 않는 분기 — 웹 | `auth.js` · `app.js` · `api.js` · `collab.js`, `index.html`의 supabase-js CDN | 서버가 `provider: TRIPCANVAS`를 주기 때문에 현재는 타지 않는다. 롤백을 위해 남겨 둔 코드 |
| **iOS 런타임** | **없음 (0)** | 2026-09-05 제거했다. 남은 문자열은 옛 Keychain 항목을 *지우기 위한* 이름뿐이다 |
| 이관 도구 | `next/src/server/migration/*` | Supabase → PostgreSQL 데이터 이관·검증(`npm run migrate:import`) |
| 스키마 원본 | `supabase/migrations/*` | RLS·RPC의 역사이자 설계 원본. 현재 운영 스키마는 `next/src/server/infrastructure/database/migrations/` |
| 롤백 대상 | Vercel `tripcanvas-api` 프로젝트 | 여전히 Supabase를 사용한다. NAS가 길게 죽었을 때 되돌릴 수 있도록 남겨 둔다 |

전환 스위치는 `api.js`·`auth.js`의 `DEFAULT_BASE` 두 줄이다. 자세한 절차는 [`docs/nas-deployment.md`](docs/nas-deployment.md)의 "롤백" 절에 정리돼 있다.

## 기능

### 계획하기

- **여러 도시, 여러 날.** 일자마다 제목·기본 이동수단·시작 시각을 둘 수 있다. 새 장소는 선택한 장소 **바로 뒤**에 들어간다(`＋ N번 뒤에 장소 추가`).
- **이동수단은 일자 기본값을 두고 구간별로 다시 정할 수 있다.** 자차 · 택시 · 대중교통 · 기차 · 도보 · 자전거 · 비행기를 지원한다. 첫날 기본 이동수단이 비행기여도 도시 안 이동까지 비행기로 처리되지는 않는다.
  비행기·기차는 시각표 연동이 없어 **직선거리 기반 추정**을 쓴다. 국내 자차/택시는 카카오내비, 국내 대중교통은 Google Routes TRANSIT, 해외는 Google Routes를 사용한다.
- **출발 기준점은 한 함수에서 정한다.** 전날 마지막 숙소(없으면 마지막 장소)를 이어받고, 공항 이동일·야간열차처럼 이어받으면 안 되는 경우에는 `startPolicy:'none'`으로 끊는다.
  하루 끝의 🏠 숙소 복귀는 데이터에 없는 합성 구간이다. 거리·시간·택시비 계산에는 포함하지만 마지막 날에는 붙이지 않는다. 마지막 날은 떠나는 날이기 때문이다.
- **체류 시간을 정하지 않으면 0분이다.** "아직 안 정했다"와 "들렀다 바로 간다"는 다른 의미라 화면에서도 둘 다 구분해서 남긴다.
- **현지 시간대를 기준으로 계산한다.** 여행/일자별 IANA 시간대와 DST를 반영하고, 대중교통은 구간별 예상 출발시각을 기준으로 조회한다.
- **비용은 하루치와 총액을 나눠 본다.** 장소 비용·택시비는 그날 쓰는 돈이고, 숙박·렌터카·항공은 여러 날에 걸친 총액이라 날수로 나눠 일자별 비용에 반영한다.
  숙박은 체크아웃 날에는 잡지 않고, 렌터카·항공은 양끝 날짜를 포함한다. 일자 카드는 하루치, 필터바는 전액을 보여 준다.
- **일행이 따로 움직이는 시간도 표현할 수 있다.** `who`·`split` 구간은 같은 출발점에서 갈라져 시작하고, 가장 늦게 끝나는 가지를 기준으로 다시 만난다(`reunion`). 분리 구간이 없으면 예전과 같은 방식으로 동작한다.
- **장소 상세 패널.** 지도 POI·검색 결과·일정 마커에서 영업시간·평점·사진·리뷰(Google), 또는 주소·전화·분류(카카오)를 본다. 이 정보는 **조회만 하고 저장하지 않는다.** 제공되지 않은 값을 임의로 채우지도 않는다.
- **일정 글을 붙여넣어 초안을 만들 수 있다.** ChatGPT·Claude가 만든 글을 그대로 붙여넣어도 된다. 마크다운 `**`·이모지·표·`오후 3시`·`점심: 카와카미안` 같은 표현은 규칙 파서(`intake.parseItinerary`)가 먼저 읽고 좌표를 자동 조회한다.
  토글을 켜면 **사용자 본인의 Anthropic API 키로 브라우저에서 직접** Claude를 호출한다. 서버를 거치지 않고 키는 기기(`tripcanvas_cfg`)에만 남는다.
- **공유와 내보내기.** 읽기전용 링크(`#v=`, LZString 압축), 이미지 내보내기, 지도 위 재생 HUD를 지원한다.

### 같이 짜기

- **역할은 셋이다.** 주최자(소유자) · 편집 · 보기. 초대 링크는 `#join=<토큰>` 형식 하나를 쓰고, 서버에는 **토큰 해시만** 저장한다. 링크 미리보기에서는 이름·기간·역할까지만 보여 주고, 여행 본문은 멤버가 된 뒤에 내려온다.
- **가고 싶은 곳.** 후보는 여행 문서가 아니라 별도 테이블에 저장한다. 반응은 MUST/OK/PASS 중 한 사람 한 표이고, 한마디(코멘트)는 후보에만 붙는다. 레스토랑·카페·디저트·관광지·명소·자연·쇼핑·체험·숙소로 나눠 담고 거를 수 있다 — 분류는 표시일 뿐 순위를 바꾸지 않는다.
- **여행 준비 메모.** 비자·입국 준비·교통 이용법·특산품처럼 날짜에 붙지 않는 것들을 분류해 모아 둔다. 여행 문서에 있어 일행에게도 보이고, 확인한 것은 체크해 두면 가라앉는다.
- **예약과 결제를 나눠 본다.** 비용마다 '예약해 뒀다'와 '이미 냈다'를 정하면 하루·전체 합계가 그 둘로 갈린다. 고르지 않은 비용은 어느 쪽으로도 세지 않는다. 앱에서는 비용 항목에 영수증·품목 사진을 붙일 수 있고, 사진은 올리지 않고 그 기기에만 남는다.
  "다들 좋아해요"는 **전원이 의견을 냈고 아무도 PASS하지 않았을 때만** 표시한다. 인기순으로 일정에 자동 반영하지 않고, 실제 일정에 넣는 건 사람이 누른다.
- **의견이 갈린 후보.** MUST와 PASS가 같이 있으면 카드에서 세 가지 선택지를 보여 준다: 다 같이 방문 · 자유시간으로 분리 · 이번 일정에서는 제외. 제외는 상태라 다시 되돌릴 수 있다.
  그룹 제안(`buildGroupProposal`)은 반대가 없고 두 명 이상 의견을 낸 후보를 어느 날에 넣을지 **미리보기**만 만들어 준다.
- **여행별 취향.** 페이스·걷기·아침/밤 제약·관심사는 여행마다 따로 남긴다. 계정의 고정 프로필은 아니다. 가장 제약이 큰 사람 기준으로 정리하되, 자동으로 빼자고 결정하지는 않는다.
- **활동 기록과 실시간.** 트리거가 `trip_activity`에 기록을 남기고 WebSocket이 그 INSERT를 중계한다. payload는 상태 자체가 아니라 **바뀐 게 있다는 신호**이고, 무엇을 다시 읽을지는 `liveEffects`가 정한다.
  실시간 연결이 끊겨도 탭 복귀·패널 열기 때 다시 가져오는 폴백이 있다.
- **알림은 최대한 조용하게.** 토스트는 다른 사람이 후보를 담았을 때와 새 멤버가 들어왔을 때만 띄운다. 일행의 일정 변경은 헤더 아래 한 줄과 바뀐 일자 카드의 점으로만 표시한다.
- **계정 이메일은 여행 화면에 노출하지 않는다.** 이름표는 서버에서 만든다.

### 여행 중

- **오늘의 흐름 · 다음 · From J.** 다음 행동 후보를 만들고 순위를 매긴 뒤 제안은 한 번에 3(+1)개까지만 보여 준다. 시간이 안 맞거나 영업이 끝났거나 이미 완료·건너뜀 처리된 후보는 처음부터 제외한다. 보여 줄 게 없으면 억지로 채우지 않고 쉬는 선택지를 남긴다.
- **다시 맞추기.** 고정 보호(`bookAt`·항공·기차) → 완료 유지 → `must` 보호 → 낮은 우선순위(`opt`)부터 제거 순서를 지킨다. 완료 여부는 앱이 추측하지 않고 사용자가 직접 누른다.
- **빈 시간 채우기와 하루 flow는 같은 엔진을 쓴다.** 일부 계획이 있으면 빈칸을 채우고, 계획이 없으면 고정 예약과 합쳐 오전/점심/오후/저녁 단위로 묶는다. 둘 다 바로 저장하지 않고 미리보기로 보여 준다.
- **자연어 입력.** "오늘 좀 피곤해서 많이 걷기 싫어" 같은 말은 에너지·최대 이동시간·걷기 회피 같은 옵션만 바꾼다. 못 알아들은 문장은 알아들은 척하지 않는다.
- **알림은 상태가 바뀔 때만 보낸다.** `UPCOMING → READY_TO_LEAVE → LATE_RISK` 단계가 바뀌는 시점에만 나간다. 위치가 필요한 출발·지연 판단은 기기가, 일정 전체·가격 관련 판단은 서버(APNs)가 맡는다. 같은 판단을 두 군데서 하면 알림이 두 번 오기 때문이다.
- **위치는 쿼리로만 받고 저장하지 않는다.** 잠금화면·위젯 압축본에는 예약번호·URL·placeId를 넣지 않는다. 계획이 바뀌지 않았으면 다시 그리지도 않는다.

### 예약과 가격

- 숙박·렌터카·항공은 여행 문서(`trip.bookings`)에 두고 장소와 연결한다. 숙소는 `bookingId`, 렌터카는 픽업·반납 장소(`carPickupId`·`carReturnId`)를 사용한다.
- **렌터카 픽업·반납은 현재 표시용이다.** 자유 텍스트라 좌표가 없어서 동선·ETA·지도 계산에는 넣지 않는다. 당일 대여(픽업일=반납일)도 정상으로 처리하고, 반납 지점은 (장소, 공항코드) **한 쌍**이라 한쪽만 물려받지 않는다.
- **시세는 서버 프록시에서만 조회한다**(`api/hotel-offers.js` · `api/car-offers.js`). 같은 조건인지 EXACT/EQUIVALENT/SIMILAR로 나누고, 렌터카는 차급·변속기·보험·주행거리가 다르면 확정 절약으로 보지 않는다.
  Provider가 연결되지 않았으면 **미연결 상태를 그대로** 보여 준다. 가짜 가격을 만들어 내지 않는다.
- 가격 관측 기록은 기기 로컬에 두고, 로그인한 경우 `/api/v1/trips/:id/prices`에도 저장한다. 주기 크론(`api/track-hotel-prices.js`)은 NAS 전환 때 껐고 앱의 하루 1회 확인이 대신한다.

### 지도와 검색

- **국내와 해외에서 지도 엔진을 나눠 쓴다.** 국내는 카카오맵 JS SDK, 해외는 Google Maps JS SDK다. 국내/해외 판정(`inKorea`)과 검색 라우팅(국내 카카오 로컬 / 해외 Google Places)은 같은 규칙을 공유한다.
- **지도에서 바로 담을 수 있다.** 해외는 POI를 탭하면 `placeId`가 그대로 온다. 국내는 카카오 SDK가 POI 탭 신원을 주지 않아서 카테고리 검색으로 POI 칩을 직접 깔고 누르게 한다.
  좌표 역추적은 둘 다 실패했을 때만 쓴다. 추측 기반이라 엉뚱한 상호가 들어갈 수 있기 때문이다.
- 도시/일자별 색상, Day 필터, 방문 순서 연결선, 일자 간 이동선을 지원한다.
- **오프라인 지도는 제공하지 않는다.** Google 약관상 타일 캐시가 금지돼 있어 서비스 워커는 앱 셸만 캐시한다.

### 밖에서 들어오는 것 — 공유 · 붙여넣기 · 사진

공유·붙여넣기·사진은 모두 같은 원칙을 따른다. **확인한 것만 저장한다.**

```
공유 → classifyShare → parseBookingCandidate → 중복·여행 매칭 → 미리보기 → (사용자 확인) → 저장
```

- 파싱은 **구조화된 메타데이터 → 알려진 제공자 → 규칙 파서 → AI → 수동 입력** 순서로 시도한다. AI가 첫 번째 수단은 아니다.
- 모호한 값은 추측하지 않는다. `10/03`처럼 월/일이 갈릴 수 있으면 대안을 같이 돌려주고, `$100`도 어느 나라 달러인지 임의로 정하지 않는다. 읽지 못한 내용은 `rawText`로 남겨 메모로 쓸 수 있다.
- 중복은 예약번호가 일치하는 것처럼 확신이 있을 때만 판단한다. 어느 여행에 들어가야 하는지도 단정하지 않고 점수와 이유를 보여 준 뒤 사용자가 고르게 한다.
- 사진 **원본은 서버로 올리지 않는다.** PhotosPicker 식별자만 남기고, 시각 → 위치 순서로 일정을 연결한다. 특정 일정을 찾지 못하면 날짜에만 붙인다.

### iOS 앱

처음에는 웹은 여행을 *계획*하고 iOS는 여행을 *실행*하는 쪽으로 나눴지만, 지금은 iOS에서도 계획까지 할 수 있다.
일정 편집 · 지도·검색 · 예약 · 함께하기 · 오늘 · 여행 중 · 제안 · 다시 맞추기 · Siri 인텐트 · 공유 시트 · 위젯 · Live Activity · Watch를 지원한다.
자세한 내용은 [`ios/README.md`](ios/README.md)에 정리돼 있다.

- **판단 로직을 Swift에서 다시 만들지 않는다.** `/api/v1`이 준 결과를 화면에 그린다. 화면 판정 복사본(`CollabModel.swift` · `PlaceSearchModel.swift` · `AuthError`)은 JS 쪽을 먼저 고친 뒤 맞추고, 파리티 테스트가 픽스처로 차이를 잡는다.
- **여행 문서는 원문 트리(`JSONValue`)로 들고 있고, 앱이 아는 필드만 덮어쓴다.** 아는 필드만 담은 구조체로 디코딩하면 웹에서 쓰는 `who`·`split`·`hours`가 앱 저장 한 번에 사라질 수 있기 때문이다.
- **저장 버튼은 따로 없다.** 바꾸면 바로 `PUT /api/v1/trips/:id`(revision CAS)로 올라가고, 실패하면 화면을 되돌린다. 충돌이 나면 조용히 덮어쓰지 않고 사용자에게 묻는다.
- **서버 계산이 늦게 오는 화면은 반쯤 그린 상태로 먼저 보여 주지 않는다.** 서버 계산(`dayPlan`)의 첫 시도가 끝날 때까지 목록을 만들지 않고, 받은 계산은 날마다 기억한다. 여행 문서가 바뀌면 이 캐시도 버린다.
- 비용 메뉴(여행 전체·하루 평균·날짜별·카테고리별)와 장소 대표 사진(Google, 출처 표시)을 제공한다. 비용 합산은 `lib.js`의 계산을 서버가 실행해서 돌려준다.
- 로그인은 웹과 같은 자체 Auth를 쓴다. Keychain에는 bearer 토큰 하나(`withj.auth.session.v1`)만 저장한다. refresh grant가 없어서 401이면 `get-session`으로 세션을 다시 확인한다.

### PWA

웹은 홈 화면에 설치할 수 있다. 서비스 워커(`sw.js`)는 앱 셸만 캐시하고 `/api/`와 GET 외 요청은 건드리지 않는다.
캐시 키가 `tc-vNNN`이라 웹 자산을 바꾸면 **반드시 버전을 올려야** 폰에서 새 코드가 보인다. 자세한 내용은 아래 릴리스 체크리스트를 참고한다.

## 이 저장소에서 지키는 규칙

- **판단은 한 곳에서만 한다.** `adaptive.js`(여행 중) · `collab.js`(협업) · `lib.js`(타임라인·비용) · `price.js`(절약) · `intake.js`(유입)는 DOM·네트워크·현재 시각을 모르는 순수 모듈이다. 웹·Next API·iOS가 같은 코드를 사용한다.
  `/api/v1` 라우트는 이 파일들을 `@legacy/*`로 **그대로 import** 한다.
- **밖에서 들어온 데이터는 확인 없이 저장하지 않는다.** 가져오기·공유 링크·클라우드·로컬 로드 **5개 지점 모두** `normalizeTrip()`을 지난다. 여기서 좌표·시각·통화·수단을 검증하고 모르는 값은 기본값으로 떨어뜨린다. 세부 한도는 [`docs/data-validation.md`](docs/data-validation.md)에 있다.
- **접근 제어는 서버에서 결정한다.** 화면의 `readOnly()`/`guardEdit()`는 UI를 감추는 역할일 뿐이고, 실제 권한 판정은 API의 `TripAuthorizationService`가 한다. Supabase를 쓰던 시절에는 RLS가 맡았고, 지금은 집행 위치만 서버로 옮겨 왔다.
- **모든 쓰기는 리비전 CAS를 지난다.** 같은 요청을 두 번 받아도 결과가 같고, 다른 기기가 먼저 수정했으면 409로 알려 준다. 조용히 덮어쓰는 경로는 두지 않는다.
- **화면에서는 내부 용어를 쓰지 않는다.**

  | 코드 | 화면 |
  |---|---|
  | NextAction | 다음 |
  | Suggestion | From J |
  | TripPulse | 오늘의 흐름 |
  | Replan | 다시 맞추기 |
  | Collaboration | 같이 짜기 |
  | Candidate | 가고 싶은 곳 |
  | Conflict | 의견이 갈려요 |
  | Travel Mode | 여행 중 |

배선 실수가 자주 나는 곳(`anchor`와 `carry`, `defaultStayMin`과 `suggestStayMin`, `parseInt(v)||60` 같은 함정)은 [`CLAUDE.md`](CLAUDE.md)에 따로 적어 뒀다.
코드를 고치기 전에는 그 문서를 먼저 보는 게 좋다. `AGENTS.md`는 **`CLAUDE.md`에서 생성된 사본**이라 내용이 같다 — 고칠 곳은 `CLAUDE.md`다.

## 저장소 구조

```
├── index.html · app.js · style.css      웹 화면과 배선 (DOM·지도·네트워크는 전부 app.js)
├── lib.js                               순수 로직 — 파서·거리·시각·앵커·타임라인·정규화·분리 구간·비용
├── adaptive.js                          판단 엔진 — 오늘·제안·재구성·출발 안내·알림 계획 (웹과 iOS의 단일 출처)
├── collab.js · intake.js · price.js     협업 판정 · 유입 파싱 · 가격 계산 (전부 순수)
├── api.js · auth.js                     API·인증 클라이언트 ({data,error}만 돌려주고 예외를 던지지 않는다)
├── sync.js · routing.js                 리비전 CAS·충돌·tombstone · 경로 조회 transport 격리
├── sw.js · manifest.json · icon-*.png   PWA
├── api/                                 Vercel 서버 함수 — kakao-directions · hotel-offers · car-offers · track-hotel-prices · health-watch
├── next/                                Next.js 워크스페이스
│   ├── src/app/api/v1/                    웹·iOS 공용 API (아래 표)
│   ├── src/app/api/auth/                  자체 Auth (better-auth)
│   ├── src/server/                        auth · api(오류 계약) · application(서비스·권한) · repositories · infrastructure(database·mail·supabase) · migration · realtime
│   ├── src/features/trip-state/           계약(contract.ts) · Today/DayPlan 뷰 · 문서 변경 순수 함수
│   ├── src/app/{itinerary,bookings,travel} 이관 중인 Next 웹 화면 (프로덕션 웹은 아직 정적 PWA — vercel.json이 /next를 /로 돌린다)
│   └── Dockerfile · drizzle.config.ts     NAS 이미지 · 스키마
├── ios/                                 네이티브 SwiftUI (XcodeGen project.yml)
│   ├── TripCanvas/                        App · Core(Auth·Location·Models·Networking·Push·Routing·Storage) · Features(Plan·Map·Booking·Collab·Today·TravelMode·Suggestions·Replan·Trips·Intents) · DesignSystem
│   ├── TripCanvasWidgets/                 위젯 · Live Activity
│   ├── TripCanvasShare/ · TripCanvasWatch/ 공유 확장 · watchOS
│   ├── TripCanvasShared/                  App Group 공유 상태
│   └── TripCanvasTests/                   XCTest + 파리티 픽스처(today.json · live-effects.json)
├── deploy/                              NAS docker compose(postgres · migrate · api · realtime · backup) · backup.sh · .env.example · Caddy(안 쓰는 override)
│   ├── docker-compose.backup-only.yml     전환 뒤 NAS의 역할 — 관리형 DB의 오프사이트 pg_dump만
│   └── managed/                           관리형 런타임 배포 예시(Fly) · 환경변수 이름 목록 — 앱 코드가 아니라 한 provider의 설정
├── supabase/migrations/                 Supabase 시절 스키마 — RLS·RPC의 역사이자 이관 원본
├── scripts/                             bump-version · check-version-sync · check-secrets · verify-all.sh · pg-local.sh · deployment-plan · rehearse-restore(-managed) · restore-to-target · verify-db-migration · testflight-*
├── test/                                유닛·통합·API 테스트 (node --test) + RLS 통합(test/rls/)
├── e2e/ · e2e-next/                     Playwright — 정적 웹 시나리오 · Next 웹 API 연결 흐름
├── docs/                                운영·설계 문서 (아래 문서 지도)
├── types/                               jsconfig용 환경 타입
└── proto/                               실험용 프로토타입. 프로덕션과 무관
```

### `/api/v1` 한눈에

라우트는 모두 `next/src/app/api/v1/` 아래에 있다. 라우트 핸들러에는 비즈니스 로직을 두지 않고, `application/`의 서비스가 처리한 뒤 핸들러는 배선만 맡는다.

| 묶음 | 경로 | 무엇 |
|---|---|---|
| 여행 | `trips` · `trips/:id` · `sync/trips` · `trips/:id/snapshots` | 목록·문서 CRUD(revision CAS) · 예전 `sync_trip` 모양 그대로의 동기화 · 버전 이력 |
| 하루와 오늘 | `trips/:id/days/:i` · `today` · `travel-state` · `routes` | 일정 화면의 하루치(값만, 라벨은 클라이언트가) · 오늘 · Today+Pulse+출발 계획+알림 계획+잠금화면 압축본 · 여행 전체 동선 |
| 제안·재구성 | `trips/:id/suggestions/:action` · `replan-preview` · `plan-preview` · `activities/:id/:action` | 제안 수락/거절 · 다시 맞추기 미리보기 · 편집한 초안의 하루치를 저장 없이 before/after로 계산 · 완료/건너뜀/되돌리기(응답에 바뀐 Today를 같이 실어 재조회를 없앤다) |
| 예약·비용 | `trips/:id/bookings` · `prices` · `costs` | 예약 요약(가격 상태 포함) · 가격 관측 기록 · 여행 전체·날짜별·카테고리별 비용 |
| 같이 짜기 | `trips/:id/members` · `members/:id` · `members/leave` · `invites` · `invites/:id` · `invites/:token` · `invites/:token/accept` | 멤버·역할·나가기 · 초대 만들기/취소 · 초대 미리보기(로그인 없이) · 수락 |
| 가고 싶은 곳 | `trips/:id/candidates` · `candidates/:id` · `candidates/:id/reaction` · `candidates/:id/comments` · `comments/:id` · `group-proposal` · `preferences` · `activity` | 후보 · 결정(SCHEDULE/REJECT/REOPEN) · 분류(CATEGORY) · 반응(멱등) · 한마디 · 그룹 제안 · 여행별 취향 · 활동 기록 |
| 유입 | `import/preview` · `trips/:id/import/commit` · `itineraries/parse` · `trips/:id/memories` | 공유 분류·후보 미리보기 · 확인 후 저장 · 붙여넣은 일정 글 읽기 · 사진·메모 기록 |
| 장소 | `places/search` · `places/details` | 국내 검색(카카오 REST 키는 서버에만) · 상세(kakao/google) |
| 계정·기기 | `me` · `auth-config` · `devices` | 프로필과 실시간 허용 여부 · 어느 Auth를 쓰는지 · 푸시 토큰 |

`/api/auth/*`는 better-auth가 만든다(`sign-in/email` · `sign-up/email` · `get-session` · `request-password-reset` · `sign-out`). 새 비밀번호를 정하는 화면은 웹(`#reset=`)에만 있다.
`/api/health`는 `HEALTHY / DEGRADED / UNAVAILABLE`과 구성요소(api · database · realtime · backup)·점검 모드를 답한다. 503은 DB가 죽었을 때뿐이다.
`TC_READ_ONLY=1`이면 `/api/v1/*`·`/api/auth/*`의 쓰기가 503 `MAINTENANCE`로 답한다(전환 직전 write freeze). 읽기는 그대로다.

## 문서 지도

| 문서 | 무엇 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 작업 가이드 — 핵심 개념과 배선 함정. **작업 전에 먼저 확인** |
| [`AGENTS.md`](AGENTS.md) | 위 파일에서 생성된 사본(`npm run sync:agents`). 고칠 곳은 `CLAUDE.md`이고 게이트가 둘이 같은지 본다 |
| [`docs/architecture.md`](docs/architecture.md) | 시스템 구성도 · 모듈 의존성 · 장애 경계 |
| [`docs/backend-architecture.md`](docs/backend-architecture.md) | 독립 Backend의 계층 규칙과 최종 모양 |
| [`docs/system-architecture-review.md`](docs/system-architecture-review.md) | 2026-09-08 구조 검토 — 이관 분기(LEGACY/DUAL_READ/NEW_BACKEND)의 실제 의미와 종료 기준 |
| [`docs/supabase-migration.md`](docs/supabase-migration.md) · [`docs/supabase-migrations.md`](docs/supabase-migrations.md) | Supabase → 자체 Backend 이관 계획·진행 · Supabase 시절 migration 적용 절차 |
| [`docs/staging-verification.md`](docs/staging-verification.md) | 옮겨진 데이터 위에서 앱이 그대로 도는지 — 로그인·저장·협업·롤백 |
| [`docs/nas-deployment.md`](docs/nas-deployment.md) | NAS 운영 — compose · Funnel · 환경변수 · 처음 띄우기 · 롤백 |
| [`docs/nas-release.md`](docs/nas-release.md) | 반복 릴리스 절차 — 대상 판정(`deployment:plan`) · 이미지 셋 빌드 · 복구 확인 |
| [`docs/backup-restore.md`](docs/backup-restore.md) | 백업과 복구. **복구해 본 백업만 백업이다** |
| [`docs/managed-infrastructure.md`](docs/managed-infrastructure.md) | **관리형 인프라 전환 설계** — 현재 SPOF · 조사 결과 · 목표 구조 · provider 선택 · 환경변수 계약 |
| [`docs/managed-db-migration.md`](docs/managed-db-migration.md) · [`docs/production-cutover.md`](docs/production-cutover.md) · [`docs/disaster-recovery.md`](docs/disaster-recovery.md) | 데이터 이전(복원·전수 대조) · 당일 체크리스트(승인 후) · 롤백 6가지와 RPO/RTO |
| [`docs/deployment-workflow.md`](docs/deployment-workflow.md) · [`docs/ci.md`](docs/ci.md) | 브랜치 → PR → 게이트 → merge 흐름 · 필수 게이트와 실패 원인 분류 |
| [`docs/security.md`](docs/security.md) · [`docs/data-validation.md`](docs/data-validation.md) | 키 관리와 보안 기준 · 유입 데이터 한도와 schema migration |
| [`docs/collaboration.md`](docs/collaboration.md) | 함께하기 1~6단계 — 멤버십·초대 / 후보·반응 / 코멘트·활동·실시간 / 취향·합의 / 결정·제안 / 분리 시간 |
| [`docs/ui-design-system.md`](docs/ui-design-system.md) · [`docs/ux-implementation.md`](docs/ux-implementation.md) | UI 토큰과 원칙 · UX 개선 구현 결과 |
| [`docs/place-details-implementation.md`](docs/place-details-implementation.md) | 장소 상세 패널 |
| [`ios/README.md`](ios/README.md) · [`docs/ios-device-setup.md`](docs/ios-device-setup.md) | iOS 앱 구조와 검증 상태 · 내 아이폰에 올리기(TestFlight / Xcode / 무료 Apple ID) |
| [`docs/ios-map-planning-api.md`](docs/ios-map-planning-api.md) · [`docs/ios-map-planning-implementation.md`](docs/ios-map-planning-implementation.md) | 지도 중심 일정 작성 — 범위·카테고리 검색 API와 구현 |
| [`docs/ios-admission-data.md`](docs/ios-admission-data.md) · [`docs/ios-place-photos.md`](docs/ios-place-photos.md) · [`docs/ios-trip-cost-menu.md`](docs/ios-trip-cost-menu.md) | 명소 예약 정보·참고 입장료 · 장소 대표 사진 · 비용 메뉴 |
| [`next/README.md`](next/README.md) | Vercel 프로젝트 둘의 관계 · 환경변수 · 로컬 실행 |

`*-work-prompt.md` · `*-development-prompt.md`는 기능을 만들 때 사용한 요구사항이고, 짝이 되는 `*-implementation.md`·`*-review.md`가 구현 결과다.

## 로컬에서 돌리기

### 웹만

서비스 워커와 API 키 도메인 제한 때문에 **8000 포트**로 열어야 한다. 다른 포트를 쓰면 지도·검색이 403으로 막힌다.

```bash
python3 -m http.server 8000     # → http://localhost:8000
```

Windows에서 Python·Node 없이 띄우려면 `serve.ps1`을 쓰면 된다. 기본 포트가 8791이라 `-Port 8000`을 지정해야 한다.
로그인·저장은 기본 설정대로 NAS API를 본다. 로그아웃 상태에서는 localStorage만 사용해서 API 없이도 일정을 짤 수 있다.

카카오내비 자차 경로와 시세 조회까지 확인하려면 Vercel 서버 함수가 필요하다.

```bash
vercel dev --listen 8000
```

### API · 실시간 · DB까지

`next/`는 별도 워크스페이스이고 Node 22를 사용한다.

```bash
cd next && npm ci
npm run dev                     # /api/v1 — http://localhost:3000  (dev:8000 도 있다)
npm run tools:build && npm run realtime     # WebSocket 사이드카 (CommonJS로 따로 컴파일한다)
```

환경변수는 [`next/README.md`](next/README.md)의 표를 따른다. `DATABASE_URL`이 없으면 이관 레지스트리가 모두 `LEGACY`로 떨어진다.
NAS와 같은 구성을 통째로 띄우려면 `deploy/.env.example`을 채운 뒤 다음을 실행한다.

```bash
docker compose -f deploy/docker-compose.yml up -d     # postgres · migrate · api · realtime · backup
```

RLS·마이그레이션을 실제 PostgreSQL에서 돌려 보는 1회용 클러스터는 `scripts/pg-local.sh start`로 띄운다. Supabase가 아니라 `auth.uid()`만 흉내 낸 대역이지만, "다른 사용자의 여행을 정말 막는가" 같은 권한 검증은 실제 DB가 판정한다.

### iOS

Mac + Xcode + XcodeGen 환경이 필요하다. `ios/project.yml`에서 프로젝트를 생성하고 시뮬레이터로 실행한다. 서명 없이도 빌드와 XCTest까지는 가능하다.
실기기와 TestFlight 절차는 [`docs/ios-device-setup.md`](docs/ios-device-setup.md)에 정리돼 있다.

## 테스트와 게이트

```bash
npm ci
npm test                        # 유닛(node --test) + 통합(jsdom에 실제 index.html·app.js를 올려 배선 검증)
npm run test:e2e                # Playwright — core-flows · pwa · accessibility · auth · collab · cost · place-details · ux-*
npm run lint && npm run check:types && npm run security:scan && npm run check:version
npm run test:rls                # 로컬 PostgreSQL이 있을 때만 (scripts/pg-local.sh)
npm run test:e2e:next           # Next 웹의 API 연결 흐름
npm run rehearse:restore        # 합성 데이터로 pg_dump → pg_restore → 마이그레이션 → 전수 대조 (로컬 PostgreSQL 필요)
SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… scripts/verify-db-migration.sh   # 두 PostgreSQL이 같은가 — PASS/FAIL/SKIP
```

- 순수 모듈(`lib` · `price` · `adaptive` · `intake` · `collab` · `api` · `auth` · `sync` · `routing`)은 유닛 테스트와 `tsc`(JSDoc 타입) 대상이다. 새 순수 로직은 여기에 넣고 `test/`에서 테스트한다.
- 통합 테스트는 jsdom이 없으면 조용히 skip된다. `npm install`을 빼먹지 말아야 한다. 실 API 키가 필요한 테스트(`metasearch.integration`)도 키가 없으면 skip된다.
- `next/`는 vitest(도메인 파리티 — Today 응답 ↔ `Contract.swift`, 공유 키 알고리즘, 잠금화면에 예약번호가 없는지)·lint·`tsc`·`next build`·`tools:build`를 본다.
- iOS는 XcodeGen 생성 · 전 타깃 컴파일 · XCTest · Release 빌드를 확인한다.

릴리스 전 전체 게이트는 한 번에 돌릴 수 있다.

```bash
npm run verify:all              # 루트 + next/ + iOS 를 통째로. 범위만: scripts/verify-all.sh web|next|ios
```

마지막에는 PASS/FAIL/**SKIP** 표가 나온다. **SKIP은 통과가 아니다.** 실행하지 못한 항목은 PR에 이유를 적는다.
GitHub Actions도 같은 범위를 본다: `ci.yml`(Quality · Next workspace · E2E, Node 20/22) · `ios.yml`(`ios/**`가 바뀔 때만 — macOS 러너는 10배 과금) · `ios-testflight.yml`(수동 실행).
러너나 과금 문제로 CI가 멈춰도 검증 기준이 사라지지 않도록 `verify-all.sh`가 워크플로를 그대로 따라가고 있다. 워크플로를 바꾸면 스크립트도 함께 맞춘다.

## 배포

배포는 세 갈래로 나뉜다. **`main` merge로 자동 배포되는 것은 정적 웹뿐이다.**

| 대상 | 어떻게 | 언제 반영 |
|---|---|---|
| 웹 + Vercel 함수 | `main` merge → Vercel 자동 배포 | 즉시. 폰은 서비스 워커 버전이 올라가야 새 코드를 본다 |
| API · 실시간 · DB 스키마 | NAS에서 이미지를 다시 빌드한다 — [`docs/nas-release.md`](docs/nas-release.md) | 사람이 올릴 때 |
| iOS | Actions → *iOS TestFlight* → Run workflow (러너가 없으면 `scripts/testflight-upload.sh`) | TestFlight 처리 후 |

어느 쪽 배포가 필요한지는 두 커밋을 넣으면 도구가 알려 준다. 이 명령이 실제 배포까지 하지는 않는다.

```bash
npm run deployment:plan -- <지금-NAS에-떠-있는-커밋> <올릴-커밋>
```

⚠️ **새 라우트는 NAS에 배포되기 전까지 404다.** 앱·웹이 이 상태를 "값이 없음"으로 조용히 넘기면 오류 없이 기능만 사라진 것처럼 보일 수 있다.
새 API가 필요한 웹을 올릴 때는 API를 **먼저** 배포한다.

⚠️ 마이그레이션을 추가했다면 `api`뿐 아니라 `migrate` 이미지도 다시 빌드해야 한다. 옛 이미지는 "applied successfully"를 찍으면서 실제로는 새 테이블을 만들지 않을 수 있다.

### 릴리스 체크리스트

- [ ] 웹 자산(`app.js` · `index.html` · `style.css` …)을 바꿨으면 `npm run bump:version` 실행 — `sw.js`의 `VER`과 `index.html`의 `?v=`를 같이 올린다. 그렇지 않으면 stale 캐시 때문에 변경이 안 보일 수 있다
- [ ] `npm run verify:all` 통과. SKIP 항목은 PR에 이유를 적는다
- [ ] **필수 체크가 빨간 상태로 merge하지 않는다.** 원인이 코드가 아니라 러너·과금 문제라면 그 사실과 대신 어떤 검증을 했는지 PR에 남기고 사람이 판단한다
- [ ] `next/src/app/api/**` · `next/src/server/**` · `next/src/features/**`를 바꿨으면 NAS에 따로 올린다. `.env`를 바꿨다면 `--force-recreate api`까지 필요하다
- [ ] 푸시 후 폰에서 실제 반영 여부를 확인한다. ☰ 메뉴 하단 버전이 새 버전인지 먼저 보고, 옛 버전이면 그 글자를 눌러 갱신한다

## 작업 규칙

- **`main`에는 직접 커밋·푸시하지 않는다.** `feat/*` · `fix/*` · `chore/*` · `docs/*` · `release/*` 브랜치에서 작업하고 PR → 게이트 → merge 순서로 들어간다.
  각 클론에서 `git config core.hooksPath .githooks`를 한 번 실행하면 `pre-push`가 `main` 직접 푸시를 로컬에서 막아 준다. 최종 방어는 서버의 branch protection이고, 훅은 그 전에 실수를 막는 용도다.
- **여러 기기에서 작업하므로 원격 상태를 먼저 확인한다.** 세션 시작·커밋 전에 `git fetch`로 `origin/main`이 앞서 있는지 보고, 뒤처졌으면 `git pull --ff-only`로 맞춘다.
- **커밋 제목은 명사형으로 끝낸다.** 예: `… 기능 추가` · `… 오류 수정` · `… 규칙 정리`. 본문은 서술형이어도 괜찮다.
- PR 본문에는 무엇이 바뀌었는지, 왜 바꿨는지, 사용자와 프로덕션에 어떤 영향이 있는지, 무엇으로 검증했는지, 어떻게 되돌릴 수 있는지를 적는다. **"테스트 작성됨"과 "테스트 통과"는 구분해서 적는다.**
- 커밋 author 이메일은 GitHub 계정과 매칭되는 유효한 주소를 사용한다. `.local` 같은 로컬 호스트 기반 자동 이메일이면 Vercel이 배포를 거부한다.

## 보안과 운영에서 조심할 것

- **브라우저 키는 도메인 제한이 핵심이다.** `app.js` 상단의 Google Maps 키(HTTP 리퍼러)·카카오 JS 키(플랫폼 도메인)는 정적 HTML에 그대로 보이므로 `localhost:8000` · `tripcanvas-ai.vercel.app` · Preview 주소만 등록한다.
  카카오 REST 키·Google Routes 키·시세 Provider 키는 서버 환경변수에만 둔다. iOS는 **번들 ID로 제한된 별도 네이티브 키**를 사용한다. iOS 키를 서버에 넣으면 403이 난다.
- **외부 데이터를 `innerHTML`로 출력할 때는 `esc()`, URL을 `href`에 넣을 때는 `safeUrl()`을 쓴다.** `esc()`는 스킴까지 막아 주지 않아서 `javascript:` 링크는 별도로 걸러야 한다.
- Google Cloud 결제 예산 알림과 API 사용량 대시보드는 주기적으로 확인한다. 검색 실패는 원인별(인증·할당량·네트워크·무결과)로 나눠 사용자에게 보여 주고, 상세 코드는 콘솔에만 남긴다.
- 백업은 NAS의 `backup` 컨테이너가 매일 만들지만, **복구해 본 백업만 백업이다.** `npm run rehearse:restore`가 합성 데이터로 dump → restore → migrate → 비교를 한 번에 실행한다.
- `deploy/.env`는 추적하지 않는다. 환경변수는 컨테이너가 뜰 때 한 번만 읽으므로 값을 바꿨다면 파일 내용보다 **컨테이너 시작 시각**으로 적용 여부를 확인한다.
- localStorage 키: `tripcanvas_v1`(여행) · `tripcanvas_legs_v4`(구간 캐시) · `tripcanvas_prices_v1`(가격 관측) · `tripcanvas_suggest_v1`(제안 거절 이력) · `tripcanvas_cfg` · `tripcanvas_fx` · `tripcanvas_join_v1`(초대 대기 토큰) · `tripcanvas_auth_v1`(자체 Auth 세션).
