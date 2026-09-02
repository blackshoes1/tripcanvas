-- 함께하기 4단계 — 여행별 멤버 취향(§16~§18).
--
-- "많이 걷기 싫어요 · 아침 일찍은 괜찮아요 · 미술관 좋아요 · 쇼핑 관심 없음" 같은 것을 **이 여행에 대해** 남긴다.
-- 고정 프로필이 아니다(§18) — 평소엔 빡빡한 여행을 좋아해도 "이번엔 신혼여행이라 여유롭게"가 있다. 그래서 trip_members 행에 산다.
-- 선택형이 기본이다(§16). 화면이 무엇을 보내든 DB에는 **아는 값만** 남긴다(tc_norm_prefs) — 자유 문장은 note 한 줄뿐.
-- 취향은 의견이다 — 보기 권한도 남기고(반응·코멘트와 같은 규칙), 본인 것만 바꾼다. 같은 여행의 멤버끼리는 서로 본다(§10).
-- 합의 점수·그룹 컨텍스트는 클라이언트(collab.js)가 계산한다 — 서버는 재료만 준다.

alter table public.trip_members add column if not exists prefs jsonb not null default '{}'::jsonb;

-- ── 정규화 ──────────────────────────────────────────────────────────────────
-- 허용 키·값. collab.js normPrefs와 **같은 규칙**이어야 한다(화면 미리보기와 저장본이 갈리면 안 된다).
create or replace function public.tc_norm_prefs(p jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare o jsonb := '{}'::jsonb; v text; arr jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' then return o; end if;
  v := p->>'pace';    if v in ('RELAXED','NORMAL','PACKED') then o := o || jsonb_build_object('pace', v); end if;
  v := p->>'walking'; if v in ('LOW','NORMAL','HIGH')       then o := o || jsonb_build_object('walking', v); end if;
  if jsonb_typeof(p->'morning')='boolean' then o := o || jsonb_build_object('morning', (p->>'morning')::boolean); end if;
  if jsonb_typeof(p->'night')='boolean'   then o := o || jsonb_build_object('night',   (p->>'night')::boolean); end if;
  if jsonb_typeof(p->'interests')='array' then
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into arr
      from (select distinct left(btrim(e), 30) as x from jsonb_array_elements_text(p->'interests') e where btrim(e)<>'' limit 12) s;
    if jsonb_array_length(arr)>0 then o := o || jsonb_build_object('interests', arr); end if;   -- 빈 배열은 정보가 없다
  end if;
  if jsonb_typeof(p->'dislikes')='array' then
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into arr
      from (select distinct left(btrim(e), 30) as x from jsonb_array_elements_text(p->'dislikes') e where btrim(e)<>'' limit 12) s;
    if jsonb_array_length(arr)>0 then o := o || jsonb_build_object('dislikes', arr); end if;   -- 빈 배열은 정보가 없다
  end if;
  v := nullif(left(btrim(coalesce(p->>'note','')), 120), '');
  if v is not null then o := o || jsonb_build_object('note', v); end if;
  return o;
end $$;
revoke all on function public.tc_norm_prefs(jsonb) from public, anon, authenticated;

-- ── RPC ─────────────────────────────────────────────────────────────────────

-- 내 취향을 이 여행에 남긴다. 정규화된 결과를 돌려준다 — 화면은 그것을 믿고 그린다.
create or replace function public.set_trip_preference(p_client_id text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_trip_id public.trips.id%type; v_prefs jsonb;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  select t.id into v_trip_id from public.trips t
   where t.client_id=p_client_id and t.deleted_at is null and public.tc_trip_role(t.id) is not null
   order by (t.user_id=v_uid) desc, t.id limit 1;
  if v_trip_id is null then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='이 여행의 멤버가 아니다';
  end if;
  v_prefs := public.tc_norm_prefs(p_prefs);
  update public.trip_members m set prefs=v_prefs
   where m.trip_id=v_trip_id and m.user_id=v_uid and m.status='ACTIVE';
  if not found then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='활성 멤버만 취향을 남긴다';
  end if;
  return v_prefs;
end $$;

-- 같은 여행 멤버들의 취향. 이름표는 tc_member_label — 이메일은 없다(§69).
create or replace function public.list_trip_preferences(p_client_id text)
returns table(user_id uuid, label text, role text, mine boolean, prefs jsonb)
language sql stable security invoker set search_path=public as $$
  with trip as (
    select t.id from public.trips t
     where t.client_id=p_client_id and t.deleted_at is null and public.tc_trip_role(t.id) is not null
     order by (t.user_id=auth.uid()) desc, t.id limit 1
  )
  select m.user_id, public.tc_member_label(m.trip_id, m.user_id), m.role, m.user_id=auth.uid(), m.prefs
    from public.trip_members m
   where m.trip_id=(select id from trip) and m.status='ACTIVE'
   order by (m.role='OWNER') desc, m.joined_at nulls last, m.id
$$;

-- ── 권한 ────────────────────────────────────────────────────────────────────
revoke all on function public.set_trip_preference(text,jsonb) from public,anon;
revoke all on function public.list_trip_preferences(text) from public,anon;
grant execute on function public.set_trip_preference(text,jsonb) to authenticated;
grant execute on function public.list_trip_preferences(text) to authenticated;
