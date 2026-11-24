import { describe, expect, it } from "vitest";
import { htmlToText } from "./civitai";

describe("htmlToText", () => {
  it("タグを外し、段落・改行・箇条書きを保つ", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>2nd<br/>line</p><ul><li>a</li><li>b</li></ul>")).toBe("Hello world\n2nd\nline\n・a\n・b");
  });
  it("実体参照を戻し、スクリプトを実行可能な形では残さない", () => {
    expect(htmlToText("a &amp; b &lt;c&gt; &#12354; &#x3042;")).toBe("a & b <c> あ あ");
    expect(htmlToText('<script>alert(1)</script><img src=x onerror=alert(1)>ok')).not.toContain("<");
  });
});
