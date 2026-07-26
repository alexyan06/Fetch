// FROZEN CONTRACT — do not edit after Phase 0.
//
// Every row shape, enum, API request/response, and shared component prop
// interface in the build lives here. Both lanes import from this file so they
// implement against the same shapes. Adding a field here late is a merge
// conflict in the one file everything depends on — get it right now.
//
// Schema mirrors docs/05-technical-architecture.md ("Data model").

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Corgi's real coverage lines (docs/02). Values are DB-safe codes; the
 * human-readable names ("Tech E&O", "Rep & Warranties") live in
 * COVERAGE_LINE_LABELS in constants.ts.
 */
export type CoverageLine =
  | "CGL"
  | "DO"
  | "TECH_EO"
  | "CYBER"
  | "EPLI"
  | "MEDIA_LIABILITY"
  | "HNOA"
  | "FIDUCIARY"
  | "REP_WARRANTIES";

/**
 * The three Tier 1 triggers come straight from Corgi's own FAQ.
 * `burn` and `security_incident` are Tier 2 widenings — defined now so the
 * enum never has to change, but nothing in Tier 1 emits them.
 */
export type TriggerType =
  | "hire"
  | "funding"
  | "contract"
  | "burn"
  | "security_incident";

/** What the classifier decided to do with a signal event. */
export type Decision = "auto" | "pending";

/** Activity Feed entry tag. Supersets Decision with the two human outcomes. */
export type ActivityTag = "auto" | "pending" | "approved" | "dismissed";

/** Whether a company flows through the real Merge pipeline or is generated. */
export type CompanySource = "real" | "synthetic";

/** Lifecycle of a row in the Pending Approvals queue. */
export type ApprovalStatus = "open" | "approved" | "dismissed";

/** Corgi's stage-based packages (docs/02). Drives which lines a company carries. */
export type StagePackage = "pre_seed_seed" | "series_a" | "growth";

/** Simulate Event magnitude selector — routine should land AUTO, large PENDING. */
export type SimulateMagnitude = "routine" | "large";

/**
 * Simulate Event execution mode. `dry_run` is Tier 1 and skips Merge entirely;
 * `live_write` is the Tier 2 stretch that POSTs to Merge's Write API first.
 */
export type SimulateMode = "dry_run" | "live_write";

/* -------------------------------------------------------------------------- */
/* Classifier features                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The four features the offline scikit-learn model was trained on, in the
 * shape the ported TypeScript classifier consumes. Stored verbatim as the
 * `classifier_features` jsonb column so every decision stays inspectable.
 */
export interface ClassifierFeatures {
  headcountGrowthRatePct: number;
  newHiresThisMonth: number;
  cashInflowSpikeRatio: number;
  dealSizeRatio: number;
}

export type ClassifierFeatureName = keyof ClassifierFeatures;

/* -------------------------------------------------------------------------- */
/* Table rows                                                                 */
/* -------------------------------------------------------------------------- */

/** `companies` */
export interface Company {
  id: string;
  name: string;
  source: CompanySource;
  stage: StagePackage;
  /** Only populated for the one real company. Null for every synthetic one. */
  merge_account_tokens: MergeAccountTokens | null;
  created_at: string;
}

export interface MergeAccountTokens {
  hris?: string;
  accounting?: string;
  crm?: string;
  ticketing?: string;
}

/** `coverage_state` — one row per (company, coverage_line). */
export interface CoverageState {
  id: string;
  company_id: string;
  coverage_line: CoverageLine;
  current_limit: number;
  updated_at: string;
}

/** `signal_events` — append-only, same shape for real / synthetic / simulated. */
export interface SignalEvent {
  id: string;
  company_id: string;
  trigger_type: TriggerType;
  /** The underlying data point(s) — what the Tier 3 "receipt" renders. */
  raw_payload: SignalRawPayload;
  classifier_features: ClassifierFeatures;
  classifier_probability: number;
  decision: Decision;
  /** True when the event came from /api/simulate-event rather than a real sync. */
  simulated: boolean;
  created_at: string;
}

/**
 * Loosely typed on purpose — the payload is whatever Merge returned (or what
 * the generator produced) for this trigger, kept verbatim for the audit trail.
 */
export interface SignalRawPayload {
  summary: string;
  [key: string]: unknown;
}

/** `activity_log` — feeds the Activity Feed UI directly. */
export interface ActivityLogEntry {
  id: string;
  company_id: string;
  signal_event_id: string | null;
  coverage_line: CoverageLine | null;
  old_value: number | null;
  new_value: number | null;
  tag: ActivityTag;
  /** Plain-language "what changed and why". */
  explanation: string;
  created_at: string;
}

/** `pending_approvals` — the queue. */
export interface PendingApproval {
  id: string;
  company_id: string;
  signal_event_id: string;
  coverage_line: CoverageLine;
  /** The limit that would be applied if a human approves. */
  proposed_limit: number;
  current_limit: number;
  recommendation_text: string;
  status: ApprovalStatus;
  created_at: string;
  resolved_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Joined / derived view models                                               */
/* -------------------------------------------------------------------------- */

/** A row in the portfolio dashboard, sorted by "needs attention". */
export interface PortfolioCompany {
  id: string;
  name: string;
  source: CompanySource;
  stage: StagePackage;
  open_approvals_count: number;
  total_coverage: number;
  last_activity_at: string | null;
  last_activity_tag: ActivityTag | null;
  /** Server-computed sort key; higher = more attention needed. */
  attention_score: number;
}

/** Everything the company detail view needs in one payload. */
export interface CompanyDetail {
  company: Company;
  coverage: CoverageState[];
  activity: ActivityLogEntry[];
  approvals: PendingApproval[];
  recent_events: SignalEvent[];
}

/* -------------------------------------------------------------------------- */
/* Shared API envelope                                                        */
/* -------------------------------------------------------------------------- */

export interface ApiError {
  error: string;
  detail?: string;
}

/** Every route returns either its success body or an ApiError with a 4xx/5xx. */
export type ApiResponse<T> = T | ApiError;

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiError).error === "string"
  );
}

/* -------------------------------------------------------------------------- */
/* Route 1 — POST /api/sync                                                   */
/* -------------------------------------------------------------------------- */

export interface SyncRequest {
  /** Omit to sync every real (Merge-backed) company. */
  companyId?: string;
}

/** What one company's sync produced. */
export interface SyncCompanyResult {
  company_id: string;
  company_name: string;
  signal_events_created: number;
  auto_applied: number;
  pending_created: number;
  /** Non-fatal problems (one category failed, rest succeeded). */
  warnings: string[];
}

export interface SyncResponse {
  synced_at: string;
  companies_synced: number;
  signal_events_created: number;
  auto_applied: number;
  pending_created: number;
  results: SyncCompanyResult[];
}

/* -------------------------------------------------------------------------- */
/* Route 2 — POST /api/simulate-event                                         */
/* -------------------------------------------------------------------------- */

export interface SimulateEventRequest {
  companyId: string;
  triggerType: TriggerType;
  magnitude: SimulateMagnitude;
  /** Defaults to "dry_run". "live_write" is the Tier 2 stretch path. */
  mode?: SimulateMode;
}

export interface SimulateEventResponse {
  signal_event: SignalEvent;
  decision: Decision;
  classifier_probability: number;
  top_driving_feature: ClassifierFeatureName;
  /** Present on the AUTO path. */
  coverage_update: CoverageUpdate | null;
  /** Present on the PENDING path. */
  pending_approval: PendingApproval | null;
  activity_log_entry: ActivityLogEntry;
  mode: SimulateMode;
}

/** The old -> new transition the Coverage Panel animates. */
export interface CoverageUpdate {
  coverage_line: CoverageLine;
  old_value: number;
  new_value: number;
}

/* -------------------------------------------------------------------------- */
/* Route 3 — POST /api/approvals/[id]/approve                                 */
/* -------------------------------------------------------------------------- */

export interface ApproveApprovalRequest {
  /** Optional attribution for the audit trail. */
  approvedBy?: string;
}

export interface ApproveApprovalResponse {
  approval: PendingApproval;
  coverage_update: CoverageUpdate;
  activity_log_entry: ActivityLogEntry;
}

/* -------------------------------------------------------------------------- */
/* Route 4 — POST /api/approvals/[id]/dismiss                                 */
/* -------------------------------------------------------------------------- */

export interface DismissApprovalRequest {
  dismissedBy?: string;
  reason?: string;
}

export interface DismissApprovalResponse {
  approval: PendingApproval;
  activity_log_entry: ActivityLogEntry;
}

/* -------------------------------------------------------------------------- */
/* Route 5 — GET /api/companies                                               */
/* -------------------------------------------------------------------------- */

export interface CompaniesResponse {
  companies: PortfolioCompany[];
  total_open_approvals: number;
}

/* -------------------------------------------------------------------------- */
/* Component props — frozen so Lane B implements what Lane A imports          */
/* -------------------------------------------------------------------------- */

/**
 * Corgi mascot behavioural states (docs/12). The whole point of the feature is
 * that these do NOT look alike — confident on auto, deferring on pending.
 */
export type CorgiState =
  | "idle"
  | "confident"
  | "deferring"
  | "relieved"
  | "neutral";

/**
 * `src/components/corgi/index.tsx`
 *
 * Mounted exactly once, in src/app/layout.tsx. Owns its own Supabase realtime
 * subscription on `activity_log` inserts — it does not receive events by prop,
 * which is what lets it be built in parallel with the rest of the UI.
 */
export interface CorgiMascotProps {
  /** Limit announcements to one company. Omit/null = portfolio-wide. */
  companyId?: string | null;
  /** Kill switch for the demo if it ever misbehaves on stage. */
  enabled?: boolean;
  /** Milliseconds each queued announcement stays on screen. Default 4000. */
  announcementDurationMs?: number;
}

/** One bar in the feature-importance chart. */
export interface FeatureImportanceDatum {
  feature: ClassifierFeatureName;
  /** Human-readable axis label, e.g. "Cash inflow spike". */
  label: string;
  /** 0..1, from the trained model's global importances. */
  importance: number;
}

/**
 * `src/components/charts/feature-importance.tsx`
 *
 * Global model importances, with the feature that drove *this* decision
 * highlighted. Honest about the distinction — global vs. per-prediction.
 */
export interface FeatureImportanceChartProps {
  data: FeatureImportanceDatum[];
  /** Highlight the feature that drove this particular prediction. */
  highlightFeature?: ClassifierFeatureName | null;
  className?: string;
}

/** One point on the anomaly trend line. */
export interface AnomalyTrendPoint {
  /** X-axis label, e.g. "Mar" or an ISO date. */
  label: string;
  value: number;
  isAnomaly: boolean;
  zScore?: number;
}

/**
 * `src/components/charts/anomaly-trend.tsx`
 *
 * Trend line for one metric with anomalous points marked in red.
 */
export interface AnomalyTrendChartProps {
  data: AnomalyTrendPoint[];
  /** e.g. "Monthly cash inflow". Used for the axis/tooltip label. */
  metricLabel: string;
  /** |z| cutoff the points were flagged at. Default 2.0. */
  threshold?: number;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Engine input/output shapes                                                 */
/* -------------------------------------------------------------------------- */

/** Everything the decision engine needs to process one signal. */
export interface ProcessSignalInput {
  company: Company;
  triggerType: TriggerType;
  features: ClassifierFeatures;
  rawPayload: SignalRawPayload;
  simulated: boolean;
}

/** What the engine did — mirrors SimulateEventResponse's decision half. */
export interface ProcessSignalResult {
  signalEvent: SignalEvent;
  decision: Decision;
  coverageUpdate: CoverageUpdate | null;
  pendingApproval: PendingApproval | null;
  activityLogEntry: ActivityLogEntry;
}

/** Raw per-category data pulled from Merge for the one real company. */
export interface MergeCompanySnapshot {
  companyId: string;
  pulledAt: string;
  hires: MergeHireRecord[];
  transactions: MergeTransactionRecord[];
  opportunities: MergeOpportunityRecord[];
}

export interface MergeHireRecord {
  id: string;
  name: string;
  /** PENDING counts as a hire immediately — do not wait for ACTIVE (docs/01). */
  employmentStatus: string;
  startDate: string | null;
}

export interface MergeTransactionRecord {
  id: string;
  amount: number;
  date: string | null;
  description: string | null;
}

export interface MergeOpportunityRecord {
  id: string;
  name: string;
  amount: number;
  /** HubSpot maps closed-won to status === "WON", not an `is_won` boolean. */
  status: string;
  closeDate: string | null;
}
