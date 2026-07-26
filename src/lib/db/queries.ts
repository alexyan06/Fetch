// The only module that talks to Supabase on the server.
//
// Everything above this layer (the engine, the Merge sync) is pure. Everything
// below is SQL. Keeping the boundary sharp is what lets the decision logic be
// tested without a database, and it means there is exactly one place to look
// when a write goes wrong.
//
// Service-role client throughout — these run in API routes only, never in a
// "use client" file.

import { TABLES } from "@/lib/constants";
import { getSupabaseServerClient } from "@/lib/supabase";
import type {
  ActivityLogEntry,
  ActivityTag,
  ApprovalStatus,
  ClassifierFeatures,
  Company,
  CoverageLine,
  CoverageState,
  Decision,
  PendingApproval,
  PortfolioCompany,
  SignalEvent,
  SignalRawPayload,
  TriggerType,
} from "@/lib/types";

/** Supabase returns `{ data, error }`; collapse that to a throw at the boundary. */
function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${context}: no data returned`);
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                  */
/* -------------------------------------------------------------------------- */

export async function getCompany(companyId: string): Promise<Company | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLES.companies)
    .select("*")
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw new Error(`getCompany: ${error.message}`);
  return (data as Company | null) ?? null;
}

/** Every company flowing through the real Merge pipeline. Usually exactly one. */
export async function listRealCompanies(): Promise<Company[]> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.companies)
    .select("*")
    .eq("source", "real");
  return unwrap(result, "listRealCompanies") as Company[];
}

/* -------------------------------------------------------------------------- */
/* Coverage state                                                             */
/* -------------------------------------------------------------------------- */

export async function getCoverageState(
  companyId: string,
  coverageLine: CoverageLine,
): Promise<CoverageState | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLES.coverageState)
    .select("*")
    .eq("company_id", companyId)
    .eq("coverage_line", coverageLine)
    .maybeSingle();

  if (error) throw new Error(`getCoverageState: ${error.message}`);
  return (data as CoverageState | null) ?? null;
}

export async function listCoverageState(
  companyId: string,
): Promise<CoverageState[]> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.coverageState)
    .select("*")
    .eq("company_id", companyId);
  return unwrap(result, "listCoverageState") as CoverageState[];
}

/**
 * Apply a new limit to one line.
 *
 * Takes the value to write rather than computing one. Every caller — the AUTO
 * path and Approve alike — passes a number the engine already decided, which is
 * what guarantees an approval card can never promise one figure and apply
 * another.
 */
export async function applyCoverageLimit(
  companyId: string,
  coverageLine: CoverageLine,
  newLimit: number,
): Promise<CoverageState> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.coverageState)
    .update({ current_limit: newLimit, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("coverage_line", coverageLine)
    .select()
    .single();
  return unwrap(result, "applyCoverageLimit") as CoverageState;
}

/* -------------------------------------------------------------------------- */
/* Signal events                                                              */
/* -------------------------------------------------------------------------- */

export interface InsertSignalEventInput {
  companyId: string;
  triggerType: TriggerType;
  rawPayload: SignalRawPayload;
  features: ClassifierFeatures;
  probability: number;
  decision: Decision;
  simulated: boolean;
}

export async function insertSignalEvent(
  input: InsertSignalEventInput,
): Promise<SignalEvent> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.signalEvents)
    .insert({
      company_id: input.companyId,
      trigger_type: input.triggerType,
      raw_payload: input.rawPayload,
      classifier_features: input.features,
      // Stored unclamped. The 99.9% cap in recommendation.ts is display-only.
      classifier_probability: input.probability,
      decision: input.decision,
      simulated: input.simulated,
    })
    .select()
    .single();
  return unwrap(result, "insertSignalEvent") as SignalEvent;
}

/** Recent events for one company, newest first. Drives the engine's standing. */
export async function listRecentSignalEvents(
  companyId: string,
  limit = 24,
): Promise<SignalEvent[]> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.signalEvents)
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap(result, "listRecentSignalEvents") as SignalEvent[];
}

/* -------------------------------------------------------------------------- */
/* Activity log                                                               */
/* -------------------------------------------------------------------------- */

export interface InsertActivityInput {
  companyId: string;
  signalEventId: string | null;
  coverageLine: CoverageLine | null;
  oldValue: number | null;
  newValue: number | null;
  tag: ActivityTag;
  explanation: string;
}

export async function insertActivityLog(
  input: InsertActivityInput,
): Promise<ActivityLogEntry> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.activityLog)
    .insert({
      company_id: input.companyId,
      signal_event_id: input.signalEventId,
      coverage_line: input.coverageLine,
      old_value: input.oldValue,
      new_value: input.newValue,
      tag: input.tag,
      explanation: input.explanation,
    })
    .select()
    .single();
  return unwrap(result, "insertActivityLog") as ActivityLogEntry;
}

export async function listActivityLog(
  companyId: string,
  limit = 50,
): Promise<ActivityLogEntry[]> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.activityLog)
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap(result, "listActivityLog") as ActivityLogEntry[];
}

/* -------------------------------------------------------------------------- */
/* Pending approvals                                                          */
/* -------------------------------------------------------------------------- */

export interface InsertApprovalInput {
  companyId: string;
  signalEventId: string;
  coverageLine: CoverageLine;
  proposedLimit: number;
  currentLimit: number;
  recommendationText: string;
}

export async function insertPendingApproval(
  input: InsertApprovalInput,
): Promise<PendingApproval> {
  const supabase = getSupabaseServerClient();
  const result = await supabase
    .from(TABLES.pendingApprovals)
    .insert({
      company_id: input.companyId,
      signal_event_id: input.signalEventId,
      coverage_line: input.coverageLine,
      proposed_limit: input.proposedLimit,
      current_limit: input.currentLimit,
      recommendation_text: input.recommendationText,
      status: "open",
    })
    .select()
    .single();
  return unwrap(result, "insertPendingApproval") as PendingApproval;
}

export async function getApproval(
  approvalId: string,
): Promise<PendingApproval | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLES.pendingApprovals)
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) throw new Error(`getApproval: ${error.message}`);
  return (data as PendingApproval | null) ?? null;
}

/**
 * Close out an approval.
 *
 * Guarded on `status = 'open'` so a double-click, a retried request, or two
 * people hitting Approve at once resolves exactly once. The second caller gets
 * null back and the route turns that into a 409 rather than applying the change
 * twice.
 */
export async function resolveApproval(
  approvalId: string,
  status: Extract<ApprovalStatus, "approved" | "dismissed">,
): Promise<PendingApproval | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLES.pendingApprovals)
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", approvalId)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (error) throw new Error(`resolveApproval: ${error.message}`);
  return (data as PendingApproval | null) ?? null;
}

export async function listOpenApprovals(
  companyId?: string,
): Promise<PendingApproval[]> {
  const supabase = getSupabaseServerClient();
  let query = supabase
    .from(TABLES.pendingApprovals)
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (companyId) query = query.eq("company_id", companyId);

  const result = await query;
  return unwrap(result, "listOpenApprovals") as PendingApproval[];
}

/* -------------------------------------------------------------------------- */
/* Portfolio view                                                             */
/* -------------------------------------------------------------------------- */

/** An open approval outranks any amount of recent routine activity. */
const ATTENTION_PER_OPEN_APPROVAL = 100;

/** Activity in the last 24h is worth noticing, decaying to nothing over a week. */
const ATTENTION_RECENCY_MAX = 20;
const ATTENTION_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function attentionScore(
  openApprovals: number,
  lastActivityAt: string | null,
  now: number,
): number {
  const approvals = openApprovals * ATTENTION_PER_OPEN_APPROVAL;
  if (!lastActivityAt) return approvals;

  const age = now - Date.parse(lastActivityAt);
  if (!Number.isFinite(age) || age < 0) return approvals + ATTENTION_RECENCY_MAX;

  const decay = Math.max(0, 1 - age / ATTENTION_RECENCY_WINDOW_MS);
  return approvals + decay * ATTENTION_RECENCY_MAX;
}

/**
 * The portfolio dashboard's payload, sorted by "needs attention".
 *
 * Four bulk reads and an in-memory join rather than per-company queries: at 17
 * companies the round-trip count matters far more than the row count, and this
 * keeps the dashboard's first paint off a 17-query waterfall.
 */
export async function listPortfolio(): Promise<{
  companies: PortfolioCompany[];
  totalOpenApprovals: number;
}> {
  const supabase = getSupabaseServerClient();

  const companies = unwrap(
    await supabase.from(TABLES.companies).select("*").order("name"),
    "listPortfolio/companies",
  ) as Company[];

  const coverage = unwrap(
    await supabase
      .from(TABLES.coverageState)
      .select("company_id, current_limit"),
    "listPortfolio/coverage",
  ) as Array<{ company_id: string; current_limit: number }>;

  const openApprovals = unwrap(
    await supabase
      .from(TABLES.pendingApprovals)
      .select("company_id")
      .eq("status", "open"),
    "listPortfolio/approvals",
  ) as Array<{ company_id: string }>;

  const activity = unwrap(
    await supabase
      .from(TABLES.activityLog)
      .select("company_id, tag, created_at")
      .order("created_at", { ascending: false }),
    "listPortfolio/activity",
  ) as Array<{ company_id: string; tag: ActivityTag; created_at: string }>;

  const totalsByCompany = new Map<string, number>();
  for (const row of coverage) {
    totalsByCompany.set(
      row.company_id,
      (totalsByCompany.get(row.company_id) ?? 0) + Number(row.current_limit),
    );
  }

  const approvalsByCompany = new Map<string, number>();
  for (const row of openApprovals) {
    approvalsByCompany.set(
      row.company_id,
      (approvalsByCompany.get(row.company_id) ?? 0) + 1,
    );
  }

  // Ordered newest-first above, so the first sighting per company is the latest.
  const latestActivity = new Map<
    string,
    { tag: ActivityTag; created_at: string }
  >();
  for (const row of activity) {
    if (!latestActivity.has(row.company_id)) {
      latestActivity.set(row.company_id, row);
    }
  }

  const now = Date.now();
  const rows: PortfolioCompany[] = companies.map((company) => {
    const openCount = approvalsByCompany.get(company.id) ?? 0;
    const last = latestActivity.get(company.id) ?? null;
    return {
      id: company.id,
      name: company.name,
      source: company.source,
      stage: company.stage,
      open_approvals_count: openCount,
      total_coverage: totalsByCompany.get(company.id) ?? 0,
      last_activity_at: last?.created_at ?? null,
      last_activity_tag: last?.tag ?? null,
      attention_score: attentionScore(openCount, last?.created_at ?? null, now),
    };
  });

  rows.sort(
    (a, b) => b.attention_score - a.attention_score || a.name.localeCompare(b.name),
  );

  return { companies: rows, totalOpenApprovals: openApprovals.length };
}
