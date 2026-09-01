-- Let an audit record outlive the account it refers to.
--
-- `audit_logs.actor_id` was a foreign key with `on delete set null`. Deleting a
-- user therefore tried to UPDATE audit_logs, which the append-only trigger
-- refuses — so no user with any audit history could be deleted at all. That
-- surfaced the first time a real account was removed on the server.
--
-- The fix is to drop the foreign key and keep the uuid as a plain value. That is
-- the right shape for an audit trail anyway: the record of who did what must
-- survive the account being closed, and an immutable log cannot also be
-- rewritten by a cascade.
--
-- Erasure under the DPDP Act is then handled by scrubbing the personal data on
-- the `users` row rather than deleting the row's history: the audit trail keeps
-- an opaque identifier, which is no longer personal data once nothing links it
-- back to a person.

alter table audit_logs drop constraint if exists audit_logs_actor_id_fkey;

comment on column audit_logs.actor_id is
  'The acting user at the time. Intentionally not a foreign key: audit records
   are immutable and must outlive the accounts they reference.';

-- Same reasoning for the other append-only ledger. A bid is a binding
-- commitment and the record of it cannot be rewritten when an account closes.
alter table bids drop constraint if exists bids_bidder_id_fkey;

comment on column bids.bidder_id is
  'The bidder at the time. Not a foreign key: the bid ledger is append-only and
   must outlive the accounts it references.';

/*
 * Scrub a user's personal data while leaving their history intact.
 *
 * For a DPDP erasure request. The account row survives so that orders, bids and
 * audit entries still reference something coherent, but nothing on it
 * identifies a person any more.
 */
create or replace function anonymise_user(target uuid) returns void as $fn$
begin
  update users
     set email             = 'erased+' || target::text || '@invalid',
         full_name         = null,
         phone_e164        = null,
         password_hash     = null,
         email_verified_at = null,
         phone_verified_at = null,
         status            = 'closed',
         updated_at        = now()
   where id = target;

  delete from sessions where user_id = target;
  delete from addresses where user_id = target;
  delete from saved_date_alerts where user_id = target;
  delete from device_fingerprints where user_id = target;
end;
$fn$ language plpgsql;
