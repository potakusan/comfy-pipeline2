import { NextRequest, NextResponse } from "next/server";
import { collectionModels } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/civitai/collection?id=&cursor=&illustrious=1  コレクションの中の LoRA */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    return NextResponse.json(await collectionModels(Number(q.get("id")), { cursor: q.get("cursor") ?? "", illustriousOnly: q.get("illustrious") !== "0" }));
  } catch (e) {
    return fail(e);
  }
}
