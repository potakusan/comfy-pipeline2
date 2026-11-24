"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { Button } from "@/components/ui/button";

/**
 * このフォルダのリリース選択とモザイク処理済みをリセットする。リリース用フォルダへコピー済みのときだけ(サーバーが確認する)。
 * 確認は押し直し式(ホーム画面のアプリでは window.confirm が出ないことがあるため)。
 */
export function ResetReleaseButton({ folder, variant, onDone }: { folder: string; variant: "chip" | "button"; onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  async function go() {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      const r = await api<{ removed: number }>("/api/mosaic/reset", "POST", { folder });
      toast.success(`リセットしました(${r.removed}枚を整理)`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const label = armed ? "もう一度押すとリセット" : "リセット";
  if (variant === "chip") {
    return (
      <button type="button" className="chip" disabled={busy} onClick={() => void go()} title="リリース選択とモザイク済みをリセット(コピー済みの場合のみ)">
        <RotateCcw size={16} aria-hidden style={{ marginRight: 6 }} />
        {label}
      </button>
    );
  }
  return (
    <Button variant={armed ? "destructive" : "outline"} size="lg" disabled={busy} onClick={() => void go()}>
      <RotateCcw /> {label}
    </Button>
  );
}
