-- Where the parcel goes, and whose name is on the bill.
--
-- `addresses` has existed since 001 and has never been written to: there was
-- no route that created one, and `order_groups.shipping_address_id` has been
-- null on every order ever placed. Buyers have been paying without ever saying
-- where the note should be sent.
--
-- The address book is one half. The other half is that an invoice must not
-- change after it is issued. A foreign key alone cannot promise that: the
-- buyer edits the address when they move, and every past invoice silently
-- rewrites itself to an address that had nothing to do with that order. The
-- reference is kept for "send it here", and the text below is the copy taken
-- at the moment of purchase, which is what the bill is rendered from.

alter table order_groups
  add column if not exists bill_to_name   text,
  add column if not exists bill_to_line1  text,
  add column if not exists bill_to_line2  text,
  add column if not exists bill_to_city   text,
  add column if not exists bill_to_state  text,
  add column if not exists bill_to_pin    text,
  add column if not exists bill_to_phone  text,
  add column if not exists bill_to_country char(2) not null default 'IN';

comment on column order_groups.bill_to_name is
  'Snapshot of the recipient at the moment of purchase. Never updated: an '
  'invoice that changes after it is issued is not an invoice.';

-- Only one default per person, enforced rather than hoped for. A partial
-- unique index costs nothing and removes the "two defaults" bug entirely.
create unique index if not exists addresses_one_default_per_user
  on addresses (user_id, kind)
  where is_default;

create index if not exists addresses_by_user on addresses (user_id, created_at desc);
