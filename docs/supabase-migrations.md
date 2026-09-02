# Supabase migration 적용 절차

이 저장소에서는 `supabase/migrations/`를 원하는 스키마의 기준으로 관리한다. 현재 운영 DB 스키마는 이 작업에서 직접 조회하지 않았고 migration도 적용하지 않았다.

## 적용 전 preflight

1. Supabase CLI를 연결한 별도 staging 프로젝트에서 `supabase db pull`로 운영 스키마를 덤프한다.
2. `supabase db diff --linked` 결과에서 `trips`, `trip_snapshots`의 실제 PK·컬럼 타입·기존 정책을 이 migration과 비교한다.
3. null `user_id`, 중복 `(user_id, client_id)`, JSON이 아닌 `data`, 고아 snapshot 수를 조회해 정리 계획을 세운다.
4. 운영 백업을 만든 뒤 staging clone에서 `supabase db reset`과 RLS 교차 사용자 테스트를 실행한다.
5. 앱 배포 전에 migration을 먼저 적용한다. 새 앱은 CAS RPC가 없으면 로컬 저장은 유지하지만 클라우드 동기화를 중단한다.

## 의도한 동작

- `revision`이 같은 클라이언트만 저장/삭제에 성공하는 낙관적 동시성 제어(CAS)를 사용한다.
- 삭제는 행 제거 대신 `deleted_at` tombstone과 revision 증가로 기록한다.
- RLS는 authenticated 사용자에게 자신의 행만 보이고, insert/update에는 `WITH CHECK`로 소유자 변경도 차단한다.
- 스냅샷은 `user_id`를 명시하고 원본 여행 revision을 기록한다.

저장소의 Node 테스트 대부분은 SQL 정책 존재와 클라이언트 상태 전이만 확인한다. **다른 사용자 격리는 `npm run test:rls`가 실제 PostgreSQL에서 판정한다**(아래 함께하기 절) — Supabase 자체는 아니므로(auth·확장은 대역) 운영 적용 전 staging 확인은 여전히 필요하다.

## 202609020001_trip_collaboration (함께하기 1단계)

- `trip_members`·`trip_invites`를 만들고 `trips` 정책을 **소유자 또는 활성 멤버**로 바꾼다. 기존 여행 전부에 OWNER 멤버십을 백필한다(몇 번 돌려도 같다).
- `sync_trip`·`tombstone_trip`을 멤버 인식으로 다시 정의한다 — 시그니처는 같아 기존 클라이언트가 그대로 돈다.
- `pgcrypto`(`extensions` 스키마)를 쓴다 — Supabase 기본 확장이다.
- **앱보다 먼저 적용한다.** 새 앱은 `my_trip_roles`가 없으면 역할 없이(전부 소유자로) 동작하지만 초대·참여는 실패한다.
- 적용 전 로컬에서 실제 PostgreSQL로 확인할 수 있다: `scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && npm run test:rls`
  (Supabase 대역 `test/rls/supabase-stub.sql`에 적용해 사용자 A·B·C 격리 시나리오를 돌린다 — 이것이 "RLS 교차 사용자 테스트"의 자동화판이다.)
- 설계·권한표·RPC 목록은 `docs/collaboration.md`.
