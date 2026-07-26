// Company detail — Coverage Panel, Activity Feed, and the two ML charts.
//
// This page is where the product's claim gets inspected: the panel shows what
// the limits ARE, the feed shows how each one got there, and the charts show
// what the model weighed. All three read the same rows.

import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/activity-feed";
import { ApprovalCard } from "@/components/approval-card";
import { CoveragePanel } from "@/components/coverage-panel";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { AnomalyTrendChart } from "@/components/charts/anomaly-trend";
import { FeatureImportanceChart } from "@/components/charts/feature-importance";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FEATURE_LABELS,
  STAGE_PACKAGE_LABELS,
} from "@/lib/constants";
import {
  getCompany,
  listActivityLog,
  listCoverageState,
  listOpenApprovals,
  listRecentSignalEvents,
} from "@/lib/db/queries";
import { FEATURE_IMPORTANCE } from "@/lib/ml/classifier";
import { detectAnomaly } from "@/lib/ml/anomaly-detection";
import type {
  AnomalyTrendPoint,
  ClassifierFeatureName,
  FeatureImportanceDatum,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/** Global model importances — the same numbers for every company, by design. */
const IMPORTANCE_DATA: FeatureImportanceDatum[] = (
  Object.keys(FEATURE_IMPORTANCE) as ClassifierFeatureName[]
)
  .map((feature) => ({
    feature,
    label: FEATURE_LABELS[feature],
    importance: FEATURE_IMPORTANCE[feature],
  }))
  .sort((a, b) => b.importance - a.importance);

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const company = await getCompany(id);
  if (!company) notFound();

  const [coverage, activity, approvals, events] = await Promise.all([
    listCoverageState(company.id),
    listActivityLog(company.id, 30),
    listOpenApprovals(company.id),
    listRecentSignalEvents(company.id, 24),
  ]);

  // Oldest-first for the trend line. Each point is scored against only the
  // points BEFORE it — including a value in its own baseline would dilute the
  // very anomaly we're trying to surface.
  const chronological = [...events].reverse();
  const headcountSeries = chronological.map((event) =>
    Number(event.classifier_features?.headcountGrowthRatePct ?? 0),
  );

  const trendData: AnomalyTrendPoint[] = chronological.map((event, index) => {
    const value = headcountSeries[index];
    const prior = headcountSeries.slice(0, index);
    const result = detectAnomaly(prior, value);
    return {
      label: new Date(event.created_at).toLocaleDateString("en-US", {
        month: "short",
      }),
      value,
      isAnomaly: result.isAnomaly,
      zScore: result.zScore,
    };
  });

  // The feature that drove the most recent decision, highlighted in the bar
  // chart. Honest about the distinction: the bars are global importances, the
  // highlight is per-prediction.
  const latest = events[0];
  const highlight = latest
    ? ((Object.keys(latest.classifier_features ?? {}) as ClassifierFeatureName[])
        .sort(
          (a, b) => FEATURE_IMPORTANCE[b] - FEATURE_IMPORTANCE[a],
        )[0] ?? null)
    : null;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <header className="space-y-3">
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          ← Portfolio
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {company.name}
            </h1>
            {company.source === "real" && (
              <Badge variant="secondary">Live via Merge</Badge>
            )}
            <RealtimeRefresh companyId={company.id} showIndicator />
          </div>
          <span className="text-sm text-muted-foreground">
            {STAGE_PACKAGE_LABELS[company.stage]}
          </span>
        </div>
      </header>

      {approvals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">
            Awaiting review ({approvals.length})
          </h2>
          <div className="grid gap-4">
            {approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                companyName={company.name}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <CoveragePanel coverage={coverage} stage={company.stage} />
        <ActivityFeed entries={activity} limit={12} />
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What the model weighs</CardTitle>
            <p className="text-sm text-muted-foreground">
              Global feature importances from the trained classifier
              {highlight
                ? `. Highlighted: what drove the most recent decision.`
                : "."}
            </p>
          </CardHeader>
          <CardContent>
            <FeatureImportanceChart
              data={IMPORTANCE_DATA}
              highlightFeature={highlight}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Headcount growth</CardTitle>
            <p className="text-sm text-muted-foreground">
              Month over month, with unusual points flagged.
            </p>
          </CardHeader>
          <CardContent>
            {trendData.length >= 3 ? (
              <AnomalyTrendChart
                data={trendData}
                metricLabel="Headcount growth %"
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Not enough history yet — the detector needs at least three prior
                months before it can call anything unusual.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
