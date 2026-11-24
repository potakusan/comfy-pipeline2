import fs from "fs";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, safePath } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * GET /api/gallery/image?path=folder/file.png[&w=1600]
 * w を付けると幅をその値まで縮小して webp で返す(VPN越しのスマホ表示用)。
 * 付けなければ原寸(保存・共有用)。
 * v(中身のバージョン)付きの URL は中身が変わらないので長く覚えさせ、v が無い URL は毎回 ETag で確かめさせる
 * (ファイル名の入れ替え・差し替えで、同じ URL の中身が変わりうるため)。
 */
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const w = Number(req.nextUrl.searchParams.get("w") ?? 0);
  const full = rel ? safePath(getOutputDir(), rel) : null;
  if (!full || !fs.existsSync(full)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const st = fs.statSync(full);
  const etag = `"${Math.round(st.mtimeMs)}-${st.size}-${w}"`;
  const versioned = req.nextUrl.searchParams.has("v");
  const cacheControl = versioned ? "private, max-age=31536000, immutable" : "private, no-cache";
  const extra: Record<string, string> = versioned ? {} : { ETag: etag };
  if (!versioned && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { "Cache-Control": cacheControl, ...extra } });
  }
  try {
    if (w > 0) {
      const buf = await sharp(full)
        .resize({ width: Math.min(w, 4096), withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      return new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": "image/webp", "Cache-Control": cacheControl, ...extra },
      });
    }
    const ext = path.extname(full).slice(1).toLowerCase();
    return new NextResponse(new Uint8Array(fs.readFileSync(full)), {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": cacheControl, ...extra },
    });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
