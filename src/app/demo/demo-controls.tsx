"use client";

// The Demo Controls form. Monospace and bordered like a dev tool on purpose —
// a judge should never mistake this for something the product does by itself.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COVERAGE_LINE_LABELS, TRIGGER_COVERAGE_LINE, TRIGGER_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type {
  ApiError,
  PortfolioCompany,
  SimulateEventResponse,
  SimulateMagnitude,
  SyncResponse,
  TriggerType,
} from "@/lib/types";

/** Tier 1 triggers only. burn / security_incident are Tier 2 and unemitted. */
const TRIGGERS: TriggerType[] = ["hire", "funding", "contract"];

export interface DemoControlsProps {
  companies: PortfolioCompany[];
}

export function DemoControls({ companies }: DemoControlsProps) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>("hire");
  const [magnitude, setMagnitude] = useState<SimulateMagnitude>("routine");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<SimulateEventResponse | null>(null);

  const realCompanies = companies.filter((c) => c.source === "real");
  const [syncCompanyId, setSyncCompanyId] = useState(realCompanies[0]?.id ?? "");
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResponse | null>(null);

  const company = companies.find((c) => c.id === companyId);

  async function runSync() {
    setSyncBusy(true);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: syncCompanyId }),
      });
      const body = await response.json();

      if (!response.ok) {
        const err = body as ApiError;
        toast.error(err.error ?? "Sync failed", { description: err.detail });
        return;
      }

      const result = body as SyncResponse;
      setLastSync(result);

      const warnings = result.results.flatMap((r) => r.warnings);
      if (result.signal_events_created > 0) {
        toast.success(
          `Sync found ${result.signal_events_created} new signal${result.signal_events_created === 1 ? "" : "s"} — ${result.auto_applied} auto, ${result.pending_created} pending`,
        );
      } else if (warnings.length > 0) {
        toast.info(warnings[0]);
      } else {
        toast.info("Sync ran — no new signals since last sync");
      }

      router.refresh();
    } catch (error) {
      toast.error("Sync failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSyncBusy(false);
    }
  }

  async function fire() {
    setBusy(true);
    try {
      const response = await fetch("/api/simulate-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, triggerType, magnitude }),
      });
      const body = await response.json();

      if (!response.ok) {
        const err = body as ApiError;
        toast.error(err.error ?? "Simulate failed", { description: err.detail });
        return;
      }

      const result = body as SimulateEventResponse;
      setLast(result);

      if (result.decision === "auto" && result.coverage_update) {
        toast.success(
          `AUTO — ${COVERAGE_LINE_LABELS[result.coverage_update.coverage_line]} ${formatLimit(result.coverage_update.old_value)} → ${formatLimit(result.coverage_update.new_value)}`,
        );
      } else if (result.decision === "auto") {
        toast.success("AUTO — logged, but the limit did not move");
      } else {
        toast.info("NEEDS REVIEW — sent to the approvals queue");
      }

      router.refresh();
    } catch (error) {
      toast.error("Simulate failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {realCompanies.length > 0 && (
        <Card className="border-dashed font-mono">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              sync · pull from merge
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Reads whatever Merge currently has for this company&apos;s Linked
              Accounts, diffs it against what we&apos;ve already processed, and
              runs anything new through the same classify → decide → apply path
              as Simulate Event. Force Resync in the Merge dashboard first if
              you just made a change in BambooHR/HubSpot/Zoho — this only reads
              what Merge already has, it doesn&apos;t pull from the source
              platform itself.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">
                real company
              </span>
              <select
                value={syncCompanyId}
                onChange={(e) => setSyncCompanyId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {realCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <Button onClick={runSync} disabled={syncBusy || !syncCompanyId}>
              {syncBusy ? "Syncing…" : "Sync Now"}
            </Button>

            {lastSync && (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
                <p>
                  synced_at {lastSync.synced_at} · signal_events_created{" "}
                  {lastSync.signal_events_created} · auto_applied{" "}
                  {lastSync.auto_applied} · pending_created{" "}
                  {lastSync.pending_created}
                </p>
                {lastSync.results.map((r) => (
                  <div key={r.company_id}>
                    <p className="font-medium">{r.company_name}</p>
                    {r.warnings.map((w, i) => (
                      <p key={i} className="text-muted-foreground">
                        ! {w}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed font-mono">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            simulate-event · dry run
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">company</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.source === "real" ? "  [live via Merge]" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">trigger</span>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as TriggerType)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]} → {COVERAGE_LINE_LABELS[TRIGGER_COVERAGE_LINE[t]]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">magnitude</span>
              <select
                value={magnitude}
                onChange={(e) =>
                  setMagnitude(e.target.value as SimulateMagnitude)
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="routine">routine → expect AUTO</option>
                <option value="large">large → expect NEEDS REVIEW</option>
              </select>
            </label>
          </div>

          <Button onClick={fire} disabled={busy || !companyId}>
            {busy ? "Firing…" : "Fire signal event"}
          </Button>
        </CardContent>
      </Card>

      {last && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Result</CardTitle>
            <Badge
              className={
                last.decision === "auto"
                  ? "bg-emerald-600 text-white hover:bg-emerald-600"
                  : "bg-amber-500 text-amber-950 hover:bg-amber-500"
              }
            >
              {last.decision === "auto" ? "AUTO" : "NEEDS REVIEW"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{last.activity_log_entry.explanation}</p>
            <p className="text-muted-foreground">
              Model probability{" "}
              <span className="tabular-nums">
                {(Math.min(last.classifier_probability, 0.999) * 100).toFixed(1)}%
              </span>{" "}
              · top factor {last.top_driving_feature}
            </p>
            {company && (
              <Link
                href={`/company/${company.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open {company.name}
              </Link>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
