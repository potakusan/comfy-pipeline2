import { NextRequest, NextResponse } from "next/server";
import { deletePending, getQueue } from "@/lib/server/comfy";
import { reconcileSoon } from "@/lib/server/reconcile";
import { readEntries, readFailed, readHeld, readJobs, readRecent, readTodo } from "@/lib/server/store";
import { cancelEntry, clearWaiting, lastFeedError, pauseAfterCurrentSet, planPause, redo, removeHeld, startHeld } from "@/lib/server/queue-ops";
import { ensureFeeder } from "@/lib/server/feeder";
import { interrupt } from "@/lib/server/comfy";
import { getLive } from "@/lib/server/ws";
import { fail } from "@/lib/server/http";
import { secondsFromDurations } from "@/lib/comfy/eta";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureFeeder(); // 念のため(通常はサーバー起動時に始まっている)
    const queue = await getQueue();
    reconcileSoon(queue); // 待たない(変換が重いときも、この画面を止めない)
    const jobs = readJobs();
    const entries = readEntries();
    const describe = (promptId: string) => {
      const j = jobs.find((x) => x.promptId === promptId);
      const rec = j ? entries[j.entryId] : undefined;
      return { promptId, label: j?.label ?? "", entryId: j?.entryId ?? promptId, index: j?.index ?? 0, kind: j?.kind ?? "batch", loraName: rec?.template.loraName ?? null, setName: rec?.setName ?? null };
    };
    const groups: Record<string, { label: string; total: number; remaining: number }> = {};
    for (const j of jobs) {
      const g = (groups[j.entryId] ??= { label: j.label, total: entries[j.entryId]?.total ?? 1, remaining: 0 });
      g.remaining++;
    }
    const todo = readTodo();
    for (const t of todo) {
      const g = (groups[t.id] ??= { label: t.template.label, total: entries[t.id]?.total ?? t.remaining, remaining: 0 });
      g.remaining += t.remaining;
    }
    // 待機中: ComfyUI のキューにある分と、これから送る分を、アイテムごとにまとめる(順序は送る順)
    const waiting: { entryId: string; label: string; count: number; loraName: string | null; setName: string | null }[] = [];
    for (const q of queue.pending) {
      const d = describe(q.promptId);
      const w = waiting.find((x) => x.entryId === d.entryId);
      if (w) w.count++;
      else waiting.push({ entryId: d.entryId, label: d.label, count: 1, loraName: d.loraName, setName: d.setName });
    }
    for (const t of todo) {
      const w = waiting.find((x) => x.entryId === t.id);
      if (w) w.count += t.remaining;
      else waiting.push({ entryId: t.id, label: t.template.label, count: t.remaining, loraName: t.template.loraName, setName: t.setName ?? null });
    }
    const live = getLive();
    return NextResponse.json({
      held: readHeld().map((h) => ({ id: h.id, label: h.template.label, count: h.count, setName: h.setName ?? null, loraName: h.template.loraName })),
      running: queue.running.map((q) => describe(q.promptId)),
      pending: queue.pending.map((q) => describe(q.promptId)),
      waiting,
      waitingImages: waiting.reduce((n, w) => n + w.count, 0),
      feedError: lastFeedError(),
      groups,
      pause: (() => {
        const p = planPause(queue);
        return p ? { currentName: p.currentName, holdImages: p.holdImages } : null;
      })(),
      progress: live.progress,
      previewAt: live.previewAt,
      now: Date.now(),
      // 1枚あたりの秒数の見積もり(最近できた本番の画像の間隔から)。実績が足りなければ null
      secPerImage: (() => {
        // ComfyUI が実際に生成にかけた時間の中央値。確定した時刻の間隔は、画面を閉じている間にまとめて確定されると狂うので使わない(3枚たまるまでは「計算中」)
        return secondsFromDurations(readRecent().flatMap((r) => (r.kind === "batch" && r.ms ? [r.ms] : [])))?.sec ?? null;
      })(),
      recent: readRecent().slice(0, 40),
      failed: readFailed().slice(0, 5),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * { action: "start" }                      保留中を開始する(ComfyUI へは、実行中+次の1枚だけを逐次送る)
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
      ids?: string[];
    };
    switch (body.action) {
      case "start":
        return NextResponse.json(await startHeld());
      case "pause-after-set":
        return NextResponse.json(await pauseAfterCurrentSet());
      case "remove-held":
        if (Array.isArray(body.ids)) for (const id of body.ids) removeHeld(String(id));
        else removeHeld(body.id ?? "all");
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
        await clearWaiting();
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
