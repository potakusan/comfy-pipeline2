"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { JobState } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagField } from "@/components/shell/tag-field";
import type { ViewerImage } from "./viewer";

export interface RegenJob {
  promptId: string;
}

const mono = { fontFamily: "var(--font-outlier)", fontSize: "var(--text-sm)" } as const;

/**
 * 画像のプロンプトを、ビューアの中で最初から編集できる状態で出し、そのまま再生成する。
 * 画像を切り替えるたびに(key=画像のパス)、その画像の元のプロンプトで作り直される。
 * シードは「ランダム(別シード)」か「固定して再現」。ネガティブは必要なときだけ開く。
 */
export function RegenForm({ image, running, onStarted }: { image: ViewerImage; running: boolean; onStarted: (job: RegenJob) => void }) {
  const original = image.info?.prompt ?? "";
  const [positive, setPositive] = useState(original);
  const [negative, setNegative] = useState(image.info?.negative ?? "");
  const [showNegative, setShowNegative] = useState(false);
  const [pin, setPin] = useState(false);
  const [seed, setSeed] = useState(String(image.info?.seed ?? 0));
  const [sending, setSending] = useState(false);

  if (!image.canRegenerate) {
    return (
      <div className="panel panel-body">
        <p className="label">この画像は、再生成に必要な情報(プロンプト・設定)が残っていないか、カップルモードの画像のため再生成できません。</p>
        {original && <p className="measured" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "none", maxHeight: "30dvh", overflowY: "auto" }}>{original}</p>}
      </div>
    );
  }

  const edited = positive !== original || negative !== (image.info?.negative ?? "");

  async function submit() {
    setSending(true);
    try {
      const n = Number.parseInt(seed, 10);
      const r = await api<{ promptId: string }>("/api/gallery/regenerate", "POST", {
        path: image.path,
        positivePrompt: positive,
        negativePrompt: negative,
        randomizeSeed: !pin,
        seed: pin && Number.isFinite(n) ? n : undefined,
      });
      onStarted({ promptId: r.promptId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "再生成を始められませんでした");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="regen-form" aria-label="プロンプトを編集して再生成">
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <label htmlFor="rg-pos" className="label" style={{ whiteSpace: "nowrap" }}>
          プロンプト
          {edited && <span style={{ marginLeft: 8, color: "var(--color-accent)" }}>編集中</span>}
        </label>
        <span className="measured" style={{ color: "var(--color-muted)", fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>
          {image.info?.lora ?? "LoRAなし"}
          {image.info?.seed != null ? ` ／ seed ${image.info.seed}` : ""}
        </span>
      </div>
      <TagField multiline id="rg-pos" value={positive} onChange={setPositive} rows={5} style={mono} />
      {showNegative && (
        <>
          <label htmlFor="rg-neg" className="label">ネガティブ</label>
          <TagField multiline id="rg-neg" value={negative} onChange={setNegative} rows={3} style={mono} />
        </>
      )}
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="chip" aria-pressed={showNegative} onClick={() => setShowNegative(!showNegative)}>
          ネガティブ
        </button>
        <button type="button" className="chip" aria-pressed={!pin} onClick={() => setPin(false)}>
          別シード
        </button>
        <button type="button" className="chip" aria-pressed={pin} onClick={() => setPin(true)}>
          シード固定
        </button>
        {edited && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              setPositive(original);
              setNegative(image.info?.negative ?? "");
            }}
          >
            <Undo2 size={14} aria-hidden style={{ marginRight: 4 }} /> 元に戻す
          </button>
        )}
      </div>
      {pin && <Input aria-label="シード値" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} style={mono} />}
      <Button size="lg" disabled={sending || running || !positive.trim()} onClick={() => void submit()}>
        <Sparkles /> {running ? "再生成中…" : sending ? "送信中…" : pin ? "このシードで再生成" : "別シードで再生成"}
      </Button>
    </section>
  );
}

/**
 * 再生成ジョブの追跡。進捗・途中画像を取り、完成したら onDone に新しい画像のパスを渡す。
 * redo は同じプロンプトのまま別シードでやり直し、cancel は中止する。
 */
export function useRegenJob(job: RegenJob | null, onJob: (j: RegenJob | null) => void, onDone: (path: string) => void) {
  const { data } = usePoll<JobState>(job ? `/api/jobs?promptId=${job.promptId}` : null, 1500);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!job || !data || handled.current === job.promptId) return;
    if (data.state === "done" && data.path) {
      handled.current = job.promptId;
      toast.success("再生成が完了しました");
      onDone(data.path);
    } else if (data.state === "failed") {
      handled.current = job.promptId;
      toast.error(data.message ?? "再生成に失敗しました");
      onJob(null);
    }
  }, [data, job, onDone, onJob]);

  async function redo() {
    if (!job) return;
    try {
      const r = await api<{ promptId: string }>("/api/queue", "POST", { action: "redo", mode: "same", promptId: job.promptId });
      onJob({ promptId: r.promptId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "やり直せませんでした");
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      await api("/api/queue", "POST", { action: "cancel-prompt", promptId: job.promptId });
      toast.success("再生成を中止しました");
    } catch {}
    onJob(null);
  }

  return { data, redo, cancel };
}

export type RegenState = ReturnType<typeof useRegenJob>;

/** 画像の上に重ねる、途中画像とステップ進捗 */
export function RegenOverlay({ state }: { state: RegenState }) {
  const p = state.data?.progress;
  return (
    <div className="regen-overlay" role="status" aria-live="polite">
      {state.data?.state === "running" && state.data.previewAt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/queue/preview?t=${state.data.previewAt}`} alt="再生成中の途中画像" />
      ) : (
        <span className="label" style={{ margin: "auto" }}>{state.data?.state === "pending" ? "順番待ち…" : "準備中…"}</span>
      )}
      <div className="regen-controls">
        <span className="label">{state.data?.state === "pending" ? "順番待ち" : "再生成中"}</span>
        {p && p.max > 0 && (
          <>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.max} aria-valuenow={p.value} aria-label="ステップ進捗">
              <i style={{ transform: `scaleX(${p.value / p.max})` }} />
            </div>
            <span className="measured">{p.value} / {p.max}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** 再生成中の操作(別シードでやり直し・中止)。右の列(スマホでは下)の、いつも見える位置に置く */
export function RegenControls({ state }: { state: RegenState }) {
  return (
    <div className="btn-grid" role="group" aria-label="再生成中の操作">
      <Button variant="outline" onClick={() => void state.redo()}>
        <RotateCcw /> 別シードでやり直し
      </Button>
      <Button variant="destructive" onClick={() => void state.cancel()}>
        <Ban /> 中止
      </Button>
    </div>
  );
}
