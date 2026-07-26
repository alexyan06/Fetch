// Change detection + feature translation for the one Merge-backed company.
//
// Two jobs, kept deliberately separate:
//
//   1. CHANGE DETECTION — "did anything new actually arrive since last sync?"
//      Driven by a per-category `modified_after` watermark, with a `remote_id`
//      diff as the backstop for when a manual Force Resync makes Merge's
//      timestamps behave oddly (which it does, and we rely on Force Resync for
//      the live demo).
//
//   2. FEATURE COMPUTATION — "what is this company's standing right now?"
//      Windowed over the full snapshot, not over the delta. Every row the
//      classifier was trained on was a monthly snapshot with all four features
//      present, so serving has to match: all four, always populated, computed
//      the same way (see ml/generate_training_data.py).
//
// This module performs no database I/O. `/api/sync` owns persistence and passes
// the cursor in.

import { NEUTRAL_FUNDING_SIGNAL } from "@/lib/constants";
import type {
  ClassifierFeatures,
  Company,
  MergeCompanySnapshot,
  MergeHireRecord,
  MergeOpportunityRecord,
  MergeTransactionRecord,
  SignalRawPayload,
  TriggerType,
} from "@/lib/types";

import {
  fetchCompanySnapshotResilient,
  type MergeCategory,
  type RemoteIdIndex,
  type SyncWatermarks,
} from "./client";

/* -------------------------------------------------------------------------- */
/* Windowing constants                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A PENDING employee counts as a hire once their start date is this close
 * (docs/01 — "PENDING with a near-term start_date counts as a hire, don't wait
 * for ACTIVE"). Onboarding exposure starts at signing, not at day one, which is
 * exactly why EPLI has to move before the status flips.
 */
const NEAR_TERM_START_WINDOW_DAYS = 90;

/** "This month" for `newHiresThisMonth`, matching the training snapshot period. */
const HIRE_LOOKBACK_DAYS = 30;

/** How far back a won deal still counts as the company's current standing. */
const DEAL_LOOKBACK_DAYS = 90;

/** An invoice this many times the company's median counts as a big contract. */
const LARGE_INVOICE_MULTIPLE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Cursor                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What `/api/sync` persists between runs. Both halves matter:
 * `watermarks` keeps the request cheap, `seenRemoteIds` keeps it correct when a
 * Force Resync rewrites `modified_at` on records we've already processed.
 */
export interface SyncCursor {
  watermarks: SyncWatermarks;
  seenRemoteIds: Partial<Record<MergeCategory, readonly string[]>>;
}

export const EMPTY_CURSOR: SyncCursor = { watermarks: {}, seenRemoteIds: {} };

/**
 * Identity used for the diff: the third-party `remote_id` when Merge resolved
 * one, otherwise Merge's own id. A Force Resync can mint fresh Merge ids for
 * records the source system considers unchanged; `remote_id` doesn't move.
 */
function identityOf(record: { id: string }, remoteIds: RemoteIdIndex): string {
  return remoteIds[record.id] ?? record.id;
}

export interface SnapshotDiff {
  newHires: MergeHireRecord[];
  newTransactions: MergeTransactionRecord[];
  newOpportunities: MergeOpportunityRecord[];
  /** The cursor to persist after this sync is processed. */
  nextCursor: SyncCursor;
}

/** Split a snapshot into "already processed" and "new since last sync". */
export function diffSnapshot(
  snapshot: MergeCompanySnapshot,
  remoteIds: RemoteIdIndex,
  cursor: SyncCursor = EMPTY_CURSOR,
): SnapshotDiff {
  function pick<T extends { id: string }>(
    category: MergeCategory,
    records: T[],
  ): { fresh: T[]; identities: string[] } {
    const seen = new Set(cursor.seenRemoteIds[category] ?? []);
    const identities = records.map((record) => identityOf(record, remoteIds));
    const fresh = records.filter((_, i) => !seen.has(identities[i]));
    // Union, not replace: a `modified_after` pull returns only the delta, so
    // dropping the prior ids would make every record look new next time.
    return { fresh, identities: [...new Set([...seen, ...identities])] };
  }

  const hris = pick("hris", snapshot.hires);
  const accounting = pick("accounting", snapshot.transactions);
  const crm = pick("crm", snapshot.opportunities);

  return {
    newHires: hris.fresh,
    newTransactions: accounting.fresh,
    newOpportunities: crm.fresh,
    nextCursor: {
      watermarks: {
        hris: snapshot.pulledAt,
        accounting: snapshot.pulledAt,
        crm: snapshot.pulledAt,
      },
      seenRemoteIds: {
        hris: hris.identities,
        accounting: accounting.identities,
        crm: crm.identities,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Record predicates                                                          */
/* -------------------------------------------------------------------------- */

function daysFromNow(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (parsed - now.getTime()) / DAY_MS;
}

/**
 * Does this employee count toward headcount? ACTIVE always does. PENDING does
 * too, provided the start date is near-term — an offer accepted for next month
 * is real exposure; one dated a year out is not.
 */
export function countsTowardHeadcount(
  hire: MergeHireRecord,
  now: Date = new Date(),
): boolean {
  const status = hire.employmentStatus.toUpperCase();
  if (status === "ACTIVE") return true;
  if (status !== "PENDING") return false;

  const days = daysFromNow(hire.startDate, now);
  // A PENDING record with no start date at all is still a signed hire; the
  // sandbox just hasn't populated the field. Count it rather than lose it.
  if (days === null) return true;
  return days <= NEAR_TERM_START_WINDOW_DAYS;
}

/** Started within the last month, or starting imminently. */
export function isRecentHire(
  hire: MergeHireRecord,
  now: Date = new Date(),
): boolean {
  if (!countsTowardHeadcount(hire, now)) return false;
  const days = daysFromNow(hire.startDate, now);
  if (days === null) return false;
  return days >= -HIRE_LOOKBACK_DAYS && days <= NEAR_TERM_START_WINDOW_DAYS;
}

/** Closed-won is `status === "WON"`. There is no `is_won` boolean (docs/01). */
export function isWon(opportunity: MergeOpportunityRecord): boolean {
  return opportunity.status.toUpperCase() === "WON";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/* -------------------------------------------------------------------------- */
/* Feature translation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Raw Common Models -> the four features the trained model consumes.
 *
 * Formulas mirror ml/generate_training_data.py exactly — if these drift from
 * the generator, the model is being served inputs it never saw.
 */
export function deriveFeatures(
  snapshot: MergeCompanySnapshot,
  now: Date = new Date(),
): ClassifierFeatures {
  /* --- HRIS: headcount growth + new hires ------------------------------- */
  const headcount = snapshot.hires.filter((hire) =>
    countsTowardHeadcount(hire, now),
  ).length;
  const newHiresThisMonth = snapshot.hires.filter((hire) =>
    isRecentHire(hire, now),
  ).length;

  // generator line 67: new_hires / max(headcount - new_hires, 1) * 100 — growth
  // measured against the base the company started the month at.
  const headcountGrowthRatePct =
    (newHiresThisMonth / Math.max(headcount - newHiresThisMonth, 1)) * 100;

  /* --- Accounting: funding ---------------------------------------------- */
  // ALWAYS the training mean for the real company. The only accounting data we
  // have is Zoho Books Invoices, and an invoice is billed receivables — it
  // structurally cannot represent an equity or debt injection, so there is no
  // funding evidence here to encode. Feeding the training mean standardizes to
  // ~0 and contributes nothing to the score, which is the honest answer for a
  // feature with no data behind it. Feeding 0 instead would standardize to
  // -0.09 and hand the model a -0.95 shove toward auto-approve on the strength
  // of a number we made up. The real company's funding trigger runs through the
  // Simulate Event tool instead (docs/01, docs/05).
  const cashInflowSpikeRatio = NEUTRAL_FUNDING_SIGNAL;

  /* --- CRM: deal size vs. typical --------------------------------------- */
  const wonDeals = snapshot.opportunities.filter(isWon);
  const recentWon = wonDeals.filter((deal) => {
    const days = daysFromNow(deal.closeDate, now);
    return days !== null && days >= -DEAL_LOOKBACK_DAYS && days <= 0;
  });
  const headline = recentWon.reduce<MergeOpportunityRecord | null>(
    (max, deal) => (max === null || deal.amount > max.amount ? deal : max),
    null,
  );

  // The baseline EXCLUDES the deal being measured. In training,
  // `typical_deal_size` is a per-company constant the new deal is compared
  // against (generator line 92) — letting the headline deal into its own
  // denominator drags the ratio down exactly on the large deals that are
  // supposed to trip the threshold. With two won deals of $22K and $2.1K, the
  // biased version reports 1.8x; the correct one reports 10.5x.
  const baseline = wonDeals.filter((deal) => deal.id !== headline?.id);
  const typicalDealSize = median(
    (baseline.length > 0 ? baseline : wonDeals).map((deal) => deal.amount),
  );

  // No recent win means this company's standing on this axis is "nothing
  // unusual" — 0, the same value the generator produced for a month with no
  // closed deal.
  const dealSizeRatio =
    headline && typicalDealSize > 0 ? headline.amount / typicalDealSize : 0;

  return {
    headcountGrowthRatePct,
    newHiresThisMonth,
    cashInflowSpikeRatio,
    dealSizeRatio,
  };
}

/* -------------------------------------------------------------------------- */
/* Signal detection                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Superset of the frozen `detectNewSignals` element shape in `src/lib/merge.ts`
 * — `observation` and `summary` are there, plus the parts `/api/sync` needs to
 * call the engine without recomputing anything.
 */
export interface DetectedSignal {
  triggerType: TriggerType;
  observation: Record<string, number>;
  summary: string;
  features: ClassifierFeatures;
  rawPayload: SignalRawPayload;
}

function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Summaries render straight into the Activity Feed, so they get a name cap. The
 * complete list still goes to `rawPayload` for the Tier 3 receipt — this only
 * trims what a human reads. An uncapped initial sync produces a 92-name
 * sentence, which is unreadable in a feed row.
 */
function nameList(names: string[], limit = 4): string {
  if (names.length <= limit) return names.join(", ");
  const shown = names.slice(0, limit).join(", ");
  return `${shown}, +${names.length - limit} more`;
}

/**
 * Which triggers genuinely fired this sync, from the delta.
 *
 * `funding` is deliberately absent and always will be: see the accounting note
 * in `deriveFeatures`. Real-company funding runs through Simulate Event.
 */
export function detectSignals(
  snapshot: MergeCompanySnapshot,
  diff: SnapshotDiff,
  now: Date = new Date(),
): DetectedSignal[] {
  const features = deriveFeatures(snapshot, now);
  const signals: DetectedSignal[] = [];

  /* --- hire -------------------------------------------------------------- */
  const freshHires = diff.newHires.filter((hire) =>
    countsTowardHeadcount(hire, now),
  );
  if (freshHires.length > 0) {
    const pending = freshHires.filter(
      (hire) => hire.employmentStatus.toUpperCase() === "PENDING",
    ).length;
    const names = nameList(freshHires.map((hire) => hire.name));
    const summary =
      `${freshHires.length} new hire${freshHires.length === 1 ? "" : "s"} in BambooHR ` +
      `(${names})${pending > 0 ? ` — ${pending} still PENDING, counted from the signed start date` : ""}.`;

    signals.push({
      triggerType: "hire",
      observation: {
        new_hires: freshHires.length,
        pending_hires: pending,
        headcount_growth_rate_pct: features.headcountGrowthRatePct,
      },
      summary,
      features,
      rawPayload: {
        summary,
        source: "merge:hris:bamboohr",
        employees: freshHires,
      },
    });
  }

  /* --- contract ---------------------------------------------------------- */
  // Primary evidence is a closed-won HubSpot Opportunity, matching
  // TRIGGER_MERGE_CATEGORY.contract = "crm".
  const freshWins = diff.newOpportunities.filter(isWon);

  // Fallback: the Zoho Books sandbox reliably has invoices while HubSpot may
  // have no fresh WON records. A large invoice is a legitimate stand-in for a
  // big new customer (docs/01) — unlike the funding case, the economics line up.
  const invoiceMedian = median(
    snapshot.transactions.map((transaction) => transaction.amount),
  );
  const largeInvoices =
    invoiceMedian > 0
      ? diff.newTransactions.filter(
          (transaction) =>
            transaction.amount >= invoiceMedian * LARGE_INVOICE_MULTIPLE,
        )
      : [];

  if (freshWins.length > 0) {
    const biggest = freshWins.reduce((max, deal) =>
      deal.amount > max.amount ? deal : max,
    );
    const summary =
      `Closed-won opportunity "${biggest.name}" at ${formatUsd(biggest.amount)} in HubSpot ` +
      `(${features.dealSizeRatio.toFixed(1)}x this company's typical won deal).`;

    signals.push({
      triggerType: "contract",
      observation: {
        deal_amount: biggest.amount,
        deal_size_ratio: features.dealSizeRatio,
        won_deals: freshWins.length,
      },
      summary,
      features,
      rawPayload: {
        summary,
        source: "merge:crm:hubspot",
        opportunities: freshWins,
        corroborating_invoices: largeInvoices,
      },
    });
  } else if (largeInvoices.length > 0) {
    const biggest = largeInvoices.reduce((max, invoice) =>
      invoice.amount > max.amount ? invoice : max,
    );
    const summary =
      `${biggest.description} at ${formatUsd(biggest.amount)} in Zoho Books — ` +
      `${(biggest.amount / invoiceMedian).toFixed(1)}x this company's median invoice.`;

    signals.push({
      triggerType: "contract",
      observation: {
        invoice_amount: biggest.amount,
        median_invoice_amount: invoiceMedian,
        invoice_size_ratio: biggest.amount / invoiceMedian,
      },
      summary,
      features,
      rawPayload: {
        summary,
        source: "merge:accounting:zoho_books",
        invoices: largeInvoices,
      },
    });
  }

  return signals;
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export interface RealCompanySyncResult {
  snapshot: MergeCompanySnapshot;
  features: ClassifierFeatures;
  signals: DetectedSignal[];
  /** Persist this so the next sync starts where this one stopped. */
  nextCursor: SyncCursor;
  warnings: string[];
}

function isEmptySnapshot(snapshot: MergeCompanySnapshot): boolean {
  return (
    snapshot.hires.length === 0 &&
    snapshot.transactions.length === 0 &&
    snapshot.opportunities.length === 0
  );
}

/**
 * Fetch -> diff -> derive -> detect for one real company.
 *
 * Two pulls on purpose, and the order matters:
 *
 *   1. A cheap `modified_after` probe off the stored watermarks. If Merge has
 *      nothing newer, we stop here — no full pull, no signals, three requests.
 *   2. Only when the probe finds something, a full pull. Features have to come
 *      from the complete snapshot: headcount computed off a delta of two
 *      records would report a headcount of two. The model was trained on
 *      monthly snapshots of the whole company, so serving has to match.
 *
 * The `remote_id` diff then decides what's genuinely new, which is what keeps
 * this correct when a Force Resync rewrites `modified_at` on records we've
 * already seen — the probe over-reports, the diff filters it back down.
 *
 * Stops short of classifying and writing: the engine (A3) and `/api/sync` (A4)
 * own those, so this stays a pure read of Merge plus arithmetic.
 */
export async function syncRealCompany(
  company: Company,
  cursor: SyncCursor = EMPTY_CURSOR,
  now: Date = new Date(),
): Promise<RealCompanySyncResult> {
  if (company.source !== "real") {
    throw new Error(
      `syncRealCompany called for synthetic company "${company.name}". Branch on companies.source first.`,
    );
  }

  const warnings: string[] = [];
  const hasWatermark = Object.keys(cursor.watermarks).length > 0;

  if (hasWatermark) {
    const probe = await fetchCompanySnapshotResilient(
      company,
      cursor.watermarks,
    );
    warnings.push(...probe.warnings);
    if (isEmptySnapshot(probe.snapshot)) {
      return {
        snapshot: probe.snapshot,
        features: deriveFeatures(probe.snapshot, now),
        signals: [],
        nextCursor: cursor,
        warnings,
      };
    }
  }

  const { snapshot, remoteIds, warnings: fullWarnings } =
    await fetchCompanySnapshotResilient(company);
  warnings.push(...fullWarnings);

  const diff = diffSnapshot(snapshot, remoteIds, cursor);

  return {
    snapshot,
    features: deriveFeatures(snapshot, now),
    signals: detectSignals(snapshot, diff, now),
    nextCursor: diff.nextCursor,
    warnings: [...new Set(warnings)],
  };
}

/**
 * Mark everything currently in Merge as already seen, without emitting signals.
 *
 * Run this once before the demo. Otherwise the first real sync treats all ten
 * sandbox employees and all eight sandbox invoices as brand-new arrivals and
 * floods the Activity Feed — technically correct for an initial sync, useless
 * on stage. After priming, only the change you make live in BambooHR fires.
 */
export async function primeCursor(company: Company): Promise<SyncCursor> {
  const { snapshot, remoteIds } = await fetchCompanySnapshotResilient(company);
  return diffSnapshot(snapshot, remoteIds, EMPTY_CURSOR).nextCursor;
}
