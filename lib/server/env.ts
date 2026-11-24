import fs from "fs";
import path from "path";

/**
 * v1 (comfy-pipeline) の設定・プリセットを読み取り専用で共有する。
 * 秘密情報(APIキー等)を含む .comfy-pipeline.json はこのリポジトリへコピーしない。
 */
export const V1_DIR = path.resolve(
  process.env.COMFY_PIPELINE_DIR ?? path.join(process.cwd(), "..", "comfy-pipeline"),
);

interface V1Config {
  comfyuiUrl?: string;
  outputDir?: string;
  libraryDir?: string;
  releaseRootDir?: string;
}

function readV1Config(): V1Config {
  try {
    return JSON.parse(fs.readFileSync(path.join(V1_DIR, ".comfy-pipeline.json"), "utf8"));
  } catch {
    return {};
  }
}

export function getComfyUrl(): string {
  return process.env.COMFYUI_URL || readV1Config().comfyuiUrl || "http://localhost:8188";
}

export function getOutputDir(): string {
  const dir = process.env.OUTPUT_DIR || readV1Config().outputDir;
  if (!dir) throw new Error("outputDir が未設定です。OUTPUT_DIR を指定するか、v1 の設定を確認してください");
  return dir;
}

export function getLibraryDir(): string {
  return path.resolve(
    process.env.LIBRARY_DIR || readV1Config().libraryDir || path.join(V1_DIR, "data", "library"),
  );
}

/** リリース用フォルダのルート(例 X:\)。<ルート>\YYYYMM\YYYYMMDD_作品名\グループ\NN.jpg の形で置かれる。 */
export function getReleaseRoot(): string {
  return path.resolve(process.env.RELEASE_ROOT_DIR || readV1Config().releaseRootDir || "X:\\");
}

/** モザイク処理(automosaic / resize)は v1 のフォルダ(venv・モデル込み)をそのまま使う。 */
export function getAutomosaicDir(): string {
  return path.resolve(process.env.AUTOMOSAIC_DIR || path.join(V1_DIR, "automosaic"));
}

/** このアプリ自身の書き込み先(モバイル用の設定・未確定ジョブ)。 */
/** 環境変数 DATA_DIR で変えられる(テストで、動いているアプリと状態を分けるため)。 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));

/** baseDir の外へ出るパスを拒否する。 */
export function safePath(baseDir: string, relPath: string): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep; // X:\ のようなドライブ直下は、すでに区切りで終わる
  if (resolved !== base && !resolved.startsWith(prefix)) return null;
  return resolved;
}

export const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif)$/i;
