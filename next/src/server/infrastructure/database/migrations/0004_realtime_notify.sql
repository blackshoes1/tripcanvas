-- 커밋 → 알림(§42). 활동 행이 들어가면 pg_notify로 알린다. NOTIFY는 **트랜잭션**이라 커밋된 뒤에만 나가고,
-- 롤백된 변경은 알려지지 않는다 — 애플리케이션이 직접 쏘는 것보다 안전하다.
--
-- 페이로드는 작게(§44): 어느 여행에서 · 무슨 종류가 · 몇 번 활동인지만. 제목·본문·문서는 싣지 않는다.
-- 받는 쪽(realtime 사이드카)이 구독자별로 mine을 붙여 내보내고, 내용은 클라이언트가 API로 다시 읽는다(§41·§45).
-- pg_notify 페이로드 한도는 8000바이트다 — 여기 담는 값은 전부 고정 길이라 넘지 않는다.
create or replace function tc_notify_activity() returns trigger
language plpgsql as $$
declare v_client_id text;
begin
  select t.client_id into v_client_id from trips t where t.id = new.trip_id;
  perform pg_notify('tc_realtime', json_build_object(
    'tripId', new.trip_id,
    'clientId', v_client_id,
    'id', new.id,
    'kind', new.kind,
    'actorId', new.actor_id
  )::text);
  return null;
end $$;
--> statement-breakpoint
drop trigger if exists tc_notify_activity on trip_activity;
--> statement-breakpoint
create trigger tc_notify_activity after insert on trip_activity
  for each row execute function tc_notify_activity();
