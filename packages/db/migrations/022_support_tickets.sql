-- Support tickets, and the conversation on each.
--
-- A buyer or a seller opens one; staff reply; either side can add to the trail
-- until it is closed. Distinct from a dispute on purpose: a dispute is
-- attached to an order, carries money and has an evidence deadline. A ticket
-- is a question, and most questions are not about an order at all.
--
-- A ticket may still reference an order where there is one, because "where is
-- my note" is the commonest question there is and answering it without the
-- order in front of you is guesswork.

create type ticket_state as enum ('open', 'awaiting_reply', 'answered', 'resolved', 'closed');

create type ticket_topic as enum (
  'order', 'payment', 'delivery', 'listing', 'account', 'kyc', 'payout', 'other'
);

create table support_tickets (
  id            uuid primary key default gen_random_uuid(),
  -- Human-facing reference, quoted in an email or over the phone.
  ticket_number text not null unique,

  raised_by     uuid not null references users(id) on delete restrict,
  -- Which hat they were wearing. The same person may be both, and a seller
  -- asking about a payout needs a different queue from a buyer chasing a note.
  raised_as     text not null default 'buyer',

  order_id      uuid references orders(id) on delete set null,
  listing_id    uuid references listings(id) on delete set null,

  topic         ticket_topic not null default 'other',
  subject       text not null,
  state         ticket_state not null default 'open',

  -- Staff member currently holding it, if anyone has picked it up.
  assigned_to   uuid references users(id) on delete set null,

  -- Set when a person first replies, so a first-response time can be measured
  -- against something real rather than inferred from message ordering.
  first_replied_at timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tickets_subject_present check (length(btrim(subject)) > 0),
  constraint tickets_raised_as_known check (raised_as in ('buyer', 'seller'))
);

create index tickets_raiser on support_tickets (raised_by, created_at desc);
create index tickets_open   on support_tickets (state, created_at)
  where state not in ('resolved', 'closed');
create index tickets_order  on support_tickets (order_id) where order_id is not null;

create trigger support_tickets_touch before update on support_tickets
  for each row execute function set_updated_at();

create table ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references support_tickets(id) on delete cascade,
  author_id   uuid not null references users(id) on delete restrict,
  -- Whether this was written by staff. Kept on the message rather than derived
  -- from the author's current roles: somebody who answered a ticket as staff
  -- and later lost the role still wrote a staff reply, and the trail should
  -- not change its meaning afterwards.
  from_staff  boolean not null default false,
  body        text not null,
  -- Notes staff leave for each other, never shown to the person who asked.
  is_internal boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint ticket_messages_body_present check (length(btrim(body)) > 0),
  constraint ticket_messages_internal_is_staff check (is_internal = false or from_staff = true)
);

create index ticket_messages_ticket on ticket_messages (ticket_id, created_at);

-- The trail is append-only. A support conversation is the record of what was
-- promised to a customer, and a promise that can be edited afterwards is not
-- a record of anything.
create or replace function ticket_messages_immutable() returns trigger as $$
begin
  raise exception 'ticket_messages is append-only';
end;
$$ language plpgsql;

create trigger ticket_messages_no_update before update on ticket_messages
  for each row execute function ticket_messages_immutable();

create trigger ticket_messages_no_delete before delete on ticket_messages
  for each row execute function ticket_messages_immutable();
