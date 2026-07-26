# Product Concept

**Working name:** still TBD — "Living Policy" used as a placeholder throughout planning. Pick something sharper before the pitch (see file 09) — don't let this stay unresolved into the event.

## The core mechanic, precisely

Every company being watched has two persistent things (see file 05 for the actual schema):

1. **A coverage state** — the current insurance picture: one entry per coverage line (General Liability, D&O, Tech E&O, Cyber, EPLI, Media Liability, HNOA, Fiduciary, Rep & Warranties), each with a current dollar limit.
2. **A stream of signal events** — discrete things that happened (a new hire, a large transaction, a big deal closing), each carrying enough detail to compute the classifier's input features (file 06).

When a new signal event arrives — from Merge for the real company, or from the generator/Simulate Event tool for everything else — the pipeline does this:

1. Compute the four classifier features from the event plus that company's recent history (`headcount_growth_rate_pct`, `new_hires_this_month`, `cash_inflow_spike_ratio`, `deal_size_ratio` — file 06).
2. Run the trained classifier → get a probability that this needs human review.
3. **Below the decision threshold (routine/small):**
    - Compute a new limit for the affected coverage line(s) using a simple, explainable scaling rule (not another model) — e.g. scale the EPLI limit proportionally to headcount growth, scale Cyber/Tech E&O to the relevant signal, capped at a sane maximum so numbers never look absurd on screen.
    - Apply it immediately to that company's coverage state.
    - Write an Activity Feed entry: timestamp, what changed, old value → new value, which signal caused it, tagged **AUTO**.
4. **At or above the decision threshold (big/unusual):**
    - Do NOT change the coverage state.
    - Generate a written recommendation (plain-language explanation of what should change and why, citing the specific signal and its magnitude).
    - Create a **Pending Approval** record, visible in a dedicated queue.
    - Only once a human clicks Approve does the coverage state actually change — same update-and-log logic as the AUTO path, but the Activity Feed entry is tagged **APPROVED**, recording who/when.

This mirrors a pattern Corgi already uses at initial quote time (auto-bind simple cases, route complex ones to a human underwriter) — we're extending it to ongoing monitoring, which nobody, including Corgi, currently does (see file 03 for the research behind that claim, and its limits — Vouch already did a narrower version of this).

## The trigger definitions, concretely

|Trigger|Real signal (via Merge)|Synthetic/simulated signal|
|---|---|---|
|First non-founder hire / headcount growth|HRIS `Employee.employment_status` becomes `ACTIVE` or `PENDING` with a new `start_date` — PENDING counts immediately, don't wait for ACTIVE (see file 01)|Generator/Simulate Event tool writes a `signal_events` row with the same shape|
|Funding round|Accounting `Transaction` (or `CashFlowStatement.financing_activities`, if the sandbox populates it — file 03) shows net inflow many multiples of the company's normal monthly burn|Same, simulated magnitude|
|Big new contract|CRM `Opportunity` moves to closed-won-equivalent with a value well above that company's typical deal size|Same, simulated magnitude|

Exact numeric thresholds live inside the trained classifier (file 06), not hardcoded here — the point of a trained model instead of hand-picked thresholds is that it learns the boundary from labeled examples rather than us guessing a cutoff.

## Data sources — restated precisely (full schema/detail in file 05)

- **One real company**, connected via Merge across three test Linked Accounts (BambooHR/HRIS, Zoho Books/Accounting, HubSpot/CRM) — proves the pipeline genuinely works against live software.
- **A batch of synthetic companies** (target ~15-20, seeded once ahead of the event from the same generator approach as the ML training data) — proves the tool works at the scale Corgi actually needs.
- **The Simulate Event tool** (below) — an internal control for firing a trigger on demand, on either kind of company.

These never mix. Synthetic data does not train anything at demo time — the classifier was already trained once, offline, before the event (file 06). Real data is never relabeled as synthetic. Every signal event is tagged with its source (`real` or `synthetic`) so the UI can subtly indicate which is which without it reading as a disclaimer (see file 09 for demo framing — don't over-explain this unprompted).

## The Simulate Event tool (new — needed for demo reliability, not just convenience)

**Why it exists:** synthetic companies have no real-world UI to go edit — no fake BambooHR account exists for them — so the only way to give them a new event is a tool we build ourselves. This same tool doubles as a **backup trigger mechanism for the real company**, in case the live BambooHR/Zoho Books/HubSpot path hiccups (wifi, sync delay, sandbox login) during the actual demo.

**What it is:** an internal-only control (e.g. a "Demo Controls" panel, deliberately separate from the polished main UI) where the operator:

1. Picks a company (real or synthetic)
2. Picks a trigger type (hire / funding / contract, widened in Tier 2 to burn or ticketing signals)
3. Picks a rough magnitude (routine vs. large)
4. Fires it

**What happens on fire, depending on company type:**

- **Synthetic company** — writes a new `signal_events` row directly into Supabase, same shape the generator produces.
- **Real company**, two possible modes — pick one deliberately, don't leave this ambiguous going into the build:
    - _Dry-run mode (Tier 1, required)_ — skips Merge, simulates the downstream effect directly, for a guaranteed-reliable fallback with zero dependency on live sandbox state during the demo itself.
    - _Live-write mode (Tier 2, stretch)_ — actually calls Merge's Write API (via the `/meta`-discovered schema — file 01/03 research) to create the real record in the real sandbox, letting it flow through the genuine sync/read pipeline. More impressive if it's built and rehearsed reliably; riskier if it isn't.

## Demoing the result — what's actually shown on screen (no Corgi API involved, by design)

We never call or mock Corgi's real system directly — we show _our own_ dashboard's view of the coverage state, which is honestly ours to design and, frankly, a better thing to demo than a fake mockup of someone else's product:

- **Coverage Panel** (per company) — current limit per coverage line. On an AUTO update, the affected line animates from old value to new value with a brief "Auto-updated just now" badge — this is the visual payoff for the small-change path.
- **Activity Feed** (per company, and/or portfolio-wide) — reverse-chronological log: timestamp, what changed, why, tagged AUTO / PENDING / APPROVED.
- **Pending Approvals queue** (portfolio-level) — cards with the written recommendation for anything awaiting review, Approve/Dismiss actions. Approving moves it into that company's Coverage Panel + Activity Feed as an APPROVED entry — this is the visual payoff for the big-change path.
- **Optional "Send to Corgi" affordance** (Tier 3) — either a mocked confirmation toast or a deep-link to Corgi's real public dashboard (`corgi.insure/startup-insurance`). Never a fake "success" screen pretending to write into their real system.

## Tiered scope (build top to bottom, stop wherever the clock says stop)

### Tier 1 — Core, must work

- Data model in place: `companies`, `coverage_state`, `signal_events`, `activity_log`, `pending_approvals` (file 05 schema)
- Trigger detection across the 3 named events, for the 1 real company + ~15-20 synthetic companies
- Classifier wired in (TypeScript port from file 06) making the AUTO vs. PENDING call
- AUTO path: coverage state updates + Activity Feed entry
- PENDING path: written recommendation + Pending Approvals queue + Approve action
- Portfolio dashboard: all companies, sorted by "needs attention" (e.g. open pending-approval count)
- Company detail view: Coverage Panel + Activity Feed
- Simulate Event tool, dry-run mode, for both real and synthetic companies
- Full demo rehearsed at least once end-to-end via both the real BambooHR/Zoho Books/HubSpot path AND the Simulate Event fallback

### Tier 2 — Real weight (if Tier 1 solid by ~hour 6-7)

- Widen Merge category coverage: Accounting burn/runway signal, Ticketing security-incident signal, CRM customer-concentration signal
- Explainability chat, ideally backed by Merge's own MCP server (file 01/03) scoped to our Linked Accounts, rather than hand-written REST-then-prompt glue
- Forward-looking projection ("at this pace, you'll cross X threshold in ~N weeks")
- Simulate Event tool, live-write mode for the real company (calls Merge's Write API)

### Tier 3 — Stretch/polish (only if way ahead of schedule)

- Clickable "receipt" per Activity Feed entry — the exact data point + timestamp that caused it (maps to Merge's own enterprise "Audit Trail" concept)
- "Send to Corgi" affordance (mocked confirmation or deep-link)
- Merge Gateway routing for the chat feature's LLM calls (file 03) instead of calling Anthropic directly

## Backup ideas (if a pivot becomes necessary)

- **Backup A — "Underwriter's Copilot":** internal tool for Corgi's own underwriting team — give it a company name, it connects via Merge Link and auto-generates a full underwriting packet (risk narrative, red flags, recommended limits across all 8 Corgi coverage lines, citations to source data). Less flashy, more directly solves Corgi's actual operational pain.
- **Backup B — narrower Cyber/Tech E&O angle:** just the security-signal piece — continuously pull security-relevant signals (offboarding lag in HRIS = access-control risk, security-labeled tickets, file-sharing permissions) and auto-generate a live "insurability score" + evidence packet. Smaller surface area, easier to finish clean solo.