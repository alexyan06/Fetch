// Merge Unified API client — the real pipeline, used by exactly ONE company
// (the BambooHR / Zoho Books / HubSpot sandbox). Every other company in the
// portfolio is synthetic and never reaches this module; branch on
// `companies.source` before calling anything here.
//
// Auth: Authorization: Bearer <MERGE_API_KEY> + X-Account-Token: <token>.
// The Node SDK sets both headers for us — `apiKey` becomes the bearer token and
// `accountToken` becomes X-Account-Token.

import { MergeClient } from "@mergeapi/merge-node-client";

import type {
  Company,
  MergeCompanySnapshot,
  MergeHireRecord,
  MergeOpportunityRecord,
  MergeTransactionRecord,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/** Merge caps the free tier at 100 req/min — page big and page rarely. */
const PAGE_SIZE = 100;

/** Hard stop on the cursor loop so a bad `next` token can't spin forever. */
const MAX_PAGES = 10;

export type MergeCategory = "hris" | "accounting" | "crm";

/**
 * Per-category account tokens. `Company.merge_account_tokens` is the source of
 * truth; env vars are the fallback so `scripts/verify-merge.ts` can run without
 * a database.
 */
const ENV_TOKEN_KEYS: Record<MergeCategory, string> = {
  hris: "MERGE_ACCOUNT_TOKEN_HRIS",
  accounting: "MERGE_ACCOUNT_TOKEN_ACCOUNTING",
  crm: "MERGE_ACCOUNT_TOKEN_CRM",
};

export function getMergeApiKey(): string {
  const key = process.env.MERGE_API_KEY;
  if (!key) {
    throw new Error(
      "MERGE_API_KEY is not set. Add it to .env.local (gitignored) and to the Vercel project env vars.",
    );
  }
  return key;
}

/**
 * Resolve one category's account token for a company: the row's stored token
 * first, then the env fallback. Throws rather than silently returning empty
 * data, because a missing token and an empty sandbox look identical downstream.
 */
export function resolveAccountToken(
  company: Pick<Company, "name" | "merge_account_tokens">,
  category: MergeCategory,
): string {
  const stored = company.merge_account_tokens?.[category];
  if (stored) return stored;

  const fromEnv = process.env[ENV_TOKEN_KEYS[category]];
  if (fromEnv) return fromEnv;

  throw new Error(
    `No ${category} account token for "${company.name}". Set companies.merge_account_tokens.${category} or ${ENV_TOKEN_KEYS[category]}.`,
  );
}

/** One authenticated client, scoped to a single Linked Account. */
export function mergeClientFor(accountToken: string): MergeClient {
  return new MergeClient({ apiKey: getMergeApiKey(), accountToken });
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

interface PaginatedPage<T> {
  next?: string;
  results?: T[];
}

/** Walk Merge's cursor pagination until it runs out (or MAX_PAGES trips). */
async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<PaginatedPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchPage(cursor);
    all.push(...(response.results ?? []));
    if (!response.next) return all;
    cursor = response.next;
  }

  return all;
}

/* -------------------------------------------------------------------------- */
/* Identity for change detection                                              */
/* -------------------------------------------------------------------------- */

/**
 * Maps Merge's own record `id` -> the third-party `remote_id`.
 *
 * `sync.ts` diffs on `remote_id` rather than Merge's `id` because a manual Force
 * Resync in the Merge dashboard can hand back fresh Merge ids for records the
 * source system considers unchanged. The `remote_id` stays put, so it's the
 * identifier that survives the demo-day resync we actually rely on.
 */
export type RemoteIdIndex = Record<string, string>;

function indexRemoteId(
  index: RemoteIdIndex,
  record: { id?: string; remoteId?: string },
): void {
  if (record.id && record.remoteId) index[record.id] = record.remoteId;
}

/** ISO date string, or null — Merge hands back `Date` objects or undefined. */
function isoOrNull(value: Date | undefined): string | null {
  return value ? value.toISOString() : null;
}

/* -------------------------------------------------------------------------- */
/* HRIS — BambooHR Employees                                                  */
/* -------------------------------------------------------------------------- */

/**
 * HRIS `Employee`. `employment_status` of PENDING with a near-term `start_date`
 * COUNTS as a hire — do not wait for ACTIVE (docs/01, verified against real
 * BambooHR data). Filtering by status happens in `sync.ts`, not here; this
 * function's job is to hand back everything the sandbox has.
 */
export async function fetchHires(
  accountToken: string,
  modifiedAfter?: string,
  remoteIds: RemoteIdIndex = {},
): Promise<MergeHireRecord[]> {
  const merge = mergeClientFor(accountToken);

  const employees = await collectPages((cursor) =>
    merge.hris.employees.list({
      cursor,
      pageSize: PAGE_SIZE,
      modifiedAfter: modifiedAfter ? new Date(modifiedAfter) : undefined,
    }),
  );

  return employees.map((employee) => {
    indexRemoteId(remoteIds, employee);
    const name =
      employee.displayFullName ??
      [employee.firstName, employee.lastName].filter(Boolean).join(" ") ??
      "";
    return {
      id: employee.id ?? employee.remoteId ?? "",
      name: name || "(unnamed employee)",
      employmentStatus: employee.employmentStatus ?? "UNKNOWN",
      startDate: isoOrNull(employee.startDate),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Accounting — Zoho Books Invoices                                           */
/* -------------------------------------------------------------------------- */

/**
 * Accounting records for the real company, pulled from
 * `/api/accounting/v1/invoices` — the proven working endpoint for this sandbox
 * (docs/01, confirmed against 8 CSV-imported test invoices).
 *
 * These are surfaced in the audit trail and can corroborate a "big new
 * contract", but they deliberately do NOT feed `cashInflowSpikeRatio`: an
 * invoice is billed receivables, not an equity or debt injection, so it
 * structurally cannot represent a funding round. See NEUTRAL_FUNDING_SIGNAL in
 * `sync.ts` for what the funding feature carries instead.
 */
export async function fetchTransactions(
  accountToken: string,
  modifiedAfter?: string,
  remoteIds: RemoteIdIndex = {},
): Promise<MergeTransactionRecord[]> {
  const merge = mergeClientFor(accountToken);

  const invoices = await collectPages((cursor) =>
    merge.accounting.invoices.list({
      cursor,
      pageSize: PAGE_SIZE,
      modifiedAfter: modifiedAfter ? new Date(modifiedAfter) : undefined,
    }),
  );

  return invoices.map((invoice) => {
    indexRemoteId(remoteIds, invoice);
    const contactName =
      typeof invoice.contact === "object" && invoice.contact !== null
        ? ((invoice.contact as { name?: string }).name ?? null)
        : null;
    const label = [
      invoice.number ? `Invoice ${invoice.number}` : "Invoice",
      contactName,
      invoice.status,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      id: invoice.id ?? invoice.remoteId ?? "",
      amount: invoice.totalAmount ?? 0,
      date: isoOrNull(invoice.issueDate ?? invoice.paidOnDate),
      description: label,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* CRM — HubSpot Opportunities                                                */
/* -------------------------------------------------------------------------- */

/**
 * CRM `Opportunity`. Closed-won is `status === "WON"` — there is no `is_won`
 * boolean (docs/01; the synthetic generator's comments got this wrong).
 * We pull every status so `sync.ts` can compute a typical deal size from the
 * company's own won history rather than from a single record.
 */
export async function fetchOpportunities(
  accountToken: string,
  modifiedAfter?: string,
  remoteIds: RemoteIdIndex = {},
): Promise<MergeOpportunityRecord[]> {
  const merge = mergeClientFor(accountToken);

  const opportunities = await collectPages((cursor) =>
    merge.crm.opportunities.list({
      cursor,
      pageSize: PAGE_SIZE,
      modifiedAfter: modifiedAfter ? new Date(modifiedAfter) : undefined,
    }),
  );

  return opportunities.map((opportunity) => {
    indexRemoteId(remoteIds, opportunity);
    return {
      id: opportunity.id ?? opportunity.remoteId ?? "",
      name: opportunity.name ?? "(unnamed opportunity)",
      amount: opportunity.amount ?? 0,
      status: opportunity.status ?? "UNKNOWN",
      closeDate: isoOrNull(opportunity.closeDate),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-category `last_synced_at` watermarks. Passed in by the caller rather than
 * read from the DB here — `/api/sync` owns persistence, this module stays I/O
 * free apart from Merge itself. Omitted categories fall back to a full pull,
 * which is also what the very first sync does.
 */
export type SyncWatermarks = Partial<Record<MergeCategory, string>>;

export interface SnapshotResult {
  snapshot: MergeCompanySnapshot;
  /** Merge id -> third-party remote_id, for `sync.ts`'s diff backstop. */
  remoteIds: RemoteIdIndex;
  /** Non-fatal per-category failures; feeds `SyncCompanyResult.warnings`. */
  warnings: string[];
}

/**
 * Pull all three categories for the real company in one pass, tolerating a
 * single category failing. One dead Linked Account mid-demo should degrade the
 * sync, not abort it.
 */
export async function fetchCompanySnapshotResilient(
  company: Company,
  watermarks: SyncWatermarks = {},
): Promise<SnapshotResult> {
  const remoteIds: RemoteIdIndex = {};
  const warnings: string[] = [];

  async function attempt<T>(
    category: MergeCategory,
    run: (token: string) => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await run(resolveAccountToken(company, category));
    } catch (error) {
      warnings.push(
        `${category} pull failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  const [hires, transactions, opportunities] = await Promise.all([
    attempt("hris", (token) => fetchHires(token, watermarks.hris, remoteIds)),
    attempt("accounting", (token) =>
      fetchTransactions(token, watermarks.accounting, remoteIds),
    ),
    attempt("crm", (token) =>
      fetchOpportunities(token, watermarks.crm, remoteIds),
    ),
  ]);

  return {
    snapshot: {
      companyId: company.id,
      pulledAt: new Date().toISOString(),
      hires,
      transactions,
      opportunities,
    },
    remoteIds,
    warnings,
  };
}

/**
 * Strict variant matching the frozen signature in `src/lib/merge.ts`: throws if
 * any category fails. Prefer `fetchCompanySnapshotResilient` in `/api/sync`,
 * which surfaces partial failures as warnings instead.
 */
export async function fetchCompanySnapshot(
  company: Company,
  modifiedAfter?: string,
): Promise<MergeCompanySnapshot> {
  const watermarks: SyncWatermarks = modifiedAfter
    ? { hris: modifiedAfter, accounting: modifiedAfter, crm: modifiedAfter }
    : {};
  const { snapshot, warnings } = await fetchCompanySnapshotResilient(
    company,
    watermarks,
  );
  if (warnings.length > 0) {
    throw new Error(`Merge snapshot incomplete — ${warnings.join("; ")}`);
  }
  return snapshot;
}
