"use client";

// Recharts line chart of a company's monthly metric history, anomalous points
// (per src/lib/ml/anomaly-detection.ts's detectAnomaly) marked in red. The
// caller runs detectAnomaly over the company's own history and passes the
// result in via `data` — this component only renders it, so it stays usable
// with any metric (headcount, cash inflow, deal size) without change.
//
// Path and props are frozen (AnomalyTrendChartProps in src/lib/types.ts).

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { DotProps } from "recharts";

import { cn } from "@/lib/utils";
import type { AnomalyTrendPoint, AnomalyTrendChartProps } from "@/lib/types";

const DEFAULT_THRESHOLD = 2.0;

/**
 * Accent (normal points/line) is the same categorical slot-1 blue as
 * feature-importance.tsx. The anomaly color reuses the app's existing
 * `--destructive` token rather than inventing a second red — it's already
 * the theme's "critical" role and already light/dark aware.
 */
const ATC_STYLE = `
  .atc-line { stroke: #2a78d6; }
  .atc-dot-normal { fill: #2a78d6; }
  .atc-dot-anomaly { fill: var(--destructive); }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .atc-line,
    :root:not([data-theme="light"]) .atc-dot-normal { stroke: #3987e5; fill: #3987e5; }
  }
  :root[data-theme="dark"] .atc-line,
  .dark .atc-line,
  :root[data-theme="dark"] .atc-dot-normal,
  .dark .atc-dot-normal { stroke: #3987e5; fill: #3987e5; }
`;

function AnomalyDot(props: DotProps & { payload?: AnomalyTrendPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const isAnomaly = payload?.isAnomaly ?? false;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isAnomaly ? 5 : 4}
      className={isAnomaly ? "atc-dot-anomaly" : "atc-dot-normal"}
      stroke="var(--background)"
      strokeWidth={2}
    />
  );
}

function AnomalyTooltip({
  active,
  payload,
  threshold,
}: TooltipContentProps & { threshold: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as AnomalyTrendPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-popover-foreground">
        {point.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </div>
      <div className="text-muted-foreground">{point.label}</div>
      {point.isAnomaly && (
        <div className="mt-1 flex items-center gap-1 text-destructive">
          <span aria-hidden className="inline-block size-1.5 rounded-full bg-destructive" />
          Anomaly{point.zScore != null ? ` — |z| ${Math.abs(point.zScore).toFixed(1)}` : ""}
          {` (≥ ${threshold})`}
        </div>
      )}
    </div>
  );
}

/**
 * Trend line for one metric over a company's own history, with points the
 * anomaly detector flagged as unusual (relative to that company's normal
 * range, not a global cutoff) marked in red. Never relies on color alone —
 * the caption and tooltip both name the threshold and label anomalies as
 * text, not just a colored dot.
 */
export function AnomalyTrendChart({
  data,
  metricLabel,
  threshold = DEFAULT_THRESHOLD,
  className,
}: AnomalyTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Not enough history for {metricLabel} yet.
      </p>
    );
  }

  const anomalyCount = data.filter((d) => d.isAnomaly).length;

  return (
    <div className={cn("w-full", className)}>
      <style>{ATC_STYLE}</style>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{metricLabel}</span>
        {anomalyCount > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-destructive" />
            {anomalyCount} anomal{anomalyCount === 1 ? "y" : "ies"} (|z| &ge; {threshold})
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid
            strokeDasharray="0"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) =>
              Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`
            }
          />
          <Tooltip
            content={(props) => <AnomalyTooltip {...props} threshold={threshold} />}
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            className="atc-line"
            strokeWidth={2}
            dot={<AnomalyDot />}
            activeDot={<AnomalyDot />}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default AnomalyTrendChart;
