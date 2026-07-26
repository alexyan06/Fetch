// The decision engine's entry point: features -> classifier -> branch.
//
// This function DECIDES. It does not write. It returns a plain description of
// what should happen and hands it to `/api/sync` or `/api/simulate-event` to
// persist. Keeping the branch pure is what makes it testable without a database
// and what guarantees the number on the approval card is the number that lands
// in `coverage_state` — there's exactly one place the new limit is computed.
//
// Pure functions, zero I/O.

import { TRIGGER_COVERAGE_LINE } from "@/lib/constants";
import { classify, DECISION_THRESHOLD } from "@/lib/ml/classifier";
import type {
  ClassifierFeatureName,
  ClassifierFeatures,
  CoverageLine,
  CoverageUpdate,
  Decision,
  SignalEvent,
  SignalRawPayload,
  TriggerType,
} from "@/lib/types";

import { computeFeatures, type FeatureObservation } from "./features";
import {
  buildAutoExplanation,
  buildPendingExplanation,
  buildRecommendation,
  type RecommendationInput,
} from "./recommendation";
import { computeNewLimit, type ScalingResult } from "./scaling";

/* -------------------------------------------------------------------------- */
/* I/O shapes                                                                 */
/* -------------------------------------------------------------------------- */

export interface DecideInput {
  companyName: string;
  triggerType: TriggerType;
  /** What this event measured. Features outside the trigger's scope ignored. */
  observation: FeatureObservation;
  /** Current limit on the line this trigger moves. */
  currentLimit: number;
  /** Prior events for this company; drives standing values. */
  history?: readonly SignalEvent[];
  /** Pre-computed standing, when the caller already has all four. */
  standing?: ClassifierFeatures;
  /** Verbatim underlying data, carried to `signal_events.raw_payload`. */
  rawPayload?: SignalRawPayload;
  /** Overrides the trigger's default line. Rarely needed. */
  coverageLine?: CoverageLine;
  /** Injectable clock for standing's recency decay (features.ts). Defaults to now. */
  now?: Date;
}

/**
 * What should happen — not what happened. The caller turns this into rows.
 *
 * Deliberately NOT `ProcessSignalResult` from types.ts: that shape carries row
 * ids and timestamps, which only exist once something has been written. This is
 * the pre-write description.
 */
export interface EngineDecision {
  triggerType: TriggerType;
  coverageLine: CoverageLine;
  /** Stored verbatim to `signal_events.classifier_features`. */
  features: ClassifierFeatures;
  /** Raw model output, unclamped. Display goes through formatProbability. */
  probability: number;
  decision: Decision;
  /** Which feature moved THIS prediction most — may differ from the trigger's. */
  topDrivingFeature: ClassifierFeatureName;
  scaling: ScalingResult;
  /** Set on the AUTO path only. Null when pending or when nothing moved. */
  coverageUpdate: CoverageUpdate | null;
  /** Set on the PENDING path only — the approval card's text. */
  recommendationText: string | null;
  /** The Activity Feed line for this decision. */
  explanation: string;
  rawPayload: SignalRawPayload;
}

/* -------------------------------------------------------------------------- */
/* The branch                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Classify one signal and decide what to do with it.
 *
 * Below the 0.5 threshold the change applies automatically. At or above it, the
 * change is described and queued for a human — nothing is applied. The threshold
 * comparison lives in the classifier (`needsHumanReview`); it's mirrored here
 * only in the sense that we branch on it, never re-derived.
 */
export function decide(input: DecideInput): EngineDecision {
  const coverageLine =
    input.coverageLine ?? TRIGGER_COVERAGE_LINE[input.triggerType];

  const features = computeFeatures({
    triggerType: input.triggerType,
    observation: input.observation,
    history: input.history,
    standing: input.standing,
    now: input.now,
  });

  const classification = classify(features);
  const scaling = computeNewLimit(
    input.triggerType,
    features,
    input.currentLimit,
    coverageLine,
  );

  const decision: Decision = classification.needsHumanReview
    ? "pending"
    : "auto";

  const copyInput: RecommendationInput = {
    companyName: input.companyName,
    triggerType: input.triggerType,
    coverageLine,
    features,
    scaling,
    probability: classification.probability,
    topDrivingFeature: classification.topDrivingFeature,
  };

  const isAuto = decision === "auto";

  return {
    triggerType: input.triggerType,
    coverageLine,
    features,
    probability: classification.probability,
    decision,
    topDrivingFeature: classification.topDrivingFeature,
    scaling,
    // `changed` guards the no-op case: a line already at its ceiling produces a
    // feed entry explaining why nothing moved, but no coverage update.
    coverageUpdate:
      isAuto && scaling.changed
        ? {
            coverage_line: coverageLine,
            old_value: scaling.currentLimit,
            new_value: scaling.newLimit,
          }
        : null,
    recommendationText: isAuto ? null : buildRecommendation(copyInput),
    explanation: isAuto
      ? buildAutoExplanation(copyInput)
      : buildPendingExplanation(copyInput),
    rawPayload: input.rawPayload ?? {
      summary: buildPendingExplanation(copyInput),
    },
  };
}

export { DECISION_THRESHOLD };
