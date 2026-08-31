-- Sellers, KYC and settlement accounts.
--
-- Rule throughout: identity *numbers* never live here in the clear. We keep a
-- hash for dedupe and the last four characters for support conversations; the
-- document itself lives in object storage behind a short-lived signed URL.
create type seller_kind as enum ('individual', 'sole_proprietor', 'company', 'registered_dealer');
create type kyc_state   as enum ('pending', 'under_review', 'verified', 'rejected', 'suspended', 'expired');

create table sellers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references users(id) on delete cascade,
  kind                seller_kind not null,
  display_name        text not null,
  legal_name          text,
  gstin               text,
  kyc_state           kyc_state not null default 'pending',
  kyc_verified_at     timestamptz,
  -- The public "Minting Verified" badge.
  is_minting_verified boolean not null default false,
  listing_limit       integer not null default 10,
  -- Rolled up from reviews, disputes, cancellations and ship times.
  trust_score         numeric(4,3),
  dispute_rate        numeric(4,3),
  cancellation_rate   numeric(4,3),
  median_ship_hours   integer,
  payout_hold_until   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sellers_gstin_shape
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  constraint sellers_limit_positive check (listing_limit >= 0)
);

create index sellers_kyc_state on sellers (kyc_state);
create trigger sellers_touch before update on sellers for each row execute function set_updated_at();

create type kyc_doc_kind as enum (
  'pan', 'aadhaar_offline_xml', 'digilocker', 'address_proof',
  'selfie_liveness', 'video_kyc', 'incorporation', 'gst_certificate'
);

create table kyc_documents (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references sellers(id) on delete cascade,
  kind             kyc_doc_kind not null,
  number_hash      text,
  number_last4     text,
  storage_key      text not null,
  state            kyc_state not null default 'pending',
  -- Score returned by the verification provider, 0..1.
  name_match_score numeric(4,3),
  reviewed_by      uuid references users(id),
  reviewed_at      timestamptz,
  rejection_reason text,
  expires_at       date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kyc_last4_shape check (number_last4 is null or number_last4 ~ '^[0-9A-Z]{4}$')
);

create index kyc_documents_seller on kyc_documents (seller_id, kind);
create index kyc_documents_expiry on kyc_documents (expires_at) where expires_at is not null;
create trigger kyc_documents_touch before update on kyc_documents for each row execute function set_updated_at();

create table bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  seller_id             uuid not null references sellers(id) on delete cascade,
  -- Tokenised at the payment gateway. The full account number never reaches us.
  gateway_token         text not null,
  account_last4         char(4) not null,
  ifsc                  text not null,
  holder_name           text not null,
  penny_drop_state      kyc_state not null default 'pending',
  penny_drop_name_match numeric(4,3),
  verified_at           timestamptz,
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint bank_ifsc_shape  check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint bank_last4_shape check (account_last4 ~ '^[0-9]{4}$')
);

create unique index bank_accounts_one_default on bank_accounts (seller_id) where is_default;
create trigger bank_accounts_touch before update on bank_accounts for each row execute function set_updated_at();
