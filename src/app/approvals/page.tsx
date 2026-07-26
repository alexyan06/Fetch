// The Pending Approvals queue — everything the system declined to do alone.
//
// An empty queue is a good state, not a broken page, so it says so.

import Link from "next/link";

import { ApprovalCard } from "@/components/approval-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listOpenApprovals } from "@/lib/db/queries";
import { getSupabaseServerClient } from "@/lib/supabase";
import { TABLES } from "@/lib/constants";
import type { Company } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const approvals = await listOpenApprovals();

  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from(TABLES.companies).select("id, name");
  const names = new Map(
    ((data as Pick<Company, "id" | "name">[]) ?? []).map((c) => [c.id, c.name]),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <header className="space-y-3">
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          ← Portfolio
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Awaiting review
            </h1>
            <p className="mt-1 text-muted-foreground">
              Changes the system judged too large to apply on its own.
            </p>
          </div>
          <RealtimeRefresh showIndicator />
        </div>
      </header>

      {approvals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Nothing waiting on you</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every signal so far was routine enough to apply automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              companyName={names.get(approval.company_id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}
