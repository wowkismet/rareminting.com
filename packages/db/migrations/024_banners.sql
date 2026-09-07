-- Promotional banners, placed by staff.
--
-- A slot is a named position on the site rather than a page path, so a banner
-- survives a page being restructured and cannot be pointed at a route that
-- does not exist.
--
-- Scheduling is a window, not a boolean. "Live until Diwali" is the thing
-- somebody actually wants, and a flag they have to remember to turn off is a
-- Republic Day banner still up in March.

create type banner_slot as enum (
  'home_hero',      -- across the top of the homepage
  'home_mid',       -- between the listings
  'listing_page',   -- on a single listing
  'cart',           -- in the basket
  'browse'          -- above the floor
);

create table banners (
  id          uuid primary key default gen_random_uuid(),
  slot        banner_slot not null,

  -- Shown over the image, so a banner still says something if the image fails
  -- to load or somebody is reading with images off.
  headline    text not null,
  subtext     text,
  -- Where it sends somebody. Same-site paths only; enforced in the route.
  href        text,
  cta_label   text,

  -- The image is optional: a banner can be type on the brand green, which
  -- loads instantly and reads well on a phone.
  storage_key text,
  -- Description for screen readers. Required whenever there is an image.
  alt_text    text,

  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,

  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint banners_headline_present check (length(btrim(headline)) > 0),
  constraint banners_window_ordered check (ends_at is null or starts_at is null or ends_at > starts_at),
  -- An image with no description is unusable to anybody using a screen reader,
  -- and this is the one place the copy is written by staff rather than a
  -- seller, so there is no excuse for letting it through.
  constraint banners_image_described check (storage_key is null or length(btrim(coalesce(alt_text, ''))) > 0)
);

create index banners_slot on banners (slot, sort_order)
  where is_active = true;
create trigger banners_touch before update on banners
  for each row execute function set_updated_at();
