import { NextRequest, NextResponse } from "next/server";
import { resetAlbum } from "@/lib/server/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { folder }  リリース選択とモザイク処理済みをリセットする(リリース用フォルダへコピー済みの場合だけ) */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { folder?: string };
    return NextResponse.json(resetAlbum(b.folder ?? ""));
  } catch (e) {
    return fail(e);
  }
}
