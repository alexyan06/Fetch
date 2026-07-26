// POST /api/approvals/[id]/approve
//
// Applies EXACTLY what the approval card stored. No recomputation, anywhere in
// this file. The engine decided a number when the signal arrived, a human read
// that number, and this route writes that same number — if it recalculated, a
// change in the model or the scaling rule between queue time and approval time
// would apply something different from what was approved, and the audit trail
// would be fiction.

import { NextResponse } from "next/server";

import {
  applyCoverageLimit,
  getApproval,
  getCompany,
  insertActivityLog,
  resolveApproval,
} from "@/lib/db/queries";
import { COVERAGE_LINE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type {
  ApiError,
  ApproveApprovalRequest,
  ApproveApprovalResponse,
} from "@/lib/types";

/** No auth in scope tonight; attribution is fixed so the trail still reads. */
const DEFAULT_APPROVER = "Demo Underwriter";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let approvedBy = DEFAULT_APPROVER;
  try {
    const body = (await request.json()) as ApproveApprovalRequest;
    if (body?.approvedBy) approvedBy = body.approvedBy;
  } catch {
    // Empty body is the normal case — the button sends nothing.
  }

  try {
    const existing = await getApproval(id);
    if (!existing) {
      return NextResponse.json<ApiError>(
        { error: "Approval not found", detail: id },
        { status: 404 },
      );
    }
    if (existing.status !== "open") {
      return NextResponse.json<ApiError>(
        {
          error: "Approval is already resolved",
          detail: `Status is '${existing.status}'.`,
        },
        { status: 409 },
      );
    }

    // Resolve FIRST. The update is guarded on status='open', so whichever
    // request wins gets the row back and every other one gets null — a
    // double-click can't apply the coverage change twice.
    const approval = await resolveApproval(id, "approved");
    if (!approval) {
      return NextResponse.json<ApiError>(
        {
          error: "Approval is already resolved",
          detail: "Another request resolved it first.",
        },
        { status: 409 },
      );
    }

    const proposedLimit = Number(approval.proposed_limit);
    const currentLimit = Number(approval.current_limit);

    await applyCoverageLimit(
      approval.company_id,
      approval.coverage_line,
      // Verbatim from the card. Never recomputed.
      proposedLimit,
    );

    const company = await getCompany(approval.company_id);
    const line = COVERAGE_LINE_LABELS[approval.coverage_line];
    const explanation =
      `${approvedBy} approved the recommendation for ${company?.name ?? "this company"}. ` +
      `${line} moved from ${formatLimit(currentLimit)} to ${formatLimit(proposedLimit)}.`;

    const activityLogEntry = await insertActivityLog({
      companyId: approval.company_id,
      signalEventId: approval.signal_event_id,
      coverageLine: approval.coverage_line,
      oldValue: currentLimit,
      newValue: proposedLimit,
      tag: "approved",
      explanation,
    });

    return NextResponse.json<ApproveApprovalResponse>({
      approval,
      coverage_update: {
        coverage_line: approval.coverage_line,
        old_value: currentLimit,
        new_value: proposedLimit,
      },
      activity_log_entry: activityLogEntry,
    });
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: "Approve failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
