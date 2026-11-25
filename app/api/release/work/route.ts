import { NextRequest, NextResponse } from "next/server";
import { getWork, renameWork } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/release/work?month=202611&top=20261124_…  作品のグループ・画像と、作成済みの出力(PDF/ZIP/Pixiv用) */
/** PATCH { month, top, name }  作品フォルダの名前を変える。同名の作品があればマージする */
export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as { month?: string; top?: string; name?: string };
    return NextResponse.json(renameWork(b.month ?? "", b.top ?? "", b.name ?? ""));
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    return NextResponse.json(getWork(q.get("month") ?? "", q.get("top") ?? ""));
  } catch (e) {
    return fail(e);
  }
}
