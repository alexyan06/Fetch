// The scaling rule — how a signal becomes a new dollar limit.
//
//   new = min(current x (1 + growth), 2 x current, line_ceiling)
//
// rounded to the nearest $250K. Deliberately simple arithmetic, because a judge
// asking "how did you calculate that?" deserves an answer that fits in one
// sentence and not a model card.
//
// Pure functions, zero I/O.

import {
  LIMIT_ROUNDING_INCREMENT,
  MAX_SINGLE_STEP_MULTIPLIER,
  MIN_COVERAGE_LIMIT,
  NEUTRAL_FUNDING_SIGNAL,
  TRIGGER_COVERAGE_LINE,
} from "@/lib/constants";
import type {
  ClassifierFeatures,
  CoverageLine,
  TriggerType,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Per-line ceilings                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The most any one line can reach through this tool, regardless of signal.
 *
 * NOTE FOR REVIEW: these arguably belong in `src/lib/constants.ts` alongside the
 * other explain-to-a-judge numbers, but that file is frozen and A3's write scope
 * is `src/lib/engine/**`. Worth relocating in a later pass.
 *
 * The relative shape is the defensible part, not the absolute figures: R&W sits
 * highest because it backstops a whole transaction, D&O / Tech E&O / Cyber cluster
 * next as the lines that produce eight-figure claims, and HNOA sits lowest
 * because a non-owned-auto claim is bounded by what a car can do.
 */
export const LINE_CEILINGS: Record<CoverageLine, number> = {
  CGL: 5_000_000,
  DO: 10_000_000,
  TECH_EO: 10_000_000,
  CYBER: 10_000_000,
  EPLI: 5_000_000,
  MEDIA_LIABILITY: 3_000_000,
  HNOA: 2_000_000,
  FIDUCIARY: 3_000_000,
  REP_WARRANTIES: 20_000_000,
};

/* -------------------------------------------------------------------------- */
/* Feature -> growth                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Divisors converting a trigger's feature into limit growth. Each answers "how
 * much excess signal equals one doubling of coverage?"
 *
 * Same caveat as LINE_CEILINGS: these are explain-to-a-judge numbers living in
 * the engine only because constants.ts is frozen.
 */
const FUNDING_SENSITIVITY = 20;
const CONTRACT_SENSITIVITY = 10;

/** A deal the same size as the company's typical one is not growth. */
const TYPICAL_DEAL_RATIO = 1;

/**
 * How much a trigger's own feature argues the limit should grow, as a fraction.
 *
 * Never negative. A signal can justify raising a limit; nothing here lowers one,
 * because dropping somebody's coverage automatically off a single data point is
 * not a decision software should make unattended.
 *
 *   hire     — headcount growth maps 1:1. EPLI exposure is roughly the number
 *              of people who can bring an employment claim, so 12% more staff
 *              is 12% more exposure. This is the cleanest of the three.
 *   funding  — excess cash inflow over a normal month (the 2.88 training mean),
 *              divided by 20. A raise at 5x burn nudges D&O ~11%; a 40x raise
 *              blows past the 2x step cap and lands there instead.
 *   contract — how far the deal exceeds this company's typical won deal,
 *              divided by 10. A 2x deal moves Tech E&O 10%.
 *   burn     — Tier 2, shares the funding path.
 *   security_incident — Tier 2 ticketing signal with no trained feature behind
 *              it, so it produces no growth rather than an invented number.
 */
export function growthFromFeatures(
  triggerType: TriggerType,
  features: ClassifierFeatures,
): number {
  switch (triggerType) {
    case "hire":
      return Math.max(0, features.headcountGrowthRatePct / 100);

    case "funding":
    case "burn":
      return Math.max(
        0,
        (features.cashInflowSpikeRatio - NEUTRAL_FUNDING_SIGNAL) /
          FUNDING_SENSITIVITY,
      );

    case "contract":
      return Math.max(
        0,
        (features.dealSizeRatio - TYPICAL_DEAL_RATIO) / CONTRACT_SENSITIVITY,
      );

    case "security_incident":
      return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                   */
/* -------------------------------------------------------------------------- */

function roundToIncrement(value: number): number {
  return Math.round(value / LIMIT_ROUNDING_INCREMENT) * LIMIT_ROUNDING_INCREMENT;
}

function floorToIncrement(value: number): number {
  return Math.floor(value / LIMIT_ROUNDING_INCREMENT) * LIMIT_ROUNDING_INCREMENT;
}

export interface ScalingResult {
  currentLimit: number;
  newLimit: number;
  /** The growth fraction the trigger's feature argued for, before any capping. */
  rawGrowth: number;
  /** True when the 2x single-step cap bound the result. */
  cappedByStep: boolean;
  /** True when the line's ceiling bound the result. */
  cappedByCeiling: boolean;
  /** False when the limit didn't move — already at ceiling, or growth ~0. */
  changed: boolean;
}

/**
 * Apply the scaling rule for one trigger against one line's current limit.
 *
 * The 2x step cap is the guardrail that keeps the AUTO path from putting an
 * absurd number on screen. It should rarely bind in practice: a signal implying
 * more than a doubling is exactly what the classifier is supposed to route to a
 * human, so hitting this cap on an auto-applied change is a smell worth noticing.
 */
export function computeNewLimit(
  triggerType: TriggerType,
  features: ClassifierFeatures,
  currentLimit: number,
  coverageLine: CoverageLine = TRIGGER_COVERAGE_LINE[triggerType],
): ScalingResult {
  const ceiling = LINE_CEILINGS[coverageLine];
  const floor = Math.max(MIN_COVERAGE_LIMIT, 0);
  const current = Math.max(currentLimit, floor);

  const rawGrowth = growthFromFeatures(triggerType, features);
  const desired = current * (1 + rawGrowth);
  const stepCap = current * MAX_SINGLE_STEP_MULTIPLIER;

  const hardCap = Math.min(stepCap, ceiling);
  const bounded = Math.min(desired, hardCap);

  // Round to the NEAREST $250K, which may legitimately round up past the
  // desired figure — that's what "nearest" means. Only the two hard caps are
  // inviolable, so floor to the increment when rounding would breach one. A
  // displayed limit above the ceiling we just promised to respect is worse than
  // one that's $250K conservative.
  let rounded = roundToIncrement(bounded);
  if (rounded > hardCap) rounded = floorToIncrement(hardCap);

  // Never below where we started. Growth is non-negative by construction, so
  // this only catches rounding on a limit that isn't a clean multiple.
  const newLimit = Math.max(rounded, current, floor);

  return {
    currentLimit: current,
    newLimit,
    rawGrowth,
    cappedByStep: desired > stepCap && stepCap <= ceiling,
    cappedByCeiling: Math.min(desired, stepCap) > ceiling,
    changed: newLimit !== current,
  };
}
