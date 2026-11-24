import { NextRequest, NextResponse } from "next/server";
import { clearPending, deletePending, getQueue } from "@/lib/server/comfy";
import { reconcileJobs } from "@/lib/server/reconcile";
import { readEntries, readFailed, readHeld, readJobs, readRecent } from "@/lib/server/store";
import { cancelEntry, pauseAfterCurrentSet, planPause, redo, removeHeld, startHeld } from "@/lib/server/queue-ops";
import { interrupt } from "@/lib/server/comfy";
import { getLive } from "@/lib/server/ws";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = await getQueue();
    await reconcileJobs(queue);
    const jobs = readJobs();
    const entries = readEntries();
    const describe = (promptId: string) => {
      const j = jobs.find((x) => x.promptId === promptId);
      return { promptId, label: j?.label ?? "", entryId: j?.entryId ?? promptId, index: j?.index ?? 0, kind: j?.kind ?? "batch" };
    };
    const groups: Record<string, { label: string; total: number; remaining: number }> = {};
    for (const j of jobs) {
      const g = (groups[j.entryId] ??= { label: j.label, total: entries[j.entryId]?.total ?? 1, remaining: 0 });
      g.remaining++;
    }
    const live = getLive();
    return NextResponse.json({
      held: readHeld().map((h) => ({ id: h.id, label: h.template.label, count: h.count })),
      running: queue.running.map((q) => describe(q.promptId)),
      pending: queue.pending.map((q) => describe(q.promptId)),
      groups,
      pause: (() => {
        const p = planPause(queue);
        return p ? { currentName: p.currentName, holdImages: p.holdImages } : null;
      })(),
      progress: live.progress,
      previewAt: live.previewAt,
      recent: readRecent().slice(0, 40),
      failed: readFailed().slice(0, 5),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * { action: "start" }                      保留中をすべて ComfyUI のキューへ送って稼働開始
 * { action: "pause-after-set" }             いま実行中のプリセット(1アイテム)が終わったら止める(残りは保留に戻る。再開は「開始」)
 * { action: "remove-held", id | "all" }    保留を取り消す
 * { action: "redo", mode: "same"|"reroll", promptId? }  実行中の1枚をやり直す
 * { action: "cancel-entry", entryId }      そのアイテムの残りと実行中の1枚を止める
 * { action: "cancel-prompt", promptId }   再生成・テストなど単独のジョブを止める
 * { action: "clear" }                      待機中を全消去
 * { action: "delete", promptIds }          待機中の指定ジョブを取り消す
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      id?: string;
      mode?: "same" | "reroll";
      promptId?: string;
      entryId?: string;
      promptIds?: string[];
    };
    switch (body.action) {
      case "start":
        return NextResponse.json(await startHeld());
      case "pause-after-set":
        return NextResponse.json(await pauseAfterCurrentSet());
      case "remove-held":
        removeHeld(body.id ?? "all");
        return NextResponse.json({ ok: true });
      case "redo":
        return NextResponse.json(await redo(body.mode === "reroll" ? "reroll" : "same", body.promptId));
      case "cancel-entry":
        if (!body.entryId) break;
        await cancelEntry(body.entryId);
        return NextResponse.json({ ok: true });
      case "cancel-prompt": {
        if (!body.promptId) break;
        const job = readJobs().find((j) => j.promptId === body.promptId);
        if (job) await cancelEntry(job.entryId);
        else await interrupt(body.promptId);
        return NextResponse.json({ ok: true });
      }
      case "clear":
        await clearPending();
        return NextResponse.json({ ok: true });
      case "delete":
        if (!body.promptIds?.length) break;
        await deletePending(body.promptIds);
        return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "不正な操作です" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
