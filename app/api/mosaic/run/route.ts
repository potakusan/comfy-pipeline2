import { NextRequest, NextResponse } from "next/server";
import { startMosaicRun } from "@/lib/server/mosaic";
import { DEFAULT_MOSAIC, DEFAULT_RESIZE, type MosaicRunRequest } from "@/lib/comfy/mosaic";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/mosaic/run  アルバムの <名前>_release 内の画像に、縮小とモザイクをまとめてかける。
 * 進捗は GET /api/job?id= で追う。files を渡すと、その画像だけを処理する(1枚のやり直し用)。
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Partial<MosaicRunRequest>;
    const request: MosaicRunRequest = {
      folder: String(b.folder ?? ""),
      files: Array.isArray(b.files) ? b.files.map(String) : undefined,
      mosaicEnabled: b.mosaicEnabled !== false,
      resizeEnabled: b.resizeEnabled !== false,
      mosaic: { ...DEFAULT_MOSAIC, ...b.mosaic },
      resize: { ...DEFAULT_RESIZE, ...b.resize },
    };
    const r = startMosaicRun(request);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    return fail(e);
  }
}
