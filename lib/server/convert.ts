import fs from "fs";
import path from "path";
import sharp from "sharp";
import { V1_DIR } from "./env";

// v1 の lib/server/output-convert.ts と lib/setup/output-format.ts を同じ規則で再現する。
// ComfyUI は PNG で出力するが、v1 は設定(既定 JPG 品質95・4:4:4)へ変換して保存している。
// ギャラリーを v1 と共有するため、モバイル版で生成した画像も同じ形式に揃える。

// 変換は重い(mozjpeg)。CPU を使い切って ComfyUI・画面の応答を邪魔しないよう、スレッド数を絞る
sharp.concurrency(2);

type Format = "png" | "jpg" | "webp";
interface OutputImageSettings {
  format: Format;
  quality: number;
  lossless: boolean;
  chroma444: boolean;
}

function readSettings(): OutputImageSettings {
  let c: Record<string, unknown> = {};
  try {
    c = JSON.parse(fs.readFileSync(path.join(V1_DIR, ".comfy-pipeline.json"), "utf8"));
  } catch {}
  const q = Number(c.outputQuality);
  return {
    format: c.outputFormat === "png" || c.outputFormat === "jpg" || c.outputFormat === "webp" ? c.outputFormat : "jpg",
    quality: Number.isFinite(q) && q >= 1 && q <= 100 ? Math.round(q) : 95,
    lossless: typeof c.outputLossless === "boolean" ? c.outputLossless : false,
    chroma444: typeof c.outputChroma444 === "boolean" ? c.outputChroma444 : true,
  };
}

/**
 * 出力フォルダ直下の PNG を設定の形式へ変換し、変換後のファイル名を返す。
 * 変換しない(png 設定・PNG 以外)場合や失敗した場合は元のファイル名を返し、元ファイルを残す。
 */
export async function convertOutput(dir: string, filename: string): Promise<string> {
  const s = readSettings();
  if (s.format === "png" || !/\.png$/i.test(filename)) return filename;

  const src = path.join(dir, filename);
  const outName = filename.replace(/\.[^.]+$/, "") + (s.format === "jpg" ? ".jpg" : ".webp");
  const dest = path.join(dir, outName);
  const tmp = `${dest}.tmp`;
  try {
    // Windows では sharp がパス入力のハンドルを保持し直後の unlink が EPERM になるため Buffer で渡す
    const img = sharp(fs.readFileSync(src));
    if (s.format === "jpg") {
      await img.jpeg({ quality: s.quality, chromaSubsampling: s.chroma444 ? "4:4:4" : "4:2:0", mozjpeg: true }).toFile(tmp);
    } else {
      await img.webp(s.lossless ? { lossless: true } : { quality: s.quality }).toFile(tmp);
    }
    fs.renameSync(tmp, dest);
    fs.unlinkSync(src);
    return outName;
  } catch (e) {
    console.error("[convert]", filename, e);
    try {
      fs.unlinkSync(tmp);
    } catch {}
    return filename;
  }
}
