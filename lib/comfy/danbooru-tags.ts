/**
 * Danbooru のタグ(アンダースコア区切り)を、プロンプト向けの表記に直す。
 * `long_hair` → `long hair`、`miku_(vocaloid)` → `miku \(vocaloid\)`(括弧は重み指定と区別するため)。
 */
export function toPromptTag(tag: string): string {
  return tag.replace(/_/g, " ").replace(/[()]/g, (c) => "\\" + c).trim();
}

/** 既存のカンマ区切りのトリガーワードに、新しいタグを重複なしで足す(順序は保つ) */
export function mergeTags(existing: string, add: string[]): string {
  const have = existing
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set(have.map((t) => t.toLowerCase()));
  const fresh = add.map(toPromptTag).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return [...have, ...fresh].join(", ");
}
