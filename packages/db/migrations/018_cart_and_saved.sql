-- A cart, and a list of things saved for later.
--
-- Both are per-buyer lists of listings, and they are separate tables rather
-- than one with a flag because they mean different things: a cart is an
-- intention to buy now, a saved item is an interest to return to. Moving
-- between them should be a deliberate act, not a column update that could
-- happen by accident.
--
-- Neither holds the item. A note is only taken off the market when an order
-- reserves it — putting a listing in a cart must not stop anyone else buying
-- it, or a single buyer could freeze the whole floor by adding everything.

create table cart_items (
  buyer_id   uuid not null references users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (buyer_id, listing_id)
);

create index cart_items_buyer on cart_items (buyer_id, added_at desc);

comment on table cart_items is
  'Items a buyer intends to purchase. Holds nothing: the listing stays on the '
  'market until an order reserves it, so two buyers may have the same item in '
  'their carts and the first to order wins it.';

create table saved_items (
  buyer_id   uuid not null references users(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  -- Why they saved it, in their own words. A collector watching six ₹100 notes
  -- needs to remember which one was for their father.
  note       text,
  added_at   timestamptz not null default now(),
  primary key (buyer_id, listing_id),
  constraint saved_note_length check (note is null or length(note) <= 500)
);

create index saved_items_buyer on saved_items (buyer_id, added_at desc);

comment on table saved_items is
  'Items a buyer wants to come back to. Survives the item selling, so they can '
  'still see what it went for.';
