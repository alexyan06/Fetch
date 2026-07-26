/**
 * Lane B T3 — synthetic portfolio seed.
 *
 *   npx tsx scripts/seed.ts
 *
 * Seeds 16 synthetic companies with 12 months of signal_events history each
 * (sourced from ml/training_data.csv), a starting coverage_state per company
 * from its stage package, and 3-4 pre-opened pending_approvals so the
 * "needs attention" sort has something to show on first load.
 *
 * Idempotent-ish: run against an empty portfolio. Re-running adds another 16
 * companies rather than upserting — clear the tables first if re-seeding.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LIMIT_ROUNDING_INCREMENT,
  MAX_SINGLE_STEP_MULTIPLIER,
  MIN_COVERAGE_LIMIT,
  STAGE_BASE_LIMITS,
  STAGE_PACKAGE_LINES,
  TABLES,
  TRIGGER_COVERAGE_LINE,
} from "../src/lib/constants";
import { classify } from "../src/lib/ml/classifier";
import { getSupabaseServerClient } from "../src/lib/supabase";
import type {
  ClassifierFeatures,
  Company,
  CoverageLine,
  PendingApproval,
  SignalEvent,
  SignalRawPayload,
  StagePackage,
  TriggerType,
} from "../src/lib/types";

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
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/* -------------------------------------------------------------------------- */
/* Invented startup names — no real companies, nothing "Acme"/"Test Co"       */
/* -------------------------------------------------------------------------- */

const COMPANY_NAMES: readonly string[] = [
  "Lumen Analytics",
  "Northbridge Robotics",
  "Fernwood Health",
  "Kestrel Logistics",
  "Vantage Cloud Systems",
  "Solara Energy",
  "Bramble Fintech",
  "Cobalt Devices",
  "Driftwood Media",
  "Anchorpoint Security",
  "Glasswing Biotech",
  "Meridian Talent",
  "Pinecrest Insurance Tech",
  "Ridgeline AI",
  "Saltmarsh Commerce",
  "Thistlewood Labs",
] as const;

const COMPANY_COUNT = COMPANY_NAMES.length; // 16
const MONTHS_PER_COMPANY = 12;

const STAGES: readonly StagePackage[] = [
  "pre_seed_seed",
  "series_a",
  "growth",
] as const;

function stageForIndex(i: number): StagePackage {
  return STAGES[i % STAGES.length];
}

/* -------------------------------------------------------------------------- */
/* CSV loading — ml/training_data.csv, 400 companies x 12 months, no dep      */
/* -------------------------------------------------------------------------- */

interface CsvRow {
  companyId: number;
  month: number;
  headcount: number;
  newHiresThisMonth: number;
  headcountGrowthRatePct: number;
  cashBalance: number;
  netCashInflow: number;
  cashInflowSpikeRatio: number;
  newDealValue: number;
  dealSizeRatio: number;
  needsHumanReviewLabel: boolean;
}

function loadTrainingData(): CsvRow[][] {
  const raw = readFileSync(
    resolve(process.cwd(), "ml/training_data.csv"),
    "utf8",
  );
  const lines = raw.trim().split("\n");
  lines.shift(); // header

  const byCompany = new Map<number, CsvRow[]>();
  for (const line of lines) {
    const cols = line.split(",");
    const row: CsvRow = {
      companyId: Number(cols[0]),
      month: Number(cols[1]),
      headcount: Number(cols[2]),
      newHiresThisMonth: Number(cols[3]),
      headcountGrowthRatePct: Number(cols[4]),
      cashBalance: Number(cols[5]),
      netCashInflow: Number(cols[6]),
      cashInflowSpikeRatio: Number(cols[7]),
      newDealValue: Number(cols[8]),
      dealSizeRatio: Number(cols[9]),
      needsHumanReviewLabel: cols[10].trim() === "1",
    };
    const list = byCompany.get(row.companyId) ?? [];
    list.push(row);
    byCompany.set(row.companyId, list);
  }

  const slice: CsvRow[][] = [];
  for (let i = 0; i < COMPANY_COUNT; i++) {
    const rows = byCompany.get(i);
    if (!rows || rows.length !== MONTHS_PER_COMPANY) {
      throw new Error(
        `expected ${MONTHS_PER_COMPANY} rows for csv company_id=${i}, got ${rows?.length ?? 0}`,
      );
    }
    slice.push(rows.sort((a, b) => a.month - b.month));
  }
  return slice;
}

/* -------------------------------------------------------------------------- */
/* Trigger selection — whichever of the 3 Tier-1 signals moved most that month */
/* -------------------------------------------------------------------------- */

// Same means/stds the trained classifier standardizes against
// (ml/classifier_weights.json), reused here only to compare relative movement
// — not to reclassify anything.
const FEATURE_MEANS = {
  headcountGrowthRatePct: 8.403860416666667,
  cashInflowSpikeRatio: 2.8819833333333333,
  dealSizeRatio: 0.7197187500000001,
};
const FEATURE_STDS = {
  headcountGrowthRatePct: 10.347157022648773,
  cashInflowSpikeRatio: 31.64628192852554,
  dealSizeRatio: 1.503756443621031,
};

function pickTriggerType(row: CsvRow): TriggerType {
  const magnitudes: Record<Extract<TriggerType, "hire" | "funding" | "contract">, number> = {
    hire:
      Math.abs(
        (row.headcountGrowthRatePct - FEATURE_MEANS.headcountGrowthRatePct) /
          FEATURE_STDS.headcountGrowthRatePct,
      ),
    funding: Math.abs(
      (row.cashInflowSpikeRatio - FEATURE_MEANS.cashInflowSpikeRatio) /
        FEATURE_STDS.cashInflowSpikeRatio,
    ),
    contract: Math.abs(
      (row.dealSizeRatio - FEATURE_MEANS.dealSizeRatio) / FEATURE_STDS.dealSizeRatio,
    ),
  };
  return (Object.entries(magnitudes) as [TriggerType, number][]).reduce(
    (best, cur) => (cur[1] > best[1] ? cur : best),
  )[0];
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function buildRawPayload(row: CsvRow, triggerType: TriggerType): SignalRawPayload {
  const base = {
    month: row.month,
    headcount: row.headcount,
    new_hires_this_month: row.newHiresThisMonth,
    cash_balance: row.cashBalance,
    net_cash_inflow: row.netCashInflow,
    new_deal_value: row.newDealValue,
  };
  switch (triggerType) {
    case "hire":
      return {
        summary: `${row.newHiresThisMonth} new hire(s) this month (headcount now ${row.headcount}, ${row.headcountGrowthRatePct.toFixed(1)}% growth)`,
        ...base,
      };
    case "funding":
      return {
        summary: `Net cash inflow of ${usd(row.netCashInflow)} (${row.cashInflowSpikeRatio.toFixed(1)}x typical monthly burn)`,
        ...base,
      };
    case "contract":
      return {
        summary: `New deal closed at ${usd(row.newDealValue)} (${row.dealSizeRatio.toFixed(2)}x typical deal size)`,
        ...base,
      };
    default:
      return { summary: "Signal observed", ...base };
  }
}

/** Local stand-in for the AUTO-path scaling rule — engine.ts isn't implemented
 * yet, so pending_approvals still needs a plausible proposed_limit to show. */
function computeProposedLimit(
  currentLimit: number,
  triggerType: TriggerType,
  features: ClassifierFeatures,
): number {
  let growth: number;
  switch (triggerType) {
    case "hire":
      growth = features.headcountGrowthRatePct / 100;
      break;
    case "funding":
      growth = features.cashInflowSpikeRatio / 10;
      break;
    case "contract":
    default:
      growth = features.dealSizeRatio;
      break;
  }
  const multiplier = Math.min(
    Math.max(1 + growth, 1.1),
    MAX_SINGLE_STEP_MULTIPLIER,
  );
  const raw = currentLimit * multiplier;
  const rounded =
    Math.round(raw / LIMIT_ROUNDING_INCREMENT) * LIMIT_ROUNDING_INCREMENT;
  return Math.max(rounded, MIN_COVERAGE_LIMIT);
}

function recommendationText(
  companyName: string,
  triggerType: TriggerType,
  coverageLine: CoverageLine,
  currentLimit: number,
  proposedLimit: number,
  payload: SignalRawPayload,
): string {
  return (
    `${companyName}: ${payload.summary}. That's big enough to warrant a look — ` +
    `raise ${coverageLine} from ${usd(currentLimit)} to ${usd(proposedLimit)}?`
  );
}

/** Timestamp for a given 1-indexed month, most-recent month landing ~now. */
function monthTimestamp(month: number): string {
  const now = new Date();
  const d = new Date(now);
  d.setMonth(d.getMonth() - (MONTHS_PER_COMPANY - month));
  return d.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  loadEnvLocal();
  const supabase = getSupabaseServerClient();
  const companyRows = loadTrainingData();

  const companies: Company[] = COMPANY_NAMES.map((name, i) => ({
    id: randomUUID(),
    name,
    source: "synthetic",
    stage: stageForIndex(i),
    merge_account_tokens: null,
    created_at: new Date().toISOString(),
  }));

  console.log(`Inserting ${companies.length} companies...`);
  {
    const { error } = await supabase.from(TABLES.companies).insert(companies);
    if (error) throw new Error(`companies insert failed: ${error.message}`);
  }

  console.log(`Inserting ${companies.length} starting coverage_state rows...`);
  const coverageRows: {
    id: string;
    company_id: string;
    coverage_line: CoverageLine;
    current_limit: number;
  }[] = [];
  for (const company of companies) {
    const lines = STAGE_PACKAGE_LINES[company.stage];
    const baseLimit = STAGE_BASE_LIMITS[company.stage];
    for (const line of lines) {
      coverageRows.push({
        id: randomUUID(),
        company_id: company.id,
        coverage_line: line,
        current_limit: baseLimit,
      });
    }
  }
  {
    const { error } = await supabase
      .from(TABLES.coverageState)
      .insert(coverageRows);
    if (error) throw new Error(`coverage_state insert failed: ${error.message}`);
  }

  console.log(
    `Building ${companies.length * MONTHS_PER_COMPANY} signal_events rows...`,
  );
  const signalEvents: (SignalEvent & { simulated: boolean })[] = [];
  // Track, per company, the pending events we could open an approval against.
  const pendingByCompany = new Map<
    string,
    { event: SignalEvent; coverageLine: CoverageLine; currentLimit: number }[]
  >();

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const coverageForCompany = new Map(
      coverageRows
        .filter((c) => c.company_id === company.id)
        .map((c) => [c.coverage_line, c.current_limit]),
    );

    for (const row of companyRows[i]) {
      const triggerType = pickTriggerType(row);
      const features: ClassifierFeatures = {
        headcountGrowthRatePct: row.headcountGrowthRatePct,
        newHiresThisMonth: row.newHiresThisMonth,
        cashInflowSpikeRatio: row.cashInflowSpikeRatio,
        dealSizeRatio: row.dealSizeRatio,
      };
      const { probability, needsHumanReview } = classify(features);
      const rawPayload = buildRawPayload(row, triggerType);

      const event: SignalEvent = {
        id: randomUUID(),
        company_id: company.id,
        trigger_type: triggerType,
        raw_payload: rawPayload,
        classifier_features: features,
        classifier_probability: probability,
        decision: needsHumanReview ? "pending" : "auto",
        simulated: false,
        created_at: monthTimestamp(row.month),
      };
      signalEvents.push(event);

      if (needsHumanReview) {
        const coverageLine = TRIGGER_COVERAGE_LINE[triggerType];
        const currentLimit = coverageForCompany.get(coverageLine);
        // Only a candidate if this company's stage package actually carries
        // that line — otherwise there's no coverage_state row to reference.
        if (currentLimit !== undefined) {
          const list = pendingByCompany.get(company.id) ?? [];
          list.push({ event, coverageLine, currentLimit });
          pendingByCompany.set(company.id, list);
        }
      }
    }
  }

  {
    const { error } = await supabase
      .from(TABLES.signalEvents)
      .insert(signalEvents);
    if (error) throw new Error(`signal_events insert failed: ${error.message}`);
  }

  console.log("Opening 3-4 pending_approvals across distinct companies...");
  const companiesWithPending = [...pendingByCompany.entries()];
  const openCount = Math.min(4, Math.max(3, Math.min(companiesWithPending.length, 4)));
  const chosen = companiesWithPending.slice(0, openCount);

  const approvals: PendingApproval[] = chosen.map(([companyId, candidates]) => {
    // Most recent qualifying month for this company.
    const { event, coverageLine, currentLimit } = candidates[candidates.length - 1];
    const company = companies.find((c) => c.id === companyId)!;
    const proposedLimit = computeProposedLimit(
      currentLimit,
      event.trigger_type,
      event.classifier_features,
    );
    return {
      id: randomUUID(),
      company_id: companyId,
      signal_event_id: event.id,
      coverage_line: coverageLine,
      proposed_limit: proposedLimit,
      current_limit: currentLimit,
      recommendation_text: recommendationText(
        company.name,
        event.trigger_type,
        coverageLine,
        currentLimit,
        proposedLimit,
        event.raw_payload,
      ),
      status: "open",
      created_at: event.created_at,
      resolved_at: null,
    };
  });

  if (approvals.length < 3) {
    throw new Error(
      `only found ${approvals.length} companies with a pending signal — need at least 3. ` +
        "Re-run (classifier decisions depend on the csv slice) or widen the company slice.",
    );
  }

  {
    const { error } = await supabase
      .from(TABLES.pendingApprovals)
      .insert(approvals);
    if (error) throw new Error(`pending_approvals insert failed: ${error.message}`);
  }

  console.log("\nDone.");
  console.log(`  companies:          ${companies.length}`);
  console.log(`  coverage_state:     ${coverageRows.length}`);
  console.log(`  signal_events:      ${signalEvents.length}`);
  console.log(`  pending_approvals:  ${approvals.length} (open)`);
  console.log("\nRun `npx tsx scripts/verify-db.ts` to confirm.");
}

main().catch((error) => {
  console.error("\nseed failed:", error);
  process.exit(1);
});
