import { NextRequest, NextResponse } from "next/server";
import { getWork } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/release/work?month=202611&top=20261124_…  作品のグループ・画像と、作成済みの出力(PDF/ZIP/Pixiv用) */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    return NextResponse.json(getWork(q.get("month") ?? "", q.get("top") ?? ""));
  } catch (e) {
    return fail(e);
  }
}
