-- Sessions.
--
-- Opaque random tokens, not JWTs. A JWT cannot be revoked before it expires
-- without a denylist that ends up being this table anyway; for a marketplace
-- holding KYC and payout data, immediate revocation matters more than avoiding
-- a database round trip.
--
-- Only the SHA-256 of the token is stored. A dump of this table therefore does
-- not let anyone log in.

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null unique,
  -- Rotated on refresh; the old row is revoked in the same transaction.
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  revoked_reason text,
  ip            inet,
  user_agent    text,
  constraint sessions_window check (expires_at > issued_at)
);

create index sessions_user   on sessions (user_id, issued_at desc);
create index sessions_active on sessions (expires_at) where revoked_at is null;

-- Login throttling. Counted per identifier and per IP so that neither a single
-- account nor a single source can be hammered.
create table login_attempts (
  id          bigserial primary key,
  identifier  text not null,
  ip          inet,
  succeeded   boolean not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_recent on login_attempts (identifier, attempted_at desc);
create index login_attempts_ip     on login_attempts (ip, attempted_at desc);
