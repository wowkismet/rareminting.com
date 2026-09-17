-- Delivery through Shiprocket.
--
-- The courier's identifiers hang off the order rather than the group: each
-- seller posts their own parcel, so one basket paid for in a single charge
-- becomes as many shipments as there are sellers. That is already how
-- delivery is priced (per seller, in charges.ts), and this keeps the two
-- consistent.
--
-- Everything here is a record of what the courier said, not a second source of
-- truth about the order. `orders.state` remains the authority on where a
-- purchase stands; these columns say what Shiprocket knows about the parcel.

alter table orders
  -- Shiprocket's own order id and shipment id. Both are integers on their
  -- side; kept as bigint rather than text so a malformed value cannot be
  -- written at all.
  add column if not exists shiprocket_order_id    bigint,
  add column if not exists shiprocket_shipment_id bigint,
  -- The tracking number the buyer actually asks about.
  add column if not exists awb                    text,
  add column if not exists courier_name           text,
  -- The courier's own words, verbatim. Deliberately not an enum: every
  -- courier has its own vocabulary and it changes without notice, and a
  -- constraint here would mean a delivery failing to record because somebody
  -- invented a new status.
  add column if not exists shipment_status        text,
  add column if not exists shipment_updated_at    timestamptz,
  add column if not exists shipped_at             timestamptz,
  add column if not exists delivered_at           timestamptz;

comment on column orders.awb is
  'Courier tracking number. Unique per parcel, and the only identifier a '
  'buyer or a support agent will ever quote.';

comment on column orders.shipment_status is
  'The courier''s own status text, stored verbatim. Never constrained: each '
  'courier has its own vocabulary and changes it without notice.';

-- One AWB belongs to one parcel. A duplicate means two orders were pointed at
-- the same shipment, which would show one buyer another buyer's tracking.
create unique index if not exists orders_awb_unique on orders (awb)
  where awb is not null;

-- The sweep that asks Shiprocket for updates reads exactly this set: parcels
-- that are on their way and not yet delivered.
create index if not exists orders_in_transit on orders (shipment_updated_at)
  where awb is not null and delivered_at is null;
