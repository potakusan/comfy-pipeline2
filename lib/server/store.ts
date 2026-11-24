import fs from "fs";
import path from "path";
import { DATA_DIR } from "./env";
import type { GenerationSettings, ImageMetadata } from "@/lib/comfy/comfy-types";
import type { ItemTemplate } from "@/lib/comfy/item";

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 一時ファイルへ書いてから rename し、読み取り中に壊れたJSONを見せない。 */
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = path.join(DATA_DIR, file);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, target);
}

// ---- 生成設定 ------------------------------------------------------------

export const DEFAULT_SETTINGS: GenerationSettings = {
  checkpoint: "waiIllustriousSDXL_v170.safetensors",
  modelFamily: "sdxl",
  upscaleModel: "RealESRGAN_x4plus_anime_6B.pth",
  upscaleSteps: 0,
  width: 960,
  height: 1600,
  randomizeSeed: true,
  seed: 0,
  steps: 48,
  cfg: 3,
  sampler: "euler_ancestral",
  scheduler: "karras",
  denoise: 1,
};

export function readSettings(): GenerationSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<GenerationSettings>>("settings.json", {}) };
}

export function writeSettings(patch: Partial<GenerationSettings>): GenerationSettings {
  const next = { ...readSettings(), ...patch };
  writeJson("settings.json", next);
  return next;
}

// ---- 保留キュー(まだ ComfyUI へ送っていないもの) --------------------------------

export interface HeldEntry {
  id: string;
  template: ItemTemplate;
  /** 作る枚数 */
  count: number;
  addedAt: number;
  /** 一括キューのセット(一時停止を「いまのセットが終わるまで」で区切るため) */
  setId?: string;
  setName?: string;
}

export function readHeld(): HeldEntry[] {
  return readJson<HeldEntry[]>("held.json", []);
}

export function writeHeld(items: HeldEntry[]): void {
  writeJson("held.json", items);
}

// ---- 送信済みジョブ ---------------------------------------------------------------

export interface JobRegen {
  /** 再生成の元画像(出力フォルダからの相対パス) */
  sourcePath: string;
  /** 元画像がリリース選択済みなら、再生成後の画像も選択する */
  releaseAfter: boolean;
}

export interface PendingJob {
  promptId: string;
  kind: "batch" | "test" | "regen";
  /** 同じアイテム(雛形)から作られたジョブの束ね先 */
  entryId: string;
  /** アイテム内の何枚目か(0始まり) */
  index: number;
  label: string;
  /** ComfyUI へ渡した filename_prefix(「フォルダ/接頭辞」) */
  outputPrefix: string;
  meta: ImageMetadata;
  regen?: JobRegen;
  submittedAt: number;
}

export function readJobs(): PendingJob[] {
  return readJson<PendingJob[]>("jobs.json", []);
}

export function writeJobs(jobs: PendingJob[]): void {
  writeJson("jobs.json", jobs);
}

/** 実行中・待機中のジョブが参照するアイテム雛形(やり直しの「引き直し」に使う)。 */
export interface EntryRecord {
  template: ItemTemplate;
  /** 開始時の総枚数 */
  total: number;
  setId?: string;
  setName?: string;
}

/**
 * ジョブ・雛形の更新は、必ず読み→変更→書きを await を挟まず同期で行う。
 * (ComfyUI への問い合わせを待つ間に別のリクエストが追加したジョブを、古い一覧で上書きして消さないため。
 *  Node は1プロセスで動くので、同期のまま完結すれば他のリクエストと割り込み合わない)
 */
export function updateJobs(fn: (jobs: PendingJob[]) => PendingJob[]): void {
  writeJobs(fn(readJobs()));
}

export function updateEntries(fn: (entries: Record<string, EntryRecord>) => Record<string, EntryRecord>): void {
  writeEntries(fn(readEntries()));
}

export function readEntries(): Record<string, EntryRecord> {
  return readJson<Record<string, EntryRecord>>("entries.json", {});
}

export function writeEntries(items: Record<string, EntryRecord>): void {
  writeJson("entries.json", items);
}

// ---- 完成・失敗 -------------------------------------------------------------------

export interface RecentImage {
  path: string;
  promptId: string;
  /** どのアイテム(まとめて作った束)の画像か。「あと何枚か生成」の進み具合の集計に使う */
  entryId?: string;
  label: string;
  at: number;
  kind: PendingJob["kind"];
}

export function readRecent(): RecentImage[] {
  return readJson<RecentImage[]>("recent.json", []);
}

export function writeRecent(items: RecentImage[]): void {
  writeJson("recent.json", items.slice(0, 60));
}

export interface FailedJob {
  promptId: string;
  label: string;
  message: string;
  at: number;
}

export function readFailed(): FailedJob[] {
  return readJson<FailedJob[]>("failed.json", []);
}

export function writeFailed(items: FailedJob[]): void {
  writeJson("failed.json", items.slice(0, 20));
}

// ---- 入れ替えの記録 -------------------------------------------------------------------

export interface SwapLogEntry {
  at: number;
  folder: string;
  a: string;
  b: string;
  ok: boolean;
  newA?: string;
  newB?: string;
  error?: string;
}

export function readSwapLog(): SwapLogEntry[] {
  return readJson<SwapLogEntry[]>("swap-log.json", []);
}

export function appendSwapLog(entry: SwapLogEntry): void {
  writeJson("swap-log.json", [entry, ...readSwapLog()].slice(0, 100));
}
