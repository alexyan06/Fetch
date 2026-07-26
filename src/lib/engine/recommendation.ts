// Recommendation and explanation copy — TEMPLATED, never an LLM call.
//
// Two reasons this is a template and stays one:
//
//   1. The approval card has to apply exactly the number it displays. If the
//      text were generated, the sentence a human read could disagree with the
//      value that lands in `coverage_state`, and the audit trail would be a lie.
//      Same inputs -> same string, always.
//   2. The explainability chat (Tier 2) is a separate, clearly-labelled LLM
//      feature. Keeping generated prose out of the decision path is what lets us
//      say the decision engine is real ML rather than a prompt in a trench coat.
//
// Pure functions, zero I/O.

import {
  COVERAGE_LINE_FULL_NAMES,
  COVERAGE_LINE_LABELS,
  FEATURE_LABELS,
  LIMIT_ROUNDING_INCREMENT,
} from "@/lib/constants";
import type {
  ClassifierFeatureName,
  ClassifierFeatures,
  CoverageLine,
  TriggerType,
} from "@/lib/types";

import type { ScalingResult } from "./scaling";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** $2.5M / $750K / $1,000 — policy limits read as round numbers, not 2500000. */
export function formatLimit(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const text = Number.isInteger(millions)
      ? String(millions)
      : millions.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `$${text}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    const text = Number.isInteger(thousands)
      ? String(thousands)
      : thousands.toFixed(1);
    return `$${text}K`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Confidence for display, capped at 99.9% and floored at 0.1%.
 *
 * The raw probability is stored unmodified — this only affects what a human
 * reads. A 10x deal standardizes to roughly +6.5 sigma and sigmoid saturates, so
 * the honest number rounds to exactly 1.0000. Printing "100% confident" reads as
 * a fake progress bar rather than a real model, and overstates what a logistic
 * regression trained on synthetic data can actually claim.
 */
export function formatProbability(probability: number): string {
  const clamped = Math.min(Math.max(probability, 0.001), 0.999);
  return `${(clamped * 100).toFixed(1)}%`;
}

function formatFeatureValue(
  name: ClassifierFeatureName,
  features: ClassifierFeatures,
): string {
  switch (name) {
    case "headcountGrowthRatePct":
      return `${features.headcountGrowthRatePct.toFixed(1)}%`;
    case "newHiresThisMonth":
      return String(Math.round(features.newHiresThisMonth));
    case "cashInflowSpikeRatio":
      return `${features.cashInflowSpikeRatio.toFixed(1)}x normal monthly burn`;
    case "dealSizeRatio":
      return `${features.dealSizeRatio.toFixed(1)}x the typical deal`;
  }
}

/* -------------------------------------------------------------------------- */
/* The signal sentence                                                        */
/* -------------------------------------------------------------------------- */

/** One clause describing what happened, in the trigger's own terms. */
export function describeSignal(
  triggerType: TriggerType,
  features: ClassifierFeatures,
): string {
  switch (triggerType) {
    case "hire": {
      const hires = Math.round(features.newHiresThisMonth);
      const noun = hires === 1 ? "person" : "people";
      return `hired ${hires} ${noun} this month, growing headcount ${features.headcountGrowthRatePct.toFixed(1)}%`;
    }
    case "funding":
      return `recorded net cash inflow at ${features.cashInflowSpikeRatio.toFixed(1)}x its normal monthly burn`;
    case "contract":
      return `closed a deal ${features.dealSizeRatio.toFixed(1)}x larger than its typical won deal`;
    case "burn":
      return `shifted its burn rate to ${features.cashInflowSpikeRatio.toFixed(1)}x normal`;
    case "security_incident":
      return "logged a security-related ticket spike";
  }
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

export interface RecommendationInput {
  companyName: string;
  triggerType: TriggerType;
  coverageLine: CoverageLine;
  features: ClassifierFeatures;
  scaling: ScalingResult;
  probability: number;
  /** The classifier's per-prediction attribution, not the trigger's own feature. */
  topDrivingFeature: ClassifierFeatureName;
}

/**
 * The PENDING path's approval-card text. States the proposed number plainly,
 * because that exact number is what Approve will apply.
 */
export function buildRecommendation(input: RecommendationInput): string {
  const { companyName, coverageLine, features, scaling } = input;
  const line = COVERAGE_LINE_LABELS[coverageLine];
  const lineFull = COVERAGE_LINE_FULL_NAMES[coverageLine];

  const capNote = scaling.cappedByCeiling
    ? ` Capped at the ${line} ceiling of ${formatLimit(scaling.newLimit)}.`
    : scaling.cappedByStep
      ? " Capped at 2x the current limit, the most a single step may move."
      : "";

  const driver = `${FEATURE_LABELS[input.topDrivingFeature]} (${formatFeatureValue(input.topDrivingFeature, features)}) was the strongest factor in this prediction.`;

  return (
    `${companyName} ${describeSignal(input.triggerType, features)}. ` +
    `That's outside the range this company's routine activity falls in, so it's held for review rather than applied automatically. ` +
    `Recommended: raise ${lineFull} (${line}) from ${formatLimit(scaling.currentLimit)} to ${formatLimit(scaling.newLimit)}.${capNote} ` +
    `${driver} ` +
    `Model confidence this needs a human: ${formatProbability(input.probability)}.`
  );
}

/**
 * The AUTO path's Activity Feed line — what changed and why, past tense,
 * because by the time anyone reads it the change is already applied.
 */
export function buildAutoExplanation(input: RecommendationInput): string {
  const { companyName, coverageLine, features, scaling } = input;
  const line = COVERAGE_LINE_LABELS[coverageLine];

  if (!scaling.changed) {
    // Two different ways nothing moves, and they are not interchangeable:
    // the line is maxed out, or the signal was too small to clear the $250K
    // rounding step. Claiming a ceiling when the real reason is rounding would
    // put a false statement in the audit trail.
    const reason = scaling.cappedByCeiling
      ? `${line} already sits at its ceiling of ${formatLimit(scaling.currentLimit)}`
      : `the change this implies is smaller than the ${formatLimit(LIMIT_ROUNDING_INCREMENT)} rounding step, so ${line} stays at ${formatLimit(scaling.currentLimit)}`;

    return (
      `${companyName} ${describeSignal(input.triggerType, features)}. ` +
      `Routine for this company, and ${reason} — no change was needed.`
    );
  }

  return (
    `${companyName} ${describeSignal(input.triggerType, features)}. ` +
    `Routine for this company, so ${line} moved automatically from ` +
    `${formatLimit(scaling.currentLimit)} to ${formatLimit(scaling.newLimit)}.`
  );
}

/** The PENDING path's Activity Feed line. Nothing has been applied yet. */
export function buildPendingExplanation(input: RecommendationInput): string {
  const { companyName, coverageLine, features, scaling } = input;
  const line = COVERAGE_LINE_LABELS[coverageLine];

  return (
    `${companyName} ${describeSignal(input.triggerType, features)}. ` +
    `Flagged for review — ${line} would go from ${formatLimit(scaling.currentLimit)} ` +
    `to ${formatLimit(scaling.newLimit)}, pending approval.`
  );
}
