-- A promotional banner that is only the artwork.
--
-- Banners were built on the assumption that the headline is real text laid
-- over a photograph: better for a screen reader, for a slow connection and
-- for search than words baked into a JPEG. That reasoning still holds for a
-- banner we typeset ourselves.
--
-- It does not hold for finished promotional artwork. When a designer hands
-- over a complete piece, laying our own heading and a darkening scrim over it
-- damages the thing we were given, and `object-fit: cover` crops whatever
-- does not fit the box — usually the edges the artwork was composed around.
--
-- So `headline` becomes optional. A banner with no headline is rendered as
-- the image and nothing else: no scrim, no heading, no caption, no button.
-- The trade-off is deliberate and narrow, and the two remaining guards keep
-- it honest:
--
--   * a banner must still carry *something* — an image or a headline, never
--     neither, or it is an empty box on the page
--   * an image still requires alt text, so an image-only banner is not a
--     banner that says nothing to somebody using a screen reader

alter table banners
  alter column headline drop not null;

alter table banners
  drop constraint if exists banners_headline_present;

-- Empty-string headlines were already refused; keep refusing them, while
-- allowing the column to be absent entirely.
alter table banners
  add constraint banners_headline_not_blank
    check (headline is null or length(btrim(headline)) > 0);

alter table banners
  add constraint banners_says_something
    check (storage_key is not null or headline is not null);

comment on column banners.headline is
  'Optional. When null the banner renders as the uploaded artwork alone -- no '
  'heading, caption, button or scrim over it. Set it only when the words are '
  'ours rather than part of the supplied image.';
