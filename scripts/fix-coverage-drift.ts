/**
 * One-time data correction: coverage_state vs. the backfilled activity_log
 * narrative.
 *
 *   npx tsx scripts/fix-coverage-drift.ts           dry run, prints the diff
 *   npx tsx scripts/fix-coverage-drift.ts --apply    writes the corrections
 *
 * ROOT CAUSE (confirmed against live data, not the runtime app):
 * T3's original seed sets coverage_state to each company's STAGE PACKAGE
 * BASELINE (e.g. $1M for pre-seed EPLI) and separately writes 12 months of
 * signal_events. The just-added activity_log backfill (scripts/seed.ts
 * backfill-activity) narrates that history with real old->new transitions
 * for every "auto" event -- but only ever INSERTS into activity_log. It never
 * writes the accumulated ending value back to coverage_state. Net effect: 10
 * of 16 synthetic companies show a Coverage Panel value that flatly
 * contradicts their own Activity Feed's most recent line (e.g. the feed says
 * "EPLI moved from $1M to $2.25M three months ago" while the panel still
 * shows $1M) -- confirmed via coverage_state.updated_at timestamps matching
 * the original seed/backfill run, not any later runtime action.
 *
 * FIX: set coverage_state.current_limit to the most recent AUTO activity_log
 * row's new_value per (company, coverage_line) -- i.e. make the panel agree
 * with what the feed already narrates. PENDING-tagged rows never applied
 * anything (by design, old/new are null) so they're correctly ignored here.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TABLES } from "../src/lib/constants";
import { getSupabaseServerClient } from "../src/lib/supabase";
import type { CoverageLine } from "../src/lib/types";

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

interface CoverageRow {
  company_id: string;
  coverage_line: CoverageLine;
  current_limit: number;
}

interface ActivityRow {
  company_id: string;
  coverage_line: CoverageLine | null;
  new_value: number | null;
  created_at: string;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseServerClient();

  const { data: companies, error: companiesError } = await supabase
    .from(TABLES.companies)
    .select("id, name")
    .eq("source", "synthetic");
  if (companiesError) throw new Error(companiesError.message);

  const { data: coverage, error: coverageError } = await supabase
    .from(TABLES.coverageState)
    .select("company_id, coverage_line, current_limit");
  if (coverageError) throw new Error(coverageError.message);

  const { data: activity, error: activityError } = await supabase
    .from(TABLES.activityLog)
    .select("company_id, coverage_line, new_value, created_at")
    .eq("tag", "auto")
    .not("new_value", "is", null)
    .order("created_at", { ascending: false });
  if (activityError) throw new Error(activityError.message);

  const nameById = new Map((companies ?? []).map((c) => [c.id, c.name]));

  // Newest-first order means the first sighting per (company, line) is the
  // most recent auto-applied value -- exactly what the feed's latest row says.
  const impliedEnding = new Map<string, { value: number; at: string }>();
  for (const row of (activity ?? []) as ActivityRow[]) {
    if (!row.coverage_line) continue;
    const key = `${row.company_id}:${row.coverage_line}`;
    if (!impliedEnding.has(key)) {
      impliedEnding.set(key, { value: Number(row.new_value), at: row.created_at });
    }
  }

  const corrections: Array<{
    company_id: string;
    companyName: string;
    coverage_line: CoverageLine;
    from: number;
    to: number;
  }> = [];

  for (const row of (coverage ?? []) as CoverageRow[]) {
    const key = `${row.company_id}:${row.coverage_line}`;
    const implied = impliedEnding.get(key);
    if (!implied) continue;
    const actual = Number(row.current_limit);
    if (implied.value !== actual) {
      corrections.push({
        company_id: row.company_id,
        companyName: nameById.get(row.company_id) ?? row.company_id,
        coverage_line: row.coverage_line,
        from: actual,
        to: implied.value,
      });
    }
  }

  if (corrections.length === 0) {
    console.log("No drift found -- coverage_state already matches activity_log.");
    return;
  }

  console.log(`Found ${corrections.length} drifted row(s):\n`);
  for (const c of corrections) {
    console.log(
      `  ${c.companyName.padEnd(28)} ${c.coverage_line.padEnd(16)} ` +
        `$${c.from.toLocaleString()} -> $${c.to.toLocaleString()}`,
    );
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write these corrections.");
    return;
  }

  console.log("\nApplying...");
  for (const c of corrections) {
    const { error } = await supabase
      .from(TABLES.coverageState)
      .update({ current_limit: c.to })
      .eq("company_id", c.company_id)
      .eq("coverage_line", c.coverage_line);
    if (error) throw new Error(`update failed for ${c.companyName}/${c.coverage_line}: ${error.message}`);
  }
  console.log(`Done -- ${corrections.length} row(s) corrected.`);
}

main().catch((error) => {
  console.error("fix-coverage-drift failed:", error);
  process.exit(1);
});
