"use client";

// One pending recommendation, with the two buttons that resolve it.
//
// The number shown here is `proposed_limit`, read straight off the row. Approve
// POSTs and the API applies that same stored value with no recomputation — the
// card cannot promise one figure and apply another. That property is the reason
// the audit trail means anything.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { COVERAGE_LINE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type { ApiError, PendingApproval } from "@/lib/types";

export interface ApprovalCardProps {
  approval: PendingApproval;
  /** Shown when the queue lists approvals across the whole portfolio. */
  companyName?: string;
}

export function ApprovalCard({ approval, companyName }: ApprovalCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);

  const current = Number(approval.current_limit);
  const proposed = Number(approval.proposed_limit);

  async function resolve(action: "approve" | "dismiss") {
    setBusy(action);
    try {
      const response = await fetch(`/api/approvals/${approval.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await response.json()) as ApiError;

      if (!response.ok) {
        toast.error(body.error ?? `Could not ${action}`, {
          description: body.detail,
        });
        return;
      }

      toast.success(
        action === "approve"
          ? `${COVERAGE_LINE_LABELS[approval.coverage_line]} raised to ${formatLimit(proposed)}`
          : "Recommendation dismissed — nothing changed",
      );
      // Realtime will also fire, but refreshing here makes the button feel
      // immediate rather than waiting on a round trip through Postgres.
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(`Could not ${action}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || pending;

  return (
    <Card className="border-amber-500/40">
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div className="min-w-0">
          <CardTitle className="text-base">
            {companyName ?? "Recommendation"}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {COVERAGE_LINE_LABELS[approval.coverage_line]} · awaiting review
          </p>
        </div>
        <Badge className="shrink-0 bg-amber-500 text-amber-950 hover:bg-amber-500">
          NEEDS REVIEW
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{approval.recommendation_text}</p>

        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-3">
          <div>
            <div className="text-xs text-muted-foreground">Current</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatLimit(current)}
            </div>
          </div>
          <div className="text-muted-foreground" aria-hidden>
            →
          </div>
          <div>
            <div className="text-xs text-muted-foreground">If approved</div>
            <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatLimit(proposed)}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button onClick={() => resolve("approve")} disabled={disabled}>
          {busy === "approve" ? "Applying…" : `Approve ${formatLimit(proposed)}`}
        </Button>
        <Button
          variant="outline"
          onClick={() => resolve("dismiss")}
          disabled={disabled}
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </Button>
      </CardFooter>
    </Card>
  );
}
