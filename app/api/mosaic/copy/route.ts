import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, getReleaseRoot, IMAGE_EXT, safePath } from "@/lib/server/env";
import { buildReleaseDir, maxExistingSequence, numberedNames } from "@/lib/comfy/release-copy";
import { fail } from "@/lib/server/http";
import { markCopied } from "@/lib/server/mosaic";

export const dynamic = "force-dynamic";

/**
 * POST { paths, character, group }
 * モザイク処理済みの画像(<フォルダ>_release/mosaic/ の中)を、リリース用フォルダ
 * <ルート>/YYYYMM/YYYYMMDD_キャラクター名/グループ名/ へ 01,02,… に振り直してコピーする。
 * すでに連番のファイルがあれば、その続きの番号から振る(上書きしない)。v1 と同じ規則。
 */
export async function POST(req: NextRequest) {
  try {
    const { paths, character, group } = (await req.json()) as { paths?: string[]; character?: string; group?: string };
    if (!Array.isArray(paths) || paths.length === 0) return NextResponse.json({ error: "コピーする画像がありません" }, { status: 400 });

    const dest = buildReleaseDir(getReleaseRoot(), new Date(), character ?? "", group ?? "");
    if (!dest) return NextResponse.json({ error: "作品名とグループ名を入力してください" }, { status: 400 });

    const outputDir = getOutputDir();
    const sources = paths
      .filter((p) => /\/mosaic\/[^/]+$/.test(p) && IMAGE_EXT.test(p))
      .map((p) => safePath(outputDir, p))
      .filter((p): p is string => !!p && fs.existsSync(p))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    if (sources.length === 0) return NextResponse.json({ error: "有効な画像がありません" }, { status: 400 });

    fs.mkdirSync(dest, { recursive: true });
    const names = numberedNames(sources, maxExistingSequence(fs.readdirSync(dest)) + 1);
    sources.forEach((src, i) => fs.copyFileSync(src, path.join(dest, names[i])));
    // どのアルバムのどの画像をコピーしたかを記録する(リセットしてよいかの判断用)
    const byAlbum = new Map<string, string[]>();
    for (const src of sources) {
      const rel = path.relative(outputDir, src).split(path.sep);
      if (rel.length === 3 && rel[0].endsWith("_release")) byAlbum.set(rel[0].slice(0, -"_release".length), [...(byAlbum.get(rel[0].slice(0, -"_release".length)) ?? []), rel[2]]);
    }
    for (const [album, files] of byAlbum) markCopied(album, files);
    return NextResponse.json({ copied: sources.length, destDir: dest, firstName: names[0], lastName: names[names.length - 1] });
  } catch (e) {
    return fail(e);
  }
}
