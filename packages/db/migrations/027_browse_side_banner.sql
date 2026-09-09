-- A promotional column beside the floor.
--
-- Distinct from the strip above it: a tall narrow advert and a wide banner are
-- not interchangeable, so they get their own slot rather than sharing one and
-- rendering badly in half the places it appears.
--
-- On its own because adding an enum value cannot be used in the same
-- transaction that adds it, and because a failure here should not roll back
-- the billing address work in 026.

alter type banner_slot add value if not exists 'browse_side';
