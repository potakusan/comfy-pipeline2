// Tailscale のアドレスだけで待ち受けて Next を起動する。
//   node scripts/serve.mjs dev    開発 (HMR)
//   node scripts/serve.mjs start  本番 (先に pnpm build)
// このアプリには認証が無い(削除・生成が誰でも叩ける)ため、LAN 全体 (0.0.0.0) には公開しない。
// Tailscale が見つからなければ 127.0.0.1 にだけ縛る。HOST で上書きできる(自己責任)。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { findTailscaleIp } from "./tailscale.mjs";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3100";
const tsIp = findTailscaleIp();
const host = process.env.HOST ?? tsIp ?? "127.0.0.1";

if (!process.env.HOST && !tsIp) {
  console.warn("[comfy-pipeline2] Tailscale のアドレスが見つかりません。127.0.0.1 のみで待ち受けます。");
  console.warn("                  Tailscale を起動してから再実行すると、スマホから開けます。");
}
console.log(`[comfy-pipeline2] http://${host}:${port}  (${mode})`);

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, mode, "-H", host, "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
