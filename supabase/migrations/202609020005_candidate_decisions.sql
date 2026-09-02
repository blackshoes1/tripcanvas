-- 함께하기 5단계 — 갈린 후보의 결정(§23·§24).
--
-- 의견이 갈린 후보를 자동으로 빼지 않는다(§23). 대신 선택지를 보여주고(§24: 다 같이 방문 / 자유시간으로 분리 / 이번 일정에서는 제외)
-- 사람이 고른다. 여기서는 "이번 일정에서는 제외"를 후보 상태 REJECTED로 남기고, 언제든 되돌린다(REOPEN → PROPOSED).
-- 후보를 지우는 게 아니다 — 의견과 코멘트는 그대로 남아 다음에 다시 꺼낼 수 있다.
-- 결정은 의미 있는 변경이라 활동 기록에 남긴다(§38). 되돌리기는 남기지 않는다.

-- ── 활동 종류에 CANDIDATE_REJECTED 추가 ────────────────────────────────────
-- CHECK 제약 이름은 설치마다 다를 수 있어 실제 것을 찾아 지운 뒤 이름을 못 박아 다시 건다(재적용 안전).
do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid='public.trip_activity'::regclass and contype='c' and pg_get_constraintdef(oid) like '%kind%' limit 1;
  if c is not null then execute format('alter table public.trip_activity drop constraint %I', c); end if;
  alter table public.trip_activity add constraint trip_activity_kind_check check (kind in (
    'MEMBER_JOINED','MEMBER_LEFT','MEMBER_REMOVED',
    'CANDIDATE_PROPOSED','CANDIDATE_SCHEDULED','CANDIDATE_REJECTED','REACTION','COMMENT_ADDED',
    'SCHEDULE_CHANGED','BOOKING_ADDED'));
end $$;

-- 후보 트리거: 담기 · 일정에 넣기 · 이번엔 빼기. 되돌리기(REOPEN)와 빼기(REMOVE)는 기록하지 않는다.
create or replace function public.tc_act_candidates() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    perform public.tc_log_activity(new.trip_id,'CANDIDATE_PROPOSED',jsonb_build_object('title',new.title,'candidate_id',new.id));
  elsif tg_op='UPDATE' and new.status='SCHEDULED' and old.status is distinct from 'SCHEDULED' then
    perform public.tc_log_activity(new.trip_id,'CANDIDATE_SCHEDULED',jsonb_build_object('title',new.title,'candidate_id',new.id,'ref',new.scheduled_ref));
  elsif tg_op='UPDATE' and new.status='REJECTED' and old.status is distinct from 'REJECTED' then
    perform public.tc_log_activity(new.trip_id,'CANDIDATE_REJECTED',jsonb_build_object('title',new.title,'candidate_id',new.id));
  end if;
  return null;
end $$;

-- ── manage_trip_candidate: REJECT · REOPEN 추가 (같은 시그니처 — create or replace로 충분하다) ──
-- REMOVE는 제안한 사람이나 주최자만. SCHEDULE·UNSCHEDULE·REJECT·REOPEN은 편집 권한 — 여행의 결정이다.
create or replace function public.manage_trip_candidate(p_candidate_id bigint, p_action text, p_value text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_cand public.trip_candidates%rowtype; v_role text; v_owner uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select c.* into v_cand from public.trip_candidates c where c.id=p_candidate_id for update;
  if not found then return false; end if;
  v_role := public.tc_trip_role(v_cand.trip_id);
  if v_role is null then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='이 여행의 멤버가 아니다';
  end if;
  select t.user_id into v_owner from public.trips t where t.id=v_cand.trip_id;
  if p_action='REMOVE' then
    if v_uid<>v_cand.proposed_by and v_uid<>v_owner then
      raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='후보는 제안한 사람이나 주최자만 지운다';
    end if;
    delete from public.trip_candidates c where c.id=v_cand.id;
    return true;
  end if;
  if v_role is distinct from 'OWNER' and v_role is distinct from 'EDITOR' then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='보기 권한으로는 후보 상태를 바꿀 수 없다';
  end if;
  if p_action='SCHEDULE' then
    update public.trip_candidates c set status='SCHEDULED', scheduled_ref=nullif(btrim(coalesce(p_value,'')),'')
     where c.id=v_cand.id;
    return true;
  elsif p_action='UNSCHEDULE' then
    update public.trip_candidates c set status='PROPOSED', scheduled_ref=null where c.id=v_cand.id;
    return true;
  elsif p_action='REJECT' then
    update public.trip_candidates c set status='REJECTED', scheduled_ref=null where c.id=v_cand.id;
    return true;
  elsif p_action='REOPEN' then
    update public.trip_candidates c set status='PROPOSED', scheduled_ref=null where c.id=v_cand.id;
    return true;
  end if;
  raise exception 'INVALID_ACTION' using errcode='22023', hint='REMOVE · SCHEDULE · UNSCHEDULE · REJECT · REOPEN';
end $$;
-- 권한은 2단계에서 걸어 둔 그대로다(create or replace는 ACL을 유지한다). 그래도 명시한다.
revoke all on function public.manage_trip_candidate(bigint,text,text) from public,anon;
grant execute on function public.manage_trip_candidate(bigint,text,text) to authenticated;
