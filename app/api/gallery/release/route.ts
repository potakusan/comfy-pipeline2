import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, safePath } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

/**
 * リリース選択 = "<folder>_release/" に画像(とサイドカー)があること。v1 と同じ規約。
 * 注意: v1 は選択時に seed を永続アーカイブへ保管するが、モバイル版はまだ行わない(フェーズ2)。
 */
function split(rel: string): { folder: string; rest: string } | null {
  const parts = rel.split("/");
  return parts.length >= 2 ? { folder: parts[0], rest: parts.slice(1).join("/") } : null;
}

export async function POST(req: NextRequest) {
  try {
    const { path: rel } = (await req.json()) as { path?: string };
    const outputDir = getOutputDir();
    const s = rel ? split(rel) : null;
    const src = rel ? safePath(outputDir, rel) : null;
    const dest = s ? safePath(outputDir, `${s.folder}_release/${s.rest}`) : null;
    if (!src || !dest || !fs.existsSync(src)) {
      return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (fs.existsSync(`${src}.json`)) fs.copyFileSync(`${src}.json`, `${dest}.json`);
    return NextResponse.json({ released: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { path: rel } = (await req.json()) as { path?: string };
    const s = rel ? split(rel) : null;
    const dest = s ? safePath(getOutputDir(), `${s.folder}_release/${s.rest}`) : null;
    if (!dest) return NextResponse.json({ error: "パスが不正です" }, { status: 400 });
    for (const f of [dest, `${dest}.json`]) if (fs.existsSync(f)) fs.unlinkSync(f);
    return NextResponse.json({ released: false });
  } catch (e) {
    return fail(e);
  }
}
