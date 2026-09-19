-- DB-001 / 2. 제품 테이블과 제약
--
-- 설계 기준: DESIGN.md 5절(데이터 설계), 5.3(데이터 무결성).
-- 무결성 방침
--   * 공간 간 잘못된 연결은 복합 외래키 (id, space_id)로 DB가 직접 차단한다.
--   * 파일 경로는 생성 열로 고정해 클라이언트가 경로를 정할 수 없게 한다.
--   * 행 간 검사(정원, 사진 수, 커버 상태)는 트리거·RPC에서 처리한다.

begin;

-- ---------------------------------------------------------------------------
-- 2.1 profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_trimmed check (nickname = btrim(nickname)),
  constraint profiles_nickname_length  check (char_length(nickname) between 1 and 20),
  constraint profiles_version_positive check (version >= 1)
);

comment on table public.profiles is '사용자 프로필. PK는 auth.users.id이며 직접 DML은 허용하지 않는다.';

-- ---------------------------------------------------------------------------
-- 2.2 spaces
-- ---------------------------------------------------------------------------
create table if not exists public.spaces (
  id                       uuid primary key default gen_random_uuid(),
  created_by               uuid not null references public.profiles (id) on delete restrict,
  name                     text not null,
  introduction             text not null default '',
  relationship_start_date  date,
  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint spaces_name_trimmed      check (name = btrim(name)),
  constraint spaces_name_length       check (char_length(name) between 1 and 30),
  constraint spaces_introduction_len  check (char_length(introduction) <= 200),
  constraint spaces_version_positive  check (version >= 1)
);

-- ---------------------------------------------------------------------------
-- 2.3 space_members — 계정당 공간 하나
-- ---------------------------------------------------------------------------
create table if not exists public.space_members (
  space_id  uuid not null references public.spaces (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id),
  -- 계정당 공간 하나(DESIGN 5.2). 동시 수락 경쟁도 이 제약으로 최종 차단된다.
  constraint space_members_one_space_per_user unique (user_id),
  -- 후기·소속 검사를 복합 FK로 강제하기 위한 보조 유니크.
  constraint space_members_user_space_key unique (user_id, space_id)
);

-- ---------------------------------------------------------------------------
-- 2.4 assets — 업로드 파일 메타데이터
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  purpose     text not null,
  mime_type   text not null,
  state       text not null default 'pending',
  -- 경로는 서버가 정한다. 생성 열이므로 클라이언트가 임의 경로를 지정하거나 덮어쓸 수 없다.
  object_path text generated always as (
    space_id::text || '/' || id::text || '.' ||
    case mime_type
      when 'image/jpeg' then 'jpg'
      when 'image/png'  then 'png'
      when 'image/webp' then 'webp'
      else 'bin'
    end
  ) stored,
  bytes       bigint,
  width       integer,
  height      integer,
  expires_at  timestamptz,
  ready_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint assets_object_path_key unique (object_path),
  constraint assets_id_space_key    unique (id, space_id),
  constraint assets_purpose_allowed check (purpose in ('memory', 'cover')),
  constraint assets_state_allowed   check (state in ('pending', 'ready', 'deleting')),
  constraint assets_mime_allowed    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint assets_bytes_range     check (bytes is null or (bytes > 0 and bytes <= 10485760)),
  constraint assets_width_range     check (width is null or (width between 1 and 20000)),
  constraint assets_height_range    check (height is null or (height between 1 and 20000)),
  -- ready 상태에는 검증된 메타데이터가 반드시 있어야 한다.
  constraint assets_ready_requires_metadata check (
    state <> 'ready'
    or (bytes is not null and width is not null and height is not null and ready_at is not null)
  )
);

create index if not exists assets_cleanup_idx on public.assets (state, expires_at);
create index if not exists assets_space_idx   on public.assets (space_id, purpose, state);
create index if not exists assets_uploader_idx on public.assets (uploader_id);

comment on column public.assets.object_path is
  'Storage 경로. space_id/asset_id.ext 형식의 생성 열이며 수정할 수 없다.';
comment on column public.assets.expires_at is
  '미첨부 파일 정리 기준 시각. 첨부되면 RPC가 NULL로 만든다.';

-- ---------------------------------------------------------------------------
-- 2.5 space_settings — 공간당 하나
-- ---------------------------------------------------------------------------
create table if not exists public.space_settings (
  space_id       uuid primary key references public.spaces (id) on delete cascade,
  theme_key      text not null default 'cream',
  accent_color   text not null default '#8b435a',
  cover_asset_id uuid,
  home_sections  jsonb not null default app_private.default_home_sections(),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint space_settings_theme_allowed check (theme_key in ('cream', 'rose', 'sage')),
  constraint space_settings_accent_format check (accent_color ~ '^#[0-9a-f]{6}$'),
  constraint space_settings_sections_valid check (app_private.is_valid_home_sections(home_sections)),
  constraint space_settings_version_positive check (version >= 1),
  -- 커버는 같은 공간의 파일만 참조할 수 있다(공간 간 링크 차단).
  constraint space_settings_cover_fk foreign key (cover_asset_id, space_id)
    references public.assets (id, space_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- 2.6 space_invites — 토큰 원문 저장 금지
-- ---------------------------------------------------------------------------
create table if not exists public.space_invites (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  invited_by   uuid not null references public.profiles (id) on delete restrict,
  token_hash   text not null,
  target_email text not null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id) on delete restrict,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint space_invites_token_hash_key unique (token_hash),
  constraint space_invites_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint space_invites_target_email_valid check (app_private.is_valid_email(target_email)),
  constraint space_invites_accept_consistent check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  ),
  -- 폐기된 초대는 수락 상태가 될 수 없다.
  constraint space_invites_not_revoked_and_accepted check (revoked_at is null or accepted_at is null)
);

create index if not exists space_invites_space_idx on public.space_invites (space_id, created_at desc);
create index if not exists space_invites_active_idx on public.space_invites (space_id)
  where accepted_at is null and revoked_at is null;

comment on table public.space_invites is
  '초대. token_hash만 저장하며 어떤 역할에도 SELECT 권한을 주지 않는다. 상태 조회는 public.list_space_invites()를 쓴다.';

-- ---------------------------------------------------------------------------
-- 2.7 memories
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete restrict,
  title       text not null,
  body        text not null default '',
  memory_date date not null,
  location    text,
  tags        text[] not null default '{}'::text[],
  is_pinned   boolean not null default false,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint memories_id_space_key   unique (id, space_id),
  constraint memories_title_trimmed  check (title = btrim(title)),
  constraint memories_title_length   check (char_length(title) between 1 and 80),
  constraint memories_body_length    check (char_length(body) <= 10000),
  constraint memories_location_length check (location is null or char_length(location) between 1 and 100),
  constraint memories_tags_valid     check (app_private.is_valid_tags(tags)),
  constraint memories_version_positive check (version >= 1)
);

create index if not exists memories_list_idx on public.memories (space_id, memory_date desc, id desc);
create index if not exists memories_tags_idx on public.memories using gin (tags);
create index if not exists memories_pinned_idx on public.memories (space_id, is_pinned) where is_pinned;

-- ---------------------------------------------------------------------------
-- 2.8 memory_photos
-- ---------------------------------------------------------------------------
create table if not exists public.memory_photos (
  id         uuid primary key default gen_random_uuid(),
  memory_id  uuid not null,
  space_id   uuid not null,
  asset_id   uuid not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  -- 파일 하나는 최대 한 기록에만 연결된다.
  constraint memory_photos_asset_key unique (asset_id),
  -- 재정렬을 한 트랜잭션에서 처리할 수 있도록 커밋 시점 검사로 둔다(DESIGN 5.3).
  constraint memory_photos_order_key unique (memory_id, sort_order) deferrable initially deferred,
  constraint memory_photos_order_range check (sort_order between 0 and 9),
  -- 기록과 파일이 같은 공간인지 FK 수준에서 강제한다.
  constraint memory_photos_memory_fk foreign key (memory_id, space_id)
    references public.memories (id, space_id) on delete cascade,
  constraint memory_photos_asset_fk foreign key (asset_id, space_id)
    references public.assets (id, space_id) on delete restrict
);

create index if not exists memory_photos_space_idx on public.memory_photos (space_id);

-- ---------------------------------------------------------------------------
-- 2.9 restaurants
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  name         text not null,
  area         text not null default '',
  category     text not null default '',
  map_url      text,
  memo         text not null default '',
  status       text not null default 'wishlist',
  visited_date date,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint restaurants_id_space_key  unique (id, space_id),
  constraint restaurants_name_trimmed  check (name = btrim(name)),
  constraint restaurants_name_length   check (char_length(name) between 1 and 100),
  constraint restaurants_area_length   check (char_length(area) <= 50),
  constraint restaurants_category_length check (char_length(category) <= 50),
  constraint restaurants_memo_length   check (char_length(memo) <= 2000),
  constraint restaurants_status_allowed check (status in ('wishlist', 'visited')),
  constraint restaurants_map_url_https check (map_url is null or map_url ~ '^https://[^[:space:]]{3,500}$'),
  -- 방문 상태와 방문일은 항상 함께 움직인다(DESIGN 5.3).
  constraint restaurants_visit_consistent check (
    (status = 'visited'  and visited_date is not null)
    or (status = 'wishlist' and visited_date is null)
  ),
  constraint restaurants_version_positive check (version >= 1)
);

create index if not exists restaurants_list_idx on public.restaurants (space_id, status, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 2.10 restaurant_reviews — 맛집·사용자당 하나
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_reviews (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  space_id      uuid not null,
  user_id       uuid not null,
  rating        smallint not null,
  comment       text not null default '',
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint restaurant_reviews_owner_key unique (restaurant_id, user_id),
  constraint restaurant_reviews_rating_range check (rating between 1 and 5),
  constraint restaurant_reviews_comment_length check (char_length(comment) <= 500),
  constraint restaurant_reviews_version_positive check (version >= 1),
  constraint restaurant_reviews_restaurant_fk foreign key (restaurant_id, space_id)
    references public.restaurants (id, space_id) on delete cascade,
  -- 후기 작성자는 반드시 그 공간의 구성원이어야 한다.
  constraint restaurant_reviews_member_fk foreign key (user_id, space_id)
    references public.space_members (user_id, space_id) on delete cascade
);

create index if not exists restaurant_reviews_restaurant_idx on public.restaurant_reviews (restaurant_id);
create index if not exists restaurant_reviews_space_idx on public.restaurant_reviews (space_id, user_id);

-- ---------------------------------------------------------------------------
-- 2.11 mutation_requests — 중복 요청 방지
-- ---------------------------------------------------------------------------
create table if not exists public.mutation_requests (
  user_id      uuid not null references auth.users (id) on delete cascade,
  request_id   uuid not null,
  operation    text not null,
  payload_hash text not null,
  result       jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, request_id),
  constraint mutation_requests_operation_length check (char_length(operation) between 1 and 64),
  constraint mutation_requests_payload_hash_format check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists mutation_requests_created_idx on public.mutation_requests (created_at);

comment on table public.mutation_requests is
  '사용자·requestId 단위 중복 요청 결과 보관. 어떤 클라이언트 역할에도 권한을 주지 않는다.';

commit;
