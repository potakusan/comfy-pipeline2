"use client";

import { useState } from "react";
import { Ban, Dices, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { QueueResponse } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Viewer, type ViewerImage } from "@/components/gallery/viewer";
import { QueueTree } from "./queue-tree";
import { formatClock, formatDuration, remainingSeconds } from "@/lib/comfy/eta";

/** セット名。記録がない古い保留は、ラベルの先頭(複数セットのときだけ付く)から推測する */
const setOf = (h: { label: string; setName: string | null }) => h.setName ?? (h.label.split(" / ").length >= 3 ? h.label.split(" / ")[0] : "その他");

interface GalleryRow {
  path: string;
  v: string;
  positivePrompt: string | null;
  negativePrompt: string | null;
  loraName: string | null;
  seed: number | null;
  canRegenerate: boolean;
}

export function QueueScreen() {
  const { data, error, loading, reload } = usePoll<QueueResponse>("/api/queue", 2000);
  // ビューアに渡す画像は、開いた時点の一覧を持つ(2秒ごとの更新で新しい画像が先頭に増えても、見ている画像がずれないように)
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; start: number } | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function act(body: Record<string, unknown>, ok?: string) {
    try {
      await api("/api/queue", "POST", body);
      if (ok) toast.success(ok);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作に失敗しました");
    }
  }

  async function start() {
    setStarting(true);
    try {
      const r = await api<{ submitted: number; remainingHeld: number; error?: string }>("/api/queue", "POST", { action: "start" });
      if (r.error) toast.warning(`${r.submitted}枚を開始しました。残りは送れませんでした`, { description: r.error });
      else toast.success(`${r.submitted}枚の生成を開始しました`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "開始できませんでした");
    } finally {
      setStarting(false);
    }
  }

  async function cancelMany(entryIds: string[], ok: string) {
    try {
      for (const entryId of entryIds) await api("/api/queue", "POST", { action: "cancel-entry", entryId });
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取り消せませんでした");
    }
    await reload();
  }

  /** ギャラリーのフォルダの一覧から、再生成に必要なメタデータ(プロンプト・シード)付きのビューア用の画像を作る */
  async function viewerImagesFor(paths: { path: string; label: string }[]): Promise<ViewerImage[]> {
    const rows = new Map<string, GalleryRow>();
    await Promise.all(
      [...new Set(paths.map((p) => p.path.split("/")[0]))].map(async (folder) => {
        try {
          const r = await api<{ images: GalleryRow[] }>(`/api/gallery/images?folder=${encodeURIComponent(folder)}`, "GET");
          for (const im of r.images) rows.set(im.path, im);
        } catch {
          // フォルダが消えている・取れないときは、プロンプトなしで見るだけ
        }
      }),
    );
    return paths.map(({ path, label }) => {
      const m = rows.get(path);
      return { path, v: m?.v, caption: label, canRegenerate: !!m?.canRegenerate, info: m ? { prompt: m.positivePrompt, negative: m.negativePrompt, lora: m.loraName, seed: m.seed } : undefined };
    });
  }

  async function openViewer(i: number) {
    const images = await viewerImagesFor(data!.recent.map((r) => ({ path: r.path, label: r.label })));
    setFocusPath(null);
    setViewer({ images, start: i });
  }

  /** 再生成が終わったら、新しい画像を先頭に足して、そこへ移る(完成した画像の一覧にも、すぐあとで並ぶ) */
  async function regenerated(newPath: string) {
    const [img] = await viewerImagesFor([{ path: newPath, label: "再生成" }]);
    setViewer((v) => (v ? { ...v, images: [img, ...v.images.filter((x) => x.path !== newPath)] } : v));
    setFocusPath(newPath);
    await reload();
  }

  async function pause() {
    try {
      const r = await api<{ currentName: string; held: number }>("/api/queue", "POST", { action: "pause-after-set" });
      toast.success(`「${r.currentName}」が終わると止まります`, { description: `残り${r.held}枚は保留に戻しました。再開は「開始」を押してください` });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "一時停止できませんでした");
    }
  }

  if (loading) {
    return (
      <div className="page" aria-busy="true" aria-label="読み込み中">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <div className="panel panel-body" role="alert">
          <h2>キューを取得できません</h2>
          <p className="label">{error}</p>
          <Button onClick={() => void reload()}>再試行</Button>
        </div>
      </div>
    );
  }

  const heldImages = data.held.reduce((s, h) => s + h.count, 0);
  const running = data.running[0];
  const group = running ? data.groups[running.entryId] : undefined;
  const live = running && data.progress?.promptId === running.promptId ? data.progress : null;
  // 待機中を「アイテム」ごとにまとめる(順序は最初に出てきた順)
  const remaining = data.running.length + data.waitingImages;
  // 残り時間(ETA)。実行中の1枚は、ステップの進み具合の分だけ減らす
  const stepFraction = live && live.max > 0 ? live.value / live.max : 0;
  const eta = data.secPerImage ? remainingSeconds(remaining, data.secPerImage, stepFraction) : null;
  const etaHeld = data.secPerImage ? remainingSeconds(remaining + heldImages, data.secPerImage, stepFraction) : null;
  const now = data.now;
  const recentImages: ViewerImage[] = data.recent.map((r) => ({ path: r.path, caption: r.label }));

  return (
    <div className="page wide">
      <div className="cols">
        <div className="stack">
          <section className="panel panel-body" aria-label="保留中">
            <span className="label">保留中(まだ始まっていません)</span>
            <div className="reading" aria-live="polite">
              {heldImages}
              <span className="label" style={{ marginLeft: 8, fontFamily: "var(--font-body)" }}>枚</span>
            </div>
            {etaHeld != null && heldImages > 0 && (
              <p className="measured" style={{ color: "var(--color-cool)" }}>
                開始すると 約{formatDuration(etaHeld)} ／ {formatClock(now + etaHeld * 1000, now)}頃に完了
              </p>
            )}
            {data.held.length === 0 ? (
              <p className="label">「生成」タブで追加すると、ここにたまります。</p>
            ) : (
              <QueueTree
                items={data.held.map((h) => ({ id: h.id, label: h.label, count: h.count, lora: h.loraName, set: setOf(h) }))}
                removeWord="保留から外す"
                onRemove={(h) => void act({ action: "remove-held", id: h.id })}
                onRemoveMany={(items, name) => void act({ action: "remove-held", ids: items.map((h) => h.id) }, `${name}を保留から外しました`)}
              />
            )}
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <Button size="lg" className="flex-1" disabled={data.held.length === 0 || starting} onClick={() => void start()}>
                <Play /> {starting ? "送信中…" : `開始 (${heldImages}枚)`}
              </Button>
              <Button
                variant="outline"
                size="icon-lg"
                aria-label="保留をすべて消す"
                disabled={data.held.length === 0}
                onClick={() => window.confirm("保留中の生成をすべて消します。よろしいですか？") && void act({ action: "remove-held", id: "all" })}
              >
                <Trash2 />
              </Button>
            </div>
          </section>

          {data.feedError && (
            <section className="panel panel-body" role="alert" aria-label="送信できていません">
              <p style={{ color: "var(--color-bad)" }}>ComfyUI に送れていません(自動で再試行します)</p>
              <p className="label" style={{ overflowWrap: "anywhere" }}>{data.feedError}</p>
            </section>
          )}

          {data.failed.length > 0 && (
            <section className="panel" aria-label="失敗">
              {data.failed.map((f) => (
                <div key={f.promptId} className="row" style={{ background: "var(--color-bad-soft)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", overflowWrap: "anywhere" }}>{f.label}</span>
                    <span className="label">{f.message}</span>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="stack">
          <section className="panel" aria-label="実行中">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="label">実行中</span>
              <span className="measured" style={{ color: "var(--color-cool)" }}>
                残り {remaining}枚
              </span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", paddingTop: 0 }} aria-live="polite">
              <span className="label">残り時間の目安</span>
              <span className="measured" style={{ color: "var(--color-cool)" }}>
                {eta != null && remaining > 0 ? `約${formatDuration(eta)} ／ ${formatClock(now + eta * 1000, now)}頃` : remaining > 0 ? "計算中(数枚できると出ます)" : "—"}
              </span>
            </div>
            {!running ? (
              <p className="label" style={{ padding: "0 var(--space-md) var(--space-md)" }}>
                {heldImages > 0 ? "「開始」を押すと生成が始まります。" : "生成中のものはありません。"}
              </p>
            ) : (
              <div className="panel-body">
                <div className="preview-frame">
                  {data.previewAt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/queue/preview?t=${data.previewAt}`} alt="生成中の途中画像" />
                  ) : (
                    <span className="label">途中画像を待っています…</span>
                  )}
                </div>
                <p style={{ overflowWrap: "anywhere" }}>{running.label}</p>
                {group && (
                  <p className="measured" style={{ color: "var(--color-muted)" }}>
                    {Math.min(group.total, group.total - group.remaining + 1)} / {group.total} 枚目
                  </p>
                )}
                {live && live.max > 0 ? (
                  <>
                    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={live.max} aria-valuenow={live.value} aria-label="ステップ進捗">
                      <i style={{ transform: `scaleX(${live.value / live.max})` }} />
                    </div>
                    <span className="measured">{live.value} / {live.max} ステップ</span>
                  </>
                ) : (
                  <span className="label">準備中(モデル読み込みなど)</span>
                )}
                <div className="btn-grid">
                  <Button variant="outline" onClick={() => void act({ action: "redo", mode: "same", promptId: running.promptId }, "同じプロンプトで別シードにやり直します")}>
                    <RotateCcw /> やり直し(同じ)
                  </Button>
                  <Button variant="outline" onClick={() => void act({ action: "redo", mode: "reroll", promptId: running.promptId }, "ランダム要素を引き直してやり直します")}>
                    <Dices /> やり直し(引き直し)
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      window.confirm(running.kind === "batch" ? "このアイテムの残りと、いま生成中の1枚を中止します。よろしいですか？" : "この生成を中止します。よろしいですか？") &&
                      void act({ action: "cancel-entry", entryId: running.entryId }, "中止しました")
                    }
                  >
                    <Ban /> 中止
                  </Button>
                </div>
                {data.pause && data.pause.holdImages > 0 && (
                  <Button variant="outline" size="lg" onClick={() => void pause()}>
                    <Pause /> 「{data.pause.currentName}」が終わったら一時停止
                    <span className="measured" style={{ marginLeft: 8 }}>残り{data.pause.holdImages}枚は保留へ</span>
                  </Button>
                )}
              </div>
            )}
          </section>

          {data.waiting.length > 0 && (
            <section className="panel" aria-label="待機中">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label">待機中</span>
                <Button variant="ghost" size="sm" onClick={() => window.confirm("待機中の生成をすべて取り消します。実行中の1枚は止まりません。") && void act({ action: "clear" }, "待機中を取り消しました")}>
                  全消去
                </Button>
              </div>
              <div style={{ padding: "0 var(--space-sm) var(--space-sm)" }}>
                <QueueTree
                  items={data.waiting.map((w) => ({ id: w.entryId, label: w.label, count: w.count, lora: w.loraName ?? "", set: w.setName ?? (w.label.split(" / ").length >= 3 ? w.label.split(" / ")[0] : null) }))}
                  removeWord="取り消す"
                  onRemove={(h) => void act({ action: "cancel-entry", entryId: h.id }, "取り消しました")}
                  onRemoveMany={(items, name) => void cancelMany(items.map((h) => h.id), `${name}を取り消しました`)}
                />
              </div>
            </section>
          )}
        </div>
      </div>

      <section aria-label="完成">
        <h2 className="label" style={{ padding: "0 0 var(--space-xs)", maxWidth: "none", fontSize: "var(--text-sm)" }}>
          完成した画像
        </h2>
        {recentImages.length === 0 ? (
          <div className="panel panel-body">
            <p className="label">生成が終わった画像がここに並びます。</p>
          </div>
        ) : (
          <div className="thumbs thumbs--contain">
            {recentImages.map((img, i) => (
              <button key={img.path} type="button" onClick={() => void openViewer(i)} aria-label={`${img.caption ?? "画像"}を開く`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/gallery/thumb?path=${encodeURIComponent(img.path)}`} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </section>

      {viewer != null && <Viewer images={viewer.images} start={viewer.start} focusPath={focusPath} onRegenerated={(p) => void regenerated(p)} onClose={() => setViewer(null)} />}
    </div>
  );
}
