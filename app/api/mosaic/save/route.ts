import { NextRequest, NextResponse } from "next/server";
import { overwriteMosaicFile } from "@/lib/server/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/mosaic/save?path=…  手でモザイクを足した画像(リクエストボディ)で、mosaic/ の既存ファイルを置き換える */
export async function POST(req: NextRequest) {
  try {
    const rel = req.nextUrl.searchParams.get("path") ?? "";
    if (!rel) return NextResponse.json({ error: "画像が指定されていません" }, { status: 400 });
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) return NextResponse.json({ error: "画像データが空です" }, { status: 400 });
    overwriteMosaicFile(rel, bytes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
