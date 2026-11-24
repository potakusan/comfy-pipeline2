import fs from "fs";
import path from "path";
import { DATA_DIR, getCivitaiKey, getLoraDir } from "./env";
import { createMemJob, finishJob, logJob } from "./jobs-memory";
import { UserError } from "./http";

/**
 * Civitai との連携(検索・コレクション・ダウンロード)と、手元の LoRA の管理。
 * API キーは v1 の設定を流用し、サーバーの中だけで使う(ブラウザには渡さない)。
 * 対象は Illustrious の LoRA。ダウンロード後は v1 と同じ形式のサイドカー(.civitai.json・プレビュー画像)を置く。
 */
const API = "https://civitai.com/api/v1";
const TRPC = "https://civitai.com/api/trpc";
const CDN = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA";
export const BASE_MODEL = "Illustrious";
const MODEL_EXT = /\.(safetensors|ckpt|pt)$/i;
const THUMB_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const SIDECAR = [".civitai.json", ".lora-template.json"];

function headers(): HeadersInit {
  const key = getCivitaiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function requireKey(): void {
  if (!getCivitaiKey()) throw new UserError("Civitai の API キーがありません。comfy-pipeline(v1)の設定に civitaiApiKey を入れてください");
}

async function civGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new UserError("Civitai に認証されませんでした。API キーを確認してください");
  if (!res.ok) throw new UserError(`Civitai からの取得に失敗しました (HTTP ${res.status})`);
  return (await res.json()) as T;
}

async function trpcGet<T>(name: string, input: unknown): Promise<T> {
  const data = await civGet<{ result?: { data?: { json?: T } } }>(`${TRPC}/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const out = data.result?.data?.json;
  if (out === undefined) throw new UserError("Civitai の応答を読み取れませんでした");
  return out;
}

/** CDN の画像 URL を、一覧向けの幅に直す(元の幅のままだと重い)。 */
function sized(url: string | null | undefined, width = 450): string | null {
  if (!url) return null;
  return /width=\d+/.test(url) ? url.replace(/width=\d+/, `width=${width}`) : url;
}
const fromUuid = (uuid: string | null | undefined, width = 450) => (uuid ? `${CDN}/${uuid}/width=${width}/${uuid}.jpeg` : null);

// ---- 手元の LoRA -----------------------------------------------------------------------

export interface LocalLora {
  fileName: string;
  name: string;
  size: number;
  mtime: string;
  thumb: string | null;
  trainedWords: string[];
  civitaiModelId: number | null;
  baseModel: string | null;
  versionName: string | null;
}

function readMeta(dir: string, base: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${base}.civitai.json`), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function listLocalLoras(): LocalLora[] {
  const dir = getLoraDir();
  if (!fs.existsSync(dir)) return [];
  const out: LocalLora[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!MODEL_EXT.test(f)) continue;
    const full = path.join(dir, f);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const base = f.replace(MODEL_EXT, "");
    const meta = readMeta(dir, base);
    const thumbExt = THUMB_EXTS.find((e) => fs.existsSync(path.join(dir, base + e)));
    out.push({
      fileName: f,
      name: typeof meta.modelName === "string" && meta.modelName ? meta.modelName : base,
      size: st.size,
      mtime: st.mtime.toISOString(),
      thumb: thumbExt ? `/api/loras/thumb?name=${encodeURIComponent(base + thumbExt)}&v=${Math.round(st.mtimeMs)}` : null,
      trainedWords: Array.isArray(meta.trainedWords) ? meta.trainedWords.map(String) : [],
      civitaiModelId: typeof meta.modelId === "number" ? meta.modelId : null,
      baseModel: typeof meta.baseModel === "string" ? meta.baseModel : null,
      versionName: typeof meta.versionName === "string" ? meta.versionName : null,
    });
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** LoRA 本体と、付いているサイドカー(メタデータ・プレビュー画像・テンプレート)を消す。 */
export function deleteLora(fileName: string): { removed: number } {
  const dir = getLoraDir();
  if (!fileName || path.basename(fileName) !== fileName || !MODEL_EXT.test(fileName)) throw new UserError("LoRA の指定が不正です");
  const full = path.join(dir, fileName);
  if (!fs.existsSync(full)) throw new UserError("LoRA が見つかりません");
  const base = fileName.replace(MODEL_EXT, "");
  let removed = 0;
  for (const p of [full, ...SIDECAR.map((e) => path.join(dir, base + e)), ...THUMB_EXTS.map((e) => path.join(dir, base + e))]) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      removed++;
    }
  }
  return { removed };
}

/** プレビュー画像の実ファイル(LoRA フォルダ直下の画像だけ) */
export function loraThumbPath(name: string): string | null {
  if (!name || path.basename(name) !== name || !THUMB_EXTS.includes(path.extname(name).toLowerCase())) return null;
  const full = path.join(getLoraDir(), name);
  return fs.existsSync(full) ? full : null;
}

// ---- 検索・コレクション ------------------------------------------------------------------

export interface ModelCard {
  id: number;
  name: string;
  creator: string | null;
  thumb: string | null;
  baseModels: string[];
  downloads: number | null;
  likes: number | null;
  installed: boolean;
}

const installedIds = () => new Set(listLocalLoras().flatMap((l) => (l.civitaiModelId ? [l.civitaiModelId] : [])));

interface RestModel {
  id: number;
  name: string;
  creator?: { username?: string };
  stats?: { downloadCount?: number; thumbsUpCount?: number; favoriteCount?: number };
  modelVersions?: { baseModel?: string; images?: { url?: string; type?: string }[] }[];
}

export async function searchLoras(opts: { query?: string; sort?: string; period?: string; cursor?: string }): Promise<{ items: ModelCard[]; nextCursor: string | null }> {
  requireKey();
  const sorts = ["Most Downloaded", "Highest Rated", "Newest"];
  const periods = ["AllTime", "Year", "Month", "Week", "Day"];
  const q = new URLSearchParams({ types: "LORA", baseModels: BASE_MODEL, limit: "24", nsfw: "true", sort: sorts.includes(opts.sort ?? "") ? opts.sort! : "Most Downloaded" });
  if (opts.query?.trim()) q.set("query", opts.query.trim());
  if (periods.includes(opts.period ?? "")) q.set("period", opts.period!);
  if (opts.cursor) q.set("cursor", opts.cursor);
  const res = await civGet<{ items: RestModel[]; metadata?: { nextCursor?: string | number } }>(`${API}/models?${q}`);
  const have = installedIds();
  return {
    items: res.items.map((m) => ({
      id: m.id,
      name: m.name,
      creator: m.creator?.username ?? null,
      thumb: sized(m.modelVersions?.flatMap((v) => v.images ?? []).find((i) => i.type !== "video" && i.url)?.url),
      baseModels: [...new Set((m.modelVersions ?? []).map((v) => v.baseModel ?? "").filter(Boolean))],
      downloads: m.stats?.downloadCount ?? null,
      likes: m.stats?.thumbsUpCount ?? m.stats?.favoriteCount ?? null,
      installed: have.has(m.id),
    })),
    nextCursor: res.metadata?.nextCursor != null ? String(res.metadata.nextCursor) : null,
  };
}

export interface CollectionCard {
  id: number;
  name: string;
  owner: string | null;
  isOwner: boolean;
  thumb: string | null;
}

/** フォロー(保存)しているモデルのコレクションと、自分のコレクション。 */
export async function listCollections(): Promise<CollectionCard[]> {
  requireKey();
  type Raw = { id: number; name: string; type: string | null; isOwner?: boolean; ownerUsername?: string | null; image?: { url?: string } | null };
  const list = await trpcGet<Raw[]>("collection.getAllUser", { permission: "VIEW" });
  return list
    .filter((c) => c.type === "Model" || c.type == null)
    .map((c) => ({ id: c.id, name: c.name, owner: c.ownerUsername ?? null, isOwner: !!c.isOwner, thumb: fromUuid(c.image?.url) }));
}

interface TrpcModel {
  id: number;
  name: string;
  type?: string;
  user?: { username?: string };
  baseModels?: string[];
  images?: { url?: string; type?: string }[];
  rank?: { downloadCountAllTime?: number; thumbsUpCountAllTime?: number };
}

/** コレクションの LoRA(Illustrious のみに絞れる)。 */
export async function collectionModels(id: number, opts: { cursor?: string; illustriousOnly: boolean }): Promise<{ items: ModelCard[]; nextCursor: string | null }> {
  requireKey();
  if (!Number.isInteger(id) || id <= 0) throw new UserError("コレクションの指定が不正です");
  const res = await trpcGet<{ items: TrpcModel[]; nextCursor?: string | null }>("model.getAll", {
    collectionId: id,
    limit: 24,
    period: "AllTime",
    sort: "Newest",
    browsingLevel: 31,
    types: ["LORA"],
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  });
  const have = installedIds();
  const items = res.items
    .filter((m) => !opts.illustriousOnly || (m.baseModels ?? []).some((b) => b.includes(BASE_MODEL)))
    .map((m) => ({
      id: m.id,
      name: m.name,
      creator: m.user?.username ?? null,
      thumb: fromUuid(m.images?.find((i) => i.type !== "video")?.url),
      baseModels: m.baseModels ?? [],
      downloads: m.rank?.downloadCountAllTime ?? null,
      likes: m.rank?.thumbsUpCountAllTime ?? null,
      installed: have.has(m.id),
    }));
  return { items, nextCursor: res.nextCursor ?? null };
}

/** コレクションのサムネイルは、一度取ったらディスクに残して、そのまま使い続ける(コレクションの中身は頻繁には変わらないため)。 */
const PREVIEW_FILE = path.join(DATA_DIR, "collection-previews.json");
let previewCache: Record<string, string[]> | null = null;
let previewChain: Promise<unknown> = Promise.resolve();

function loadPreviews(): Record<string, string[]> {
  if (!previewCache) {
    try {
      previewCache = JSON.parse(fs.readFileSync(PREVIEW_FILE, "utf8")) as Record<string, string[]>;
    } catch {
      previewCache = {};
    }
  }
  return previewCache;
}

function savePreviews(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${PREVIEW_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(previewCache), "utf8");
  fs.renameSync(tmp, PREVIEW_FILE);
}

/** コレクションに表紙がないときの代わりに、中の LoRA のサムネイルを最大4枚。初回だけ Civitai から1件ずつ取る。 */
export function collectionPreview(id: number): Promise<string[]> {
  if (!Number.isInteger(id) || id <= 0) throw new UserError("コレクションの指定が不正です");
  const cache = loadPreviews();
  if (cache[id]) return Promise.resolve(cache[id]);
  requireKey();
  const run = previewChain.then(async () => {
    const res = await trpcGet<{ items: TrpcModel[] }>("model.getAll", { collectionId: id, limit: 12, period: "AllTime", sort: "Newest", browsingLevel: 31, types: ["LORA"] });
    const thumbs = res.items.map((m) => fromUuid(m.images?.find((i) => i.type !== "video")?.url, 300)).filter((u): u is string => !!u).slice(0, 4);
    if (thumbs.length > 0) {
      cache[id] = thumbs; // 空の結果は覚えない(次回また取りに行く)
      savePreviews();
    }
    return thumbs;
  });
  previewChain = run.catch(() => undefined);
  return run;
}

// ---- 手元の LoRA に紐づく Civitai の情報(生成画面の「LoRAを編集」用) ------------------------------

export function htmlToText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|blockquote|pre)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "・")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return named[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface LoraCivitaiInfo {
  linked: boolean;
  modelId?: number;
  url?: string;
  name?: string;
  creator?: string | null;
  versionName?: string;
  trainedWords?: string[];
  images?: string[];
  description?: string;
}

const INFO_FILE = path.join(DATA_DIR, "civitai-info.json");
let infoCache: Record<string, LoraCivitaiInfo> | null = null;

function loadInfo(): Record<string, LoraCivitaiInfo> {
  if (!infoCache) {
    try {
      infoCache = JSON.parse(fs.readFileSync(INFO_FILE, "utf8")) as Record<string, LoraCivitaiInfo>;
    } catch {
      infoCache = {};
    }
  }
  return infoCache;
}

/**
 * LoRA 名(拡張子なし)から、Civitai でダウンロードしたときに残したメタデータをたどって、作成者が設定したタグ・サムネ・説明文を返す。
 * Civitai と紐づいていない LoRA(手で置いたもの・タグのみ)は linked: false。取得した内容はディスクに残し、以降はそれを使う。
 */
export async function loraCivitaiInfo(name: string): Promise<LoraCivitaiInfo> {
  const base = path.basename(name || "").replace(MODEL_EXT, "");
  if (!base || base !== (name || "").replace(MODEL_EXT, "")) return { linked: false };
  let dir: string;
  try {
    dir = getLoraDir();
  } catch {
    return { linked: false };
  }
  const meta = readMeta(dir, base);
  const modelId = typeof meta.modelId === "number" ? meta.modelId : null;
  if (!modelId) return { linked: false };
  const versionId = typeof meta.versionId === "number" ? meta.versionId : null;

  const key = `${modelId}:${versionId ?? base}`;
  const cache = loadInfo();
  if (cache[key]) return cache[key];
  requireKey();

  const m = await civGet<{ id: number; name: string; description?: string; creator?: { username?: string }; modelVersions?: (RestVersion & { description?: string })[] }>(`${API}/models/${modelId}`);
  const versions = m.modelVersions ?? [];
  const v =
    versions.find((x) => x.id === versionId) ??
    versions.find((x) => (x.files ?? []).some((f) => path.basename(f.name).replace(MODEL_EXT, "") === base)) ??
    versions[0];
  const info: LoraCivitaiInfo = {
    linked: true,
    modelId,
    url: `https://civitai.com/models/${modelId}${v ? `?modelVersionId=${v.id}` : ""}`,
    name: m.name,
    creator: m.creator?.username ?? null,
    versionName: v?.name,
    trainedWords: v?.trainedWords ?? (Array.isArray(meta.trainedWords) ? meta.trainedWords.map(String) : []),
    images: (v?.images ?? []).filter((i) => i.type !== "video" && i.url).slice(0, 8).map((i) => sized(i.url, 450)!),
    description: htmlToText([m.description ?? "", v?.description ? `【${v.name}】\n${v.description}` : ""].filter(Boolean).join("\n\n")),
  };
  cache[key] = info;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${INFO_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
  fs.renameSync(tmp, INFO_FILE);
  return info;
}

// ---- モデル詳細・ダウンロード -----------------------------------------------------------------

export interface VersionInfo {
  id: number;
  name: string;
  baseModel: string;
  trainedWords: string[];
  sizeKB: number | null;
  fileName: string | null;
  thumb: string | null;
  installed: boolean;
}
export interface ModelDetail {
  id: number;
  name: string;
  creator: string | null;
  url: string;
  versions: VersionInfo[];
}

interface RestVersion {
  id: number;
  name: string;
  baseModel?: string;
  trainedWords?: string[];
  files?: { name: string; sizeKB?: number; primary?: boolean; downloadUrl?: string; type?: string }[];
  images?: { url?: string; type?: string }[];
  modelId?: number;
  model?: { name?: string };
}

const primaryFile = (v: RestVersion) => (v.files ?? []).find((f) => f.primary) ?? (v.files ?? [])[0];

export async function modelDetail(id: number): Promise<ModelDetail> {
  requireKey();
  if (!Number.isInteger(id) || id <= 0) throw new UserError("モデルの指定が不正です");
  const m = await civGet<{ id: number; name: string; creator?: { username?: string }; modelVersions?: RestVersion[] }>(`${API}/models/${id}`);
  const local = new Set(listLocalLoras().map((l) => l.fileName));
  const versions = (m.modelVersions ?? []).map((v) => {
    const f = primaryFile(v);
    return {
      id: v.id,
      name: v.name,
      baseModel: v.baseModel ?? "",
      trainedWords: v.trainedWords ?? [],
      sizeKB: f?.sizeKB ?? null,
      fileName: f?.name ?? null,
      thumb: sized(v.images?.find((i) => i.type !== "video" && i.url)?.url, 300),
      installed: !!f && local.has(path.basename(f.name)),
    };
  });
  // Illustrious のバージョンを先頭に
  versions.sort((a, b) => Number(b.baseModel.includes(BASE_MODEL)) - Number(a.baseModel.includes(BASE_MODEL)));
  return { id: m.id, name: m.name, creator: m.creator?.username ?? null, url: `https://civitai.com/models/${m.id}`, versions };
}

/** LoRA をダウンロードして LoRA フォルダに置く(進捗は /api/job)。すでに同名のファイルがあれば断る。 */
export async function startLoraDownload(versionId: number): Promise<{ jobId: string; fileName: string }> {
  requireKey();
  if (!Number.isInteger(versionId) || versionId <= 0) throw new UserError("バージョンの指定が不正です");
  const v = await civGet<RestVersion>(`${API}/model-versions/${versionId}`);
  const file = primaryFile(v);
  if (!file?.downloadUrl) throw new UserError("ダウンロードできるファイルがありません");
  const fileName = path.basename(file.name);
  if (!MODEL_EXT.test(fileName)) throw new UserError("LoRA のファイル形式ではありません");
  const dir = getLoraDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, fileName);
  if (fs.existsSync(dest)) throw new UserError(`${fileName} はすでにあります`);

  const job = createMemJob("lora-download", Math.max(1, Math.round((file.sizeKB ?? 0) * 1024)));
  logJob(job, `[civitai] ${v.model?.name ?? fileName} / ${v.name} をダウンロードします`);
  const base = fileName.replace(MODEL_EXT, "");
  const part = `${dest}.part`;
  void (async () => {
    try {
      const res = await fetch(file.downloadUrl!, { headers: headers() });
      if (!res.ok || !res.body) throw new Error(`ダウンロードに失敗しました (HTTP ${res.status})`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > 0) job.total = len;
      const out = fs.createWriteStream(part);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once("drain", () => r()));
        job.current += value.length;
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      fs.renameSync(part, dest);

      fs.writeFileSync(
        path.join(dir, `${base}.civitai.json`),
        JSON.stringify({ modelName: v.model?.name ?? base, trainedWords: v.trainedWords ?? [], modelId: v.modelId, versionId: v.id, versionName: v.name, baseModel: v.baseModel }, null, 2),
      );
      const preview = v.images?.find((i) => i.type !== "video" && i.url)?.url;
      if (preview) {
        try {
          const pr = await fetch(sized(preview, 450)!);
          if (pr.ok) fs.writeFileSync(path.join(dir, `${base}.jpg`), Buffer.from(await pr.arrayBuffer()));
        } catch {
          // プレビューが取れなくても、LoRA 本体は使える
        }
      }
      logJob(job, `[civitai] ${fileName} を保存しました`);
      job.current = job.total;
      finishJob(job);
    } catch (e) {
      fs.rmSync(part, { force: true });
      finishJob(job, e instanceof Error ? e.message : String(e));
    }
  })();
  return { jobId: job.id, fileName };
}
