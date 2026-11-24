// v1 の BatchPreset / BatchPresetSet のうち、モバイル版が読み書きするフィールド。
// v1 のファイルとそのまま互換(知らないフィールドは保存時に残す)。
import type { VariableBindings } from "./prompt-variables";

export interface BatchPreset {
  id: string;
  name: string;
  countPresetId: string | null;
  /** 設定時は、実行前に選んだシーンより優先する */
  scenePresetId?: string | null;
  posePresetId: string | null;
  otherPresetIds: string[];
  additionalPrompt: string;
  additionalPromptMode: "all" | "random";
  fixedTags: string;
  negativePrompt: string;
  variationEnabled: boolean;
  variationTags: string[];
  /** 未設定(undefined)はオン */
  randomCompositionEnabled?: boolean;
  batchCount: number;
  variableValues?: VariableBindings;
  // 下絵(img2img)関連の imageRef / imageRefPool は v1 のみ対応。保存時にそのまま残す。
  [extra: string]: unknown;
}

export interface BatchPresetSet {
  id: string;
  name: string;
  presets: BatchPreset[];
}
