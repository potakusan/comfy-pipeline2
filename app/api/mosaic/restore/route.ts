import { NextRequest, NextResponse } from "next/server";
import { restoreOriginal } from "@/lib/server/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { path, scalePercent?, quality? }  モザイクをやめて、元画像(縮小・JPEG化)に差し戻す */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { path?: string; scalePercent?: number; quality?: number };
    if (!b.path) return NextResponse.json({ error: "画像が指定されていません" }, { status: 400 });
    const path = await restoreOriginal(b.path, b.scalePercent ?? 40, b.quality ?? 100);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return fail(e);
  }
}
