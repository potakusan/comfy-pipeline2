import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, safePath } from "@/lib/server/env";
import { fail } from "@/lib/server/http";

/** v1 と同じ掃除: 画像・サイドカー・サムネキャッシュ・リリース側のコピーを消す。 */
export async function DELETE(req: NextRequest) {
  try {
    const { path: rel } = (await req.json()) as { path?: string };
    const outputDir = getOutputDir();
    const full = rel ? safePath(outputDir, rel) : null;
    if (!rel || !full) return NextResponse.json({ error: "パスが不正です" }, { status: 400 });

    const parts = rel.split("/");
    const targets = [full, `${full}.json`, path.join(outputDir, ".thumbcache", `${rel}.webp`)];
    if (parts.length >= 2) {
      const released = safePath(outputDir, `${parts[0]}_release/${parts.slice(1).join("/")}`);
      if (released) targets.push(released, `${released}.json`);
    }
    for (const t of targets) if (fs.existsSync(t)) fs.unlinkSync(t);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
