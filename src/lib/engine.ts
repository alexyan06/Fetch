// FROZEN CONTRACT (signatures) — bodies land in the decision-engine task.
//
// The decision engine: signal event -> classifier -> AUTO path or PENDING path.
// Signatures are real so the API layer can be written against them before the
// implementations exist. Every body throws until it's filled in.

import type {
  ActivityLogEntry,
  ClassifierFeatures,
  Company,
  CoverageLine,
  CoverageUpdate,
  PendingApproval,
  ProcessSignalInput,
  ProcessSignalResult,
  SimulateMagnitude,
  SignalEvent,
  TriggerType,
} from "@/lib/types";

/**
 * Compute the four classifier features for a company from a new signal plus
 * that company's recent `signal_events` history.
 */
export async function computeFeatures(
  company: Company,
  triggerType: TriggerType,
  observation: Record<string, number>,
): Promise<ClassifierFeatures> {
  void company;
  void triggerType;
  void observation;
  throw new Error("not implemented");
}

/**
 * The AUTO-path scaling rule. Deliberately simple and explainable — not another
 * model. Applies MAX_SINGLE_STEP_MULTIPLIER, rounds to LIMIT_ROUNDING_INCREMENT,
 * and never returns below MIN_COVERAGE_LIMIT.
 */
export function computeNewLimit(
  currentLimit: number,
  coverageLine: CoverageLine,
  features: ClassifierFeatures,
  triggerType: TriggerType,
): number {
  void currentLimit;
  void coverageLine;
  void features;
  void triggerType;
  throw new Error("not implemented");
}

/**
 * Full pipeline for one signal: persist the `signal_events` row, classify, then
 * branch — AUTO updates `coverage_state` immediately, PENDING creates a
 * `pending_approvals` row and changes nothing. Both write to `activity_log`.
 */
export async function processSignalEvent(
  input: ProcessSignalInput,
): Promise<ProcessSignalResult> {
  void input;
  throw new Error("not implemented");
}

/** Plain-language recommendation text for the Pending Approvals card. */
export function generateRecommendationText(
  company: Company,
  event: SignalEvent,
  coverageLine: CoverageLine,
  currentLimit: number,
  proposedLimit: number,
): string {
  void company;
  void event;
  void coverageLine;
  void currentLimit;
  void proposedLimit;
  throw new Error("not implemented");
}

/**
 * Apply a pending recommendation. Runs the same coverage_state update and
 * activity_log write as the AUTO path, tagged `approved`.
 */
export async function approvePendingApproval(
  approvalId: string,
  approvedBy?: string,
): Promise<{
  approval: PendingApproval;
  coverageUpdate: CoverageUpdate;
  activityLogEntry: ActivityLogEntry;
}> {
  void approvalId;
  void approvedBy;
  throw new Error("not implemented");
}

/** Resolve a pending recommendation without applying anything. */
export async function dismissPendingApproval(
  approvalId: string,
  dismissedBy?: string,
  reason?: string,
): Promise<{
  approval: PendingApproval;
  activityLogEntry: ActivityLogEntry;
}> {
  void approvalId;
  void dismissedBy;
  void reason;
  throw new Error("not implemented");
}

/**
 * Build a plausible observation for the Simulate Event tool — a routine
 * magnitude should classify AUTO, a large one should classify PENDING.
 */
export function buildSimulatedObservation(
  triggerType: TriggerType,
  magnitude: SimulateMagnitude,
): ClassifierFeatures {
  void triggerType;
  void magnitude;
  throw new Error("not implemented");
}
