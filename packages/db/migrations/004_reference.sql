-- Reference data: the people and dates a serial can commemorate.
--
-- Publicity rights are modelled explicitly. Nothing renders on a public page
-- unless `is_publicly_displayable` is true, and every record carries a rights
-- basis for its image plus a takedown timestamp.

create type personality_kind as enum (
  'politician', 'actor', 'musician', 'sportsperson', 'spiritual',
  'scientist', 'author', 'other'
);

create type image_rights as enum ('public_domain', 'licensed', 'fair_use_claimed', 'none');

create table personalities (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  full_name               text not null,
  kind                    personality_kind not null,
  date_of_birth           date,
  date_of_death           date,
  nationality             text,
  short_bio               text,
  source_url              text,
  image_storage_key       text,
  image_rights            image_rights not null default 'none',
  -- Gate for every public surface. Defaults closed on purpose.
  is_publicly_displayable boolean not null default false,
  takedown_requested_at   timestamptz,
  -- Rolling demand signal, feeds the pricing engine's personality premium.
  search_volume_30d       integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint personalities_lifespan check (date_of_death is null or date_of_birth is null or date_of_death >= date_of_birth)
);

create index personalities_dob       on personalities (date_of_birth) where date_of_birth is not null;
create index personalities_day_month on personalities
  (extract(month from date_of_birth), extract(day from date_of_birth))
  where date_of_birth is not null;
create index personalities_public    on personalities (is_publicly_displayable, kind);
create trigger personalities_touch before update on personalities for each row execute function set_updated_at();

create type event_kind as enum (
  'national', 'historic', 'festival', 'religious', 'sporting',
  'space', 'treaty', 'election', 'speech'
);

create table historic_events (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  title                   text not null,
  kind                    event_kind not null,
  event_date              date not null,
  -- Festivals recur on a moving date; the calendar table carries each instance.
  is_recurring            boolean not null default false,
  summary                 text,
  source_url              text,
  is_publicly_displayable boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index historic_events_date      on historic_events (event_date);
create index historic_events_day_month on historic_events
  (extract(month from event_date), extract(day from event_date));
create trigger historic_events_touch before update on historic_events for each row execute function set_updated_at();

-- Join tables. A listing's date can match several people and several events.
create table listing_personality_matches (
  listing_id     uuid not null references listings(id) on delete cascade,
  personality_id uuid not null references personalities(id) on delete cascade,
  matched_date   date not null,
  -- 'birth' | 'death' | 'milestone'
  relation       text not null,
  primary key (listing_id, personality_id, relation)
);

create table listing_event_matches (
  listing_id   uuid not null references listings(id) on delete cascade,
  event_id     uuid not null references historic_events(id) on delete cascade,
  matched_date date not null,
  primary key (listing_id, event_id)
);
