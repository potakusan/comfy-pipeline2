import { NextRequest, NextResponse } from "next/server";
import { deleteGalleryFolder } from "@/lib/server/folder-delete";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** DELETE { name }  フォルダを、リリース選択・モザイク処理済みごと消す(テスト生成の <日付>-test も同じ) */
export async function DELETE(req: NextRequest) {
  try {
    const b = (await req.json()) as { name?: string };
    return NextResponse.json(deleteGalleryFolder(b.name ?? ""));
  } catch (e) {
    return fail(e);
  }
}
