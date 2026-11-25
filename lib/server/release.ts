import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getOutputDir, getReleaseRoot, safePath, V1_DIR, DATA_DIR } from "./env";
import { createMemJob, finishJob, logJob, tryLock, unlock, type MemJob } from "./jobs-memory";
import { UserError } from "./http";
import sharp from "sharp";
import { toPixels, type Rect } from "@/lib/comfy/crop";

/**
 * リリース用フォルダ: <ルート>/YYYYMM/YYYYMMDD_作品名/グループ名/NN.jpg
 * 出力(PDF・ZIP・Pixiv用セット)は <ルート>/YYYYMM_PDF/ に作る。元の画像には書き込まない。
 * PDF・ZIP・Pixiv の作成は folder-to-pdf スキルと同じ Python スクリプト(scripts/release)を使う。
 */
const IMG = /\.(jpe?g|png|webp)$/i;
const MONTH = /^\d{6}$/;
const SCRIPTS = path.join(process.cwd(), "scripts", "release");

const natural = (a: string, b: string) => a.localeCompare(b, "ja", { numeric: true });

export function outDirOf(month: string): string {
  return path.join(getReleaseRoot(), `${month}_PDF`);
}

function monthDir(month: string): string {
  if (!MONTH.test(month)) throw new UserError("月の指定が不正です");
  return path.join(getReleaseRoot(), month);
}

/** 作品フォルダ名は区切り文字を含まない1階層のみ */
function workDir(month: string, top: string): string {
  if (!top || top !== path.basename(top) || top.startsWith(".")) throw new UserError("作品の指定が不正です");
  const dir = path.join(monthDir(month), top);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError("作品が見つかりません");
  return dir;
}

export function listMonths(): string[] {
  try {
    return fs
      .readdirSync(getReleaseRoot(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && MONTH.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** pixiv で始まる直下のフォルダは手選びサンプル置き場(PDF・ZIP・画像集めから除外。スキルと同じ規則) */
const isSampleFolder = (name: string) => name.toLowerCase().startsWith("pixiv");

function groupsOf(dir: string): { name: string; files: string[] }[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !isSampleFolder(e.name))
    .map((e) => ({ name: e.name, files: fs.readdirSync(path.join(dir, e.name)).filter((f) => IMG.test(f)).sort(natural) }))
    .filter((g) => g.files.length > 0)
    .sort((a, b) => natural(a.name, b.name));
}

export interface OutputFile {
  name: string;
  size: number;
  /** <ルート>/YYYYMM_PDF からの相対パス */
  path: string;
  kind: "pdf" | "zip" | "pixiv";
}

function outputsOf(month: string, top: string): OutputFile[] {
  const out = outDirOf(month);
  if (!fs.existsSync(out)) return [];
  const files: OutputFile[] = [];
  const add = (rel: string, kind: OutputFile["kind"]) => {
    const full = path.join(out, rel);
    files.push({ name: path.basename(rel), size: fs.statSync(full).size, path: rel.split(path.sep).join("/"), kind });
  };
  const title = top.replace(/^\d{8}_(?:\d+_)?/, "").replace(/\(/g, "（").replace(/\)/g, "）");
  const date = top.slice(0, 8);
  for (const f of fs.readdirSync(out).sort(natural)) {
    const full = path.join(out, f);
    if (!fs.statSync(full).isFile()) continue;
    if (f.toLowerCase().endsWith(".pdf") && f.startsWith(`${top}_`)) add(f, "pdf");
    // ZIP は日付ごとにまとまる(YYYYMMDD_タイトル・タイトル.zip)ので、日付が合い、タイトルを含むものを拾う
    else if (f.toLowerCase().endsWith(".zip") && f.startsWith(`${date}_`) && f.includes(title)) add(f, "zip");
  }
  const pixiv = path.join(out, `${top}_pixiv`);
  if (fs.existsSync(pixiv) && fs.statSync(pixiv).isDirectory()) {
    for (const f of fs.readdirSync(pixiv).sort(natural)) if (IMG.test(f)) add(path.join(`${top}_pixiv`, f), "pixiv");
  }
  return files;
}

export interface WorkSummary {
  name: string;
  groups: number;
  images: number;
  firstImage: string | null;
  pdfs: number;
  hasZip: boolean;
  pixivFiles: number;
}

export function listWorks(month: string): WorkSummary[] {
  const dir = monthDir(month);
  if (!fs.existsSync(dir)) return [];
  const works: WorkSummary[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.toUpperCase() === "OLD" || e.name.startsWith(".")) continue;
    const groups = groupsOf(path.join(dir, e.name));
    if (groups.length === 0) continue;
    const outs = outputsOf(month, e.name);
    works.push({
      name: e.name,
      groups: groups.length,
      images: groups.reduce((n, g) => n + g.files.length, 0),
      firstImage: `${month}/${e.name}/${groups[0].name}/${groups[0].files[0]}`,
      pdfs: outs.filter((o) => o.kind === "pdf").length,
      hasZip: outs.some((o) => o.kind === "zip"),
      pixivFiles: outs.filter((o) => o.kind === "pixiv").length,
    });
  }
  return works.sort((a, b) => b.name.localeCompare(a.name));
}

/** src の中身を dst へ移す。同名のフォルダは中身ごとマージし、同名のファイルは連番を付けて両方残す */
function mergeInto(src: string, dst: string): number {
  let renamed = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    let to = path.join(dst, e.name);
    if (e.isDirectory() && fs.existsSync(to) && fs.statSync(to).isDirectory()) {
      renamed += mergeInto(from, to);
      continue;
    }
    if (fs.existsSync(to)) {
      const ext = path.extname(e.name);
      const stem = e.name.slice(0, e.name.length - ext.length);
      let n = 2;
      while (fs.existsSync(path.join(dst, `${stem}_${n}${ext}`))) n++;
      to = path.join(dst, `${stem}_${n}${ext}`);
      renamed++;
    }
    fs.renameSync(from, to);
  }
  fs.rmdirSync(src);
  return renamed;
}

export interface RenameWorkResult {
  name: string;
  merged: boolean;
  /** マージで名前がぶつかり、連番を付けたファイルの数 */
  renamedFiles: number;
}

/**
 * 作品フォルダの名前を変える。同じ名前の作品がすでにあるときは、そこへ中身をマージする。
 * PDF・Pixiv用セットは作品名で結び付いているので、行き先に同名のものがなければ、名前も一緒に変える。
 */
export function renameWork(month: string, top: string, newName: string): RenameWorkResult {
  const src = workDir(month, top);
  const name = newName.trim();
  if (!name || name !== path.basename(name) || name.startsWith(".") || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) throw new UserError("フォルダ名が使えません(記号 < > : \" / \\ | ? * は使えません)");
  if (name === top) throw new UserError("名前が変わっていません");
  const dst = path.join(monthDir(month), name);
  const caseOnly = name.toLowerCase() === top.toLowerCase();
  const merging = !caseOnly && fs.existsSync(dst);
  if (merging && !fs.statSync(dst).isDirectory()) throw new UserError("同じ名前のファイルがあります");

  let renamedFiles = 0;
  if (merging) renamedFiles = mergeInto(src, dst);
  else fs.renameSync(src, dst);

  // 出力(PDF・Pixiv用セット): 行き先に同名がなければ、新しい作品名に付け替える
  const out = outDirOf(month);
  if (fs.existsSync(out)) {
    const pixivFrom = path.join(out, `${top}_pixiv`);
    const pixivTo = path.join(out, `${name}_pixiv`);
    if (fs.existsSync(pixivFrom) && !fs.existsSync(pixivTo)) fs.renameSync(pixivFrom, pixivTo);
    for (const f of fs.readdirSync(out)) {
      if (!f.toLowerCase().endsWith(".pdf") || !f.startsWith(`${top}_`)) continue;
      const to = path.join(out, `${name}_${f.slice(top.length + 1)}`);
      if (!fs.existsSync(to)) fs.renameSync(path.join(out, f), to);
    }
  }
  // サムネイルのキャッシュは作品の場所で引くので、古い名前の分は捨てる
  const cache = safePath(path.join(getOutputDir(), ".thumbcache"), `release/${month}/${top}`);
  if (cache) fs.rmSync(cache, { recursive: true, force: true });
  return { name, merged: merging, renamedFiles };
}

export interface WorkDetail {
  month: string;
  name: string;
  groups: { name: string; files: { name: string; path: string; v: number }[] }[];
  outputs: OutputFile[];
}

export function getWork(month: string, top: string): WorkDetail {
  const dir = workDir(month, top);
  return {
    month,
    name: top,
    groups: groupsOf(dir).map((g) => ({
      name: g.name,
      files: g.files.map((f) => ({
        name: f,
        // <ルート> からの相対パス(配信は /api/release/file?kind=work)
        path: `${month}/${top}/${g.name}/${f}`,
        v: Math.round(fs.statSync(path.join(dir, g.name, f)).mtimeMs),
      })),
    })),
    outputs: outputsOf(month, top),
  };
}

// ---- 配信用のパス解決 ----------------------------------------------------------------

/** kind=work: <ルート>/<相対> / kind=out: <ルート>/YYYYMM_PDF/<相対> */
export function resolveFile(kind: "work" | "out", month: string, rel: string): string | null {
  if (!MONTH.test(month)) return null;
  const base = kind === "out" ? outDirOf(month) : getReleaseRoot();
  const full = safePath(base, rel);
  return full && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

// ---- Python の実行 ---------------------------------------------------------------------

function runPython(job: MemJob, script: string, args: string[], onLine?: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("python", [path.join(SCRIPTS, script), ...args], {
      cwd: SCRIPTS,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", COMFY_PIPELINE_DIR: V1_DIR },
    });
    let done = false;
    const end = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    const feed = (chunk: Buffer, prefix = "") => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        logJob(job, prefix + line);
        if (!prefix) onLine?.(line);
      }
    };
    proc.stdout.on("data", (c: Buffer) => feed(c));
    proc.stderr.on("data", (c: Buffer) => feed(c, "[stderr] "));
    proc.on("close", (code) => end(code === 0));
    proc.on("error", (err) => {
      logJob(job, `[stderr] Python を起動できません: ${err.message}`);
      end(false);
    });
  });
}

export interface BuildRequest {
  month: string;
  top: string;
  pdf: boolean;
  zip: boolean;
  /** true: すでにあるPDFも作り直す */
  force: boolean;
}

/** PDF・ZIP を作る(Pixiv用セットは別。Pixiv用は画像を選んで作る)。 */
export function startBuild(req: BuildRequest): { jobId: string } {
  const month = monthDir(req.month);
  const dir = workDir(req.month, req.top);
  if (!req.pdf && !req.zip) throw new UserError("PDF か ZIP のどちらかを選んでください");
  const key = `release:${req.month}/${req.top}`;
  if (!tryLock(key)) throw new UserError("この作品は作成中です");

  const groups = groupsOf(dir).length;
  const job = createMemJob("release-build", (req.pdf ? groups : 0) + (req.zip ? 1 : 0));
  const out = outDirOf(req.month);
  const args = [month, "--only", req.top, "--out", out, "--no-pixiv"];
  if (!req.pdf) args.push("--no-pdf");
  if (!req.zip) args.push("--no-zip");
  if (req.force) args.push("--force");
  void (async () => {
    try {
      const ok = await runPython(job, "make_pdf.py", args, (line) => {
        if (/^(built|skip|zip)\s/.test(line)) job.current++;
      });
      finishJob(job, ok ? undefined : "作成に失敗しました(ログを確認してください)");
    } catch (e) {
      finishJob(job, e instanceof Error ? e.message : String(e));
    } finally {
      unlock(key);
    }
  })();
  return { jobId: job.id };
}

export interface PixivRequest {
  month: string;
  top: string;
  /** "グループ名/ファイル名" の配列(枚数は自由)。省略・空ならランダムに9枚 */
  picks?: string[];
  /** true: すでにある Pixiv 用セットを消して作り直す */
  force: boolean;
}

/** Pixiv 投稿用の9枚と、Booth 告知(3×3のタイル)画像を <出力>/<作品>_pixiv/ に作る。 */
export function startPixiv(req: PixivRequest): { jobId: string } {
  const dir = workDir(req.month, req.top);
  const out = outDirOf(req.month);
  const dest = path.join(out, `${req.top}_pixiv`);
  // 手で作ったサムネイル(0.jpg)だけがあるときは、セットは「まだ無い」扱い
  const exists = fs.existsSync(dest) && fs.readdirSync(dest).some((f) => f !== THUMB_NAME);
  if (exists && !req.force) throw new UserError("Pixiv用セットがすでにあります。作り直す場合は「作り直す」を押してください");
  const key = `release-pixiv:${req.month}/${req.top}`;
  if (!tryLock(key)) throw new UserError("この作品は作成中です");

  const job = createMemJob("release-pixiv", 1);
  const args = [dir, "--out", out, "--gallery", getOutputDir()];
  for (const p of req.picks ?? []) args.push("--pick", p);
  void (async () => {
    try {
      if (exists) {
        // 自分が作った出力(<作品>_pixiv)だけを消す。出力フォルダの外・別名のものは消さない
        const safe = safePath(out, `${req.top}_pixiv`);
        if (!safe || path.basename(safe) !== `${req.top}_pixiv`) throw new Error("削除対象が不正です");
        // サムネイル(0.jpg)は手で切り抜いたものなので残す
        for (const f of fs.readdirSync(safe)) if (f !== THUMB_NAME) fs.rmSync(path.join(safe, f), { recursive: true, force: true });
        logJob(job, "[pixiv] 既存のセットを消しました");
      }
      fs.mkdirSync(out, { recursive: true });
      const ok = await runPython(job, "pixiv_share.py", args);
      job.current = 1;
      finishJob(job, ok ? undefined : "Pixiv用セットを作れませんでした(ログを確認してください)");
    } catch (e) {
      finishJob(job, e instanceof Error ? e.message : String(e));
    } finally {
      unlock(key);
    }
  })();
  return { jobId: job.id };
}

/** Pixiv用セット(<作品>_pixiv)を ZIP にして返す。ダウンロードのたびに作り直す(中身が差し替わっても古くならない)。 */
export async function zipPixivSet(month: string, top: string): Promise<string> {
  workDir(month, top);
  const src = path.join(outDirOf(month), `${top}_pixiv`);
  if (!fs.existsSync(src)) throw new UserError("Pixiv用セットがまだありません");
  const tmpDir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const dest = path.join(tmpDir, `${top}_pixiv.zip`);
  const job = createMemJob("zip", 1);
  const ok = await runPython(job, "zip_dir.py", [src, dest]);
  if (!ok) throw new Error(`ZIP を作れませんでした: ${job.log.slice(-2).join(" ")}`);
  return dest;
}

// ---- サムネイル(0.jpg) --------------------------------------------------------------------

export const THUMB_NAME = "0.jpg";

/**
 * Pixiv のサムネイルは正方形で作られるので、余白を切って見栄えよくするための切り抜き。
 * 選んだ画像の一部(割合で指定)を、元の解像度のまま <出力>/<作品>_pixiv/0.jpg に保存する(縦横比は自由)。
 */
export async function makeThumb(month: string, top: string, rel: string, crop: Rect): Promise<{ path: string; width: number; height: number }> {
  const dir = workDir(month, top);
  const src = safePath(dir, rel);
  if (!src || !IMG.test(src) || !fs.existsSync(src)) throw new UserError("画像が見つかりません");
  if (![crop.x, crop.y, crop.w, crop.h].every(Number.isFinite) || crop.w <= 0 || crop.h <= 0) throw new UserError("切り抜き範囲が不正です");
  const meta = await sharp(src).metadata();
  if (!meta.width || !meta.height) throw new UserError("画像を読み込めませんでした");
  const box = toPixels(crop, meta.width, meta.height);

  const destDir = safePath(outDirOf(month), `${top}_pixiv`);
  if (!destDir) throw new UserError("作品の指定が不正です");
  fs.mkdirSync(destDir, { recursive: true });
  await sharp(src).extract(box).jpeg({ quality: 95 }).toFile(path.join(destDir, THUMB_NAME));
  return { path: `${top}_pixiv/${THUMB_NAME}`, width: box.width, height: box.height };
}
