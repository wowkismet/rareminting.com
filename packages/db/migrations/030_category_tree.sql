-- Categories that actually categorise something.
--
-- The table has existed since migration 003 and has never been used: one row
-- in it, no nesting, and `listings.category_id` null on all 423 rows. Browsing
-- filters on `listings.kind` instead, which is an enum of ten broad types and
-- cannot be extended by staff without a migration.
--
-- So the tree is seeded here and the existing listings are filed into it by
-- their kind. Two things follow from doing it this way:
--
--   * `kind` stays exactly as it is. It is on the listings table, it drives
--     the browse filters that work today, and the serial engine keys off it.
--     Replacing it would be a rewrite; the category is an additional, finer
--     filing that staff can extend.
--   * Every listing lands in the top-level category matching its kind, not in
--     a sub-category. Guessing which sub-category a note belongs to from its
--     title would file things wrongly and quietly, and a wrong category is
--     worse than an unset one.

-- Top level, one per kind that is actually in use, plus the empty ones so the
-- tree is complete rather than growing a hole the first time somebody lists a
-- stamp.
insert into categories (slug, name, kind, sort_order, description)
values
  ('rare-notes',      'Rare notes',        'banknote',       10, 'Banknotes collected for their serial numbers.'),
  ('rare-coins',      'Rare coins',        'coin',           20, 'Circulating and commemorative coinage.'),
  ('jewellery',       'Antique jewellery', 'jewellery',      30, 'Worked gold, silver and set pieces.'),
  ('precious-stones', 'Precious stones',   'precious_stone', 40, 'Loose and mounted stones.'),
  ('antiques',        'Antiques',          'antique',        50, 'Objects collected for their age and provenance.'),
  ('stamps',          'Stamps',            'stamp',          60, 'Philatelic material.'),
  ('bonds',           'Bonds',             'bond',           70, 'Historic bond certificates.'),
  ('share-certificates', 'Share certificates', 'share_certificate', 80, 'Scripophily.'),
  ('ephemera',        'Ephemera',          'ephemera',       90, 'Paper collected for its moment.'),
  ('collectibles',    'Collectibles',      'other',         100, 'Everything else worth keeping.')
on conflict (slug) do nothing;

-- Sub-categories under the two kinds that carry nearly all the stock. The rest
-- get sub-categories when there is something to put in them; inventing an
-- empty tree for jewellery now would only be a set of dead links.
insert into categories (slug, name, kind, parent_id, sort_order, description)
select v.slug, v.name, v.kind::item_kind, p.id, v.sort_order, v.description
  from (values
    ('notes-fancy-serial',  'Fancy serial numbers', 'banknote', 'rare-notes', 10, 'Solids, radars, ladders and repeaters.'),
    ('notes-date-serial',   'Date serials',         'banknote', 'rare-notes', 20, 'Numbers that read as a date.'),
    ('notes-star',          'Star replacement',     'banknote', 'rare-notes', 30, 'Printed to replace a spoiled note.'),
    ('notes-low-serial',    'Low serials',          'banknote', 'rare-notes', 40, 'From the first notes off the press.'),
    ('notes-demonetised',   'Demonetised',          'banknote', 'rare-notes', 50, 'No longer legal tender, still collected.'),
    ('coins-commemorative', 'Commemorative',        'coin',     'rare-coins', 10, 'Struck to mark an occasion.'),
    ('coins-circulating',   'Circulating',          'coin',     'rare-coins', 20, 'Everyday coinage, kept for its year or mint.'),
    ('coins-princely',      'Princely states',      'coin',     'rare-coins', 30, 'Pre-independence state issues.'),
    ('coins-british-india', 'British India',        'coin',     'rare-coins', 40, 'Issued under the Raj.')
  ) as v(slug, name, kind, parent_slug, sort_order, description)
  join categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- File everything already listed into its top-level category. Only rows that
-- have none, so this is safe to re-run and never overwrites a choice somebody
-- has made by hand.
update listings l
   set category_id = c.id
  from categories c
 where c.parent_id is null
   and c.kind = l.kind
   and l.category_id is null;

create index if not exists listings_by_category on listings (category_id)
  where deleted_at is null;
