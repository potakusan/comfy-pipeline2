// Tailscale の IPv4 (100.64.0.0/10, CGNAT 帯) を、この PC のネットワークインターフェースから探す。
import os from "node:os";

export function findTailscaleIp() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const [a, b] = info.address.split(".").map(Number);
      if (a === 100 && b >= 64 && b <= 127) return info.address;
    }
  }
  return null;
}
