import { randomUUID } from "crypto";
import { getComfyUrl } from "./env";

/**
 * ComfyUI の WebSocket をサーバー側で1本だけ持ち、進捗とライブプレビュー(途中画像)を保持する。
 * ComfyUI は「プロンプトを投げた client_id」のソケットにだけ進捗・プレビューを送るため、
 * すべての送信でこの clientId を使う。スマホはこのサーバーから、SSE(/api/queue/stream)で変化のたびに受け取る。
 */
interface LiveState {
  clientId: string;
  ws: WebSocket | null;
  progress: { promptId: string; value: number; max: number } | null;
  preview: { data: Buffer; mime: string; at: number } | null;
  reconnect: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __cpLive?: LiveState; __cpLiveListeners?: Set<() => void> };

/** 進捗・途中画像が変わったときに呼ばれる(SSE で画面へ流すため) */
export function subscribeLive(fn: () => void): () => void {
  const set = (g.__cpLiveListeners ??= new Set());
  set.add(fn);
  return () => set.delete(fn);
}

function emit(): void {
  for (const fn of g.__cpLiveListeners ?? []) fn();
}

function state(): LiveState {
  g.__cpLive ??= { clientId: randomUUID(), ws: null, progress: null, preview: null, reconnect: null };
  return g.__cpLive;
}

export function getClientId(): string {
  return state().clientId;
}

function mimeOf(buf: Buffer, offset: number): string | null {
  if (buf[offset] === 0xff && buf[offset + 1] === 0xd8) return "image/jpeg";
  if (buf[offset] === 0x89 && buf[offset + 1] === 0x50) return "image/png";
  return null;
}

function onBinary(s: LiveState, raw: ArrayBuffer) {
  const buf = Buffer.from(raw);
  if (buf.length < 8) return;
  const type = buf.readUInt32BE(0);
  if (type !== 1 && type !== 4) return; // 1 = プレビュー, 4 = メタデータ付きプレビュー
  const mime = mimeOf(buf, 8);
  if (!mime) return;
  s.preview = { data: buf.subarray(8), mime, at: Date.now() };
  emit();
}

function onText(s: LiveState, text: string) {
  let msg: { type?: string; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  const d = msg.data ?? {};
  switch (msg.type) {
    case "execution_start":
      s.preview = null;
      s.progress = { promptId: String(d.prompt_id ?? ""), value: 0, max: 0 };
      break;
    case "progress":
      s.progress = { promptId: String(d.prompt_id ?? s.progress?.promptId ?? ""), value: Number(d.value) || 0, max: Number(d.max) || 0 };
      break;
    case "execution_success":
    case "execution_error":
    case "execution_interrupted":
      s.progress = null;
      break;
  }
  emit();
}

/** 接続されていなければ接続する。切れたら少し待って自動で張り直す。 */
export function ensureWs(): void {
  const s = state();
  if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) return;
  if (s.reconnect) return;
  try {
    const url = `${getComfyUrl().replace(/^http/, "ws")}/ws?clientId=${s.clientId}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") onText(s, ev.data);
      else if (ev.data instanceof ArrayBuffer) onBinary(s, ev.data);
    };
    const retry = () => {
      if (s.ws === ws) s.ws = null;
      s.progress = null;
      emit();
      s.reconnect ??= setTimeout(() => {
        s.reconnect = null;
        ensureWs();
      }, 3000);
    };
    ws.onclose = retry;
    ws.onerror = retry;
    s.ws = ws;
  } catch {
    s.ws = null;
  }
}

export function getLive() {
  ensureWs();
  const s = state();
  return { progress: s.progress, previewAt: s.preview?.at ?? null };
}

export function getPreview() {
  ensureWs();
  return state().preview;
}
