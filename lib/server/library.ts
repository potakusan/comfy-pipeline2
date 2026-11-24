import fs from "fs";
import path from "path";
import { getLibraryDir } from "./env";
import type { LoraEntry, Preset, PresetCategory, PresetType } from "@/lib/comfy/comfy-types";
import type { VariableDef, VariableDefs } from "@/lib/comfy/prompt-variables";
import type { BatchPresetSet, BatchPreset } from "@/lib/comfy/batch";

/**
 * v1 の data/library/*.json。v1 は「JSON を直接編集すれば数秒で反映される」設計で、
 * 書き込みは検証→一時ファイル→rename(AIや別プロセスに壊れたJSONを見せない)。モバイル版も同じ手順で書く。
 */
const FILES = {
  fixedLoras: "fixed-loras.json",
  variableLoras: "variable-loras.json",
  physical: "physical-presets.json",
  count: "count-presets.json",
  pose: "pose-presets.json",
  scene: "scene-presets.json",
  other: "other-presets.json",
  categories: "preset-categories.json",
  batchSets: "batch-preset-sets.json",
  variableDefs: "variable-defs.json",
  fixedTags: "fixed-tags.json",
  negativePrompt: "negative-prompt.json",
  variationTags: "variation-tags.json",
} as const;

type FileKey = keyof typeof FILES;

function readJson<T>(key: FileKey, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(getLibraryDir(), FILES[key]), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: FileKey, value: unknown): void {
  const dir = getLibraryDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILES[key]);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export interface Library {
  fixedLoras: LoraEntry[];
  variableLoras: LoraEntry[];
  physical: Preset[];
  count: Preset[];
  pose: Preset[];
  scene: Preset[];
  other: Preset[];
  categories: PresetCategory[];
  batchSets: BatchPresetSet[];
  variableDefs: VariableDefs;
  fixedTags: string;
  negativePrompt: string;
  variationTags: string[];
}

export function readLibrary(): Library {
  return {
    fixedLoras: readJson("fixedLoras", []),
    variableLoras: readJson("variableLoras", []),
    physical: readJson("physical", []),
    count: readJson("count", []),
    pose: readJson("pose", []),
    scene: readJson("scene", []),
    other: readJson("other", []),
    categories: readJson("categories", []),
    batchSets: readJson("batchSets", []),
    variableDefs: readJson("variableDefs", {}),
    fixedTags: readJson("fixedTags", ""),
    negativePrompt: readJson("negativePrompt", ""),
    variationTags: readJson("variationTags", []),
  };
}

// ---- プリセットの編集 -----------------------------------------------------------

export function isPresetType(t: string): t is PresetType {
  return t === "physical" || t === "count" || t === "pose" || t === "scene" || t === "other";
}

export function savePreset(type: PresetType, preset: Preset): Preset[] {
  const list = readJson<Preset[]>(type, []);
  const next = { ...preset, type };
  const i = list.findIndex((p) => p.id === preset.id);
  if (i >= 0) list[i] = { ...list[i], ...next };
  else list.push(next);
  writeJson(type, list);
  return list;
}

/** 一括キューのプリセットなど、id で参照している箇所があるので、使用中のものは削除させない。 */
export function deletePreset(type: PresetType, id: string): { error: string } | { ok: true } {
  const used = readJson<BatchPresetSet[]>("batchSets", []).some((s) =>
    s.presets.some(
      (p) => p.countPresetId === id || p.posePresetId === id || p.scenePresetId === id || p.otherPresetIds.includes(id),
    ),
  );
  if (used) return { error: "一括キューのプリセットで使われているため削除できません" };
  writeJson(
    type,
    readJson<Preset[]>(type, []).filter((p) => p.id !== id),
  );
  return { ok: true };
}

// ---- 変数の編集 -----------------------------------------------------------------

export function saveVariableDef(def: VariableDef): VariableDefs {
  const defs = readJson<VariableDefs>("variableDefs", {});
  defs[def.name] = def;
  writeJson("variableDefs", defs);
  return defs;
}

export function deleteVariableDef(name: string): VariableDefs {
  const defs = readJson<VariableDefs>("variableDefs", {});
  delete defs[name];
  writeJson("variableDefs", defs);
  return defs;
}

// ---- LoRA の編集(強度・トリガーワードのみ) ---------------------------------------

export function saveVariableLora(lora: Pick<LoraEntry, "name" | "strength" | "clipStrength" | "triggerWords">, which: "variableLoras" | "fixedLoras" = "variableLoras"): boolean {
  const list = readJson<LoraEntry[]>(which, []);
  const i = list.findIndex((l) => l.name === lora.name);
  if (i < 0) return false;
  list[i] = { ...list[i], ...lora };
  writeJson(which, list);
  return true;
}

/** 固定ポジティブプロンプト(全ての生成の先頭に付くタグ) */
export function saveFixedTags(text: string): void {
  writeJson("fixedTags", text);
}

// ---- 固定LoRA(全ての生成に必ず適用される LoRA) -----------------------------------------

export function addFixedLora(lora: { name: string; strength: number; clipStrength: number; triggerWords: string; families?: ("sdxl" | "anima")[] }): "ok" | "duplicate" {
  const list = readJson<LoraEntry[]>("fixedLoras", []);
  if (list.some((l) => l.name === lora.name)) return "duplicate";
  list.push({
    name: lora.name,
    strength: lora.strength,
    clipStrength: lora.clipStrength,
    triggerWords: lora.triggerWords,
    ...(lora.families && lora.families.length > 0 && lora.families.join() !== "sdxl" ? { families: lora.families } : {}),
  });
  writeJson("fixedLoras", list);
  return "ok";
}

/** 生成画面の「キャラクター」(variable-loras.json)の項目をリストから外す。LoRA のファイルは消さない。 */
export function deleteVariableLora(name: string): boolean {
  const list = readJson<LoraEntry[]>("variableLoras", []);
  if (!list.some((l) => l.name === name)) return false;
  writeJson("variableLoras", list.filter((l) => l.name !== name));
  return true;
}

export function deleteFixedLora(name: string): boolean {
  const list = readJson<LoraEntry[]>("fixedLoras", []);
  if (!list.some((l) => l.name === name)) return false;
  writeJson("fixedLoras", list.filter((l) => l.name !== name));
  return true;
}

/** 生成画面の「LoRA」リストに追加する。promptOnly = LoRA ファイルを使わず、タグ(とフォルダ名)だけのもの。 */
export function addVariableLora(lora: { name: string; strength: number; clipStrength: number; triggerWords: string; promptOnly: boolean; families?: ("sdxl" | "anima")[] }): "ok" | "duplicate" {
  const list = readJson<LoraEntry[]>("variableLoras", []);
  if (list.some((l) => l.name === lora.name)) return "duplicate";
  const entry: LoraEntry = {
    name: lora.name,
    strength: lora.promptOnly ? 1 : lora.strength,
    clipStrength: lora.promptOnly ? 1 : lora.clipStrength,
    triggerWords: lora.triggerWords,
    ...(lora.promptOnly ? { isPromptOnly: true } : lora.families && lora.families.length > 0 && lora.families.join() !== "sdxl" ? { families: lora.families } : {}),
  };
  list.push(entry);
  writeJson("variableLoras", list);
  return "ok";
}

/** 登録済みの LoRA 名(アーカイブ済みも含む) */
export function variableLoraNames(): string[] {
  return readJson<LoraEntry[]>("variableLoras", []).map((l) => l.name);
}

// ---- 一括キューのプリセット編集 -----------------------------------------------------

export function saveBatchPreset(setId: string, preset: BatchPreset): boolean {
  const sets = readJson<BatchPresetSet[]>("batchSets", []);
  const set = sets.find((s) => s.id === setId);
  if (!set) return false;
  const i = set.presets.findIndex((p) => p.id === preset.id);
  if (i >= 0) set.presets[i] = { ...set.presets[i], ...preset };
  else set.presets.push(preset);
  writeJson("batchSets", sets);
  return true;
}
