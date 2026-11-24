import { NextRequest, NextResponse } from "next/server";
import {
  deletePreset,
  deleteVariableDef,
  isPresetType,
  readLibrary,
  saveBatchPreset,
  savePreset,
  saveVariableDef,
  saveVariableLora,
} from "@/lib/server/library";
import { fail } from "@/lib/server/http";
import { VARIABLE_NAME_RE } from "@/lib/comfy/prompt-variables";

export const dynamic = "force-dynamic";

/**
 * v1 と共有しているプリセット・変数・LoRA・一括キューを編集する(鉛筆ボタンの保存先)。
 * 書き込みは検証→一時ファイル→rename。v1 側は数秒以内に反映される。
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lib = readLibrary();
    switch (b.action) {
      case "get-preset": {
        if (!isPresetType(b.type)) break;
        const p = lib[b.type as "pose"].find((x) => x.id === b.id);
        return p ? NextResponse.json({ preset: p }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      }
      case "save-preset": {
        const p = b.preset;
        if (!isPresetType(b.type) || !p?.id || typeof p.name !== "string" || !p.name.trim()) {
          return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
        }
        savePreset(b.type, {
          id: p.id,
          name: p.name.trim(),
          prompt: String(p.prompt ?? ""),
          type: b.type,
          promptMode: p.promptMode === "random" ? "random" : "all",
          ...(p.category ? { category: p.category } : {}),
        });
        return NextResponse.json({ ok: true });
      }
      case "delete-preset": {
        if (!isPresetType(b.type)) break;
        const r = deletePreset(b.type, b.id);
        return "error" in r ? NextResponse.json(r, { status: 409 }) : NextResponse.json(r);
      }
      case "save-variable": {
        const d = b.def;
        if (!d?.name || !VARIABLE_NAME_RE.test(d.name)) {
          return NextResponse.json({ error: "変数名は英数字とアンダースコアのみです" }, { status: 400 });
        }
        const mode = d.mode === "fixed" || d.mode === "random" ? d.mode : "input";
        saveVariableDef({
          name: d.name,
          mode,
          value: String(d.value ?? ""),
          candidates: Array.isArray(d.candidates) ? d.candidates.map(String).filter((c: string) => c.trim()) : [],
        });
        return NextResponse.json({ ok: true });
      }
      case "delete-variable":
        deleteVariableDef(String(b.name));
        return NextResponse.json({ ok: true });
      case "get-lora": {
        const l = lib.variableLoras.find((x) => x.name === b.name);
        return l ? NextResponse.json({ lora: l }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      }
      case "save-lora": {
        const l = b.lora;
        const ok = saveVariableLora({
          name: String(l?.name),
          strength: Number(l?.strength),
          clipStrength: Number(l?.clipStrength),
          triggerWords: String(l?.triggerWords ?? ""),
        });
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "LoRAが見つかりません" }, { status: 404 });
      }
      case "get-batch-preset": {
        const p = lib.batchSets.find((s) => s.id === b.setId)?.presets.find((x) => x.id === b.id);
        return p ? NextResponse.json({ preset: p }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      }
      case "save-batch-preset": {
        const p = b.preset;
        if (!p?.id || typeof p.name !== "string" || !p.name.trim()) {
          return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
        }
        const ok = saveBatchPreset(String(b.setId), { ...p, name: p.name.trim(), batchCount: Math.max(1, Math.floor(Number(p.batchCount) || 1)) });
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "セットが見つかりません" }, { status: 404 });
      }
    }
    return NextResponse.json({ error: "不正な操作です" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
