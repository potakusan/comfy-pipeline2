import { NextRequest, NextResponse } from "next/server";
import {
  addFixedLora,
  addVariableLora,
  deleteFixedLora,
  deleteVariableLora,
  saveFixedTags,
  setVariableLoraArchived,
  saveNegativePrompt,
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
      case "get-negative":
        return NextResponse.json({ text: lib.negativePrompt });
      case "save-negative":
        saveNegativePrompt(String(b.text ?? ""));
        return NextResponse.json({ ok: true });
      case "get-fixed-tags":
        return NextResponse.json({ text: lib.fixedTags });
      case "save-fixed-tags":
        saveFixedTags(String(b.text ?? ""));
        return NextResponse.json({ ok: true });
      case "list-fixed":
        return NextResponse.json({ loras: lib.fixedLoras });
      case "add-fixed-lora": {
        const l = b.lora;
        const name = String(l?.name ?? "").trim();
        if (!name || /[\/:*?"<>|]/.test(name)) return NextResponse.json({ error: "LoRA を選んでください" }, { status: 400 });
        const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const r = addFixedLora({
          name,
          strength: num(l?.strength, 1),
          clipStrength: num(l?.clipStrength, 1),
          triggerWords: String(l?.triggerWords ?? ""),
          families: Array.isArray(l?.families) ? l.families.filter((f: string) => f === "sdxl" || f === "anima") : undefined,
        });
        return r === "ok" ? NextResponse.json({ ok: true, name }) : NextResponse.json({ error: "同じ名前がすでに固定されています" }, { status: 409 });
      }
      case "set-lora-archived":
        return setVariableLoraArchived(String(b.name), !!b.archived) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      case "delete-lora":
        return deleteVariableLora(String(b.name)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      case "delete-fixed-lora":
        return deleteFixedLora(String(b.name)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      case "get-lora": {
        const l = (b.fixed ? lib.fixedLoras : lib.variableLoras).find((x) => x.name === b.name);
        return l ? NextResponse.json({ lora: l }) : NextResponse.json({ error: "見つかりません" }, { status: 404 });
      }
      case "save-lora": {
        const l = b.lora;
        const ok = saveVariableLora({
          name: String(l?.name),
          strength: Number(l?.strength),
          clipStrength: Number(l?.clipStrength),
          triggerWords: String(l?.triggerWords ?? ""),
        }, b.fixed ? "fixedLoras" : "variableLoras");
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "LoRAが見つかりません" }, { status: 404 });
      }
      case "add-lora": {
        const l = b.lora;
        const name = String(l?.name ?? "").trim();
        if (!name || /[\\/:*?"<>|]/.test(name)) return NextResponse.json({ error: "名前を入力してください(\ / : * ? \" < > | は使えません)" }, { status: 400 });
        const promptOnly = !!l?.promptOnly;
        const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
        const r = addVariableLora({
          name,
          strength: num(l?.strength, 1),
          clipStrength: num(l?.clipStrength, 1),
          triggerWords: String(l?.triggerWords ?? ""),
          promptOnly,
          families: Array.isArray(l?.families) ? l.families.filter((f: string) => f === "sdxl" || f === "anima") : undefined,
        });
        if (r === "archived") return NextResponse.json({ error: "同じ名前のキャラクターが、アーカイブに入っています。キャラクターの一覧の「アーカイブを表示」をオンにすると、そのまま選べます", archived: true }, { status: 409 });
        return r === "ok" ? NextResponse.json({ ok: true, name }) : NextResponse.json({ error: "同じ名前がすでに登録されています" }, { status: 409 });
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
