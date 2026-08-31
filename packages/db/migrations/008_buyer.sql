-- Buyer tools: saved dates, watchlists, collections.
--
-- `saved_date_alerts` is the retention engine. A buyer registers the dates that
-- matter to them and we notify the moment a matching note is listed, which is
-- why the alert table is indexed the same way `date_matches` is.

create table saved_date_alerts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  target_date          date not null,
  -- "Mum's birthday", "our anniversary".
  label                text,
  -- When true, a different year still counts as a hit.
  day_month_only       boolean not null default false,
  max_price_paise      paise,
  notify_email         boolean not null default true,
  notify_sms           boolean not null default false,
  notify_push          boolean not null default true,
  is_active            boolean not null default true,
  last_notified_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index saved_date_alerts_unique on saved_date_alerts (user_id, target_date, day_month_only);
create index saved_date_alerts_date      on saved_date_alerts (target_date) where is_active;
create index saved_date_alerts_day_month on saved_date_alerts
  (extract(month from target_date), extract(day from target_date)) where is_active and day_month_only;
create trigger saved_date_alerts_touch before update on saved_date_alerts
  for each row execute function set_updated_at();

create table watchlists (
  user_id    uuid not null references users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index watchlists_listing on watchlists (listing_id);

-- The Vault: what a buyer owns, and what it is worth now.
create table collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  -- Opt-in public collector profile.
  is_public  boolean not null default false,
  slug       text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger collections_touch before update on collections for each row execute function set_updated_at();

create table collection_items (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references collections(id) on delete cascade,
  listing_id      uuid references listings(id) on delete set null,
  order_id        uuid references orders(id) on delete set null,
  -- Denormalised so the portfolio survives the listing being purged.
  title           text not null,
  serial_digits   text,
  acquired_at     date,
  acquired_paise  paise,
  latest_valuation_paise paise,
  valued_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index collection_items_collection on collection_items (collection_id);

-- Want-list: dates and patterns a collector is hunting, matched against new stock.
create table want_list_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  kind         item_kind,
  pattern_code text references pattern_tags(code) on delete set null,
  denomination integer,
  min_grade    grade,
  max_price_paise paise,
  note         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index want_list_active on want_list_entries (user_id) where is_active;
