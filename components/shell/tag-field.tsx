"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { parseTags, removeTag } from "@/lib/comfy/tag-list";
import { Textarea } from "@/components/ui/textarea";

interface Tag {
  en: string;
  ja: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  style?: React.CSSProperties;
}

/** カーソル位置の「カンマ・改行で区切られた1語」とその開始位置。v1 と同じ区切り規則。 */
function tokenAt(text: string, cursor: number): { token: string; start: number } {
  const before = text.slice(0, cursor);
  const sep = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n"));
  const raw = before.slice(sep + 1);
  const lead = raw.length - raw.trimStart().length;
  return { token: raw.trimStart(), start: sep + 1 + lead };
}

/**
 * タグ辞書(danbooru の日本語訳つき)からサジェストする入力欄。v1 の TagAutocompleteTextarea 相当。
 * 候補は入力欄の直下に縦に出し、タップで「タグ, 」を挿入する(スマホではキーボードの Enter/Tab に頼れないため)。
 * `%%変数%%` を打っている途中と、# で始まるコメント行では出さない。
 */
export function TagField({ value, onChange, multiline, rows = 6, id, placeholder, style, ...rest }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const startRef = useRef(0);
  const seq = useRef(0);

  const suggest = useCallback((text: string, cursor: number) => {
    const { token, start } = tokenAt(text, cursor);
    startRef.current = start;
    const n = ++seq.current;
    if (token.length < 1 || token.startsWith("#") || token.includes("%%")) {
      setTags([]);
      return;
    }
    // 打鍵のたびに投げないよう少し待ち、古い応答は捨てる
    setTimeout(async () => {
      if (n !== seq.current) return;
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { tags?: Tag[] };
        if (n === seq.current) setTags(data.tags ?? []);
      } catch {
        if (n === seq.current) setTags([]);
      }
    }, 150);
  }, []);

  useEffect(() => () => void (seq.current = Number.MAX_SAFE_INTEGER), []);

  function insert(tag: Tag) {
    const el = ref.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, startRef.current);
    const after = value.slice(cursor).replace(/^\s+/, "");
    const insertion = `${tag.en}, `;
    onChange(before + insertion + after);
    setTags([]);
    const pos = before.length + insertion.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  const common = {
    id,
    placeholder,
    value,
    style,
    "aria-label": rest["aria-label"],
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      onChange(e.target.value);
      suggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    // 候補をタップする前に blur で消えないよう、少し遅らせて閉じる
    onBlur: () => setTimeout(() => setTags([]), 200),
    autoCapitalize: "off",
    autoCorrect: "off",
    spellCheck: false,
  };

  const tokens = parseTags(value);

  /** チップの本体をタップ: その語を選択して、入力欄で書き換えられるようにする */
  function select(start: number, end: number) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-xs)", minWidth: 0 }}>
      {multiline ? (
        <Textarea ref={ref} rows={rows} {...common} />
      ) : (
        <Input ref={ref} {...common} />
      )}
      {tokens.length > 0 && (
        <ul className="tag-cloud" aria-label={`入力済みのタグ(${tokens.length}個)`}>
          {tokens.map((t, i) => (
            <li key={`${i}-${t.start}`} className="tag-chip" data-variable={t.variable}>
              <button type="button" className="tag-chip-text" onClick={() => select(t.start, t.end)} title="タップで入力欄の語を選択">
                {t.text}
              </button>
              <button type="button" className="tag-chip-x" aria-label={`${t.text} を削除`} onClick={() => onChange(removeTag(value, t))}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags.length > 0 && (
        <ul className="tag-suggest" role="listbox" aria-label="タグの候補">
          {tags.map((t) => (
            <li key={t.en} role="option" aria-selected={false}>
              <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => insert(t)}>
                <span className="measured">{t.en}</span>
                <span className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.ja}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
