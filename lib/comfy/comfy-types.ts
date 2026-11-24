// comfy-pipeline (v1) の lib/comfy/comfy-types.ts から、モバイル版で使う型だけを抜き出したもの。
// workflow-builder.ts / adetailer.ts / lora-family.ts / prompt-variables.ts は v1 と同一ファイルを使うため、
// ここの型は v1 と互換を保つこと(プリセット・LoRAのJSONは v1 と共有している)。

export type ModelFamily = "sdxl" | "anima";

export interface LoraEntry {
  name: string;
  strength: number;
  clipStrength: number;
  triggerWords: string;
  /** true = 実LoRAファイルを適用せず、プロンプト/フォルダ分け用のタイトルとしてのみ使う */
  isPromptOnly?: boolean;
  families?: ModelFamily[];
  isArchived?: boolean;
}

export interface GenerationSettings {
  checkpoint: string;
  modelFamily?: ModelFamily;
  unet?: string;
  textEncoder?: string;
  vae?: string;
  upscaleModel: string;
  upscaleSteps: number;
  width: number;
  height: number;
  randomizeSeed: boolean;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  upscaleSeed?: number;
}

export type PresetType = "physical" | "count" | "pose" | "scene" | "other";

export interface Preset {
  id: string;
  name: string;
  prompt: string;
  type: PresetType;
  lora?: LoraEntry;
  /** "all" = 全文を使う / "random" = 生成ごとに1行を抽選 */
  promptMode?: "all" | "random";
  category?: string;
}

export interface PresetCategory {
  id: string;
  name: string;
}

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

/** v1 が画像のメタデータに残す「生成レシピ」のうち、追加生成に使う部分 */
export interface V1Recipe {
  variableLora: LoraEntry | null;
  fixedLoras: LoraEntry[];
  fixedTags: string;
  negativePrompt: string;
  /** 抽選前のスロット別プリセット(ランダム行のプリセットは全行を保持) */
  presets: {
    selectedPhysicals: Preset[];
    selectedCount: Preset | null;
    selectedPose: Preset | null;
    selectedScene: Preset | null;
    selectedOthers: Preset[];
  };
  additionalPrompt: { mode: "all" | "random"; lines: string[] };
  variationTags: string[];
  variableDefs: Record<string, { name: string; mode: "fixed" | "random" | "input"; value?: string; candidates?: string[] }>;
  variableInputValues: Record<string, string>;
}

/** 生成画像の隣に保存するサイドカー(<file>.json)。v1 の ImageMetadata と互換。 */
export interface ImageMetadata {
  mode: "normal" | "couple" | "colorMask";
  loraName: string;
  positivePrompt: string;
  negativePrompt?: string;
  settings?: GenerationSettings;
  loras?: LoraEntry[];
  queueLabel: string;
  createdAt: number;
  appliedAdditional?: string;
  bindings?: Record<string, string>;
  randomChoices?: { source: string; picked: string; options: string[] }[];
  /** v1 の画像に付く生成レシピ */
  recipe?: V1Recipe;
  /** v2 の画像に付く、生成に使ったアイテム雛形(「あと何枚か生成」でランダム部分を引き直すため) */
  template?: import("./item").ItemTemplate;
}
