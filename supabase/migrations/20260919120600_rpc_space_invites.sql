-- DB-001 / 6. 공간 생성과 초대 RPC
--
-- 공통 규칙
--   * SECURITY DEFINER + 고정 search_path.
--   * 사용자 ID는 auth.uid(), 이메일은 auth.users의 확인된 값만 신뢰한다.
--   * 모든 변경은 (user_id, request_id) 멱등성 기록과 같은 트랜잭션에서 처리한다.
--   * 오류는 app_private.raise_error로 DESIGN 오류 코드에 대응하는 SQLSTATE를 던진다.

begin;

-- ---------------------------------------------------------------------------
-- 6.1 createSpace — 최초 공간 생성
-- ---------------------------------------------------------------------------
-- 생성 권한은 운영자가 app_private.bootstrap_creators에 등록한 확인된 이메일에만 있다.
-- 목록이 비어 있으면 아무도 만들 수 없다(deny closed).
-- 클라이언트는 허용 여부를 입력으로 주장할 수 없다.
create or replace function public.create_space(
  p_name                    text,
  p_introduction            text,
  p_relationship_start_date date,
  p_request_id              uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_email  text;
  v_req    record;
  v_space  uuid;
  v_name   text;
  v_intro  text;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_email := app_private.current_verified_email();

  if v_email is null then
    perform app_private.raise_error('FORBIDDEN', '{"email":"unverified"}');
  end if;
  if not app_private.is_bootstrap_creator(v_email) then
    perform app_private.raise_error('FORBIDDEN', '{"space":"bootstrap_not_allowed"}');
  end if;

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'createSpace',
    jsonb_build_object(
      'name', p_name,
      'introduction', p_introduction,
      'relationshipStartDate', p_relationship_start_date));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  v_name  := btrim(coalesce(p_name, ''));
  v_intro := btrim(coalesce(p_introduction, ''));

  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"name":"length"}');
  end if;
  if char_length(v_intro) > 200 then
    perform app_private.raise_error('VALIDATION_ERROR', '{"introduction":"length"}');
  end if;
  if p_relationship_start_date is not null
     and p_relationship_start_date > app_private.kst_today() then
    perform app_private.raise_error('VALIDATION_ERROR', '{"relationshipStartDate":"future_date"}');
  end if;

  if exists (select 1 from public.space_members m where m.user_id = v_user) then
    perform app_private.raise_error('CONFLICT', '{"space":"already_member"}');
  end if;

  perform app_private.ensure_profile(v_user);

  -- spaces / space_members / space_settings를 한 트랜잭션에서 만든다(DESIGN 5.3).
  insert into public.spaces (created_by, name, introduction, relationship_start_date)
  values (v_user, v_name, v_intro, p_relationship_start_date)
  returning id into v_space;

  begin
    insert into public.space_members (space_id, user_id) values (v_space, v_user);
  exception when unique_violation then
    -- 같은 사용자의 동시 생성 요청. 계정당 공간 하나 제약이 최종 차단한다.
    perform app_private.raise_error('CONFLICT', '{"space":"already_member"}');
  end;

  insert into public.space_settings (space_id) values (v_space);

  v_result := jsonb_build_object('spaceId', v_space, 'version', 1);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.2 createInvite — 대상 이메일 지정 초대
-- ---------------------------------------------------------------------------
-- 토큰 원문은 이 호출의 반환값으로 한 번만 나간다.
-- DB에는 SHA-256 해시만 저장하며, 멱등성 결과에도 토큰을 남기지 않는다.
create or replace function public.create_invite(
  p_target_email text,
  p_request_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_space    uuid;
  v_email    text;
  v_self     text;
  v_req      record;
  v_limit    integer;
  v_count    integer;
  v_ttl      integer;
  v_token    text;
  v_invite   uuid;
  v_expires  timestamptz;
  v_target   uuid;
  v_stored   jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);
  v_email := app_private.normalize_email(p_target_email);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'createInvite',
    jsonb_build_object('targetEmail', v_email));
  if v_req.is_replay then
    -- 이전 응답을 재생한다. 토큰은 다시 발급하지 않는다.
    return v_req.stored_result || jsonb_build_object('token', null, 'tokenIssued', false);
  end if;

  if not app_private.is_valid_email(v_email) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"targetEmail":"format"}');
  end if;

  v_self := app_private.current_verified_email();
  if v_self is not null and v_self = v_email then
    perform app_private.raise_error('VALIDATION_ERROR', '{"targetEmail":"self"}');
  end if;

  -- 이미 이 공간의 구성원인 이메일인지만 확인한다. 그 외 계정 존재 여부는 알리지 않는다.
  select u.id into v_target
    from auth.users u
   where app_private.normalize_email(u.email) = v_email
   limit 1;
  if v_target is not null
     and exists (select 1 from public.space_members m
                  where m.space_id = v_space and m.user_id = v_target) then
    perform app_private.raise_error('VALIDATION_ERROR', '{"targetEmail":"already_member"}');
  end if;

  -- 정원 확인. 공간 행을 잠가 수락과 직렬화한다.
  perform 1 from public.spaces s where s.id = v_space for update;
  v_limit := app_private.config_int('space_member_limit', 2);
  select count(*) into v_count from public.space_members m where m.space_id = v_space;
  if v_count >= v_limit then
    perform app_private.raise_error('SPACE_FULL', '{"space":"member_limit"}');
  end if;

  -- 이전 활성 초대를 폐기한다(DESIGN 7절).
  update public.space_invites i
     set revoked_at = now()
   where i.space_id = v_space
     and i.accepted_at is null
     and i.revoked_at is null;

  v_ttl     := app_private.config_int('invite_ttl_hours', 24);
  v_expires := now() + make_interval(hours => v_ttl);
  v_token   := app_private.new_invite_token();

  insert into public.space_invites (space_id, invited_by, token_hash, target_email, expires_at)
  values (v_space, v_user, app_private.hash_token(v_token), v_email, v_expires)
  returning id into v_invite;

  v_stored := jsonb_build_object(
    'inviteId', v_invite,
    'expiresAt', v_expires,
    'targetEmailMasked', app_private.mask_email(v_email));

  perform app_private.finish_request(v_user, p_request_id, v_stored);

  -- 토큰은 저장하지 않고 이번 응답에만 포함한다.
  return v_stored || jsonb_build_object('token', v_token, 'tokenIssued', true);
end;
$$;

comment on function public.create_invite(text, uuid) is
  '초대 링크 토큰을 한 번만 반환한다. 호출자는 토큰을 로그·저장소에 남기지 않아야 한다.';

-- ---------------------------------------------------------------------------
-- 6.3 revokeInvite
-- ---------------------------------------------------------------------------
create or replace function public.revoke_invite(
  p_invite_id  uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_space  uuid;
  v_req    record;
  v_invite public.space_invites%rowtype;
  v_result jsonb;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'revokeInvite',
    jsonb_build_object('inviteId', p_invite_id));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  select * into v_invite
    from public.space_invites i
   where i.id = p_invite_id and i.space_id = v_space
     for update;
  if not found then
    perform app_private.raise_error('NOT_FOUND', '{"inviteId":"missing"}');
  end if;

  if v_invite.accepted_at is not null then
    perform app_private.raise_error('CONFLICT', '{"inviteId":"already_accepted"}');
  end if;

  if v_invite.revoked_at is null then
    update public.space_invites i set revoked_at = now() where i.id = v_invite.id;
  end if;

  v_result := jsonb_build_object('inviteId', v_invite.id, 'status', 'revoked');
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.4 listSpaceInvites — 상태만 조회
-- ---------------------------------------------------------------------------
-- space_invites에는 SELECT 권한이 없다. 토큰 해시는 어떤 경로로도 반환하지 않는다.
create or replace function public.list_space_invites()
returns table (
  invite_id          uuid,
  target_email_masked text,
  status             text,
  expires_at         timestamptz,
  created_at         timestamptz,
  accepted_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user  uuid;
  v_space uuid;
begin
  v_user  := app_private.require_user();
  v_space := app_private.require_space(v_user);

  return query
  select i.id,
         app_private.mask_email(i.target_email),
         case
           when i.revoked_at is not null  then 'revoked'
           when i.accepted_at is not null then 'accepted'
           when i.expires_at <= now()     then 'expired'
           else 'active'
         end,
         i.expires_at,
         i.created_at,
         i.accepted_at
    from public.space_invites i
   where i.space_id = v_space
   order by i.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6.5 acceptInvite
-- ---------------------------------------------------------------------------
-- 검사 순서: 토큰 존재 → 공간 잠금 → 초대 재확인 → 폐기/만료/대상 이메일 →
--            기존 소속 → 정원. 실패 사유는 모두 INVITE_INVALID/SPACE_FULL로 묶어
--            외부에서 초대·계정 상태를 추측하지 못하게 한다.
create or replace function public.accept_invite(
  p_token      text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_email    text;
  v_hash     text;
  v_req      record;
  v_invite   public.space_invites%rowtype;
  v_invite_id uuid;
  v_space_id uuid;
  v_existing uuid;
  v_limit    integer;
  v_count    integer;
  v_result   jsonb;
begin
  v_user  := app_private.require_user();
  v_email := app_private.current_verified_email();
  v_hash  := app_private.hash_token(coalesce(p_token, ''));

  -- 멱등성 페이로드에도 토큰 원문을 넣지 않는다.
  select * into v_req from app_private.begin_request(
    v_user, p_request_id, 'acceptInvite',
    jsonb_build_object('tokenHash', v_hash));
  if v_req.is_replay then
    return v_req.stored_result;
  end if;

  if p_token is null or char_length(p_token) < 32 then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;
  if v_email is null then
    -- 이메일 확인이 끝나지 않은 계정은 수락할 수 없다.
    perform app_private.raise_error('INVITE_INVALID', '{"email":"unverified"}');
  end if;

  select i.id, i.space_id into v_invite_id, v_space_id
    from public.space_invites i where i.token_hash = v_hash;
  if v_invite_id is null then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  -- 공간 행을 잠가 동시 수락을 직렬화한다(DESIGN 8.1).
  perform 1 from public.spaces s where s.id = v_space_id for update;

  select * into v_invite
    from public.space_invites i
   where i.id = v_invite_id
     for update;
  if not found then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.target_email <> v_email then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = v_user then
      -- 같은 사용자의 재시도는 기존 성공을 돌려준다(DESIGN 8.1-6).
      v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', true);
      return app_private.finish_request(v_user, p_request_id, v_result);
    end if;
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.revoked_at is not null then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"invalid"}');
  end if;

  if v_invite.expires_at <= now() then
    perform app_private.raise_error('INVITE_INVALID', '{"token":"expired"}');
  end if;

  select m.space_id into v_existing from public.space_members m where m.user_id = v_user;
  if v_existing is not null then
    if v_existing = v_invite.space_id then
      -- 이미 이 공간의 구성원이다. 초대를 사용 처리하고 성공으로 돌려준다.
      update public.space_invites i
         set accepted_at = now(), accepted_by = v_user
       where i.id = v_invite.id;
      v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', true);
      return app_private.finish_request(v_user, p_request_id, v_result);
    end if;
    perform app_private.raise_error('CONFLICT', '{"space":"already_member_of_other_space"}');
  end if;

  v_limit := app_private.config_int('space_member_limit', 2);
  select count(*) into v_count from public.space_members m where m.space_id = v_invite.space_id;
  if v_count >= v_limit then
    perform app_private.raise_error('SPACE_FULL', '{"space":"member_limit"}');
  end if;

  perform app_private.ensure_profile(v_user);

  insert into public.space_members (space_id, user_id) values (v_invite.space_id, v_user);

  update public.space_invites i
     set accepted_at = now(), accepted_by = v_user
   where i.id = v_invite.id;

  -- 정원이 찼으면 남은 활성 초대를 모두 폐기한다.
  if v_count + 1 >= v_limit then
    update public.space_invites i
       set revoked_at = now()
     where i.space_id = v_invite.space_id
       and i.accepted_at is null
       and i.revoked_at is null;
  end if;

  v_result := jsonb_build_object('spaceId', v_invite.space_id, 'alreadyAccepted', false);
  return app_private.finish_request(v_user, p_request_id, v_result);
end;
$$;

commit;
