-- 호텔 가격 관측 기록 (예약 가격 추적) — 추가 전용 테이블.
-- 쓰기: (a) 클라이언트가 자기 확인 결과를 남김(RLS: 본인 행만), (b) 서버 cron(track-hotel-prices,
-- service role — RLS 우회)이 하루 1회 기록. 읽기: 본인 행만 — 클라이언트는 로그인 시 최근 기록을
-- 당겨와 기기 로컬 기록과 합친다(기기 간 히스토리 공유).
-- raw 응답 전체를 저장하지 않고 정규화된 오퍼 요약(offers jsonb, 상한 있음)만 남긴다.

create table if not exists public.hotel_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_client_id text not null,
  booking_id text not null,
  seller text,
  price numeric,
  currency text,
  quality text,
  verified boolean not null default false,
  ptoken text,
  offers jsonb,
  observed_at timestamptz not null default now()
);

create index if not exists hotel_price_snapshots_booking_idx
  on public.hotel_price_snapshots (booking_id, observed_at desc);
create index if not exists hotel_price_snapshots_user_idx
  on public.hotel_price_snapshots (user_id, observed_at desc);

alter table public.hotel_price_snapshots enable row level security;

drop policy if exists hotel_price_snapshots_select_own on public.hotel_price_snapshots;
create policy hotel_price_snapshots_select_own on public.hotel_price_snapshots
  for select to authenticated using (user_id = auth.uid());

drop policy if exists hotel_price_snapshots_insert_own on public.hotel_price_snapshots;
create policy hotel_price_snapshots_insert_own on public.hotel_price_snapshots
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists hotel_price_snapshots_delete_own on public.hotel_price_snapshots;
create policy hotel_price_snapshots_delete_own on public.hotel_price_snapshots
  for delete to authenticated using (user_id = auth.uid());
