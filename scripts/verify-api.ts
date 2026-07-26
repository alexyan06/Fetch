/**
 * A4 verification loop.
 *
 *   npm run dev          (in another terminal)
 *   npx tsx scripts/verify-api.ts
 *
 * Fires real requests at the running app and asserts the right rows land in the
 * right tables with the right tags, reading them back through Supabase rather
 * than trusting the HTTP response. A route that returns 200 while writing
 * nothing is exactly the failure this is here to catch.
 *
 * Cleans up after itself: every row it creates is deleted at the end, so it can
 * run repeatedly against the seeded portfolio without polluting the demo data.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TABLES } from "../src/lib/constants";
import { getSupabaseServerClient } from "../src/lib/supabase";
import type {
  ApproveApprovalResponse,
  CompaniesResponse,
  DismissApprovalResponse,
  SimulateEventResponse,
  SyncResponse,
} from "../src/lib/types";

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`  [${ok ? "OK  " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function heading(text: string): void {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(
      `POST ${path} -> ${response.status}: ${json.error ?? ""} ${json.detail ?? ""}`,
    );
  }
  return json;
}

/* Rows this script created, torn down at the end. */
const created = {
  signalEvents: [] as string[],
  activityLog: [] as string[],
  approvals: [] as string[],
};

async function main(): Promise<void> {
  loadEnvLocal();
  const supabase = getSupabaseServerClient();

  // Reachability first, so a dead dev server produces one clear line rather
  // than five confusing ones.
  try {
    await fetch(`${BASE_URL}/api/companies`);
  } catch {
    console.error(
      `Cannot reach ${BASE_URL}. Start the app with \`npm run dev\` in another terminal.`,
    );
    process.exit(1);
  }

  /* --- GET /api/companies ------------------------------------------------ */
  heading("1. GET /api/companies");
  const portfolioResponse = await fetch(`${BASE_URL}/api/companies`);
  const portfolio = (await portfolioResponse.json()) as CompaniesResponse;

  check("returns 200", portfolioResponse.ok, `status ${portfolioResponse.status}`);
  check(
    "returns the seeded portfolio",
    portfolio.companies.length >= 16,
    `${portfolio.companies.length} companies`,
  );
  const scores = portfolio.companies.map((c) => c.attention_score);
  check(
    "sorted by attention_score descending",
    scores.every((score, i) => i === 0 || scores[i - 1] >= score),
  );
  check(
    "companies with open approvals sort to the top",
    portfolio.companies[0].open_approvals_count > 0 ||
      portfolio.total_open_approvals === 0,
    `top: ${portfolio.companies[0].name} (${portfolio.companies[0].open_approvals_count} open)`,
  );

  const target = portfolio.companies.find((c) => c.open_approvals_count === 0);
  if (!target) throw new Error("No company without open approvals to test against");

  /* --- AUTO path --------------------------------------------------------- */
  heading("2. POST /api/simulate-event — routine hire should AUTO-apply");

  const before = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "EPLI")
    .single();
  const limitBefore = Number(before.data?.current_limit);

  const auto = await post<SimulateEventResponse>("/api/simulate-event", {
    companyId: target.id,
    triggerType: "hire",
    magnitude: "routine",
  });
  created.signalEvents.push(auto.signal_event.id);
  created.activityLog.push(auto.activity_log_entry.id);

  check("decision is auto", auto.decision === "auto", auto.decision);
  check("probability below threshold", auto.classifier_probability < 0.5,
    auto.classifier_probability.toFixed(4));
  check("no approval created", auto.pending_approval === null);
  check("coverage_update returned", auto.coverage_update !== null);

  // Read back rather than trusting the response.
  const after = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "EPLI")
    .single();
  const limitAfter = Number(after.data?.current_limit);

  check(
    "coverage_state actually moved in the database",
    limitAfter > limitBefore,
    `${limitBefore} -> ${limitAfter}`,
  );
  check(
    "database value matches what the API reported",
    limitAfter === auto.coverage_update?.new_value,
  );

  const autoRow = await supabase
    .from(TABLES.activityLog)
    .select("tag, old_value, new_value")
    .eq("id", auto.activity_log_entry.id)
    .single();
  check("activity_log row tagged 'auto'", autoRow.data?.tag === "auto",
    String(autoRow.data?.tag));
  check(
    "activity_log carries the old -> new transition",
    Number(autoRow.data?.old_value) === limitBefore &&
      Number(autoRow.data?.new_value) === limitAfter,
  );

  const eventRow = await supabase
    .from(TABLES.signalEvents)
    .select("simulated, decision, classifier_features")
    .eq("id", auto.signal_event.id)
    .single();
  check("signal_event marked simulated", eventRow.data?.simulated === true);
  check("signal_event decision is auto", eventRow.data?.decision === "auto");
  check(
    "all four features stored",
    Object.keys(eventRow.data?.classifier_features ?? {}).length === 4,
    Object.keys(eventRow.data?.classifier_features ?? {}).join(", "),
  );

  /* --- PENDING path ------------------------------------------------------ */
  heading("3. POST /api/simulate-event — large funding should go PENDING");

  const doBefore = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "DO")
    .single();
  const doLimitBefore = Number(doBefore.data?.current_limit);

  const pending = await post<SimulateEventResponse>("/api/simulate-event", {
    companyId: target.id,
    triggerType: "funding",
    magnitude: "large",
  });
  created.signalEvents.push(pending.signal_event.id);
  created.activityLog.push(pending.activity_log_entry.id);
  if (pending.pending_approval) created.approvals.push(pending.pending_approval.id);

  check("decision is pending", pending.decision === "pending", pending.decision);
  check("approval created", pending.pending_approval !== null);
  check("no coverage_update returned", pending.coverage_update === null);

  const doAfter = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "DO")
    .single();
  check(
    "coverage_state did NOT move — nothing applied without a human",
    Number(doAfter.data?.current_limit) === doLimitBefore,
    `${doLimitBefore} -> ${doAfter.data?.current_limit}`,
  );

  const pendingRow = await supabase
    .from(TABLES.activityLog)
    .select("tag, old_value, new_value")
    .eq("id", pending.activity_log_entry.id)
    .single();
  check("activity_log row tagged 'pending'", pendingRow.data?.tag === "pending",
    String(pendingRow.data?.tag));
  check(
    "activity_log carries no values — nothing changed yet",
    pendingRow.data?.old_value === null && pendingRow.data?.new_value === null,
  );

  /* --- Approve ----------------------------------------------------------- */
  heading("4. POST /api/approvals/[id]/approve — applies EXACTLY the stored number");

  const approvalId = pending.pending_approval!.id;
  const proposed = Number(pending.pending_approval!.proposed_limit);

  const approved = await post<ApproveApprovalResponse>(
    `/api/approvals/${approvalId}/approve`,
  );
  created.activityLog.push(approved.activity_log_entry.id);

  const doApplied = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "DO")
    .single();

  check(
    "applied value equals the card's proposed_limit, exactly",
    Number(doApplied.data?.current_limit) === proposed,
    `proposed ${proposed}, applied ${doApplied.data?.current_limit}`,
  );
  check(
    "API-reported new_value matches too",
    approved.coverage_update.new_value === proposed,
  );
  check("approval status is 'approved'", approved.approval.status === "approved");
  check("approval has resolved_at", approved.approval.resolved_at !== null);

  const approvedRow = await supabase
    .from(TABLES.activityLog)
    .select("tag")
    .eq("id", approved.activity_log_entry.id)
    .single();
  check("activity_log row tagged 'approved'", approvedRow.data?.tag === "approved",
    String(approvedRow.data?.tag));

  // Double-approve must not apply twice.
  const secondResponse = await fetch(
    `${BASE_URL}/api/approvals/${approvalId}/approve`,
    { method: "POST" },
  );
  check(
    "re-approving is rejected with 409, not applied twice",
    secondResponse.status === 409,
    `status ${secondResponse.status}`,
  );

  /* --- Dismiss ----------------------------------------------------------- */
  heading("5. POST /api/approvals/[id]/dismiss — applies nothing");

  const toDismiss = await post<SimulateEventResponse>("/api/simulate-event", {
    companyId: target.id,
    triggerType: "contract",
    magnitude: "large",
  });
  created.signalEvents.push(toDismiss.signal_event.id);
  created.activityLog.push(toDismiss.activity_log_entry.id);
  if (toDismiss.pending_approval) created.approvals.push(toDismiss.pending_approval.id);

  const techEoBefore = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "TECH_EO")
    .single();

  const dismissed = await post<DismissApprovalResponse>(
    `/api/approvals/${toDismiss.pending_approval!.id}/dismiss`,
  );
  created.activityLog.push(dismissed.activity_log_entry.id);

  const techEoAfter = await supabase
    .from(TABLES.coverageState)
    .select("current_limit")
    .eq("company_id", target.id)
    .eq("coverage_line", "TECH_EO")
    .single();

  check("approval status is 'dismissed'", dismissed.approval.status === "dismissed");
  check(
    "coverage_state unchanged by a dismissal",
    Number(techEoAfter.data?.current_limit) ===
      Number(techEoBefore.data?.current_limit),
  );

  const dismissedRow = await supabase
    .from(TABLES.activityLog)
    .select("tag")
    .eq("id", dismissed.activity_log_entry.id)
    .single();
  check("activity_log row tagged 'dismissed'", dismissedRow.data?.tag === "dismissed",
    String(dismissedRow.data?.tag));

  /* --- Guards ------------------------------------------------------------ */
  heading("6. Input validation");

  const notFound = await fetch(`${BASE_URL}/api/simulate-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: "00000000-0000-0000-0000-000000000000",
      triggerType: "hire",
      magnitude: "routine",
    }),
  });
  check("unknown company -> 404", notFound.status === 404, `status ${notFound.status}`);

  const badTrigger = await fetch(`${BASE_URL}/api/simulate-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: target.id,
      triggerType: "nonsense",
      magnitude: "routine",
    }),
  });
  check("unknown triggerType -> 400", badTrigger.status === 400,
    `status ${badTrigger.status}`);

  const liveWrite = await fetch(`${BASE_URL}/api/simulate-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: target.id,
      triggerType: "hire",
      magnitude: "routine",
      mode: "live_write",
    }),
  });
  check(
    "live_write -> 501, refused rather than silently downgraded",
    liveWrite.status === 501,
    `status ${liveWrite.status}`,
  );

  const syntheticSync = await fetch(`${BASE_URL}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: target.id }),
  });
  check(
    "syncing a synthetic company -> 409",
    syntheticSync.status === 409,
    `status ${syntheticSync.status}`,
  );

  /* --- Sync -------------------------------------------------------------- */
  heading("7. POST /api/sync");
  const sync = await post<SyncResponse>("/api/sync", {});
  check("returns 200 with a result envelope", Array.isArray(sync.results));
  if (sync.companies_synced === 0) {
    console.log(
      "  [SKIP] No company with source='real' exists yet, so there is nothing to sync.\n" +
        "         Insert the real Merge-backed company row to exercise this path.",
    );
  } else {
    check("synced the real company", sync.companies_synced >= 1,
      `${sync.companies_synced} synced`);
    for (const r of sync.results) {
      console.log(`         ${r.company_name}: ${r.signal_events_created} events` +
        (r.warnings.length ? ` — ${r.warnings.join("; ")}` : ""));
    }
  }

  /* --- Cleanup ----------------------------------------------------------- */
  heading("8. Cleanup — restoring the demo data");

  await supabase.from(TABLES.activityLog).delete().in("id", created.activityLog);
  await supabase.from(TABLES.pendingApprovals).delete().in("id", created.approvals);
  await supabase.from(TABLES.signalEvents).delete().in("id", created.signalEvents);

  await supabase
    .from(TABLES.coverageState)
    .update({ current_limit: limitBefore })
    .eq("company_id", target.id)
    .eq("coverage_line", "EPLI");
  await supabase
    .from(TABLES.coverageState)
    .update({ current_limit: doLimitBefore })
    .eq("company_id", target.id)
    .eq("coverage_line", "DO");

  console.log(
    `  Removed ${created.activityLog.length} activity rows, ` +
      `${created.approvals.length} approvals, ${created.signalEvents.length} events; ` +
      "coverage limits restored.",
  );

  console.log(
    failures === 0
      ? "\nOK — all API checks passed."
      : `\nFAIL — ${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nverify-api failed:", error);
  process.exit(1);
});
