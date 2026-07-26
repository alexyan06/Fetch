import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { detectAnomaly } from "@/lib/ml/anomaly-detection";
import type { AnomalyTrendPoint } from "@/lib/types";

import { AnomalyTrendChart } from "./anomaly-trend";

// vitest.config.ts doesn't set test.globals, so testing-library's automatic
// afterEach(cleanup) never registers — without this, each test's render
// stays mounted and later queries can match a previous test's DOM.
afterEach(cleanup);

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 600, height: 220, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A steady company with one month of runaway cash inflow — the exact shape
 * detectAnomaly exists to catch, built the way a real caller would: run the
 * detector over prior history, then attach its verdict to each point. */
function buildFixture(): AnomalyTrendPoint[] {
  const monthly = [12000, 11500, 12800, 11900, 12200, 95000, 12100, 12400, 11800, 12300, 12000, 12600];
  const points: AnomalyTrendPoint[] = [];
  for (let i = 0; i < monthly.length; i++) {
    const history = monthly.slice(0, i);
    const result = detectAnomaly(history, monthly[i]);
    points.push({
      label: MONTHS[i],
      value: monthly[i],
      isAnomaly: result.isAnomaly,
      zScore: result.zScore,
    });
  }
  return points;
}

describe("AnomalyTrendChart", () => {
  it("flags the spike month and renders the metric label", () => {
    const data = buildFixture();
    expect(data.some((d) => d.isAnomaly)).toBe(true);

    render(<AnomalyTrendChart data={data} metricLabel="Monthly cash inflow" />);

    expect(screen.getByText("Monthly cash inflow")).toBeInTheDocument();
    expect(screen.getByText(/anomal/i)).toBeInTheDocument();
  });

  it("renders an empty state without enough history", () => {
    render(<AnomalyTrendChart data={[]} metricLabel="Headcount" />);
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
  });

  it("renders cleanly with no anomalies at all", () => {
    const flat: AnomalyTrendPoint[] = MONTHS.map((label) => ({
      label,
      value: 10,
      isAnomaly: false,
    }));
    render(<AnomalyTrendChart data={flat} metricLabel="Headcount" />);
    expect(screen.getByText("Headcount")).toBeInTheDocument();
    expect(screen.queryByText(/anomal/i)).not.toBeInTheDocument();
  });
});
