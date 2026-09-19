-- DB-001 / 11. RPC 실행 권한과 적용 후 자체 점검
--
-- 기본 실행 권한(PUBLIC)을 모두 회수하고 authenticated에만 필요한 함수를 부여한다.
-- anon에는 어떤 변경 RPC도 부여하지 않는다.

begin;

-- ---------------------------------------------------------------------------
-- 11.1 PUBLIC/anon 회수
-- ---------------------------------------------------------------------------
revoke all on all functions in schema public      from public, anon, authenticated;
revoke all on all functions in schema app         from public;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;

-- RLS 헬퍼는 다시 부여한다(5.2와 동일).
grant execute on function app.current_space_id()      to anon, authenticated, service_role;
grant execute on function app.is_space_member(uuid)   to anon, authenticated, service_role;
grant execute on function app.is_space_peer(uuid)     to anon, authenticated, service_role;
grant execute on function app.is_asset_attached(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11.2 로그인 사용자 전용 RPC
-- ---------------------------------------------------------------------------
grant execute on function public.create_space(text, text, date, uuid)                   to authenticated;
grant execute on function public.create_invite(text, uuid)                              to authenticated;
grant execute on function public.revoke_invite(uuid, uuid)                              to authenticated;
grant execute on function public.list_space_invites()                                   to authenticated;
grant execute on function public.accept_invite(text, uuid)                              to authenticated;
grant execute on function public.prepare_upload(text, text, bigint, uuid)               to authenticated;
grant execute on function public.finalize_upload(uuid, bigint, integer, integer, uuid)  to authenticated;
grant execute on function public.discard_upload(uuid, uuid)                             to authenticated;
grant execute on function public.save_memory(uuid, text, text, date, text, text[], uuid[], boolean, integer, uuid)
                                                                                        to authenticated;
grant execute on function public.delete_memory(uuid, integer, uuid)                     to authenticated;
grant execute on function public.save_restaurant(uuid, text, text, text, text, text, integer, uuid)
                                                                                        to authenticated;
grant execute on function public.set_restaurant_status(uuid, text, date, boolean, integer, uuid)
                                                                                        to authenticated;
grant execute on function public.delete_restaurant(uuid, integer, uuid)                 to authenticated;
grant execute on function public.save_review(uuid, smallint, text, integer, uuid)       to authenticated;
grant execute on function public.delete_review(uuid, integer, uuid)                     to authenticated;
grant execute on function public.save_customization(text, text, uuid, jsonb, integer, uuid)
                                                                                        to authenticated;
grant execute on function public.update_space(text, text, date, integer, uuid)          to authenticated;
grant execute on function public.update_profile(text, integer, uuid)                    to authenticated;

-- ---------------------------------------------------------------------------
-- 11.3 운영 함수 (service_role)
-- ---------------------------------------------------------------------------
grant usage on schema app_private to service_role;
grant execute on function app_private.expire_stale_assets(integer)      to service_role;
grant execute on function app_private.purge_deleted_assets(uuid[])      to service_role;
grant execute on function app_private.add_bootstrap_creator(text, text) to service_role;
grant execute on function app_private.remove_bootstrap_creator(text)    to service_role;

-- ---------------------------------------------------------------------------
-- 11.4 적용 직후 자체 점검 — 위반이 있으면 마이그레이션을 실패시킨다
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (1) 클라이언트 역할에 직접 쓰기 권한이 남아 있으면 안 된다.
  select string_agg(format('%s:%s:%s', g.grantee, g.table_name, g.privilege_type), ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.grantee in ('anon', 'authenticated', 'PUBLIC')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'DB-001 권한 점검 실패: 직접 쓰기 권한이 남아 있다 (%)', v_bad;
  end if;

  -- (2) 초대·중복요청 테이블에는 어떤 권한도 없어야 한다.
  select string_agg(format('%s:%s:%s', g.grantee, g.table_name, g.privilege_type), ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name in ('space_invites', 'mutation_requests')
     and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if v_bad is not null then
    raise exception 'DB-001 권한 점검 실패: 민감 테이블 권한이 남아 있다 (%)', v_bad;
  end if;

  -- (3) app_private 함수는 클라이언트 역할이 실행할 수 없어야 한다.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'DB-001 권한 점검 실패: app_private 함수가 노출됐다 (%)', v_bad;
  end if;

  -- (4) 모든 제품 테이블에 RLS가 켜져 있어야 한다.
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'DB-001 권한 점검 실패: RLS 미적용 테이블 (%)', v_bad;
  end if;

  -- (5) SECURITY DEFINER 함수에는 고정 search_path가 있어야 한다.
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app', 'app_private')
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) as c(v) where c.v like 'search\_path=%'));
  if v_bad is not null then
    raise exception 'DB-001 권한 점검 실패: search_path 미고정 SECURITY DEFINER 함수 (%)', v_bad;
  end if;
end;
$$;

commit;
