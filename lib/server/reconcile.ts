import fs from "fs";
import path from "path";
import { DATA_DIR, getOutputDir, safePath } from "./env";
import { getHistory, type QueueSnapshot } from "./comfy";
import { convertOutput } from "./convert";
import {
  readEntries,
  readTodo,
  readFailed,
  readJobs,
  readRecent,
  updateEntries,
  updateJobs,
writeFailed,
  writeRecent,
  type FailedJob,
  type PendingJob,
  type RecentImage,
} from "./store";

const STALE_MS = 3 * 60 * 60 * 1000;

// ルートごとにモジュールが別インスタンスになっても1本だけ走るよう、プロセス全体(globalThis)で共有する
const lock = globalThis as unknown as { __cpReconcile?: Promise<void> | null };

/** AppBar とキュー画面が同時に取得しても、確定処理(ファイル書き込み)は1本だけ走らせる。 */
export function reconcileJobs(queue: QueueSnapshot): Promise<void> {
  lock.__cpReconcile ??= withFileLock(() => reconcileOnce(queue)).finally(() => {
    lock.__cpReconcile = null;
  });
  return lock.__cpReconcile;
}

const FILE_LOCK = path.join(DATA_DIR, "reconcile.lock");
const FILE_LOCK_STALE_MS = 60_000;

/**
 * プロセスをまたぐ排他。アプリの更新で古いサーバーと新しいサーバーが一時的に並ぶときなど、2つのサーバーが
 * 同じジョブを同時に確定すると、片方が先にファイルを動かして、もう片方が失敗する(存在しない名前を「完成した画像」に載せる)。
 * ロックを取れなかったら、いま別のサーバーが確定している最中なので、今回は何もしない(次の確認で拾う)。
 */
async function withFileLock(run: () => Promise<void>): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let fd: number | null = null;
  for (let attempt = 0; attempt < 2 && fd === null; attempt++) {
    try {
      fd = fs.openSync(FILE_LOCK, "wx");
    } catch {
      try {
        // 落ちたサーバーが残したロックは、一定時間たったら無効とみなして取り直す
        if (Date.now() - fs.statSync(FILE_LOCK).mtimeMs > FILE_LOCK_STALE_MS) fs.rmSync(FILE_LOCK, { force: true });
        else return;
      } catch {
        return;
      }
    }
  }
  if (fd === null) return;
  try {
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    await run();
  } finally {
    fs.rmSync(FILE_LOCK, { force: true });
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 再生成した画像(一時名)を "<元>_rev_NNNN.<ext>" へ改名し、元画像がリリース選択済みなら同じく選択する。
 * v1 の /api/gallery/finalize-revision と同じ採番規則。
 */
function finalizeRevision(job: PendingJob, folderDir: string, tempName: string): string {
  const source = path.basename(job.regen!.sourcePath);
  const ext = path.extname(tempName);
  const stem = source.slice(0, source.length - path.extname(source).length);
  // 再生成画像をさらに再生成したときに _rev_0001_rev_0001 と入れ子にならないよう、末尾の連番は剥がす
  const base = stem.replace(/(?:_rev_\d+)+$/, "");
  let max = 0;
  const re = new RegExp(`^${escapeRegex(base)}_rev_(\\d+)${escapeRegex(ext)}$`);
  for (const f of fs.readdirSync(folderDir)) {
    const m = re.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const finalName = `${base}_rev_${String(max + 1).padStart(4, "0")}${ext}`;
  const finalPath = path.join(folderDir, finalName);
  fs.renameSync(path.join(folderDir, tempName), finalPath);
  fs.writeFileSync(`${finalPath}.json`, JSON.stringify({ ...job.meta, revisionOf: source }, null, 2), "utf8");

  if (job.regen!.releaseAfter) {
    const releaseDir = path.join(path.dirname(folderDir), `${path.basename(folderDir)}_release`);
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.copyFileSync(finalPath, path.join(releaseDir, finalName));
    fs.copyFileSync(`${finalPath}.json`, path.join(releaseDir, `${finalName}.json`));
  }
  return finalName;
}

/**
 * 送信済みジョブのうち ComfyUI 側で終わったものを確定する:
 * 保存形式へ変換し、画像の隣へメタデータ(<file>.json)を書き、完成一覧へ移す。
 * 端末(スマホ)が閉じていても生成は進むので、次に開いたときにまとめて確定する。
 */
async function reconcileOnce(queue: QueueSnapshot): Promise<void> {
  const jobs = readJobs();
  if (jobs.length === 0) return;

  const entries = readEntries();
  const active = new Set([...queue.running, ...queue.pending].map((q) => q.promptId));
  const outputDir = getOutputDir();
  // 確定・失敗・期限切れで一覧から外すジョブ。外す処理は最後に同期で行う(待っている間に追加されたジョブを消さないため)
  const drop = new Set<string>();
  const recent: RecentImage[] = [];
  const failed: FailedJob[] = [];

  for (const job of jobs) {
    if (active.has(job.promptId)) continue;
    const entry = await getHistory(job.promptId);
    if (!entry) {
      // 履歴にも無く、キューにも無い: 送った直後の取りこぼしを考え、一定時間は残す(ComfyUI 再起動などで消えたら諦める)
      if (Date.now() - job.submittedAt >= STALE_MS) drop.add(job.promptId);
      continue;
    }
    drop.add(job.promptId);
    if (entry.status?.status_str === "error") {
      failed.push({ promptId: job.promptId, label: job.label, message: "生成に失敗しました(ComfyUI のログを確認)", at: Date.now() });
      continue;
    }
    const images = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
    let any = false;
    for (const img of images) {
      if (img.type !== "output") continue;
      const dir = safePath(outputDir, img.subfolder);
      if (!dir) continue;
      let filename = await convertOutput(dir, img.filename);
      try {
        if (job.kind === "regen" && job.regen) filename = finalizeRevision(job, dir, filename);
        else {
          // 雛形も一緒に残すと、あとから「同じ構成でランダム部分だけ引き直して追加生成」できる
          const template = entries[job.entryId]?.template;
          fs.writeFileSync(path.join(dir, `${filename}.json`), JSON.stringify(template ? { ...job.meta, template } : job.meta), "utf8");
        }
      } catch (e) {
        console.error("[reconcile]", job.label, e);
      }
      recent.push({
        path: path.posix.join(img.subfolder, filename),
        promptId: job.promptId,
        entryId: job.entryId,
        label: job.label,
        at: Date.now(),
        kind: job.kind,
      });
      any = true;
    }
    if (!any) failed.push({ promptId: job.promptId, label: job.label, message: "画像が出力されませんでした", at: Date.now() });
  }

  updateJobs((js) => js.filter((j) => !drop.has(j.promptId)));
  if (recent.length) writeRecent([...recent.reverse(), ...readRecent()]);
  if (failed.length) writeFailed([...failed, ...readFailed()]);

  // 参照するジョブが無くなったアイテム雛形は捨てる
  const live = new Set([...readJobs().map((j) => j.entryId), ...readTodo().map((t) => t.id)]);
  updateEntries((all) => Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id))));
}
