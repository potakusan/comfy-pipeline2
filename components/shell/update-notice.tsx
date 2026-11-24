"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const CHECK_MS = 60_000;

/**
 * 開きっぱなしの画面(特にホーム画面に追加したアプリ)は、PC 側でアプリが更新されても古いまま動き続け、
 * 「直したはずなのに直っていない」ように見える。画面を開いたときのビルドの印を覚えておき、変わったら再読み込みを促す。
 * 戻ってきたとき(アプリを前面に出したとき)と、1分ごとに確かめる。
 */
export function UpdateNotice() {
  const first = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { id } = (await res.json()) as { id?: string };
        if (!alive || !id) return;
        if (first.current === null) first.current = id;
        else if (id !== first.current) {
          toast("アプリが更新されました", {
            id: "update-notice",
            description: "古い画面のままだと、直ったはずの不具合が残って見えることがあります。",
            duration: Infinity,
            action: { label: "再読み込み", onClick: () => window.location.reload() },
          });
        }
      } catch {
        // PC に届かないときは何もしない(接続の表示は上部バーが担う)
      }
    };
    void check();
    const timer = setInterval(() => document.visibilityState === "visible" && void check(), CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
