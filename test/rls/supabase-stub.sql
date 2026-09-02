-- Supabase가 기본으로 주는 것들의 최소 대역 — 로컬 PostgreSQL에서 마이그레이션·RLS를 돌려 보기 위한 것.
-- 운영 DB에는 절대 적용하지 않는다(거기엔 진짜가 있다).
-- 역할은 클러스터 전체에 하나다 — 데이터베이스를 새로 만들어도 남아 있으므로 있으면 건너뛴다
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text);
-- Supabase의 auth.uid(): JWT claims의 sub. 테스트는 set_config('request.jwt.claims', ...)로 로그인 사용자를 흉내 낸다.
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
