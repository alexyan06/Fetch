// Portfolio dashboard — the opening shot.
//
// Server component: reads through the DB layer directly rather than fetching
// its own API over HTTP, so first paint is one round trip instead of two.
// <RealtimeRefresh /> re-runs this on any coverage/activity/approval change.

import Link from "next/link";

import { ActivityFeed } from "@/components/activity-feed";
import { PortfolioTable } from "@/components/portfolio-table";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listPortfolio } from "@/lib/db/queries";
import { getSupabaseServerClient } from "@/lib/supabase";
import { TABLES } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type { ActivityLogEntry } from "@/lib/types";

// Always fresh: a cached dashboard would defeat the entire live-update premise.
export const dynamic = "force-dynamic";

async function recentActivity(limit = 8): Promise<ActivityLogEntry[]> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from(TABLES.activityLog)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ActivityLogEntry[]) ?? [];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default async function PortfolioPage() {
  const [{ companies, totalOpenApprovals }, activity] = await Promise.all([
    listPortfolio(),
    recentActivity(),
  ]);

  const totalCoverage = companies.reduce((sum, c) => sum + c.total_coverage, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Fetch</h1>
            <RealtimeRefresh showIndicator />
          </div>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Coverage that keeps up. Signals from a portfolio&apos;s real systems,
            applied automatically when routine and escalated when not.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/approvals" className={buttonVariants({ variant: "outline" })}>
            Approvals
            {totalOpenApprovals > 0 && ` (${totalOpenApprovals})`}
          </Link>
          <Link href="/demo" className={buttonVariants({ variant: "outline" })}>
            Demo Controls
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Companies" value={String(companies.length)} />
        <Stat label="Total coverage" value={formatLimit(totalCoverage)} />
        <Stat label="Awaiting review" value={String(totalOpenApprovals)} />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Portfolio</h2>
          <p className="text-sm text-muted-foreground">
            Sorted by what needs attention
          </p>
        </div>
        <PortfolioTable companies={companies} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent activity</h2>
        <ActivityFeed entries={activity} />
      </section>
    </main>
  );
}
