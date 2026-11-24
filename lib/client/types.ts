import type { PresetType } from "@/lib/comfy/comfy-types";

export interface SlimPreset {
  id: string;
  name: string;
  category: string | null;
  random: boolean;
}

export interface LibraryResponse {
  /** 設定タブで決めた既定の生成サイズ */
  defaultSize: { width: number; height: number };
  loras: { name: string; promptOnly: boolean }[];
  /** 固定ポジティブプロンプト(全ての生成の先頭に付く) */
  fixedTags: string;
  /** 全ての生成に必ず適用される LoRA */
  fixedLoras: { name: string }[];
  physical: SlimPreset[];
  count: SlimPreset[];
  pose: SlimPreset[];
  scene: SlimPreset[];
  other: SlimPreset[];
  categories: { id: string; name: string }[];
  variableDefs: { name: string; mode: "fixed" | "random" | "input"; value?: string; candidates?: string[] }[];
  sets: {
    id: string;
    name: string;
    presets: {
      id: string;
      name: string;
      batchCount: number;
      count: string | null;
      pose: string | null;
      scene: string | null;
    }[];
  }[];
}

export interface VariableInfo {
  name: string;
  mode: "fixed" | "random" | "input";
  value: string;
  candidates: string[];
  defined: boolean;
}

export interface JobState {
  state: "pending" | "running" | "done" | "failed" | "unknown";
  progress?: { promptId: string; value: number; max: number } | null;
  previewAt?: number | null;
  path?: string;
  message?: string;
}

export interface QueueJob {
  promptId: string;
  label: string;
  entryId: string;
  index: number;
  kind: "batch" | "test" | "regen";
}

export interface QueueResponse {
  held: { id: string; label: string; count: number; setName: string | null }[];
  running: QueueJob[];
  pending: QueueJob[];
  groups: Record<string, { label: string; total: number; remaining: number }>;
  /** 実行中のプリセットと、一時停止で保留に戻る枚数(実行中がなければ null) */
  pause: { currentName: string; holdImages: number } | null;
  progress: { promptId: string; value: number; max: number } | null;
  previewAt: number | null;
  recent: { path: string; promptId: string; entryId?: string; label: string; at: number; kind: QueueJob["kind"] }[];
  failed: { promptId: string; label: string; message: string; at: number }[];
}

export const PRESET_LABEL: Record<PresetType, string> = {
  physical: "身体的特徴",
  count: "人数",
  pose: "ポーズ",
  scene: "シーン",
  other: "その他",
};

export interface MosaicAlbum {
  name: string;
  sourceCount: number;
  mosaicCount: number;
  firstImage: string | null;
}

export interface MosaicImage {
  filename: string;
  source: { path: string; v: number } | null;
  mosaic: { path: string; v: number } | null;
}

export interface MemJobState<R = unknown> {
  id: string;
  status: "running" | "completed" | "failed";
  total: number;
  current: number;
  log: string[];
  results: R[];
  error?: string;
}
