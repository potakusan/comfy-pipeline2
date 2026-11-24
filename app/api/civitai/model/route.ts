import { NextRequest, NextResponse } from "next/server";
import { modelDetail } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/civitai/model?id=  モデルの詳細(バージョン・トリガーワード) */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await modelDetail(Number(req.nextUrl.searchParams.get("id"))));
  } catch (e) {
    return fail(e);
  }
}
