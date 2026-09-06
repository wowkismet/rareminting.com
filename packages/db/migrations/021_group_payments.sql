-- One payment for a whole basket.
--
-- A payment has always belonged to exactly one order. With a basket that can
-- span several sellers, that would mean one card charge per seller, which is
-- precisely what a buyer does not want and what the operations document rules
-- out in section 4A: one consolidated payment, whatever is in the cart.
--
-- So a payment may now point at a group instead of an order. Exactly one of
-- the two, never both and never neither -- a payment that belongs to nothing
-- is money nobody can reconcile.
--
-- Everything already recorded keeps its order_id and behaves exactly as before.

alter table payments
  alter column order_id drop not null;

alter table payments
  add column group_id uuid references order_groups(id) on delete restrict;

create index payments_group on payments (group_id);

alter table payments
  add constraint payments_belong_somewhere
  check (num_nonnulls(order_id, group_id) = 1);
