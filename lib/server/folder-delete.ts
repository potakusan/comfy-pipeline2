import fs from "fs";
import path from "path";
import { getOutputDir, IMAGE_EXT, safePath } from "./env";
import { UserError } from "./http";
import { readJobs, readRecent, writeRecent } from "./store";

export interface DeleteFolderResult {
  /** 消した画像の枚数(元の画像) */
  images: number;
  /** 消したリリース選択の枚数と、モザイク処理済みの枚数 */
  released: number;
  mosaics: number;
}

const countImages = (dir: string) => {
  try {
    return fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).length;
  } catch {
    return 0;
  }
};

/**
 * ギャラリーのフォルダを、画像・リリース選択(<フォルダ>_release)・モザイク処理済み・サムネイルのキャッシュごと消す。
 * テスト生成の画像(<日付>-test)もこれで消せる。リリース用フォルダ(X:\ など)へコピー済みのファイルには触れない。
 * 生成中・待機中のジョブの出力先になっているフォルダは、消さない。
 */
export function deleteGalleryFolder(name: string): DeleteFolderResult {
  const outputDir = getOutputDir();
  if (!name || path.basename(name) !== name || name.startsWith(".") || name.endsWith("_release")) throw new UserError("フォルダの指定が不正です");
  const dir = safePath(outputDir, name);
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError("フォルダが見つかりません");
  if (readJobs().some((j) => j.outputPrefix.startsWith(`${name}/`))) throw new UserError("このフォルダに生成中・待機中のジョブがあります。終わってから消してください");

  const rel = `${name}_release`;
  const relDir = safePath(outputDir, rel);
  const result: DeleteFolderResult = {
    images: countImages(dir),
    released: relDir ? countImages(relDir) : 0,
    mosaics: relDir ? countImages(path.join(relDir, "mosaic")) : 0,
  };
  fs.rmSync(dir, { recursive: true, force: true });
  if (relDir) fs.rmSync(relDir, { recursive: true, force: true });
  for (const n of [name, rel]) {
    const cache = safePath(path.join(outputDir, ".thumbcache"), n);
    if (cache) fs.rmSync(cache, { recursive: true, force: true });
  }
  // キューの「最近できた画像」に、消した画像が残らないようにする
  writeRecent(readRecent().filter((r) => !r.path.startsWith(`${name}/`)));
  return result;
}
