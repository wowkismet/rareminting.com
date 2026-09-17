-- Frames, and the personalisation that goes in them.
--
-- A frame is bought with one note, not with a basket: two notes in the same
-- order can take different frames, different photographs and different
-- messages. So the choice hangs off the line, not off the order. That is the
-- opposite of gift packing, which is one box round the whole parcel and lives
-- on `order_groups`.
--
-- The photograph is deliberately NOT in `uploads/`. Nginx serves that
-- directory publicly at /media/, and a customer's family photograph is not
-- public the way a listing's photograph is. It goes where the KYC documents
-- go -- outside anything nginx can reach -- and is served by an authenticated
-- route or not at all.

create table frame_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Stable handle used in URLs and in the front-end's component map. The
  -- name can be rewritten by marketing; this cannot.
  code        text not null unique,
  name        text not null,
  orientation text not null,
  price_paise paise not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint frame_orientation_known
    check (orientation in ('portrait', 'landscape')),
  constraint frame_price_sane
    check (price_paise >= 0 and price_paise <= 5000000)
);

comment on table frame_templates is
  'The frames a buyer can choose. Rendered by the web app from `code`; this '
  'table decides which exist, what they cost and what order they appear in.';

-- The eight approved designs. Prices are placeholders at a round figure and
-- are meant to be set by staff before the service is announced -- they are
-- here so the checkout arithmetic has something real to work with, not
-- because anyone has costed a frame yet.
insert into frame_templates (code, name, orientation, price_paise, sort_order) values
  ('royal-navy',      'Royal Navy',            'portrait',  1499_00, 10),
  ('heritage-blue',   'Heritage Blue',         'portrait',  1499_00, 20),
  ('electric-blue',   'Electric Blue Luxury',  'landscape', 1699_00, 30),
  ('royal-gallery',   'Royal Gallery',         'portrait',  1999_00, 40),
  ('minimal-white',   'Minimal White Luxury',  'portrait',  1299_00, 50),
  ('executive',       'Executive Collection',  'landscape', 1999_00, 60),
  ('signature',       'Signature Edition',     'portrait',  2499_00, 70),
  ('future-heritage', 'Future Heritage',       'landscape', 1699_00, 80)
on conflict (code) do nothing;

-- What the buyer chose, while it is still in the basket.
alter table cart_items
  add column if not exists frame_template_id uuid references frame_templates(id) on delete set null,
  add column if not exists frame_photo_key   text,
  add column if not exists frame_message     text,
  add column if not exists frame_recipient   text,
  add column if not exists frame_sender      text,
  add column if not exists frame_occasion_on date;

-- And what they bought, once it is an order. Copied at checkout rather than
-- joined, and the price with it: a frame that is repriced or withdrawn next
-- month must not change what this invoice says, for the same reason the
-- billing address is copied rather than referenced.
alter table order_items
  add column if not exists frame_template_id uuid references frame_templates(id) on delete set null,
  add column if not exists frame_code        text,
  add column if not exists frame_name        text,
  add column if not exists frame_price_paise paise not null default 0,
  add column if not exists frame_photo_key   text,
  add column if not exists frame_message     text,
  add column if not exists frame_recipient   text,
  add column if not exists frame_sender      text,
  add column if not exists frame_occasion_on date;

comment on column order_items.frame_price_paise is
  'What the frame cost on the day. Never recomputed from frame_templates -- '
  'that row can be repriced or deactivated and this invoice must not move.';

-- The frame total on the group, so the checkout can show it as its own line
-- beside delivery, insurance and gift packing.
alter table order_groups
  add column if not exists frame_paise paise not null default 0;

create index if not exists cart_items_with_frames
  on cart_items (buyer_id) where frame_template_id is not null;
