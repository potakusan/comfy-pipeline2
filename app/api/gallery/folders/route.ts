import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getOutputDir, IMAGE_EXT } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const outputDir = getOutputDir();
    // 先頭が "." の管理用ディレクトリ(.thumbcache 等)と *_release は生成バッチではないので除く
    const names = fs
      .readdirSync(outputDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.endsWith("_release"))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, 200);

    const dirs = names.map((name) => {
      let files: string[] = [];
      try {
        files = fs.readdirSync(path.join(outputDir, name)).filter((f) => IMAGE_EXT.test(f) && !f.startsWith("__regen_")).sort();
      } catch {}
      let releaseCount = 0;
      try {
        releaseCount = fs
          .readdirSync(path.join(outputDir, `${name}_release`))
          .filter((f) => IMAGE_EXT.test(f)).length;
      } catch {}
      return { name, count: files.length, firstImage: files[0] ? `${name}/${files[0]}` : null, releaseCount };
    });
    return NextResponse.json({ dirs: dirs.filter((d) => d.count > 0) });
  } catch (e) {
    return fail(e);
  }
}
