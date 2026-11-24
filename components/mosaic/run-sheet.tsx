"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { MemJobState } from "@/lib/client/types";
import {
  CLASS_LABELS,
  DEFAULT_MOSAIC,
  DEFAULT_RESIZE,
  NTD11_CLASSES,
  type MosaicResult,
  type MosaicRunRequest,
  type MosaicSettings,
  type ResizeSettings,
} from "@/lib/comfy/mosaic";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScreenSheet } from "@/components/shell/screen-sheet";

const KEY = "cp2_mosaic_settings_v1";

export interface Saved {
  mosaicEnabled: boolean;
  resizeEnabled: boolean;
  mosaic: MosaicSettings;
  resize: ResizeSettings;
}

export function loadSaved(): Saved {
  const fallback: Saved = { mosaicEnabled: true, resizeEnabled: true, mosaic: DEFAULT_MOSAIC, resize: DEFAULT_RESIZE };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    return { ...fallback, ...s, mosaic: { ...DEFAULT_MOSAIC, ...s.mosaic }, resize: { ...DEFAULT_RESIZE, ...s.resize } };
  } catch {
    return fallback;
  }
}

function Row({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-xs)" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="label">{label}</span>
        {value && <span className="measured">{value}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * 縮小+モザイクの一括処理。v1 と同じく、先に縮小(既定40%)してから、AI が検出した範囲にモザイクをかける。
 * files を渡すと、その画像だけを処理する(未処理の1枚だけ、など)。
 */
export function RunSheet({ album, files, unprocessed, total, onClose, onDone }: {
  album: string;
  /** 指定があればこの画像だけ。無ければアルバム全体 */
  files?: string[];
  /** 未処理の画像(「未処理だけ」を選べるように) */
  unprocessed: string[];
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [s, setS] = useState<Saved>(() => loadSaved());
  const [scope, setScope] = useState<"pending" | "all">(files ? "all" : unprocessed.length > 0 ? "pending" : "all");
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const { data: job } = usePoll<MemJobState<MosaicResult>>(jobId ? `/api/job?id=${jobId}` : null, 1500);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s]);

  const target = files ?? (scope === "pending" ? unprocessed : undefined);
  const count = target ? target.length : total;
  const finished = job?.status === "completed" || job?.status === "failed";

  async function start() {
    setStarting(true);
    try {
      const body: Partial<MosaicRunRequest> = { folder: album, files: target, ...s };
      const r = await api<{ jobId: string }>("/api/mosaic/run", "POST", body);
      setJobId(r.jobId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "開始できませんでした");
    } finally {
      setStarting(false);
    }
  }

  const toggleClass = (c: string) =>
    setS({ ...s, mosaic: { ...s.mosaic, targetClasses: s.mosaic.targetClasses.includes(c) ? s.mosaic.targetClasses.filter((x) => x !== c) : [...s.mosaic.targetClasses, c] } });

  // 完了したら一覧を取り直す
  useEffect(() => {
    if (job?.status === "completed") onDone();
  }, [job?.status, onDone]);

  return (
    <ScreenSheet
      title="縮小・モザイクの一括処理"
      onClose={onClose}
      footer={
        jobId ? (
          <Button size="lg" className="flex-1" onClick={onClose} disabled={!finished}>
            {finished ? "閉じる" : "処理中…(終わるまでお待ちください)"}
          </Button>
        ) : (
          <Button size="lg" className="flex-1" disabled={starting || count === 0 || (!s.mosaicEnabled && !s.resizeEnabled)} onClick={() => void start()}>
            <Play /> {starting ? "開始中…" : `${count}枚を処理する`}
          </Button>
        )
      }
    >
      {!jobId && (
        <>
          {!files && (
            <Row label="対象">
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                <button type="button" className="chip" aria-pressed={scope === "pending"} disabled={unprocessed.length === 0} onClick={() => setScope("pending")}>
                  未処理だけ <span className="measured" style={{ marginLeft: 6 }}>{unprocessed.length}</span>
                </button>
                <button type="button" className="chip" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                  すべてやり直す <span className="measured" style={{ marginLeft: 6 }}>{total}</span>
                </button>
              </div>
              {scope === "all" && <p className="label" style={{ fontSize: "var(--text-xs)" }}>処理済みの画像も、新しいファイルとしてもう一度つくります(前の結果は残ります)。</p>}
            </Row>
          )}

          <section className="panel panel-body">
            <button type="button" className="chip" aria-pressed={s.resizeEnabled} onClick={() => setS({ ...s, resizeEnabled: !s.resizeEnabled })} style={{ justifySelf: "start" }}>
              縮小する
            </button>
            {s.resizeEnabled && (
              <>
                <Row label="倍率" value={`${s.resize.scalePercent}%`}>
                  <Slider aria-label="縮小の倍率" min={10} max={100} step={5} value={[s.resize.scalePercent]} onValueChange={([v]) => setS({ ...s, resize: { ...s.resize, scalePercent: v } })} />
                </Row>
                <Row label="JPEG品質" value={`${s.resize.quality}`}>
                  <Slider aria-label="JPEG品質" min={50} max={100} step={1} value={[s.resize.quality]} onValueChange={([v]) => setS({ ...s, resize: { ...s.resize, quality: v } })} />
                </Row>
              </>
            )}
          </section>

          <section className="panel panel-body">
            <button type="button" className="chip" aria-pressed={s.mosaicEnabled} onClick={() => setS({ ...s, mosaicEnabled: !s.mosaicEnabled })} style={{ justifySelf: "start" }}>
              モザイクをかける
            </button>
            {s.mosaicEnabled && (
              <>
                <Row label="対象の部位">
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    {NTD11_CLASSES.map((c) => (
                      <button key={c} type="button" className="chip" aria-pressed={s.mosaic.targetClasses.includes(c)} onClick={() => toggleClass(c)}>
                        {CLASS_LABELS[c] ?? c}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="モザイクの粗さ" value={s.mosaic.autoSize ? "自動" : `${s.mosaic.mosaicSize}px`}>
                  <Slider aria-label="モザイクの粗さ" min={4} max={80} step={1} disabled={s.mosaic.autoSize} value={[s.mosaic.mosaicSize]} onValueChange={([v]) => setS({ ...s, mosaic: { ...s.mosaic, mosaicSize: v } })} />
                  <button type="button" className="chip" aria-pressed={s.mosaic.autoSize} onClick={() => setS({ ...s, mosaic: { ...s.mosaic, autoSize: !s.mosaic.autoSize } })} style={{ justifySelf: "start" }}>
                    画像の大きさに合わせて自動
                  </button>
                </Row>
                <Row label="検出のしきい値" value={s.mosaic.confidence.toFixed(2)}>
                  <Slider aria-label="検出のしきい値" min={0.05} max={0.9} step={0.05} value={[s.mosaic.confidence]} onValueChange={([v]) => setS({ ...s, mosaic: { ...s.mosaic, confidence: v } })} />
                  <p className="label" style={{ fontSize: "var(--text-xs)" }}>低いほど、見逃しが減る代わりに誤検出が増えます。</p>
                </Row>
                <Row label="範囲の広げ幅" value={`${s.mosaic.bboxExpand}%`}>
                  <Slider aria-label="範囲の広げ幅" min={0} max={20} step={1} value={[s.mosaic.bboxExpand]} onValueChange={([v]) => setS({ ...s, mosaic: { ...s.mosaic, bboxExpand: v } })} />
                </Row>
              </>
            )}
          </section>
        </>
      )}

      {jobId && (
        <section className="panel panel-body" aria-live="polite">
          <span className="label">{job?.status === "failed" ? "失敗しました" : finished ? "完了しました" : "処理中"}</span>
          <div className="reading">
            {job?.current ?? 0}
            <span className="label" style={{ marginLeft: 8, fontFamily: "var(--font-outlier)" }}>/ {job?.total ?? count}</span>
          </div>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={job?.total ?? count} aria-valuenow={job?.current ?? 0}>
            <i style={{ transform: `scaleX(${job && job.total > 0 ? Math.min(1, job.current / job.total) : 0})` }} />
          </div>
          {job?.error && <p role="alert" style={{ color: "var(--color-bad)" }}>{job.error}</p>}
          {finished && job && job.results.length > 0 && (
            <>
              <p className="label">
                検出なし: <span className="measured">{job.results.filter((r) => r.regionCount === 0).length}</span> 枚
                {job.results.some((r) => r.regionCount === 0) && "(モザイクが必要なら、あとで手で足せます)"}
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                {job.results.map((r) => (
                  <li key={r.filename} className="row" style={{ minHeight: 40, padding: 0 }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }} className="measured">{r.filename}</span>
                    <span className="measured" style={{ color: r.regionCount > 0 ? "var(--color-ok)" : "var(--color-accent)" }}>
                      {r.regionCount > 0 ? `${r.regionCount}箇所` : "検出なし"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="chip" aria-pressed={showLog} onClick={() => setShowLog(!showLog)} style={{ justifySelf: "start" }}>
            ログ
          </button>
          {showLog && (
            <pre className="measured" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "30dvh", overflowY: "auto", margin: 0, padding: "var(--space-sm)", background: "var(--color-paper-3)", borderRadius: "var(--radius-pill)" }}>
              {(job?.log ?? []).join("\n")}
            </pre>
          )}
        </section>
      )}
    </ScreenSheet>
  );
}
