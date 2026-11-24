import type { NextConfig } from "next";
import { findTailscaleIp } from "./scripts/tailscale.mjs";

const tailscaleIp: string | null = findTailscaleIp();

const nextConfig: NextConfig = {
  // 開発時、Tailscale 経由(IP または MagicDNS 名)のスマホから HMR・開発用アセットを許可する
  allowedDevOrigins: [...(tailscaleIp ? [tailscaleIp] : []), "*.ts.net"],
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;
