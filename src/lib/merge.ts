// FROZEN CONTRACT (signatures) — bodies land in the Merge integration task.
//
// The real Merge pipeline, used by exactly ONE company (the BambooHR / Zoho
// Books / HubSpot sandbox). Every other company in the portfolio is synthetic
// and never touches this module — branch on `companies.source` before calling.
//
// Auth: Authorization: Bearer <MERGE_API_KEY> + X-Account-Token: <token>.

import type {
  Company,
  MergeCompanySnapshot,
  MergeHireRecord,
  MergeOpportunityRecord,
  MergeTransactionRecord,
  ProcessSignalResult,
  SimulateMagnitude,
  TriggerType,
} from "@/lib/types";

/**
 * HRIS `Employee` + `Employment`. PENDING counts as a hire immediately — do not
 * wait for ACTIVE (docs/01).
 */
export async function fetchHires(
  accountToken: string,
  modifiedAfter?: string,
): Promise<MergeHireRecord[]> {
  void accountToken;
  void modifiedAfter;
  throw new Error("not implemented");
}

/**
 * Accounting `Transaction`. Note: Zoho Books Invoices are receivables and
 * cannot represent an equity injection, so the real company's funding feature
 * stays at NEUTRAL_FUNDING_SIGNAL outside of the Simulate Event tool.
 */
export async function fetchTransactions(
  accountToken: string,
  modifiedAfter?: string,
): Promise<MergeTransactionRecord[]> {
  void accountToken;
  void modifiedAfter;
  throw new Error("not implemented");
}

/** CRM `Opportunity`. Closed-won is `status === "WON"`, not an `is_won` flag. */
export async function fetchOpportunities(
  accountToken: string,
  modifiedAfter?: string,
): Promise<MergeOpportunityRecord[]> {
  void accountToken;
  void modifiedAfter;
  throw new Error("not implemented");
}

/** Pull all three categories for the real company in one pass. */
export async function fetchCompanySnapshot(
  company: Company,
  modifiedAfter?: string,
): Promise<MergeCompanySnapshot> {
  void company;
  void modifiedAfter;
  throw new Error("not implemented");
}

/**
 * Diff a snapshot against what's already in `signal_events` and return the
 * trigger types that genuinely fired this sync.
 */
export async function detectNewSignals(
  company: Company,
  snapshot: MergeCompanySnapshot,
): Promise<Array<{ triggerType: TriggerType; observation: Record<string, number>; summary: string }>> {
  void company;
  void snapshot;
  throw new Error("not implemented");
}

/** Full sync for one real company: fetch -> detect -> classify -> act. */
export async function syncRealCompany(
  company: Company,
): Promise<ProcessSignalResult[]> {
  void company;
  throw new Error("not implemented");
}

/**
 * Tier 2 stretch only. Simulate Event's live-write mode: query Merge's `/meta`
 * endpoint for the required schema, then POST the record into the real sandbox.
 * Tier 1 uses dry-run mode and never calls this.
 */
export async function writeSimulatedRecord(
  company: Company,
  triggerType: TriggerType,
  magnitude: SimulateMagnitude,
): Promise<{ remoteId: string }> {
  void company;
  void triggerType;
  void magnitude;
  throw new Error("not implemented");
}
