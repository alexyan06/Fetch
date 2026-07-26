# Agent Prompts — copy/paste, one per task

Each prompt is self-contained and ends with a verification loop. Paste the whole thing in one go — don't drip-feed context, it costs far more credits and produces worse results.

**The loop is the important part.** Every prompt ends with an explicit instruction to run a command, fix what fails, and re-run until green. Without it an agent will report "done" on code that doesn't build.

---

# STEP 0 — Repo bootstrap (do this first, before either worktree)

Run these yourself. Neither lane can start without a repo to branch from.

```bash
cd /Users/alexyan51/Downloads/Fetch
git init
printf 'node_modules/\n.env.local\n.next/\n.vercel\n' > .gitignore
git add -A && git commit -m "Planning docs, ML artifacts, project brief"
gh repo create fetch --private --source=. --push
```

Then each person creates their worktree:

```bash
# Lane A
git worktree add ../fetch-lane-a -b lane/a && cd ../fetch-lane-a
# Lane B
git worktree add ../fetch-lane-b -b lane/b && cd ../fetch-lane-b
```

**Lane B: always use `npm ci`, never `npm install`.** `npm install` can silently rewrite `package-lock.json` even when `package.json` hasn't changed, and a lockfile conflict at 2 AM is the most annoying kind to untangle.

---

# LANE A PROMPTS

## A1 — Scaffold + contract (8:30–9:45)

```
Read /CLAUDE.md and docs/05-technical-architecture.md before writing anything.
docs/13-lane-a-primary.md is your task list; this is task A1.

Build the Phase 0 foundation for this project. Everything you create here becomes
frozen and read-only for both lanes afterward, so it needs to be right.

1. Scaffold Next.js 15 (App Router) + TypeScript pinned to exactly 5.9.3 +
   Tailwind + Vitest + ESLint.
2. Install ALL shadcn/ui components the whole build will need, now, in one pass:
   card, table, badge, button, dialog, tabs, toast, skeleton, separator.
   No later task may touch package.json — that is the single most important
   merge-conflict prevention step in this build.
3. src/lib/types.ts — every row shape and enum from file 05's schema:
   CoverageLine, TriggerType, Decision, ActivityTag, CompanySource,
   ClassifierFeatures, plus request/response types for all five API routes.
   ALSO define the props interfaces for the three stub components in step 5 —
   they must live in the frozen contract so the other lane implements against
   the same shape I import against.
4. src/lib/constants.ts — the nine Corgi coverage lines, stage packages,
   the trigger->line map (hire->EPLI, funding->D&O, contract->Tech E&O),
   the 2x single-step cap, $250K rounding increment, and the constant 2.88
   (the training mean used as the neutral funding-signal value for the real company).
5. src/lib/supabase.ts client singleton, and three stub components that render
   null, at exactly these paths:
     src/components/corgi/index.tsx
     src/components/charts/feature-importance.tsx
     src/components/charts/anomaly-trend.tsx
   Mount <CorgiMascot /> once in src/app/layout.tsx. Lane B fills these in later
   and must never edit a frozen file, so the paths and props cannot change.
6. Stub signatures for the engine and merge functions: real types, bodies that
   throw new Error("not implemented"). These unblock the API layer later.
7. Port ml/classifier.ts and ml/anomaly_detection.ts into src/lib/ml/.
   Apply one fix to the anomaly detector: when stdDev is 0 the z-score currently
   becomes Infinity and auto-flags. Floor the standard deviation so a flat
   history cannot produce an infinite z-score.
8. Add tests: a known-auto classifier case, a known-pending case, and a
   flat-history anomaly case.
9. Add an npm script "verify": tsc --noEmit && vitest run && next build

VERIFICATION LOOP — do not skip this and do not report done early:
Run `npm run verify`. If anything fails, fix the cause and run it again.
Repeat until it passes completely clean. Only then report done, and paste
the final passing output.
```

Then manually: link Vercel, set env vars, confirm the first deploy is live. Don't move on until the deployed URL loads.

## A2 — Merge integration (9:45–12:00) — supervise this one

```
Read /CLAUDE.md, docs/01-merge-product-technical-reference.md, and
docs/13-lane-a-primary.md (task A2).

Build the Merge Unified API integration for the one real company.
You may write ONLY to: src/lib/merge/client.ts, src/lib/merge/sync.ts,
scripts/verify-merge.ts. Import all types from src/lib/types.ts — never redefine them.

- Authenticated client via @mergeapi/merge-node-client.
  Headers: Authorization: Bearer <API_KEY> and X-Account-Token: <ACCOUNT_TOKEN>.
- Pull BambooHR Employees (HRIS), Zoho Books Invoices (Accounting),
  HubSpot Opportunities (CRM).
- Change detection: modified_after off a per-category last_synced_at, plus a
  remote_id diff as a backstop for when a manual Force Resync makes timestamps
  behave oddly.
- Translate raw Common Models into the ClassifierFeatures shape.

These field facts are already verified against real data. Do NOT re-derive them,
and do not "correct" them:
- Employee.employment_status of PENDING with a near-term start_date COUNTS as a
  hire. Do not wait for ACTIVE.
- A closed-won opportunity is status === "WON". There is no is_won boolean.
- /api/accounting/v1/invoices is the proven working endpoint.
- cash_inflow_spike_ratio is ALWAYS 2.88 for the real company. An invoice is
  receivables, not an equity injection, so it structurally cannot represent a
  funding round. 2.88 is the training mean, so it standardizes to ~0 and
  contributes nothing to the score. Do not use 0 — that would push the
  prediction toward auto-approve using a feature that has no data behind it.

If any field or endpoint shape is genuinely uncertain, fetch the doc URL from
docs/10-documentation-links.md. Do not guess.

VERIFICATION LOOP:
Run `npx tsx scripts/verify-merge.ts`. It must print real records from all three
platforms plus the derived four-feature vector. If it errors or returns empty,
diagnose and fix, then run again. Repeat until it prints real data.
Paste the final output.
```

## A3 — Decision engine (12:30–1:30) — safe to run unattended

```
Read /CLAUDE.md and docs/13-lane-a-primary.md (task A3).

Build the decision engine. You may write ONLY to src/lib/engine/*.ts and its
tests. Import types from src/lib/types.ts and constants from src/lib/constants.ts —
never redefine them. These are PURE FUNCTIONS with zero I/O.

- features.ts — compute the four classifier features from an event plus the
  company's recent history. ALWAYS populate all four features, using the
  company's current standing values for whichever signals this trigger didn't
  move. This is required for training/serving parity: every row the model was
  trained on was a monthly snapshot with all four features present, so a partial
  or zeroed vector puts it off-distribution.
- scaling.ts — new limit = min(current * (1 + growth), 2 * current, line_ceiling),
  rounded to the nearest $250K. Growth comes from the trigger's own driving feature.
- recommendation.ts — TEMPLATED text, no LLM. Quote the company name, the signal,
  and the real numbers. Must be fully deterministic, because the approval card
  has to apply exactly the number it displays.
- decide.ts — orchestrate: compute features, classify via src/lib/ml/classifier.ts,
  branch on the 0.5 threshold. Below = auto, at/above = pending.
  It RETURNS a plain object describing what should happen. It must never write
  to the database.

Write real unit tests covering: a routine hire that should auto-approve, a large
funding event that should go pending, the scaling cap behaving correctly, and
the 2.88 neutral value contributing nothing.

VERIFICATION LOOP:
Run `npx vitest run src/lib/engine`. Fix any failure and run again. Repeat until
all tests pass. Then run `npm run verify` and confirm that passes too.
Paste both outputs.
```

## A4 — API routes + DB layer (1:30–3:00)

```
Read /CLAUDE.md, docs/05-technical-architecture.md, and docs/13-lane-a-primary.md
(task A4).

Build the API layer. You may write ONLY to src/app/api/** and src/lib/db/queries.ts.
This layer PERFORMS the writes that decide() only described.

Build in exactly this order — the first one is the demo's fallback path and must
exist before anything optional:

1. POST /api/simulate-event
   Params: company_id, trigger_type, magnitude. Branch on companies.source.
   Dry-run only tonight: write a signal_events row and run the full decision
   pipeline. Never call Merge's write API.
2. POST /api/approvals/[id]/approve
   Apply EXACTLY the numbers stored on the approval row — do not recompute.
   Update coverage_state, write activity_log tagged 'approved', resolve the
   pending_approvals row. Approver is the hardcoded string "Demo Underwriter".
3. POST /api/approvals/[id]/dismiss — resolve, apply nothing.
4. GET /api/companies — portfolio list joined with open approval counts,
   sorted by needs-attention.
5. POST /api/sync — last. Uses src/lib/merge/sync.ts.

Also write scripts/verify-api.ts: start from a known DB state, fire a simulated
routine event and assert an auto row lands in activity_log with coverage_state
updated; fire a large event and assert a pending_approvals row is created with
coverage_state UNCHANGED; then approve it and assert coverage_state updates and
the log entry is tagged 'approved'.

VERIFICATION LOOP:
Run `npx tsx scripts/verify-api.ts` against a local dev server. Fix any failure
and run again until every assertion passes. Then run `npm run verify`.
Paste both outputs.
```

## A5 — Frontend (3:00–4:30, re-scope this at the break)

```
Read /CLAUDE.md, docs/04-product-concept.md, and docs/13-lane-a-primary.md (task A5).

Build the UI. You may write ONLY to:
  src/app/page.tsx, src/app/company/[id]/page.tsx,
  src/app/approvals/page.tsx, src/app/demo/page.tsx,
  src/components/{portfolio-table,coverage-panel,activity-feed,approval-card}.tsx

Do NOT import database code. Read and write exclusively through the /api routes,
and use Supabase realtime subscriptions for live updates. The chart and corgi
components already exist — import them, don't modify them.

- Portfolio dashboard: all companies sorted by needs-attention (open approval
  count, then recency). This is the opening shot of the demo — it has to make
  the problem look operational, not like a toy.
- Company detail: Coverage Panel showing only that company's stage-package
  coverage lines, not all nine. On an auto update the changed line animates from
  old value to new with an "Auto-updated just now" badge — this is the single
  most important visual moment in the demo. Below it, the Activity Feed:
  reverse-chronological, tagged AUTO / PENDING / APPROVED.
- Approvals queue: cards with the recommendation text, Approve and Dismiss.
- Demo Controls: company picker, trigger type, magnitude, fire button. Style it
  as an obviously internal tool, visually separate from the product UI.
- Supabase realtime subscriptions on coverage_state, activity_log, and
  pending_approvals. No polling anywhere.
- Put a "Live via Merge" badge on the real company ONLY. Do not label the other
  16 as synthetic — that points attention at the weakness instead of the strength.

VERIFICATION LOOP:
Run `npm run verify`. Fix and re-run until clean. Then start the dev server and
load all four routes against seeded data, confirming each renders without console
errors. Paste the verify output and report what you saw on each route.
```

---

# LANE B PROMPTS

Paste each one whole. Run `npm ci` (never `npm install`) whenever you need dependencies.

## T1 — Database schema (8:30–9:15) — Lane A is blocked on this

```
Read /CLAUDE.md and docs/05-technical-architecture.md, then docs/14-lane-b-support.md
(task T1).

Write supabase/migrations/001_init.sql. This is the ONLY file you may create.

Create exactly five tables, matching file 05's schema section precisely. Do not
invent, rename, or add columns — Lane A is writing TypeScript types against this
same spec in parallel, and the two get diffed in 30 minutes. Any extra column
breaks that check.

  companies         id uuid PK, name, source enum('real','synthetic'),
                    merge_account_tokens jsonb null, created_at
  coverage_state    id, company_id FK, coverage_line enum (the nine Corgi lines),
                    current_limit numeric, updated_at
  signal_events     id, company_id FK, trigger_type enum('hire','funding','contract'),
                    raw_payload jsonb, classifier_features jsonb,
                    classifier_probability numeric, decision enum('auto','pending'),
                    created_at
  activity_log      id, company_id FK, signal_event_id FK null, coverage_line null,
                    old_value numeric null, new_value numeric null,
                    tag enum('auto','pending','approved','dismissed'),
                    explanation text, created_at
  pending_approvals id, company_id FK, signal_event_id FK,
                    recommendation_text text, status enum('open','approved','dismissed'),
                    resolved_at timestamptz null

Enable Postgres realtime on coverage_state, activity_log, and pending_approvals.
That is what drives the live dashboard.

VERIFICATION LOOP:
Apply the migration to the Supabase project. If it errors, fix and re-apply until
it succeeds. Then query the schema and confirm all five tables exist with every
column above. Paste the table listing.
```

Push immediately and tell Lane A it's ready.

## T2 — Pixel art (9:15–10:00) — costs almost no credits

Not a Claude Code task. Read `docs/12-corgi-mascot-feature.md`, then draw four 64×64 transparent PNGs into `public/corgi/`: `idle`, `wag`, `sit-tilt`, `hop`. About six colors, classic corgi coloring.

`sit-tilt` is the one that matters — ears up, head tilted, clearly asking for help. It plays when the system decides something is too big to handle alone, and it's the image that carries the entire "make it human" theme.

## T3 — Synthetic seed (10:00–11:30)

```
Read /CLAUDE.md and docs/14-lane-b-support.md (task T3).

Write scripts/seed.ts and scripts/verify-db.ts. These are the ONLY files you may
create. Import types from src/lib/types.ts and constants from src/lib/constants.ts —
never redefine them. Do not touch package.json.

The seed must be IDEMPOTENT: truncate the synthetic data and re-seed
deterministically, so re-running it is safe and produces identical results.
Lane A shares this database, so a seed that appends on every run will corrupt
their testing.

- 16 companies, source='synthetic', merge_account_tokens null.
  Invented but realistic startup names. No real company names (that would imply
  Corgi customers who don't exist) and nothing like "Acme" or "Test Co" (that
  undercuts the operational-scale framing the dashboard exists to create).
- 12 months of history each into signal_events, sourced from ml/training_data.csv,
  which already has exactly this shape (400 companies x 12 monthly snapshots).
  Take a slice of 16. Each row already carries all four features, so it maps
  directly onto classifier_features. Choose each event's trigger_type based on
  whichever signal moved most that month.
  Full 12 months matters: the anomaly detector needs at least 3 prior points,
  and the trend chart needs a line to draw.
- Starting coverage_state per company from the stage package in constants.ts —
  not all nine lines on every company.
- 3 to 4 pre-opened pending_approvals spread across different companies. The
  dashboard opens sorted by "needs attention" and that sort is meaningless if
  nothing needs attention.

VERIFICATION LOOP:
Run the seed, then run `npx tsx scripts/verify-db.ts`, which must assert:
16 companies, 192 signal_events rows, every company has a complete coverage_state,
and 3-4 open approvals exist. Fix and re-run until all assertions pass.
Then run the seed a SECOND time and re-run verify — the counts must be identical,
proving idempotency. Paste both outputs.
```

## T4 — Charts (11:30–12:30)

```
Read /CLAUDE.md and docs/14-lane-b-support.md (task T4).
Load the `dataviz` skill BEFORE writing any chart code.

Fill in two component files that already exist as stubs returning null:
  src/components/charts/feature-importance.tsx
  src/components/charts/anomaly-trend.tsx

Do NOT create new files, change these paths, or change their props interfaces —
both are defined in src/lib/types.ts and Lane A imports against them.

These two charts are the visual proof that the ML here is genuinely trained
rather than an LLM call in a trench coat, so they need to read as one system.

- feature-importance.tsx: Recharts horizontal bar chart. Static data from
  ml/classifier_weights.json: cash_inflow_spike_ratio 62.9%,
  headcount_growth_rate_pct 18.1%, deal_size_ratio 17.0%,
  new_hires_this_month 2.1%. Use human-readable labels, not raw snake_case.
- anomaly-trend.tsx: Recharts line chart of one company's metric across its 12
  months, with anomalous points highlighted in red. Takes history as a prop and
  calls detectAnomaly from src/lib/ml/anomaly.ts.

Both must render standalone from fixture props so they can be verified without
Lane A's pages existing.

VERIFICATION LOOP:
Run `npm run verify`. Fix and re-run until clean. Then render both components
against fixture data in the dev server and confirm they display correctly.
Paste the verify output and describe what each chart rendered.
```

## T5 — Corgi mascot (12:30–2:00) — the theme feature

```
Read docs/12-corgi-mascot-feature.md IN FULL first, then /CLAUDE.md and
docs/14-lane-b-support.md (task T5).

Implement the corgi mascot in src/components/corgi/**. That directory is the ONLY
place you may write. Lane A already mounted <CorgiMascot /> in layout.tsx pointing
at your stub, so you must not edit any file outside your directory.

The requirement that makes this feature worth building: THE CORGI MUST BEHAVE
DIFFERENTLY WHEN IT IS CONFIDENT THAN WHEN IT IS NOT. If it acts the same in every
state it has added nothing. The hackathon theme is "make it human," and this
product's whole thesis is automation that knows when to defer to a person.

- Subscribe to Supabase realtime on activity_log inserts. Do not read from the
  Coverage Panel or the Approvals queue — this component is independent.
- State machine driven by the row's tag, using the PNGs in public/corgi/:
    auto      -> wag, matter-of-fact:
                 "Acme hired 3 people - I raised EPLI to $2M."
    pending   -> sit-tilt, asking for help:
                 "Northwind closed a $1.2M deal. That's a big one - can you look?"
    approved  -> hop: "Thanks - Cyber's set to $5M."
    dismissed -> neutral: "Got it, leaving that one alone."
- QUEUE, don't stack. One announcement at a time, about 4 seconds each, the rest
  queued. A sync can emit several events at once and overlapping speech bubbles
  is how this becomes a liability on stage.
- Voice: nudge, not baby talk. Name the real company, the real signal, the real
  number. One or two sentences maximum. This is insurance software — copy that is
  too cute undermines the credibility everything else is building. Never let the
  corgi narrate its own reasoning; explanation belongs in the Activity Feed and
  the feature-importance chart where it is inspectable.
- Fixed bottom-right, image-rendering: pixelated, and NEVER covering the Coverage
  Panel — that panel's old-to-new animation is the demo's money shot.
- Accessibility: announcement text in an aria-live="polite" region, respect
  prefers-reduced-motion with a static pose, never trap focus.

VERIFICATION LOOP:
Run `npm run verify` and fix until clean. Then insert an activity_log row of each
of the four tags directly into Supabase, one at a time, and confirm the corgi
reacts with the correct pose and copy for each. Then insert three rows at once and
confirm they queue rather than overlap. Paste the verify output and report the
result of all five checks.
```

---

## The pattern, if you need to write your own

```
Read <docs>. You may write ONLY to <exact file list>.
Import types from src/lib/types.ts — never redefine them.

<the work, specific, with known gotchas stated so they aren't rediscovered>

VERIFICATION LOOP — do not skip, do not report done early:
Run `<exact command>`. If it fails, fix the cause and run again.
Repeat until it passes clean. Only then report done, and paste the output.
```

Three things make these work: **exact file boundaries** so lanes can't collide, **pre-stated gotchas** so an agent doesn't burn credits rediscovering what's already verified, and **a real command that can fail** so "done" is proven rather than claimed.
