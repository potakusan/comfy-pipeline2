import { describe, expect, it } from "vitest";
import path from "path";
import { safePath } from "./env";

describe("safePath", () => {
  it("ドライブ直下(末尾が区切り)をルートにしても、配下のファイルを解決できる", () => {
    const root = path.parse(process.cwd()).root; // Windows なら C:\、それ以外は /
    expect(safePath(root, "a/b.jpg")).toBe(path.resolve(root, "a/b.jpg"));
  });
  it("ルートの外へは出さない", () => {
    expect(safePath(process.cwd(), "../x")).toBeNull();
  });
});
