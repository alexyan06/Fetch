# Technical Architecture

## High-level shape

Standalone web app. Two very different kinds of "integration" happening:

- **Merge = real, live, working.** Public API + free hackathon credits confirmed available. This is the part of the demo that's genuinely functional software, not smoke and mirrors.
- **Corgi = simulated/mocked destination layer.** No public Corgi API exists (confirmed via research — see file 02). Outputs are made to _look and feel_ authentically Corgi-branded by using their real coverage-line names and real FAQ-stated trigger language, but nothing is actually written into a real Corgi system. A "send to Corgi" action either shows a mocked confirmation or deep-links to their real dashboard (`corgi.insure/startup-insurance`) — this is the honest boundary, not a shortcut.
- **Action item before building:** ask organizers day-of whether Corgi is providing an event-specific sandbox/mock endpoint (common sponsor-hackathon practice even without a public dev portal). If yes, swap it in. Default plan assumes no.

## Confirmed stack

- **Framework**: Next.js (TypeScript) — single deployable unit, frontend + API routes together. Chosen over Spring Boot/Java (day-job stack) specifically because it collapses to one deploy target, has the strongest Merge Node SDK + AI-coding-tool support, and pairs natively with Vercel's AI SDK for the chat feature.
- **Deployment**: Vercel. `git push` via the Vercel GitHub integration gives a live public URL throughout the build — judges get a real link, and the "backup recorded video" (file 09) is just a screen capture of the actual deployed app. Merge API key, DB connection string, and LLM API key go in Vercel project env vars, never committed.
- **UI**: Tailwind + shadcn/ui.
- **Charts**: Recharts — feature-importance bar chart + anomaly-highlighted trend line (file 06).
- **Database**: Supabase (Postgres). Deliberately chosen for **realtime subscriptions** — the dashboard can auto-update the instant a simulated trigger event lands in the DB, no polling/manual refresh, which directly strengthens the "watch it react live" demo moment.
- **LLM chat**: Vercel AI SDK (`ai` npm package) calling Anthropic or OpenAI from a Next.js API route — streaming, minimal setup.
- **ML runtime split (resolves the Python-on-Vercel wrinkle)**: train offline, infer online.
    - Classifier: train with scikit-learn (Python) ahead of/during the build, then port the learned weights (logistic regression = just a weight vector + bias) into a small TypeScript function — no live Python runtime needed in the deployed app.
    - Anomaly detection: implement directly in TypeScript via a z-score/rolling-stats approach — same demo effect (highlighted anomalous point) without needing a Python runtime or isolation forest specifically.
    - Net result: honestly "trained with scikit-learn" in the pitch, but the deployed app is 100% Node/TypeScript on Vercel — no cross-runtime deploy risk under time pressure.

## Data model (Supabase / Postgres) — concrete schema

**`companies`** — `id` (uuid, PK), `name`, `source` (enum: `real` | `synthetic` — drives which ingestion path applies), `merge_account_tokens` (jsonb, nullable — `{hris, accounting, crm}`, only populated for the real company), `created_at`.

**`coverage_state`** — one row per (company, coverage_line) pair; this is what the Coverage Panel reads directly. `id`, `company_id` (FK), `coverage_line` (enum: GL, D&O, Tech E&O, Cyber, EPLI, Media Liability, HNOA, Fiduciary, Rep & Warranties), `current_limit` (numeric), `updated_at`.

**`signal_events`** — append-only log of every signal ever evaluated, real/synthetic/simulated, all the same shape. `id`, `company_id` (FK), `trigger_type` (enum: hire, funding, contract, + Tier 2: burn, security_incident), `raw_payload` (jsonb — the underlying data point(s), what the Tier 3 "receipt" shows), `classifier_features` (jsonb — the 4 computed features from file 06), `classifier_probability` (numeric), `decision` (enum: `auto` | `pending`), `created_at`.

**`activity_log`** — feeds the Activity Feed UI directly, per-company and portfolio-wide. `id`, `company_id` (FK), `signal_event_id` (FK, nullable), `coverage_line` (enum, nullable), `old_value`/`new_value` (numeric, nullable), `tag` (enum: `auto` | `pending` | `approved` | `dismissed`), `explanation` (text — the plain-language "what changed and why"), `created_at`.

**`pending_approvals`** — the queue. `id`, `company_id` (FK), `signal_event_id` (FK), `recommendation_text` (text), `status` (enum: `open` | `approved` | `dismissed`), `resolved_at` (timestamptz, nullable). Approving triggers the same `coverage_state` update + `activity_log` write as the AUTO path.

## API routes (Next.js App Router)

- **`POST /api/sync`** — pulls latest data from Merge for the real company's 3 Linked Accounts, detects new signal events, runs them through the classifier, applies AUTO updates or creates PENDING approvals. Triggered manually ("Force Resync") during the demo, or on a schedule/webhook if time allows (Tier 2+).
- **`POST /api/simulate-event`** — the Simulate Event tool's backend. Params: `company_id`, `trigger_type`, `magnitude`. Branches on `companies.source`: synthetic → writes directly to `signal_events`; real + dry-run (Tier 1) → same, tagged as simulated; real + live-write (Tier 2 stretch) → calls Merge's Write API first, then proceeds once the real platform confirms.
- **`POST /api/approvals/:id/approve`** — applies a pending recommendation: updates `coverage_state`, writes an `activity_log` entry tagged `approved`, resolves the `pending_approvals` row.
- **`POST /api/approvals/:id/dismiss`** — resolves without applying anything.
- **`GET /api/companies`** — portfolio list with enough joined data to sort by "needs attention" (e.g. count of open `pending_approvals`, or recency of last `activity_log` entry).
- **`POST /api/chat`** (Tier 2) — explainability chat; ideally backed by Merge's own MCP server scoped to our Linked Accounts (file 01/03) rather than hand-rolled REST-then-prompt logic.

## Data flow, end to end

1. **Ingestion** — either (a) `/api/sync` pulls real data via the Merge Unified API for the one real company, (b) the pre-hackathon generator seeds synthetic companies' initial history directly into Supabase, or (c) `/api/simulate-event` fires an on-demand event for either kind of company.
2. **Feature computation** — for each new/changed signal, compute the 4 classifier features (file 06) from the event plus that company's recent history in `signal_events`.
3. **Classification** — run the ported TypeScript classifier (`ml/classifier.ts`) → probability.
4. **Decision branch** — below threshold: compute new limit via the scaling rule → update `coverage_state` → write `activity_log` (`auto`). At/above threshold: generate recommendation text → create `pending_approvals` row → write `activity_log` (`pending`, no coverage change yet).
5. **Realtime propagation** — Supabase realtime subscription on `coverage_state` / `activity_log` / `pending_approvals` pushes changes to the dashboard instantly, no polling — this is the actual mechanism behind "watch it react live."
6. **UI renders** — Portfolio dashboard (sorted by attention), Company detail view (Coverage Panel + Activity Feed), Pending Approvals queue, and (Tier 2) the explainability chat reading from the same tables.

## Data sources — two distinct kinds, don't conflate them

- **One real "hero" company, through the actual Merge pipeline.** BambooHR/Zoho Books/HubSpot's own pre-populated sandbox demo data, synced by Merge, pulled via real API calls (this is the BambooHR Employee data — Maja Andev, Ben Peterson, etc. — and the Zoho Books Invoices and HubSpot Deals validated during pre-hackathon setup). This is what proves the integration is genuinely real, not faked, and it's also the mechanism for the **live demo trigger**: go into BambooHR/Zoho Books/HubSpot's own UI, make a real change (e.g. add an employee), then trigger a manual Resync/Force Resync in the Merge dashboard (don't rely on waiting for a scheduled sync during a live demo), and the app picks it up.
- **The other ~14-19 companies in the portfolio view are synthetic, not through Merge at all.** Getting even one real sandbox account required manual approval (see the BambooHR saga) — 15-20 real third-party sandbox accounts isn't realistic. These come from the same Python generator that built the ML training data (`ml/generate_training_data.py`), seeded directly into Supabase. They never touch Merge or any third-party platform.
- **Why this split is fine, not a compromise:** the one real company proves genuine integration (technical credibility); the synthetic companies prove the tool works at the operational scale Corgi actually needs (product story). Neither alone tells the full story.
- **Pre-hackathon action item:** confirm reliable, non-SMS-2FA login access to BambooHR/Zoho Books/HubSpot's own UIs (not just the Merge dashboard) before the event starts — discovered this matters the hard way when an SMS 2FA prompt was untestable while offline/on a plane. Getting locked out of a sandbox login mid-demo would be a much worse version of that problem.
- **A third, deliberate path: the Simulate Event tool.** Synthetic companies have no real-world UI to edit, so an internal control that writes a `signal_events` row on demand is required, not optional — it also serves as the real company's live-demo backup if the actual BambooHR/Zoho Books/HubSpot path hiccups mid-demo. **It's also the only path for the real company's "funding round" trigger specifically** — validated that Zoho Books Invoice data (receivables) can't represent an equity/cash injection, so that one trigger type has no natural real-data equivalent for the real company. Full spec in file 04.

## Data flow (draft — refine during build planning)

1. One real Merge-backed company (HRIS/Accounting/CRM test Linked Accounts) + 15-20 synthetic companies seeded into Supabase (see split above).
2. Pull Common Model data via the Unified API per category for the real company; read synthetic company data directly from Supabase.
3. Trigger-detection layer evaluates each company's data (real or synthetic, same downstream logic either way) against the 3 (later widened) trigger definitions.
4. Decision layer (rules in Tier 1 → real trained classifier in the ML pass, see file 06) routes: small change → auto-update path; large change → recommendation-generation path.
5. Dashboard UI: portfolio list view (sorted by attention-needed) + individual company detail view + live "just happened" demo moment (on the one real company).
6. Optional: explainability chat surface reading from the same pulled data (Tier 2).

## Open decisions (settle these early, in plan mode, before fanning out work)

- Exact scaling rule for computing a new coverage limit on the AUTO path (simple percentage-of-growth formula vs. a lookup table per coverage line) — needs to be simple enough to explain live if a judge asks "how did you calculate that."
- Whether Simulate Event's real-company live-write mode gets attempted at all (Tier 2 stretch) or dry-run stays the permanent choice — decide based on time remaining once Tier 1 is solid, don't leave it ambiguous mid-build.
- Classifier decision threshold (0.5 default from file 06) — may want tuning once real `signal_events` data exists from the real company.
- Exact shape of the offline-trained classifier's exported weights (JSON file checked into the repo vs. env var) — small decision, settle during Tier 1 build.

## Why locking architecture matters before parallelizing

Once interfaces between pieces (e.g., what shape "company risk data" looks like flowing from the Merge layer into the rest of the app) are defined, work can fan out across worktrees/agent lanes safely. Skipping this and letting parallel agents guess independently is the most likely cause of wasted hours mid-event (see file 07).