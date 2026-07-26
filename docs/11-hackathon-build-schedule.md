# Hackathon Build Schedule (10 hours, 8:00 PM – 6:00 AM)

This maps the Tier 1/2/3 scope from `04-product-concept.md` and the architecture from `05-technical-architecture.md` onto actual clock time. Ten hours is tighter than originally planned — full Tier 1 is already ambitious for this window, so the discipline here matters more than usual: **hit a checkpoint's core deliverable, don't polish past it while later blocks still need their own time.**

Take the ~30 min break wherever it naturally falls — the most sensible spot is right after the 12:00 AM checkpoint, since that's the actual midpoint and a real deliverable will be behind you.

## 8:00 – 8:30 PM — Kickoff, not code yet
- Confirm event rules with organizers (submission format, judging criteria, whether any Corgi sandbox/mock endpoint exists — see `08-hackathon-logistics-constraints.md`)
- Start a Claude Code session, plan mode, feed it `CLAUDE.md` + `04` + `05` + `06`
- Lock the Tier 1 task breakdown as an actual reviewed plan — this is the single highest-leverage 20 minutes of the night (see `07-execution-strategy.md`'s reasoning on why)
- **Decide now, don't defer**: the coverage-limit scaling rule (open decision in file 05) and whether live-write Simulate Event mode is even being attempted tonight (default: no, dry-run only, revisit only if wildly ahead of schedule)

## 8:30 – 9:30 PM — Repo & infra scaffold
- GitHub repo created, `CLAUDE.md` + `/docs` + `/ml` committed
- Next.js scaffold (Tailwind, shadcn/ui, confirmed `typescript@5.9.3` pinned — not 7.x, see file 05's build note)
- Vercel project linked, first deploy confirmed live
- Supabase project's actual tables created: `companies`, `coverage_state`, `signal_events`, `activity_log`, `pending_approvals` (exact schema in file 05)
- Env vars set in Vercel: Merge API key, Supabase URL/keys, LLM key

**Checkpoint**: an empty but deployed app, real schema live in Supabase.

## 9:30 PM – 12:00 AM — Real-data integration + ML wiring
- Merge API calls for the real company across all 3 validated categories (BambooHR Employees, Zoho Books Invoices, HubSpot Opportunities)
- **The piece that didn't exist before tonight**: the real-data-to-feature translation layer — turns a live Merge response into the 4 classifier features (`headcount_growth_rate_pct`, `new_hires_this_month`, `cash_inflow_spike_ratio`, `deal_size_ratio`). Remember: PENDING counts as a hire, `status == "WON"` not `is_won`, Invoices can't represent funding rounds so that feature stays baseline for the real company outside of Simulate Event.
- Drop in `classifier.ts` and `anomaly_detection.ts` from `/ml` — both done, just need wiring
- Seed ~15-19 synthetic companies into Supabase from the generator's approach

**Checkpoint**: hitting `/api/sync` on the real company produces real classifier scores you can see in a log or a temporary debug view.

## — ~30 min break —

## 12:30 – 2:30 AM — Decision engine + API routes
- AUTO path: scaling rule computes new `coverage_state`, writes `activity_log` (`auto`)
- PENDING path: recommendation text generated, `pending_approvals` row created
- `/api/simulate-event` (dry-run mode only tonight) for both real and synthetic companies — this is Tier 1, required, not optional
- `/api/approvals/:id/approve` and `/dismiss`
- `/api/companies` for the portfolio list, sorted by attention-needed

**Checkpoint**: you can trigger a signal event (via Simulate Event) and see the right row land in the right table with the right tag.

## 2:30 – 4:30 AM — Frontend
- Portfolio dashboard (sorted list)
- Company detail view: Coverage Panel (with the auto-update animation) + Activity Feed
- Pending Approvals queue with Approve/Dismiss
- Demo Controls panel wrapping Simulate Event
- Supabase realtime subscriptions wired so the dashboard updates live with no manual refresh — this is the actual mechanism behind the "watch it react" demo moment

**Checkpoint**: the full loop is clickable end to end, even if visually rough.

## 4:30 – 5:30 AM — Integration testing + rehearsal
- Test the real BambooHR/Zoho Books/HubSpot path once, live: make a real change, Force Resync in Merge, confirm it flows through
- Test Simulate Event on both a real and a synthetic company
- Fix whatever breaks — this hour exists specifically because something will
- **If Tier 1 is fully solid with real time left over**: pick at most one Tier 2 item — widening one more Merge category, or the explainability chat via Merge's MCP server (file 01/03) is the highest-value single addition. Don't start more than one.

## 5:30 – 6:00 AM — Final polish & submission
- Rehearse the actual demo script once, out loud, full run (file 09)
- Record a backup video of the deployed app in case live demo hits an issue
- Tighten the pitch — including owning the Vouch comparison proactively (file 09)
- Submit with buffer before the actual deadline, don't wait until 6:00 sharp

## If things run behind — minimum viable Tier 1 (don't cut below this)
- One real company + a handful of synthetic ones (5, not 15-19) is still a legitimate demo
- Activity Feed and Pending Approvals can be plain lists — the Coverage Panel *animation* is the first thing to cut, not the underlying data model
- Simulate Event dry-run mode is not optional — it's the fallback for everything else going wrong, so protect the time for it even if something else gets cut