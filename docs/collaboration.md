# 함께하기 (Collaborative Trip Planning) — 1단계: 멤버십 · 권한 · 초대

한 사람이 만들고 나머지는 읽기전용 링크로 보던 구조에서, **일행이 같은 여행을 함께 보고 바꾸는** 구조로 가는 첫 단계다.
이번 단계가 하는 일은 딱 하나다 — *누가 이 여행을 볼 수 있고, 바꿀 수 있는가*를 DB가 결정하게 만든다.
후보 장소·의견·합의·제안은 이 위에 다음 단계로 올라간다 (`docs/collaboration.md`를 계속 갱신한다).

## 현재 구조 (바꾸지 않은 것)

- 여행은 `trips` 한 행(문서 jsonb `data`) 그대로다. 저장은 여전히 `sync_trip`(revision CAS), 삭제는 `tombstone_trip`.
- `trips.user_id`가 **소유자**다. 바뀌지 않는다 — 소유권 이전은 다음 단계(§72).
- 혼자 쓰는 여행은 아무것도 달라지지 않는다(§95): 로그아웃·로컬 전용 여행은 항상 소유자로 다뤄진다.
- `#v=` 읽기전용 공유 링크(사본 저장)는 그대로 남는다. 초대(`#join=`)와는 다른 것이다.

## 데이터 모델 (`supabase/migrations/202609020001_trip_collaboration.sql`)

| 테이블 | 역할 |
|---|---|
| `trip_members` | `(trip_id, user_id)` 당 한 행. `role` OWNER/EDITOR/VIEWER · `status` ACTIVE/LEFT/REMOVED · `display_name`(이 여행에서 보일 이름 — 계정 이메일은 노출하지 않는다 §69) |
| `trip_invites` | 초대 링크. **토큰 원문은 없다** — `token_hash`(sha256)만. `role`(EDITOR/VIEWER) · `expires_at`(1시간~30일) · `revoked_at` · `max_uses`/`use_count` |

소유자 멤버 행은 여행이 생길 때 트리거가 만들고, 기존 여행은 마이그레이션이 백필한다(§96).

## 권한

| | OWNER | EDITOR | VIEWER |
|---|---|---|---|
| 일정·예약 읽기 | ✓ | ✓ | ✓ |
| 일정·예약 수정 (`sync_trip`) | ✓ | ✓ | ✗ 42501 |
| 여행 삭제 (`tombstone_trip`) | ✓ | ✗ | ✗ |
| 초대 만들기·취소 · 역할 변경 · 내보내기 | ✓ | ✗ | ✗ |
| 내 이름 바꾸기 | ✓ | ✓ | ✓ |
| 나가기 (`leave_trip`) | ✗ (§71) | ✓ | ✓ |

## RLS — 경계는 DB에 있다 (§65~67)

```
trips          select : 소유자 OR 활성 멤버         (tc_trip_role(id) is not null)
               update : 소유자 OR EDITOR             (+ 트리거가 user_id 변경을 막는다)
               insert · delete : 소유자만
trip_members   select : 같은 여행의 멤버끼리.  쓰기 정책 없음 → RPC(security definer)만
trip_invites   select : 소유자만.              쓰기 정책 없음 → RPC만
```

`tc_trip_role()`은 `security definer`다 — 정책이 `trip_members`를 보고 `trip_members` 정책이 `trips`를 보면 재귀가 되므로,
정책은 이 함수 하나만 부른다(Supabase가 문서화한 방식).

⚠️ RLS 아래에서 `SELECT … FOR UPDATE`는 **update 정책의 USING까지 통과한 행만** 돌려준다. `sync_trip`이 조회와 잠금을 한 문장에
두었을 때 VIEWER에게는 행이 "없는 것"이 되어 거절 대신 **제 계정에 복제본을 만들었다** — 실제 PostgreSQL 테스트(`test/rls/collaboration.sql`)가
잡은 사고다. 그래서 `sync_trip`·`tombstone_trip`은 잠금 없이 먼저 찾아 역할을 판정하고, 그다음 `id`로 잠근다. 이 순서를 되돌리면 재발한다.

⚠️ `trips_editor_update`의 `with check`만으로는 편집자가 `user_id`를 제 것으로 바꾸는 요청을 못 막는다(새 행 기준으로 통과한다).
그래서 `tc_trips_lock_owner` 트리거가 `user_id` 변경을 42501로 거절한다. **정책을 손볼 때 이 트리거를 지우면 소유권 탈취가 열린다.**

## RPC

| 함수 | 누가 | 하는 일 |
|---|---|---|
| `sync_trip` · `tombstone_trip` | 로그인 | 멤버 인식으로 다시 씀. 같은 `client_id`가 둘(내 것 + 공유받은 것)이면 **소유한 쪽 우선**. VIEWER 쓰기·나간 사람의 저장·멤버의 삭제는 `42501`(hint에 이유) |
| `my_trip_roles()` | 로그인 | 내가 볼 수 있는 여행 전부의 `role`·`member_count` — 로그인 직후 한 번 |
| `list_trip_members(client_id)` | 멤버 | 활성 멤버 목록(주최자 먼저) |
| `create_trip_invite(client_id, role, hours, max_uses)` | 소유자 | 토큰을 **한 번만** 돌려준다. 192비트 난수·URL-safe base64 32자 |
| `list_trip_invites` · `revoke_trip_invite` | 소유자 | 목록·취소(멱등) |
| `invite_preview(token)` | **anon 가능** | 이름·시작일·일수·역할·`already_member`만. 일정 본문은 절대 없다(§6) |
| `accept_trip_invite(token, display_name)` | 로그인 | 여기서만 멤버십이 생긴다(§67). 멱등(§74) — 이미 멤버면 `already_member`, 사용 횟수도 다시 세지 않는다 |
| `leave_trip(client_id)` | 멤버 | status→LEFT. 소유자는 `OWNER_CANNOT_LEAVE` |
| `manage_trip_member(member_id, action, value)` | 소유자(RENAME은 본인도) | `SET_ROLE` · `REMOVE` · `RENAME`. 소유자 행은 `OWNER_LOCKED` |

모든 `security definer` 함수는 `public`에서 실행 권한을 거둔다 — 기본값이 public 실행 허용이라 빠뜨리면 anon이 부른다.

## 초대 보안 (§5·§6)

- 링크는 `https://…/#join=<token>` — **토큰만** 싣는다. 여행 id·역할·만료를 URL에 넣으면 조작·유출만 늘어난다. 서버가 토큰으로 전부 찾는다.
- raw trip id로는 참여할 수 없다: `client_id`는 어디에도 초대 역할을 하지 않는다.
- 링크가 공개돼도 보이는 것: 여행 이름 · 시작일 · 일수 · 역할. 그뿐이다.
- 만료(기본 7일) · 취소 · 사용 한도 · 삭제된 여행 · **내보내진 사람이 이전 링크로 다시 들어오는 것**(§70: 링크가 내보내기보다 먼저 만들어졌으면 거절, 새 링크는 허용) 전부 서버가 판정한다.
- 클라이언트는 `#join=` 토큰의 형식(`[A-Za-z0-9_-]{16,128}`)이 어긋나면 서버에 보내지도 않는다.

## 웹 배선 (`app.js` · `collab.js`)

- `collab.js`(순수) — 역할 판정(`canEdit/canManage/canLeave/canDelete`), 링크 만들기·읽기, 초대 판정 문구, 권한 오류 판별. **tsc + 유닛 테스트 대상.**
- `tripRoles` — `my_trip_roles()` 결과 캐시. 로그인 직후(`syncOnLogin`)·패널에서 갱신, 로그아웃하면 비운다.
- `readOnly()` / `guardEdit()` — `#v=` 읽기전용 보기와 VIEWER를 한 곳에서 판단. **편집 진입점은 전부 이걸 본다** (장소·일자·예약 모달, 드래그, 복사·삭제, 수단 순환, 붙여넣기 append/overwrite, 실행취소).
- `body.roleViewer` + `#roleBar` — 보기 권한이면 편집 도구를 감추고 안내 바를 띄운다. 로그인·새 여행·설정(나가기)은 그대로 쓴다.
- 동기화: VIEWER 여행은 **올리지 않는다**(서버도 거절한다). 서버가 42501을 주면 `syncMeta.status='forbidden'`으로 멈추고 **재시도 루프에 넣지 않는다** — 역할이 편집 가능으로 확인되면(`refreshTripRoles`) 다시 dirty가 된다.
- `pullTrip(id)` — 다른 멤버의 최신본 당겨오기. 로컬이 마지막으로 맞춘 그대로면 조용히 교체하고, 로컬 편집이 있으면 기존 충돌 카드로 넘긴다(조용히 덮어쓰지 않는다). 탭이 다시 보일 때·패널을 열 때 부른다(30초 스로틀). **실시간은 다음 단계(§40)**.
- 로그인 병합 뒤 `syncMeta.hash`를 **정규화된 로컬본** 기준으로 맞춘다 — 원문 지문과 달라 같은 내용을 revision만 올리는 헛업로드가 있었고, 그게 남아 있으면 `pullTrip`이 "로컬 편집이 있다"고 착각한다.
- 참여 흐름: `#join=` → `invite_preview` → (로그인) → `accept_trip_invite` → `syncOnLogin()`으로 내려받기 → 그 여행으로 전환. 대기 토큰은 `localStorage tripcanvas_join_v1`에 남겨 가입 확인 메일을 거쳐 돌아와도 이어진다.
- 공유받은 여행의 "삭제"는 **나가기**다 — `leave_trip` 뒤 이 기기의 사본도 지운다(더는 갱신되지 않는 사본을 남기지 않는다).

## `/api/v1` · iOS

- `TripSummary.role` · `memberCount` 추가(계약 v1에 필드 추가 — 제거·의미 변경이 아니라 버전은 그대로). Swift는 옵셔널로 받아 구버전 서버 응답에도 견딘다.
- 쓰기 라우트는 역할이 VIEWER면 RPC를 부르지 않고 `403 FORBIDDEN`, 게이트웨이가 42501을 받아도 `403`. iOS `APIError.forbidden`.
- 게이트웨이 `listTrips/getTrip`은 `my_trip_roles()`를 한 번 더 부른다. 같은 `client_id`가 둘이면 소유한 쪽만 돌려준다.
- iOS의 멤버 UI·초대는 다음 단계(PR9). 지금은 공유받은 여행이 목록에 그대로 보이고, 보기 권한의 쓰기가 403으로 정직하게 실패한다.

## 테스트

| 무엇 | 어디 |
|---|---|
| 순수 판정 | `test/collab.test.js` |
| 마이그레이션이 접근 제어를 코드화했는가(정규식) | `test/migration.test.js` |
| **진짜 PostgreSQL에서 사용자 A·B·C 격리**(§94) — 초대 전 안 보임 · 토큰만으로 본문 못 봄 · VIEWER 쓰기 42501 · 소유권 탈취 차단 · 나간 사람의 저장 거절 · 취소/만료/내보내기 · 멱등 수락 | `test/rls.integration.test.js` + `test/rls/collaboration.sql` (로컬 PostgreSQL 없으면 skip) |
| 웹 배선 — 보기 권한 게이팅 · 업로드 생략 · forbidden 무재시도 · 참여 모달 · 나가기 · pullTrip | `test/integration.test.js` |
| 실제 브라우저 — 초대 링크 미리보기 · 만료 · 형식 검증 · 로그아웃 진입점 | `e2e/collab.spec.js` |
| API 계약 — role/memberCount · 403 | `next/.../handlers.test.ts` · `swiftParity.test.ts` |

로컬에서 RLS 테스트를 돌리려면:

```bash
scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && npm run test:rls
```

## 운영 적용

1. `docs/supabase-migrations.md`의 preflight대로 staging에서 먼저.
2. 마이그레이션 적용 → 기존 여행 전부에 OWNER 멤버십이 채워진다. 앱 배포 전에 적용해야 한다 — 새 앱은 `my_trip_roles`가 없으면 역할 없이(전부 소유자로) 동작하지만 초대·참여는 실패한다.
3. `pgcrypto`는 Supabase 기본 확장이다(`extensions` 스키마).

## 아직 아닌 것 (Known Limitations)

- **실시간 없음** — 다른 멤버의 변경은 탭이 다시 보일 때·패널을 열 때·다시 로그인할 때 내려온다. 같은 문서를 둘이 동시에 고치면 revision CAS가 충돌을 잡고 사용자가 고른다(문서 단위, 항목 단위 아님 — §33~35의 항목 단위 충돌 응답은 다음 단계).
- **소유권 이전 없음** — 주최자는 나갈 수 없다.
- Next 웹(Strangler)은 권한 오류를 멈추기만 한다 — 멤버 패널·초대 UI는 레거시 웹에만 있다.
- `client_id`는 사용자별로만 유일하다. 내가 소유한 여행과 공유받은 여행의 id가 같으면(7자 난수, 확률은 낮다) 소유한 쪽만 보인다.
- 예약의 민감 필드(예약번호·URL·금액)는 아직 멤버 전원에게 보인다(§68 정책은 다음 단계).
- 이메일 초대(계정 기반)는 없다 — 링크 초대만.
