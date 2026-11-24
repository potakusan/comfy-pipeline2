import { getQueue } from "./comfy";
import { feed } from "./queue-ops";
import { reconcileSoon } from "./reconcile";
import { readJobs, readTodo } from "./store";

/**
 * 「これから送る分」を、ComfyUI のキューに1枚ずつ補充する定期処理。サーバーが動いている間は、
 * 端末(スマホ)を閉じていても続く。再起動しても、残りは todo.json から続きを送る。
 */
const g = globalThis as unknown as { __cpFeeder?: ReturnType<typeof setInterval> };

export function ensureFeeder(): void {
  if (g.__cpFeeder) return;
  g.__cpFeeder = setInterval(() => {
    // 終わったジョブの確定(PNG→JPG 変換など)も、端末を開いていなくても少しずつ進める
    if (readJobs().length > 0) {
      void getQueue()
        .then(reconcileSoon)
        .catch(() => undefined);
    }
    if (readTodo().length === 0) return;
    void feed();
  }, 1500);
  // プロセスの終了を妨げない
  g.__cpFeeder.unref?.();
}
