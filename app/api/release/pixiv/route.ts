import { NextRequest, NextResponse } from "next/server";
import { startPixiv } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST { month, top, picks?, force }  Pixiv 投稿用の9枚と告知タイル画像のセットを作る。
 * picks("グループ/ファイル名")を渡すとその画像を投稿用に使い、省略するとランダムに選ぶ。進捗は GET /api/job?id=
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { month?: string; top?: string; picks?: string[]; force?: boolean };
    return NextResponse.json(
      startPixiv({
        month: b.month ?? "",
        top: b.top ?? "",
        picks: Array.isArray(b.picks) ? b.picks.map(String) : undefined,
        force: !!b.force,
      }),
    );
  } catch (e) {
    return fail(e);
  }
}
