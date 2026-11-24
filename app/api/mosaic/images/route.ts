import { NextRequest, NextResponse } from "next/server";
import { listAlbumImages } from "@/lib/server/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/mosaic/images?folder=…  元画像と、モザイク処理済みの画像の対応(未処理は mosaic が null) */
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder") ?? "";
    const images = folder ? listAlbumImages(folder) : null;
    if (!images) return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    return NextResponse.json({ images });
  } catch (e) {
    return fail(e);
  }
}
