// Ported from ml/anomaly_detection.ts.
//
// Flags a metric value as unusual relative to a specific company's own recent
// history, rather than against a fixed global threshold. A steady-hiring
// company's normal pace looks different from a slow-growing one -- this catches
// "unusual for THIS company," not "unusual in general."
//
// Deliberately plain z-score / rolling-stats, not isolation forest -- same demo
// effect (highlighted anomalous point on a trend line), no Python runtime.
// See docs/06-ai-ml-features.md.

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  /** The history's actual standard deviation — 0 for a perfectly flat series. */
  stdDev: number;
  /** What the z-score was actually divided by, after flooring. */
  effectiveStdDev: number;
}

const DEFAULT_THRESHOLD = 2.0; // |z| >= 2 flags as anomalous (~95% CI)
const MIN_HISTORY_POINTS = 3; // need a few points for a meaningful baseline

/**
 * Standard-deviation floor, as a fraction of |mean|.
 *
 * A perfectly flat history has stdDev 0, which makes any change at all divide
 * by zero -> Infinity -> auto-flagged. Flooring the divisor keeps the z-score
 * finite. It's scaled to the mean rather than a fixed constant because the same
 * detector runs over wildly different units (headcount ~10, cash inflow ~1e6),
 * and a single absolute floor would be meaningless for one of them.
 */
const STD_DEV_FLOOR_FRACTION = 0.01;

/** Absolute backstop for the case where the mean itself is ~0. */
const ABSOLUTE_STD_DEV_FLOOR = 1e-9;

/**
 * Given a company's prior history for some metric (e.g. monthly headcount,
 * monthly cash inflow) and the latest observed value, flag whether that latest
 * value is unusual relative to that company's own normal pattern.
 *
 * history: prior values only, in chronological order -- do NOT include the
 * latest value itself, or it'll dilute its own anomaly signal.
 */
export function detectAnomaly(
  history: number[],
  latestValue: number,
  threshold: number = DEFAULT_THRESHOLD,
): AnomalyResult {
  if (history.length < MIN_HISTORY_POINTS) {
    // Not enough history to judge "normal" yet -- don't flag, don't crash.
    return {
      isAnomaly: false,
      zScore: 0,
      mean: latestValue,
      stdDev: 0,
      effectiveStdDev: 0,
    };
  }

  const mean = history.reduce((sum, x) => sum + x, 0) / history.length;
  const variance =
    history.reduce((sum, x) => sum + (x - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);

  const effectiveStdDev = Math.max(
    stdDev,
    Math.abs(mean) * STD_DEV_FLOOR_FRACTION,
    ABSOLUTE_STD_DEV_FLOOR,
  );

  const zScore = (latestValue - mean) / effectiveStdDev;

  return {
    isAnomaly: Math.abs(zScore) >= threshold,
    zScore,
    mean,
    stdDev,
    effectiveStdDev,
  };
}
