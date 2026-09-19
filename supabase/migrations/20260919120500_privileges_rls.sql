-- DB-001 / 5. SQL 권한과 RLS
--
-- RLS와 SQL 권한은 서로 다른 검사다(DESIGN 6절). 둘 다 정의한다.
--   * SQL 권한: 클라이언트 역할에는 조회 권한만 준다. INSERT/UPDATE/DELETE 권한은 어디에도 없다.
--   * RLS: 모든 제품 테이블에서 활성화하고 SELECT 정책만 만든다.
--          쓰기 정책이 없으므로 권한이 잘못 부여되더라도 직접 쓰기는 정책 단계에서 다시 막힌다.
--   * 변경은 전용 SECURITY DEFINER RPC로만 한다.
--
-- 역할 정리
--   anon          : 제품 테이블 권한 없음. RLS 헬퍼 실행만 허용(오류 대신 빈 결과를 위해).
--   authenticated : 조회 전용 + 지정한 RPC 실행.
--   service_role  : 조회와 지정한 운영 함수만. 직접 쓰기 권한은 회수한다.
--   postgres      : 마이그레이션·운영 복구 경로.

begin;

-- ---------------------------------------------------------------------------
-- 5.1 기본 권한 회수
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- service_role은 조회·운영 전용이다. 제품 테이블 직접 쓰기를 회수한다.
-- 복구·백필이 필요하면 postgres 역할(psql)로 수행하고 별도 기록을 남긴다.
revoke insert, update, delete, truncate on all tables in schema public from service_role;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5.2 조회 권한
-- ---------------------------------------------------------------------------
grant select on table
  public.profiles,
  public.spaces,
  public.space_members,
  public.space_settings,
  public.assets,
  public.memories,
  public.memory_photos,
  public.restaurants,
  public.restaurant_reviews
to authenticated;

grant select on table
  public.profiles,
  public.spaces,
  public.space_members,
  public.space_settings,
  public.assets,
  public.memories,
  public.memory_photos,
  public.restaurants,
  public.restaurant_reviews
to service_role;

-- space_invites와 mutation_requests는 어떤 클라이언트 역할에도 권한을 주지 않는다.
-- 초대 상태는 public.list_space_invites()로만 확인한다.
revoke all on table public.space_invites     from anon, authenticated, service_role;
revoke all on table public.mutation_requests from anon, authenticated, service_role;

-- RLS 헬퍼 실행 권한. 호출자 자신에 관한 사실만 반환한다.
grant execute on function app.current_space_id()        to anon, authenticated, service_role;
grant execute on function app.is_space_member(uuid)     to anon, authenticated, service_role;
grant execute on function app.is_space_peer(uuid)       to anon, authenticated, service_role;
grant execute on function app.is_asset_attached(uuid)   to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5.3 RLS 활성화
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.spaces             enable row level security;
alter table public.space_members      enable row level security;
alter table public.space_settings     enable row level security;
alter table public.space_invites      enable row level security;
alter table public.assets             enable row level security;
alter table public.memories           enable row level security;
alter table public.memory_photos      enable row level security;
alter table public.restaurants        enable row level security;
alter table public.restaurant_reviews enable row level security;
alter table public.mutation_requests  enable row level security;

-- 주의: FORCE ROW LEVEL SECURITY는 쓰지 않는다.
-- 소유자(postgres)가 정책을 우회해야 SECURITY DEFINER 헬퍼에서 재귀가 생기지 않는다.

-- ---------------------------------------------------------------------------
-- 5.4 SELECT 정책
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_peer on public.profiles;
create policy profiles_select_self_or_peer on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.is_space_peer(id));

drop policy if exists spaces_select_member on public.spaces;
create policy spaces_select_member on public.spaces
  for select to authenticated
  using (id = app.current_space_id());

drop policy if exists space_members_select_member on public.space_members;
create policy space_members_select_member on public.space_members
  for select to authenticated
  using (space_id = app.current_space_id());

drop policy if exists space_settings_select_member on public.space_settings;
create policy space_settings_select_member on public.space_settings
  for select to authenticated
  using (space_id = app.current_space_id());

-- 파일 공개 규칙(DESIGN 6절)
--   * 업로더는 자기 파일을 상태와 무관하게 본다.
--   * 상대 구성원에게는 ready이면서 실제로 기록·커버에 연결된 파일만 보인다.
--   * 대기 중이거나 미첨부, 삭제 예정 파일은 상대에게 보이지 않는다.
drop policy if exists assets_select_member on public.assets;
create policy assets_select_member on public.assets
  for select to authenticated
  using (
    space_id = app.current_space_id()
    and (
      uploader_id = (select auth.uid())
      or (state = 'ready' and app.is_asset_attached(id))
    )
  );

drop policy if exists memories_select_member on public.memories;
create policy memories_select_member on public.memories
  for select to authenticated
  using (space_id = app.current_space_id());

drop policy if exists memory_photos_select_member on public.memory_photos;
create policy memory_photos_select_member on public.memory_photos
  for select to authenticated
  using (space_id = app.current_space_id());

drop policy if exists restaurants_select_member on public.restaurants;
create policy restaurants_select_member on public.restaurants
  for select to authenticated
  using (space_id = app.current_space_id());

-- 개인 후기는 두 구성원이 함께 보고, 작성·수정·삭제는 RPC에서 본인만 가능하다.
drop policy if exists restaurant_reviews_select_member on public.restaurant_reviews;
create policy restaurant_reviews_select_member on public.restaurant_reviews
  for select to authenticated
  using (space_id = app.current_space_id());

-- space_invites, mutation_requests에는 정책을 만들지 않는다(전면 거부).

commit;
