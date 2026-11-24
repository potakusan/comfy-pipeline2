import { NextRequest, NextResponse } from "next/server";
import { regenerate } from "@/lib/server/queue-ops";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST { path, positivePrompt?, negativePrompt?, randomizeSeed?, seed? }
 * 元画像のメタデータを土台に、プロンプトを編集して再生成する。待機列の先頭へ割り込ませ、
 * 完成すると "<元>_rev_NNNN" として同じフォルダに保存される。結果は /api/jobs?promptId= で追う。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      path?: string;
      positivePrompt?: string;
      negativePrompt?: string;
      randomizeSeed?: boolean;
      seed?: number;
    };
    if (!body.path) return NextResponse.json({ error: "画像が指定されていません" }, { status: 400 });
    return NextResponse.json(await regenerate({ ...body, path: body.path }));
  } catch (e) {
    return fail(e);
  }
}
