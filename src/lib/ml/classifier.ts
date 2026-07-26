// Ported from ml/classifier.ts — the scikit-learn logistic regression trained
// in ml/train_classifier.py. Weights come from ml/classifier_weights.json; if
// you retrain, re-copy the numbers below. No Python runtime in the deployed app.
//
// This is the real trained model, not an LLM call. Keep that distinction clear.

import type { ClassifierFeatureName, ClassifierFeatures } from "@/lib/types";

/** Kept as an alias so the original ml/ naming still resolves. */
export type CompanySignals = ClassifierFeatures;

const FEATURE_ORDER: readonly ClassifierFeatureName[] = [
  "headcountGrowthRatePct",
  "newHiresThisMonth",
  "cashInflowSpikeRatio",
  "dealSizeRatio",
] as const;

const MEANS = [
  8.403860416666667, 3.4610416666666666, 2.8819833333333333, 0.7197187500000001,
];
const STDS = [
  10.347157022648773, 5.217652624977113, 31.64628192852554, 1.503756443621031,
];
const WEIGHTS = [
  3.0158472695895657, -0.3430068565168067, 10.48300316222987,
  2.8274959915063276,
];
const BIAS = -3.9557773818370983;

export const DECISION_THRESHOLD = 0.5;

/** Global feature importances from the trained model — the bar chart's data. */
export const FEATURE_IMPORTANCE: Record<ClassifierFeatureName, number> = {
  cashInflowSpikeRatio: 0.6289,
  headcountGrowthRatePct: 0.1809,
  dealSizeRatio: 0.1696,
  newHiresThisMonth: 0.0206,
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export interface ClassificationResult {
  /** True => route to the Pending Approvals queue instead of auto-applying. */
  needsHumanReview: boolean;
  /** Probability that this signal needs human review. */
  probability: number;
  /** Which signal contributed most to *this* prediction, for the "why" copy. */
  topDrivingFeature: ClassifierFeatureName;
}

export function classify(signals: CompanySignals): ClassificationResult {
  const raw = FEATURE_ORDER.map((key) => signals[key]);
  const standardized = raw.map((x, i) => (x - MEANS[i]) / STDS[i]);
  const z = standardized.reduce((sum, x, i) => sum + x * WEIGHTS[i], 0) + BIAS;
  const probability = sigmoid(z);

  // Per-prediction attribution: standardized value * weight, largest magnitude
  // wins. Distinct from FEATURE_IMPORTANCE, which is global to the model.
  const contributions = standardized.map((x, i) => Math.abs(x * WEIGHTS[i]));
  const topIdx = contributions.indexOf(Math.max(...contributions));

  return {
    needsHumanReview: probability >= DECISION_THRESHOLD,
    probability,
    topDrivingFeature: FEATURE_ORDER[topIdx],
  };
}
