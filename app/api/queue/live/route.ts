import { NextResponse } from "next/server";
import { getLive } from "@/lib/server/ws";

export const dynamic = "force-dynamic";

/** GET  生成中の進捗と途中画像の更新時刻だけ(ComfyUI へは問い合わせない軽い応答)。画面は短い間隔でこれを見て、プレビューを滑らかに更新する */
export async function GET() {
  const live = getLive();
  return NextResponse.json({ progress: live.progress, previewAt: live.previewAt });
}
