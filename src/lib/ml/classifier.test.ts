import { describe, expect, it } from "vitest";

import { classify, DECISION_THRESHOLD, FEATURE_IMPORTANCE } from "./classifier";
import type { ClassifierFeatures } from "@/lib/types";

describe("classify", () => {
  it("routes a routine hire to the AUTO path", () => {
    // A small company adding one person at a normal pace, no cash spike, a
    // typical-sized deal. Nothing here should ever stop a human.
    const routineHire: ClassifierFeatures = {
      headcountGrowthRatePct: 2,
      newHiresThisMonth: 1,
      cashInflowSpikeRatio: 1.0,
      dealSizeRatio: 0.8,
    };

    const result = classify(routineHire);

    expect(result.needsHumanReview).toBe(false);
    expect(result.probability).toBeLessThan(DECISION_THRESHOLD);
    expect(result.probability).toBeLessThan(0.05);
    expect(result.topDrivingFeature).toBe("headcountGrowthRatePct");
  });

  it("routes a large funding round to the PENDING path", () => {
    // Net inflow ~40x the company's normal month — the funding-round trigger.
    const fundingRound: ClassifierFeatures = {
      headcountGrowthRatePct: 5,
      newHiresThisMonth: 2,
      cashInflowSpikeRatio: 40,
      dealSizeRatio: 0.7,
    };

    const result = classify(fundingRound);

    expect(result.needsHumanReview).toBe(true);
    expect(result.probability).toBeGreaterThanOrEqual(DECISION_THRESHOLD);
    expect(result.probability).toBeGreaterThan(0.95);
    // The cash spike, not headcount, is what should be driving this one.
    expect(result.topDrivingFeature).toBe("cashInflowSpikeRatio");
  });

  it("exposes global importances that sum to ~1", () => {
    const total = Object.values(FEATURE_IMPORTANCE).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
  });
});
