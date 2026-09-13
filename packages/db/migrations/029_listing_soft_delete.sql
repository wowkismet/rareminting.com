-- Deleting a listing, without destroying it.
--
-- The spec asks admin to be able to delete a listing and restore it "where
-- appropriate". Those two are only compatible if the delete is reversible, so
-- this is a timestamp rather than a `delete from listings`.
--
-- A hard delete is not available even in principle. `orders.listing_id`
-- references this table, and so do `order_items`, `date_matches`,
-- `listing_pattern_tags`, `media` and `auctions`. Removing the row would take
-- somebody's order history with it or, worse, be refused halfway and leave a
-- half-deleted listing. A collectibles marketplace has to be able to say what
-- was sold, to whom, and what it was described as at the time -- years later,
-- during a dispute.
--
-- So `deleted_at` is set, the listing disappears from every buyer-facing
-- query, and staff can put it back. The state column is left alone: it says
-- where the listing was in its life, and overwriting that to record a delete
-- would lose the answer to "was this live when it went?".

alter table listings
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references users(id) on delete set null;

comment on column listings.deleted_at is
  'Soft delete. Non-null means hidden everywhere a buyer can see, and '
  'restorable by staff. Never hard-deleted: orders reference this row.';

-- Most reads want the living ones, and this keeps that cheap without every
-- query paying for the rows that have been removed.
create index if not exists listings_alive
  on listings (state, created_at desc)
  where deleted_at is null;
