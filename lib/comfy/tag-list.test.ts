import { describe, expect, it } from "vitest";
import { mergeNegatives, parseTags, removeTag } from "./tag-list";

describe("parseTags", () => {
  it("カンマ・改行で区切り、コメント行と空要素を除く", () => {
    const v = "1girl, solo,\n# memo, ignore\n%%ClothedFemale%%, (blue hair:1.2),, ";
    expect(parseTags(v).map((t) => t.text)).toEqual(["1girl", "solo", "%%ClothedFemale%%", "(blue hair:1.2)"]);
    expect(parseTags(v).find((t) => t.text === "%%ClothedFemale%%")?.variable).toBe(true);
  });
  it("範囲が元の文字列と一致する", () => {
    const v = "a b,  c d";
    for (const t of parseTags(v)) expect(v.slice(t.start, t.end)).toBe(t.text);
  });
});

describe("removeTag", () => {
  const rm = (v: string, text: string) => removeTag(v, parseTags(v).find((t) => t.text === text)!);
  it("先頭・中間・末尾のタグを消しても、区切りが整う", () => {
    expect(rm("a, b, c", "a")).toBe("b, c");
    expect(rm("a, b, c", "b")).toBe("a, c");
    expect(rm("a, b, c", "c")).toBe("a, b");
    expect(rm("a", "a")).toBe("");
  });
  it("改行とコメント行を保つ", () => {
    expect(rm("a, b,\n# note\nc, d", "d")).toBe("a, b,\n# note\nc");
    expect(rm("a, b,\n# note\nc, d", "b")).toBe("a\n# note\nc, d");
  });
});

describe("mergeNegatives", () => {
  it("固定を先に、同じタグは1回だけ、コメントは落とす", () => {
    expect(mergeNegatives("bad quality, worst quality,\n# memo\nblurry", "Blurry, jpeg artifacts,\nbad anatomy")).toBe("bad quality, worst quality, blurry, jpeg artifacts, bad anatomy");
  });
  it("片方が空なら、もう一方", () => {
    expect(mergeNegatives("", "a, b")).toBe("a, b");
    expect(mergeNegatives("a, b", "")).toBe("a, b");
    expect(mergeNegatives("", "")).toBe("");
  });
});
