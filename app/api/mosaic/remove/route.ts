import { NextRequest, NextResponse } from "next/server";
import { removeFromAlbum } from "@/lib/server/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST { folder, filename }  エラーのある画像を、モザイクのアルバムから外す(ギャラリーの元の画像は残す) */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { folder?: string; filename?: string };
    return NextResponse.json(removeFromAlbum(b.folder ?? "", b.filename ?? ""));
  } catch (e) {
    return fail(e);
  }
}
