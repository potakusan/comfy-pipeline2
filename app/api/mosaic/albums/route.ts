import { NextResponse } from "next/server";
import { listAlbums } from "@/lib/server/mosaic";
import { getReleaseRoot } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** モザイク処理の対象になるアルバム(ギャラリーでリリース選択した画像のコピー先 <名前>_release があるもの) */
export async function GET() {
  try {
    return NextResponse.json({ albums: listAlbums(), releaseRoot: getReleaseRoot() });
  } catch (e) {
    return fail(e);
  }
}
