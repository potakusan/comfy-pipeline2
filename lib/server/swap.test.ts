import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// 実データには触れず、一時フォルダを出力フォルダとして使う
const out = fs.mkdtempSync(path.join(os.tmpdir(), "cp2-swap-"));
process.env.OUTPUT_DIR = out;
const { swapImages } = await import("./swap");

const FOLDER = "20261203-test";
const w = (rel: string, content: string) => {
  const full = path.join(out, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const r = (rel: string) => fs.readFileSync(path.join(out, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(out, rel));

/** 中身(内容を表す文字列)ごと、名前についていくことを確かめるための画像一式 */
function seed() {
  fs.rmSync(path.join(out, FOLDER), { recursive: true, force: true });
  fs.rmSync(path.join(out, `${FOLDER}_release`), { recursive: true, force: true });
  fs.rmSync(path.join(out, "_savedpresets"), { recursive: true, force: true });
  // 本体(拡張子が違う2枚)と、1枚目の再生成
  w(`${FOLDER}/g_00001_.jpg`, "IMG-A");
  w(`${FOLDER}/g_00001_.jpg.json`, JSON.stringify({ tag: "A" }));
  w(`${FOLDER}/g_00002_.png`, "IMG-B");
  w(`${FOLDER}/g_00002_.png.json`, JSON.stringify({ tag: "B" }));
  w(`${FOLDER}/g_00001__rev_0001.jpg`, "IMG-A-REV");
  w(`${FOLDER}/g_00001__rev_0001.jpg.json`, JSON.stringify({ tag: "AREV", revisionOf: "g_00001_.jpg" }));
  w(`${FOLDER}/other_00001_.jpg`, "OTHER");
  // リリース用コピーとモザイク(Aだけが選ばれていて、モザイクは両方にある)
  w(`${FOLDER}_release/g_00001_.jpg`, "IMG-A");
  w(`${FOLDER}_release/mosaic/g_00001__mosaic.jpg`, "MOSAIC-A");
  w(`${FOLDER}_release/mosaic/g_00002__mosaic1.jpg`, "MOSAIC-B");
  // v1 の保管庫
  w(`_savedpresets/${FOLDER}/g_00001_.jpg.jpg`, "ARCH-A");
  w(`_savedpresets/${FOLDER}/g_00001_.jpg.jpg.json`, JSON.stringify({ id: "old", sourceFilename: "g_00001_.jpg", seed: 111 }));
}

describe("swapImages", () => {
  beforeEach(seed);
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("名前の本体だけを入れ替え、拡張子はそれぞれのまま。中身はどちらも名前についていく", () => {
    const res = swapImages(FOLDER, "g_00001_.jpg", "g_00002_.png");
    expect(res).toEqual({ a: "g_00002_.jpg", b: "g_00001_.png" });
    expect(r(`${FOLDER}/g_00002_.jpg`)).toBe("IMG-A");
    expect(r(`${FOLDER}/g_00001_.png`)).toBe("IMG-B");
    expect(JSON.parse(r(`${FOLDER}/g_00002_.jpg.json`)).tag).toBe("A");
    expect(JSON.parse(r(`${FOLDER}/g_00001_.png.json`)).tag).toBe("B");
    expect(exists(`${FOLDER}/g_00001_.jpg`)).toBe(false);
  });

  it("リリース用コピー・モザイク・保管庫も、中身についていく", () => {
    swapImages(FOLDER, "g_00001_.jpg", "g_00002_.png");
    // Aのリリース用コピーはAの中身のまま、新しい名前へ
    expect(r(`${FOLDER}_release/g_00002_.jpg`)).toBe("IMG-A");
    expect(exists(`${FOLDER}_release/g_00001_.jpg`)).toBe(false);
    // モザイクは、連番つきの名前のまま本体だけが入れ替わる
    expect(r(`${FOLDER}_release/mosaic/g_00002__mosaic.jpg`)).toBe("MOSAIC-A");
    expect(r(`${FOLDER}_release/mosaic/g_00001__mosaic1.jpg`)).toBe("MOSAIC-B");
    // 保管庫のエントリは id と元のファイル名も新しい名前に直る
    const entry = JSON.parse(r(`_savedpresets/${FOLDER}/g_00002_.jpg.jpg.json`));
    expect(entry.sourceFilename).toBe("g_00002_.jpg");
    expect(entry.seed).toBe(111);
    expect(Buffer.from(entry.id, "base64url").toString()).toBe(`${FOLDER}/g_00002_.jpg`);
    expect(r(`_savedpresets/${FOLDER}/g_00002_.jpg.jpg`)).toBe("ARCH-A");
  });

  it("再生成画像の「元画像」の参照も新しい名前に直る", () => {
    swapImages(FOLDER, "g_00001_.jpg", "g_00002_.png");
    expect(JSON.parse(r(`${FOLDER}/g_00001__rev_0001.jpg.json`)).revisionOf).toBe("g_00002_.jpg");
  });

  it("別のプリセットの画像とは入れ替えられない(何も変わらない)", () => {
    expect(() => swapImages(FOLDER, "g_00001_.jpg", "other_00001_.jpg")).toThrow("同じプリセット");
    expect(r(`${FOLDER}/g_00001_.jpg`)).toBe("IMG-A");
    expect(r(`${FOLDER}/other_00001_.jpg`)).toBe("OTHER");
  });

  it("存在しない画像・同じ画像は断る", () => {
    expect(() => swapImages(FOLDER, "g_00001_.jpg", "g_99999_.jpg")).toThrow("見つかりません");
    expect(() => swapImages(FOLDER, "g_00001_.jpg", "g_00001_.jpg")).toThrow("別々");
    expect(() => swapImages("../x", "a.jpg", "b.jpg")).toThrow();
  });

  it("入れ替えの対象ではない同名のファイルがあれば、上書きせず何も変えない", () => {
    w(`${FOLDER}/g_00002_.jpg`, "STRAY"); // A の新しい名前と衝突する
    expect(() => swapImages(FOLDER, "g_00001_.jpg", "g_00002_.png")).toThrow("同じ名前");
    expect(r(`${FOLDER}/g_00001_.jpg`)).toBe("IMG-A");
    expect(r(`${FOLDER}/g_00002_.jpg`)).toBe("STRAY");
    expect(r(`${FOLDER}/g_00002_.png`)).toBe("IMG-B");
  });
});
