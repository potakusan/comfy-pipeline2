import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, IMAGE_EXT, safePath } from "@/lib/server/env";
import { fail } from "@/lib/server/http";
import type { ImageMetadata } from "@/lib/comfy/comfy-types";

export const dynamic = "force-dynamic";

function readMeta(full: string): ImageMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(`${full}.json`, "utf8")) as ImageMetadata;
  } catch {
    return null;
  }
}

/** GET /api/gallery/images?folder=20240101-name  画像一覧(リリース選択済みかとメタデータ付き) */
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder") ?? "";
    const outputDir = getOutputDir();
    const dir = folder ? safePath(outputDir, folder) : null;
    if (!dir) return NextResponse.json({ error: "フォルダ指定が不正です" }, { status: 400 });
    const releaseDir = safePath(outputDir, `${folder}_release`);

    const files = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f) && !f.startsWith("__regen_")).sort();
    const images = files.map((filename) => {
      const meta = readMeta(path.join(dir, filename));
      const st = fs.statSync(path.join(dir, filename));
      return {
        /** 中身が変わると変わる値(更新時刻+サイズ)。URL に付けて、名前の入れ替え・差し替えのあとも古い画像を使わないようにする */
        v: `${Math.round(st.mtimeMs)}-${st.size}`,
        path: `${folder}/${filename}`,
        filename,
        released: !!releaseDir && fs.existsSync(path.join(releaseDir, filename)),
        positivePrompt: meta?.positivePrompt ?? null,
        negativePrompt: meta?.negativePrompt ?? null,
        loraName: meta?.loraName ?? null,
        seed: meta?.settings?.seed ?? null,
        createdAt: meta?.createdAt ?? null,
        /** 再生成できるのは設定が残っている通常モードの画像だけ */
        canRegenerate: !!meta?.settings && meta.mode === "normal",
        revisionOf: (meta as { revisionOf?: string } | null)?.revisionOf ?? null,
      };
    });
    return NextResponse.json({ images });
  } catch (e) {
    return fail(e);
  }
}
