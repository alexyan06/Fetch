// Turning an EngineDecision into rows.
//
// Underscore-prefixed so Next.js treats the folder as private and never routes
// it. Route files may only export HTTP handlers, so shared logic lives here.
//
// Both `/api/simulate-event` and `/api/sync` go through this single function.
// That is deliberate: the Simulate Event tool is the live-demo fallback for the
// real Merge path, and it only stays a faithful stand-in if a simulated signal
// and a real one are persisted by identical code.

import type { decide } from "@/lib/engine/decide";
import {
  applyCoverageLimit,
  insertActivityLog,
  insertPendingApproval,
} from "@/lib/db/queries";
import type { ActivityLogEntry, CoverageUpdate, PendingApproval } from "@/lib/types";

export type EngineDecision = ReturnType<typeof decide>;

export interface AppliedDecision {
  coverageUpdate: CoverageUpdate | null;
  pendingApproval: PendingApproval | null;
  activityLogEntry: ActivityLogEntry;
}

export async function applyDecision(
  companyId: string,
  signalEventId: string,
  decision: EngineDecision,
): Promise<AppliedDecision> {
  if (decision.decision === "auto") {
    // `coverageUpdate` is null when the limit didn't actually move — already at
    // its ceiling, or the change was under the $250K rounding step. The feed
    // still gets an entry explaining why nothing changed.
    if (decision.coverageUpdate) {
      await applyCoverageLimit(
        companyId,
        decision.coverageLine,
        decision.coverageUpdate.new_value,
      );
    }

    const activityLogEntry = await insertActivityLog({
      companyId,
      signalEventId,
      coverageLine: decision.coverageLine,
      oldValue: decision.coverageUpdate?.old_value ?? null,
      newValue: decision.coverageUpdate?.new_value ?? null,
      tag: "auto",
      explanation: decision.explanation,
    });

    return {
      coverageUpdate: decision.coverageUpdate,
      pendingApproval: null,
      activityLogEntry,
    };
  }

  // PENDING: store the proposed number so Approve applies it verbatim instead
  // of recomputing and risking a different figure than the card displayed.
  const pendingApproval = await insertPendingApproval({
    companyId,
    signalEventId,
    coverageLine: decision.coverageLine,
    proposedLimit: decision.scaling.newLimit,
    currentLimit: decision.scaling.currentLimit,
    recommendationText: decision.recommendationText ?? decision.explanation,
  });

  const activityLogEntry = await insertActivityLog({
    companyId,
    signalEventId,
    coverageLine: decision.coverageLine,
    // Null rather than the proposed value: nothing has been applied, and a feed
    // row carrying a new_value would read as though something had.
    oldValue: null,
    newValue: null,
    tag: "pending",
    explanation: decision.explanation,
  });

  return { coverageUpdate: null, pendingApproval, activityLogEntry };
}
