"use client";

import { useEffect } from "react";

/**
 * サービスワーカーの登録。HTTPS(または localhost)でしか使えないので、http://100.x.x.x のような
 * Tailscale の IP で開いているときは何もしない(ホーム画面への追加自体は manifest だけで可能)。
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
