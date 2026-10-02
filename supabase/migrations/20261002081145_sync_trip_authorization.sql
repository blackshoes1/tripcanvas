-- NAS와 같은 CAS 권한 규칙. RLS와 기존 RPC 반환 계약을 유지한다.
-- trip_members에는 클라이언트 UPDATE 권한이 없으므로 행 잠금만 하는 비공개 helper를 둔다.
-- helper는 오직 auth.uid() 본인의 멤버 행만 읽으며, Data API에 노출하지 않는다.
create schema if not exists tc_private;
revoke all on schema tc_private from public;
grant usage on schema tc_private to authenticated,service_role;

create or replace function tc_private.lock_trip_role(p_trip_id text)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select m.role into v_role from public.trip_members m
    where m.trip_id::text=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
    limit 1 for share;
  return v_role;
end $$;
revoke all on function tc_private.lock_trip_role(text) from public,anon;
-- 기존 sync_trip을 호출할 수 있던 service_role도 중첩 helper 경계를 통과한다.
grant execute on function tc_private.lock_trip_role(text) to authenticated,service_role;

create or replace function public.sync_trip(p_client_id text,p_data jsonb,p_expected_revision bigint default null,p_force boolean default false)
returns table(applied boolean,conflict boolean,revision bigint,data jsonb,deleted_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare current_row public.trips%rowtype; v_role text; v_id public.trips.id%type;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select t.id into v_id from public.trips t
    where t.client_id=p_client_id and public.tc_trip_role(t.id) is not null
    order by (t.user_id=auth.uid()) desc, t.id limit 1;
  if v_id is null then
    if public.tc_was_member(p_client_id) then
      raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='이 여행에서 나갔거나 내보내졌다';
    end if;
    insert into public.trips(user_id,client_id,data,revision) values(auth.uid(),p_client_id,p_data,1)
      returning trips.revision,trips.data,trips.deleted_at into revision,data,deleted_at;
    return query select true,false,revision,data,deleted_at; return;
  end if;
  -- VIEWER에게 잠금이 행을 숨겨도 새 사본을 만들지 않는다.
  select t.* into current_row from public.trips t where t.id=v_id for no key update;
  if not found then raise exception 'TRIP_FORBIDDEN' using errcode='42501'; end if;
  if current_row.user_id=auth.uid() then
    v_role := 'OWNER';
  else
    v_role := tc_private.lock_trip_role(v_id::text);
  end if;
  if v_role is distinct from 'OWNER' and v_role is distinct from 'EDITOR' then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='이 여행을 바꿀 권한이 없다';
  end if;
  if current_row.deleted_at is not null and p_force and v_role<>'OWNER' then
    raise exception 'TRIP_FORBIDDEN' using errcode='42501', hint='삭제된 여행 복원은 소유자만';
  end if;
  if current_row.deleted_at is not null and not coalesce(p_force,false) then
    return query select false,true,current_row.revision,current_row.data,current_row.deleted_at; return;
  end if;
  if not coalesce(p_force,false) and p_expected_revision is distinct from current_row.revision then
    -- 응답을 잃어 같은 문서를 재전송한 것은 충돌이 아니다.
    return query select false,current_row.data is distinct from p_data,current_row.revision,current_row.data,current_row.deleted_at; return;
  end if;
  update public.trips set data=p_data,revision=current_row.revision+1,deleted_at=null,updated_at=now()
    where id=current_row.id returning trips.revision,trips.data,trips.deleted_at into revision,data,deleted_at;
  return query select true,false,revision,data,deleted_at;
end $$;
revoke all on function public.sync_trip(text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.sync_trip(text,jsonb,bigint,boolean) to authenticated;
