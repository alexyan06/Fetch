# Lane B — Support Lane (25%)

Five self-contained tasks. Every one is a **leaf**: nothing in Lane A waits on it beyond the delivery time listed, and none of them depend on each other except through files that already exist when you start.

**You are done by 2:00 AM.** That's deliberate — your deliverables all land well before Lane A needs them, so a slow task on your side never stalls the critical path.

## Credit budget

Claude Code credits are the constraint on this lane, so the tasks are chosen to be **bounded and deterministic** — each has one verify command that proves "done" without open-ended iteration. Two habits that matter:

- **Paste the whole task brief in one prompt**, including the verify command. Fewer, more complete prompts cost far less than a long back-and-forth.
- **T2 costs almost nothing** — it's a drawing tool, not an agent loop. Do it while Lane A is still locking the contract.

Read `/CLAUDE.md` first. For T1 and T3, `05-technical-architecture.md` is authoritative. For T5, read `12-corgi-mascot-feature.md`.

## Worktree setup

```bash
git worktree add ../fetch-lane-b -b lane/b
cd ../fetch-lane-b
```

## Rules

- **Write only to the files listed under Owns.** Everything else in the repo is read-only for you.
- Import all types from `src/lib/types.ts` and constants from `src/lib/constants.ts`. **Never redefine them** — if you need a type that doesn't exist, say so rather than adding one.
- Never touch `package.json`. Every dependency you need is installed during Lane A's Phase 0.
- Run your verify command until it passes before you push.

---

## T1 · Database schema (8:30–9:15) — **delivery: 9:15, blocks Lane A**

**Owns:** `supabase/migrations/001_init.sql`

The only task of yours that Lane A waits on. It's first for that reason.

Create the five tables **exactly** as specified in `05-technical-architecture.md`:

- **`companies`** — `id` (uuid PK), `name`, `source` (enum `real` | `synthetic`), `merge_account_tokens` (jsonb nullable), `created_at`
- **`coverage_state`** — `id`, `company_id` FK, `coverage_line` (enum: GL, D&O, Tech E&O, Cyber, EPLI, Media Liability, HNOA, Fiduciary, Rep & Warranties), `current_limit` (numeric), `updated_at`
- **`signal_events`** — `id`, `company_id` FK, `trigger_type` (enum: hire, funding, contract), `raw_payload` (jsonb), `classifier_features` (jsonb), `classifier_probability` (numeric), `decision` (enum `auto` | `pending`), `created_at`
- **`activity_log`** — `id`, `company_id` FK, `signal_event_id` FK nullable, `coverage_line` nullable, `old_value`/`new_value` numeric nullable, `tag` (enum: auto, pending, approved, dismissed), `explanation` text, `created_at`
- **`pending_approvals`** — `id`, `company_id` FK, `signal_event_id` FK, `recommendation_text` text, `status` (enum: open, approved, dismissed), `resolved_at` timestamptz nullable

**Do not invent columns.** Lane A writes `types.ts` against this same spec in parallel, and the two get diffed at Sync 0 — extra or renamed columns break that check.

Enable realtime on `coverage_state`, `activity_log`, and `pending_approvals`. That's what drives the live dashboard.

**Verify:** migration applies clean against the Supabase project; all five tables exist with the right columns.

### → Push immediately. Tell Lane A it's ready.

---

## T2 · Pixel art assets (9:15–10:00) — **near-zero credits**

**Owns:** `public/corgi/*.png`

Read `12-corgi-mascot-feature.md` for the full spec. Summary:

- **64×64 px, transparent PNG**, ~6 colors — classic corgi, orange/tan body, white chest and blaze, dark eyes.
- **Four poses:** `idle`, `wag` (confident), `sit-tilt` (deferring — ears up, head tilted), `hop` (relieved).
- Optionally a second wag frame for a 2-frame tail cycle. That's enough motion; don't build a real sprite sheet.

The `sit-tilt` pose is the important one. It's what plays when the system decides something is too big to handle alone, and it's the single image that carries the "make it human" theme.

**Verify:** four PNGs in `public/corgi/`, correct dimensions, transparent background, readable at 2× scale.

---

## T3 · Synthetic seed (10:00–11:30) — **delivery: 11:30, Lane A needs it at 2:00**

**Owns:** `scripts/seed.ts`, `scripts/verify-db.ts`

Seed the portfolio. You wrote the schema, so you already know the shapes.

- **16 companies**, `source = 'synthetic'`, `merge_account_tokens` null. Invented but realistic startup names — no real company names (that would imply Corgi customers who don't exist), and nothing like "Acme" or "Test Co" (that undercuts the operational-scale framing the dashboard exists to make).
- **12 months of history each** into `signal_events`. Use `ml/training_data.csv` as the source — it already contains exactly this shape, 400 companies × 12 months. Take a slice of 16. Each monthly row carries all four features, so the row maps directly onto `classifier_features`. Pick the `trigger_type` for each event from whichever signal moved most that month.
- **Starting `coverage_state`** per company from the stage package in `src/lib/constants.ts` — not all nine lines on every company.
- **3–4 pre-opened `pending_approvals`** spread across different companies. The dashboard opens sorted by "needs attention," and that sort is meaningless if nothing needs attention. This is what gives the opening shot tension.

Full 12 months matters: the anomaly detector needs at least 3 prior points to say anything, and the trend chart needs a line to draw.

**Verify:** `npx tsx scripts/verify-db.ts` asserts 16 companies, 192 signal_events rows, every company has a complete coverage_state, and 3–4 open approvals exist.

---

## T4 · Charts (11:30–12:30) — **delivery: 12:30, Lane A imports at 3:00**

**Owns:** `src/components/charts/feature-importance.tsx`, `src/components/charts/anomaly-trend.tsx`

Lane A created both files during Phase 0 as stubs rendering `null`. Fill them in — **do not create new files or change their paths**, or Lane A's imports break.

**Load the `dataviz` skill before writing any chart code.** These two charts are the visual proof that the ML is real rather than an LLM in a trench coat, so they need to read as one system.

- **`feature-importance.tsx`** — Recharts horizontal bar chart from `ml/classifier_weights.json`. Static data, zero dependencies: cash_inflow_spike_ratio 62.9%, headcount_growth_rate_pct 18.1%, deal_size_ratio 17.0%, new_hires_this_month 2.1%. Use readable labels, not raw snake_case field names.
- **`anomaly-trend.tsx`** — Recharts line chart of a company's metric over its 12 months, with anomalous points highlighted in red. Takes history as a prop; call `detectAnomaly` from `src/lib/ml/anomaly.ts`.

Both must render standalone with fixture data so you can verify them without Lane A's pages existing.

**Verify:** `npm run verify` passes, and both components render correctly against fixture props.

---

## T5 · Corgi mascot (12:30–2:00) — **delivery: 2:00, the theme feature**

**Owns:** `src/components/corgi/**`

Read `12-corgi-mascot-feature.md` in full first. Lane A mounted `<CorgiMascot />` in `layout.tsx` during Phase 0, pointing at your stub — so **you touch no frozen file.**

The one requirement that makes this worth building: **the corgi behaves differently when it's confident than when it isn't.** If it acts the same in all states, it's noise.

- Own Supabase realtime subscription on `activity_log` inserts. Do not read from the Coverage Panel or Approvals queue.
- **State machine** driven by the row's `tag`:
  - `auto` → wag, matter-of-fact: *"Acme hired 3 people — I raised EPLI to $2M."*
  - `pending` → sit-tilt, asks for help: *"Northwind closed a $1.2M deal. That's a big one — can you take a look?"*
  - `approved` → hop: *"Thanks — Cyber's set to $5M."*
  - `dismissed` → neutral: *"Got it, leaving that one alone."*
- **Queue, don't stack.** One announcement at a time, ~4 seconds each, rest queued. A sync can emit several events at once, and overlapping speech bubbles is how this feature becomes a liability on stage.
- **Voice: nudge, not baby talk.** Name the real company, the real signal, the real number. One or two sentences. Never let the corgi narrate its own reasoning — the explanation belongs in the Activity Feed and the feature-importance chart, where it's inspectable.
- **Position:** fixed bottom-right, `image-rendering: pixelated`, never covering the Coverage Panel. The panel's old→new animation is the money shot and the corgi must not step on it. Test at demo resolution.
- **Accessibility:** announcement text in an `aria-live="polite"` region; respect `prefers-reduced-motion` with a static pose; never trap focus.

**Fallback:** if T2's assets aren't usable, ship an inline SVG silhouette or even an emoji with the same state machine. The behavior carries the theme; the art is a multiplier, not a prerequisite.

**Verify:** insert an `activity_log` row of each tag directly in Supabase and confirm the corgi reacts correctly to all four, one at a time, without overlapping.

---

## After 2:00 AM

You're done. Most useful things you can do with remaining time, in order:

1. Help test the demo path — click through every screen looking for anything broken.
2. Take over recording the backup demo video once the app is stable.
3. Sleep. Someone rested at 5 AM is worth more than another marginal feature.

## Sync protocol

At each delivery point:

```bash
git add -A && git commit -m "lane-b: <what>"
git fetch origin && git rebase origin/main
npm run verify          # must pass before you push
git push origin lane/b
```

Then tell Lane A to pull.

| Sync | Time | You deliver |
|---|---|---|
| **Sync 0** | 9:45 | T1 migration |
| **Sync 1** | 12:00 | T3 seed (+ T2 assets) |
| **Sync 2** | 2:00 | T4 charts, T5 corgi |
