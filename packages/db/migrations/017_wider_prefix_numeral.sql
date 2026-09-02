-- Widen the prefix numeral.
--
-- A Mahatma Gandhi New Series prefix is three characters, but in two shapes:
-- one numeral then two letters (9AB), and two numerals then one letter (03L).
-- The column was char(1), which could hold the first shape and silently
-- truncate the second — so every note like 03L 190609 was unstorable, and the
-- engine rejected them outright rather than writing a wrong value.
alter table notes alter column prefix_numeral type text;

comment on column notes.prefix_numeral is
  'The leading numerals of the prefix: one or two characters, since both 9AB '
  'and 03L are real prefix shapes.';
