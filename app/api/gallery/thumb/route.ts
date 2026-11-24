import fs from "fs";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, safePath } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const THUMB_WIDTH = 480;
const HEADERS = { "Content-Type": "image/webp" };

/**
 * v(中身のバージョン)付きの URL は中身が変わらないので長く覚えさせる。v が無い URL は、名前の入れ替えなどで
 * 同じ URL の中身が変わりうるため、毎回 ETag で確かめさせる(変わっていなければ 304 で軽い)。
 */
function cacheHeaders(req: NextRequest, etag: string): Record<string, string> {
  return req.nextUrl.searchParams.has("v")
    ? { ...HEADERS, "Cache-Control": "private, max-age=31536000, immutable" }
    : { ...HEADERS, "Cache-Control": "private, no-cache", ETag: etag };
}

/** GET /api/gallery/thumb?path=folder/file.png  v1 と同じ .thumbcache を共有する */
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const outputDir = getOutputDir();
  const full = rel ? safePath(outputDir, rel) : null;
  if (!full || !fs.existsSync(full)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cache = path.join(outputDir, ".thumbcache", `${rel}.webp`);
  const st = fs.statSync(full);
  const etag = `"${Math.round(st.mtimeMs)}-${st.size}"`;
  if (!req.nextUrl.searchParams.has("v") && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders(req, etag) });
  }
  try {
    if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(full).mtimeMs) {
      return new NextResponse(new Uint8Array(fs.readFileSync(cache)), { headers: cacheHeaders(req, etag) });
    }
    const buf = await sharp(full)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, buf);
    return new NextResponse(new Uint8Array(buf), { headers: cacheHeaders(req, etag) });
  } catch {
    return NextResponse.json({ error: "thumbnail failed" }, { status: 500 });
  }
}
