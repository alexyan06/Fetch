import { describe, expect, it } from "vitest";

import {
  LIMIT_ROUNDING_INCREMENT,
  MAX_SINGLE_STEP_MULTIPLIER,
  NEUTRAL_FUNDING_SIGNAL,
} from "@/lib/constants";
import { classify } from "@/lib/ml/classifier";
import type { ClassifierFeatures, SignalEvent } from "@/lib/types";

import { decide } from "./decide";
import {
  BASELINE_FEATURES,
  computeFeatures,
  drivingFeatureFor,
  standingFromHistory,
} from "./features";
import { formatLimit, formatProbability } from "./recommendation";
import { computeNewLimit, growthFromFeatures, LINE_CEILINGS } from "./scaling";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function signalEvent(
  overrides: Partial<SignalEvent> & Pick<SignalEvent, "trigger_type">,
): SignalEvent {
  return {
    id: "evt-1",
    company_id: "co-1",
    raw_payload: { summary: "fixture" },
    classifier_features: { ...BASELINE_FEATURES },
    classifier_probability: 0.1,
    decision: "auto",
    simulated: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* features.ts                                                                */
/* -------------------------------------------------------------------------- */

describe("computeFeatures", () => {
  it("always populates all four features, carrying standing for the ones this trigger did not move", () => {
    // A hire event measures headcount and nothing else. The cash and deal
    // figures must survive from standing rather than being zeroed — a zeroed
    // vector is off-distribution for a model trained on full monthly snapshots.
    const standing: ClassifierFeatures = {
      headcountGrowthRatePct: 4,
      newHiresThisMonth: 2,
      cashInflowSpikeRatio: 9.5,
      dealSizeRatio: 3.2,
    };

    const features = computeFeatures({
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 12, newHiresThisMonth: 6 },
      standing,
    });

    expect(features).toEqual({
      headcountGrowthRatePct: 12,
      newHiresThisMonth: 6,
      cashInflowSpikeRatio: 9.5, // carried
      dealSizeRatio: 3.2, // carried
    });
    // No key is ever absent or NaN.
    for (const value of Object.values(features)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("ignores observed values the trigger has no authority over", () => {
    // A hire event must not be able to rewrite the cash figure, even if a
    // careless caller passes one.
    const features = computeFeatures({
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 10, cashInflowSpikeRatio: 99 },
      standing: { ...BASELINE_FEATURES, cashInflowSpikeRatio: 3.1 },
    });

    expect(features.headcountGrowthRatePct).toBe(10);
    expect(features.cashInflowSpikeRatio).toBe(3.1);
  });

  it("defaults an unobserved company to the 2.88 neutral, not zero", () => {
    expect(BASELINE_FEATURES.cashInflowSpikeRatio).toBe(NEUTRAL_FUNDING_SIGNAL);

    const features = computeFeatures({
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 5, newHiresThisMonth: 1 },
      history: [],
    });

    expect(features.cashInflowSpikeRatio).toBe(NEUTRAL_FUNDING_SIGNAL);
  });
});

describe("standingFromHistory", () => {
  it("takes the newest value per feature, not the newest event wholesale", () => {
    // The funding figure from the older event is still the best thing we know
    // about cash: the newer hire event never measured it. `now` is pinned 31
    // days after the older event -- inside the recency window -- so this test
    // is about "newest per feature", not decay.
    const history: SignalEvent[] = [
      signalEvent({
        id: "old",
        trigger_type: "funding",
        created_at: "2026-01-01T00:00:00.000Z",
        classifier_features: {
          ...BASELINE_FEATURES,
          cashInflowSpikeRatio: 14,
        },
      }),
      signalEvent({
        id: "new",
        trigger_type: "hire",
        created_at: "2026-02-01T00:00:00.000Z",
        classifier_features: {
          ...BASELINE_FEATURES,
          headcountGrowthRatePct: 7,
          newHiresThisMonth: 3,
          cashInflowSpikeRatio: NEUTRAL_FUNDING_SIGNAL,
        },
      }),
    ];

    const now = new Date("2026-02-01T00:00:00.000Z");
    const standing = standingFromHistory(history, now);

    expect(standing.headcountGrowthRatePct).toBe(7);
    expect(standing.newHiresThisMonth).toBe(3);
    expect(standing.cashInflowSpikeRatio).toBe(14);
  });

  it("is order-independent", () => {
    const a = signalEvent({
      id: "a",
      trigger_type: "contract",
      created_at: "2026-01-01T00:00:00.000Z",
      classifier_features: { ...BASELINE_FEATURES, dealSizeRatio: 2 },
    });
    const b = signalEvent({
      id: "b",
      trigger_type: "contract",
      created_at: "2026-03-01T00:00:00.000Z",
      classifier_features: { ...BASELINE_FEATURES, dealSizeRatio: 8 },
    });

    const now = new Date("2026-03-01T00:00:00.000Z");
    expect(standingFromHistory([a, b], now)).toEqual(
      standingFromHistory([b, a], now),
    );
    expect(standingFromHistory([b, a], now).dealSizeRatio).toBe(8);
  });

  it("decays a stale observation back to baseline instead of holding it forever", () => {
    // This is the real-company failure mode found during A6 testing: one
    // large contract kept dealSizeRatio pinned at 10.5x, so every LATER
    // signal -- including plain hires -- scored PENDING on the strength of a
    // feature nothing that month actually measured. 45 days later, it must
    // no longer count as "this month's" deal size.
    const oldDeal = signalEvent({
      id: "old-deal",
      trigger_type: "contract",
      created_at: "2026-01-01T00:00:00.000Z",
      classifier_features: { ...BASELINE_FEATURES, dealSizeRatio: 10.5 },
    });

    const now = new Date("2026-02-15T00:00:00.000Z"); // 45 days later
    const standing = standingFromHistory([oldDeal], now);

    expect(standing.dealSizeRatio).toBe(BASELINE_FEATURES.dealSizeRatio);
  });

  it("still counts an observation inside the recency window", () => {
    const recentDeal = signalEvent({
      id: "recent-deal",
      trigger_type: "contract",
      created_at: "2026-01-01T00:00:00.000Z",
      classifier_features: { ...BASELINE_FEATURES, dealSizeRatio: 10.5 },
    });

    const now = new Date("2026-01-20T00:00:00.000Z"); // 19 days later
    const standing = standingFromHistory([recentDeal], now);

    expect(standing.dealSizeRatio).toBe(10.5);
  });
});

describe("drivingFeatureFor", () => {
  it("maps each Tier 1 trigger to the feature the scaling rule reads", () => {
    expect(drivingFeatureFor("hire")).toBe("headcountGrowthRatePct");
    expect(drivingFeatureFor("funding")).toBe("cashInflowSpikeRatio");
    expect(drivingFeatureFor("contract")).toBe("dealSizeRatio");
  });

  it("returns null for a trigger with no trained feature behind it", () => {
    expect(drivingFeatureFor("security_incident")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* scaling.ts                                                                 */
/* -------------------------------------------------------------------------- */

describe("growthFromFeatures", () => {
  it("maps headcount growth 1:1", () => {
    const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 12 };
    expect(growthFromFeatures("hire", features)).toBeCloseTo(0.12, 10);
  });

  it("contributes nothing when the funding feature sits at the 2.88 neutral", () => {
    // The whole point of the neutral constant: a feature with no data behind it
    // must not argue for a limit change in either direction.
    const features = {
      ...BASELINE_FEATURES,
      cashInflowSpikeRatio: NEUTRAL_FUNDING_SIGNAL,
    };
    expect(growthFromFeatures("funding", features)).toBe(0);
  });

  it("never returns negative growth", () => {
    // Below-normal cash inflow is not a reason to automatically cut somebody's
    // coverage off a single data point.
    const features = { ...BASELINE_FEATURES, cashInflowSpikeRatio: 0.1 };
    expect(growthFromFeatures("funding", features)).toBe(0);

    const smallDeal = { ...BASELINE_FEATURES, dealSizeRatio: 0.2 };
    expect(growthFromFeatures("contract", smallDeal)).toBe(0);
  });

  it("produces no growth for a trigger with no trained feature", () => {
    expect(growthFromFeatures("security_incident", BASELINE_FEATURES)).toBe(0);
  });
});

describe("computeNewLimit", () => {
  it("applies growth and rounds to the nearest $250K", () => {
    // 2,000,000 x 1.12 = 2,240,000 -> nearest 250K = 2,250,000
    const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 12 };
    const result = computeNewLimit("hire", features, 2_000_000);

    expect(result.newLimit).toBe(2_250_000);
    expect(result.newLimit % LIMIT_ROUNDING_INCREMENT).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.cappedByStep).toBe(false);
  });

  it("caps a single step at 2x the current limit", () => {
    // 500% headcount growth would argue for 6x. The step cap binds at 2x.
    const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 500 };
    const result = computeNewLimit("hire", features, 1_000_000);

    expect(result.newLimit).toBe(2_000_000);
    expect(result.newLimit).toBe(1_000_000 * MAX_SINGLE_STEP_MULTIPLIER);
    expect(result.cappedByStep).toBe(true);
    expect(result.rawGrowth).toBeGreaterThan(1);
  });

  it("caps at the line ceiling when the ceiling binds before the 2x step", () => {
    // EPLI ceiling is $5M; 2x of $4M would be $8M.
    const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 300 };
    const result = computeNewLimit("hire", features, 4_000_000);

    expect(result.newLimit).toBe(LINE_CEILINGS.EPLI);
    expect(result.cappedByCeiling).toBe(true);
    expect(result.newLimit).toBeLessThan(4_000_000 * MAX_SINGLE_STEP_MULTIPLIER);
  });

  it("never exceeds the ceiling through rounding", () => {
    // Ceiling is not itself required to be a multiple of the increment, so
    // rounding must floor rather than round up when it would breach it.
    for (const current of [900_000, 1_100_000, 2_600_000, 4_900_000]) {
      const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 400 };
      const result = computeNewLimit("hire", features, current);
      expect(result.newLimit).toBeLessThanOrEqual(LINE_CEILINGS.EPLI);
      expect(result.newLimit).toBeLessThanOrEqual(
        current * MAX_SINGLE_STEP_MULTIPLIER,
      );
    }
  });

  it("reports no change when the line already sits at its ceiling", () => {
    const features = { ...BASELINE_FEATURES, headcountGrowthRatePct: 50 };
    const result = computeNewLimit("hire", features, LINE_CEILINGS.EPLI);

    expect(result.changed).toBe(false);
    expect(result.newLimit).toBe(LINE_CEILINGS.EPLI);
  });

  it("routes each trigger to its own coverage line's ceiling", () => {
    const funding = computeNewLimit(
      "funding",
      { ...BASELINE_FEATURES, cashInflowSpikeRatio: 500 },
      9_000_000,
    );
    expect(funding.newLimit).toBe(LINE_CEILINGS.DO);

    const contract = computeNewLimit(
      "contract",
      { ...BASELINE_FEATURES, dealSizeRatio: 500 },
      9_000_000,
    );
    expect(contract.newLimit).toBe(LINE_CEILINGS.TECH_EO);
  });
});

/* -------------------------------------------------------------------------- */
/* recommendation.ts                                                          */
/* -------------------------------------------------------------------------- */

describe("recommendation copy", () => {
  it("formats limits the way a policy document would", () => {
    expect(formatLimit(2_000_000)).toBe("$2M");
    expect(formatLimit(2_250_000)).toBe("$2.25M");
    expect(formatLimit(750_000)).toBe("$750K");
  });

  it("clamps displayed confidence below 100%", () => {
    // A saturated sigmoid rounds to exactly 1.0. "100%" reads as a fake
    // progress bar; the stored probability stays untouched.
    expect(formatProbability(1)).toBe("99.9%");
    expect(formatProbability(0)).toBe("0.1%");
    expect(formatProbability(0.5)).toBe("50.0%");
  });
});

/* -------------------------------------------------------------------------- */
/* decide.ts — the branch                                                     */
/* -------------------------------------------------------------------------- */

describe("decide", () => {
  it("auto-applies a routine hire and moves the limit", () => {
    // Four people joining a seed-stage company at 15% headcount growth. Well
    // under the 25% the training labels treat as a spike, so it auto-applies —
    // and large enough to clear the $250K rounding granularity, which is what
    // makes the Coverage Panel's old -> new animation actually fire.
    const result = decide({
      companyName: "Northwind Robotics",
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 15, newHiresThisMonth: 4 },
      currentLimit: 1_000_000,
      standing: { ...BASELINE_FEATURES, dealSizeRatio: 0.8 },
    });

    expect(result.decision).toBe("auto");
    expect(result.probability).toBeLessThan(0.5);
    expect(result.coverageLine).toBe("EPLI");

    // 1,000,000 x 1.15 = 1,150,000 -> nearest 250K = 1,250,000
    expect(result.scaling.newLimit).toBe(1_250_000);

    // The AUTO path applies immediately and produces no approval card.
    expect(result.coverageUpdate).not.toBeNull();
    expect(result.coverageUpdate?.old_value).toBe(1_000_000);
    expect(result.coverageUpdate?.new_value).toBe(result.scaling.newLimit);
    expect(result.recommendationText).toBeNull();

    expect(result.explanation).toContain("Northwind Robotics");
    expect(result.explanation).toContain("EPLI");
  });

  it("leaves the limit alone when growth is smaller than the rounding step", () => {
    // A single hire at 2.5% growth on a $2M limit argues for +$50K, a fifth of
    // the $250K increment. It correctly rounds to no change.
    //
    // Worth knowing for the demo: on a $1M limit nothing moves until headcount
    // growth clears ~12.5%, so a one-person hire on a large limit produces a
    // feed entry with no number animation behind it.
    const result = decide({
      companyName: "Northwind Robotics",
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 2.5, newHiresThisMonth: 1 },
      currentLimit: 2_000_000,
    });

    expect(result.decision).toBe("auto");
    expect(result.scaling.rawGrowth).toBeGreaterThan(0);
    expect(result.scaling.newLimit).toBe(2_000_000);
    expect(result.scaling.changed).toBe(false);
    expect(result.coverageUpdate).toBeNull();

    // It must say WHY nothing moved, and not blame a ceiling it isn't near.
    expect(result.scaling.cappedByCeiling).toBe(false);
    expect(result.explanation).toContain("rounding step");
    expect(result.explanation).not.toContain("ceiling");
  });

  it("holds a large funding round for review without applying anything", () => {
    const result = decide({
      companyName: "Harborview Labs",
      triggerType: "funding",
      observation: { cashInflowSpikeRatio: 40 },
      currentLimit: 2_000_000,
    });

    expect(result.decision).toBe("pending");
    expect(result.probability).toBeGreaterThanOrEqual(0.5);
    expect(result.coverageLine).toBe("DO");

    // The PENDING path must apply NOTHING.
    expect(result.coverageUpdate).toBeNull();
    expect(result.recommendationText).not.toBeNull();

    // The card has to name the company, the signal, and the real numbers.
    expect(result.recommendationText).toContain("Harborview Labs");
    expect(result.recommendationText).toContain(formatLimit(2_000_000));
    expect(result.recommendationText).toContain(
      formatLimit(result.scaling.newLimit),
    );
    expect(result.recommendationText).not.toContain("100.0%");
  });

  it("proposes exactly the number the card displays", () => {
    // The single most important invariant: approving must never apply a
    // different figure than the human read. One computation, quoted verbatim.
    const result = decide({
      companyName: "Cascade Manufacturing",
      triggerType: "contract",
      observation: { dealSizeRatio: 10.5 },
      currentLimit: 3_000_000,
    });

    expect(result.decision).toBe("pending");
    expect(result.recommendationText).toContain(
      formatLimit(result.scaling.newLimit),
    );
    // Deterministic: same input, byte-identical output.
    const again = decide({
      companyName: "Cascade Manufacturing",
      triggerType: "contract",
      observation: { dealSizeRatio: 10.5 },
      currentLimit: 3_000_000,
    });
    expect(again.recommendationText).toBe(result.recommendationText);
    expect(again.scaling.newLimit).toBe(result.scaling.newLimit);
  });

  it("lets the 2.88 neutral contribute nothing to the classifier score", () => {
    // Same hire, two vectors differing only in the funding feature. With the
    // neutral value the score should sit essentially where a feature-free
    // prediction would; with 0 it measurably shifts toward auto-approve.
    const base = {
      headcountGrowthRatePct: 6,
      newHiresThisMonth: 2,
      dealSizeRatio: 1.0,
    };

    const neutral = classify({
      ...base,
      cashInflowSpikeRatio: NEUTRAL_FUNDING_SIGNAL,
    });
    const zeroed = classify({ ...base, cashInflowSpikeRatio: 0 });

    // 2.88 is the training mean, so it standardizes to ~0 and its weighted
    // contribution vanishes.
    const standardizedNeutral = (NEUTRAL_FUNDING_SIGNAL - 2.8819833333333333) / 31.64628192852554;
    expect(Math.abs(standardizedNeutral)).toBeLessThan(0.001);

    // Zeroing it is not neutral — it pushes the prediction, which is exactly
    // the bug the constant exists to prevent.
    expect(zeroed.probability).toBeLessThan(neutral.probability);

    // And it must never be the feature driving a hire decision.
    expect(neutral.topDrivingFeature).not.toBe("cashInflowSpikeRatio");
  });

  it("explains rather than updates when the line is already at its ceiling", () => {
    const result = decide({
      companyName: "Bluepeak Logistics",
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 3, newHiresThisMonth: 1 },
      currentLimit: LINE_CEILINGS.EPLI,
    });

    expect(result.decision).toBe("auto");
    expect(result.scaling.changed).toBe(false);
    expect(result.coverageUpdate).toBeNull();
    expect(result.scaling.cappedByCeiling).toBe(true);
    expect(result.explanation).toContain("ceiling");
    expect(result.explanation).toContain("no change was needed");
  });

  it("never writes: the same input mutates nothing it was given", () => {
    const standing: ClassifierFeatures = { ...BASELINE_FEATURES };
    const history: SignalEvent[] = [signalEvent({ trigger_type: "hire" })];
    const snapshotStanding = { ...standing };

    decide({
      companyName: "Test Fixture Co",
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 9, newHiresThisMonth: 4 },
      currentLimit: 1_000_000,
      standing,
      history,
    });

    expect(standing).toEqual(snapshotStanding);
    expect(history).toHaveLength(1);
  });

  it("does not let a stale deal drag an unrelated later hire toward PENDING", () => {
    // End-to-end version of the standingFromHistory decay test above, through
    // the actual branch a caller hits. Without decay, this hire would inherit
    // dealSizeRatio: 10.5 from a 73-day-old contract and saturate to PENDING
    // on a feature nothing this month measured.
    const oldDeal = signalEvent({
      id: "old-deal",
      trigger_type: "contract",
      created_at: "2026-01-01T00:00:00.000Z",
      classifier_features: { ...BASELINE_FEATURES, dealSizeRatio: 10.5 },
    });

    const result = decide({
      companyName: "Northwind Robotics",
      triggerType: "hire",
      observation: { headcountGrowthRatePct: 15, newHiresThisMonth: 4 },
      currentLimit: 1_000_000,
      history: [oldDeal],
      now: new Date("2026-03-15T00:00:00.000Z"), // 73 days after the deal
    });

    expect(result.features.dealSizeRatio).toBe(BASELINE_FEATURES.dealSizeRatio);
    expect(result.decision).toBe("auto");
  });

  it("does not let a full observation vector from an unrelated trigger leak in when standing is passed separately", () => {
    // Pinned to the exact numbers from the confirmed A6 incident: /api/sync
    // used to pass the same full four-feature Merge snapshot as BOTH
    // `observation` and `standing`, so a hire signal on the real company
    // inherited a contract's dealSizeRatio: 10.48 and scored PENDING at
    // p=1.0000 regardless of the hire itself. The fix (src/app/api/sync/
    // route.ts) is to pass the raw vector only as `observation` -- decide()
    // must already drop the keys the trigger doesn't own, which is what this
    // pins down independent of that route.
    const fullMergeSnapshotVector = {
      headcountGrowthRatePct: 8.24,
      newHiresThisMonth: 7,
      cashInflowSpikeRatio: 2.88,
      dealSizeRatio: 10.48, // from an unrelated closed-won deal
    };

    const result = decide({
      companyName: "Copperline Software",
      triggerType: "hire",
      observation: fullMergeSnapshotVector,
      standing: { ...BASELINE_FEATURES }, // cold start, no prior history
      currentLimit: 1_000_000,
    });

    // The hire's own features come through...
    expect(result.features.headcountGrowthRatePct).toBe(8.24);
    expect(result.features.newHiresThisMonth).toBe(7);
    // ...but dealSizeRatio -- not owned by "hire" -- must NOT leak in from the
    // observation. It should reflect standing (baseline here), not 10.48.
    expect(result.features.dealSizeRatio).toBe(BASELINE_FEATURES.dealSizeRatio);
    expect(result.decision).toBe("auto");
  });
});
