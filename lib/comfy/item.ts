// v1 の QueueItem と hooks/pipeline/resolve-batch.ts(resolveItemBatch) のうち、モバイル版が使う部分。
// キューに積む「1アイテム」= 同じ素材で N 枚を作る雛形。画像1枚ごとに renderItem でランダム要素を引き直す。
import type { GenerationSettings, LoraEntry, Preset } from "./comfy-types";
import { assemblePositivePrompt, isCommentLine } from "./prompt";
import { applyVariableBindings, extractVariableNames, resolveBindings } from "./prompt-variables";
import type { VariableBindings, VariableDefs } from "./prompt-variables";

export interface ItemPresets {
  physical: Preset[];
  count: Preset | null;
  pose: Preset | null;
  scene: Preset | null;
  other: Preset[];
}

export interface ItemTemplate {
  /** キュー画面の表示名(例: LoRA名 / プリセット名) */
  label: string;
  /** 出力ファイル名の接頭辞(一括キューではプリセット名)。省略時 out */
  filePrefix?: string;
  /** 出力フォルダ名に使う可変LoRA名 */
  loraName: string;
  variableLora: LoraEntry | null;
  fixedLoras: LoraEntry[];
  fixedTags: string;
  presets: ItemPresets;
  /** 追加プロンプトの行(コメント行・空行を除いたもの) */
  additionalLines: string[];
  additionalMode: "all" | "random";
  /** ランダム構図。空なら使わない */
  variationTags: string[];
  negativePrompt: string;
  /** キュー登録時点の設定のスナップショット */
  settings: GenerationSettings;
  variableDefs: VariableDefs;
  /** 入力モードの変数にユーザーが与えた値 */
  variableValues: VariableBindings;
}

export interface RandomChoice {
  source: string;
  picked: string;
  options: string[];
}

export interface Rendered {
  positive: string;
  loras: LoraEntry[];
  bindings: VariableBindings;
  choices: RandomChoice[];
  pickedAdditional?: string;
}

export const SLOT_LABEL: Record<Preset["type"], string> = {
  physical: "身体的特徴",
  count: "人数",
  pose: "ポーズ",
  scene: "シーン",
  other: "その他",
};

const pick = <T,>(list: T[], rng: () => number): T => list[Math.floor(rng() * list.length)];

function resolveRandom(p: Preset, choices: RandomChoice[], rng: () => number): Preset {
  if (p.promptMode !== "random") return p;
  const lines = p.prompt.split("\n").filter((s) => s.trim() && !isCommentLine(s));
  if (!lines.length) return p;
  const picked = pick(lines, rng);
  choices.push({ source: `${SLOT_LABEL[p.type]}: ${p.name}`, picked, options: lines });
  return { ...p, prompt: picked };
}

/** 1枚分のプロンプト・LoRAを確定する。呼ぶたびにランダム要素を引き直す。 */
export function renderItem(t: ItemTemplate, rng: () => number = Math.random): Rendered {
  const choices: RandomChoice[] = [];
  const physical = t.presets.physical.map((p) => resolveRandom(p, choices, rng));
  const count = t.presets.count && resolveRandom(t.presets.count, choices, rng);
  const pose = t.presets.pose && resolveRandom(t.presets.pose, choices, rng);
  const scene = t.presets.scene && resolveRandom(t.presets.scene, choices, rng);
  const other = t.presets.other.map((p) => resolveRandom(p, choices, rng));
  const ordered = [...physical, ...(count ? [count] : []), ...(pose ? [pose] : []), ...(scene ? [scene] : []), ...other];

  const base = assemblePositivePrompt({
    fixedPrefix: t.fixedTags,
    fixedLoras: t.fixedLoras,
    variableLora: t.variableLora,
    presetParts: ordered.map((preset) => ({ preset, prompt: preset.prompt })),
    additionalPrompt: "",
  });

  let positive = base;
  let pickedAdditional: string | undefined;
  if (t.additionalLines.length > 0) {
    if (t.additionalMode === "random") {
      pickedAdditional = pick(t.additionalLines, rng);
      if (t.additionalLines.length > 1) {
        choices.push({ source: "追加プロンプト", picked: pickedAdditional, options: t.additionalLines });
      }
    } else {
      pickedAdditional = t.additionalLines.join("\n");
    }
    positive = `${positive}\n\n${pickedAdditional}`;
  }
  if (t.variationTags.length > 0) {
    const tag = pick(t.variationTags, rng);
    if (t.variationTags.length > 1) choices.push({ source: "ランダム構図", picked: tag, options: t.variationTags });
    positive = `${positive}\n\n${tag}`;
  }

  // %%name%% は抽選をすべて終えた最終文字列に対して1回だけ解決する
  const names = extractVariableNames(positive);
  let bindings: VariableBindings = {};
  if (names.length > 0) {
    bindings = resolveBindings({ names, defs: t.variableDefs, inputValues: t.variableValues, rng });
    positive = applyVariableBindings(positive, bindings);
    for (const [name, val] of Object.entries(bindings)) {
      const def = t.variableDefs[name];
      if (def?.mode === "random") choices.push({ source: `%%${name}%%`, picked: val, options: def.candidates ?? [] });
    }
  }

  const loras: LoraEntry[] = [
    ...t.fixedLoras,
    ...ordered.flatMap((p) => (p.lora ? [p.lora] : [])),
    ...(t.variableLora && !t.variableLora.isPromptOnly ? [t.variableLora] : []),
  ];

  return { positive, loras, bindings, choices, pickedAdditional };
}

/** 雛形が参照している変数名(プリセットの全行・追加プロンプト・構図タグ・固定タグを走査)。 */
export function collectTemplateVariables(t: ItemTemplate): string[] {
  const texts = [
    t.fixedTags,
    t.variableLora?.triggerWords ?? "",
    ...t.fixedLoras.map((l) => l.triggerWords),
    ...[...t.presets.physical, t.presets.count, t.presets.pose, t.presets.scene, ...t.presets.other].flatMap((p) =>
      p ? [p.prompt, p.lora?.triggerWords ?? ""] : [],
    ),
    ...t.additionalLines,
    ...t.variationTags,
  ];
  const seen = new Set<string>();
  for (const text of texts) for (const n of extractVariableNames(text)) seen.add(n);
  return [...seen];
}
