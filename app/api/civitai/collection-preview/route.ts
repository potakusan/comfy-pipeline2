import { NextRequest, NextResponse } from "next/server";
import { collectionPreview } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/civitai/collection-preview?id=  表紙がないコレクションの代わりに使う、中の LoRA のサムネイル(最大4枚) */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ thumbs: await collectionPreview(Number(req.nextUrl.searchParams.get("id"))) });
  } catch (e) {
    return fail(e);
  }
}
