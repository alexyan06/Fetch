/**
 * Round-trip verification for the one unproven path: does a CHANGE in a
 * Merge-connected source system flow through `POST /api/sync` and write rows
 * to Supabase?
 *
 *   npx tsx scripts/verify-sync-roundtrip.ts <mode>
 *
 * FINDINGS (2026-07-26, against the live sandbox):
 *   - Force resync via API: NOT POSSIBLE. Merge returns HTTP 400 "Test accounts
 *     cannot be resynced via the Merge API, only via the app.merge.dev". This is
 *     a Test-Linked-Account restriction, not a plan restriction. Demo day needs a
 *     human in the Merge dashboard.
 *   - Write API: schema is discoverable via /meta and all three Linked Accounts
 *     report canMakeRequest=true, but every create is blocked today:
 *       HRIS Employee   -> DISABLED_MODEL_WRITE (Employee WRITE scope is false)
 *       CRM Opportunity -> MISSING_PERMISSION (HubSpot token lacks write scope);
 *                          and /meta exposes no writable status/close_date, so a
 *                          POST could not produce a closed-won deal anyway
 *       Accounting Invoice -> writable, but line_items are uuid REFERENCES, so
 *                          the created invoice has no amount and cannot trip the
 *                          3x-median contract rule
 *   - The Supabase write half of /api/sync is PROVEN by `cursor-test`.
 *
 * Modes (read-only unless noted):
 *   probe        /meta for Employee / Opportunity / Invoice — required + writable
 *                fields, and each Linked Account's request status.
 *   meta-raw     full unabridged /meta JSON for one model (employee|opportunity|
 *                invoice) — use when a nested shape matters, e.g. line_items.
 *   scopes       org-default and per-Linked-Account READ/WRITE Common Model scopes.
 *   issues       open Merge Issues — explains MISSING_PERMISSION failures.
 *   acct         Zoho Books invoices (with median), contacts, company info.
 *   rows         the real company's coverage_state / signal_events / activity_log
 *                / pending_approvals, read straight from Supabase.
 *
 *   resync       WRITES to Merge. Fires force resync on all three categories.
 *   write        WRITES to Merge. `write hris` | `write crm` | `write all`.
 *   enable-write WRITES to Merge config. Flips the Employee/Opportunity WRITE
 *                scope on for THIS Linked Account only (reversible; set
 *                isEnabled back to false to undo).
 *   cursor-test  WRITES to Supabase. Exercises the write half of /api/sync with
 *                real Merge data and a deliberately held-back cursor. See the
 *                REAL/SIMULATED note on `cursorTest` — read it before quoting
 *                the output as proof of anything.
 *   roundtrip    WRITES to Merge and Supabase. write -> resync -> POST /api/sync
 *                -> read back. Only useful once the two blockers above are fixed.
 *   cleanup      DELETES from Supabase. `cleanup <iso-timestamp>
 *                [--restore-coverage]` removes rows this script created.
 *
 * Nothing here fakes a signal. The one simulated thing is the sync cursor in
 * `cursor-test`, and the rows it writes carry `simulated = true` plus a
 * `verification_note` in the payload saying so.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* .env.local (no dotenv dependency — package.json is frozen)                  */
/* -------------------------------------------------------------------------- */

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const REAL_COMPANY_ID = "7e3d1bdd-279d-4eb7-b5e2-ccb2bbce3aea";
const APP = process.env.FETCH_APP_URL ?? "http://localhost:3000";

function heading(text: string): void {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const anyErr = error as {
      statusCode?: number;
      message?: string;
      body?: unknown;
    };
    const parts = [
      anyErr.statusCode !== undefined ? `HTTP ${anyErr.statusCode}` : null,
      anyErr.message ?? null,
      anyErr.body !== undefined ? JSON.stringify(anyErr.body) : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/* Lazy imports — env has to be loaded before these modules initialise         */
/* -------------------------------------------------------------------------- */

async function merge() {
  const { MergeClient } = await import("@mergeapi/merge-node-client");
  const apiKey = process.env.MERGE_API_KEY!;
  return {
    hris: new MergeClient({
      apiKey,
      accountToken: process.env.MERGE_ACCOUNT_TOKEN_HRIS!,
    }),
    accounting: new MergeClient({
      apiKey,
      accountToken: process.env.MERGE_ACCOUNT_TOKEN_ACCOUNTING!,
    }),
    crm: new MergeClient({
      apiKey,
      accountToken: process.env.MERGE_ACCOUNT_TOKEN_CRM!,
    }),
  };
}

async function supabase() {
  const { getSupabaseServerClient } = await import("../src/lib/supabase");
  return getSupabaseServerClient();
}

/* -------------------------------------------------------------------------- */
/* probe                                                                      */
/* -------------------------------------------------------------------------- */

function printMeta(label: string, meta: unknown): void {
  const m = meta as {
    requestSchema?: { properties?: Record<string, unknown>; required?: string[] };
    remoteFieldClasses?: unknown;
    status?: unknown;
    hasConditionalParams?: boolean;
    hasRequiredLinkedAccountParams?: boolean;
  };
  console.log(`\n  ${label}`);
  const props = m.requestSchema?.properties ?? {};
  const required = m.requestSchema?.required ?? [];
  console.log(`    required fields: ${required.length ? required.join(", ") : "(none listed)"}`);
  console.log(`    writable fields: ${Object.keys(props).join(", ") || "(none)"}`);

  // The interesting schema is nested one level down under `model`.
  const model = props.model as
    | { properties?: Record<string, { type?: string; format?: string }>; required?: string[] }
    | undefined;
  if (model?.properties) {
    console.log(`    model.required: ${(model.required ?? []).join(", ") || "(none)"}`);
    console.log("    model.properties:");
    for (const [field, spec] of Object.entries(model.properties)) {
      console.log(
        `      ${field.padEnd(28)} ${spec?.type ?? "?"}${spec?.format ? `/${spec.format}` : ""}`,
      );
    }
  }
  console.log(
    `    hasConditionalParams=${m.hasConditionalParams} hasRequiredLinkedAccountParams=${m.hasRequiredLinkedAccountParams}`,
  );
  console.log(`    linked account status: ${JSON.stringify(m.status)}`);
}

/** Full, unabridged /meta JSON for one model — for nested shapes like line_items. */
async function metaRaw(): Promise<void> {
  const c = await merge();
  const which = process.argv[3] ?? "invoice";
  const lookup: Record<string, () => Promise<unknown>> = {
    employee: () => c.hris.hris.employees.metaPostRetrieve(),
    opportunity: () => c.crm.crm.opportunities.metaPostRetrieve(),
    invoice: () => c.accounting.accounting.invoices.metaPostRetrieve(),
  };
  heading(`Raw /meta — ${which}`);
  console.log(JSON.stringify(await lookup[which](), null, 2));
}

async function probe(): Promise<void> {
  const c = await merge();

  heading("1. /meta — what each sandbox will accept on POST");

  const metas: [string, () => Promise<unknown>][] = [
    ["HRIS Employee (BambooHR)", () => c.hris.hris.employees.metaPostRetrieve()],
    [
      "CRM Opportunity (HubSpot)",
      () => c.crm.crm.opportunities.metaPostRetrieve(),
    ],
    [
      "Accounting Invoice (Zoho Books)",
      () => c.accounting.accounting.invoices.metaPostRetrieve(),
    ],
  ];

  for (const [label, run] of metas) {
    try {
      printMeta(label, await run());
    } catch (error) {
      console.log(`\n  ${label}\n    META FAILED: ${describeError(error)}`);
    }
  }

  heading("2. Force resync capability (this DOES consume a sync credit if allowed)");
  console.log("  Skipped in probe mode. Run: npx tsx scripts/verify-sync-roundtrip.ts resync");
}

/* -------------------------------------------------------------------------- */
/* resync                                                                     */
/* -------------------------------------------------------------------------- */

async function resync(): Promise<boolean> {
  const c = await merge();
  heading("Force resync — client.<category>.forceResync.syncStatusResyncCreate()");

  let anyOk = false;
  const calls: [string, () => Promise<unknown>][] = [
    ["hris", () => c.hris.hris.forceResync.syncStatusResyncCreate()],
    [
      "accounting",
      () => c.accounting.accounting.forceResync.syncStatusResyncCreate(),
    ],
    ["crm", () => c.crm.crm.forceResync.syncStatusResyncCreate()],
  ];

  for (const [category, run] of calls) {
    try {
      const statuses = (await run()) as Array<{
        modelName?: string;
        status?: string;
        lastSyncStart?: unknown;
        nextSyncStart?: unknown;
      }>;
      anyOk = true;
      console.log(`\n  ${category}: OK — ${statuses.length} sync status row(s)`);
      for (const s of statuses.slice(0, 8)) {
        console.log(`    ${String(s.modelName).padEnd(28)} ${s.status}`);
      }
      if (statuses.length > 8) console.log(`    ... +${statuses.length - 8} more`);
    } catch (error) {
      console.log(`\n  ${category}: FAILED — ${describeError(error)}`);
    }
  }
  return anyOk;
}

/* -------------------------------------------------------------------------- */
/* write                                                                      */
/* -------------------------------------------------------------------------- */

const WRITE_MARKER = "Fetch Verify";

async function write(target = process.argv[3] ?? "all"): Promise<void> {
  const c = await merge();
  heading(`Merge Write API — create (${target})`);

  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");

  if (target === "all" || target === "hris") {
    try {
      // /meta says model.required = ["work_email"]; every other field below is
      // in model.properties for this Linked Account.
      const employee = await c.hris.hris.employees.create({
        model: {
          firstName: WRITE_MARKER,
          lastName: `Hire${stamp}`,
          workEmail: `fetch.verify.${stamp}@example.com`,
          employmentStatus: "PENDING",
          startDate: new Date(Date.now() + 7 * 86400000),
        },
      });
      console.log(`\n  HRIS Employee: CREATED`);
      console.log(`    ${JSON.stringify(employee, null, 2).slice(0, 2000)}`);
    } catch (error) {
      console.log(`\n  HRIS Employee: FAILED — ${describeError(error)}`);
    }
  }

  if (target === "all" || target === "crm") {
    try {
      // /meta for this HubSpot account exposes only stage/owner/amount/name/
      // account/remote_fields — there is NO writable `status` or `close_date`,
      // so a POST alone cannot produce a closed-won opportunity.
      const opportunity = await c.crm.crm.opportunities.create({
        model: {
          name: `${WRITE_MARKER} Deal ${stamp}`,
          amount: 250000,
        },
      });
      console.log(`\n  CRM Opportunity: CREATED`);
      console.log(`    ${JSON.stringify(opportunity, null, 2).slice(0, 2000)}`);
    } catch (error) {
      console.log(`\n  CRM Opportunity: FAILED — ${describeError(error)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* scopes — which Common Models allow READ / WRITE                            */
/* -------------------------------------------------------------------------- */

interface ScopeModel {
  modelName?: string;
  modelPermissions?: Record<string, { isEnabled?: boolean }>;
}

function printScopes(label: string, payload: unknown, only: string[]): void {
  const models = (payload as { commonModels?: ScopeModel[] })?.commonModels ?? [];
  console.log(`\n  ${label} — ${models.length} common model(s)`);
  for (const model of models) {
    if (only.length > 0 && !only.includes(model.modelName ?? "")) continue;
    const perms = Object.entries(model.modelPermissions ?? {})
      .map(([verb, spec]) => `${verb}=${spec?.isEnabled}`)
      .join(" ");
    console.log(`    ${String(model.modelName).padEnd(16)} ${perms}`);
  }
}

/** Open Merge Issues per Linked Account — explains MISSING_PERMISSION failures. */
async function issues(): Promise<void> {
  const c = await merge();
  heading("Merge Issues (read-only)");

  const targets: [string, () => Promise<unknown>][] = [
    ["HRIS", () => c.hris.hris.issues.list({ pageSize: 20 })],
    ["CRM", () => c.crm.crm.issues.list({ pageSize: 20 })],
    ["Accounting", () => c.accounting.accounting.issues.list({ pageSize: 20 })],
  ];

  for (const [label, run] of targets) {
    try {
      const page = (await run()) as {
        results?: Array<{ status?: string; errorDescription?: string; endUserMessageDetail?: string }>;
      };
      console.log(`\n  ${label}: ${page.results?.length ?? 0} issue(s)`);
      for (const issue of page.results ?? []) {
        console.log(`    ${JSON.stringify(issue, null, 2).replace(/\n/g, "\n    ")}`);
      }
    } catch (error) {
      console.log(`\n  ${label}: FAILED — ${describeError(error)}`);
    }
  }
}

async function scopes(): Promise<void> {
  const c = await merge();
  heading("Common Model scopes — is WRITE enabled?");

  const targets: [string, string[], () => Promise<unknown>, () => Promise<unknown>][] = [
    [
      "HRIS",
      ["Employee", "Employment"],
      () => c.hris.hris.scopes.defaultScopesRetrieve(),
      () => c.hris.hris.scopes.linkedAccountScopesRetrieve(),
    ],
    [
      "CRM",
      ["Opportunity", "Account", "Contact"],
      () => c.crm.crm.scopes.defaultScopesRetrieve(),
      () => c.crm.crm.scopes.linkedAccountScopesRetrieve(),
    ],
    [
      "Accounting",
      ["Invoice", "Contact", "Transaction"],
      () => c.accounting.accounting.scopes.defaultScopesRetrieve(),
      () => c.accounting.accounting.scopes.linkedAccountScopesRetrieve(),
    ],
  ];

  for (const [label, only, org, linked] of targets) {
    try {
      printScopes(`${label} org default scopes`, await org(), only);
    } catch (error) {
      console.log(`\n  ${label} org default scopes: FAILED — ${describeError(error)}`);
    }
    try {
      printScopes(`${label} linked-account scopes`, await linked(), only);
    } catch (error) {
      console.log(`\n  ${label} linked-account scopes: FAILED — ${describeError(error)}`);
    }
  }
}

/**
 * Attempt to flip WRITE on for the models the demo needs, at the Linked Account
 * level. Org-level defaults may still veto this — the /meta + POST probe is the
 * only real proof.
 */
async function enableWrite(): Promise<void> {
  const c = await merge();
  heading("Enabling WRITE scope at the Linked Account level");

  try {
    const result = await c.hris.hris.scopes.linkedAccountScopesCreate({
      commonModels: [
        {
          modelName: "Employee",
          modelPermissions: {
            READ: { isEnabled: true },
            WRITE: { isEnabled: true },
          },
        },
      ],
    });
    printScopes("HRIS after update", result, ["Employee"]);
  } catch (error) {
    console.log(`\n  HRIS Employee WRITE: FAILED — ${describeError(error)}`);
  }

  try {
    const result = await c.crm.crm.scopes.linkedAccountScopesCreate({
      commonModels: [
        {
          modelName: "Opportunity",
          modelPermissions: {
            READ: { isEnabled: true },
            WRITE: { isEnabled: true },
          },
        },
      ],
    });
    printScopes("CRM after update", result, ["Opportunity"]);
  } catch (error) {
    console.log(`\n  CRM Opportunity WRITE: FAILED — ${describeError(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* acct — what the Zoho Books sandbox already has (needed to build an Invoice) */
/* -------------------------------------------------------------------------- */

async function acct(): Promise<void> {
  const c = await merge();
  heading("Zoho Books — existing records (read-only)");

  const invoices = await c.accounting.accounting.invoices.list({ pageSize: 100 });
  const amounts = (invoices.results ?? []).map((i) => i.totalAmount ?? 0);
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  console.log(`\n  invoices: ${amounts.length}, median total_amount = ${median}`);
  for (const invoice of invoices.results ?? []) {
    console.log(
      `    ${String(invoice.totalAmount).padStart(10)}  ${invoice.type ?? "?"}  ${invoice.status ?? "?"}  contact=${JSON.stringify(invoice.contact)?.slice(0, 60)}`,
    );
  }
  console.log(`  => an invoice above ${median * 3} would trip the contract trigger`);

  const contacts = await c.accounting.accounting.contacts.list({ pageSize: 10 });
  console.log(`\n  contacts: ${contacts.results?.length ?? 0}`);
  for (const contact of contacts.results ?? []) {
    console.log(`    ${contact.id}  ${contact.name} (customer=${contact.isCustomer})`);
  }

  const companyInfo = await c.accounting.accounting.companyInfo.list({ pageSize: 10 });
  console.log(`\n  company_info: ${companyInfo.results?.length ?? 0}`);
  for (const info of companyInfo.results ?? []) {
    console.log(`    ${info.id}  ${info.name}  currency=${info.currency}`);
  }
}

/* -------------------------------------------------------------------------- */
/* rows — read Supabase directly                                              */
/* -------------------------------------------------------------------------- */

async function rows(): Promise<void> {
  const db = await supabase();

  heading("Supabase — Copperline Software");

  const { data: coverage } = await db
    .from("coverage_state")
    .select("coverage_line, current_limit, updated_at")
    .eq("company_id", REAL_COMPANY_ID)
    .order("coverage_line");
  console.log("\n  coverage_state:");
  for (const row of coverage ?? []) {
    console.log(
      `    ${String(row.coverage_line).padEnd(10)} $${Number(row.current_limit).toLocaleString("en-US").padStart(12)}  updated=${row.updated_at}`,
    );
  }

  const { data: events, error: eventsError } = await db
    .from("signal_events")
    .select(
      "id, trigger_type, classifier_probability, decision, simulated, created_at, raw_payload",
    )
    .eq("company_id", REAL_COMPANY_ID)
    .order("created_at", { ascending: false })
    .limit(15);
  if (eventsError) console.log(`  signal_events QUERY ERROR: ${eventsError.message}`);
  console.log(`\n  signal_events (${events?.length ?? 0}):`);
  for (const row of events ?? []) {
    const payload = row.raw_payload as { summary?: string; source?: string };
    console.log(
      `    ${row.created_at}  ${String(row.trigger_type).padEnd(9)} p=${Number(row.classifier_probability).toFixed(3)} ${String(row.decision).padEnd(7)} simulated=${row.simulated}`,
    );
    console.log(`      id=${row.id}`);
    console.log(`      source=${payload?.source ?? "—"}  ${payload?.summary ?? ""}`);
  }

  const { data: activity } = await db
    .from("activity_log")
    .select("id, signal_event_id, coverage_line, old_value, new_value, tag, explanation, created_at")
    .eq("company_id", REAL_COMPANY_ID)
    .order("created_at", { ascending: false })
    .limit(15);
  console.log(`\n  activity_log (${activity?.length ?? 0}):`);
  for (const row of activity ?? []) {
    console.log(
      `    ${row.created_at}  ${String(row.tag).padEnd(8)} ${String(row.coverage_line).padEnd(9)} ${row.old_value ?? "—"} -> ${row.new_value ?? "—"}`,
    );
    console.log(`      id=${row.id} signal_event_id=${row.signal_event_id}`);
    console.log(`      ${String(row.explanation).slice(0, 200)}`);
  }

  const { data: approvals } = await db
    .from("pending_approvals")
    .select("id, signal_event_id, coverage_line, current_limit, proposed_limit, status, created_at")
    .eq("company_id", REAL_COMPANY_ID)
    .order("created_at", { ascending: false })
    .limit(15);
  console.log(`\n  pending_approvals (${approvals?.length ?? 0}):`);
  for (const row of approvals ?? []) {
    console.log(
      `    ${row.created_at}  ${String(row.coverage_line).padEnd(9)} $${Number(row.current_limit).toLocaleString("en-US")} -> $${Number(row.proposed_limit).toLocaleString("en-US")}  ${row.status}`,
    );
    console.log(`      id=${row.id} signal_event_id=${row.signal_event_id}`);
  }
}

/* -------------------------------------------------------------------------- */
/* cursor-test — exercise the WRITE half of /api/sync with real Merge data     */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS REAL AND WHAT IS SIMULATED — read this before trusting the output.
 *
 * REAL: the company row, the Merge pull (live BambooHR/Zoho/HubSpot records),
 * the record that becomes the signal, `diffSnapshot`, `detectSignals`,
 * `deriveFeatures`, the trained classifier, `decide`, `insertSignalEvent`,
 * `applyDecision`, and every Supabase row written.
 *
 * SIMULATED: exactly one thing — the cursor. We hold ONE real record out of
 * `seenRemoteIds` so the diff reports it as newly arrived. No payload is
 * invented; the record genuinely exists in Merge right now. This proves
 * everything downstream of "a change was detected", which is the half of
 * `/api/sync` that a source-system edit cannot be used to test right now
 * (Merge force-resync is dashboard-only for Test Linked Accounts).
 *
 * Rows are written with `simulated = true` so they can never be mistaken for a
 * genuine Merge-detected event, and `cleanup` removes them.
 */
async function cursorTest(): Promise<void> {
  const { getCompany, getCoverageState, insertSignalEvent, listRecentSignalEvents } =
    await import("../src/lib/db/queries");
  const { fetchCompanySnapshotResilient } = await import("../src/lib/merge/client");
  const { diffSnapshot, detectSignals, EMPTY_CURSOR } = await import(
    "../src/lib/merge/sync"
  );
  const { decide } = await import("../src/lib/engine/decide");
  const { standingFromHistory } = await import("../src/lib/engine/features");
  const { TRIGGER_COVERAGE_LINE } = await import("../src/lib/constants");
  const { applyDecision } = await import("../src/app/api/_lib/apply-decision");

  heading("cursor-test — SIMULATED CURSOR, REAL EVERYTHING ELSE");
  console.log(
    "  Simulated: one real Merge record is held out of the seen-set so the diff\n" +
      "  reports it as new. Nothing about the record itself is invented.\n",
  );

  const dryRun = process.argv.includes("--dry-run");
  const hold = process.argv.includes("--hold-crm")
    ? "crm"
    : process.argv.includes("--hold-accounting")
      ? "accounting"
      : "hris";
  if (dryRun) console.log("  DRY RUN — nothing will be written to Supabase.\n");

  const company = await getCompany(REAL_COMPANY_ID);
  if (!company) throw new Error("Real company row not found in Supabase.");
  console.log(`  company: ${company.name} (source=${company.source}, stage=${company.stage})`);

  const { snapshot, remoteIds, warnings } = await fetchCompanySnapshotResilient(company);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(
    `  pulled from Merge: ${snapshot.hires.length} employees, ` +
      `${snapshot.transactions.length} invoices, ${snapshot.opportunities.length} opportunities`,
  );

  // Full cursor = "we have already seen absolutely everything Merge has".
  const primed = diffSnapshot(snapshot, remoteIds, EMPTY_CURSOR).nextCursor;

  // Hold back one real record — the record a live source-system edit would
  // produce. Which one depends on the trigger being exercised.
  const { countsTowardHeadcount, isWon } = await import("../src/lib/merge/sync");

  let heldId: string;
  let heldLabel: string;
  if (hold === "crm") {
    const won = snapshot.opportunities.filter(isWon);
    const biggest = won.reduce<(typeof won)[number] | null>(
      (max, deal) => (max === null || deal.amount > max.amount ? deal : max),
      null,
    );
    if (!biggest) throw new Error("No closed-won opportunity in the snapshot.");
    heldId = biggest.id;
    heldLabel = `opportunity "${biggest.name}" $${biggest.amount} close=${biggest.closeDate?.slice(0, 10)}`;
  } else if (hold === "accounting") {
    const biggest = snapshot.transactions.reduce<
      (typeof snapshot.transactions)[number] | null
    >((max, t) => (max === null || t.amount > max.amount ? t : max), null);
    if (!biggest) throw new Error("No invoice in the snapshot.");
    heldId = biggest.id;
    heldLabel = `invoice ${biggest.description} $${biggest.amount}`;
  } else {
    const candidates = snapshot.hires.filter((hire) => countsTowardHeadcount(hire));
    const newest = [...candidates].sort((a, b) =>
      String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
    )[0];
    if (!newest) throw new Error("No headcount-eligible employee to hold back.");
    heldId = newest.id;
    heldLabel = `employee "${newest.name}" status=${newest.employmentStatus} start=${newest.startDate?.slice(0, 10) ?? "—"}`;
  }

  const heldIdentity = remoteIds[heldId] ?? heldId;
  console.log(`\n  holding back (real Merge record, category=${hold}): ${heldLabel}`);

  const cursor = {
    watermarks: primed.watermarks,
    seenRemoteIds: {
      ...primed.seenRemoteIds,
      [hold]: (primed.seenRemoteIds[hold] ?? []).filter((id) => id !== heldIdentity),
    },
  };

  const diff = diffSnapshot(snapshot, remoteIds, cursor);
  console.log(
    `  diff says new: ${diff.newHires.length} hire(s), ${diff.newTransactions.length} invoice(s), ` +
      `${diff.newOpportunities.length} opportunity(ies)`,
  );

  const signals = detectSignals(snapshot, diff);
  console.log(`  signals detected: ${signals.length}`);
  if (signals.length === 0) {
    console.error("\n  FAIL — the diff produced no signal. Write path not exercised.");
    process.exit(1);
  }

  const history = await listRecentSignalEvents(company.id);
  const standing = standingFromHistory(history);

  for (const signal of signals) {
    console.log(`\n  [${signal.triggerType}] ${signal.summary}`);
    const coverageLine = TRIGGER_COVERAGE_LINE[signal.triggerType];
    const coverage = await getCoverageState(company.id, coverageLine);
    if (!coverage) {
      console.log(`    skipped — no ${coverageLine} line on this company`);
      continue;
    }

    const decision = decide({
      companyName: company.name,
      triggerType: signal.triggerType,
      observation: signal.features,
      standing: { ...standing, ...signal.features },
      currentLimit: Number(coverage.current_limit),
      rawPayload: {
        ...signal.rawPayload,
        verification_note:
          "Written by scripts/verify-sync-roundtrip.ts cursor-test. The Merge " +
          "record is real; its 'newness' was simulated by holding it out of the " +
          "sync cursor. Not a genuine live detection.",
      } as typeof signal.rawPayload,
    });

    console.log(
      `    features: ${JSON.stringify(decision.features)}`,
    );
    console.log(
      `    classifier p=${decision.probability.toFixed(4)} -> ${decision.decision.toUpperCase()} on ${coverageLine}`,
    );
    console.log(
      `    scaling: $${decision.scaling.currentLimit.toLocaleString("en-US")} -> ` +
        `$${decision.scaling.newLimit.toLocaleString("en-US")} ` +
        `(rawGrowth=${(decision.scaling.rawGrowth * 100).toFixed(1)}%, changed=${decision.scaling.changed})`,
    );

    if (dryRun) {
      console.log("    DRY RUN — no rows written.");
      continue;
    }

    const signalEvent = await insertSignalEvent({
      companyId: company.id,
      triggerType: signal.triggerType,
      rawPayload: decision.rawPayload,
      features: decision.features,
      probability: decision.probability,
      decision: decision.decision,
      // Deliberately TRUE — the route writes false. These rows must never be
      // mistaken for a genuine Merge-detected event.
      simulated: true,
    });
    console.log(`    signal_events row: ${signalEvent.id}`);

    const applied = await applyDecision(company.id, signalEvent.id, decision);
    console.log(`    activity_log row:  ${applied.activityLogEntry.id} (tag=${applied.activityLogEntry.tag})`);
    if (applied.coverageUpdate) {
      console.log(
        `    coverage_state:    ${coverageLine} $${applied.coverageUpdate.old_value.toLocaleString("en-US")} -> $${applied.coverageUpdate.new_value.toLocaleString("en-US")}`,
      );
    }
    if (applied.pendingApproval) {
      console.log(`    pending_approvals row: ${applied.pendingApproval.id}`);
    }
  }

  if (dryRun) return;
  console.log("\n  Now verifying by reading Supabase back independently:");
  await rows();
}

/* -------------------------------------------------------------------------- */
/* roundtrip                                                                  */
/* -------------------------------------------------------------------------- */

async function callSync(): Promise<unknown> {
  const response = await fetch(`${APP}/api/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ companyId: REAL_COMPANY_ID }),
  });
  const json = await response.json();
  console.log(`  HTTP ${response.status}: ${JSON.stringify(json, null, 2)}`);
  return json;
}

async function roundtrip(): Promise<void> {
  heading("STEP 1 — prime the cursor (POST /api/sync, expect 0 signals)");
  await callSync();

  heading("STEP 2 — write a record via Merge's Write API");
  await write();

  heading("STEP 3 — force resync so Merge re-reads the source system");
  await resync();

  console.log("\n  Waiting 30s for Merge to finish the resync...");
  await new Promise((r) => setTimeout(r, 30000));

  heading("STEP 4 — POST /api/sync again (this is the one that must emit)");
  await callSync();

  heading("STEP 5 — read the rows back from Supabase directly");
  await rows();
}

/* -------------------------------------------------------------------------- */
/* cleanup                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deletes rows for the real company created after a given ISO timestamp.
 *   npx tsx scripts/verify-sync-roundtrip.ts cleanup 2026-07-26T00:00:00Z
 * Restores coverage_state to the seeded $1,000,000 baseline for any line the
 * run moved (pass --restore-coverage).
 */
async function cleanup(since: string, restoreCoverage: boolean): Promise<void> {
  const db = await supabase();
  heading(`Cleanup — deleting rows for Copperline Software created after ${since}`);

  const { data: events } = await db
    .from("signal_events")
    .select("id")
    .eq("company_id", REAL_COMPANY_ID)
    .gte("created_at", since);
  const ids = (events ?? []).map((e) => e.id as string);
  console.log(`  signal_events matched: ${ids.length} — ${ids.join(", ") || "(none)"}`);
  if (ids.length === 0 && !restoreCoverage) return;

  if (ids.length > 0) {
    const a = await db.from("activity_log").delete().in("signal_event_id", ids).select("id");
    console.log(`  activity_log deleted: ${a.data?.length ?? 0} ${a.error?.message ?? ""}`);
    const p = await db.from("pending_approvals").delete().in("signal_event_id", ids).select("id");
    console.log(`  pending_approvals deleted: ${p.data?.length ?? 0} ${p.error?.message ?? ""}`);
    const s = await db.from("signal_events").delete().in("id", ids).select("id");
    console.log(`  signal_events deleted: ${s.data?.length ?? 0} ${s.error?.message ?? ""}`);
  }

  if (restoreCoverage) {
    const r = await db
      .from("coverage_state")
      .update({ current_limit: 1000000 })
      .eq("company_id", REAL_COMPANY_ID)
      .select("coverage_line, current_limit");
    console.log(
      `  coverage_state restored to $1,000,000: ${JSON.stringify(r.data)} ${r.error?.message ?? ""}`,
    );
  }
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "probe";
  switch (mode) {
    case "probe":
      return probe();
    case "resync":
      await resync();
      return;
    case "write":
      return write();
    case "issues":
      return issues();
    case "cursor-test":
      return cursorTest();
    case "meta-raw":
      return metaRaw();
    case "acct":
      return acct();
    case "scopes":
      return scopes();
    case "enable-write":
      return enableWrite();
    case "rows":
      return rows();
    case "roundtrip":
      return roundtrip();
    case "cleanup":
      return cleanup(
        process.argv[3] ?? new Date(Date.now() - 3600000).toISOString(),
        process.argv.includes("--restore-coverage"),
      );
    default:
      console.error(`Unknown mode "${mode}".`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nverify-sync-roundtrip failed:", error);
  process.exit(1);
});
