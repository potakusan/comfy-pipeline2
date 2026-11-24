/** サーバーの起動時に、キューの送り出し(1枚ずつ ComfyUI へ補充)を始める。 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureFeeder } = await import("./lib/server/feeder");
    ensureFeeder();
  }
}
