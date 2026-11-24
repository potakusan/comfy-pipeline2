"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Dices, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { QueueResponse } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScreenSheet } from "@/components/shell/screen-sheet";

const COUNTS = [1, 2, 4, 8, 16];

/**
 * 「このプリセットをあと n 枚」。元と同じ構成のまま、ランダム部分(ランダム行・変数・構図)と seed を1枚ごとに引き直して追加する。
 * 保存先は同じフォルダ・同じ接頭辞(連番は続き)なので、できた画像はそのままこのプリセットのグループに並ぶ。
 * 生成中は、いまの1枚を「ランダム値も入れ替えて」「別シードで」作り直したり、残りを中止したりできる(v1 と同じ)。
 */
export function MoreSheet({ folder, group, onClose, onImageSaved }: { folder: string; group: string; onClose: () => void; onImageSaved: () => void }) {
  const [count, setCount] = useState(4);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<{ entryId: string; total: number; samePromptOnly: boolean } | null>(null);
  const { data: q } = usePoll<QueueResponse>(run ? "/api/queue" : null, 1500);
  const lastSaved = useRef(0);

  const mine = run ? q?.recent.filter((r) => r.entryId === run.entryId) ?? [] : [];
  const running = run ? q?.running.find((j) => j.entryId === run.entryId) : undefined;
  const group_ = run ? q?.groups[run.entryId] : undefined;
  const live = running && q?.progress?.promptId === running.promptId ? q.progress : null;
  // 残りのジョブが無くなったら終わり(キューの集計から消える)。開始直後で集計がまだ無いときは、まだ終わりではない
  const finished = !!run && !!q && !group_ && !running && mine.length > 0;
  const stopped = !!run && !!q && !group_ && !running && mine.length === 0 && q.pending.every((j) => j.entryId !== run.entryId);

  useEffect(() => {
    if (mine.length > lastSaved.current) {
      lastSaved.current = mine.length;
      onImageSaved(); // 1枚できるたびに、ギャラリーの一覧を取り直す
    }
  }, [mine.length, onImageSaved]);

  async function start() {
    setStarting(true);
    try {
      const r = await api<{ entryId: string; submitted: number; samePromptOnly: boolean }>("/api/gallery/more", "POST", { folder, group, count });
      lastSaved.current = 0;
      setRun({ entryId: r.entryId, total: r.submitted, samePromptOnly: r.samePromptOnly });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "始められませんでした");
    } finally {
      setStarting(false);
    }
  }

  async function act(body: Record<string, unknown>, ok: string) {
    try {
      await api("/api/queue", "POST", body);
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作できませんでした");
    }
  }

  const remaining = group_?.remaining ?? 0;
  const done = run ? Math.max(0, run.total - remaining) : 0;

  return (
    <ScreenSheet
      title="このプリセットをあと何枚か"
      onClose={onClose}
      footer={
        run && (finished || stopped) ? (
          <>
            <Button size="lg" variant="outline" className="flex-1" onClick={() => setRun(null)}>
              続けて生成
            </Button>
            <Button size="lg" className="flex-1" onClick={onClose}>
              閉じる
            </Button>
          </>
        ) : run ? (
          <Button size="lg" variant="outline" className="flex-1" onClick={onClose}>
            閉じる(生成は続きます)
          </Button>
        ) : (
          <Button size="lg" className="flex-1" disabled={starting || !(count >= 1)} onClick={() => void start()}>
            <Play /> {starting ? "送信中…" : `${count}枚を生成する`}
          </Button>
        )
      }
    >
      <div>
        <p style={{ overflowWrap: "anywhere" }}>{group}</p>
        <p className="label" style={{ fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>
          保存先: <span className="measured">{folder}/{group}_NNNNN_</span>(連番は既存の続き)
        </p>
      </div>

      {!run && (
        <>
          <p className="label">元と同じ構成のまま、ランダム部分と seed を1枚ごとに引き直して追加します。順番待ちの先頭に入ります。</p>
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }} role="group" aria-label="枚数">
            {COUNTS.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={count === c} onClick={() => setCount(c)} style={{ minHeight: 44 }}>
                <span className="measured">{c}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <label htmlFor="more-count" className="label">枚数</label>
            <Input id="more-count" type="number" inputMode="numeric" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} className="measured" style={{ maxWidth: "7em" }} />
          </div>
        </>
      )}

      {run && (
        <section className="panel panel-body" aria-live="polite">
          {run.samePromptOnly && (
            <p className="label" style={{ color: "var(--color-accent)" }}>
              この画像は元の構成が残っていないため、同じプロンプトを別シードで作ります(ランダム部分は引き直せません)。
            </p>
          )}
          <span className="label">{finished ? "完了しました" : stopped ? "中止しました" : running ? `${Math.min(done + 1, run.total)} / ${run.total} 枚目を生成中` : "順番待ち…"}</span>
          <div className="reading">
            {mine.length}
            <span className="label" style={{ marginLeft: 8, fontFamily: "var(--font-outlier)" }}>/ {run.total} 保存</span>
          </div>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={mine.length}>
            <i style={{ transform: `scaleX(${run.total > 0 ? Math.min(1, mine.length / run.total) : 0})` }} />
          </div>

          {running && (
            <>
              <div className="preview-frame">
                {q?.previewAt ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/queue/preview?t=${q.previewAt}`} alt="生成中の途中画像" />
                ) : (
                  <span className="label">途中画像を待っています…</span>
                )}
              </div>
              {live && live.max > 0 && (
                <>
                  <div className="bar" role="progressbar" aria-label="ステップ進捗" aria-valuemin={0} aria-valuemax={live.max} aria-valuenow={live.value}>
                    <i style={{ transform: `scaleX(${live.value / live.max})` }} />
                  </div>
                  <span className="measured">{live.value} / {live.max} ステップ</span>
                </>
              )}
              <div className="btn-grid">
                <Button variant="outline" onClick={() => void act({ action: "redo", mode: "reroll", promptId: running.promptId }, "ランダム値も入れ替えて、この1枚を作り直します")}>
                  <Dices /> ランダムも入れ替えて作り直し
                </Button>
                <Button variant="outline" onClick={() => void act({ action: "redo", mode: "same", promptId: running.promptId }, "同じプロンプトで別シードにやり直します")}>
                  <RotateCcw /> 別シードで作り直し
                </Button>
                <Button variant="destructive" onClick={() => window.confirm("残りの生成を中止します(できた画像は残ります)。よろしいですか？") && void act({ action: "cancel-entry", entryId: run.entryId }, "中止しました")}>
                  <Ban /> 残りを中止
                </Button>
              </div>
            </>
          )}

          {mine.length > 0 && (
            <div style={{ display: "grid", gap: "var(--space-xs)" }}>
              <span className="label">できた画像</span>
              <div className="gallery-grid" style={{ ["--thumb" as string]: "88px" }}>
                {mine.map((r) => (
                  <div key={r.path} className="gthumb" style={{ aspectRatio: "3 / 4" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/gallery/thumb?path=${encodeURIComponent(r.path)}`} alt="" loading="lazy" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </ScreenSheet>
  );
}
