-- Pricing intelligence.
--
-- Weights live in `pricing_rules` as data, not in code, so an operator can
-- retune the engine from the admin console without a redeploy. Every suggestion
-- records the rule version that produced it, so a historical price can always
-- be explained.

create table pricing_rules (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  value       jsonb not null,
  description text,
  version     integer not null default 1,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Every edit is retained; the pricing engine can replay any past decision.
create table pricing_rule_history (
  id         bigserial primary key,
  rule_id    uuid not null references pricing_rules(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  version    integer not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create table price_suggestions (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  floor_paise     paise not null,
  fair_paise      paise not null,
  ambitious_paise paise not null,
  confidence      numeric(4,3) not null,
  -- Plain-language reasoning shown to the seller.
  explanation     text not null,
  -- Per-driver contributions, so the band can be audited later.
  drivers         jsonb not null,
  -- Predicted days-to-sale at each point in the band.
  days_to_sale    jsonb,
  model_version   text not null,
  rules_version   integer not null,
  created_at      timestamptz not null default now(),
  constraint price_band_ordered check (floor_paise <= fair_paise and fair_paise <= ambitious_paise),
  constraint price_confidence_range check (confidence >= 0 and confidence <= 1)
);

create index price_suggestions_listing on price_suggestions (listing_id, created_at desc);

-- Closed sales, the comparables corpus. Populated from our own orders and,
-- where licensed, from external auction results.
create table comparable_sales (
  id               uuid primary key default gen_random_uuid(),
  registry_key     text,
  kind             item_kind not null,
  denomination     integer,
  series           text,
  grade            grade,
  pattern_code     text references pattern_tags(code),
  is_star          boolean not null default false,
  sold_price_paise paise not null,
  sold_at          timestamptz not null,
  -- 'internal' for our own orders; otherwise the licensed source.
  source           text not null,
  created_at       timestamptz not null default now()
);

create index comparable_sales_lookup on comparable_sales (kind, denomination, grade, sold_at desc);
create index comparable_sales_pattern on comparable_sales (pattern_code, sold_at desc)
  where pattern_code is not null;

-- Unmatched buyer searches. The "Demand Radar" the seller dashboard surfaces:
-- dates people want that we have no stock for.
create table demand_signals (
  id           uuid primary key default gen_random_uuid(),
  target_date  date,
  day          smallint,
  month        smallint,
  searches_7d  integer not null default 0,
  searches_30d integer not null default 0,
  matched_count integer not null default 0,
  updated_at   timestamptz not null default now()
);

create unique index demand_signals_date on demand_signals (target_date) where target_date is not null;
create index demand_signals_unmet on demand_signals (searches_30d desc) where matched_count = 0;
