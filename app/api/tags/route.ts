import { NextRequest, NextResponse } from "next/server";
import { searchTags } from "@/lib/server/tags";

export const dynamic = "force-dynamic";

/** GET /api/tags?q=clo  タグ辞書の候補(英語タグと日本語訳) */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ tags: await searchTags(q.slice(0, 80), 8) });
}
