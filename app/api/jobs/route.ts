import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getOutputDir, safePath } from "@/lib/server/env";
import { getQueue } from "@/lib/server/comfy";
import { reconcileJobs } from "@/lib/server/reconcile";
import { readFailed, readRecent } from "@/lib/server/store";
import { getLive } from "@/lib/server/ws";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/jobs?promptId=…  テスト生成・再生成の結果待ち用。状態と進捗、完成なら画像パス。 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("promptId") ?? "";
    const queue = await getQueue();
    // 結果待ち用。確定に時間がかかるときは、数秒で切り上げて「まだ」と返す(次の問い合わせで拾う)
    await Promise.race([reconcileJobs(queue), new Promise((r) => setTimeout(r, 2500))]);
    const live = getLive();

    if (queue.running.some((q) => q.promptId === id)) {
      return NextResponse.json({
        state: "running",
        progress: live.progress?.promptId === id ? live.progress : null,
        previewAt: live.previewAt,
      });
    }
    if (queue.pending.some((q) => q.promptId === id)) return NextResponse.json({ state: "pending" });

    // 同じジョブが複数回記録されていても、いま実在するファイル(確定後の名前)を優先する
    const matches = readRecent().filter((r) => r.promptId === id);
    const done = matches.find((r) => {
      const p = safePath(getOutputDir(), r.path);
      return !!p && fs.existsSync(p);
    }) ?? matches[0];
    if (done) return NextResponse.json({ state: "done", path: done.path });
    const failed = readFailed().find((f) => f.promptId === id);
    if (failed) return NextResponse.json({ state: "failed", message: failed.message });
    // やり直しなどで別のジョブに置き換わった、または確定待ち
    return NextResponse.json({ state: "unknown" });
  } catch (e) {
    return fail(e);
  }
}
