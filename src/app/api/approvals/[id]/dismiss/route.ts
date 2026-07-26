// POST /api/approvals/[id]/dismiss
//
// Resolves the row and applies NOTHING. No coverage_state write happens here —
// that absence is the whole point of the route, and the feed entry records that
// a human looked at it and declined, which is as much a real decision as an
// approval.

import { NextResponse } from "next/server";

import {
  getApproval,
  getCompany,
  insertActivityLog,
  resolveApproval,
} from "@/lib/db/queries";
import { COVERAGE_LINE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type {
  ApiError,
  DismissApprovalRequest,
  DismissApprovalResponse,
} from "@/lib/types";

const DEFAULT_DISMISSER = "Demo Underwriter";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let dismissedBy = DEFAULT_DISMISSER;
  let reason: string | undefined;
  try {
    const body = (await request.json()) as DismissApprovalRequest;
    if (body?.dismissedBy) dismissedBy = body.dismissedBy;
    if (body?.reason) reason = body.reason;
  } catch {
    // Empty body is the normal case.
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

    const approval = await resolveApproval(id, "dismissed");
    if (!approval) {
      return NextResponse.json<ApiError>(
        {
          error: "Approval is already resolved",
          detail: "Another request resolved it first.",
        },
        { status: 409 },
      );
    }

    const company = await getCompany(approval.company_id);
    const line = COVERAGE_LINE_LABELS[approval.coverage_line];
    const explanation =
      `${dismissedBy} dismissed the recommendation for ${company?.name ?? "this company"}. ` +
      `${line} stays at ${formatLimit(Number(approval.current_limit))}.` +
      (reason ? ` Reason: ${reason}` : "");

    const activityLogEntry = await insertActivityLog({
      companyId: approval.company_id,
      signalEventId: approval.signal_event_id,
      coverageLine: approval.coverage_line,
      // Both null: nothing moved, and recording values here would imply it did.
      oldValue: null,
      newValue: null,
      tag: "dismissed",
      explanation,
    });

    return NextResponse.json<DismissApprovalResponse>({
      approval,
      activity_log_entry: activityLogEntry,
    });
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: "Dismiss failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
