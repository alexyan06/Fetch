/**
 * T3 verification loop.
 *
 *   npx tsx scripts/verify-db.ts
 *
 * Asserts the seed landed correctly: 16 synthetic companies, 192 signal_events
 * rows (16 x 12 months), every company with a complete coverage_state for its
 * stage package, and 3-4 open pending_approvals. Read-only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { STAGE_PACKAGE_LINES, TABLES } from "../src/lib/constants";
import { getSupabaseServerClient } from "../src/lib/supabase";
import type { StagePackage } from "../src/lib/types";

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

const EXPECTED_COMPANIES = 16;
const EXPECTED_MONTHS = 12;
const EXPECTED_SIGNAL_EVENTS = EXPECTED_COMPANIES * EXPECTED_MONTHS;

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const mark = ok ? "OK  " : "FAIL";
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const supabase = getSupabaseServerClient();

  console.log("1. companies");
  const { data: companies, error: companiesError } = await supabase
    .from(TABLES.companies)
    .select("id, name, stage, source")
    .eq("source", "synthetic");
  if (companiesError) throw new Error(`companies query failed: ${companiesError.message}`);
  check(
    `${EXPECTED_COMPANIES} synthetic companies`,
    (companies?.length ?? 0) === EXPECTED_COMPANIES,
    `found ${companies?.length ?? 0}`,
  );

  console.log("\n2. signal_events");
  const { count: signalCount, error: signalError } = await supabase
    .from(TABLES.signalEvents)
    .select("id", { count: "exact", head: true });
  if (signalError) throw new Error(`signal_events query failed: ${signalError.message}`);
  check(
    `${EXPECTED_SIGNAL_EVENTS} signal_events rows`,
    signalCount === EXPECTED_SIGNAL_EVENTS,
    `found ${signalCount}`,
  );

  console.log("\n3. coverage_state — every company complete for its stage");
  const { data: coverageRows, error: coverageError } = await supabase
    .from(TABLES.coverageState)
    .select("company_id, coverage_line");
  if (coverageError) throw new Error(`coverage_state query failed: ${coverageError.message}`);

  const coverageByCompany = new Map<string, Set<string>>();
  for (const row of coverageRows ?? []) {
    const set = coverageByCompany.get(row.company_id) ?? new Set<string>();
    set.add(row.coverage_line);
    coverageByCompany.set(row.company_id, set);
  }

  let incomplete = 0;
  for (const company of companies ?? []) {
    const expectedLines = STAGE_PACKAGE_LINES[company.stage as StagePackage];
    const actual = coverageByCompany.get(company.id) ?? new Set<string>();
    const missing = expectedLines.filter((line) => !actual.has(line));
    if (missing.length > 0 || actual.size !== expectedLines.length) {
      incomplete++;
      console.log(
        `      ${company.name} (${company.stage}): expected ${expectedLines.length} lines, ` +
          `has ${actual.size}${missing.length ? `, missing [${missing.join(", ")}]` : ""}`,
      );
    }
  }
  check(
    "every company has a complete coverage_state for its stage",
    incomplete === 0,
    incomplete > 0 ? `${incomplete} company/ies incomplete` : undefined,
  );

  console.log("\n4. pending_approvals");
  const { data: openApprovals, error: approvalsError } = await supabase
    .from(TABLES.pendingApprovals)
    .select("id, company_id, status")
    .eq("status", "open");
  if (approvalsError) throw new Error(`pending_approvals query failed: ${approvalsError.message}`);
  const openCount = openApprovals?.length ?? 0;
  const distinctCompanies = new Set((openApprovals ?? []).map((a) => a.company_id)).size;
  check(
    "3-4 open pending_approvals",
    openCount >= 3 && openCount <= 4,
    `found ${openCount} open across ${distinctCompanies} distinct company/ies`,
  );

  console.log(`\n${failures === 0 ? "OK" : "FAIL"} — ${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\nverify-db failed:", error);
  process.exit(1);
});
