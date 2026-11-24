import type { Preset, PresetType } from "@/lib/comfy/comfy-types";
import { collectTemplateVariables, type ItemTemplate } from "@/lib/comfy/item";
import { isCommentLine } from "@/lib/comfy/prompt";
import { getVariableDef, type VariableBindings } from "@/lib/comfy/prompt-variables";
import { readLibrary, type Library } from "./library";
import { readSettings } from "./store";

/** 画面で選んだ内容。単発(1つの組み合わせ)と一括キュー(保存済みセット)の2通り。 */
export interface PlanRequest {
  mode: "single" | "batch";
  size?: { width: number; height: number };
  /** 入力モードの変数にユーザーが与えた値 */
  variableValues?: VariableBindings;
  single?: {
    loraName?: string | null;
    physicalIds?: string[];
    countId?: string | null;
    poseId?: string | null;
    sceneId?: string | null;
    otherIds?: string[];
    additionalPrompt?: string;
    additionalMode?: "all" | "random";
    randomComposition?: boolean;
    count: number;
  };
  batch?: {
    /** 複数のセットをまとめて実行できる。presetIds 省略時はそのセットのすべて */
    sets: { setId: string; presetIds?: string[]; /** このセットの全プリセットに使うシーン(プリセット固有のシーンがあればそちらが優先) */ sceneId?: string | null }[];
    loraName?: string | null;
    physicalIds?: string[];
    /** 枚数をセットの値ではなくこの値で上書きする */
    countOverride?: number;
  };
}

export interface PlannedItem {
  template: ItemTemplate;
  count: number;
  /** 一括キューのプリセット id(テスト生成で「どのプリセットを使ったか」を返すため) */
  batchPresetId?: string;
}

const byIds = (list: Preset[], ids?: string[]) => (ids ?? []).flatMap((id) => list.find((p) => p.id === id) ?? []);
const byId = (list: Preset[], id?: string | null) => (id ? (list.find((p) => p.id === id) ?? null) : null);

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !isCommentLine(s));
}

function loraLabel(name: string | undefined): string | null {
  return name?.split("/").pop()?.replace(".safetensors", "") ?? null;
}

export function buildPlan(req: PlanRequest, lib: Library = readLibrary()): PlannedItem[] {
  const settings = { ...readSettings(), ...(req.size ?? {}) };
  const common = {
    fixedLoras: lib.fixedLoras,
    fixedTags: lib.fixedTags,
    settings,
    variableDefs: lib.variableDefs,
  };

  if (req.mode === "single") {
    const s = req.single;
    if (!s) throw new Error("選択内容がありません");
    const variableLora = lib.variableLoras.find((l) => l.name === s.loraName) ?? null;
    const presets = {
      physical: byIds(lib.physical, s.physicalIds),
      count: byId(lib.count, s.countId),
      pose: byId(lib.pose, s.poseId),
      scene: byId(lib.scene, s.sceneId),
      other: byIds(lib.other, s.otherIds),
    };
    const names = [presets.count, presets.pose, presets.scene].flatMap((p) => (p ? [p.name] : []));
    const template: ItemTemplate = {
      ...common,
      label: [loraLabel(variableLora?.name), ...names].filter(Boolean).join(" / ") || "生成",
      loraName: variableLora?.name ?? "no-lora",
      variableLora,
      presets,
      additionalLines: lines(s.additionalPrompt ?? ""),
      additionalMode: s.additionalMode ?? "all",
      variationTags: s.randomComposition ? lib.variationTags : [],
      negativePrompt: lib.negativePrompt,
      variableValues: req.variableValues ?? {},
    };
    return [{ template, count: Math.max(1, Math.floor(s.count)) }];
  }

  const b = req.batch;
  if (!b || b.sets.length === 0) throw new Error("一括キューのセットが選ばれていません");
  const variableLora = lib.variableLoras.find((l) => l.name === b.loraName) ?? null;
  const physical = byIds(lib.physical, b.physicalIds);
  const multi = b.sets.length > 1;

  return b.sets.flatMap(({ setId, presetIds, sceneId }) => {
    const overrideScene = byId(lib.scene, sceneId);
    const set = lib.batchSets.find((x) => x.id === setId);
    if (!set) throw new Error("一括キューのセットが見つかりません");
    return set.presets
      .filter((p) => !presetIds || presetIds.includes(p.id))
      .map((p) => {
        const template: ItemTemplate = {
          ...common,
          // 複数セットでは同名のプリセットが混ざるので、キュー画面でも見分けられるようセット名を前に付ける
          label: [multi ? set.name : null, loraLabel(variableLora?.name), p.name].filter(Boolean).join(" / ") || "(一括)",
          filePrefix: p.name || undefined,
          loraName: variableLora?.name ?? "no-lora",
          variableLora,
          presets: {
            physical,
            count: byId(lib.count, p.countPresetId),
            pose: byId(lib.pose, p.posePresetId),
            // プリセット固有のシーンがあればそちらを優先する(v1 と同じ)
            scene: byId(lib.scene, p.scenePresetId) ?? overrideScene,
            other: lib.other.filter((o) => p.otherPresetIds.includes(o.id)),
          },
          additionalLines: lines(p.additionalPrompt ?? ""),
          additionalMode: p.additionalPromptMode ?? "all",
          variationTags: p.randomCompositionEnabled === false ? [] : [...(p.variationTags ?? [])],
          // v1 の一括キューはグローバルではなくプリセット固有のネガティブを使う
          negativePrompt: p.negativePrompt ?? "",
          variableValues: { ...p.variableValues, ...req.variableValues },
        };
        return { template, count: Math.max(1, Math.floor(b.countOverride ?? p.batchCount)), batchPresetId: p.id };
      });
  });
}

export interface VariableInfo {
  name: string;
  mode: "fixed" | "random" | "input";
  value: string;
  candidates: string[];
  defined: boolean;
}

/** 計画が参照している %%変数%% の一覧(定義の有無と現在値つき)。 */
export function scanVariables(items: PlannedItem[], lib: Library = readLibrary()): VariableInfo[] {
  const names = new Set<string>();
  for (const it of items) for (const n of collectTemplateVariables(it.template)) names.add(n);
  return [...names].map((name) => {
    const def = getVariableDef(lib.variableDefs, name);
    return {
      name,
      mode: def.mode,
      value: def.value ?? "",
      candidates: def.candidates ?? [],
      defined: !!lib.variableDefs[name],
    };
  });
}

export type { PresetType };
