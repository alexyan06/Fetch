import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FEATURE_IMPORTANCE } from "@/lib/ml/classifier";
import { FEATURE_LABELS } from "@/lib/constants";
import type { FeatureImportanceDatum } from "@/lib/types";

import { FeatureImportanceChart } from "./feature-importance";

// vitest.config.ts doesn't set test.globals, so testing-library's automatic
// afterEach(cleanup) never registers — without this, each test's render
// stays mounted and later queries can match a previous test's DOM.
afterEach(cleanup);

// jsdom has no layout engine, so Recharts' ResponsiveContainer (which sizes
// itself off ResizeObserver + getBoundingClientRect) sees a 0x0 box and
// renders nothing. Give it a fixed size so the chart body actually mounts.
beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 600, height: 300, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

// The real global importances (ml/classifier_weights.json), as any caller
// building `data` for this chart would.
const FIXTURE: FeatureImportanceDatum[] = (
  Object.entries(FEATURE_IMPORTANCE) as [keyof typeof FEATURE_IMPORTANCE, number][]
).map(([feature, importance]) => ({
  feature,
  label: FEATURE_LABELS[feature],
  importance,
}));

describe("FeatureImportanceChart", () => {
  it("renders every feature's label and percentage", () => {
    // Recharts' category-axis Text wraps long labels across several <tspan>
    // lines, so "Cash inflow spike" never sits in one text node — compare
    // against the whole render's text with whitespace stripped instead.
    const { container } = render(<FeatureImportanceChart data={FIXTURE} />);
    const flat = container.textContent!.replace(/\s+/g, "");

    for (const feature of Object.keys(FEATURE_IMPORTANCE) as (keyof typeof FEATURE_IMPORTANCE)[]) {
      expect(flat).toContain(FEATURE_LABELS[feature].replace(/\s+/g, ""));
    }
    expect(flat).toContain("62.9%");
    expect(flat).toContain("18.1%");
    expect(flat).toContain("17.0%");
    expect(flat).toContain("2.1%");
  });

  it("renders an empty state instead of an empty chart", () => {
    render(<FeatureImportanceChart data={[]} />);
    expect(screen.getByText(/no feature importance data/i)).toBeInTheDocument();
  });

  it("still renders with a highlightFeature set", () => {
    const { container } = render(
      <FeatureImportanceChart data={FIXTURE} highlightFeature="cashInflowSpikeRatio" />,
    );
    expect(container.textContent!.replace(/\s+/g, "")).toContain("Cashinflowspike");
  });
});
