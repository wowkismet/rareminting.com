-- Simplified seller onboarding: name, mobile, email, PAN, Aadhaar, OTP.
--
-- Two changes make that possible. Identity is now established by *number*
-- rather than by uploading a scan, so kyc_documents.storage_key becomes
-- optional. And a number may establish exactly one seller, so the hashes are
-- unique — one PAN, one seller.

alter table kyc_documents alter column storage_key drop not null;

comment on column kyc_documents.storage_key is
  'Object-storage key of the uploaded document. Null for number-only KYC, '
  'where the seller typed a PAN or Aadhaar and no scan was collected.';

-- number_hash is an HMAC, not a bare digest: a 12-digit Aadhaar has only 10^12
-- possible values, so an unkeyed hash of one is recoverable by brute force in
-- minutes. The key lives in KYC_NUMBER_PEPPER, outside the database, so a dump
-- of this table alone reveals no identity numbers.
comment on column kyc_documents.number_hash is
  'HMAC-SHA256 of the normalised identity number, keyed by KYC_NUMBER_PEPPER. '
  'Never a bare digest, and never reversible to the number.';

create unique index kyc_documents_number_unique
  on kyc_documents (kind, number_hash)
  where number_hash is not null;

-- Sellers may list without limit once an admin approves them, so the column is
-- no longer consulted. It is left in place rather than dropped: it carries the
-- limits historically applied to existing sellers.
comment on column sellers.listing_limit is
  'Retained for history. Not enforced: an approved seller lists without limit, '
  'and an unapproved one cannot publish at all.';

-- Which admin approved this seller, and when. kyc_verified_at already records
-- the time; this records the person, which is what an audit actually asks for.
alter table sellers add column if not exists approved_by uuid references users(id);

-- OTP challenges are looked up by email as well as phone once email
-- verification uses the same mechanism.
create index if not exists otp_challenges_email_lookup
  on otp_challenges (email, purpose, created_at desc)
  where email is not null;

-- Expired and consumed challenges are worth finding cheaply when pruning.
create index if not exists otp_challenges_expiry on otp_challenges (expires_at);
