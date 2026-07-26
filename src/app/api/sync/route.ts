// POST /api/sync — pull the real company's Merge data and process what's new.
//
// Built last because everything it needs already exists: A2's Merge layer does
// the fetching and change detection, A3's engine decides, and `applyDecision`
// writes. This route is the wiring, not the logic.
//
// Only companies with `source = 'real'` come through here. The other 16 are
// synthetic and never touch Merge — see CLAUDE.md.

import { NextResponse } from "next/server";

import { decide } from "@/lib/engine/decide";
import { standingFromHistory } from "@/lib/engine/features";
import {
  getCompany,
  getCoverageState,
  insertSignalEvent,
  listRealCompanies,
  listRecentSignalEvents,
} from "@/lib/db/queries";
import {
  EMPTY_CURSOR,
  primeCursor,
  syncRealCompany,
  type SyncCursor,
} from "@/lib/merge/sync";
import { TRIGGER_COVERAGE_LINE } from "@/lib/constants";
import type {
  ApiError,
  Company,
  SyncCompanyResult,
  SyncRequest,
  SyncResponse,
} from "@/lib/types";

import { applyDecision } from "../_lib/apply-decision";

/* -------------------------------------------------------------------------- */
/* Cursor storage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Per-company sync cursors, held in module memory.
 *
 * There is no cursor table — 001/002 don't define one, and adding a migration
 * mid-build is a worse trade than this. The consequence is honest and bounded:
 * a serverless cold start loses the cursor, and the next sync re-primes instead
 * of emitting. That's the safe direction to fail (silence, not a flood of
 * duplicate signals), and it survives the demo, where sync runs a handful of
 * times against a warm instance.
 *
 * If this ever needs to be durable, the fix is a `sync_cursors` table keyed by
 * (company_id, category) — not a smarter in-memory scheme.
 */
const cursors = new Map<string, SyncCursor>();

/* -------------------------------------------------------------------------- */
/* Per-company sync                                                           */
/* -------------------------------------------------------------------------- */

async function syncOne(company: Company): Promise<SyncCompanyResult> {
  const result: SyncCompanyResult = {
    company_id: company.id,
    company_name: company.name,
    signal_events_created: 0,
    auto_applied: 0,
    pending_created: 0,
    warnings: [],
  };

  // First sync for this company: mark everything Merge currently has as seen
  // and emit nothing. Otherwise all 109 sandbox employees and 8 invoices read
  // as brand-new arrivals and bury the feed — technically correct for an
  // initial sync, useless on stage. After priming, only changes made from here
  // produce signals.
  if (!cursors.has(company.id)) {
    const primed = await primeCursor(company);
    cursors.set(company.id, primed);
    result.warnings.push(
      "First sync for this company — baseline recorded, no signals emitted. Make a change in the source platform, Force Resync in Merge, then sync again.",
    );
    return result;
  }

  const cursor = cursors.get(company.id) ?? EMPTY_CURSOR;
  const sync = await syncRealCompany(company, cursor);
  result.warnings.push(...sync.warnings);

  // Advance the cursor before processing. If a write fails partway, the next
  // sync won't replay signals already turned into rows — duplicate coverage
  // changes are worse than a missed one we can re-fire with Simulate Event.
  cursors.set(company.id, sync.nextCursor);

  const history = await listRecentSignalEvents(company.id);
  const standing = standingFromHistory(history);

  for (const signal of sync.signals) {
    const coverageLine = TRIGGER_COVERAGE_LINE[signal.triggerType];
    const coverage = await getCoverageState(company.id, coverageLine);
    if (!coverage) {
      result.warnings.push(
        `Skipped ${signal.triggerType}: ${company.name} carries no ${coverageLine} line.`,
      );
      continue;
    }

    const decision = decide({
      companyName: company.name,
      triggerType: signal.triggerType,
      // `signal.features` is the full four-feature vector A2 derives from the
      // CURRENT Merge snapshot — every trigger detected in this sync gets the
      // identical vector, because `deriveFeatures` computes it once per
      // snapshot, not once per trigger. Passing it as `observation` (not also
      // as `standing`) is what keeps that safe: decide()/computeFeatures()
      // only pulls the keys this trigger actually owns
      // (TRIGGER_OWNED_FEATURES) out of it, so a hire signal can't inherit an
      // unrelated contract's dealSizeRatio. The other three features come
      // from `standing` below instead.
      //
      // This used to pass `{ ...standing, ...signal.features }` as `standing`
      // too, which overwrote every key with the full vector and defeated that
      // filtering — confirmed live against the real sandbox: a single $22K
      // HubSpot deal pinned dealSizeRatio at 10.5x, which then also saturated
      // an unrelated hire signal to PENDING in the same sync.
      observation: signal.features,
      standing,
      currentLimit: Number(coverage.current_limit),
      rawPayload: signal.rawPayload,
    });

    const signalEvent = await insertSignalEvent({
      companyId: company.id,
      triggerType: signal.triggerType,
      rawPayload: decision.rawPayload,
      features: decision.features,
      probability: decision.probability,
      decision: decision.decision,
      simulated: false,
    });

    await applyDecision(company.id, signalEvent.id, decision);

    result.signal_events_created++;
    if (decision.decision === "auto") result.auto_applied++;
    else result.pending_created++;
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  let body: SyncRequest = {};
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    // No body means "sync every real company", which is the demo's default.
  }

  try {
    let companies: Company[];

    if (body.companyId) {
      const company = await getCompany(body.companyId);
      if (!company) {
        return NextResponse.json<ApiError>(
          { error: "Company not found", detail: body.companyId },
          { status: 404 },
        );
      }
      if (company.source !== "real") {
        return NextResponse.json<ApiError>(
          {
            error: "Company is not Merge-backed",
            detail: `${company.name} is synthetic. Use /api/simulate-event instead.`,
          },
          { status: 409 },
        );
      }
      companies = [company];
    } else {
      companies = await listRealCompanies();
    }

    const results: SyncCompanyResult[] = [];
    for (const company of companies) {
      try {
        results.push(await syncOne(company));
      } catch (error) {
        // One company failing must not abort the rest.
        results.push({
          company_id: company.id,
          company_name: company.name,
          signal_events_created: 0,
          auto_applied: 0,
          pending_created: 0,
          warnings: [
            `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    }

    return NextResponse.json<SyncResponse>({
      synced_at: new Date().toISOString(),
      companies_synced: results.length,
      signal_events_created: results.reduce(
        (sum, r) => sum + r.signal_events_created,
        0,
      ),
      auto_applied: results.reduce((sum, r) => sum + r.auto_applied, 0),
      pending_created: results.reduce((sum, r) => sum + r.pending_created, 0),
      results,
    });
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: "Sync failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
