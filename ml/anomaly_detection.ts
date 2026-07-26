// Anomaly detection: flags a metric value as unusual relative to a specific
// company's own recent history, rather than a fixed global threshold. A
// steady-hiring company's normal pace looks different from a slow-growing
// one -- this catches "unusual for THIS company," not "unusual in general."
//
// Deliberately plain z-score / rolling-stats, not isolation forest -- same
// demo effect (highlighted anomalous point on a trend line), no Python
// runtime needed. See 06-ai-ml-features.md.

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  stdDev: number;
}

const DEFAULT_THRESHOLD = 2.0; // |z| >= 2 flags as anomalous (~95% CI)
const MIN_HISTORY_POINTS = 3; // need at least a few points for a meaningful baseline

/**
 * Given a company's prior history for some metric (e.g. monthly headcount,
 * monthly cash inflow) and the latest observed value, flag whether that
 * latest value is unusual relative to that company's own normal pattern.
 *
 * history: prior values only, in chronological order -- do NOT include the
 * latest value itself, or it'll dilute its own anomaly signal.
 */
export function detectAnomaly(
  history: number[],
  latestValue: number,
  threshold: number = DEFAULT_THRESHOLD
): AnomalyResult {
  if (history.length < MIN_HISTORY_POINTS) {
    // Not enough history to judge "normal" yet -- don't flag, don't crash.
    return { isAnomaly: false, zScore: 0, mean: latestValue, stdDev: 0 };
  }

  const mean = history.reduce((sum, x) => sum + x, 0) / history.length;
  const variance =
    history.reduce((sum, x) => sum + (x - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);

  // Avoid div-by-zero when a company's history is perfectly flat.
  const zScore = stdDev === 0 ? (latestValue === mean ? 0 : Infinity) : (latestValue - mean) / stdDev;

  return {
    isAnomaly: Math.abs(zScore) >= threshold,
    zScore,
    mean,
    stdDev,
  };
}