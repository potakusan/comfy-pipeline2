import fs from "fs";
import path from "path";
import { getOutputDir, IMAGE_EXT, safePath } from "./env";
import { UserError } from "./http";
import { getPoseGroup } from "@/lib/comfy/group";
import { MOSAIC_NAME } from "@/lib/comfy/mosaic";
import { appendSwapLog, readRecent, writeRecent } from "./store";

/**
 * 同じプリセット(ファイル名の接頭辞が同じ)の画像2枚の、ファイル名を入れ替える。連番を入れ替えて並びを変えるのが目的。
 * 画像の中身に結び付いたものは、名前を入れ替えて「中身についていく」ようにする:
 *   画像と <名前>.json / リリース用コピー(<フォルダ>_release)/ そのモザイク(…/mosaic/<名前>_mosaic*)/
 *   v1 の保管庫(_savedpresets)/ サムネイルキャッシュ(破棄して作り直す)。
 * 拡張子はそれぞれ元のまま、名前の本体(連番を含む部分)だけを入れ替える。途中で失敗したら元に戻す。
 */
const SAVED_PRESETS_DIR = "_savedpresets";
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Pair = [from: string, to: string];

function applyRenames(pairs: Pair[]): void {
  const sources = new Set(pairs.map(([f]) => f));
  for (const [, to] of pairs) {
    // 入れ替えの対象ではない同名のファイルがあれば、上書きせずに止める
    if (!sources.has(to) && fs.existsSync(to)) throw new UserError(`同じ名前のファイルがすでにあります: ${path.basename(to)}`);
  }
  const stamp = `.swap-${process.pid}-${Date.now()}`;
  const tmp = pairs.map(([from]) => from + stamp);
  const moved1: number[] = [];
  const moved2: number[] = [];
  try {
    pairs.forEach(([from], i) => {
      fs.renameSync(from, tmp[i]);
      moved1.push(i);
    });
    pairs.forEach(([, to], i) => {
      fs.renameSync(tmp[i], to);
      moved2.push(i);
    });
  } catch (e) {
    // 元の名前へ戻す(Windows でほかのプログラムが開いているファイルなどで失敗しうる)
    for (const i of [...moved2].reverse()) fs.renameSync(pairs[i][1], tmp[i]);
    for (const i of [...moved1].reverse()) fs.renameSync(tmp[i], pairs[i][0]);
    throw new UserError(`名前を入れ替えられませんでした(ほかのアプリで開いていませんか): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface SwapResult {
  /** a の新しい名前 / b の新しい名前 */
  a: string;
  b: string;
}

/** 入れ替えを実行し、成功・失敗を記録に残す(あとから「何が起きたか」を確かめられるように)。 */
export function swapImages(folder: string, a: string, b: string): SwapResult {
  try {
    const result = swapImagesInner(folder, a, b);
    appendSwapLog({ at: Date.now(), folder, a, b, ok: true, newA: result.a, newB: result.b });
    return result;
  } catch (e) {
    appendSwapLog({ at: Date.now(), folder, a, b, ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

function swapImagesInner(folder: string, a: string, b: string): SwapResult {
  const outputDir = getOutputDir();
  const dir = safePath(outputDir, folder);
  if (!dir || !fs.existsSync(dir)) throw new UserError("フォルダが見つかりません");
  for (const n of [a, b]) {
    if (!n || path.basename(n) !== n || !IMAGE_EXT.test(n) || !fs.existsSync(path.join(dir, n))) throw new UserError(`画像が見つかりません: ${n}`);
  }
  if (a === b) throw new UserError("別々の2枚を選んでください");
  if (getPoseGroup(a) !== getPoseGroup(b)) throw new UserError("入れ替えられるのは、同じプリセットの中の2枚だけです");

  const pa = path.parse(a);
  const pb = path.parse(b);
  if (pa.name === pb.name) throw new UserError("名前の本体が同じなので、入れ替えても変わりません");
  const newA = pb.name + pa.ext;
  const newB = pa.name + pb.ext;

  const pairs: Pair[] = [];
  const add = (from: string, to: string) => {
    if (fs.existsSync(from)) pairs.push([from, to]);
  };

  // 画像とサイドカー、リリース用コピー
  for (const base of [dir, path.join(outputDir, `${folder}_release`)]) {
    for (const [oldName, newName] of [[a, newA], [b, newB]] as const) {
      add(path.join(base, oldName), path.join(base, newName));
      add(path.join(base, `${oldName}.json`), path.join(base, `${newName}.json`));
    }
    // モザイク画像: <名前の本体>_mosaic[連番].<拡張子>。本体の部分だけ入れ替える
    const mosaicDir = path.join(base, "mosaic");
    if (fs.existsSync(mosaicDir)) {
      const files = fs.readdirSync(mosaicDir);
      for (const [oldStem, newStem] of [[pa.name, pb.name], [pb.name, pa.name]]) {
        const re = new RegExp(`^${escapeRegex(oldStem)}(_mosaic\\d*\\.[^.]+)$`);
        for (const f of files) {
          const m = re.exec(f);
          if (m && MOSAIC_NAME.test(path.parse(f).name)) add(path.join(mosaicDir, f), path.join(mosaicDir, newStem + m[1]));
        }
      }
    }
  }
  // v1 の保管庫(リリース選択時に残る、縮小JPGとメタデータ)
  const saved = path.join(outputDir, SAVED_PRESETS_DIR, folder);
  for (const [oldName, newName] of [[a, newA], [b, newB]] as const) {
    add(path.join(saved, `${oldName}.jpg`), path.join(saved, `${newName}.jpg`));
    add(path.join(saved, `${oldName}.jpg.json`), path.join(saved, `${newName}.jpg.json`));
  }

  applyRenames(pairs);

  // ---- 名前に結び付いた記録を直す(失敗しても画像の入れ替え自体は済んでいる) ----------------------
  const rename = new Map<string, string>([[a, newA], [b, newB]]);
  try {
    // 保管庫のエントリの id・元ファイル名
    for (const newName of [newA, newB]) {
      const entry = path.join(saved, `${newName}.jpg.json`);
      if (!fs.existsSync(entry)) continue;
      const json = JSON.parse(fs.readFileSync(entry, "utf8")) as { id?: string; sourceFilename?: string };
      json.id = Buffer.from(`${folder}/${newName}`, "utf-8").toString("base64url");
      json.sourceFilename = newName;
      fs.writeFileSync(entry, JSON.stringify(json, null, 2));
    }
    // 再生成画像の「元画像」の参照(revisionOf)
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const file = path.join(dir, f);
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes('"revisionOf"')) continue;
      const meta = JSON.parse(text) as { revisionOf?: string };
      const next = meta.revisionOf && rename.get(meta.revisionOf);
      if (next) fs.writeFileSync(file, JSON.stringify({ ...meta, revisionOf: next }, null, 2));
    }
    // サムネイルキャッシュは名前に結び付くので、古い名前・新しい名前の両方を捨てて作り直させる
    for (const base of [folder, `${folder}_release`]) {
      for (const n of [a, b, newA, newB]) {
        fs.rmSync(path.join(outputDir, ".thumbcache", base, `${n}.webp`), { force: true });
      }
    }
    // キューの「完成した画像」の一覧
    const recent = readRecent();
    let changed = false;
    for (const r of recent) {
      const [f, ...rest] = r.path.split("/");
      const next = f === folder && rest.length === 1 ? rename.get(rest[0]) : undefined;
      if (next) {
        r.path = `${folder}/${next}`;
        changed = true;
      }
    }
    if (changed) writeRecent(recent);
  } catch (e) {
    console.error("[swap] 記録の更新に失敗しました", e);
  }
  return { a: newA, b: newB };
}
