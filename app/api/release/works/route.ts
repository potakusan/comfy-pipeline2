import { NextRequest, NextResponse } from "next/server";
import { listMonths, listWorks } from "@/lib/server/release";
import { getReleaseRoot } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/release/works?month=202611  リリース用フォルダの月と、その月の作品一覧(月を省くと最新の月) */
export async function GET(req: NextRequest) {
  try {
    const months = listMonths();
    const month = req.nextUrl.searchParams.get("month") || months[0] || null;
    return NextResponse.json({ root: getReleaseRoot(), months, month, works: month ? listWorks(month) : [] });
  } catch (e) {
    return fail(e);
  }
}
