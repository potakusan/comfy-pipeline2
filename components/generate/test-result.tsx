"use client";

import { useEffect, useState } from "react";
import { Ban, Dices, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { JobState } from "@/lib/client/types";
import { Button } from "@/components/ui/button";

export interface TestRun {
  promptId: string;
  label: string;
  presetId: string | null;
}

/** テスト生成の結果。待機・生成中は途中画像と進捗、完成したら画像を大きく見せて、不要なら削除できる。 */
export function TestResult({ run, onClose, onRetry, onReplace }: {
  run: TestRun;
  onClose: () => void;
  onRetry: () => void;
  /** やり直しで別のジョブに置き換わったとき、追いかける先を切り替える */
  onReplace: (promptId: string) => void;
}) {
  const [finished, setFinished] = useState(false);
  const { data } = usePoll<JobState>(finished ? null : `/api/jobs?promptId=${run.promptId}`, 1500);
  const state = data?.state ?? "pending";

  useEffect(() => {
    // 完成・失敗したらポーリングを止める(state の変化に追随するだけの副作用)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state === "done" || state === "failed") setFinished(true);
  }, [state]);

  async function discard() {
    if (!data?.path) return;
    try {
      await api("/api/gallery/delete", "DELETE", { path: data.path });
      toast.success("テスト画像を削除しました");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除できませんでした");
    }
  }

  async function redo(mode: "same" | "reroll") {
    try {
      const r = await api<{ promptId: string }>("/api/queue", "POST", { action: "redo", mode, promptId: run.promptId });
      onReplace(r.promptId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "やり直せませんでした");
    }
  }

  async function cancel() {
    try {
      await api("/api/queue", "POST", { action: "cancel-prompt", promptId: run.promptId });
      toast.success("テスト生成を中止しました");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "中止できませんでした");
    }
  }

  const p = data?.progress;
  return (
    <section className="panel" aria-label="テスト生成の結果" aria-live="polite">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span style={{ minWidth: 0 }}>
          <span className="label" style={{ display: "block" }}>テスト生成</span>
          <span style={{ overflowWrap: "anywhere" }}>{run.label}</span>
        </span>
        <Button variant="ghost" size="icon" aria-label="閉じる" onClick={onClose}>
          <X />
        </Button>
      </div>

      {state === "done" && data?.path && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/gallery/image?path=${encodeURIComponent(data.path)}&w=1200`} alt="テスト生成の結果" style={{ width: "100%", maxHeight: "70dvh", objectFit: "contain", background: "var(--color-paper-3)" }} />
          <div className="row" style={{ gap: "var(--space-sm)" }}>
            <Button variant="outline" className="flex-1" onClick={onRetry}>
              <RefreshCw /> もう1枚
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => void discard()}>
              <Trash2 /> この画像を削除
            </Button>
          </div>
        </>
      )}

      {(state === "pending" || state === "running" || state === "unknown") && (
        <div className="panel-body">
          {state === "running" && data?.previewAt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/queue/preview?t=${data.previewAt}`} alt="生成中の途中画像" style={{ width: "100%", maxHeight: "50dvh", objectFit: "contain", background: "var(--color-paper-3)" }} />
          ) : null}
          <p className="label">{state === "pending" ? "順番待ち(実行中の1枚が終わると始まります)" : "生成中…"}</p>
          {p && p.max > 0 && (
            <>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.max} aria-valuenow={p.value} aria-label="ステップ進捗">
                <i style={{ transform: `scaleX(${p.value / p.max})` }} />
              </div>
              <span className="measured">{p.value} / {p.max} ステップ</span>
            </>
          )}
          <div className="btn-grid">
            <Button variant="outline" onClick={() => void redo("same")}>
              <RotateCcw /> 別シードで
            </Button>
            <Button variant="outline" onClick={() => void redo("reroll")}>
              <Dices /> ランダムも引き直し
            </Button>
            <Button variant="destructive" onClick={() => void cancel()}>
              <Ban /> 中止
            </Button>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="panel-body" role="alert">
          <p style={{ color: "var(--color-bad)" }}>{data?.message ?? "生成に失敗しました"}</p>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw /> もう一度
          </Button>
        </div>
      )}
    </section>
  );
}
