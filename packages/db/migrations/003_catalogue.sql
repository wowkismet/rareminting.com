-- The catalogue: listings and everything that describes them.
--
-- `listings` holds what every collectible has in common. Type-specific detail
-- lives in a sibling table keyed by listing_id (`notes` today; `coins` and
-- `collectibles` follow the same shape). This keeps the common query — search,
-- price, order — on one narrow table.

create type item_kind as enum (
  'banknote', 'coin', 'stamp', 'bond', 'share_certificate', 'ephemera', 'other'
);

create type listing_state as enum (
  'draft',           -- seller is still editing
  'pending_review',  -- awaiting Assay / manual review
  'minted',          -- live and purchasable
  'reserved',        -- in an open order, not yet settled
  'struck',          -- sold
  'withdrawn',
  'rejected'
);

create type sale_mode as enum ('fixed', 'offers', 'auction');

-- Standard numismatic ladder, best first.
create type grade as enum ('UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR');

create type bundle_kind as enum ('matched_pair', 'fancy_set', 'family_set', 'curated');

create table categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  kind        item_kind not null,
  parent_id   uuid references categories(id) on delete set null,
  sort_order  integer not null default 0,
  description text,
  created_at  timestamptz not null default now()
);

create table bundles (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references sellers(id) on delete cascade,
  kind          bundle_kind not null,
  title         text not null,
  description   text,
  price_paise   paise,
  state         listing_state not null default 'draft',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger bundles_touch before update on bundles for each row execute function set_updated_at();

create table listings (
  id                   uuid primary key default gen_random_uuid(),
  seller_id            uuid not null references sellers(id) on delete restrict,
  category_id          uuid references categories(id) on delete set null,
  kind                 item_kind not null,
  title                text not null,
  description          text,
  state                listing_state not null default 'draft',
  sale_mode            sale_mode not null default 'fixed',
  -- Null while the item is auction-only.
  price_paise          paise,
  currency             char(3) not null default 'INR',
  grade                grade,
  -- Confidence of the AI grade, 0..1. Null once a human has confirmed.
  grade_confidence     numeric(4,3),
  grade_confirmed_by   uuid references users(id),
  -- Third-party slabbing, when present.
  certification_body   text,
  certification_number text,
  -- A member of a bundle cannot be bought on its own while the bundle is live.
  bundle_id            uuid references bundles(id) on delete set null,
  view_count           integer not null default 0,
  watch_count          integer not null default 0,
  published_at         timestamptz,
  sold_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint listings_fixed_needs_price
    check (sale_mode <> 'fixed' or state not in ('minted', 'reserved') or price_paise is not null),
  constraint listings_grade_confidence_range
    check (grade_confidence is null or (grade_confidence >= 0 and grade_confidence <= 1))
);

create index listings_seller  on listings (seller_id, state);
create index listings_browse  on listings (state, kind, published_at desc);
create index listings_price    on listings (price_paise) where state = 'minted';
create index listings_bundle   on listings (bundle_id) where bundle_id is not null;
create trigger listings_touch before update on listings for each row execute function set_updated_at();

-- Banknote-specific attributes. Every component of the serial is a separate,
-- searchable column — never one opaque string.
create table notes (
  listing_id     uuid primary key references listings(id) on delete cascade,
  denomination   integer not null,
  series         text not null,
  signatory      text,
  year_of_issue  smallint,
  inset_letter   char(1),
  prefix         text,
  prefix_numeral char(1),
  prefix_letters text,
  is_star        boolean not null default false,
  -- Leading zeros are meaningful: 000001 is not 1.
  serial_digits  text not null,
  serial_value   bigint not null,
  digit_count    smallint not null,
  -- Canonical key from serialRegistryKey(): series|denom|inset|prefix|digits.
  registry_key   text not null,
  -- Mirrors whether the parent listing occupies an open state. Denormalised
  -- because an index predicate cannot contain a subquery, and the uniqueness
  -- rule below has to be enforced by the database rather than by application
  -- code that a race can slip past.
  is_live        boolean not null default true,
  constraint notes_digits_only  check (serial_digits ~ '^[0-9]+$'),
  constraint notes_digits_match check (length(serial_digits) = digit_count),
  constraint notes_denom_positive check (denomination > 0)
);

-- One serial, one *live* listing. A note may legitimately be resold years
-- later, so this is scoped to open states rather than being global for all time;
-- `struck` rows remain for provenance and for the re-listing fraud check.
create unique index notes_one_live_listing on notes (registry_key) where is_live;

-- Keep notes.is_live in step with the parent listing's state.
create or replace function sync_note_is_live() returns trigger as $fn$
begin
  update notes
     set is_live = (new.state in ('draft', 'pending_review', 'minted', 'reserved'))
   where listing_id = new.id;
  return new;
end;
$fn$ language plpgsql;

create trigger listings_sync_note_live
  after update of state on listings
  for each row execute function sync_note_is_live();

create index notes_registry  on notes (registry_key);
create index notes_serial    on notes (serial_digits);
create index notes_star      on notes (is_star) where is_star;
create index notes_denom     on notes (denomination, series);

-- Fancy-number taxonomy. Codes mirror PatternCode in @rareminting/serial-engine.
create table pattern_tags (
  code           text primary key,
  label          text not null,
  default_weight numeric(4,3) not null,
  description    text,
  constraint pattern_weight_range check (default_weight >= 0 and default_weight <= 1)
);

create table listing_pattern_tags (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  tag_code   text not null references pattern_tags(code) on delete restrict,
  weight     numeric(4,3) not null,
  -- Empty string rather than null so the unique index behaves predictably.
  detail     text not null default '',
  tier       smallint,
  constraint listing_tag_weight_range check (weight >= 0 and weight <= 1)
);
create unique index listing_pattern_tags_unique
  on listing_pattern_tags (listing_id, tag_code, detail);
create index listing_pattern_tags_code on listing_pattern_tags (tag_code, weight desc);

create type date_order as enum (
  'DDMMYY', 'MMDDYY', 'YYMMDD', 'DDMMYYYY', 'MMDDYYYY', 'YYYYMMDD', 'DDMM', 'MMDD'
);
create type date_era as enum ('heritage', 'historic', 'modern', 'recent', 'future');

-- Every plausible reading of a serial, one row each. This is the table that
-- "Find My Date" searches; it is why the buyer query is an index lookup rather
-- than a scan over serials.
create table date_matches (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  -- Null for partial (day/month only) readings.
  matched_date date,
  day          smallint not null,
  month        smallint not null,
  year         smallint,
  is_partial   boolean not null default false,
  -- Every ordering that yields this same date.
  orders       date_order[] not null,
  score        numeric(5,4) not null,
  confidence   numeric(5,4) not null,
  era          date_era,
  created_at   timestamptz not null default now(),
  constraint date_match_day_range   check (day between 1 and 31),
  constraint date_match_month_range check (month between 1 and 12),
  constraint date_match_partial_shape
    check ((is_partial and year is null and matched_date is null)
        or (not is_partial and year is not null and matched_date is not null))
);

create index date_matches_exact     on date_matches (matched_date) where matched_date is not null;
create index date_matches_day_month on date_matches (month, day);
create index date_matches_listing   on date_matches (listing_id, confidence desc);

create type media_kind as enum (
  'obverse', 'reverse', 'detail', 'uv', 'video', 'unboxing', 'certificate'
);

create table media (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  kind            media_kind not null,
  storage_key     text not null,
  content_type    text,
  width           integer,
  height          integer,
  bytes           bigint,
  -- Perceptual hash for stock-photo and stolen-image detection.
  perceptual_hash text,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);
create index media_listing on media (listing_id, sort_order);
create index media_phash   on media (perceptual_hash) where perceptual_hash is not null;
