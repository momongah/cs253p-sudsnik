create table if not exists charges (
  charge_id text primary key,
  tenant_id text not null,
  order_id text not null,
  amount integer not null,
  currency text not null,
  state text not null,
  payment_ref text,
  updated_at integer not null,
  unique (tenant_id, order_id)
);
create table if not exists ledger (
  entry_id text primary key,
  tenant_id text not null,
  order_id text not null,
  kind text not null,
  amount integer not null,
  currency text not null,
  at integer not null,
  ref text
);
create unique index if not exists ledger_effect_once on ledger (tenant_id, order_id, kind, ref);
create table if not exists webhook_dedupe (
  webhook_id text primary key,
  tenant_id text not null,
  received_at integer not null
);

create table if not exists consumed (
  envelope_id text primary key,
  topic text not null,
  at integer not null
);
