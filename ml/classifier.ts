// Auto-generated port of the scikit-learn logistic regression trained in
// train_classifier.py. Weights come from classifier_weights.json -- if you
// retrain, re-run this generation step (or just paste the new JSON values in).
// No Python runtime needed in the deployed app.

export interface CompanySignals {
  headcountGrowthRatePct: number;
  newHiresThisMonth: number;
  cashInflowSpikeRatio: number;
  dealSizeRatio: number;
}

const FEATURE_ORDER = [
  "headcountGrowthRatePct",
  "newHiresThisMonth",
  "cashInflowSpikeRatio",
  "dealSizeRatio",
] as const;

const MEANS = [8.403860416666667, 3.4610416666666666, 2.8819833333333333, 0.7197187500000001];
const STDS = [10.347157022648773, 5.217652624977113, 31.64628192852554, 1.503756443621031];
const WEIGHTS = [3.0158472695895657, -0.3430068565168067, 10.48300316222987, 2.8274959915063276];
const BIAS = -3.9557773818370983;
const DECISION_THRESHOLD = 0.5;

export const FEATURE_IMPORTANCE: Record<string, number> = {
  cashInflowSpikeRatio: 0.6289,
  headcountGrowthRatePct: 0.1809,
  dealSizeRatio: 0.1696,
  newHiresThisMonth: 0.0206,
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export interface ClassificationResult {
  needsHumanReview: boolean;
  probability: number; // probability that this needs human review
  topDrivingFeature: string; // which signal contributed most, for the "why" explanation
}

export function classify(signals: CompanySignals): ClassificationResult {
  const raw = FEATURE_ORDER.map((key) => signals[key]);
  const standardized = raw.map((x, i) => (x - MEANS[i]) / STDS[i]);
  const z =
    standardized.reduce((sum, x, i) => sum + x * WEIGHTS[i], 0) + BIAS;
  const probability = sigmoid(z);

  // Which feature contributed most to *this specific* prediction (for the
  // explainability layer) -- standardized value * weight, largest magnitude wins.
  const contributions = standardized.map((x, i) => Math.abs(x * WEIGHTS[i]));
  const topIdx = contributions.indexOf(Math.max(...contributions));

  return {
    needsHumanReview: probability >= DECISION_THRESHOLD,
    probability,
    topDrivingFeature: FEATURE_ORDER[topIdx],
  };
}
