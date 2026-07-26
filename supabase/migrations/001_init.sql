-- Fetch: initial schema (Tier 1)
-- Five tables per docs/05-technical-architecture.md — do not add/rename/remove columns.

create extension if not exists pgcrypto;

create type company_source as enum ('real', 'synthetic');

create type coverage_line as enum (
  'GL',
  'D&O',
  'Tech E&O',
  'Cyber',
  'EPLI',
  'Media Liability',
  'HNOA',
  'Fiduciary',
  'Rep & Warranties'
);

create type trigger_type as enum ('hire', 'funding', 'contract');

create type signal_decision as enum ('auto', 'pending');

create type activity_tag as enum ('auto', 'pending', 'approved', 'dismissed');

create type approval_status as enum ('open', 'approved', 'dismissed');

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source company_source not null,
  merge_account_tokens jsonb,
  created_at timestamptz not null default now()
);

create table coverage_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  coverage_line coverage_line not null,
  current_limit numeric not null,
  updated_at timestamptz not null default now()
);

create table signal_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  trigger_type trigger_type not null,
  raw_payload jsonb not null,
  classifier_features jsonb not null,
  classifier_probability numeric not null,
  decision signal_decision not null,
  created_at timestamptz not null default now()
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  signal_event_id uuid references signal_events(id),
  coverage_line coverage_line,
  old_value numeric,
  new_value numeric,
  tag activity_tag not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

create table pending_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  signal_event_id uuid not null references signal_events(id),
  recommendation_text text not null,
  status approval_status not null default 'open',
  resolved_at timestamptz
);

-- Realtime: drives the live dashboard (Coverage Panel, Activity Feed, Approvals queue).
alter publication supabase_realtime add table coverage_state;
alter publication supabase_realtime add table activity_log;
alter publication supabase_realtime add table pending_approvals;
