-- 함께하기 7단계 — 가고 싶은 곳의 **분류**.
--
-- 후보가 늘면 "뭐 먹지"와 "어디 가지"가 한 목록에 섞여 고르기가 어려워진다.
-- 분류는 **표시와 거르기를 위한 것이지 결정이 아니다** — 인기순 자동 반영이 없는 것과 같은 이유로(§12·§79),
-- 분류가 후보의 순위를 바꾸거나 일정에 자동으로 들어가게 하지 않는다.
--
-- 값만 정하고 화면 이름은 웹·앱이 붙인다(계약에 라벨을 싣지 않는다 — 표기를 바꾸려고 DB를 고치게 되면 안 된다).
-- 비어 있음(null)은 '아직 고르지 않음'이고 '기타(ETC)'와 다르다: 고르지 않은 것을 기타로 단정하지 않는다.
--
-- ⚠️ list_trip_candidates는 **반환형이 바뀌므로** drop 후 create 한다(create or replace는 반환형 변경을 거부해
--    마이그레이션 재적용이 깨진다).

alter table public.trip_candidates add column if not exists category text;

do $$ begin
  alter table public.trip_candidates add constraint trip_candidates_category_check
    check (category is null or category in
      ('RESTAURANT','CAFE','DESSERT','SIGHT','LANDMARK','NATURE','SHOPPING','ACTIVITY','STAY','ETC'));
exception when duplicate_object then null; end $$;

-- ── add_trip_candidate — 분류 인자를 뒤에 더한다 ──
-- ⚠️ 기본값이 있는 인자를 더하면 create or replace가 **교체가 아니라 중복 정의(overload)** 가 된다.
--    그러면 인자 8개짜리 기존 호출이 "function is not unique"로 죽는다 — 웹이 후보를 담는 바로 그 호출이다.
--    그래서 옛 시그니처를 먼저 지운다(권한은 아래에서 다시 건다).
drop function if exists public.add_trip_candidate(text,text,text,double precision,double precision,text,text,text);

create or replace function public.add_trip_candidate(
  p_client_id text, p_title text, p_place_id text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_addr text default null, p_note text default null, p_url text default null,
  p_category text default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_trip_id public.trips.id%type; v_role text; v_title text; v_cat text; v_id bigint;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  v_title := nullif(left(btrim(coalesce(p_title,'')), 120), '');
  if v_title is null then raise exception 'TITLE_REQUIRED' using errcode='22023', hint='후보에는 이름이 있어야 한다'; end if;
  -- 모르는 분류는 거절하지 않고 '고르지 않음'으로 떨어뜨린다 — 분류 하나 때문에 담기가 실패하면 안 된다
  v_cat := upper(nullif(btrim(coalesce(p_category,'')),''));
  if v_cat is not null and v_cat not in
     ('RESTAURANT','CAFE','DESSERT','SIGHT','LANDMARK','NATURE','SHOPPING','ACTIVITY','STAY','ETC')
  then v_cat := null; end if;
  select t.id into v_trip_id from public.trips t
   where t.client_id=p_client_id and t.deleted_at is null and public.tc_trip_role(t.id) is not null
   order by (t.user_id=v_uid) desc, t.id limit 1;
  if v_trip_id is null then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='이 여행을 볼 권한이 없다';
  end if;
  v_role := public.tc_trip_role(v_trip_id);
  if v_role is distinct from 'OWNER' and v_role is distinct from 'EDITOR' then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='보기 권한으로는 후보를 추가할 수 없다';
  end if;
  insert into public.trip_candidates(trip_id, title, place_id, lat, lng, addr, note, url, category, proposed_by)
  values (v_trip_id, v_title, nullif(btrim(coalesce(p_place_id,'')),''), p_lat, p_lng,
          nullif(left(btrim(coalesce(p_addr,'')),200),''), nullif(left(btrim(coalesce(p_note,'')),300),''),
          nullif(left(btrim(coalesce(p_url,'')),500),''), v_cat, v_uid)
  returning id into v_id;
  -- 제안한 사람은 이미 가고 싶다는 뜻이다 — 한 번 더 누르게 하지 않는다.
  insert into public.candidate_reactions(candidate_id, user_id, reaction) values (v_id, v_uid, 'MUST')
    on conflict (candidate_id, user_id) do nothing;
  return v_id;
end $$;

revoke all on function public.add_trip_candidate(text,text,text,double precision,double precision,text,text,text,text) from public, anon;
grant execute on function public.add_trip_candidate(text,text,text,double precision,double precision,text,text,text,text) to authenticated;

-- ── manage_trip_candidate — CATEGORY 액션을 더한다 (같은 시그니처 → create or replace) ──
-- 5단계 정의를 그대로 두고 분기 하나만 얹는다. 행 잠금(for update)·권한 판정·문구는 건드리지 않는다.
-- 분류는 '누가 냈는가'가 아니라 여행 내용이라 SCHEDULE과 같은 편집 권한 기준이다.
create or replace function public.manage_trip_candidate(p_candidate_id bigint, p_action text, p_value text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_cand public.trip_candidates%rowtype; v_role text; v_owner uuid; v_cat text;
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
  elsif p_action='CATEGORY' then
    -- 빈 값이면 '아직 고르지 않음'으로 되돌린다 — 기타(ETC)와 다른 상태다
    v_cat := upper(nullif(btrim(coalesce(p_value,'')),''));
    if v_cat is not null and v_cat not in
       ('RESTAURANT','CAFE','DESSERT','SIGHT','LANDMARK','NATURE','SHOPPING','ACTIVITY','STAY','ETC')
    then raise exception 'INVALID_CATEGORY' using errcode='22023', hint='모르는 분류'; end if;
    update public.trip_candidates c set category=v_cat where c.id=v_cand.id;
    return true;
  end if;
  raise exception 'INVALID_ACTION' using errcode='22023',
    hint='REMOVE · SCHEDULE · UNSCHEDULE · REJECT · REOPEN · CATEGORY';
end $$;

revoke all on function public.manage_trip_candidate(bigint,text,text) from public,anon;
grant execute on function public.manage_trip_candidate(bigint,text,text) to authenticated;

-- ── list_trip_candidates — 반환에 category를 더한다(반환형 변경 → drop 후 create) ──
drop function if exists public.list_trip_candidates(text);
create function public.list_trip_candidates(p_client_id text)
returns table(id bigint, title text, place_id text, lat double precision, lng double precision,
              addr text, note text, url text, category text, status text, scheduled_ref text,
              proposed_by_label text, mine boolean, my_reaction text,
              must_count int, ok_count int, pass_count int, reactions jsonb, comment_count int, created_at timestamptz)
language sql stable security invoker set search_path=public as $$
  with trip as (
    select t.id from public.trips t
     where t.client_id=p_client_id and t.deleted_at is null and public.tc_trip_role(t.id) is not null
     order by (t.user_id=auth.uid()) desc, t.id limit 1
  )
  select c.id, c.title, c.place_id, c.lat, c.lng, c.addr, c.note, c.url, c.category, c.status, c.scheduled_ref,
         public.tc_member_label(c.trip_id, c.proposed_by), c.proposed_by=auth.uid(),
         (select r.reaction from public.candidate_reactions r where r.candidate_id=c.id and r.user_id=auth.uid()),
         (select count(*)::int from public.candidate_reactions r where r.candidate_id=c.id and r.reaction='MUST'),
         (select count(*)::int from public.candidate_reactions r where r.candidate_id=c.id and r.reaction='OK'),
         (select count(*)::int from public.candidate_reactions r where r.candidate_id=c.id and r.reaction='PASS'),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'user_id', r.user_id,
                     'name', public.tc_member_label(c.trip_id, r.user_id),
                     'reaction', r.reaction,
                     'me', r.user_id=auth.uid()) order by r.created_at, r.id)
                     from public.candidate_reactions r where r.candidate_id=c.id), '[]'::jsonb),
         (select count(*)::int from public.trip_comments cm where cm.candidate_id=c.id),
         c.created_at
    from public.trip_candidates c
   where c.trip_id=(select id from trip)
   order by c.created_at desc, c.id desc
$$;

revoke all on function public.list_trip_candidates(text) from public, anon;
grant execute on function public.list_trip_candidates(text) to authenticated;
