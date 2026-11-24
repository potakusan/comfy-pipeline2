import { NextRequest, NextResponse } from "next/server";
import { fetchPostTags, parsePostId } from "@/lib/server/danbooru";
import { fail, UserError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/danbooru/tags?url=  Danbooru の投稿(URL か ID)のキャラクター・一般タグ */
export async function GET(req: NextRequest) {
  try {
    const id = parsePostId(req.nextUrl.searchParams.get("url") ?? "");
    if (!id) throw new UserError("Danbooru の投稿ページ(…/posts/数字)の URL を入力してください");
    return NextResponse.json(await fetchPostTags(id));
  } catch (e) {
    return fail(e);
  }
}
