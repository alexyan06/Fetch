// GET /api/companies — the portfolio dashboard's payload.
//
// Sorted by attention_score server-side so the client renders the list as
// given. The sort is the product's opening argument: an underwriter's actual
// problem isn't "show me my book", it's "which of these needs me today".

import { NextResponse } from "next/server";

import { listPortfolio } from "@/lib/db/queries";
import type { ApiError, CompaniesResponse } from "@/lib/types";

export async function GET() {
  try {
    const { companies, totalOpenApprovals } = await listPortfolio();

    return NextResponse.json<CompaniesResponse>({
      companies,
      total_open_approvals: totalOpenApprovals,
    });
  } catch (error) {
    return NextResponse.json<ApiError>(
      {
        error: "Failed to load portfolio",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
