-- Identity: accounts, roles, addresses, OTP.
--
-- Money is never stored as a float. `paise` is the integer minor unit of INR;
-- every amount in this schema is a whole number of paise.
create domain paise as bigint check (value >= 0);

-- Touch trigger, reused by every table carrying updated_at.
create or replace function set_updated_at() returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$ language plpgsql;

create type user_status as enum ('pending', 'active', 'suspended', 'closed');
create type user_role   as enum ('buyer', 'seller', 'admin', 'support', 'grievance_officer');

create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  email_verified_at timestamptz,
  phone_e164        text,
  phone_verified_at timestamptz,
  -- Null for OTP-only accounts. Argon2id; never a reversible encoding.
  password_hash     text,
  full_name         text,
  status            user_status not null default 'pending',
  -- DPDP Act: consent is recorded, not assumed.
  consent_version   text,
  consented_at      timestamptz,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint users_email_shape check (position('@' in email) > 1),
  constraint users_phone_shape check (phone_e164 is null or phone_e164 ~ '^[+][1-9][0-9]{7,14}$')
);

-- Case-insensitive uniqueness without requiring the citext extension.
create unique index users_email_key on users (lower(email));
create unique index users_phone_key on users (phone_e164) where phone_e164 is not null;
create trigger users_touch before update on users for each row execute function set_updated_at();

create table user_roles (
  user_id    uuid not null references users(id) on delete cascade,
  role       user_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id),
  primary key (user_id, role)
);

create type address_kind as enum ('shipping', 'billing', 'pickup');

create table addresses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  kind           address_kind not null default 'shipping',
  recipient_name text not null,
  line1          text not null,
  line2          text,
  city           text not null,
  state          text not null,
  postal_code    text not null,
  country_code   char(2) not null default 'IN',
  phone_e164     text,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint addresses_pincode_shape
    check (country_code <> 'IN' or postal_code ~ '^[1-9][0-9]{5}$')
);

create unique index addresses_one_default on addresses (user_id, kind) where is_default;
create trigger addresses_touch before update on addresses for each row execute function set_updated_at();

-- Mobile OTP. Codes are hashed: a leaked table must not grant account access.
create table otp_challenges (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text,
  email        text,
  code_hash    text not null,
  purpose      text not null,
  attempts     smallint not null default 0,
  max_attempts smallint not null default 5,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint otp_target_present check (phone_e164 is not null or email is not null)
);

create index otp_challenges_lookup on otp_challenges (phone_e164, purpose, created_at desc);
