/** カンマ・改行区切りのタグ入力を、タグクラウド(チップ)で見せ、1つずつ消せるようにするための解析。 */
export interface TagToken {
  /** 前後の空白を除いたタグ */
  text: string;
  /** 元の文字列での範囲(空白を除いたタグ本体) */
  start: number;
  end: number;
  /** %%変数%% を含む */
  variable: boolean;
}

/** # で始まる行はコメントなので、タグとして数えない(v1 と同じ規則)。 */
export function parseTags(value: string): TagToken[] {
  const out: TagToken[] = [];
  let lineStart = 0;
  for (const line of value.split("\n")) {
    if (!line.trimStart().startsWith("#")) {
      let pos = lineStart;
      for (const part of line.split(",")) {
        const text = part.trim();
        if (text) {
          const start = pos + part.indexOf(text);
          out.push({ text, start, end: start + text.length, variable: text.includes("%%") });
        }
        pos += part.length + 1;
      }
    }
    lineStart += line.length + 1;
  }
  return out;
}

/**
 * 固定ネガティブと、プリセット固有のネガティブを合わせる。固定を先に、同じタグ(大文字小文字を無視)は1回だけ。
 * コメント行(#)は落とす。どちらかが空なら、もう一方をそのまま使う。
 */
export function mergeNegatives(fixed: string, own: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...parseTags(fixed), ...parseTags(own)]) {
    const k = t.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.text);
  }
  return out.join(", ");
}

/** タグを1つ取り除く。前後のカンマ・空白は整え、改行とコメント行は壊さない。 */
export function removeTag(value: string, token: TagToken): string {
  const before = value.slice(0, token.start);
  let after = value.slice(token.end);
  after = after.replace(/^[ \t]*,[ \t]*/, ""); // 直後の区切りは一緒に消す
  let head = before;
  if (after === "" || after.startsWith("\n")) head = head.replace(/,[ \t]*$/, ""); // 末尾のタグなら、直前の区切りを消す
  return head + after;
}
