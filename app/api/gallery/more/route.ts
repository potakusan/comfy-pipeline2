import { NextRequest, NextResponse } from "next/server";
import { startMore } from "@/lib/server/queue-ops";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST { folder, group, count }  ギャラリーのプリセット(ファイル名の接頭辞)を、同じ構成のままあと count 枚つくる。
 * ランダム部分と seed は1枚ごとに引き直す。進み具合は GET /api/queue(entryId で絞る)、やり直し・中止は POST /api/queue。
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { folder?: string; group?: string; count?: number };
    if (!b.folder || !b.group) return NextResponse.json({ error: "フォルダとプリセットを指定してください" }, { status: 400 });
    return NextResponse.json(await startMore(b.folder, b.group, Number(b.count) || 1));
  } catch (e) {
    return fail(e);
  }
}
