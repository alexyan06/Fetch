-- Fetch: align 001_init.sql with src/lib/types.ts (the frozen contract).
--
-- 001 was built to the spec in docs/05, which turned out to be incomplete —
-- types.ts is the version the engine, API routes, and UI are all written
-- against, so the schema moves to meet it rather than the other way around.
--
-- Five gaps, each with the reason it exists:
--   1. coverage_line enum used display names ('Tech E&O'); types.ts uses
--      DB-safe codes ('TECH_EO') with the labels living in constants.ts.
--   2. trigger_type was missing the two Tier 2 values. Nothing emits them in
--      Tier 1, but the enum is declared total so it never has to change again.
--   3. companies.stage — drives STAGE_PACKAGE_LINES, i.e. which coverage lines
--      a company actually carries. The seed reads it; there was nowhere to put it.
--   4. signal_events.simulated — separates Simulate Event rows from real syncs.
--   5. pending_approvals was missing the numbers the approval card promises.
--      Without proposed_limit stored, approving would have to RECOMPUTE the new
--      limit, and the card could then apply a different number than it showed.
--
-- Safe to run whether or not 001 has already been applied to the project.
-- Assumes the tables are still empty (T3's seed has not run yet); the enum
-- casts below carry old values across anyway if any rows do exist.

/* -------------------------------------------------------------------------- */
/* 1. coverage_line -> DB-safe codes                                          */
/* -------------------------------------------------------------------------- */

alter type coverage_line rename to coverage_line_old;

create type coverage_line as enum (
  'CGL',
  'DO',
  'TECH_EO',
  'CYBER',
  'EPLI',
  'MEDIA_LIABILITY',
  'HNOA',
  'FIDUCIARY',
  'REP_WARRANTIES'
);

-- Old label -> new code. 'GL' becomes 'CGL': Corgi's own name for the line is
-- Commercial General Liability (docs/02).
create function pg_temp.map_coverage_line(old text)
returns coverage_line language sql immutable as $$
  select (case old
    when 'GL'               then 'CGL'
    when 'D&O'              then 'DO'
    when 'Tech E&O'         then 'TECH_EO'
    when 'Cyber'            then 'CYBER'
    when 'EPLI'             then 'EPLI'
    when 'Media Liability'  then 'MEDIA_LIABILITY'
    when 'HNOA'             then 'HNOA'
    when 'Fiduciary'        then 'FIDUCIARY'
    when 'Rep & Warranties' then 'REP_WARRANTIES'
  end)::coverage_line;
$$;

alter table coverage_state
  alter column coverage_line type coverage_line
  using pg_temp.map_coverage_line(coverage_line::text);

alter table activity_log
  alter column coverage_line type coverage_line
  using pg_temp.map_coverage_line(coverage_line::text);

drop type coverage_line_old;

/* -------------------------------------------------------------------------- */
/* 2. trigger_type -> total enum                                              */
/* -------------------------------------------------------------------------- */

alter type trigger_type rename to trigger_type_old;

create type trigger_type as enum (
  'hire',
  'funding',
  'contract',
  'burn',
  'security_incident'
);

alter table signal_events
  alter column trigger_type type trigger_type
  using trigger_type::text::trigger_type;

drop type trigger_type_old;

/* -------------------------------------------------------------------------- */
/* 3. companies.stage                                                         */
/* -------------------------------------------------------------------------- */

create type stage_package as enum ('pre_seed_seed', 'series_a', 'growth');

-- Default only exists to satisfy NOT NULL on any pre-existing rows, then goes
-- away: the seed must state a company's stage explicitly, since it decides
-- which coverage lines that company carries at all.
alter table companies
  add column stage stage_package not null default 'series_a';

alter table companies
  alter column stage drop default;

/* -------------------------------------------------------------------------- */
/* 4. signal_events.simulated                                                 */
/* -------------------------------------------------------------------------- */

-- Defaults to false and keeps the default: a row that came from a real Merge
-- sync is the normal case, and Simulate Event sets this explicitly.
alter table signal_events
  add column simulated boolean not null default false;

/* -------------------------------------------------------------------------- */
/* 5. pending_approvals — the numbers the card promises                       */
/* -------------------------------------------------------------------------- */

alter table pending_approvals
  add column coverage_line coverage_line,
  add column proposed_limit numeric,
  add column current_limit numeric,
  add column created_at timestamptz not null default now();

-- Nullable above so the statement succeeds against existing rows; empty table
-- today, so tighten immediately. Approve reads these three verbatim instead of
-- recomputing, which is what guarantees the applied number equals the shown one.
alter table pending_approvals
  alter column coverage_line set not null,
  alter column proposed_limit set not null,
  alter column current_limit set not null;

/* -------------------------------------------------------------------------- */
/* Indexes for the queries A4 actually runs                                   */
/* -------------------------------------------------------------------------- */

-- Portfolio sort ("needs attention") counts open approvals per company.
create index if not exists pending_approvals_company_status_idx
  on pending_approvals (company_id, status);

-- Activity Feed and Coverage Panel are both per-company, newest first.
create index if not exists activity_log_company_created_idx
  on activity_log (company_id, created_at desc);

create index if not exists signal_events_company_created_idx
  on signal_events (company_id, created_at desc);

create index if not exists coverage_state_company_idx
  on coverage_state (company_id);
