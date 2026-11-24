import { describe, expect, it } from "vitest";
import { mergeTags, toPromptTag } from "./danbooru-tags";

describe("danbooru tags", () => {
  it("アンダースコアを空白に、括弧をエスケープする", () => {
    expect(toPromptTag("long_hair")).toBe("long hair");
    expect(toPromptTag("hatsune_miku_(vocaloid)")).toBe("hatsune miku \\(vocaloid\\)");
  });
  it("重複を足さず、既存の並びを保つ", () => {
    expect(mergeTags("konata izumi, long hair", ["izumi_konata", "long_hair", "blue_hair"])).toBe("konata izumi, long hair, izumi konata, blue hair");
    expect(mergeTags("", ["a_b", "a_b"])).toBe("a b");
  });
});
