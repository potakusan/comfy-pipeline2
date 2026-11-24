import { NextRequest, NextResponse } from "next/server";
import { swapImages } from "@/lib/server/swap";
import { fail } from "@/lib/server/http";
import { readSwapLog } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** GET  直近の入れ替えの記録(いつ・どの2枚を・成功したか失敗したか) */
export async function GET() {
  return NextResponse.json({ log: readSwapLog().slice(0, 30) });
}

/**
 * POST { folder, a, b }  同じプリセットの画像2枚の、ファイル名(連番)を入れ替える。
 * 画像の中身に結び付いたもの(メタデータ・リリース用コピー・モザイク・保管庫)も、名前を入れ替えて中身についていく。
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { folder?: string; a?: string; b?: string };
    return NextResponse.json(swapImages(b.folder ?? "", b.a ?? "", b.b ?? ""));
  } catch (e) {
    return fail(e);
  }
}
