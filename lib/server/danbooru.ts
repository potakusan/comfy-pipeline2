import { getDanbooruAuth } from "./env";
import { UserError } from "./http";

/**
 * Danbooru のポストのタグを取る(LoRA のトリガーワードに取り込む用)。
 * ログイン名・API キーは v1 の設定を流用し、サーバーの中だけで使う。規約どおり、最小間隔を空けて、専用の User-Agent を付ける。
 */
const BASE = "https://danbooru.donmai.us";
const UA = "ComfyPipeline2/1.0 (tag import; +https://github.com/)";
let last = 0;

export interface PostTags {
  id: number;
  character: string[];
  copyright: string[];
  general: string[];
}

export function parsePostId(input: string): number | null {
  const m = /danbooru\.donmai\.us\/posts\/(\d+)/.exec(input) ?? /^\s*(\d+)\s*$/.exec(input);
  return m ? Number(m[1]) : null;
}

const split = (s: unknown) => (typeof s === "string" ? s.split(" ").filter(Boolean) : []);

export async function fetchPostTags(id: number): Promise<PostTags> {
  const wait = last + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const url = new URL(`/posts/${id}.json`, BASE);
  const auth = getDanbooruAuth();
  if (auth) {
    url.searchParams.set("login", auth.login);
    url.searchParams.set("api_key", auth.apiKey);
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: `${BASE}/` }, cache: "no-store" });
  if (res.status === 404) throw new UserError("Danbooru の投稿が見つかりません");
  if (!res.ok) throw new UserError(`Danbooru の取得に失敗しました (HTTP ${res.status})`); // URL は api_key を含むので出さない
  const raw = (await res.json()) as Record<string, unknown>;
  return { id, character: split(raw.tag_string_character), copyright: split(raw.tag_string_copyright), general: split(raw.tag_string_general) };
}
