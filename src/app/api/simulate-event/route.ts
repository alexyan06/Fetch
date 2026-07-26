// POST /api/simulate-event — the Simulate Event tool's backend.
//
// Tier 1 and never cut: synthetic companies have no real-world UI to edit, and
// this doubles as the real company's live-demo backup if the BambooHR path
// hiccups on stage. It is built first for that reason — it is the fallback for
// everything else going wrong.
//
// Dry-run only tonight. `live_write` (POST into the real sandbox via Merge's
// Write API) is the Tier 2 stretch and is rejected rather than silently
// downgraded, so nobody can believe they wrote to Merge when they didn't.

import { NextResponse } from "next/server";

import { decide } from "@/lib/engine/decide";
import { standingFromHistory } from "@/lib/engine/features";
import {
  getCompany,
  getCoverageState,
  insertSignalEvent,
  listRecentSignalEvents,
} from "@/lib/db/queries";

import { applyDecision } from "../_lib/apply-decision";
import { TRIGGER_COVERAGE_LINE } from "@/lib/constants";
import type {
  ApiError,
  ClassifierFeatures,
  SimulateEventRequest,
  SimulateEventResponse,
  SimulateMagnitude,
  TriggerType,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Magnitudes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What each (trigger, magnitude) pair observes.
 *
 * Deterministic on purpose — a demo control that produces a different number
 * every click is a demo control you can't rehearse against.
 *
 * `routine` values are tuned to clear two bars at once: they must score below
 * the 0.5 threshold (so they land AUTO), and they must be large enough to move
 * the limit past the $250K rounding step (so the Coverage Panel actually
 * animates). A 2% hire does the first but not the second, and produces a demo
 * moment where nothing visibly happens.
 *
 * `large` values sit well beyond the training labels' review thresholds
 * (>25% headcount growth, >5x burn, >5x typical deal) so they route to PENDING.
 */
const MAGNITUDES: Record<
  TriggerType,
  Record<SimulateMagnitude, Partial<ClassifierFeatures>>
> = {
  hire: {
    routine: { headcountGrowthRatePct: 15, newHiresThisMonth: 4 },
    large: { headcountGrowthRatePct: 60, newHiresThisMonth: 15 },
  },
  funding: {
    routine: { cashInflowSpikeRatio: 8 },
    large: { cashInflowSpikeRatio: 40 },
  },
  contract: {
    routine: { dealSizeRatio: 2.5 },
    large: { dealSizeRatio: 10 },
  },
  burn: {
    routine: { cashInflowSpikeRatio: 6 },
    large: { cashInflowSpikeRatio: 30 },
  },
  security_incident: {
    routine: {},
    large: {},
  },
};

const VALID_TRIGGERS: readonly TriggerType[] = [
  "hire",
  "funding",
  "contract",
  "burn",
  "security_incident",
];

function badRequest(error: string, detail?: string) {
  return NextResponse.json<ApiError>({ error, detail }, { status: 400 });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  let body: SimulateEventRequest;
  try {
    body = (await request.json()) as SimulateEventRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { companyId, triggerType, magnitude } = body;
  const mode = body.mode ?? "dry_run";

  if (!companyId) return badRequest("companyId is required");
  if (!VALID_TRIGGERS.includes(triggerType)) {
    return badRequest(
      "Unknown triggerType",
      `Expected one of ${VALID_TRIGGERS.join(", ")}`,
    );
  }
  if (magnitude !== "routine" && magnitude !== "large") {
    return badRequest("magnitude must be 'routine' or 'large'");
  }
  if (mode === "live_write") {
    // Refused rather than downgraded: silently doing a dry run while the caller
    // believes a record landed in BambooHR is worse than not supporting it.
    return NextResponse.json<ApiError>(
      {
        error: "live_write mode is not implemented",
        detail:
          "Writing into the real sandbox via Merge's Write API is a Tier 2 stretch. Use dry_run.",
      },
      { status: 501 },
    );
  }

  try {
    const company = await getCompany(companyId);
    if (!company) {
      return NextResponse.json<ApiError>(
        { error: "Company not found", detail: companyId },
        { status: 404 },
      );
    }

    const coverageLine = TRIGGER_COVERAGE_LINE[triggerType];
    const coverage = await getCoverageState(company.id, coverageLine);
    if (!coverage) {
      return NextResponse.json<ApiError>(
        {
          error: "Company does not carry this coverage line",
          detail: `${company.name} (${company.stage}) has no ${coverageLine} row. The ${triggerType} trigger moves ${coverageLine}.`,
        },
        { status: 409 },
      );
    }

    // Standing comes from the company's own history, so a simulated event is
    // evaluated in the same context a real one would be — the three features
    // this trigger doesn't move carry real values, not placeholders.
    const history = await listRecentSignalEvents(company.id);
    const standing = standingFromHistory(history);

    const observation = MAGNITUDES[triggerType][magnitude];
    const decision = decide({
      companyName: company.name,
      triggerType,
      observation,
      currentLimit: Number(coverage.current_limit),
      standing,
      rawPayload: {
        summary: `Simulated ${magnitude} ${triggerType} event for ${company.name}.`,
        source: "simulate-event",
        magnitude,
        mode,
        observation,
      },
    });

    const signalEvent = await insertSignalEvent({
      companyId: company.id,
      triggerType,
      rawPayload: decision.rawPayload,
      features: decision.features,
      probability: decision.probability,
      decision: decision.decision,
      simulated: true,
    });

    const response = await applyDecision(company.id, signalEvent.id, decision);

    return NextResponse.json<SimulateEventResponse>({
      signal_event: signalEvent,
      decision: decision.decision,
      classifier_probability: decision.probability,
      top_driving_feature: decision.topDrivingFeature,
      coverage_update: response.coverageUpdate,
      pending_approval: response.pendingApproval,
      activity_log_entry: response.activityLogEntry,
      mode,
    });
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: "Simulate event failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
