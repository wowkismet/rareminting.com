-- Widen what a seller may list: jewellery, precious stones, and antiques.
--
-- Coins and banknotes were already covered ('coin', 'banknote'), and stamps,
-- bonds, share certificates and ephemera came with the collectibles work.
-- These three are new kinds of thing rather than new categories of note.
--
-- Nothing here uses the new values. Postgres permits ALTER TYPE ... ADD VALUE
-- inside a transaction — which every migration in this project runs in — but
-- refuses to let the same transaction reference the value it just added. A
-- category seed or a check constraint mentioning these belongs in its own
-- migration, after this one has committed.
--
-- The existing `collectibles` table carries these without change: metal,
-- weight_grams, year_of_issue and catalogue_ref are as meaningful for a gold
-- bangle or a certified stone as for a silver rupee. mint_mark and
-- denomination simply stay null, as they already do for a stamp.

alter type item_kind add value if not exists 'jewellery';
alter type item_kind add value if not exists 'precious_stone';
alter type item_kind add value if not exists 'antique';
