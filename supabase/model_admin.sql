-- ════════════════════════════════════════════════════════════════════════════
-- Ashara — admin board for model testers (admin.html).
-- Run once in Supabase → SQL Editor, AFTER model_access.sql.
-- Then set the admin password (last line of this file).
--
-- Security model: every admin action is a SECURITY DEFINER function that checks
-- a session token issued by admin_login(). The admin password is stored as a
-- bcrypt hash. 5 wrong passwords from the same IP within 15 minutes → locked.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Tables (RLS on, no policies → not readable with the public key) ────────
create table if not exists public.model_admin (
    id            int primary key default 1 check (id = 1),
    password_hash text not null,
    updated_at    timestamptz not null default now()
);
alter table public.model_admin enable row level security;

create table if not exists public.model_admin_sessions (
    token      uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '8 hours'
);
alter table public.model_admin_sessions enable row level security;

create table if not exists public.model_admin_attempts (
    id         bigint generated always as identity primary key,
    ip         text,
    success    boolean not null,
    created_at timestamptz not null default now()
);
alter table public.model_admin_attempts enable row level security;

-- ── Internal helpers (not callable from the website) ───────────────────────
create or replace function public._admin_client_ip()
returns text language sql stable as $$
    select coalesce(
        nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
        split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
        'unknown');
$$;

create or replace function public._admin_check(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    if p_token is null or not exists (
        select 1 from model_admin_sessions where token = p_token and expires_at > now()
    ) then
        raise exception 'unauthorized' using errcode = '28000';
    end if;
end;
$$;

create or replace function public._new_tester_code()
returns text language sql volatile as $$
    select upper(substr(md5(gen_random_uuid()::text), 1, 8));
$$;

revoke all on function public._admin_client_ip() from public, anon, authenticated;
revoke all on function public._admin_check(uuid) from public, anon, authenticated;
revoke all on function public._new_tester_code() from public, anon, authenticated;

-- ── Admin login / logout ───────────────────────────────────────────────────
create or replace function public.admin_login(p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
    v_ip    text := _admin_client_ip();
    v_hash  text;
    v_fails int;
    v_token uuid;
begin
    select password_hash into v_hash from model_admin where id = 1;
    if v_hash is null then
        return jsonb_build_object('error', 'not_configured');
    end if;

    select count(*) into v_fails from model_admin_attempts
     where ip = v_ip and not success and created_at > now() - interval '15 minutes';
    if v_fails >= 5 then
        return jsonb_build_object('error', 'locked');
    end if;

    if crypt(coalesce(p_password, ''), v_hash) <> v_hash then
        insert into model_admin_attempts (ip, success) values (v_ip, false);
        return jsonb_build_object('error', 'wrong_password');
    end if;

    insert into model_admin_attempts (ip, success) values (v_ip, true);
    delete from model_admin_sessions where expires_at < now();
    insert into model_admin_sessions default values returning token into v_token;
    return jsonb_build_object('token', v_token);
end;
$$;

create or replace function public.admin_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
    delete from model_admin_sessions where token = p_token;
$$;

-- ── Testers ────────────────────────────────────────────────────────────────
create or replace function public.admin_list_testers(p_token uuid)
returns table (name text, access_code text, is_active boolean, created_at timestamptz,
               last_login timestamptz, logins bigint, failed_24h bigint)
language plpgsql security definer set search_path = public as $$
begin
    perform _admin_check(p_token);
    return query
        select t.name, t.access_code, t.is_active, t.created_at,
               max(l.created_at) filter (where l.success),
               count(l.id) filter (where l.success),
               count(l.id) filter (where not l.success and l.created_at > now() - interval '24 hours')
          from model_testers t
          left join model_access_log l on l.tester_name = t.name
         group by t.id
         order by t.created_at desc;
end;
$$;

create or replace function public.admin_add_tester(p_token uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_name text := left(trim(coalesce(p_name, '')), 80);
    v_code text := _new_tester_code();
begin
    perform _admin_check(p_token);
    if v_name = '' then
        return jsonb_build_object('error', 'empty_name');
    end if;
    if exists (select 1 from model_testers where name = v_name) then
        return jsonb_build_object('error', 'exists');
    end if;
    insert into model_testers (name, access_code) values (v_name, v_code);
    return jsonb_build_object('name', v_name, 'code', v_code);
end;
$$;

create or replace function public.admin_set_tester_active(p_token uuid, p_name text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
    perform _admin_check(p_token);
    update model_testers set is_active = p_active where name = p_name;
end;
$$;

create or replace function public.admin_regenerate_code(p_token uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
    v_code text := _new_tester_code();
begin
    perform _admin_check(p_token);
    update model_testers set access_code = v_code where name = p_name;
    return v_code;
end;
$$;

create or replace function public.admin_delete_tester(p_token uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
    perform _admin_check(p_token);
    delete from model_testers where name = p_name;
end;
$$;

create or replace function public.admin_change_password(p_token uuid, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
    v_hash text;
begin
    perform _admin_check(p_token);
    select password_hash into v_hash from model_admin where id = 1;
    if crypt(coalesce(p_old, ''), v_hash) <> v_hash then
        return jsonb_build_object('error', 'wrong_password');
    end if;
    if length(coalesce(p_new, '')) < 8 then
        return jsonb_build_object('error', 'too_short');
    end if;
    update model_admin set password_hash = crypt(p_new, gen_salt('bf')), updated_at = now() where id = 1;
    delete from model_admin_sessions where token <> p_token;  -- sign out other devices
    return jsonb_build_object('ok', true);
end;
$$;

-- ── Set the password from the SQL Editor only ──────────────────────────────
create or replace function public.set_model_admin_password(p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
    if length(coalesce(p_password, '')) < 8 then
        raise exception 'Password must be at least 8 characters';
    end if;
    insert into model_admin (id, password_hash) values (1, crypt(p_password, gen_salt('bf')))
    on conflict (id) do update set password_hash = excluded.password_hash, updated_at = now();
    delete from model_admin_sessions;
    return 'Admin password set';
end;
$$;

-- ── Permissions: the website (anon) may call only the admin_* entry points ──
revoke all on function public.set_model_admin_password(text) from public, anon, authenticated;
revoke all on function public.admin_login(text) from public;
revoke all on function public.admin_logout(uuid) from public;
revoke all on function public.admin_list_testers(uuid) from public;
revoke all on function public.admin_add_tester(uuid, text) from public;
revoke all on function public.admin_set_tester_active(uuid, text, boolean) from public;
revoke all on function public.admin_regenerate_code(uuid, text) from public;
revoke all on function public.admin_delete_tester(uuid, text) from public;
revoke all on function public.admin_change_password(uuid, text, text) from public;
grant execute on function public.admin_login(text) to anon, authenticated;
grant execute on function public.admin_logout(uuid) to anon, authenticated;
grant execute on function public.admin_list_testers(uuid) to anon, authenticated;
grant execute on function public.admin_add_tester(uuid, text) to anon, authenticated;
grant execute on function public.admin_set_tester_active(uuid, text, boolean) to anon, authenticated;
grant execute on function public.admin_regenerate_code(uuid, text) to anon, authenticated;
grant execute on function public.admin_delete_tester(uuid, text) to anon, authenticated;
grant execute on function public.admin_change_password(uuid, text, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- LAST STEP — choose your admin password (8+ characters) and run:
--   select set_model_admin_password('اكتب-باسورد-قوي-هنا');
-- ════════════════════════════════════════════════════════════════════════════
