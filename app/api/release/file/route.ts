import fs from "fs";
import path from "path";
import { Readable } from "stream";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { resolveFile } from "@/lib/server/release";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * GET /api/release/file?kind=work|out&month=202611&path=…[&w=480][&download=1]
 * kind=work: リリース用フォルダの画像(path は <ルート> からの相対) / kind=out: <YYYYMM>_PDF の出力(PDF・ZIP・Pixiv用セット)
 * w を付けると画像を縮小して返す(サムネイル・表示用)。download=1 で保存用のヘッダーを付ける。
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") === "out" ? "out" : "work";
  const full = resolveFile(kind, q.get("month") ?? "", q.get("path") ?? "");
  if (!full) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });

  const ext = path.extname(full).toLowerCase();
  const w = Number(q.get("w") ?? 0);
  const headers: Record<string, string> = { "Cache-Control": "private, max-age=300" };
  if (q.get("download") === "1") {
    // name を渡すと、その名前で保存させる(区切り文字は取り除く)。Content-Disposition は <a download> より優先される
    const saveAs = (q.get("name") ?? "").replace(/[\/:*?"<>|]/g, "_").trim() || path.basename(full);
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(saveAs)}`;
  }

  if (w > 0 && [".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    const buf = await sharp(full).resize({ width: Math.min(w, 4096), withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "Content-Type": "image/webp" } });
  }
  // PDF は大きいので、読み込みきらずに流す
  const stream = Readable.toWeb(fs.createReadStream(full)) as ReadableStream;
  return new NextResponse(stream, { headers: { ...headers, "Content-Type": MIME[ext] ?? "application/octet-stream", "Content-Length": String(fs.statSync(full).size) } });
}
