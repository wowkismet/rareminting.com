-- Default commission rates.
--
-- Seeded as data rather than compiled in, so an operator can change a take rate
-- from the admin console without a deploy — and so a historical order can be
-- explained by the rule that was in force when it was placed.
--
-- These figures are a starting point, not advice. Confirm the GST and TDS rates
-- with a chartered accountant before taking real money.

insert into commission_rules
  (category_id, seller_kind, take_rate_bps, listing_fee_paise,
   buyer_premium_bps, gst_rate_bps, tds_rate_bps)
values
  -- The catch-all: applies when nothing more specific matches.
  (null, null, 1000, 0, 0, 1800, 100),
  -- Dealers move volume, so they pay a lower rate.
  (null, 'registered_dealer', 700, 0, 0, 1800, 100)
on conflict do nothing;
