import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getAutomosaicDir, getOutputDir, IMAGE_EXT, safePath } from "./env";
import { createMemJob, finishJob, logJob, tryLock, unlock, type MemJob } from "./jobs-memory";
import { UserError } from "./http";
import { MOSAIC_NAME, type MosaicResult, type MosaicRunRequest } from "@/lib/comfy/mosaic";

export const releaseDirOf = (folder: string) => `${folder}_release`;

function pythonPath(automosaicDir: string): string {
  const venv = path.join(automosaicDir, "venv", "Scripts", "python.exe");
  return fs.existsSync(venv) ? venv : "python";
}

/** モデル名は automosaic/models 直下のファイル名に限る(パス区切り・上位参照を拒否) */
const isValidModel = (name: string) => path.basename(name) === name && name.toLowerCase().endsWith(".pt");

function runProcess(job: MemJob, cmd: string, args: string[], cwd: string, onLine: ((line: string) => void) | null): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: false, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let done = false;
    const end = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    proc.stdout.on("data", (chunk: Buffer) => {
      // Windows の改行は CRLF。末尾に CR が残ると、行末($)で判定する正規表現が一致しない
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        logJob(job, line);
        onLine?.(line);
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) logJob(job, `[stderr] ${line}`);
    });
    proc.on("close", (code) => end(code === 0));
    proc.on("error", (err) => {
      logJob(job, `[stderr] プロセス起動に失敗しました: ${err.message}`);
      end(false);
    });
  });
}

/**
 * automosaic.py の出力ログを読み、1枚ごとの結果(検出数と実際に保存されたパス)を集める。
 * 保存名は推測せずログから取る(同名があると automosaic.py が連番を付けるため)。
 */
function mosaicProgress(job: MemJob<MosaicResult>, outputDir: string) {
  let current: { filename: string; regionCount: number } | null = null;
  return (line: string) => {
    if (line.includes("を処理します")) {
      job.current++;
      const m = line.match(/ファイル (.+) を処理します/);
      if (m) current = { filename: path.basename(m[1].trim()), regionCount: 0 };
      return;
    }
    const count = line.match(/\[検出結果\] (\d+)件/);
    if (count && current) {
      current.regionCount = parseInt(count[1], 10);
      return;
    }
    const saved = line.match(/画像を保存しました: (.+)$/);
    if (saved && current) {
      const rel = path.relative(outputDir, saved[1].trim()).split(path.sep).join("/");
      job.results.push({ filename: current.filename, regionCount: current.regionCount, outputPath: rel });
      current = null;
    }
  };
}

function countImages(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && IMAGE_EXT.test(e.name)).length;
  } catch {
    return 0;
  }
}

export function startMosaicRun(req: MosaicRunRequest): { jobId: string } | { error: string; status: number } {
  if (!req.folder) return { error: "アルバムが指定されていません", status: 400 };
  if (!req.mosaicEnabled && !req.resizeEnabled) return { error: "モザイクか縮小のどちらかを選んでください", status: 400 };
  const bad = req.mosaic.models.find((m) => !isValidModel(m));
  if (req.mosaicEnabled && bad) return { error: `モデル名が不正です: ${bad}`, status: 400 };

  const outputDir = getOutputDir();
  const inputPath = safePath(outputDir, releaseDirOf(req.folder));
  if (!inputPath || !fs.existsSync(inputPath)) return { error: "リリース用フォルダが見つかりません", status: 404 };

  const files = req.files;
  if (files && (files.length === 0 || files.some((f) => path.basename(f) !== f || !IMAGE_EXT.test(f) || !fs.existsSync(path.join(inputPath, f))))) {
    return { error: "対象の画像が不正です", status: 400 };
  }
  if (!tryLock(inputPath)) return { error: "このアルバムは処理中です", status: 409 };

  const automosaicDir = getAutomosaicDir();
  if (!fs.existsSync(path.join(automosaicDir, "automosaic.py"))) {
    unlock(inputPath);
    return { error: `automosaic が見つかりません(${automosaicDir})`, status: 500 };
  }
  const python = pythonPath(automosaicDir);
  const total = files ? files.length : countImages(inputPath);
  const job = createMemJob<MosaicResult>("mosaic", total);
  const tmpId = crypto.randomUUID();
  const resizeTmp = path.join(inputPath, `_resize_tmp_${tmpId}`);
  const staged = files ? path.join(inputPath, `_single_tmp_${tmpId}`) : null;
  const source = staged ?? inputPath;
  const mosaicOut = path.join(inputPath, "mosaic");

  void (async () => {
    try {
      if (staged) {
        fs.mkdirSync(staged, { recursive: true });
        for (const f of files!) fs.copyFileSync(path.join(inputPath, f), path.join(staged, f));
      }

      // 1) 縮小(先に小さくしてから検出するので、モザイクのI/Oが減る)
      if (req.resizeEnabled) {
        const out = req.mosaicEnabled ? resizeTmp : path.join(inputPath, "resized");
        logJob(job, `[resize] 開始: ${req.resize.scalePercent}% 品質${req.resize.quality}`);
        const ok = await runProcess(
          job,
          python,
          [path.join(automosaicDir, "resize.py"), source, "-o", out, "-s", String(req.resize.scalePercent), "-q", String(req.resize.quality)],
          automosaicDir,
          req.mosaicEnabled
            ? null
            : (line) => {
                if (line.includes("リサイズ完了:")) job.current++;
              },
        );
        if (!ok) return finishJob(job, "縮小に失敗しました");
        logJob(job, "[resize] 完了");
      }

      // 2) モザイク
      if (req.mosaicEnabled) {
        const m = req.mosaic;
        const args = [
          "automosaic.py",
          req.resizeEnabled ? resizeTmp : source,
          "-o",
          mosaicOut,
          "-m",
          (m.models.length ? m.models : ["pussyV2.pt", "penis.pt"]).join(","),
          "-s",
          String(m.mosaicSize),
          "-c",
          String(m.confidence),
        ];
        if (m.autoSize) args.push("--auto-size");
        if (m.retinaMasks) args.push("--retina_masks");
        if (!m.useMasks) args.push("-bo");
        if (m.noMeta) args.push("-n");
        if (m.device) args.push("-d", m.device);
        if (m.bboxExpand > 0) args.push("-e", String(m.bboxExpand / 100));
        if (m.targetClasses.length > 0) args.push("--classes", m.targetClasses.join(","));
        logJob(job, `[mosaic] 開始: ${req.folder}`);
        const ok = await runProcess(job, python, args, automosaicDir, mosaicProgress(job, outputDir));
        if (!ok) return finishJob(job, "モザイク処理に失敗しました");
        logJob(job, "[mosaic] 完了");
      }
      finishJob(job);
    } catch (e) {
      finishJob(job, e instanceof Error ? e.message : String(e));
    } finally {
      for (const d of [resizeTmp, staged]) if (d) fs.rmSync(d, { recursive: true, force: true });
      unlock(inputPath);
    }
  })();

  return { jobId: job.id };
}

// ---- 一覧 --------------------------------------------------------------------------

export interface AlbumEntry {
  name: string;
  /** リリース用フォルダ内の元画像の数 */
  sourceCount: number;
  /** mosaic/ にある処理済みの数 */
  mosaicCount: number;
  firstImage: string | null;
}

export function listAlbums(): AlbumEntry[] {
  const outputDir = getOutputDir();
  const out: AlbumEntry[] = [];
  for (const e of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.endsWith("_release") || e.name.startsWith(".")) continue;
    const dir = path.join(outputDir, e.name);
    const sources = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).sort();
    const mosaic = (() => {
      try {
        return fs.readdirSync(path.join(dir, "mosaic")).filter((f) => IMAGE_EXT.test(f)).sort();
      } catch {
        return [];
      }
    })();
    if (sources.length === 0 && mosaic.length === 0) continue;
    // 再処理すると _mosaic1, _mosaic2… と別ファイルが増えるので、元画像ごとに1枚と数える
    const processed = new Set(mosaic.map((f) => MOSAIC_NAME.exec(path.parse(f).name)?.[1] ?? path.parse(f).name)).size;
    const name = e.name.slice(0, -"_release".length);
    out.push({
      name,
      sourceCount: sources.length,
      mosaicCount: processed,
      firstImage: mosaic[0] ? `${e.name}/mosaic/${mosaic[0]}` : sources[0] ? `${e.name}/${sources[0]}` : null,
    });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export interface AlbumImage {
  /** 元画像(リリース用フォルダ直下)。無ければ null */
  filename: string;
  source: { path: string; v: number } | null;
  mosaic: { path: string; v: number } | null;
}

export function listAlbumImages(folder: string): AlbumImage[] | null {
  const outputDir = getOutputDir();
  const rel = releaseDirOf(folder);
  const dir = safePath(outputDir, rel);
  if (!dir || !fs.existsSync(dir)) return null;
  const mtime = (p: string) => Math.round(fs.statSync(p).mtimeMs);
  const sources = new Map<string, string>();
  for (const f of fs.readdirSync(dir)) if (IMAGE_EXT.test(f) && fs.statSync(path.join(dir, f)).isFile()) sources.set(path.parse(f).name, f);
  const mosaics = new Map<string, string>();
  try {
    for (const f of fs.readdirSync(path.join(dir, "mosaic"))) {
      if (!IMAGE_EXT.test(f)) continue;
      const stem = MOSAIC_NAME.exec(path.parse(f).name)?.[1] ?? path.parse(f).name;
      // 同じ元画像から複数できた場合(連番つき)は、名前順で最後のものを採用する
      mosaics.set(stem, f);
    }
  } catch {}
  const stems = [...new Set([...sources.keys(), ...mosaics.keys()])].sort();
  return stems.map((stem) => {
    const s = sources.get(stem);
    const m = mosaics.get(stem);
    return {
      filename: s ?? m!,
      source: s ? { path: `${rel}/${s}`, v: mtime(path.join(dir, s)) } : null,
      mosaic: m ? { path: `${rel}/mosaic/${m}`, v: mtime(path.join(dir, "mosaic", m)) } : null,
    };
  });
}

// ---- 差し戻し(モザイクなしに戻す) ----------------------------------------------------

/** モザイク画像を、モザイク前の元画像(縮小・JPEG化したもの)で置き換える。新しいパスを返す。 */
export async function restoreOriginal(relPath: string, scalePercent = 40, quality = 100): Promise<string> {
  const outputDir = getOutputDir();
  const mosaicFile = safePath(outputDir, relPath);
  if (!mosaicFile || !fs.existsSync(mosaicFile)) throw new UserError("画像が見つかりません");
  const mosaicDir = path.dirname(mosaicFile);
  if (path.basename(mosaicDir) !== "mosaic") throw new UserError("mosaic/ の中の画像だけ差し戻せます");
  const stem = MOSAIC_NAME.exec(path.parse(mosaicFile).name)?.[1];
  if (!stem) throw new UserError("モザイク画像の名前が想定と違います");

  const parent = path.dirname(mosaicDir);
  const originalName = fs.readdirSync(parent).find((f) => IMAGE_EXT.test(f) && path.parse(f).name === stem);
  if (!originalName) throw new UserError(`元画像が見つかりません: ${stem}`);

  const scale = Math.min(100, Math.max(1, Math.round(scalePercent)));
  const original = sharp(path.join(parent, originalName)).rotate();
  const { width } = await original.metadata();
  const buffer = await original
    .flatten({ background: "#ffffff" })
    .resize({ width: width ? Math.max(1, Math.round((width * scale) / 100)) : undefined })
    .jpeg({ quality: Math.min(100, Math.max(1, Math.round(quality))) })
    .toBuffer();

  const target = path.join(mosaicDir, `${stem}_mosaic.jpg`);
  const tmp = `${target}.tmp-${Date.now()}`; // Windows のハンドル競合を避けるため、一時ファイル経由で置き換える
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, target);
  if (target !== mosaicFile) fs.rmSync(mosaicFile, { force: true });
  return path.relative(outputDir, target).split(path.sep).join("/");
}

/** 手動編集した画像で、mosaic/ の既存ファイルを上書きする(mosaic/ の外は不可)。 */
export function overwriteMosaicFile(relPath: string, bytes: Buffer): void {
  const outputDir = getOutputDir();
  const full = safePath(outputDir, relPath);
  if (!full || !fs.existsSync(full)) throw new UserError("画像が見つかりません");
  if (path.basename(path.dirname(full)) !== "mosaic") throw new UserError("mosaic/ の中の画像だけ保存できます");
  const tmp = `${full}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, full);
}

// ---- アルバムから外す ----------------------------------------------------------------

/**
 * エラーのある画像を、モザイクのアルバム(<フォルダ>_release)から外す。
 * リリース用コピー(と .json)と、その画像のモザイク画像をすべて消し、リリース選択も解除される。
 * ギャラリーの元の画像(<フォルダ>/ の中)は消さない。
 */
export function removeFromAlbum(folder: string, filename: string): { removed: number } {
  const outputDir = getOutputDir();
  const dir = safePath(outputDir, releaseDirOf(folder));
  if (!dir || !fs.existsSync(dir)) throw new UserError("アルバムが見つかりません");
  if (!filename || path.basename(filename) !== filename || !IMAGE_EXT.test(filename)) throw new UserError("画像の指定が不正です");

  const stem = path.parse(filename).name;
  const targets: string[] = [path.join(dir, filename), path.join(dir, `${filename}.json`)];
  const mosaicDir = path.join(dir, "mosaic");
  if (fs.existsSync(mosaicDir)) {
    for (const f of fs.readdirSync(mosaicDir)) {
      if (IMAGE_EXT.test(f) && MOSAIC_NAME.exec(path.parse(f).name)?.[1] === stem) targets.push(path.join(mosaicDir, f));
    }
  }
  let removed = 0;
  for (const t of targets) {
    if (fs.existsSync(t)) {
      fs.rmSync(t, { force: true });
      removed++;
    }
  }
  // サムネイルのキャッシュも捨てる
  for (const rel of [`${releaseDirOf(folder)}/${filename}`]) fs.rmSync(path.join(outputDir, ".thumbcache", `${rel}.webp`), { force: true });
  if (removed === 0) throw new UserError("外す画像が見つかりません");
  return { removed };
}

// ---- リリースフォルダへコピー済みの記録 / リセット ----------------------------------------

const COPIED_MARK = ".copied.json";

/** リリース用フォルダへコピーしたモザイク画像を、アルバム側に記録する(リセットしてよいかの判断に使う)。 */
export function markCopied(folder: string, mosaicFilenames: string[]): void {
  const dir = safePath(getOutputDir(), releaseDirOf(folder));
  if (!dir || !fs.existsSync(dir)) return;
  const file = path.join(dir, COPIED_MARK);
  let prev: string[] = [];
  try {
    prev = (JSON.parse(fs.readFileSync(file, "utf8")) as { files?: string[] }).files ?? [];
  } catch {}
  fs.writeFileSync(file, JSON.stringify({ files: [...new Set([...prev, ...mosaicFilenames])], at: new Date().toISOString() }));
}

/**
 * アルバムのリリース選択とモザイク処理済み画像を、まとめてリセットする(<フォルダ>_release を消す)。
 * ギャラリーの元の画像は消さない。リリース用フォルダへまだコピーしていないモザイク画像があるときは、断る。
 */
export function resetAlbum(folder: string): { removed: number } {
  const outputDir = getOutputDir();
  const dir = safePath(outputDir, releaseDirOf(folder));
  if (!dir || !fs.existsSync(dir)) throw new UserError("アルバムが見つかりません");

  const mosaicDir = path.join(dir, "mosaic");
  const mosaics = fs.existsSync(mosaicDir) ? fs.readdirSync(mosaicDir).filter((f) => IMAGE_EXT.test(f)) : [];
  let copied: string[] = [];
  try {
    copied = (JSON.parse(fs.readFileSync(path.join(dir, COPIED_MARK), "utf8")) as { files?: string[] }).files ?? [];
  } catch {}
  const notCopied = mosaics.filter((f) => !copied.includes(f));
  if (notCopied.length > 0) {
    throw new UserError(
      copied.length === 0
        ? "まだリリース用フォルダにコピーしていません。コピーしてからリセットしてください"
        : `リリース用フォルダにコピーしていないモザイク画像が${notCopied.length}枚あります。コピーしてからリセットしてください`,
    );
  }

  const removed = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).length + mosaics.length;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(outputDir, ".thumbcache", releaseDirOf(folder)), { recursive: true, force: true });
  return { removed };
}
