import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp2-rel-"));
beforeAll(() => {
  process.env.RELEASE_ROOT_DIR = root;
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const put = (rel: string, body = "x") => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

describe("renameWork", () => {
  it("単純な改名では、フォルダと出力の名前が変わる", async () => {
    const { renameWork } = await import("./release");
    put("202611/20261101_a/g1/01.jpg");
    put("202611_PDF/20261101_a_pixiv/0.jpg");
    const r = renameWork("202611", "20261101_a", "20261101_b");
    expect(r).toMatchObject({ name: "20261101_b", merged: false });
    expect(fs.existsSync(path.join(root, "202611/20261101_b/g1/01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(root, "202611_PDF/20261101_b_pixiv/0.jpg"))).toBe(true);
  });
  it("同名の作品があればマージし、同名ファイルは連番で残す", async () => {
    const { renameWork } = await import("./release");
    put("202611/20261102_c/g1/01.jpg", "c1");
    put("202611/20261102_c/g2/01.jpg", "c2");
    const r = renameWork("202611", "20261102_c", "20261101_b");
    expect(r).toMatchObject({ merged: true, renamedFiles: 1 });
    expect(fs.readFileSync(path.join(root, "202611/20261101_b/g1/01_2.jpg"), "utf8")).toBe("c1");
    expect(fs.existsSync(path.join(root, "202611/20261101_b/g2/01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(root, "202611/20261102_c"))).toBe(false);
  });
  it("使えない名前は断る", async () => {
    const { renameWork } = await import("./release");
    expect(() => renameWork("202611", "20261101_b", "a/b")).toThrow();
    expect(() => renameWork("202611", "20261101_b", "..")).toThrow();
  });
});
