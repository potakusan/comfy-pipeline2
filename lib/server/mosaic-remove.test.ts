import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// 実データには触れず、一時フォルダを出力フォルダとして使う
const out = fs.mkdtempSync(path.join(os.tmpdir(), "cp2-remove-"));
process.env.OUTPUT_DIR = out;
const { removeFromAlbum, listAlbumImages, resetAlbum, markCopied } = await import("./mosaic");

const ALBUM = "20261203-test";
const REL = `${ALBUM}_release`;
const w = (rel: string, content = "x") => {
  const full = path.join(out, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const exists = (rel: string) => fs.existsSync(path.join(out, rel));

function seed() {
  fs.rmSync(path.join(out, REL), { recursive: true, force: true });
  fs.rmSync(path.join(out, ALBUM), { recursive: true, force: true });
  for (const n of ["a_00001_", "a_00002_"]) {
    w(`${ALBUM}/${n}.jpg`, `ORIGINAL-${n}`); // ギャラリーの元の画像
    w(`${REL}/${n}.jpg`, n);
    w(`${REL}/${n}.jpg.json`, "{}");
  }
  // a_00001_ は再処理で、モザイク画像が複数できている
  w(`${REL}/mosaic/a_00001__mosaic.jpg`);
  w(`${REL}/mosaic/a_00001__mosaic1.jpg`);
  w(`${REL}/mosaic/a_00002__mosaic.jpg`);
}

describe("removeFromAlbum", () => {
  beforeEach(seed);
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("リリース用コピー・メタデータ・その画像のモザイクを、すべて外す", () => {
    const r = removeFromAlbum(ALBUM, "a_00001_.jpg");
    expect(r.removed).toBe(4);
    expect(exists(`${REL}/a_00001_.jpg`)).toBe(false);
    expect(exists(`${REL}/a_00001_.jpg.json`)).toBe(false);
    expect(exists(`${REL}/mosaic/a_00001__mosaic.jpg`)).toBe(false);
    expect(exists(`${REL}/mosaic/a_00001__mosaic1.jpg`)).toBe(false);
  });

  it("ほかの画像と、ギャラリーの元の画像には触れない", () => {
    removeFromAlbum(ALBUM, "a_00001_.jpg");
    expect(exists(`${REL}/a_00002_.jpg`)).toBe(true);
    expect(exists(`${REL}/mosaic/a_00002__mosaic.jpg`)).toBe(true);
    expect(exists(`${ALBUM}/a_00001_.jpg`)).toBe(true);
    expect(listAlbumImages(ALBUM)?.map((i) => i.filename)).toEqual(["a_00002_.jpg"]);
  });

  it("別の画像の名前に前方一致しても、巻き込まない(a_0000 と a_00001_)", () => {
    w(`${REL}/mosaic/a_00001__rev_0001__mosaic.jpg`);
    removeFromAlbum(ALBUM, "a_00001_.jpg");
    expect(exists(`${REL}/mosaic/a_00001__rev_0001__mosaic.jpg`)).toBe(true);
  });

  it("不正な指定・存在しない画像は断る", () => {
    expect(() => removeFromAlbum(ALBUM, "../a_00001_.jpg")).toThrow();
    expect(() => removeFromAlbum(ALBUM, "nothing.jpg")).toThrow("見つかりません");
    expect(() => removeFromAlbum("../x", "a.jpg")).toThrow();
  });
});

describe("resetAlbum", () => {
  beforeEach(seed);

  it("コピー済みでなければ断り、何も消さない", () => {
    expect(() => resetAlbum(ALBUM)).toThrow("コピーして");
    markCopied(ALBUM, ["a_00001__mosaic.jpg"]); // 一部だけ
    expect(() => resetAlbum(ALBUM)).toThrow("コピーしていない");
    expect(exists(`${REL}/a_00001_.jpg`)).toBe(true);
  });

  it("すべてコピー済みなら、リリース選択とモザイクを消す(元の画像は残す)", () => {
    markCopied(ALBUM, ["a_00001__mosaic.jpg", "a_00001__mosaic1.jpg", "a_00002__mosaic.jpg"]);
    resetAlbum(ALBUM);
    expect(exists(REL)).toBe(false);
    expect(exists(`${ALBUM}/a_00001_.jpg`)).toBe(true);
  });
});
