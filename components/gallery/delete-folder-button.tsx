"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";

interface Result {
  images: number;
  released: number;
  mosaics: number;
}

/**
 * フォルダを、画像・リリース選択・モザイク処理済みごと消す(テスト生成の <日付>-test も)。元に戻せないので、押し直し式の確認を入れる。
 * variant="card": 一覧のカードの角に重ねる小さなボタン / "chip": フォルダの画面の操作列。
 */
export function DeleteFolderButton({ name, variant, summary, onDone }: { name: string; variant: "card" | "chip"; summary: string; onDone: () => void }) {
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
      const r = await api<Result>("/api/gallery/folder", "DELETE", { name });
      toast.success(`削除しました(画像${r.images}枚${r.released ? `、リリース選択${r.released}枚` : ""}${r.mosaics ? `、モザイク済み${r.mosaics}枚` : ""})`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除できませんでした");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const label = armed ? `もう一度で削除(${summary}。元に戻せません)` : "フォルダを削除";
  if (variant === "chip") {
    return (
      <button type="button" className="chip" disabled={busy} onClick={() => void go()} style={armed ? { borderColor: "var(--color-bad)", color: "var(--color-bad)" } : undefined}>
        <Trash2 size={16} aria-hidden style={{ marginRight: 6 }} />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${name}を削除`}
      title={label}
      disabled={busy}
      onClick={() => void go()}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        zIndex: 2,
        minHeight: 40,
        minWidth: 40,
        padding: armed ? "0 var(--space-sm)" : 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: 6,
        border: "var(--rule-hair) solid var(--color-rule-2)",
        background: armed ? "var(--color-bad)" : "var(--color-paper)",
        color: armed ? "var(--color-paper)" : "var(--color-ink-2)",
        font: "inherit",
        fontSize: "var(--text-sm)",
        maxWidth: "calc(100% - 12px)",
        textAlign: "left",
      }}
    >
      <Trash2 size={18} aria-hidden style={{ flex: "none" }} />
      {armed && <span>もう一度で削除({summary})</span>}
    </button>
  );
}
