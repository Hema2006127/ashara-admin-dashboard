-- ════════════════════════════════════════════════════════════════════════════
-- Ashara — who may test the letter model, and a log of every login attempt.
-- Run once in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Allow-list: one row per person, each with a personal access code.
--    No RLS policy = nobody can read it with the public (anon) key.
create table if not exists public.model_testers (
    id          bigint generated always as identity primary key,
    name        text not null unique,
    access_code text not null,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
alter table public.model_testers enable row level security;

-- 2) Access log: every login attempt (success or not). Readable by the dashboard.
create table if not exists public.model_access_log (
    id          bigint generated always as identity primary key,
    tester_name text not null,
    success     boolean not null,
    user_agent  text,
    created_at  timestamptz not null default now()
);
alter table public.model_access_log enable row level security;
drop policy if exists "dashboard reads access log" on public.model_access_log;
create policy "dashboard reads access log" on public.model_access_log
    for select to anon, authenticated using (true);

-- 3) Login check used by /api/login. Logs every attempt; after 5 failures for a
--    name within 15 minutes, further attempts are refused (brute-force guard).
create or replace function public.model_tester_login(p_name text, p_code text, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := left(trim(coalesce(p_name, '')), 80);
    v_ok boolean;
    v_fails int;
begin
    select count(*) into v_fails
      from model_access_log
     where tester_name = v_name and not success and created_at > now() - interval '15 minutes';

    if v_fails >= 5 then
        insert into model_access_log (tester_name, success, user_agent)
        values (v_name, false, left('[blocked] ' || coalesce(p_user_agent, ''), 300));
        return false;
    end if;

    select exists (
        select 1 from model_testers
         where name = v_name and access_code = trim(coalesce(p_code, '')) and is_active
    ) into v_ok;

    insert into model_access_log (tester_name, success, user_agent)
    values (v_name, v_ok, left(p_user_agent, 300));
    return v_ok;
end;
$$;
revoke all on function public.model_tester_login(text, text, text) from public;
grant execute on function public.model_tester_login(text, text, text) to anon, authenticated;

-- 4) Admin helper: add (or re-activate) a tester and get a fresh 8-character code.
--    Only callable from the SQL Editor (not from the website).
create or replace function public.add_model_tester(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
    insert into model_testers (name, access_code) values (trim(p_name), v_code)
    on conflict (name) do update set access_code = excluded.access_code, is_active = true;
    return v_code;
end;
$$;
revoke all on function public.add_model_tester(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Usage (SQL Editor):
--   select add_model_tester('Ahmed');                                   -- returns his code
--   update model_testers set is_active = false where name = 'Ahmed';    -- revoke access
--   select name, is_active, created_at from model_testers;              -- who is allowed
-- ════════════════════════════════════════════════════════════════════════════
