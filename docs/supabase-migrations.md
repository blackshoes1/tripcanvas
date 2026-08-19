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

실제 다른 사용자 격리 테스트는 로컬 Supabase 또는 staging 프로젝트가 필요하다. 저장소의 Node 테스트는 SQL 정책 존재와 클라이언트 상태 전이만 확인하며 DB 엔진에서의 RLS 실행을 통과했다고 주장하지 않는다.
