-- Manual payouts, and a 20% commission.
--
-- Sellers are paid by bank transfer rather than through a gateway split, and
-- they ask for the money themselves once an order has settled. That changes
-- three things: what we charge, what we need to know about a seller's bank
-- account, and the fact that a payout now has a request step.

-- --- commission -----------------------------------------------------------
-- 20% on every sale. Existing orders are untouched: each order stores the
-- amounts it was charged when it was placed, so a rate change never rewrites
-- history or the money already owed to somebody.
update commission_rules set take_rate_bps = 2000;

-- --- bank details ---------------------------------------------------------
-- A gateway split needs only a token. A bank transfer needs the actual account
-- number, so it has to be stored — and therefore encrypted, because a dump of
-- this table would otherwise hand over every seller's bank account.
alter table bank_accounts alter column gateway_token drop not null;

alter table bank_accounts
  add column if not exists account_number_enc text,
  add column if not exists bank_name           text,
  add column if not exists branch              text;

comment on column bank_accounts.account_number_enc is
  'AES-256-GCM ciphertext of the account number, keyed by BANK_DETAILS_KEY, '
  'stored as iv:tag:ciphertext in base64. Never written in the clear, and only '
  'decrypted when an admin is actually making a transfer.';

comment on column bank_accounts.gateway_token is
  'Null while payouts are made by hand. Set once a gateway split is used.';

-- --- payout requests ------------------------------------------------------
-- A payout row is created when an order settles and sits in `pending`, which
-- means available. The seller asks for it, which moves it to `processing`. An
-- admin makes the transfer and marks it `paid` against a bank reference.
alter table payouts
  add column if not exists requested_at timestamptz,
  add column if not exists reference    text,
  add column if not exists paid_by      uuid references users(id),
  add column if not exists note         text;

comment on column payouts.state is
  'pending = settled and available to request; processing = the seller has '
  'requested it; paid = transferred; on_hold = withheld by an admin.';

comment on column payouts.reference is
  'The bank transfer reference (UTR), so a seller asking "where is my money" '
  'can be answered with something they can look up.';

-- One payout per order. Without this, two requests on the same order would pay
-- a seller twice for one sale.
create unique index if not exists payouts_one_per_order on payouts (order_id);

create index if not exists payouts_requested
  on payouts (requested_at) where state = 'processing';
