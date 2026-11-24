"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import type { MemJobState } from "@/lib/client/types";
import type { MosaicResult } from "@/lib/comfy/mosaic";
import { Button } from "@/components/ui/button";
import { useRegenJob, type RegenJob } from "@/components/gallery/regen-panel";
import { loadSaved } from "./run-sheet";

type Phase = "idle" | "regen" | "mosaic" | "swap" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseName = (p: string) => p.split("/").pop() ?? p;

/**
 * エラーのある画像を「同じプロンプトで作り直して、同じ条件で縮小・モザイクをかけ、差し替える」。
 *  1) ギャラリーの元の画像から、同じプロンプトで別シードの画像をつくる(つくっている間は、別シードでやり直し・中止ができる)
 *  2) できた画像に、このアルバムで最後に使った縮小・モザイクの設定をかける
 *  3) できあがったら、もとの画像(リリース用コピーとモザイク)をアルバムから外す
 * どこかで失敗・中止したら、もとの画像はそのまま残す。
 */
export function ReplacePanel({ album, sourceName, onBusy, onReplaced }: { album: string; sourceName: string; onBusy: (busy: boolean) => void; onReplaced: (newMosaicPath: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<RegenJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = (next: Phase, message?: string) => {
    if (!alive.current) return;
    setPhase(next);
    setError(message ?? null);
    setJob(null);
    onBusy(next === "regen" || next === "mosaic" || next === "swap");
  };

  async function begin() {
    setError(null);
    setPhase("regen");
    onBusy(true);
    try {
      const r = await api<{ promptId: string }>("/api/gallery/regenerate", "POST", { path: `${album}/${sourceName}`, randomizeSeed: true });
      setJob({ promptId: r.promptId });
    } catch (e) {
      finish("error", e instanceof Error ? e.message : "作り直しを始められませんでした");
    }
  }

  /** 2) できた画像に、同じ条件で縮小・モザイクをかける → 3) もとの画像を外す */
  async function afterRegenerated(newPath: string) {
    const filename = baseName(newPath);
    setPhase("mosaic");
    try {
      const saved = loadSaved();
      const run = await api<{ jobId: string }>("/api/mosaic/run", "POST", { folder: album, files: [filename], ...saved });
      let result: MosaicResult | undefined;
      for (let i = 0; i < 150; i++) {
        await sleep(1200);
        const j = await api<MemJobState<MosaicResult>>(`/api/job?id=${run.jobId}`, "GET");
        if (j.status === "failed") throw new Error(j.error ?? "縮小・モザイクに失敗しました");
        if (j.status === "completed") {
          result = j.results[0];
          break;
        }
      }
      if (!result?.outputPath) throw new Error("モザイク画像を確認できませんでした(アルバムの一覧を開き直してください)");

      setPhase("swap");
      await api("/api/mosaic/remove", "POST", { folder: album, filename: sourceName });
      toast.success("作り直した画像に差し替えました");
      if (alive.current) {
        setPhase("idle");
        onBusy(false);
      }
      onReplaced(result.outputPath);
    } catch (e) {
      // もとの画像はそのまま残っている。できた新しい画像はギャラリーに残る
      finish("error", e instanceof Error ? e.message : "差し替えに失敗しました");
    }
  }

  const regen = useRegenJob(
    job,
    (j) => {
      setJob(j);
      if (j === null && phase === "regen") finish("idle"); // 中止・失敗
    },
    (newPath) => {
      setJob(null);
      void afterRegenerated(newPath);
    },
  );

  const p = regen.data?.progress;
  const busy = phase === "regen" || phase === "mosaic" || phase === "swap";

  return (
    <section className="panel panel-body" aria-label="作り直して差し替え">
      <span className="label">エラーがあるとき</span>
      {phase === "idle" || phase === "error" ? (
        <>
          <Button variant="outline" onClick={() => void begin()}>
            <RefreshCw /> 同じプロンプトで作り直して差し替える
          </Button>
          <p className="label" style={{ fontSize: "var(--text-xs)" }}>
            ギャラリーの元の画像から、同じプロンプト・別シードで作り直し、いまの縮小・モザイクの設定をかけて、この画像と入れ替えます。
          </p>
          {error && (
            <p role="alert" style={{ color: "var(--color-bad)" }}>
              {error}(元の画像はそのまま残っています)
            </p>
          )}
        </>
      ) : (
        <div aria-live="polite" style={{ display: "grid", gap: "var(--space-xs)" }}>
          <span className="label">
            {phase === "regen" ? (regen.data?.state === "pending" ? "作り直し: 順番待ち…" : "作り直し中…") : phase === "mosaic" ? "縮小・モザイクをかけています…" : "差し替えています…"}
          </span>
          {phase === "regen" && (
            <>
              {regen.data?.state === "running" && regen.data.previewAt ? (
                <div className="preview-frame" style={{ minHeight: "8rem", maxHeight: "22dvh" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/queue/preview?t=${regen.data.previewAt}`} alt="作り直し中の途中画像" />
                </div>
              ) : null}
              {p && p.max > 0 && (
                <>
                  <div className="bar" role="progressbar" aria-label="ステップ進捗" aria-valuemin={0} aria-valuemax={p.max} aria-valuenow={p.value}>
                    <i style={{ transform: `scaleX(${p.value / p.max})` }} />
                  </div>
                  <span className="measured">{p.value} / {p.max} ステップ</span>
                </>
              )}
              <div className="btn-grid" role="group" aria-label="作り直し中の操作">
                <Button variant="outline" onClick={() => void regen.redo()}>
                  <RotateCcw /> 別シードでやり直し
                </Button>
                <Button variant="destructive" onClick={() => void regen.cancel()}>
                  <Ban /> 中止
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {busy && <p className="label" style={{ fontSize: "var(--text-xs)" }}>終わるまで、前後の画像への移動と閉じる操作はできません。</p>}
    </section>
  );
}
