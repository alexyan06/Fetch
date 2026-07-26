"use client";

// STUB — Lane B fills this in with a Recharts horizontal bar chart.
// Path and props are frozen (FeatureImportanceChartProps in src/lib/types.ts).
//
// Data source: FEATURE_IMPORTANCE in src/lib/ml/classifier.ts — the real
// trained model's global importances. `highlightFeature` marks which feature
// drove one specific prediction; keep that distinction visible in the UI, it's
// the honest version of the explainability claim.

import type { FeatureImportanceChartProps } from "@/lib/types";

export function FeatureImportanceChart(props: FeatureImportanceChartProps) {
  void props;
  return null;
}

export default FeatureImportanceChart;
