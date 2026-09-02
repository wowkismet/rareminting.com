-- Coins and other collectibles.
--
-- `notes` is banknote-shaped: it demands a serial number, because a serial is
-- the whole point of a banknote here. A coin has no serial. Rather than bend
-- one table around two very different things, non-banknote items get their own,
-- joined to the same `listings` row — so search, price and ordering stay on one
-- narrow table and only the descriptive attributes differ.

create table collectibles (
  listing_id    uuid primary key references listings(id) on delete cascade,
  -- Face value where there is one. A medal or a token has none.
  denomination  integer,
  -- The year struck or issued. For a coin this is the closest thing it has to
  -- a date, and it is what a buyer looking for their birth year searches on.
  year_of_issue smallint,
  -- Where it was struck: Bombay's diamond, Calcutta's dot, Noida's star.
  mint_mark     text,
  -- Silver, copper-nickel, brass. Free text because the range is open and a
  -- fixed list would reject the first unusual alloy somebody lists.
  metal         text,
  weight_grams  numeric(8,3),
  country_code  char(2) not null default 'IN',
  -- Krause (KM#) or an equivalent standard reference, so a buyer can look the
  -- type up somewhere other than our own description.
  catalogue_ref text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint collectibles_denom_positive check (denomination is null or denomination > 0),
  constraint collectibles_year_sane
    check (year_of_issue is null or (year_of_issue between 1600 and 2100)),
  constraint collectibles_weight_positive
    check (weight_grams is null or weight_grams > 0)
);

create index collectibles_year on collectibles (year_of_issue) where year_of_issue is not null;
create trigger collectibles_touch before update on collectibles
  for each row execute function set_updated_at();

comment on table collectibles is
  'Non-banknote items: coins, stamps, bonds, share certificates, ephemera. '
  'A banknote uses `notes` instead, which requires a serial number.';
