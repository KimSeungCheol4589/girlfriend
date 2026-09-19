-- DB-001 / 4. 세션 컨텍스트 헬퍼와 중복 요청 기반
--
-- app 스키마: RLS 정책이 호출한다. 호출자에게 자기 자신에 관한 사실만 알려주므로
--             anon/authenticated에 EXECUTE를 부여해도 정보가 새지 않는다.
--             SECURITY DEFINER이므로 space_members를 읽을 때 정책을 다시 평가하지 않는다.
--             => RLS 정책의 자기 참조 재귀가 생기지 않는다.
-- app_private 스키마: 변경 RPC 내부에서만 쓴다. 어떤 클라이언트 역할에도 EXECUTE를 주지 않는다.

begin;

-- ---------------------------------------------------------------------------
-- 4.1 RLS용 읽기 전용 헬퍼 (비재귀)
-- ---------------------------------------------------------------------------
create or replace function app.current_space_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.space_id
    from public.space_members m
   where m.user_id = (select auth.uid())
   limit 1;
$$;

comment on function app.current_space_id() is
  '호출자가 속한 공간 ID. 계정당 공간 하나 제약 때문에 최대 1행이다. RLS 정책의 기준값이다.';

create or replace function app.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_space_id is not null
     and exists (
       select 1 from public.space_members m
        where m.space_id = p_space_id
          and m.user_id = (select auth.uid())
     );
$$;

create or replace function app.is_space_peer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1
         from public.space_members me
         join public.space_members other on other.space_id = me.space_id
        where me.user_id = (select auth.uid())
          and other.user_id = p_user_id
     );
$$;

-- 파일이 실제 기록이나 커버에 연결되어 있는지. 상대 구성원에게 공개할지 판단한다.
create or replace function app.is_asset_attached(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_asset_id is not null
     and (
       exists (select 1 from public.memory_photos p where p.asset_id = p_asset_id)
       or exists (select 1 from public.space_settings s where s.cover_asset_id = p_asset_id)
     );
$$;

-- ---------------------------------------------------------------------------
-- 4.2 인증·소속 검사 (내부 전용)
-- ---------------------------------------------------------------------------
create or replace function app_private.require_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    perform app_private.raise_error('UNAUTHENTICATED');
  end if;
  if not exists (select 1 from auth.users u where u.id = v_user) then
    perform app_private.raise_error('UNAUTHENTICATED');
  end if;
  return v_user;
end;
$$;

-- 확인된 이메일만 신뢰한다. JWT의 email 클레임은 사용하지 않는다.
create or replace function app_private.current_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.normalize_email(u.email)
    from auth.users u
   where u.id = (select auth.uid())
     and u.email is not null
     and u.email_confirmed_at is not null;
$$;

comment on function app_private.current_verified_email() is
  'auth.users에서 직접 읽은, 확인 완료된 이메일. 클라이언트가 주장한 값이나 JWT 클레임을 쓰지 않는다.';

create or replace function app_private.require_space(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
begin
  select m.space_id into v_space from public.space_members m where m.user_id = p_user;
  if v_space is null then
    -- 소속이 없으면 대상 데이터의 존재 여부를 알리지 않는다(DESIGN 7절).
    perform app_private.raise_error('NOT_FOUND', '{"space":"not_member"}');
  end if;
  return v_space;
end;
$$;

create or replace function app_private.default_nickname(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_nick  text;
begin
  select u.email into v_email from auth.users u where u.id = p_user;
  v_nick := btrim(left(split_part(coalesce(v_email, ''), '@', 1), 20));
  if v_nick is null or char_length(v_nick) = 0 then
    v_nick := '친구';
  end if;
  return v_nick;
end;
$$;

create or replace function app_private.ensure_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (p_user, app_private.default_nickname(p_user))
  on conflict (id) do nothing;
end;
$$;

comment on function app_private.ensure_profile(uuid) is
  '프로필이 없으면 기본 닉네임으로 만든다. auth 스키마에 트리거를 달지 않기 위해 변경 RPC 진입점에서 호출한다.';

-- ---------------------------------------------------------------------------
-- 4.3 중복 요청(멱등성) 기반
-- ---------------------------------------------------------------------------
-- 같은 (user_id, request_id)
--   * 같은 작업·같은 입력이고 앞선 요청이 성공했으면 저장된 결과를 그대로 돌려준다.
--   * 같은 키에 다른 작업이나 다른 입력이면 CONFLICT로 거부한다.
--   * 동시에 들어온 같은 키는 FOR UPDATE로 직렬화한다. 앞 트랜잭션이 실패하면 행이 사라지므로
--     루프에서 다시 삽입을 시도한다.
--   * 실패한 요청은 롤백으로 기록이 남지 않으므로 같은 requestId로 재시도할 수 있다.
create or replace function app_private.begin_request(
  p_user       uuid,
  p_request_id uuid,
  p_operation  text,
  p_payload    jsonb,
  out is_replay boolean,
  out stored_result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_row  public.mutation_requests%rowtype;
begin
  if p_request_id is null then
    perform app_private.raise_error('VALIDATION_ERROR', '{"requestId":"required"}');
  end if;
  v_hash := app_private.payload_hash(p_payload);

  loop
    insert into public.mutation_requests (user_id, request_id, operation, payload_hash)
    values (p_user, p_request_id, p_operation, v_hash)
    on conflict (user_id, request_id) do nothing;

    if found then
      is_replay := false;
      stored_result := null;
      return;
    end if;

    select * into v_row
      from public.mutation_requests r
     where r.user_id = p_user and r.request_id = p_request_id
       for update;

    if not found then
      -- 경쟁 트랜잭션이 롤백돼 행이 사라졌다. 다시 삽입을 시도한다.
      continue;
    end if;

    if v_row.operation <> p_operation or v_row.payload_hash <> v_hash then
      perform app_private.raise_error('CONFLICT', '{"requestId":"payload_mismatch"}');
    end if;

    if v_row.result is null then
      -- 같은 트랜잭션에서 재진입했거나 결과가 기록되지 않은 비정상 상태다.
      perform app_private.raise_error('RETRYABLE_ERROR', '{"requestId":"in_progress"}');
    end if;

    is_replay := true;
    stored_result := v_row.result;
    return;
  end loop;
end;
$$;

create or replace function app_private.finish_request(
  p_user uuid, p_request_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mutation_requests r
     set result = p_result
   where r.user_id = p_user and r.request_id = p_request_id;
  if not found then
    perform app_private.raise_error('RETRYABLE_ERROR', '{"requestId":"lost"}');
  end if;
  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.4 초대 토큰 생성
-- ---------------------------------------------------------------------------
-- gen_random_uuid()는 강한 난수원을 사용한다. 두 개를 이어 122bit x 2 난수를 만든다.
-- 확장(pgcrypto) 없이 동작하도록 의도적으로 이 방식을 쓴다.
create or replace function app_private.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- ---------------------------------------------------------------------------
-- 4.5 운영 정리 작업 (service_role 전용)
-- ---------------------------------------------------------------------------
-- 만료된 미첨부 파일을 deleting으로 돌린다. Storage 삭제는 앱/스크립트가 이어서 처리한다.
create or replace function app_private.expire_stale_assets(p_limit integer default 500)
returns setof public.assets
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with target as (
    select b.id
      from public.assets b
     where b.state in ('pending', 'ready')
       and b.expires_at is not null
       and b.expires_at < now()
       and not exists (select 1 from public.memory_photos p where p.asset_id = b.id)
       and not exists (select 1 from public.space_settings s where s.cover_asset_id = b.id)
     order by b.expires_at
     limit greatest(coalesce(p_limit, 500), 1)
       for update skip locked
  ),
  updated as (
    update public.assets a
       set state = 'deleting'
      from target t
     where a.id = t.id
     returning a.*
  )
  select * from updated;
end;
$$;

-- Storage에서 파일을 지운 뒤 메타데이터를 제거한다.
create or replace function app_private.purge_deleted_assets(p_asset_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.assets a
   where a.id = any(coalesce(p_asset_ids, '{}'::uuid[]))
     and a.state = 'deleting'
     and not exists (select 1 from public.memory_photos p where p.asset_id = a.id)
     and not exists (select 1 from public.space_settings s where s.cover_asset_id = a.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;
