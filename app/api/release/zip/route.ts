import fs from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { zipPixivSet } from "@/lib/server/release";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/release/zip?month=…&top=…  Pixiv 用セット(9枚+告知タイル)を1つの ZIP にしてダウンロードさせる */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const top = q.get("top") ?? "";
    const zip = await zipPixivSet(q.get("month") ?? "", top);
    return new NextResponse(Readable.toWeb(fs.createReadStream(zip)) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(fs.statSync(zip).size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${top}_pixiv.zip`)}`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
