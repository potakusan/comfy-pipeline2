import { NextRequest, NextResponse } from "next/server";
import { searchLoras } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/civitai/search?q=&sort=&period=&cursor=  Illustrious の LoRA を Civitai で検索 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    return NextResponse.json(await searchLoras({ query: q.get("q") ?? "", sort: q.get("sort") ?? "", period: q.get("period") ?? "", cursor: q.get("cursor") ?? "" }));
  } catch (e) {
    return fail(e);
  }
}
