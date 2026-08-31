-- The fancy-number taxonomy as reference data.
--
-- Codes mirror PatternCode in @rareminting/serial-engine exactly; the engine is
-- the source of truth for detection, this table exists so listings can carry a
-- foreign key and so the admin console can retune weights without a deploy.
--
-- `default_weight` is the starting point. Each listing stores its own weight in
-- listing_pattern_tags, because a tag's strength varies by instance (a low
-- serial of 000001 outranks one of 000100).

insert into pattern_tags (code, label, default_weight, description) values
  ('SOLID',            'Solid',                        1.000, 'Every digit identical, e.g. 777777.'),
  ('RADAR',            'Radar / palindrome',           0.900, 'Reads the same in both directions, e.g. 123321.'),
  ('LADDER_DESC',      'Descending ladder',            0.820, 'Each digit one less than the last, e.g. 654321.'),
  ('LADDER_ASC',       'Ascending ladder',             0.800, 'Each digit one more than the last, e.g. 123456.'),
  ('REPEATER',         'Repeater',                     0.700, 'A block repeated to fill the serial, e.g. 123123.'),
  ('TRIPLE_PAIRS',     'Triple pairs',                 0.660, 'Every digit appears three times in a row, e.g. 111222.'),
  ('DOUBLE_PAIRS',     'Double pairs',                 0.600, 'Every digit appears twice in a row, e.g. 112233.'),
  ('LADDER_DESC_WRAP', 'Descending ladder (wrapping)', 0.550, 'Descends through 0 back to 9.'),
  ('LADDER_ASC_WRAP',  'Ascending ladder (wrapping)',  0.530, 'Ascends through 9 back to 0.'),
  ('LOW_SERIAL',       'Low serial',                   0.850, 'Within the first hundred notes of a run.'),
  ('HIGH_SERIAL',      'High serial',                  0.700, 'At or near the top of a run.'),
  ('BINARY',           'Binary',                       0.500, 'Built from exactly two distinct digits.'),
  ('LUCKY',            'Lucky number',                 0.500, 'Carries an auspicious number such as 786 or 108.'),
  ('NOVELTY',          'Novelty number',               0.400, 'Carries a culturally recognisable number such as 1947.'),
  ('SEMI_FANCY',       'Semi-fancy',                   0.300, 'One digit away from a premium pattern.'),
  ('STAR_SERIES',      'Star series',                  0.450, 'A replacement note, printed to substitute a defective one.'),
  ('ERROR_NOTE',       'Error note',                   0.800, 'A printing or cutting error. Not derivable from the serial.')
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description;
