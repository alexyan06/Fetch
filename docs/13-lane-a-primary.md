# Lane A — Primary Lane (75%)

Your worktree. You own the critical path: contract → engine → API → frontend. Lane B's tasks are all leaves that land before you need them, so **nothing in this list ever waits on Lane B** except the Phase 0 schema (T1), which arrives at 9:15.

Read `/CLAUDE.md` first. `05-technical-architecture.md` is authoritative for schema and API contracts. `12-corgi-mascot-feature.md` covers the theme feature Lane B builds into your stub.

## Worktree setup

```bash
git worktree add ../fetch-lane-a -b lane/a
cd ../fetch-lane-a
```

You may run subagents inside this worktree — that's how 75% of the work fits in the clock. Lane B works sequentially; you parallelize internally.

## The frozen list

You author all of these during Phase 0. After Sync 0 **nobody edits them without announcing it**, and new types are additive only.

```
package.json / package-lock.json     src/lib/types.ts
tsconfig.json / next.config          src/lib/constants.ts
tailwind.config                      src/lib/supabase.ts
src/app/layout.tsx / globals.css     supabase/migrations/**   (Lane B authors, then frozen)
src/components/ui/**
```

Install **every npm dependency and every shadcn component during A1**. This is the single highest-value conflict-prevention step in the build — if neither lane touches `package.json` after Phase 0, the nastiest class of merge conflict cannot happen.

---

# WAVE 1 — planned in full

## A1 · Scaffold + contract (8:30–9:45)

**Owns:** everything in the frozen list except the migration.

1. Next.js 15 App Router, TypeScript pinned to `5.9.3`, Tailwind, Vitest, ESLint.
2. Install all shadcn components the whole build will need: card, table, badge, button, dialog, tabs, toast, skeleton, separator.
3. Vercel project linked, env vars set (Merge API key, 3 account tokens, Supabase URL + keys). **First deploy green before moving on** — a broken deploy discovered at 5 AM is unrecoverable.
4. `src/lib/types.ts` — every row shape and enum: `CoverageLine`, `TriggerType`, `Decision`, `ActivityTag`, `CompanySource`, plus `ClassifierFeatures` and the request/response type for all five API routes. Mirror file 05 exactly; do not invent columns.
5. `src/lib/constants.ts` — coverage lines, stage packages, trigger→line map (hire→EPLI, funding→D&O, contract→Tech E&O), 2× step cap, $250K rounding, the 2.88 neutral constant for the real company's funding feature.
6. `src/lib/supabase.ts` — client singleton.
7. **Stub signatures** for engine and merge functions: real types, `throw new Error("not implemented")` bodies.
8. **Stub component files** so Lane B's work drops in with no edits from you later:
   - `src/components/corgi/index.tsx` → renders `null`, mounted once in `layout.tsx`
   - `src/components/charts/feature-importance.tsx` → renders `null`
   - `src/components/charts/anomaly-trend.tsx` → renders `null`
9. Port `ml/classifier.ts` and `ml/anomaly_detection.ts` → `src/lib/ml/`. Apply the `stdDev === 0` fix: floor the standard deviation so a flat history can't produce an infinite z-score. Add tests for a known-auto case, a known-pending case, and a flat-history anomaly.
10. `npm run verify` script: `tsc --noEmit && vitest run && next build`.

**Verify:** `npm run verify` passes, deploy is live.

### → SYNC 0 (9:45). Merge Lane B's migration. Both branch from here.

Check `types.ts` against their `001_init.sql` column by column before proceeding. A mismatch here poisons everything downstream, and it's a two-minute check.

---

## A2 · Merge integration (9:45–12:00)

**Owns:** `src/lib/merge/{client,sync}.ts`, `scripts/verify-merge.ts`

Longest pole in the build and the only lane touching a live external API — supervise it rather than letting an agent run unattended.

- Authenticated client via `@mergeapi/merge-node-client`. Headers: `Authorization: Bearer <API_KEY>` + `X-Account-Token: <ACCOUNT_TOKEN>`.
- Pull BambooHR Employees, Zoho Books Invoices, HubSpot Opportunities.
- Change detection: `modified_after` off a per-category `last_synced_at`, with a `remote_id` diff as backstop for when Force Resync makes timestamps behave oddly.
- Translate raw Common Models → `ClassifierFeatures`.

**Field rules that are already verified — don't re-derive them:**
- `Employee.employment_status` of `PENDING` with a near-term `start_date` **counts as a hire**. Don't wait for `ACTIVE`.
- Opportunity closed-won is `status === "WON"`. There is no `is_won` boolean.
- `/api/accounting/v1/invoices` is the proven working endpoint.
- **`cash_inflow_spike_ratio` holds 2.88 for the real company, always.** An invoice is receivables, not an equity injection — it structurally cannot represent a funding round. 2.88 is the training mean, so it standardizes to ~0 and contributes nothing. Using 0 instead would push a −0.95 shove toward auto-approve from a feature with no data.

If a field or endpoint shape is uncertain, run `/merge-unified:integration-validator` or fetch the doc URL from file 10. Don't guess.

**Verify:** `npx tsx scripts/verify-merge.ts` prints real records and the derived feature vector.

**If this overruns 12:00, stop and move to A3.** Come back after. The demo runs on Simulate Event regardless; Merge is the credibility layer, not the dependency.

---

## A3 · Decision engine (12:30–1:30, subagent-friendly)

**Owns:** `src/lib/engine/{features,scaling,recommendation,decide}.ts` + tests
**Reads:** `types.ts`, `constants.ts`, `ml/`

Pure functions, zero I/O. Safe to hand to a subagent unattended — it self-corrects against real tests.

- `features.ts` — compute the four features from an event plus company history. **Always populate all four**, using the company's current standing values for the ones this trigger didn't move. Training/serving parity: every row the model learned from was a monthly snapshot with all four present.
- `scaling.ts` — `new = min(current × (1 + growth), 2 × current, line_ceiling)`, rounded to nearest $250K.
- `recommendation.ts` — **templated, not LLM.** Quote the company, the signal, and the real numbers. Must be deterministic so the approval card can't promise one number and apply another.
- `decide.ts` — orchestrates classify → branch. **Returns what should happen as a plain object. It never writes.**

**Verify:** `npx vitest run src/lib/engine`

---

## A4 · API routes + DB layer (1:30–3:00)

**Owns:** `src/app/api/**`, `src/lib/db/queries.ts`

This is where A3's descriptions become actual writes.

Build in this order:
1. **`POST /api/simulate-event`** — first, always. Params `company_id`, `trigger_type`, `magnitude`. Branches on `companies.source`; dry-run only tonight, no Merge writes. This is the fallback for everything else going wrong, so it exists before anything optional.
2. `POST /api/approvals/[id]/approve` — applies **exactly what the card says**, no recompute. Updates `coverage_state`, writes `activity_log` tagged `approved`, resolves the row. Approver hardcoded as "Demo Underwriter".
3. `POST /api/approvals/[id]/dismiss` — resolves, applies nothing.
4. `GET /api/companies` — portfolio list joined with open approval counts, sorted by attention.
5. `POST /api/sync` — last. Uses A2's merge layer.

**Verify:** `npx tsx scripts/verify-api.ts` — fire a simulated event, assert the right row lands in the right table with the right tag.

### → SYNC 2 (~2:00). Pull Lane B's seed + charts. You now have real data to build against.

---

# WAVE 2 — re-cut at the break with real velocity

Sketch only. Adjust scope at 12:30 based on where Wave 1 actually landed.

## A5 · Frontend (3:00–4:30)

**Owns:** `src/app/page.tsx`, `src/app/company/[id]/page.tsx`, `src/app/approvals/page.tsx`, `src/app/demo/page.tsx`, `src/components/{portfolio-table,coverage-panel,activity-feed,approval-card}.tsx`

- **Portfolio dashboard** — all companies sorted by needs-attention. This is the opening shot; it frames the problem as operational rather than a toy.
- **Company detail** — Coverage Panel (stage package lines only, not all nine) with the old→new animation and "Auto-updated just now" badge. Activity Feed with AUTO/PENDING/APPROVED tags. Import Lane B's charts here.
- **Approvals queue** — cards with recommendation text, Approve/Dismiss.
- **Demo Controls** — company picker, trigger type, magnitude, fire. Style it as an internal tool, visibly separate from the product.
- **Realtime** — Supabase subscriptions on `coverage_state`, `activity_log`, `pending_approvals`. No polling. This is the actual mechanism behind "watch it react live."
- **"Live via Merge" badge on the real company only.** Don't label the other 16 as synthetic — that points the eye at the weakness instead of the strength.

## A6 · Integration + real-path test (4:30–5:30)

Full `npm run verify` on merged `main`. Then live, once: change something in BambooHR → Force Resync in the Merge dashboard → confirm it reaches the UI. Then Simulate Event on both a real and a synthetic company. **This hour exists because something will break.**

**Tier 2 gate:** only if the above is fully clean with real time left. One item, and the explainability chat is the pick. The corgi mascot outranks it — that's theme compliance, not polish.

## A7 · Submit (5:30–6:00)

Rehearse once out loud including the Vouch framing. Repo private→public after a secret scan. **Submit with buffer** — submission systems choke near deadlines.

---

## If you fall behind — don't cut below this

- One real company + 5 synthetic ones is still a legitimate demo.
- Activity Feed and Approvals can be plain lists. **The Coverage Panel animation is the first thing to cut**, not the data model under it.
- Simulate Event dry-run is never cut. It's the fallback for everything else.
