"use client";

// The portfolio dashboard's table. This is the opening shot of the demo, and
// its job is to frame the problem as operational rather than as a toy: 17
// companies, sorted so the ones needing a human are already at the top.
//
// The sort comes from the server (attention_score). This renders it as given.

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STAGE_PACKAGE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import { cn } from "@/lib/utils";
import type { ActivityTag, PortfolioCompany } from "@/lib/types";

const TAG_LABELS: Record<ActivityTag, string> = {
  auto: "Auto-updated",
  pending: "Awaiting review",
  approved: "Approved",
  dismissed: "Dismissed",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return "—";

  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export interface PortfolioTableProps {
  companies: PortfolioCompany[];
}

export function PortfolioTable({ companies }: PortfolioTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[220px]">Company</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Total coverage</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead className="text-right">Needs attention</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => {
            const needsAttention = company.open_approvals_count > 0;
            return (
              <TableRow
                key={company.id}
                className={cn(needsAttention && "bg-amber-500/5")}
              >
                <TableCell>
                  <Link
                    href={`/company/${company.id}`}
                    className="font-medium hover:underline"
                  >
                    {company.name}
                  </Link>
                  {/* Only the real company is labelled. The other 16 are NOT
                      marked synthetic — that would point the eye at the
                      weakness instead of the strength. */}
                  {company.source === "real" && (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      Live via Merge
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {STAGE_PACKAGE_LABELS[company.stage]}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatLimit(company.total_coverage)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {company.last_activity_tag
                    ? `${TAG_LABELS[company.last_activity_tag]} · ${relativeTime(company.last_activity_at)}`
                    : relativeTime(company.last_activity_at)}
                </TableCell>
                <TableCell className="text-right">
                  {needsAttention ? (
                    <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-500">
                      {company.open_approvals_count} to review
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
