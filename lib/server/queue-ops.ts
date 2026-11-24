import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildWorkflow } from "@/lib/comfy/workflow-builder";
import { renderItem, type ItemTemplate } from "@/lib/comfy/item";
import { buildOutputPrefix } from "@/lib/comfy/prompt";
import type { ImageMetadata, LoraEntry } from "@/lib/comfy/comfy-types";
import { ComfyError, deletePending, getQueue, interrupt, submitPrompt } from "./comfy";
import { UserError } from "./http";
import { getOutputDir, safePath } from "./env";
import {
  readEntries,
  updateEntries,
  updateJobs,
  readHeld,
  readJobs,
  writeHeld,
  type HeldEntry,
  type PendingJob,
} from "./store";
import type { PlannedItem } from "./plan";
import { findMoreSource } from "./more";

const MAX_IMAGES_PER_ENTRY = 500;

// ---- 保留(まだ送らない) ------------------------------------------------------------

export function addToHeld(items: PlannedItem[]): { entries: number; images: number } {
  const held = readHeld();
  const added: HeldEntry[] = items.map((it) => ({
    id: randomUUID(),
    template: it.template,
    count: Math.min(it.count, MAX_IMAGES_PER_ENTRY),
    addedAt: Date.now(),
    ...(it.setId ? { setId: it.setId, setName: it.setName } : {}),
  }));
  writeHeld([...held, ...added]);
  return { entries: added.length, images: added.reduce((s, e) => s + e.count, 0) };
}

export function removeHeld(id: string | "all"): void {
  writeHeld(id === "all" ? [] : readHeld().filter((e) => e.id !== id));
}

// ---- 1枚分を組み立てて ComfyUI へ送る -----------------------------------------------------

interface SubmitArgs {
  template: ItemTemplate;
  entryId: string;
  index: number;
  kind: PendingJob["kind"];
  front?: boolean;
  /** テスト生成は本番のフォルダを汚さないよう専用フォルダへ出す */
  outputPrefix?: string;
}

async function submitImage({ template: t, entryId, index, kind, front, outputPrefix }: SubmitArgs): Promise<PendingJob> {
  const r = renderItem(t);
  const prefix = outputPrefix ?? buildOutputPrefix(t.loraName, t.filePrefix);
  const { workflow, seed, upscaleSeed } = buildWorkflow({
    settings: t.settings,
    loras: r.loras,
    positivePrompt: r.positive,
    negativePrompt: t.negativePrompt,
    outputPrefix: prefix,
  });
  const promptId = await submitPrompt(workflow, { front });
  const meta: ImageMetadata = {
    mode: "normal",
    loraName: t.loraName,
    positivePrompt: r.positive,
    negativePrompt: t.negativePrompt,
    settings: { ...t.settings, randomizeSeed: false, seed, ...(upscaleSeed != null ? { upscaleSeed } : {}) },
    loras: r.loras,
    queueLabel: t.label,
    createdAt: Date.now(),
    appliedAdditional: r.pickedAdditional,
    bindings: Object.keys(r.bindings).length ? r.bindings : undefined,
    randomChoices: r.choices.length ? r.choices : undefined,
  };
  return { promptId, kind, entryId, index, label: t.label, outputPrefix: prefix, meta, submittedAt: Date.now() };
}

// ---- 開始: 保留中のものをまとめて ComfyUI のキューへ ---------------------------------------

export interface StartResult {
  submitted: number;
  remainingHeld: number;
  error?: string;
}

export async function startHeld(): Promise<StartResult> {
  let held = readHeld();
  if (held.length === 0) throw new ComfyError("保留中の生成がありません", 400);
  let submitted = 0;
  let error: string | undefined;

  outer: for (const entry of held) {
    updateEntries((e) => ({ ...e, [entry.id]: { template: entry.template, total: entry.count, ...(entry.setId ? { setId: entry.setId, setName: entry.setName } : {}) } }));
    // 途中で失敗しても、ここまでに送れた分は既にキューにあるので、残りだけを保留に戻す
    let done = 0;
    for (let i = 0; i < entry.count; i++) {
      try {
        const job = await submitImage({ template: entry.template, entryId: entry.id, index: i, kind: "batch" });
        updateJobs((js) => [...js, job]);
        done++;
        submitted++;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        updateEntries((all) => {
          const { [entry.id]: mine, ...rest } = all;
          return done > 0 && mine ? { ...rest, [entry.id]: { ...mine, total: done } } : rest;
        });
        held = held.map((h) => (h.id === entry.id ? { ...h, count: entry.count - done } : h));
        break outer;
      }
    }
    held = held.filter((h) => h.id !== entry.id);
    writeHeld(held);
  }
  if (error) {
    // 送れなかった分(失敗した保留と、それ以降)だけ残す
    writeHeld(held.filter((h) => h.count > 0));
  }
  return { submitted, remainingHeld: readHeld().length, error };
}

// ---- 一時停止: いま実行中のセットが終わったら止める ------------------------------------------------

export interface PausePlan {
  /** いま実行中のセット名(セットの情報がない古いジョブは、アイテム名) */
  currentName: string;
  /** 一時停止すると保留に戻る(まだ ComfyUI に送られている待機中の)枚数 */
  holdImages: number;
  /** 保留に戻すジョブ(アイテムごと) */
  hold: { entryId: string; promptIds: string[] }[];
}

/**
 * いま実行中のジョブと同じセット(セット情報がなければ同じアイテム)の残りは続け、
 * それ以外の待機中のジョブを、保留に戻す対象として数える。実行中のもの・テストと再生成は対象外。
 */
export function planPause(queue: { running: { promptId: string }[]; pending: { promptId: string }[] }): PausePlan | null {
  const jobs = readJobs();
  const entries = readEntries();
  const runningIds = new Set(queue.running.map((q) => q.promptId));
  const current = jobs.find((j) => runningIds.has(j.promptId) && j.kind === "batch") ?? jobs.find((j) => runningIds.has(j.promptId));
  if (!current) return null;
  const cur = entries[current.entryId];
  const keeps = (entryId: string) => entryId === current.entryId || (!!cur?.setId && entries[entryId]?.setId === cur.setId);

  const byEntry = new Map<string, string[]>();
  for (const q of queue.pending) {
    const j = jobs.find((x) => x.promptId === q.promptId);
    if (!j || j.kind !== "batch" || keeps(j.entryId)) continue;
    byEntry.set(j.entryId, [...(byEntry.get(j.entryId) ?? []), j.promptId]);
  }
  const hold = [...byEntry].map(([entryId, promptIds]) => ({ entryId, promptIds }));
  return { currentName: cur?.setName ?? current.label, holdImages: hold.reduce((n, h) => n + h.promptIds.length, 0), hold };
}

/**
 * 実行中のセットはそのまま最後まで続け、残りの待機中を保留に戻す。ComfyUI は何も実行しなくなるので、
 * セットが終わると止まる。再開は保留の「開始」(いつもの手順)。
 */
export async function pauseAfterCurrentSet(): Promise<{ currentName: string; held: number }> {
  const plan = planPause(await getQueue());
  if (!plan) throw new UserError("実行中の生成がありません");
  if (plan.holdImages === 0) throw new UserError("このセットのあとに待っている生成はありません(止めなくても、終わると止まります)");

  const ids = plan.hold.flatMap((h) => h.promptIds);
  await deletePending(ids);
  // 消している間に実行が始まったものは、そのまま続ける(出力を取りこぼさないよう、記録も残す)
  const nowRunning = new Set((await getQueue()).running.map((q) => q.promptId));
  const removed = new Set(ids.filter((id) => !nowRunning.has(id)));

  const entries = readEntries();
  const toHold: HeldEntry[] = [];
  for (const h of plan.hold) {
    const mine = h.promptIds.filter((id) => removed.has(id));
    const rec = entries[h.entryId];
    if (mine.length === 0 || !rec) continue;
    toHold.push({ id: randomUUID(), template: rec.template, count: mine.length, addedAt: Date.now(), ...(rec.setId ? { setId: rec.setId, setName: rec.setName } : {}) });
  }
  // 以降は await を挟まず、ジョブ・雛形・保留をまとめて更新する
  updateJobs((js) => js.filter((j) => !removed.has(j.promptId)));
  updateEntries((all) => {
    const next = { ...all };
    for (const h of plan.hold) {
      const mine = h.promptIds.filter((id) => removed.has(id)).length;
      const rec = next[h.entryId];
      if (!rec || mine === 0) continue;
      const left = rec.total - mine;
      if (left <= 0) delete next[h.entryId];
      else next[h.entryId] = { ...rec, total: left };
    }
    return next;
  });
  writeHeld([...toHold, ...readHeld()]);
  return { currentName: plan.currentName, held: toHold.reduce((n, h) => n + h.count, 0) };
}

// ---- テスト生成(待たずに先頭へ割り込ませて1枚) ---------------------------------------------

export async function submitTest(item: PlannedItem): Promise<{ promptId: string; label: string }> {
  const entryId = randomUUID();
  const job = await submitImage({
    template: item.template,
    entryId,
    index: 0,
    kind: "test",
    front: true,
    outputPrefix: buildOutputPrefix("test", item.template.filePrefix),
  });
  updateEntries((e) => ({ ...e, [entryId]: { template: item.template, total: 1 } }));
  updateJobs((js) => [...js, job]);
  return { promptId: job.promptId, label: job.label };
}

// ---- 実行中の「やり直し」「中止」 ----------------------------------------------------------

export type RedoMode = "reroll" | "same";

/**
 * 実行中(または指定)の1枚を中断して、同じ位置へ作り直す。
 *  - same:   完全に同じプロンプトで、別シード
 *  - reroll: ランダム要素(ランダム行・変数・構図)も引き直す
 * 先に新しいジョブを待機列の先頭へ入れてから、元のジョブだけを中断する。
 */
export async function redo(mode: RedoMode, promptId?: string): Promise<{ promptId: string }> {
  const queue = await getQueue();
  const targetId = promptId ?? queue.running[0]?.promptId;
  const jobs = readJobs();
  const job = targetId ? jobs.find((j) => j.promptId === targetId) : undefined;
  if (!job) throw new ComfyError("やり直せる生成が見つかりません", 404);

  const entry = readEntries()[job.entryId];
  let next: PendingJob;
  if (mode === "reroll" && entry && job.kind !== "regen") {
    next = await submitImage({
      template: entry.template,
      entryId: job.entryId,
      index: job.index,
      kind: job.kind,
      front: true,
      outputPrefix: job.outputPrefix,
    });
  } else {
    const m = job.meta;
    if (!m.settings) throw new ComfyError("この生成の設定が見つかりません", 404);
    const { workflow, seed, upscaleSeed } = buildWorkflow({
      settings: { ...m.settings, randomizeSeed: true },
      loras: m.loras ?? [],
      positivePrompt: m.positivePrompt,
      negativePrompt: m.negativePrompt ?? "",
      outputPrefix: job.outputPrefix,
    });
    const newId = await submitPrompt(workflow, { front: true });
    next = {
      ...job,
      promptId: newId,
      submittedAt: Date.now(),
      meta: { ...m, settings: { ...m.settings, randomizeSeed: false, seed, ...(upscaleSeed != null ? { upscaleSeed } : {}) } },
    };
  }

  updateJobs((js) => [...js.filter((j) => j.promptId !== job.promptId), next]);
  // 実行中なら中断、順番待ちならキューから外す(待機中のものに interrupt は効かない)
  if (queue.running.some((q) => q.promptId === job.promptId)) await interrupt(job.promptId);
  else await deletePending([job.promptId]);
  return { promptId: next.promptId };
}

/** そのアイテムの残り(待機中)を取り消し、実行中の1枚も止める。テスト・再生成は単独のジョブ。 */
export async function cancelEntry(entryId: string): Promise<void> {
  const jobs = readJobs();
  const mine = jobs.filter((j) => j.entryId === entryId);
  const queue = await getQueue();
  const running = new Set(queue.running.map((q) => q.promptId));
  const pendingIds = mine.filter((j) => !running.has(j.promptId)).map((j) => j.promptId);
  if (pendingIds.length) await deletePending(pendingIds);
  for (const j of mine) if (running.has(j.promptId)) await interrupt(j.promptId);
  updateJobs((js) => js.filter((j) => j.entryId !== entryId));
  updateEntries((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== entryId)));
}

// ---- ギャラリーの画像を、プロンプトを編集して再生成 ---------------------------------------------

export interface RegenerateArgs {
  path: string;
  positivePrompt?: string;
  negativePrompt?: string;
  /** false: seed を固定して再現 */
  randomizeSeed?: boolean;
  seed?: number;
}

export async function regenerate(a: RegenerateArgs): Promise<{ promptId: string }> {
  const outputDir = getOutputDir();
  const full = safePath(outputDir, a.path);
  if (!full || !fs.existsSync(full)) throw new ComfyError("画像が見つかりません", 404);
  let meta: ImageMetadata;
  try {
    meta = JSON.parse(fs.readFileSync(`${full}.json`, "utf8")) as ImageMetadata;
  } catch {
    throw new ComfyError("この画像にはプロンプト情報が保存されていないため再生成できません", 400);
  }
  if (!meta.settings) throw new ComfyError("この画像には生成設定が保存されていません", 400);
  if (meta.mode !== "normal") throw new ComfyError("カップルモードの画像の再生成は、まだモバイル版では使えません", 400);

  const [folder] = a.path.split("/");
  const filename = path.basename(a.path);
  const base = filename.slice(0, filename.length - path.extname(filename).length);
  const outputPrefix = `${folder}/__regen_${base}`;
  const positivePrompt = a.positivePrompt ?? meta.positivePrompt;
  const negativePrompt = a.negativePrompt ?? meta.negativePrompt ?? "";
  const pinSeed = a.randomizeSeed === false;
  const seed = pinSeed ? (a.seed ?? meta.settings.seed) : Math.floor(Math.random() * 2 ** 32);

  const loras: LoraEntry[] = meta.loras ?? [];
  const { workflow, upscaleSeed } = buildWorkflow({
    settings: { ...meta.settings, randomizeSeed: false, seed },
    loras,
    positivePrompt,
    negativePrompt,
    outputPrefix,
  });
  const promptId = await submitPrompt(workflow, { front: true });

  const releaseDir = safePath(outputDir, `${folder}_release`);
  const released = !!releaseDir && fs.existsSync(path.join(releaseDir, filename));
  const job: PendingJob = {
    promptId,
    kind: "regen",
    entryId: randomUUID(),
    index: 0,
    label: `再生成: ${filename}`,
    outputPrefix,
    meta: {
      ...meta,
      positivePrompt,
      negativePrompt,
      settings: { ...meta.settings, randomizeSeed: false, seed, ...(upscaleSeed != null ? { upscaleSeed } : {}) },
      createdAt: Date.now(),
    },
    regen: { sourcePath: a.path, releaseAfter: released },
    submittedAt: Date.now(),
  };
  updateJobs((js) => [...js, job]);
  return { promptId };
}

// ---- 「このプリセットをあと n 枚」 --------------------------------------------------------

export interface MoreResult {
  entryId: string;
  submitted: number;
  /** true: 構成(プリセット・ランダム部分)を復元できず、同じプロンプトを別シードで作る */
  samePromptOnly: boolean;
}

/**
 * ギャラリーのプリセット(ファイル名の接頭辞)ごとに、元と同じ構成のまま count 枚を追加で作る。
 * ランダム部分(ランダム行・変数・構図)と seed は1枚ごとに引き直し、保存先は同じフォルダ・同じ接頭辞(連番は続きから)。
 * 待たずに済むよう待機列の先頭へ入れる。やり直し・中止はキューと同じ操作でできる。
 */
export async function startMore(folder: string, group: string, count: number): Promise<MoreResult> {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 200);
  const src = findMoreSource(folder, group);
  if (!src) throw new UserError("この画像には生成設定が残っていないため、追加で生成できません");

  const entryId = randomUUID();
  const outputPrefix = `${folder}/${group}`;
  let submitted = 0;

  if (src.template) {
    updateEntries((e) => ({ ...e, [entryId]: { template: src.template!, total: n } }));
    try {
      for (let i = 0; i < n; i++) {
        const job = await submitImage({ template: src.template, entryId, index: i, kind: "batch", front: true, outputPrefix });
        updateJobs((js) => [...js, job]);
        submitted++;
      }
    } catch (e) {
      if (submitted === 0) updateEntries((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== entryId)));
      else updateEntries((all) => (all[entryId] ? { ...all, [entryId]: { ...all[entryId], total: submitted } } : all));
      if (submitted === 0) throw e;
    }
    return { entryId, submitted, samePromptOnly: false };
  }

  // 雛形が無い画像: 同じプロンプトのまま、1枚ごとに別シード
  const m = src.meta;
  const label = `${group}(追加)`;
  try {
    for (let i = 0; i < n; i++) {
      const { workflow, seed, upscaleSeed } = buildWorkflow({
        settings: { ...m.settings!, randomizeSeed: true },
        loras: m.loras ?? [],
        positivePrompt: m.positivePrompt,
        negativePrompt: m.negativePrompt ?? "",
        outputPrefix,
      });
      const promptId = await submitPrompt(workflow, { front: true });
      updateJobs((js) => [
        ...js,
        {
          promptId,
          kind: "batch",
          entryId,
          index: i,
          label,
          outputPrefix,
          meta: { ...m, settings: { ...m.settings!, randomizeSeed: false, seed, ...(upscaleSeed != null ? { upscaleSeed } : {}) }, createdAt: Date.now() },
          submittedAt: Date.now(),
        },
      ]);
      submitted++;
    }
  } catch (e) {
    if (submitted === 0) throw e;
  }
  return { entryId, submitted, samePromptOnly: true };
}
