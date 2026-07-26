"use client";

// Recharts horizontal bar chart of the trained classifier's global feature
// importances (ml/classifier_weights.json, ported into
// src/lib/ml/classifier.ts as FEATURE_IMPORTANCE). This is the visual proof
// the model is real, not an LLM call dressed up as ML — keep it honest about
// global vs. per-prediction (see the comment on `highlightFeature` below).
//
// Path and props are frozen (FeatureImportanceChartProps in src/lib/types.ts).

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { cn } from "@/lib/utils";
import type { FeatureImportanceChartProps, FeatureImportanceDatum } from "@/lib/types";

/**
 * The two color roles this chart needs beyond the app's existing grayscale
 * --chart-1..5 tokens: one accent hue (emphasis / sequential) and nothing
 * else — anomaly-trend.tsx reuses --destructive for its "critical" role, but
 * a ranked bar chart has no status dimension, so only the accent is new.
 * Declared locally (not in globals.css) since this file owns its own styling
 * per Lane B's file ownership. Light/dark values from the dataviz palette's
 * categorical slot 1 ("blue"), validated for CVD-safe contrast against the
 * chart-3 gray used for de-emphasized bars.
 */
const FIC_STYLE = `
  .fic-bar-accent { fill: #2a78d6; }
  .fic-bar-muted { fill: var(--chart-3); }
  .fic-label { fill: var(--muted-foreground); font-size: 11px; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .fic-bar-accent { fill: #3987e5; }
  }
  :root[data-theme="dark"] .fic-bar-accent,
  .dark .fic-bar-accent { fill: #3987e5; }
`;

function FeatureImportanceTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as FeatureImportanceDatum | undefined;
  if (!row) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-popover-foreground">
        {(row.importance * 100).toFixed(1)}%
      </div>
      <div className="text-muted-foreground">{row.label}</div>
    </div>
  );
}

/**
 * Global importances, with the feature that drove *one* decision highlighted
 * in the accent hue and the rest in gray (the "emphasis" form — the honest
 * way to say "this is what mattered globally, and here's what mattered here"
 * without implying the whole ranking is about this one prediction). With no
 * `highlightFeature`, every bar reads as the accent hue: there is nothing to
 * single out, so this is a plain magnitude comparison instead.
 */
export function FeatureImportanceChart({
  data,
  highlightFeature,
  className,
}: FeatureImportanceChartProps) {
  const rows = [...data].sort((a, b) => b.importance - a.importance);

  if (rows.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No feature importance data.
      </p>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <style>{FIC_STYLE}</style>
      <ResponsiveContainer width="100%" height={Math.max(rows.length * 40, 140)}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 4 }}
          barCategoryGap={12}
        >
          <XAxis
            type="number"
            domain={[0, (max: number) => Math.max(0.5, Math.ceil(max * 10) / 10)]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={168}
            interval={0}
            tick={{ fontSize: 12, fill: "var(--foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <Tooltip content={FeatureImportanceTooltip} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="importance" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.feature}
                className={
                  highlightFeature == null || row.feature === highlightFeature
                    ? "fic-bar-accent"
                    : "fic-bar-muted"
                }
              />
            ))}
            <LabelList
              dataKey="importance"
              position="right"
              className="fic-label"
              formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default FeatureImportanceChart;
