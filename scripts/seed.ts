/**
 * Lane B T3 — synthetic portfolio seed.
 *
 *   npx tsx scripts/seed.ts                     full seed (destructive-ish)
 *   npx tsx scripts/seed.ts backfill-activity   activity_log only, safe to repeat
 *
 * FULL SEED seeds 16 synthetic companies with 12 months of signal_events history
 * each (sourced from ml/training_data.csv), a starting coverage_state per company
 * from its stage package, and 3-4 pre-opened pending_approvals so the
 * "needs attention" sort has something to show on first load.
 *
 * Idempotent-ish: run against an empty portfolio. Re-running adds another 16
 * companies rather than upserting — clear the tables first if re-seeding.
 *
 * BACKFILL MODE repairs the original seed's omission: it wrote signal_events but
 * no activity_log rows, so every synthetic company's Activity Feed read "No
 * activity yet" despite having 12 months of history — and the corgi mascot, which
 * subscribes to activity_log inserts, could never fire. Backfill reads the
 * signal_events that already exist and writes one activity_log row per event. It
 * touches nothing else, and it is genuinely idempotent: rows are keyed off
 * signal_event_id, so a second run is a no-op rather than a duplicate.
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
import {
  buildAutoExplanation,
  buildPendingExplanation,
  type RecommendationInput,
} from "../src/lib/engine/recommendation";
import { computeNewLimit } from "../src/lib/engine/scaling";
import { classify } from "../src/lib/ml/classifier";
import { getSupabaseServerClient } from "../src/lib/supabase";
import type {
  ActivityLogEntry,
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
/* Backfill — one activity_log row per existing signal_event                  */
/* -------------------------------------------------------------------------- */

/** The subset of `companies` the replay needs. */
export interface BackfillCompany {
  id: string;
  name: string;
  stage: StagePackage;
}

/** The subset of `signal_events` the replay needs. */
export interface BackfillEvent {
  id: string;
  company_id: string;
  trigger_type: TriggerType;
  classifier_features: ClassifierFeatures;
  classifier_probability: number;
  decision: "auto" | "pending";
  created_at: string;
}

/**
 * Replay a company's history forward to recover the old -> new transition each
 * AUTO event implied.
 *
 * The original seed inserted every event but never applied any of them, so
 * "what did this event change?" isn't recorded anywhere — it has to be
 * recomputed. Walking chronologically and carrying the limit forward is the only
 * reading that produces a coherent feed: the alternative, quoting the same
 * starting limit on all twelve months, would show a company "moving" EPLI from
 * $1M to $2M a dozen times over.
 *
 * All arithmetic and all copy come from src/lib/engine — computeNewLimit and the
 * two explanation builders — so a backfilled row is indistinguishable from one
 * the live engine would have written for the same event. Nothing is duplicated
 * here.
 *
 * Pure: no I/O, so the output can be previewed without touching the database.
 */
export function buildActivityRows(
  companies: readonly BackfillCompany[],
  events: readonly BackfillEvent[],
  startingLimits: ReadonlyMap<string, ReadonlyMap<CoverageLine, number>>,
): ActivityLogEntry[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const eventsByCompany = new Map<string, BackfillEvent[]>();
  for (const event of events) {
    const list = eventsByCompany.get(event.company_id) ?? [];
    list.push(event);
    eventsByCompany.set(event.company_id, list);
  }

  const rows: ActivityLogEntry[] = [];

  for (const [companyId, companyEvents] of eventsByCompany) {
    const company = byId.get(companyId);
    if (!company) continue; // Event for a company that no longer exists.

    // Where each line actually stands today, per coverage_state. Falls back to
    // the stage's base limit for a line the company doesn't carry a row for.
    const running = new Map<CoverageLine, number>(
      startingLimits.get(companyId) ?? [],
    );
    const baseLimit = STAGE_BASE_LIMITS[company.stage];

    companyEvents.sort((a, b) => a.created_at.localeCompare(b.created_at));

    for (const event of companyEvents) {
      const coverageLine = TRIGGER_COVERAGE_LINE[event.trigger_type];
      const features = event.classifier_features;
      const currentLimit = running.get(coverageLine) ?? baseLimit;

      const scaling = computeNewLimit(
        event.trigger_type,
        features,
        currentLimit,
        coverageLine,
      );

      const copy: RecommendationInput = {
        companyName: company.name,
        triggerType: event.trigger_type,
        coverageLine,
        features,
        scaling,
        probability: event.classifier_probability,
        // Stored on signal_events as features but not as an attribution, so the
        // classifier re-derives it. Same inputs, same answer.
        topDrivingFeature: classify(features).topDrivingFeature,
      };

      const isAuto = event.decision === "auto";
      // A PENDING event applied nothing, so it neither carries values nor moves
      // the running limit — the next month's transition starts from where the
      // line actually still sits.
      const applied = isAuto && scaling.changed;
      if (applied) running.set(coverageLine, scaling.newLimit);

      rows.push({
        id: randomUUID(),
        company_id: companyId,
        signal_event_id: event.id,
        coverage_line: coverageLine,
        old_value: applied ? scaling.currentLimit : null,
        new_value: applied ? scaling.newLimit : null,
        tag: isAuto ? "auto" : "pending",
        explanation: isAuto
          ? buildAutoExplanation(copy)
          : buildPendingExplanation(copy),
        // The event's own timestamp, so the feed reads as 12 months of history
        // rather than 192 rows all stamped tonight.
        created_at: event.created_at,
      });
    }
  }

  return rows;
}

async function backfillActivity(): Promise<void> {
  loadEnvLocal();
  const supabase = getSupabaseServerClient();

  console.log("Reading existing rows (no writes yet)...");

  const { data: companies, error: companiesError } = await supabase
    .from(TABLES.companies)
    .select("id, name, stage");
  if (companiesError) throw new Error(`companies read failed: ${companiesError.message}`);

  const { data: coverage, error: coverageError } = await supabase
    .from(TABLES.coverageState)
    .select("company_id, coverage_line, current_limit");
  if (coverageError) throw new Error(`coverage_state read failed: ${coverageError.message}`);

  const { data: events, error: eventsError } = await supabase
    .from(TABLES.signalEvents)
    .select(
      "id, company_id, trigger_type, classifier_features, classifier_probability, decision, created_at",
    )
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(`signal_events read failed: ${eventsError.message}`);

  const { data: existing, error: existingError } = await supabase
    .from(TABLES.activityLog)
    .select("signal_event_id");
  if (existingError) throw new Error(`activity_log read failed: ${existingError.message}`);

  const alreadyLogged = new Set(
    (existing ?? [])
      .map((r) => (r as { signal_event_id: string | null }).signal_event_id)
      .filter((id): id is string => Boolean(id)),
  );

  const startingLimits = new Map<string, Map<CoverageLine, number>>();
  for (const row of (coverage ?? []) as {
    company_id: string;
    coverage_line: CoverageLine;
    current_limit: number;
  }[]) {
    const lines = startingLimits.get(row.company_id) ?? new Map();
    lines.set(row.coverage_line, Number(row.current_limit));
    startingLimits.set(row.company_id, lines);
  }

  console.log(
    `  companies: ${companies?.length ?? 0}  signal_events: ${events?.length ?? 0}  ` +
      `activity_log already present: ${alreadyLogged.size}`,
  );

  // Replay every event, including ones already logged: the running limit has to
  // walk the full history or a partial re-run would compute the wrong
  // transition for the events that remain.
  const allRows = buildActivityRows(
    (companies ?? []) as BackfillCompany[],
    (events ?? []) as BackfillEvent[],
    startingLimits,
  );
  const toInsert = allRows.filter(
    (row) => row.signal_event_id && !alreadyLogged.has(row.signal_event_id),
  );

  if (toInsert.length === 0) {
    console.log("\nNothing to backfill — every signal_event already has an activity_log row.");
    console.log("Run `npx tsx scripts/verify-db.ts` to confirm.");
    return;
  }

  console.log(`Inserting ${toInsert.length} activity_log rows...`);
  const CHUNK = 200;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error } = await supabase
      .from(TABLES.activityLog)
      .insert(toInsert.slice(i, i + CHUNK));
    if (error) throw new Error(`activity_log insert failed: ${error.message}`);
  }

  const autoCount = toInsert.filter((r) => r.tag === "auto").length;
  console.log("\nDone.");
  console.log(`  activity_log inserted: ${toInsert.length}`);
  console.log(`    auto:    ${autoCount}`);
  console.log(`    pending: ${toInsert.length - autoCount}`);
  console.log(`  skipped (already logged): ${allRows.length - toInsert.length}`);
  console.log("\nRun `npx tsx scripts/verify-db.ts` to confirm.");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function seedAll(): Promise<void> {
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
  console.log("Then `npx tsx scripts/seed.ts backfill-activity` to write the feed.");
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "backfill-activity") {
    await backfillActivity();
    return;
  }

  if (mode && mode !== "--force") {
    throw new Error(
      `unknown mode "${mode}". Use no argument for a full seed, or "backfill-activity".`,
    );
  }

  // The full seed is not idempotent — it inserts, it doesn't upsert — so running
  // it against an already-seeded database silently doubles the portfolio. Refuse
  // rather than discover that during a demo.
  if (mode !== "--force") {
    loadEnvLocal();
    const { count, error } = await getSupabaseServerClient()
      .from(TABLES.companies)
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(`companies precheck failed: ${error.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        `refusing to re-seed: ${count} company/ies already exist and this seed inserts rather than upserts.\n` +
          "  - to add the missing Activity Feed rows:  npx tsx scripts/seed.ts backfill-activity\n" +
          "  - to seed anyway (duplicates portfolio):  npx tsx scripts/seed.ts --force",
      );
    }
  }

  await seedAll();
}

// Only self-execute when run as a script. buildActivityRows is pure and worth
// importing (to preview a backfill, or to test the replay) — importing must not
// fire off a seed. Compared against argv rather than import.meta, which isn't
// available under every module setting tsx might pick.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (/[\\/]seed\.(ts|js)$/.test(invokedPath)) {
  main().catch((error) => {
    console.error("\nseed failed:", error);
    process.exit(1);
  });
}
