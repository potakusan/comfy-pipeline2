import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

// 実データには触れず、一時フォルダを出力フォルダとして使う
const out = fs.mkdtempSync(path.join(os.tmpdir(), "cp2-folder-"));
process.env.OUTPUT_DIR = out;
process.env.DATA_DIR = path.join(out, ".data");
const { deleteGalleryFolder } = await import("./folder-delete");

const w = (rel: string) => {
  const full = path.join(out, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "x");
};
const exists = (rel: string) => fs.existsSync(path.join(out, rel));

describe("deleteGalleryFolder", () => {
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("画像・リリース選択・モザイク・サムネキャッシュを消し、ほかのフォルダは残す", () => {
    for (const f of ["a_00001_.jpg", "a_00001_.jpg.json", "a_00002_.jpg"]) w(`20261124-x/${f}`);
    w("20261124-x_release/a_00001_.jpg");
    w("20261124-x_release/mosaic/a_00001__mosaic.jpg");
    w(".thumbcache/20261124-x/a_00001_.jpg.webp");
    w("20261124-y/b_00001_.jpg");
    w("20261124-y_release/b_00001_.jpg");
    const r = deleteGalleryFolder("20261124-x");
    expect(r).toEqual({ images: 2, released: 1, mosaics: 1 });
    expect(["20261124-x", "20261124-x_release", ".thumbcache/20261124-x"].some(exists)).toBe(false);
    expect(exists("20261124-y/b_00001_.jpg") && exists("20261124-y_release/b_00001_.jpg")).toBe(true);
  });

  it("不正な指定・存在しないフォルダ・_release 単体は断る", () => {
    expect(() => deleteGalleryFolder("../x")).toThrow();
    expect(() => deleteGalleryFolder("")).toThrow();
    expect(() => deleteGalleryFolder(".thumbcache")).toThrow();
    expect(() => deleteGalleryFolder("20261124-y_release")).toThrow();
    expect(() => deleteGalleryFolder("nothing")).toThrow("見つかりません");
  });
});
