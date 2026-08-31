-- Commerce: offers, orders, money in, money out, delivery, disputes.
--
-- Settlement is escrow-shaped. Funds are captured at the gateway into a
-- split-settlement route and only released to the seller once delivery is
-- confirmed and the inspection window has closed. The platform is therefore not
-- holding funds itself — a deliberate structure, and one to have counsel
-- confirm before launch.

create type offer_state as enum ('open', 'accepted', 'declined', 'countered', 'expired', 'withdrawn');

create table offers (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references listings(id) on delete cascade,
  buyer_id     uuid not null references users(id) on delete cascade,
  amount_paise paise not null,
  state        offer_state not null default 'open',
  message      text,
  -- Set when the seller counters rather than accepting.
  counter_paise paise,
  expires_at   timestamptz not null,
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint offers_amount_positive check (amount_paise > 0)
);

create index offers_listing on offers (listing_id, state, created_at desc);
create index offers_buyer   on offers (buyer_id, state);

create type order_state as enum (
  'created', 'payment_pending', 'paid', 'packed', 'shipped',
  'delivered', 'inspection', 'completed', 'cancelled', 'refunded', 'disputed'
);

create table orders (
  id                      uuid primary key default gen_random_uuid(),
  -- Human-facing reference, safe to quote in support and on invoices.
  order_number            text not null unique,
  buyer_id                uuid not null references users(id) on delete restrict,
  seller_id               uuid not null references sellers(id) on delete restrict,
  listing_id              uuid references listings(id) on delete restrict,
  bundle_id               uuid references bundles(id) on delete restrict,
  state                   order_state not null default 'created',

  -- Money, every line broken out so an invoice can be reconstructed exactly.
  subtotal_paise          paise not null,
  shipping_paise          paise not null default 0,
  buyer_premium_paise     paise not null default 0,
  commission_paise        paise not null default 0,
  gst_on_commission_paise paise not null default 0,
  -- Section 194-O withholding on the seller's payout.
  tds_paise               paise not null default 0,
  total_paise             paise not null,

  shipping_address_id     uuid references addresses(id) on delete set null,
  is_gift                 boolean not null default false,
  gift_message            text,
  deliver_on              date,

  -- Escrow release gate.
  inspection_ends_at      timestamptz,
  placed_at               timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint orders_subject_present check (listing_id is not null or bundle_id is not null),
  constraint orders_total_positive  check (total_paise > 0)
);

create index orders_buyer  on orders (buyer_id, created_at desc);
create index orders_seller on orders (seller_id, state, created_at desc);
create index orders_state  on orders (state) where state not in ('completed', 'cancelled');
create trigger orders_touch before update on orders for each row execute function set_updated_at();

create type payment_state as enum (
  'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'
);

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete restrict,
  gateway            text not null,
  gateway_payment_id text,
  gateway_order_id   text,
  method             text,
  amount_paise       paise not null,
  state              payment_state not null default 'created',
  failure_reason     text,
  captured_at        timestamptz,
  -- Verbatim webhook body, for reconciliation and dispute evidence.
  raw                jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index payments_gateway_id on payments (gateway, gateway_payment_id)
  where gateway_payment_id is not null;
create index payments_order on payments (order_id, created_at desc);
create trigger payments_touch before update on payments for each row execute function set_updated_at();

create type payout_state as enum ('pending', 'on_hold', 'processing', 'paid', 'failed', 'reversed');

create table payouts (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete restrict,
  seller_id         uuid not null references sellers(id) on delete restrict,
  bank_account_id   uuid references bank_accounts(id) on delete set null,
  gateway_payout_id text,
  -- Net of commission, GST and TDS.
  amount_paise      paise not null,
  state             payout_state not null default 'pending',
  hold_reason       text,
  scheduled_for     timestamptz,
  released_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index payouts_seller on payouts (seller_id, state);
create index payouts_due    on payouts (scheduled_for) where state = 'pending';
create trigger payouts_touch before update on payouts for each row execute function set_updated_at();

create table shipments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  carrier            text,
  tracking_number    text,
  is_insured         boolean not null default false,
  -- Required above a value threshold; enforced in the service layer.
  unboxing_required  boolean not null default false,
  -- Hashed, like every other one-time code.
  delivery_otp_hash  text,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index shipments_order    on shipments (order_id);
create index shipments_tracking on shipments (carrier, tracking_number)
  where tracking_number is not null;
create trigger shipments_touch before update on shipments for each row execute function set_updated_at();

create type dispute_state as enum (
  'open', 'evidence', 'under_review', 'resolved_buyer', 'resolved_seller',
  'partial_refund', 'closed'
);

create table disputes (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete restrict,
  raised_by      uuid not null references users(id) on delete restrict,
  reason_code    text not null,
  description    text,
  state          dispute_state not null default 'open',
  resolution     text,
  refund_paise   paise,
  arbitrated_by  uuid references users(id),
  evidence_due_at timestamptz,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  updated_at     timestamptz not null default now()
);

create index disputes_order on disputes (order_id);
create index disputes_open  on disputes (state) where state not in ('closed', 'resolved_buyer', 'resolved_seller');
create trigger disputes_touch before update on disputes for each row execute function set_updated_at();

create table dispute_evidence (
  id          uuid primary key default gen_random_uuid(),
  dispute_id  uuid not null references disputes(id) on delete cascade,
  uploaded_by uuid not null references users(id) on delete restrict,
  storage_key text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create table reviews (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null unique references orders(id) on delete cascade,
  reviewer_id       uuid not null references users(id) on delete cascade,
  subject_seller_id uuid not null references sellers(id) on delete cascade,
  rating            smallint not null,
  body              text,
  created_at        timestamptz not null default now(),
  constraint reviews_rating_range check (rating between 1 and 5)
);

create index reviews_seller on reviews (subject_seller_id, created_at desc);
