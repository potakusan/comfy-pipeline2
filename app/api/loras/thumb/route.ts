import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { loraThumbPath } from "@/lib/server/civitai";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** GET /api/loras/thumb?name=<ファイル名>  LoRA のプレビュー画像 */
export async function GET(req: NextRequest) {
  try {
    const full = loraThumbPath(req.nextUrl.searchParams.get("name") ?? "");
    if (!full) return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
    const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
    return new NextResponse(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch (e) {
    return fail(e);
  }
}
