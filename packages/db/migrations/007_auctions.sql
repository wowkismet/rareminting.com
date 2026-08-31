-- Auctions.
--
-- Two rules the schema itself enforces:
--   1. The bid ledger is append-only. Updates and deletes are rejected by a
--      trigger, so a disputed auction can always be reconstructed exactly.
--   2. A bid is idempotent per (auction, bidder, nonce), so a retried request
--      or a double-tap cannot place two bids.
-- Timing is server-authoritative; the client clock is never trusted.

create type auction_kind as enum (
  'english', 'reserve', 'no_reserve', 'sealed_bid', 'timed_buy_now'
);

create type auction_state as enum (
  'scheduled', 'live', 'extended', 'ended', 'settled', 'cancelled'
);

create table auctions (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null unique references listings(id) on delete cascade,
  kind               auction_kind not null default 'english',
  state              auction_state not null default 'scheduled',
  starting_paise     paise not null,
  -- Hidden from bidders. Exposed only as "reserve met" / "not met".
  reserve_paise      paise,
  current_paise      paise,
  bid_count          integer not null default 0,
  buyer_premium_bps  integer not null default 0,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  -- Anti-sniping: a bid inside this window pushes the close out by the same.
  anti_snipe_seconds integer not null default 120,
  extension_count    integer not null default 0,
  max_extensions     integer not null default 20,
  winner_id          uuid references users(id) on delete set null,
  winning_paise      paise,
  -- Refundable hold required before bidding on high-value lots.
  deposit_paise      paise,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint auctions_window_ordered check (ends_at > starts_at),
  constraint auctions_reserve_sane   check (reserve_paise is null or reserve_paise >= starting_paise)
);

create index auctions_live   on auctions (state, ends_at) where state in ('live', 'extended');
create index auctions_upcoming on auctions (starts_at) where state = 'scheduled';
create trigger auctions_touch before update on auctions for each row execute function set_updated_at();

-- Append-only ledger. bigserial, not uuid: order matters and must be total.
create table bids (
  id             bigserial primary key,
  auction_id     uuid not null references auctions(id) on delete restrict,
  bidder_id      uuid not null references users(id) on delete restrict,
  amount_paise   paise not null,
  -- Proxy bidding: the engine bids up to this on the bidder's behalf.
  max_proxy_paise paise,
  is_proxy       boolean not null default false,
  -- Client-supplied idempotency key.
  client_nonce   text not null,
  is_retracted   boolean not null default false,
  retracted_reason text,
  ip             inet,
  user_agent     text,
  placed_at      timestamptz not null default now(),
  constraint bids_amount_positive check (amount_paise > 0),
  constraint bids_proxy_ceiling   check (max_proxy_paise is null or max_proxy_paise >= amount_paise)
);

create unique index bids_idempotent   on bids (auction_id, bidder_id, client_nonce);
create index bids_auction_ledger on bids (auction_id, placed_at desc, id desc);
create index bids_bidder        on bids (bidder_id, placed_at desc);

-- The ledger is immutable. Retraction is a state change made through a
-- controlled path, not a free-form UPDATE, and nothing may ever be deleted.
create or replace function bids_append_only() returns trigger as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'bids is append-only: delete is not permitted';
  end if;
  if new.auction_id  is distinct from old.auction_id
     or new.bidder_id    is distinct from old.bidder_id
     or new.amount_paise is distinct from old.amount_paise
     or new.placed_at    is distinct from old.placed_at then
    raise exception 'bids is append-only: bid facts cannot be altered';
  end if;
  return new;
end;
$fn$ language plpgsql;

create trigger bids_no_delete before delete on bids
  for each row execute function bids_append_only();
create trigger bids_no_rewrite before update on bids
  for each row execute function bids_append_only();

-- Refundable deposits / payment holds for high-value lots.
create table auction_deposits (
  id           uuid primary key default gen_random_uuid(),
  auction_id   uuid not null references auctions(id) on delete cascade,
  bidder_id    uuid not null references users(id) on delete cascade,
  amount_paise paise not null,
  gateway_hold_id text,
  released_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index auction_deposits_one_per_bidder on auction_deposits (auction_id, bidder_id);

-- Non-paying bidder strikes, feeding the second-chance offer flow.
create table bidder_strikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  auction_id uuid references auctions(id) on delete set null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index bidder_strikes_user on bidder_strikes (user_id, created_at desc);
