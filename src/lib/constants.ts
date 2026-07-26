// FROZEN CONTRACT — do not edit after Phase 0.
//
// Every magic number and lookup table the build shares. If a value needs to be
// explained live to a judge ("how did you calculate that?"), it lives here with
// the reasoning attached.

import type {
  ClassifierFeatureName,
  CoverageLine,
  StagePackage,
  TriggerType,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Coverage lines                                                             */
/* -------------------------------------------------------------------------- */

/** Corgi's nine real coverage lines, in the order the Coverage Panel renders. */
export const COVERAGE_LINES: readonly CoverageLine[] = [
  "CGL",
  "DO",
  "TECH_EO",
  "CYBER",
  "EPLI",
  "MEDIA_LIABILITY",
  "HNOA",
  "FIDUCIARY",
  "REP_WARRANTIES",
] as const;

/** Display names, using Corgi's own naming (docs/02) — not our paraphrase. */
export const COVERAGE_LINE_LABELS: Record<CoverageLine, string> = {
  CGL: "CGL",
  DO: "D&O",
  TECH_EO: "Tech E&O",
  CYBER: "Cyber",
  EPLI: "EPLI",
  MEDIA_LIABILITY: "Media Liability",
  HNOA: "HNOA",
  FIDUCIARY: "Fiduciary",
  REP_WARRANTIES: "Rep & Warranties",
};

/** Expanded names, for tooltips and the explainability copy. */
export const COVERAGE_LINE_FULL_NAMES: Record<CoverageLine, string> = {
  CGL: "Commercial General Liability",
  DO: "Directors & Officers",
  TECH_EO: "Technology Errors & Omissions",
  CYBER: "Cyber Liability",
  EPLI: "Employment Practices Liability",
  MEDIA_LIABILITY: "Media Liability",
  HNOA: "Hired & Non-Owned Auto",
  FIDUCIARY: "Fiduciary Liability",
  REP_WARRANTIES: "Representations & Warranties",
};

/* -------------------------------------------------------------------------- */
/* Stage packages                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Corgi sells stage-based packages: Pre-Seed & Seed / Series A / Growth, each
 * bundling a different set of lines (docs/02). The stage *names* are Corgi's;
 * the exact line composition below is our own reasonable reading, since Corgi
 * doesn't publish the per-package breakdown. Don't present it as theirs.
 */
export const STAGE_PACKAGE_LABELS: Record<StagePackage, string> = {
  pre_seed_seed: "Pre-Seed & Seed",
  series_a: "Series A",
  growth: "Growth Stage",
};

export const STAGE_PACKAGE_LINES: Record<StagePackage, readonly CoverageLine[]> =
  {
    pre_seed_seed: ["CGL", "DO", "TECH_EO", "CYBER", "EPLI"],
    series_a: ["CGL", "DO", "TECH_EO", "CYBER", "EPLI", "HNOA", "MEDIA_LIABILITY"],
    growth: [
      "CGL",
      "DO",
      "TECH_EO",
      "CYBER",
      "EPLI",
      "HNOA",
      "MEDIA_LIABILITY",
      "FIDUCIARY",
      "REP_WARRANTIES",
    ],
  };

/** Starting limits per stage, before any signal moves them. */
export const STAGE_BASE_LIMITS: Record<StagePackage, number> = {
  pre_seed_seed: 1_000_000,
  series_a: 2_000_000,
  growth: 5_000_000,
};

/* -------------------------------------------------------------------------- */
/* Trigger -> coverage line                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which line a trigger moves. The three Tier 1 mappings come from what the
 * signal actually exposes the company to:
 *   hire     -> EPLI     (employment practices risk scales with headcount)
 *   funding  -> D&O      (new investors mean new board/officer exposure)
 *   contract -> Tech E&O (bigger customer commitments, bigger E&O exposure)
 * The two Tier 2 entries exist so the map is total; nothing in Tier 1 emits them.
 */
export const TRIGGER_COVERAGE_LINE: Record<TriggerType, CoverageLine> = {
  hire: "EPLI",
  funding: "DO",
  contract: "TECH_EO",
  burn: "DO",
  security_incident: "CYBER",
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  hire: "New hire",
  funding: "Funding round",
  contract: "New contract",
  burn: "Burn rate change",
  security_incident: "Security incident",
};

/** Which Merge category each trigger is sourced from, for the audit trail. */
export const TRIGGER_MERGE_CATEGORY: Record<TriggerType, string> = {
  hire: "hris",
  funding: "accounting",
  contract: "crm",
  burn: "accounting",
  security_incident: "ticketing",
};

/* -------------------------------------------------------------------------- */
/* Scaling rule constants                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A single AUTO step can never more than double a limit. This is the guardrail
 * that keeps the auto path from producing an absurd number on screen — if the
 * signal implies more than 2x, that's exactly the kind of change a human should
 * be looking at, and the classifier should already have routed it to PENDING.
 */
export const MAX_SINGLE_STEP_MULTIPLIER = 2;

/** New limits round to the nearest $250K so they read like real policy numbers. */
export const LIMIT_ROUNDING_INCREMENT = 250_000;

/** Floor for any coverage line, so rounding can never zero one out. */
export const MIN_COVERAGE_LIMIT = 250_000;

/**
 * The training-set mean of `cash_inflow_spike_ratio` (2.8819833…, see
 * ml/classifier_weights.json). Used as the neutral value for the real company's
 * funding feature: Zoho Books Invoices are receivables and cannot represent an
 * equity injection (docs/05), so feeding the training mean makes that feature
 * contribute exactly zero to the standardized score rather than faking a signal.
 */
export const NEUTRAL_FUNDING_SIGNAL = 2.88;

/* -------------------------------------------------------------------------- */
/* Display helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Human-readable names for the four classifier features. */
export const FEATURE_LABELS: Record<ClassifierFeatureName, string> = {
  headcountGrowthRatePct: "Headcount growth rate",
  newHiresThisMonth: "New hires this month",
  cashInflowSpikeRatio: "Cash inflow spike",
  dealSizeRatio: "Deal size vs. typical",
};

/** Supabase table names, in one place so nothing hardcodes a string typo. */
export const TABLES = {
  companies: "companies",
  coverageState: "coverage_state",
  signalEvents: "signal_events",
  activityLog: "activity_log",
  pendingApprovals: "pending_approvals",
} as const;

/** No public Corgi API exists — the "send to Corgi" action deep-links here. */
export const CORGI_PUBLIC_URL = "https://corgi.insure/startup-insurance";
