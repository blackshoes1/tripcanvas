-- 여행 기록 (Trip Memory).
--
-- SNS가 아니다. 일정과 실제 흔적을 이어 붙이는 것이 전부다 — "그때 어디였죠?"를 다시 묻지 않기 위해.
--
-- **사진 자체는 저장하지 않는다.** iOS PhotosPicker가 준 local identifier(asset_refs)만 남기고
-- 원본은 기기 사진 보관함에 그대로 둔다(§29·§76.6). 서버로 사진을 대량 업로드하지 않는다.
--
-- 위치는 그 기록이 '어디서 남겨졌는지'를 일정과 잇는 데만 쓴다. 이동 경로를 만들지 않는다.
begin;

create table if not exists public.trip_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_client_id text not null,
  day_index int,
  -- 'd{dayIndex}s{spotIndex}' — 문서 안 위치 기반 id. 일정이 옮겨지면 끊길 수 있어 null을 허용한다.
  activity_id text,
  type text not null check (type in ('PHOTO','NOTE','VISIT','MOMENT')),
  caption text,
  -- PhotosPicker local identifier 목록. 원본 이미지가 아니다.
  asset_refs jsonb not null default '[]'::jsonb,
  lat double precision,
  lng double precision,
  -- 기록이 남겨진 여행지 현지 시각(자정부터 분). 기기 시간대로 환산하지 않는다.
  at_minutes int,
  captured_at timestamptz not null default now(),
  -- 오프라인에서 만든 기록이 온라인 복귀 후 두 번 올라가지 않게(§57).
  client_key text,
  created_at timestamptz not null default now(),
  unique (user_id, client_key)
);

create index if not exists trip_memories_trip_idx
  on public.trip_memories(user_id, trip_client_id, day_index);
create index if not exists trip_memories_activity_idx
  on public.trip_memories(user_id, trip_client_id, activity_id);

alter table public.trip_memories enable row level security;

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='trip_memories' loop
    execute format('drop policy %I on public.trip_memories', p.policyname);
  end loop;
end $$;

create policy "trip_memories_owner_select" on public.trip_memories
  for select to authenticated using ((select auth.uid())=user_id);
create policy "trip_memories_owner_insert" on public.trip_memories
  for insert to authenticated with check ((select auth.uid())=user_id);
create policy "trip_memories_owner_update" on public.trip_memories
  for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "trip_memories_owner_delete" on public.trip_memories
  for delete to authenticated using ((select auth.uid())=user_id);

revoke all on public.trip_memories from anon;
grant select, insert, update, delete on public.trip_memories to authenticated;

commit;
