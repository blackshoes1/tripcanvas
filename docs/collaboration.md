# 함께하기 (Collaborative Trip Planning) — 1단계: 멤버십 · 권한 · 초대 / 2단계: 후보 · 반응

한 사람이 만들고 나머지는 읽기전용 링크로 보던 구조에서, **일행이 같은 여행을 함께 보고 바꾸는** 구조로 가는 첫 단계다.
이번 단계가 하는 일은 딱 하나다 — *누가 이 여행을 볼 수 있고, 바꿀 수 있는가*를 DB가 결정하게 만든다.
후보 장소·의견은 그 위에 2단계로 올라갔다(아래). 합의 점수·코멘트·실시간·제안은 다음 단계다.

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

# 2단계: 후보 장소와 반응

1단계가 *누가 볼 수 있는가*를 정했다면, 2단계는 **아직 일정이 아닌 것**을 다룬다. 일행이 "여기 가고 싶어"라고 말할 곳이
없으면, 의견은 결국 카카오톡에 흩어지고 일정에는 결정만 남는다. 후보 보드는 그 대화를 **장소에 붙여 둔다**.

## 왜 여행 문서가 아니라 별도 테이블인가

후보와 반응은 `trips.data`(jsonb) 안이 아니라 제 테이블에 산다. 이유가 셋이다.

1. **반응은 동시에 들어온다.** 넷이 같은 순간에 하트를 누르면 문서 리비전 CAS가 서로를 걷어찬다.
2. **보기 권한도 의견은 낸다.** 문서 쓰기는 EDITOR 이상만 되지만, VIEWER도 "꼭 가고 싶어요"는 말할 수 있어야 한다.
3. **한 사람 한 표를 DB가 보장해야 한다** (`unique (candidate_id, user_id)`). 문서 병합으로는 못 지킨다.

확정 일정(Spot)은 지금처럼 여행 문서에 남는다. 후보는 *아직 일정이 아닌 것*이라 분리돼 있고, 공유 링크(`#v=`)·내보내기에는
들어가지 않는다.

## 데이터 모델 (`supabase/migrations/202609020002_trip_candidates.sql`)

| 테이블 | 역할 |
|---|---|
| `trip_candidates` | 후보 장소. `title` · 좌표/`place_id`(있으면) · `note`(제안자의 한 줄) · `proposed_by` · `status` · `scheduled_ref` |
| `candidate_reactions` | `(candidate_id, user_id)` 당 **한 행**. `reaction` MUST/OK/PASS |

- `status`는 `PROPOSED` / `SCHEDULED` / `REJECTED`를 쓰고 `ACCEPTED`는 열어만 뒀다 — 합의 판정은 다음 단계다.
- ⚠️ `scheduled_ref`는 **장소 id가 아니라 '2'(2일차) 같은 위치 표시**다. 여행 문서의 장소에는 안정적인 id가 없다
  (`normalizeTrip`이 모르는 필드를 떨어뜨린다) → 장소를 가리키는 외래키를 만들 수 없다. "후보로 되돌리기"가 일정의 장소를
  지우지 않는 것도 이 때문이고, UI가 그렇게 말한다.
- 제안자에게는 `MUST`가 자동으로 붙는다 — 낸 사람은 이미 가고 싶다는 뜻이라 한 번 더 누르게 하지 않는다.

## 권한 — 한 줄 규칙

> **보기 권한은 의견만 낸다. 여행에 내용을 만들지는 않는다.**

| | OWNER | EDITOR | VIEWER |
|---|---|---|---|
| 후보 읽기 · 반응(MUST/OK/PASS) | ✓ | ✓ | ✓ |
| 후보 추가 | ✓ | ✓ | ✗ 42501 |
| 일정에 넣기 · 되돌리기 | ✓ | ✓ | ✗ 42501 |
| 후보 빼기 | ✓ (누구 것이든) | 내가 낸 것만 | 내가 낸 것만 |

후보를 지우는 기준은 **역할이 아니라 '누가 냈는가'**다 — 편집자여도 남의 후보는 못 지운다. 내가 낸 의견은 내가 거둔다.

RLS는 1단계와 같은 모양이다: **읽기만 정책으로 열고, 쓰기 정책은 아예 만들지 않는다.** 모든 변경은 아래 RPC를 지난다.

```
trip_candidates      select : tc_trip_role(trip_id) is not null       (활성 멤버 전원)
candidate_reactions  select : tc_candidate_role(candidate_id) is not null
둘 다               insert·update·delete 정책 없음 + authenticated는 select 권한만
```

| RPC | 누가 | 하는 일 |
|---|---|---|
| `add_trip_candidate` | OWNER·EDITOR | 후보 추가 (+ 제안자 MUST 자동) |
| `list_trip_candidates` | 활성 멤버 | 후보 + 반응 집계 + 내 반응 + 누가 뭐라 했는지 |
| `react_to_candidate` | 활성 멤버 | 반응 upsert. `null`이면 거두기. **멱등**(§66) |
| `manage_trip_candidate` | 제안자·OWNER(REMOVE) / EDITOR+(SCHEDULE·UNSCHEDULE) | 빼기 · 일정 반영 표시 |

`tc_member_label()`이 이름을 만든다 — **계정 이메일은 여행에 절대 나오지 않는다**(§69). 이름을 안 정했으면 `주최자`/`멤버`.

## 판정은 `collab.js`에 (순수)

| 함수 | 하는 일 |
|---|---|
| `tallyReactions` | MUST/OK/PASS 집계 + 아직 말하지 않은 인원(`silent`) |
| `candidateMood` | `NONE` · `SPLIT` · `COOL` · `LOVED` · `QUIET` — **점수가 아니라 다음에 무엇을 하면 되는지** |
| `groupCandidates` | 보드의 묶음(§57·§58): 의견 필요 / 다들 좋아함 / 안 끌림 / 일정에 넣음 |
| `canPropose` · `canReact` · `canScheduleCandidate` · `canRemoveCandidate` | 화면 판정 (경계는 DB) |
| `reactionSummary` · `candidateAttribution` · `sortCandidates` | 표시 |

- **`LOVED`는 전원이 의견을 냈고 아무도 PASS하지 않았을 때만** 쓴다 — 둘이 좋다고 넷의 마음을 말하지 않는다.
  아직 다 말하지 않았으면 `QUIET`(의견이 더 필요해요)다.
- 보드는 **결정 못 한 것을 맨 위에** 둔다. 보드가 할 일은 순위를 매기는 게 아니라 *어디에 한마디가 필요한지* 가리키는 것이다.
- ⚠️ **인기가 많다고 자동으로 일정에 들어가지 않는다**(§12·§79). `sortCandidates`의 관심 순 정렬은 **표시일 뿐 결정이 아니다.**
  일정에 넣는 것은 언제나 사람이 누르고, 넣을 때도 최적 위치를 추측하지 않고 고른 날 맨 뒤에 붙인다(재배치는 기존 드래그·재구성이 한다).

## 웹 UI

- ☰ 메뉴 → **📍 가고 싶은 곳** (`#candModalBg`). 후보 하나가 카드 하나고, 카드는 *무엇을 / 누가 냈는지 / 일행은 뭐라 하는지 / 내가 뭐라 할지*다.
- 반응은 **한 번의 탭**이다(§9 — 설문처럼 만들지 않는다). 눌린 것을 다시 누르면 거둔다.
- 낙관적 갱신: 탭 즉시 화면이 바뀌고, 서버가 거절하면 **되돌린다**. 저장되지 않은 것이 저장된 척하지 않는다.
  `applyLocalReaction`이 집계와 `reactions` 배열을 서버 응답과 같은 모양으로 유지해 다시 그렸을 때 숫자가 튀지 않는다.
- 로그아웃·로컬 전용 여행에는 보드가 없다(계정이 있어야 하는 그룹 기능이다). **기존 흐름은 아무것도 달라지지 않는다**(§95).

## 테스트

| 무엇 | 어디 |
|---|---|
| 순수 판정 | `test/collab.test.js` |
| 마이그레이션이 접근 제어를 코드화했는가(정규식) | `test/migration.test.js` |
| **진짜 PostgreSQL에서 사용자 A·B·C 격리**(§94) — 초대 전 안 보임 · 토큰만으로 본문 못 봄 · VIEWER 쓰기 42501 · 소유권 탈취 차단 · 나간 사람의 저장 거절 · 취소/만료/내보내기 · 멱등 수락 | `test/rls.integration.test.js` + `test/rls/collaboration.sql` (로컬 PostgreSQL 없으면 skip) |
| 웹 배선 — 보기 권한 게이팅 · 업로드 생략 · forbidden 무재시도 · 참여 모달 · 나가기 · pullTrip | `test/integration.test.js` |
| 실제 브라우저 — 초대 링크 미리보기 · 만료 · 형식 검증 · 로그아웃 진입점 · **후보 반응 탭** | `e2e/collab.spec.js` |
| **후보 순수 판정** — 집계 · §91 합의 fixture(전원 MUST / MUST+OK / MUST+PASS / 전원 PASS / 의견 없음 / 2명 split) · 묶음 · 정렬 | `test/collab.test.js` |
| **후보 RLS** — 비멤버는 못 봄·못 남김 · VIEWER는 반응만 · 한 사람 한 표 · 멱등 · 제안자만 빼기 · 나간 사람 거절 · 테이블 직접 쓰기 차단 | `test/rls/collaboration.sql` |
| **후보 웹 배선** — 보기 권한 게이팅 · 낙관적 반응과 되돌리기 · 일정에 넣기 | `test/integration.test.js` |
| API 계약 — role/memberCount · 403 | `next/.../handlers.test.ts` · `swiftParity.test.ts` |

로컬에서 RLS 테스트를 돌리려면:

```bash
scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && npm run test:rls
```

## 운영 적용

1. `docs/supabase-migrations.md`의 preflight대로 staging에서 먼저.
2. 마이그레이션 적용 → 기존 여행 전부에 OWNER 멤버십이 채워진다. 앱 배포 전에 적용해야 한다 — 새 앱은 `my_trip_roles`가 없으면 역할 없이(전부 소유자로) 동작하지만 초대·참여는 실패한다.
3. `pgcrypto`는 Supabase 기본 확장이다(`extensions` 스키마).
4. 2단계(`202609020002_trip_candidates.sql`)는 1단계 뒤에 적용한다 — `tc_trip_role`·`tc_touch_updated_at`을 쓴다.
   두 마이그레이션 모두 재실행해도 안전하고, `trips.id`가 uuid든 bigint든 같은 결과가 나온다(테스트가 두 모양 모두에서 돈다).

## 아직 아닌 것 (Known Limitations)

- **실시간 없음** — 다른 멤버의 변경은 탭이 다시 보일 때·패널을 열 때·다시 로그인할 때 내려온다. 같은 문서를 둘이 동시에 고치면 revision CAS가 충돌을 잡고 사용자가 고른다(문서 단위, 항목 단위 아님 — §33~35의 항목 단위 충돌 응답은 다음 단계).
- **소유권 이전 없음** — 주최자는 나갈 수 없다.
- Next 웹(Strangler)은 권한 오류를 멈추기만 한다 — 멤버 패널·초대 UI는 레거시 웹에만 있다.
- `client_id`는 사용자별로만 유일하다. 내가 소유한 여행과 공유받은 여행의 id가 같으면(7자 난수, 확률은 낮다) 소유한 쪽만 보인다.
- 예약의 민감 필드(예약번호·URL·금액)는 아직 멤버 전원에게 보인다(§68 정책은 다음 단계).
- 이메일 초대(계정 기반)는 없다 — 링크 초대만.
- **후보에 코멘트가 없다**(§14는 다음 단계). 지금은 제안자의 한 줄 메모(`note`)뿐이다.
- **합의 점수가 없다**(§20). 지금 보드는 세는 것과 묶는 것까지고, "Day 2 오후에 넣으면 이동시간이 가장 짧습니다" 같은
  제안은 다음 단계다.
- 후보 반응도 실시간이 아니다 — 보드를 열거나 ↻ 새로고침을 누를 때 내려온다.
- 후보 보드는 로그인해야 쓸 수 있다. 로그아웃·로컬 전용 여행에서는 진입점이 로그인으로 안내한다.
- 지도에서 바로 '후보로 담기'는 아직 없다 — 이름을 적어 담는다(좌표 칸은 스키마에 있고 iOS 공유(§77)와 함께 채운다).
- 후보를 일정에 넣은 뒤 그 장소를 지워도 후보는 `SCHEDULED`로 남는다 — 장소에 안정적인 id가 없어 되짚을 수 없다.
  "후보로 되돌리기"로 직접 돌린다.
