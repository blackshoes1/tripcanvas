-- 함께하기 6단계 — 함께 움직이지 않는 시간(§25~§27)을 위한 준비.
--
-- 갈린 후보를 "자유시간으로 분리"할 때, 꼭 가고 싶은 사람과 이번엔 패스인 사람을 **정확히** 갈라야 한다.
-- 지금 list_trip_candidates의 reactions에는 이름표만 있어서 동명이인이면 갈리지 않는다.
-- 그래서 반응에 user_id를 함께 싣는다.
--
-- 새로 드러나는 것은 없다: 같은 여행의 멤버는 이미 list_trip_members로 서로의 user_id를 본다.
-- 이메일은 여전히 어디에도 나오지 않는다(§69) — 이름표는 tc_member_label()이 만든다.
--
-- ⚠️ 반환형이 바뀌지 않으므로 create or replace로 충분하다. 재적용 안전.

create or replace function public.list_trip_candidates(p_client_id text)
returns table(id bigint, title text, place_id text, lat double precision, lng double precision,
              addr text, note text, url text, status text, scheduled_ref text,
              proposed_by_label text, mine boolean, my_reaction text,
              must_count int, ok_count int, pass_count int, reactions jsonb, comment_count int, created_at timestamptz)
language sql stable security invoker set search_path=public as $$
  with trip as (
    select t.id from public.trips t
     where t.client_id=p_client_id and t.deleted_at is null and public.tc_trip_role(t.id) is not null
     order by (t.user_id=auth.uid()) desc, t.id limit 1
  )
  select c.id, c.title, c.place_id, c.lat, c.lng, c.addr, c.note, c.url, c.status, c.scheduled_ref,
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
