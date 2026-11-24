"use client";

import { useState } from "react";
import { Ban, Dices, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, usePoll } from "@/lib/client/use-poll";
import type { QueueResponse } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Viewer, type ViewerImage } from "@/components/gallery/viewer";

/** ラベルは「セット / LoRA / プリセット」なので、一覧ではプリセット名だけを出す */
const presetOf = (label: string) => label.split(" / ").pop() || label;
/** セット名。記録がない古い保留は、ラベルの先頭(複数セットのときだけ付く)から推測する */
const setOf = (h: { label: string; setName: string | null }) => h.setName ?? (h.label.split(" / ").length >= 3 ? h.label.split(" / ")[0] : "その他");

export function QueueScreen() {
  const { data, error, loading, reload } = usePoll<QueueResponse>("/api/queue", 2000);
  const [viewer, setViewer] = useState<number | null>(null);
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
  // 保留をセットごとにまとめる(セットが分からない古いものは「その他」)。順序は最初に出てきた順
  const heldGroups = [...data.held.reduce((m, h) => m.set(setOf(h), [...(m.get(setOf(h)) ?? []), h]), new Map<string, typeof data.held>())].map(([name, items]) => ({
    name,
    items,
    count: items.reduce((s, h) => s + h.count, 0),
  }));
  const running = data.running[0];
  const group = running ? data.groups[running.entryId] : undefined;
  const live = running && data.progress?.promptId === running.promptId ? data.progress : null;
  // 待機中を「アイテム」ごとにまとめる(順序は最初に出てきた順)
  const pendingGroups = [...data.pending.reduce((m, j) => m.set(j.entryId, [...(m.get(j.entryId) ?? []), j]), new Map<string, typeof data.pending>())];
  const remaining = data.running.length + data.pending.length;
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
            {data.held.length === 0 ? (
              <p className="label">「生成」タブで追加すると、ここにたまります。</p>
            ) : (
              // 大量にたまっても縦に伸びないよう、セットごとに畳む(開くと、その中のプリセットを内側のスクロールで見られる)
              <div style={{ display: "grid", gap: "var(--space-xs)" }}>
                {heldGroups.map((g) => (
                  <details key={g.name} className="accordion">
                    <summary style={{ gap: "var(--space-xs)" }}>
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{g.name}</span>
                      <span className="measured" style={{ color: "var(--color-muted)" }}>
                        {g.items.length}件 ／ {g.count}枚
                      </span>
                    </summary>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "36dvh", overflowY: "auto", overscrollBehavior: "contain" }}>
                      {g.items.map((h) => (
                        <li key={h.id} className="row" style={{ padding: 0, minHeight: 44 }} title={h.label}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "var(--space-sm)" }}>{presetOf(h.label)}</span>
                          <span className="measured">×{h.count}</span>
                          <Button variant="ghost" size="icon" aria-label={`${h.label}を保留から外す`} onClick={() => void act({ action: "remove-held", id: h.id })}>
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <div style={{ padding: "var(--space-xs) var(--space-sm)" }}>
                      <Button variant="outline" size="sm" onClick={() => void act({ action: "remove-held", ids: g.items.map((h) => h.id) }, `${g.name}を保留から外しました`)}>
                        <Trash2 /> このセットを保留から外す
                      </Button>
                    </div>
                  </details>
                ))}
              </div>
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

          {pendingGroups.length > 0 && (
            <section className="panel" aria-label="待機中">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label">待機中</span>
                <Button variant="ghost" size="sm" onClick={() => window.confirm("待機中の生成をすべて取り消します。実行中の1枚は止まりません。") && void act({ action: "clear" }, "待機中を取り消しました")}>
                  全消去
                </Button>
              </div>
              <div style={{ maxHeight: "40dvh", overflowY: "auto", overscrollBehavior: "contain" }}>
                {pendingGroups.map(([entryId, jobs]) => (
                  <div key={entryId} className="row" title={jobs[0].label}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{presetOf(jobs[0].label) || jobs[0].promptId.slice(0, 8)}</span>
                    <span className="measured">×{jobs.length}</span>
                    <Button variant="ghost" size="icon" aria-label={`${jobs[0].label}を取り消す`} onClick={() => void act({ action: "cancel-entry", entryId }, "取り消しました")}>
                      <X />
                    </Button>
                  </div>
                ))}
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
              <button key={img.path} type="button" onClick={() => setViewer(i)} aria-label={`${img.caption ?? "画像"}を開く`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/gallery/thumb?path=${encodeURIComponent(img.path)}`} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </section>

      {viewer != null && <Viewer images={recentImages} start={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
