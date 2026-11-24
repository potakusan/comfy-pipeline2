import { getComfyUrl } from "./env";
import { ensureWs, getClientId } from "./ws";

export class ComfyError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

async function comfyFetch(pathname: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${getComfyUrl()}${pathname}`, { cache: "no-store", ...init });
  } catch {
    throw new ComfyError("ComfyUI に接続できません。PC 側で ComfyUI が起動しているか確認してください", 503);
  }
}

export async function comfyJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await comfyFetch(pathname, init);
  if (!res.ok) throw new ComfyError(`ComfyUI が ${res.status} を返しました (${pathname})`, 502);
  return (await res.json()) as T;
}

/**
 * ワークフローを ComfyUI のキューへ送る。client_id は常にこのサーバーの WebSocket のもの
 * (進捗・プレビューを受け取るため)。front: true で待機列の先頭に割り込ませる(テスト生成・再生成・やり直し)。
 */
/**
 * 待機列での優先度(ComfyUI は number が小さいものから実行する。通常は 0 以上)。
 * 同じ優先度だと順序が決まらない(prompt_id で並ぶ)ので、時刻で少しずつ増やし、先に送ったものが先に実行されるようにする。
 *  front: true  再生成・テスト・追加生成: 通常のキューより先
 *  front: "now" やり直し: 再生成より先(いまの1枚のあとにすぐ)
 */
function priority(front: boolean | "now"): number {
  const tick = Math.floor(Date.now() / 100) % 900_000_000;
  return (front === "now" ? -2_000_000_000 : -1_000_000_000) + tick;
}

export async function submitPrompt(workflow: Record<string, unknown>, opts: { front?: boolean | "now" } = {}): Promise<string> {
  ensureWs();
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: getClientId(), ...(opts.front ? { number: priority(opts.front) } : {}) }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    prompt_id?: string;
    error?: { message?: string } | string;
    node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }>;
  };
  if (!res.ok || !data.prompt_id) {
    const msg = typeof data.error === "string" ? data.error : data.error?.message;
    // 「Prompt outputs failed validation」だけでは原因が分からないので、どのノードが何で落ちたかを添える
    const detail = Object.values(data.node_errors ?? {})
      .flatMap((n) => (n.errors ?? []).map((e) => `${n.class_type ?? "?"}: ${e.details || e.message || ""}`))
      .slice(0, 3)
      .join(" / ");
    throw new ComfyError([msg ?? `ComfyUI が ${res.status} を返しました`, detail].filter(Boolean).join(" — "), 502);
  }
  return data.prompt_id;
}

export interface QueueSnapshot {
  running: { promptId: string }[];
  pending: { promptId: string }[];
}

type RawQueueItem = [number, string, ...unknown[]];

export async function getQueue(): Promise<QueueSnapshot> {
  const q = await comfyJson<{ queue_running?: RawQueueItem[]; queue_pending?: RawQueueItem[] }>("/queue");
  return {
    running: (q.queue_running ?? []).map((i) => ({ promptId: i[1] })),
    pending: (q.queue_pending ?? []).map((i) => ({ promptId: i[1] })),
  };
}

export interface HistoryEntry {
  status?: { status_str?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

export async function getHistory(promptId: string): Promise<HistoryEntry | null> {
  const res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, HistoryEntry>;
  return data[promptId] ?? null;
}

/** promptId を渡すと、そのプロンプトが実行中のときだけ中断する(別のジョブを巻き込まないため)。 */
export async function interrupt(promptId?: string): Promise<void> {
  await comfyFetch("/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
  });
}

export async function clearPending(): Promise<void> {
  await comfyFetch("/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
  });
}

export async function deletePending(promptIds: string[]): Promise<void> {
  await comfyFetch("/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete: promptIds }),
  });
}

export async function freeMemory(): Promise<void> {
  await comfyFetch("/free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
}

export interface SystemStats {
  vramTotal: number;
  vramFree: number;
  ramTotal: number;
  ramFree: number;
  gpuName: string;
  comfyVersion: string;
}

export async function getSystemStats(): Promise<SystemStats> {
  const s = await comfyJson<{
    system?: { ram_total?: number; ram_free?: number; comfyui_version?: string };
    devices?: { name?: string; vram_total?: number; vram_free?: number }[];
  }>("/system_stats");
  const d = s.devices?.[0];
  return {
    vramTotal: d?.vram_total ?? 0,
    vramFree: d?.vram_free ?? 0,
    ramTotal: s.system?.ram_total ?? 0,
    ramFree: s.system?.ram_free ?? 0,
    gpuName: d?.name ?? "",
    comfyVersion: s.system?.comfyui_version ?? "",
  };
}

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]> } }>;

export async function listNodeOptions(node: string, field: string): Promise<string[]> {
  const info = await comfyJson<ObjectInfo>(`/object_info/${node}`);
  const spec = info[node]?.input?.required?.[field] as unknown[] | undefined;
  // 旧形式: [["a","b"], {...}] / 新しい ComfyUI: ["COMBO", { options: ["a","b"] }]
  const legacy = spec?.[0];
  if (Array.isArray(legacy)) return legacy as string[];
  const opts = (spec?.[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(opts) ? (opts as string[]) : [];
}
