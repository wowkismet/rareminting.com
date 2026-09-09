-- What a buyer is charged beyond the notes themselves, and what they can take
-- off with a coupon.
--
-- Every figure is stored per order, never recomputed from a rate. A delivery
-- charge that changes next month must not retrospectively alter what somebody
-- was charged last month, and an invoice has to be reconstructable exactly.

alter table order_groups
  add column delivery_paise  paise not null default 0,
  add column insurance_paise paise not null default 0,
  add column gift_paise      paise not null default 0,
  add column discount_paise  paise not null default 0,
  -- What the buyer declared for insurance, where they took it. Kept because a
  -- claim is settled against the declared value, not the sale price.
  add column insured_value_paise paise;

alter table orders
  add column delivery_paise  paise not null default 0,
  add column insurance_paise paise not null default 0,
  add column gift_paise      paise not null default 0,
  add column discount_paise  paise not null default 0;

create type coupon_kind as enum ('percent', 'fixed');

create table coupons (
  id                uuid primary key default gen_random_uuid(),
  -- Stored upper-case; matched case-insensitively. Nobody types a coupon the
  -- way it was printed.
  code              text not null unique,
  description       text,

  kind              coupon_kind not null,
  -- Basis points for a percentage, paise for a fixed amount. Never a float:
  -- 12.5% is 1250 bps, and money that has been through a float is money that
  -- will eventually be a paisa short.
  value             integer not null,

  -- A percentage coupon without a ceiling is an open cheque against the most
  -- expensive thing in the shop.
  max_discount_paise paise,
  min_order_paise    paise not null default 0,

  -- Null means no limit. used_count is incremented under the same lock that
  -- redeems, so two people cannot spend the last one simultaneously.
  usage_limit       integer,
  used_count        integer not null default 0,
  -- How many times one buyer may use it.
  per_buyer_limit   integer not null default 1,

  is_active         boolean not null default true,
  starts_at         timestamptz,
  ends_at           timestamptz,

  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint coupons_code_shape check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint coupons_value_positive check (value > 0),
  constraint coupons_percent_sane check (kind <> 'percent' or value <= 10000),
  constraint coupons_percent_capped check (kind <> 'percent' or max_discount_paise is not null),
  constraint coupons_window_ordered check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint coupons_usage_sane check (usage_limit is null or usage_limit > 0)
);

create index coupons_live on coupons (code) where is_active = true;
create trigger coupons_touch before update on coupons
  for each row execute function set_updated_at();

create table coupon_redemptions (
  id             uuid primary key default gen_random_uuid(),
  coupon_id      uuid not null references coupons(id) on delete restrict,
  order_group_id uuid not null references order_groups(id) on delete restrict,
  buyer_id       uuid not null references users(id) on delete restrict,
  -- What it actually took off, not what the rule says it would.
  discount_paise paise not null,
  created_at     timestamptz not null default now(),

  constraint redemption_positive check (discount_paise > 0)
);

-- One coupon cannot be applied twice to the same basket.
create unique index coupon_redemptions_once on coupon_redemptions (coupon_id, order_group_id);
create index coupon_redemptions_buyer on coupon_redemptions (coupon_id, buyer_id);
