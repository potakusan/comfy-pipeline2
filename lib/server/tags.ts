import fs from "fs";
import path from "path";
import { DATA_DIR } from "./env";

// v1 と同じタグ辞書(danbooru タグの日本語訳)。スマホに数MBの CSV を落とさせないよう、
// サーバーが1回だけ取得して data/tags.csv に保存し、検索 API で候補だけ返す。
const CSV_URL = "https://raw.githubusercontent.com/boorutan/booru-japanese-tag/refs/heads/main/danbooru-machine-jp.csv";
const CACHE_FILE = path.join(DATA_DIR, "tags.csv");
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface TagEntry {
  en: string;
  ja: string;
}

function parseCsv(text: string): TagEntry[] {
  const out: TagEntry[] = [];
  for (const line of text.split("\n")) {
    const i = line.indexOf(",");
    if (i === -1) continue;
    const en = line.slice(0, i).trim();
    const ja = line.slice(i + 1).trim();
    if (en) out.push({ en, ja });
  }
  return out;
}

const g = globalThis as unknown as { __cpTags?: Promise<TagEntry[]> };

async function load(): Promise<TagEntry[]> {
  let stale = true;
  let cached: string | null = null;
  try {
    cached = fs.readFileSync(CACHE_FILE, "utf8");
    stale = Date.now() - fs.statSync(CACHE_FILE).mtimeMs > MAX_AGE_MS;
  } catch {}
  if (cached && !stale) return parseCsv(cached);
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, text, "utf8");
    return parseCsv(text);
  } catch {
    // 取得できなければ古いキャッシュで続ける(無ければ空)
    return cached ? parseCsv(cached) : [];
  }
}

/** 前方一致 → 部分一致の順で返す。日本語はそのまま部分一致。 */
export async function searchTags(query: string, limit = 8): Promise<TagEntry[]> {
  const q = query.trim();
  if (!q) return [];
  g.__cpTags ??= load();
  const tags = await g.__cpTags;
  const lower = q.toLowerCase().replace(/\s+/g, "_");
  const prefix: TagEntry[] = [];
  const partial: TagEntry[] = [];
  for (const t of tags) {
    const en = t.en.toLowerCase();
    if (en.startsWith(lower) || t.ja.startsWith(q)) prefix.push(t);
    else if (en.includes(lower) || t.ja.includes(q)) partial.push(t);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...partial].slice(0, limit);
}
