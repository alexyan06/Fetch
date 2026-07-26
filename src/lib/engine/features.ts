// Feature assembly — an event plus the company's recent history becomes the
// four-feature vector the trained classifier consumes.
//
// The rule that matters: ALL FOUR FEATURES ARE ALWAYS POPULATED. Every row the
// model was trained on (ml/generate_training_data.py) was a monthly snapshot of
// a whole company, with headcount, cash, and deal figures all present. Serving
// it a vector where the three features this trigger didn't move are zeroed puts
// the input off-distribution — and because the model standardizes before
// scoring, a zero isn't "no information", it's an assertion that the company is
// well below average on that axis. A hire event would then quietly argue the
// company had no deals and no cash inflow.
//
// So: whichever feature this trigger actually moved gets the observed value,
// and the rest carry the company's current standing.
//
// Pure functions, zero I/O.

import { NEUTRAL_FUNDING_SIGNAL } from "@/lib/constants";
import type {
  ClassifierFeatureName,
  ClassifierFeatures,
  SignalEvent,
  TriggerType,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Which trigger moves which feature                                          */
/* -------------------------------------------------------------------------- */

/**
 * A trigger only has authority over the features its own data source can
 * actually speak to. A hire tells us nothing about deal sizes, so it doesn't get
 * to overwrite `dealSizeRatio`.
 *
 * `security_incident` owns nothing: it's a Tier 2 ticketing signal, and none of
 * the four trained features describe it. It rides entirely on standing values,
 * which is the honest representation — the model has no feature for it.
 */
export const TRIGGER_OWNED_FEATURES: Record<
  TriggerType,
  readonly ClassifierFeatureName[]
> = {
  hire: ["headcountGrowthRatePct", "newHiresThisMonth"],
  funding: ["cashInflowSpikeRatio"],
  contract: ["dealSizeRatio"],
  burn: ["cashInflowSpikeRatio"],
  security_incident: [],
};

/**
 * What a company looks like before any signal has been observed.
 *
 * `cashInflowSpikeRatio` starts at the training mean rather than 0 for the same
 * reason the real Merge company pins it there: 2.88 standardizes to ~0 and
 * contributes nothing, while 0 standardizes to -0.09 and hands the model a
 * -0.95 push toward auto-approve on the strength of a number nobody measured.
 * The other three are genuinely zero at rest — no hires is a real observation of
 * zero hires, not an absence of data.
 */
export const BASELINE_FEATURES: ClassifierFeatures = {
  headcountGrowthRatePct: 0,
  newHiresThisMonth: 0,
  cashInflowSpikeRatio: NEUTRAL_FUNDING_SIGNAL,
  dealSizeRatio: 0,
};

/* -------------------------------------------------------------------------- */
/* Standing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A company's current standing: the most recent value observed for each
 * feature, taken independently per feature.
 *
 * Per-feature rather than "the latest event's whole vector" on purpose. If the
 * newest event is a hire and the one before it was a funding round, the funding
 * figure from two events ago is still the best thing we know about this
 * company's cash — the hire event didn't measure cash, it just carried the
 * standing value forward. Taking the newest vector wholesale would work here
 * too, but it degrades as soon as an event carries a stale copy.
 *
 * @param history Recent events for one company, any order. Newest wins.
 */
export function standingFromHistory(
  history: readonly SignalEvent[],
): ClassifierFeatures {
  const sorted = [...history].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );

  const standing: ClassifierFeatures = { ...BASELINE_FEATURES };

  for (const event of sorted) {
    const features = event.classifier_features;
    if (!features) continue;
    for (const name of TRIGGER_OWNED_FEATURES[event.trigger_type]) {
      const value = features[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        standing[name] = value;
      }
    }
  }

  return standing;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

/** What this event actually measured. Only the trigger's own features apply. */
export type FeatureObservation = Partial<ClassifierFeatures>;

export interface ComputeFeaturesInput {
  triggerType: TriggerType;
  /** The values this event measured. Keys outside the trigger's scope ignored. */
  observation: FeatureObservation;
  /** Prior events for this company. Empty is fine — baseline applies. */
  history?: readonly SignalEvent[];
  /**
   * Pre-computed standing, when the caller already has it (the Merge sync
   * derives all four from one snapshot). Takes precedence over `history`.
   */
  standing?: ClassifierFeatures;
}

/**
 * Merge an observation onto the company's standing, producing a complete vector.
 *
 * Observed keys the trigger has no authority over are dropped rather than
 * applied — that's what keeps a hire event from silently rewriting the cash
 * figure, and it means a caller passing a full four-feature snapshot still gets
 * correct per-trigger attribution.
 */
export function computeFeatures(
  input: ComputeFeaturesInput,
): ClassifierFeatures {
  const standing =
    input.standing ?? standingFromHistory(input.history ?? []);

  const features: ClassifierFeatures = { ...standing };

  for (const name of TRIGGER_OWNED_FEATURES[input.triggerType]) {
    const observed = input.observation[name];
    // Silently keeping standing when the observation is missing is deliberate:
    // a caller that couldn't measure the feature gets the company's last known
    // value, which is a better estimate than any placeholder.
    if (typeof observed === "number" && Number.isFinite(observed)) {
      features[name] = observed;
    }
  }

  return features;
}

/**
 * The feature a trigger is primarily judged on — the one the scaling rule reads
 * its growth from, and the one the recommendation text quotes.
 *
 * Distinct from the classifier's `topDrivingFeature`, which is whichever feature
 * moved *this particular prediction* most and can legitimately be a different
 * one. Keeping them separate is what lets the UI say "we raised EPLI because
 * headcount grew 12%" while also honestly reporting "the cash spike is what made
 * this need review."
 */
export function drivingFeatureFor(
  triggerType: TriggerType,
): ClassifierFeatureName | null {
  return TRIGGER_OWNED_FEATURES[triggerType][0] ?? null;
}
