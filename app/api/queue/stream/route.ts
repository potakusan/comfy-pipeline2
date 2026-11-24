import { NextRequest } from "next/server";
import { getLive, subscribeLive } from "@/lib/server/ws";

export const dynamic = "force-dynamic";

/**
 * GET  生成中の進捗と途中画像の更新を、変化したその場で流す(Server-Sent Events)。
 * ブラウザから ComfyUI へ直接 WebSocket を張れない(Tailscale 越し・HTTPS)ので、サーバーが ComfyUI の WebSocket を受けて、
 * 画面へは SSE で押し出す。ポーリングと違い、更新の間隔に遅れが出ない。
 */
export async function GET(req: NextRequest) {
  const enc = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = "";
      const push = () => {
        const live = getLive();
        const body = JSON.stringify({ progress: live.progress, previewAt: live.previewAt });
        if (body === last) return;
        last = body;
        try {
          controller.enqueue(enc.encode(`data: ${body}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      push();
      unsubscribe = subscribeLive(push);
      // 途中の機器(プロキシ)に切られないよう、定期的にコメント行を流す
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
