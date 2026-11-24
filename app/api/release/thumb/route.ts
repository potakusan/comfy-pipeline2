import { NextRequest, NextResponse } from "next/server";
import { makeThumb } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { month, top, path("グループ/ファイル名"), crop:{x,y,w,h}(0〜1) }  Pixiv 用サムネイル 0.jpg を、画像の一部を切り抜いて作る */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { month?: string; top?: string; path?: string; crop?: { x: number; y: number; w: number; h: number } };
    return NextResponse.json(await makeThumb(b.month ?? "", b.top ?? "", b.path ?? "", { x: Number(b.crop?.x), y: Number(b.crop?.y), w: Number(b.crop?.w), h: Number(b.crop?.h) }));
  } catch (e) {
    return fail(e);
  }
}
