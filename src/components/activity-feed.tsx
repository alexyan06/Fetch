"use client";

// The Activity Feed — the audit trail, rendered.
//
// Every entry says what changed and why in plain language, tagged with how the
// decision was made. The AUTO / PENDING distinction being visible on every row
// is the point: it's what shows the system knows the difference between a
// change it may make alone and one it may not.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COVERAGE_LINE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import { cn } from "@/lib/utils";
import type { ActivityLogEntry, ActivityTag } from "@/lib/types";

const TAG_STYLES: Record<ActivityTag, { label: string; className: string }> = {
  auto: {
    label: "AUTO",
    className: "bg-emerald-600 text-white hover:bg-emerald-600",
  },
  pending: {
    label: "NEEDS REVIEW",
    className: "bg-amber-500 text-amber-950 hover:bg-amber-500",
  },
  approved: {
    label: "APPROVED",
    className: "bg-sky-600 text-white hover:bg-sky-600",
  },
  dismissed: {
    label: "DISMISSED",
    className: "bg-muted text-muted-foreground hover:bg-muted",
  },
};

function timestamp(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export interface ActivityFeedProps {
  entries: ActivityLogEntry[];
  /** Cap the list. The company view shows more than the portfolio glance. */
  limit?: number;
}

export function ActivityFeed({ entries, limit }: ActivityFeedProps) {
  const shown = limit ? entries.slice(0, limit) : entries;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activity yet. Fire a signal from Demo Controls to see one land.
          </p>
        ) : (
          <ol className="space-y-3">
            {shown.map((entry) => {
              const tag = TAG_STYLES[entry.tag];
              const moved =
                entry.old_value !== null && entry.new_value !== null;
              return (
                <li
                  key={entry.id}
                  className="flex gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <Badge className={cn("mt-0.5 shrink-0", tag.className)}>
                    {tag.label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{entry.explanation}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{timestamp(entry.created_at)}</span>
                      {entry.coverage_line && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{COVERAGE_LINE_LABELS[entry.coverage_line]}</span>
                        </>
                      )}
                      {moved && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="tabular-nums">
                            {formatLimit(Number(entry.old_value))} →{" "}
                            {formatLimit(Number(entry.new_value))}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
