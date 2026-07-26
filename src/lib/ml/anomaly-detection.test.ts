import { describe, expect, it } from "vitest";

import { detectAnomaly } from "./anomaly-detection";

describe("detectAnomaly", () => {
  it("does not flag anything without enough history", () => {
    const result = detectAnomaly([5, 5], 500);
    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBe(0);
  });

  it("flags a value far outside a company's own normal range", () => {
    const result = detectAnomaly([10, 12, 11, 13, 10], 40);
    expect(result.isAnomaly).toBe(true);
    expect(result.zScore).toBeGreaterThan(2);
  });

  it("leaves a normal value alone", () => {
    const result = detectAnomaly([10, 12, 11, 13, 10], 12);
    expect(result.isAnomaly).toBe(false);
  });

  it("keeps the z-score finite when the history is perfectly flat", () => {
    // stdDev is 0 here. Before the floor this divided by zero and produced
    // Infinity, which auto-flagged every change on a flat series.
    const result = detectAnomaly([5, 5, 5, 5], 8);

    expect(result.stdDev).toBe(0);
    expect(Number.isFinite(result.zScore)).toBe(true);
    expect(result.effectiveStdDev).toBeGreaterThan(0);
    // Still a genuine anomaly — a flat series that suddenly moves is unusual —
    // it just gets a real number instead of Infinity.
    expect(result.isAnomaly).toBe(true);
  });

  it("returns z = 0 when a flat history stays flat", () => {
    const result = detectAnomaly([5, 5, 5, 5], 5);
    expect(result.zScore).toBe(0);
    expect(result.isAnomaly).toBe(false);
  });

  it("keeps the z-score finite for a flat history sitting at zero", () => {
    const result = detectAnomaly([0, 0, 0, 0], 0.5);
    expect(Number.isFinite(result.zScore)).toBe(true);
  });
});
