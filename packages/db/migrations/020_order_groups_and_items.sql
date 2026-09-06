-- A cart that can hold more than one thing.
--
-- Until now an order was a single listing: `orders.listing_id`, one seller,
-- one payment. The cart could be filled but checkout could only ever take one
-- item out of it. Section 4A of the operations document asks for a mixed cart
-- across categories and sellers resolving to a single payment, and everything
-- built on top -- per-item add-ons, per-item insurance, combined delivery --
-- needs that shape underneath it first.
--
-- The useful accident is that `orders` is already one row per seller. So this
-- does not rewrite it. It adds a parent above (`order_groups`, the thing a
-- buyer pays for once) and lines below (`order_items`, what is actually being
-- bought), leaving `orders` as the per-seller fulfilment record it already was.
--
--   order_groups   what the buyer paid for      1 payment
--     └── orders          one seller's part     1 payout, 1 shipment
--           └── order_items    one listing      1 thing in a box
--
-- Deliberately additive. `orders.listing_id` and `orders.seller_id` stay
-- exactly where they are, so every existing query, payout, dashboard and
-- settlement keeps working untouched while checkout is moved over. Dropping
-- them is a later migration, once nothing reads them.

create table order_groups (
  id                  uuid primary key default gen_random_uuid(),
  -- Human-facing reference for the whole basket, quoted in support.
  group_number        text not null unique,
  buyer_id            uuid not null references users(id) on delete restrict,
  shipping_address_id uuid references addresses(id) on delete set null,

  -- What the buyer was actually charged, once, across every seller in it.
  total_paise         paise not null,

  is_gift             boolean not null default false,
  gift_message        text,
  deliver_on          date,

  placed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint order_groups_total_positive check (total_paise > 0)
);

create index order_groups_buyer on order_groups (buyer_id, created_at desc);
create trigger order_groups_touch before update on order_groups
  for each row execute function set_updated_at();

-- Each seller's part of a basket. Null for orders placed before this existed,
-- and for any single-item purchase that never went through a cart.
alter table orders add column group_id uuid references order_groups(id) on delete restrict;
create index orders_group on orders (group_id);

create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  listing_id   uuid not null references listings(id) on delete restrict,

  -- Every line keeps the figures it was sold at. A commission rate that
  -- changes later must not retrospectively alter what a seller was charged,
  -- which is why these are stored rather than recomputed from a rate.
  subtotal_paise          paise not null,
  commission_paise        paise not null default 0,
  gst_on_commission_paise paise not null default 0,
  tds_paise               paise not null default 0,

  -- Per-line fulfilment, because one seller may post two notes separately.
  state        order_state not null default 'created',

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint order_items_subtotal_positive check (subtotal_paise > 0)
);

create index order_items_order   on order_items (order_id);
create index order_items_listing on order_items (listing_id);

-- One listing cannot be sold twice within the same order.
create unique index order_items_unique_listing on order_items (order_id, listing_id);

create trigger order_items_touch before update on order_items
  for each row execute function set_updated_at();

-- Backfill: every existing order becomes a group of one containing one line,
-- so nothing has to special-case orders placed before today. The group takes
-- the order's own number with a G prefix rather than inventing a sequence.
insert into order_groups (
  group_number, buyer_id, shipping_address_id, total_paise,
  is_gift, gift_message, deliver_on, placed_at, created_at
)
select 'G-' || o.order_number, o.buyer_id, o.shipping_address_id, o.total_paise,
       o.is_gift, o.gift_message, o.deliver_on, o.placed_at, o.created_at
  from orders o;

update orders o
   set group_id = g.id
  from order_groups g
 where g.group_number = 'G-' || o.order_number;

insert into order_items (
  order_id, listing_id, subtotal_paise,
  commission_paise, gst_on_commission_paise, tds_paise, state, created_at
)
select o.id, o.listing_id, o.subtotal_paise,
       o.commission_paise, o.gst_on_commission_paise, o.tds_paise,
       o.state, o.created_at
  from orders o
 where o.listing_id is not null;
