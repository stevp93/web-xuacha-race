-- Xuacha Race · sistema de cobro · esquema inicial
-- Todo valor monetario es un entero en centavos (igual que Wompi).
-- Ningún dato de tarjeta se almacena en esta base.

create table events (
  id                 text primary key,
  name               text not null,
  event_date         date not null,
  currency           text not null default 'COP',
  base_cents         integer not null check (base_cents > 0),
  reserve_pct        integer not null default 50 check (reserve_pct between 1 and 99),
  balance_due_at     timestamptz not null,
  split_closes_at    timestamptz not null,
  grace_hours        integer not null default 48 check (grace_hours >= 0),
  min_total_cents    integer not null default 1000000 check (min_total_cents >= 0),
  draft_ttl_days     integer not null default 7 check (draft_ttl_days > 0),
  ref_prefix         text not null default 'XR27',
  catalog            jsonb not null,
  registration_open  boolean not null default false
);

create table participants (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('CC','CE','TI','PP')),
  doc_number     text not null,
  full_name      text not null,
  email          text not null,
  whatsapp_e164  text not null,
  consent_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (doc_type, doc_number)
);

create table promo_codes (
  id                  uuid primary key default gen_random_uuid(),
  event_id            text not null references events(id),
  code                text not null,
  type                text not null check (type in ('percent','fixed')),
  value               integer not null check (value > 0),
  max_redemptions     integer check (max_redemptions > 0),
  redeemed_count      integer not null default 0,
  overage_count       integer not null default 0,
  per_document_limit  integer not null default 1 check (per_document_limit > 0),
  valid_from          timestamptz,
  valid_until         timestamptz,
  min_total_cents     integer not null default 0,
  applies_to          jsonb not null default '[]'::jsonb,   -- distancias; vacío = todas
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  check (type <> 'percent' or value <= 100)
);
create unique index promo_codes_code_uq on promo_codes (event_id, lower(code));

create table registrations (
  id                 uuid primary key default gen_random_uuid(),
  short_id           text not null unique,
  event_id           text not null references events(id),
  participant_id     uuid not null references participants(id),
  status             text not null default 'draft'
                     check (status in ('draft','reserved','paid','expired','cancelled','transferred')),
  plan               text check (plan in ('full','split')),
  distance           text,
  category           text,
  base_cents         integer not null,
  discount_cents     integer not null default 0 check (discount_cents >= 0),
  total_cents        integer not null check (total_cents > 0),
  promo_code_id      uuid references promo_codes(id),
  step               smallint not null default 2,
  form_data          jsonb not null default '{}'::jsonb,
  resume_token_hash  text not null unique,
  token_expires_at   timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  reserved_at        timestamptz,
  paid_at            timestamptz,
  check (total_cents = base_cents - discount_cents)
);
-- Una sola inscripción activa por participante y evento.
create unique index registrations_one_active
  on registrations (event_id, participant_id)
  where status in ('draft','reserved','paid');

-- Tokens adicionales para los enlaces enviados por WhatsApp (solo se guarda el hash).
create table link_tokens (
  token_hash       text primary key,
  registration_id  uuid not null references registrations(id) on delete cascade,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

create table installments (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid not null references registrations(id) on delete cascade,
  seq              smallint not null check (seq in (1,2)),
  amount_cents     integer not null check (amount_cents > 0),
  due_at           timestamptz,
  status           text not null default 'pending' check (status in ('pending','paid','void')),
  paid_attempt_id  uuid,
  paid_at          timestamptz,
  unique (registration_id, seq)
);

create table payment_attempts (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  registration_id  uuid not null references registrations(id),
  installment_id   uuid not null references installments(id) on delete cascade,
  amount_cents     integer not null check (amount_cents > 0),
  currency         text not null,
  expires_at       timestamptz not null,
  gateway          text not null default 'wompi',
  gateway_tx_id    text,
  status           text not null default 'CREATED'
                   check (status in ('CREATED','PENDING','APPROVED','DECLINED','VOIDED','ERROR')),
  method_type      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index payment_attempts_open on payment_attempts (created_at) where status in ('CREATED','PENDING');

create table webhook_events (
  id             bigserial primary key,
  gateway        text not null,
  gateway_tx_id  text not null,
  tx_status      text not null,
  checksum       text not null,
  payload        jsonb not null,
  result         text,
  received_at    timestamptz not null default now(),
  unique (gateway, gateway_tx_id, tx_status)
);

create table promo_redemptions (
  id               uuid primary key default gen_random_uuid(),
  promo_code_id    uuid not null references promo_codes(id),
  registration_id  uuid not null unique references registrations(id),
  participant_id   uuid not null references participants(id),
  over_limit       boolean not null default false,
  created_at       timestamptz not null default now()
);

create table notifications_outbox (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid references registrations(id) on delete cascade,
  to_e164          text not null,
  template         text not null,
  body             text not null,
  scheduled_at     timestamptz not null,
  status           text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts         integer not null default 0,
  claimed_at       timestamptz,
  sent_at          timestamptz,
  last_error       text,
  dedupe_key       text not null unique,
  created_at       timestamptz not null default now()
);
create index notifications_outbox_due on notifications_outbox (scheduled_at) where status = 'pending';

create table recovery_codes (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references participants(id),
  code_hash       text not null,
  expires_at      timestamptz not null,
  attempts        integer not null default 0,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table rate_limits (
  key     text not null,
  bucket  bigint not null,
  count   integer not null default 0,
  primary key (key, bucket)
);

create table audit_log (
  id               bigserial primary key,
  at               timestamptz not null default now(),
  registration_id  uuid,
  action           text not null,
  detail           jsonb not null default '{}'::jsonb
);

-- Supabase expone las tablas por REST con la llave anónima.
-- RLS activo y sin políticas = nadie entra por esa vía; la API usa conexión directa.
alter table events               enable row level security;
alter table participants         enable row level security;
alter table promo_codes          enable row level security;
alter table registrations        enable row level security;
alter table installments         enable row level security;
alter table link_tokens          enable row level security;
alter table payment_attempts     enable row level security;
alter table webhook_events       enable row level security;
alter table promo_redemptions    enable row level security;
alter table notifications_outbox enable row level security;
alter table recovery_codes       enable row level security;
alter table rate_limits          enable row level security;
alter table audit_log            enable row level security;
