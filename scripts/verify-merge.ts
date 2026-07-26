/**
 * A2 verification loop — proves the Merge pipeline is real, not stubbed.
 *
 *   npx tsx scripts/verify-merge.ts
 *
 * Pulls live records from all three Linked Accounts (BambooHR HRIS, Zoho Books
 * Accounting, HubSpot CRM), prints what came back, derives the four-feature
 * vector, and runs it through the trained classifier so the whole path is
 * visible in one output. Read-only — it never writes to Merge or Supabase.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FEATURE_LABELS } from "../src/lib/constants";
import { classify } from "../src/lib/ml/classifier";
import { fetchCompanySnapshotResilient } from "../src/lib/merge/client";
import {
  countsTowardHeadcount,
  detectSignals,
  diffSnapshot,
  EMPTY_CURSOR,
  isWon,
} from "../src/lib/merge/sync";
import type { Company } from "../src/lib/types";

/* -------------------------------------------------------------------------- */
/* .env.local (no dotenv dependency — package.json is frozen after Phase 0)    */
/* -------------------------------------------------------------------------- */

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // Already-exported env vars are fine too.
  }

  for (const line of raw.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/* -------------------------------------------------------------------------- */
/* Output helpers                                                             */
/* -------------------------------------------------------------------------- */

function heading(text: string): void {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  loadEnvLocal();

  const required = [
    "MERGE_API_KEY",
    "MERGE_ACCOUNT_TOKEN_HRIS",
    "MERGE_ACCOUNT_TOKEN_ACCOUNTING",
    "MERGE_ACCOUNT_TOKEN_CRM",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Missing env var${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}\n` +
        "Add them to .env.local (gitignored). See .env.example.",
    );
    process.exit(1);
  }

  // Stands in for the `companies` row until the seed lands; account tokens
  // resolve from env, exactly as they will from the row's jsonb column.
  const company: Company = {
    id: "verify-merge-local",
    name: "Fetch Demo Co (real, Merge-backed)",
    source: "real",
    stage: "series_a",
    merge_account_tokens: null,
    created_at: new Date().toISOString(),
  };

  heading("1. Pulling live data from Merge");
  const started = Date.now();
  const { snapshot, remoteIds, warnings } =
    await fetchCompanySnapshotResilient(company);
  console.log(`Pulled in ${Date.now() - started}ms at ${snapshot.pulledAt}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);

  /* --- HRIS ------------------------------------------------------------- */
  heading(`2. HRIS · BambooHR — ${snapshot.hires.length} Employee record(s)`);
  for (const hire of snapshot.hires) {
    const counted = countsTowardHeadcount(hire) ? "counted" : "not counted";
    console.log(
      `  ${hire.name.padEnd(28)} ${hire.employmentStatus.padEnd(9)} ` +
        `start=${hire.startDate?.slice(0, 10) ?? "—"}  (${counted})`,
    );
  }

  /* --- Accounting ------------------------------------------------------- */
  heading(
    `3. Accounting · Zoho Books — ${snapshot.transactions.length} Invoice record(s)`,
  );
  for (const transaction of snapshot.transactions) {
    console.log(
      `  ${usd(transaction.amount).padStart(12)}  ` +
        `${transaction.date?.slice(0, 10) ?? "—"}  ${transaction.description ?? ""}`,
    );
  }

  /* --- CRM -------------------------------------------------------------- */
  heading(
    `4. CRM · HubSpot — ${snapshot.opportunities.length} Opportunity record(s)`,
  );
  for (const opportunity of snapshot.opportunities) {
    console.log(
      `  ${usd(opportunity.amount).padStart(12)}  ${opportunity.status.padEnd(6)} ` +
        `close=${opportunity.closeDate?.slice(0, 10) ?? "—"}  ${opportunity.name}` +
        `${isWon(opportunity) ? "  [closed-won]" : ""}`,
    );
  }

  /* --- Change detection -------------------------------------------------- */
  const diff = diffSnapshot(snapshot, remoteIds, EMPTY_CURSOR);
  heading("5. Change detection (cold cursor — everything reads as new)");
  console.log(
    `  new hires: ${diff.newHires.length}   ` +
      `new invoices: ${diff.newTransactions.length}   ` +
      `new opportunities: ${diff.newOpportunities.length}`,
  );
  console.log(
    `  remote_id index resolved for ${Object.keys(remoteIds).length} record(s) — ` +
      "this is the Force Resync backstop",
  );

  /* --- Features + classifier -------------------------------------------- */
  const signals = detectSignals(snapshot, diff);
  const features = signals[0]?.features ?? null;

  heading("6. Derived four-feature vector");
  if (!features) {
    console.error("  No features derived — no signals detected.");
  } else {
    for (const [key, label] of Object.entries(FEATURE_LABELS)) {
      const value = features[key as keyof typeof features];
      const note =
        key === "cashInflowSpikeRatio"
          ? "  <- NEUTRAL_FUNDING_SIGNAL (invoices are receivables, not funding)"
          : "";
      console.log(`  ${label.padEnd(24)} ${value.toFixed(4).padStart(10)}${note}`);
    }

    const result = classify(features);
    heading("7. Trained classifier verdict");
    console.log(`  probability(needs human review): ${result.probability.toFixed(4)}`);
    console.log(`  decision:                        ${result.needsHumanReview ? "PENDING" : "AUTO"}`);
    console.log(`  top driving feature:             ${FEATURE_LABELS[result.topDrivingFeature]}`);
  }

  /* --- Signals ----------------------------------------------------------- */
  heading(`8. Signals detected — ${signals.length}`);
  for (const signal of signals) {
    console.log(`  [${signal.triggerType}] ${signal.summary}`);
    console.log(`      observation: ${JSON.stringify(signal.observation)}`);
  }

  const totalRecords =
    snapshot.hires.length +
    snapshot.transactions.length +
    snapshot.opportunities.length;
  if (totalRecords === 0) {
    console.error("\nFAIL — all three categories came back empty.");
    process.exit(1);
  }
  console.log(`\nOK — ${totalRecords} live record(s) across 3 Merge categories.`);
}

main().catch((error) => {
  console.error("\nverify-merge failed:", error);
  process.exit(1);
});
