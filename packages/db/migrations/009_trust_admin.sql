-- Trust, safety and the admin console.
--
-- The audit log is append-only and records who did what to which entity, with
-- the before/after state. It is the record that settles disputes and satisfies
-- the intermediary-diligence obligations under the IT Rules.

create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid references users(id) on delete set null,
  actor_role  user_role,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor  on audit_logs (actor_id, created_at desc);

create or replace function audit_logs_append_only() returns trigger as $fn$
begin
  raise exception 'audit_logs is append-only';
end;
$fn$ language plpgsql;

create trigger audit_logs_no_update before update on audit_logs
  for each row execute function audit_logs_append_only();
create trigger audit_logs_no_delete before delete on audit_logs
  for each row execute function audit_logs_append_only();

-- Human-in-the-loop queue. The OCR/vision service routes anything below its
-- confidence threshold here rather than publishing an unverified read.
create type review_kind as enum (
  'ocr_low_confidence', 'ocr_model_disagreement', 'grade_dispute',
  'duplicate_serial', 'image_provenance', 'counterfeit_suspected',
  'kyc', 'listing_moderation', 'shill_bidding'
);

create type review_state as enum ('queued', 'assigned', 'resolved', 'escalated', 'dismissed');

create table review_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        review_kind not null,
  listing_id  uuid references listings(id) on delete cascade,
  seller_id   uuid references sellers(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  auction_id  uuid references auctions(id) on delete cascade,
  reason      text not null,
  confidence  numeric(4,3),
  payload     jsonb,
  state       review_state not null default 'queued',
  priority    smallint not null default 5,
  assigned_to uuid references users(id) on delete set null,
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index review_queue_open on review_queue (state, priority, created_at)
  where state in ('queued', 'assigned');
create trigger review_queue_touch before update on review_queue
  for each row execute function set_updated_at();

-- Results of the OCR / vision pass, kept so a read can always be re-explained.
create table assay_results (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references listings(id) on delete cascade,
  media_id          uuid references media(id) on delete set null,
  -- What OCR read versus what the vision model read; disagreement forces review.
  ocr_serial        text,
  ocr_confidence    numeric(4,3),
  vision_serial     text,
  vision_confidence numeric(4,3),
  agreed            boolean not null default false,
  predicted_grade   grade,
  grade_confidence  numeric(4,3),
  detected_defects  jsonb,
  security_checks   jsonb,
  model_version     text not null,
  created_at        timestamptz not null default now()
);
create index assay_results_listing on assay_results (listing_id, created_at desc);

create type risk_kind as enum (
  'velocity', 'device_cluster', 'payment_cluster', 'shill_graph',
  'chargeback', 'payout_anomaly', 'image_reuse'
);

create table risk_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  seller_id  uuid references sellers(id) on delete cascade,
  kind       risk_kind not null,
  severity   smallint not null default 1,
  detail     jsonb,
  cleared_at timestamptz,
  cleared_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint risk_severity_range check (severity between 1 and 5)
);
create index risk_flags_open on risk_flags (kind, severity desc) where cleared_at is null;

-- Device fingerprints, used for shill-bidding and multi-account clustering.
create table device_fingerprints (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  fingerprint text not null,
  ip          inet,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create unique index device_fingerprints_unique on device_fingerprints (user_id, fingerprint);
create index device_fingerprints_shared on device_fingerprints (fingerprint);

-- Commission and fee configuration, per category and seller tier.
create table commission_rules (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid references categories(id) on delete cascade,
  seller_kind     seller_kind,
  take_rate_bps   integer not null,
  listing_fee_paise paise not null default 0,
  buyer_premium_bps integer not null default 0,
  gst_rate_bps    integer not null default 1800,
  tds_rate_bps    integer not null default 100,
  effective_from  date not null default current_date,
  effective_to    date,
  created_at      timestamptz not null default now(),
  constraint commission_bps_range check (take_rate_bps between 0 and 10000)
);
create index commission_rules_lookup on commission_rules (category_id, seller_kind, effective_from desc);
