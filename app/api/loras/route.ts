import { NextRequest, NextResponse } from "next/server";
import { deleteLora, listLocalLoras } from "@/lib/server/civitai";
import { getLoraDir } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET  手元の LoRA の一覧 */
export async function GET() {
  try {
    return NextResponse.json({ dir: getLoraDir(), items: listLocalLoras() });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE { fileName }  LoRA とサイドカー(メタデータ・プレビュー)を消す */
export async function DELETE(req: NextRequest) {
  try {
    const b = (await req.json()) as { fileName?: string };
    return NextResponse.json(deleteLora(b.fileName ?? ""));
  } catch (e) {
    return fail(e);
  }
}
