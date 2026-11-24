import { randomUUID } from "crypto";

/**
 * 外部プロセス(モザイク・PDF作成など)の進捗を、メモリ上に持つ小さなジョブ表。
 * 終わったジョブの結果は、出力ファイル(ディスク)のほうが本体なので、再起動で消えても困らない。
 * 開発時のホットリロードで表が消えないよう globalThis に置く。
 */
export interface MemJob<R = unknown> {
  id: string;
  kind: string;
  status: "running" | "completed" | "failed";
  total: number;
  current: number;
  log: string[];
  results: R[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const g = globalThis as unknown as { __cpMemJobs?: Map<string, MemJob> };
const jobs = (g.__cpMemJobs ??= new Map<string, MemJob>());

export function createMemJob<R>(kind: string, total: number): MemJob<R> {
  // 古いジョブが溜まらないよう、新しく作るたびに終了から1時間たったものを捨てる
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 3_600_000) jobs.delete(id);
  const job: MemJob<R> = { id: randomUUID(), kind, status: "running", total, current: 0, log: [], results: [], startedAt: Date.now() };
  jobs.set(job.id, job as MemJob);
  return job;
}

export function getMemJob<R = unknown>(id: string): MemJob<R> | undefined {
  return jobs.get(id) as MemJob<R> | undefined;
}

export function logJob(job: MemJob, line: string): void {
  job.log.push(line);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}

export function finishJob(job: MemJob, error?: string): void {
  job.status = error ? "failed" : "completed";
  job.error = error;
  job.finishedAt = Date.now();
}

/** 同じ対象への二重実行を防ぐ印(フォルダ単位など) */
const locks = ((globalThis as unknown as { __cpLocks?: Set<string> }).__cpLocks ??= new Set<string>());
export function tryLock(key: string): boolean {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}
export function unlock(key: string): void {
  locks.delete(key);
}
