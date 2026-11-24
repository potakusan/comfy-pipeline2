import { NextRequest, NextResponse } from "next/server";
import { buildPlan, scanVariables, type PlanRequest } from "@/lib/server/plan";
import { addToHeld, submitTest } from "@/lib/server/queue-ops";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * { action: "preview", request }   参照している変数と、作られるアイテムの一覧
 * { action: "add", request }       保留キューへ追加(まだ生成は始まらない)
 * { action: "test", request, presetId? }  1枚だけ今すぐ生成(presetId 省略時はセット内からランダム)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string; request?: PlanRequest; presetId?: string };
    if (!body.request) return NextResponse.json({ error: "選択内容がありません" }, { status: 400 });
    const items = buildPlan(body.request);
    if (items.length === 0) return NextResponse.json({ error: "対象のプリセットがありません" }, { status: 400 });

    if (body.action === "preview") {
      return NextResponse.json({
        variables: scanVariables(items),
        items: items.map((i) => ({ label: i.template.label, count: i.count, batchPresetId: i.batchPresetId })),
      });
    }
    if (body.action === "add") {
      return NextResponse.json(addToHeld(items));
    }
    if (body.action === "test") {
      const chosen = body.presetId
        ? items.find((i) => i.batchPresetId === body.presetId)
        : items[Math.floor(Math.random() * items.length)];
      if (!chosen) return NextResponse.json({ error: "指定のプリセットが見つかりません" }, { status: 400 });
      const job = await submitTest(chosen);
      return NextResponse.json({ ...job, presetId: chosen.batchPresetId ?? null });
    }
    return NextResponse.json({ error: "不正な操作です" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
