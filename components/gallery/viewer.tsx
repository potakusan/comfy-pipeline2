"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RegenControls, RegenForm, RegenOverlay, useRegenJob, type RegenJob } from "./regen-panel";

export interface ViewerImage {
  path: string;
  /** 中身のバージョン(あれば URL に付けて、差し替え・名前の入れ替えのあとも古い画像を使わない) */
  v?: string;
  caption?: string;
  released?: boolean;
  /** 再生成に必要なメタデータがあるか(無い画像・カップル画像は不可) */
  canRegenerate?: boolean;
  info?: { prompt: string | null; negative: string | null; lora: string | null; seed: number | null };
}

interface Props {
  images: ViewerImage[];
  start: number;
  onClose: () => void;
  /** 渡されたときだけ「リリース選択」ボタンを出す */
  onToggleRelease?: (image: ViewerImage) => Promise<void>;
  /** 渡されたときだけ削除ボタンを出す */
  onDelete?: (image: ViewerImage) => Promise<void>;
  /** 渡されたときだけ再生成を出す。完成した新しい画像のパスで呼ばれる */
  onRegenerated?: (newPath: string) => void;
  /** 一覧が更新された後に、この画像へ移動する */
  focusPath?: string | null;
  /** 画像の取得先。省略時はギャラリー(ComfyUI の出力フォルダ)。リリース用フォルダなどを見せるときに指定する */
  srcOf?: (image: ViewerImage) => string;
}

/** 全画面ビューア。横スワイプで前後、戻るボタンで閉じる。表示は幅 1600 に縮小した webp(VPN 越しでも軽い)。 */
export function Viewer({ images, start, onClose, onToggleRelease, onDelete, onRegenerated, focusPath, srcOf }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<RegenJob | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);

  // 親が再描画のたびに onClose を作り直しても(キュー画面は2秒ごとに更新される)、履歴の付け外しをやり直して閉じてしまわないよう、最新の onClose を ref で持つ
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current(), []);

  // 再生成の進行(進捗・途中画像・完成の検知)。完成したら新しい画像へ移る
  const regen = useRegenJob(job, setJob, (path) => {
    setJob(null);
    onRegenerated?.(path);
  });

  const scrollTo = useCallback((i: number) => {
    const el = track.current;
    if (el) el.scrollLeft = i * el.clientWidth;
  }, []);

  useEffect(() => scrollTo(start), [start, scrollTo]);

  // 左右キー・ボタンでも画像送りできるように(指のスワイプは、スクロールそのもので動く)
  const go = useCallback((delta: number) => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    const target = Math.min(Math.max(Math.round(el.scrollLeft / el.clientWidth) + delta, 0), el.children.length - 1);
    el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
  }, []);

  // 再生成が終わって一覧が更新されたら、新しい画像へ移動する
  useEffect(() => {
    if (!focusPath) return;
    const i = images.findIndex((x) => x.path === focusPath);
    // スクロールすれば onScroll が index を更新する
    if (i >= 0) scrollTo(i);
  }, [focusPath, images, scrollTo]);

  // 端末の「戻る」でも閉じられるよう、開いている間だけ履歴に1段積む。
  // 閉じる操作そのもの(×・スワイプ・Esc)は履歴に頼らず直接 onClose を呼ぶ。
  // 開発時の StrictMode が付け外しを即座に繰り返しても履歴が壊れないよう、積むのは1tick遅らせる。
  useEffect(() => {
    let pushed = false;
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    const timer = setTimeout(() => {
      history.pushState(history.state, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) go(-1);
      else if (e.key === "ArrowRight" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      // ×などで自分から閉じたときは、積んだ1段を戻して履歴を元に戻す
      if (pushed && !popped) history.back();
    };
  }, [close, go]);

  // 削除で枚数が減ったとき、範囲外を指さないよう補正する。画像が尽きたら閉じる。
  useEffect(() => {
    if (images.length === 0) close();
    else if (index >= images.length) scrollTo(images.length - 1);
  }, [images.length, index, close, scrollTo]);

  const current = images[Math.min(index, images.length - 1)];
  if (!current) return null;

  function onScroll() {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }

  async function run(fn?: (img: ViewerImage) => Promise<void>) {
    if (!fn || busy) return;
    setBusy(true);
    try {
      await fn(current);
    } finally {
      setBusy(false);
    }
  }

  const regenerating = job != null;

  // 下へスワイプして閉じる。縦にはっきり動いたときだけ引っ張り、横スワイプ(前後の画像)とは奪い合わない。
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      if (regenerating) return;
      drag.current = { x: e.clientX, y: e.clientY, active: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.active) {
        if (dy > 12 && dy > Math.abs(dx) * 1.5) {
          d.active = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        } else if (Math.abs(dx) > 12) {
          drag.current = null;
          return;
        } else return;
      }
      setDragY(Math.max(0, dy));
    },
    onPointerUp: () => endDrag(),
    onPointerCancel: () => endDrag(),
  };

  function endDrag() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.active && dragY > 110) close();
    else setDragY(0);
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="画像ビューア" style={{ opacity: 1 - Math.min(dragY / 500, 0.6) }}>
      <div className="viewer-head">
        <span className="measured" style={{ color: "var(--color-muted)" }}>
          {index + 1} / {images.length}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="閉じる" onClick={close}>
          <X />
        </Button>
      </div>

      <div
        className="viewer-stage"
        {...swipe}
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform var(--dur-short) var(--ease-out)" }}
      >
        <div className="viewer-track" ref={track} onScroll={onScroll} style={regenerating ? { overflowX: "hidden" } : undefined}>
          {images.map((img, i) => (
            <div key={img.path} className="viewer-slide">
              {Math.abs(i - index) <= 1 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={srcOf ? srcOf(img) : `/api/gallery/image?path=${encodeURIComponent(img.path)}&w=1600${img.v ? `&v=${img.v}` : ""}`} alt={img.caption ?? img.path} draggable={false} />
              )}
            </div>
          ))}
        </div>
        {images.length > 1 && !regenerating && (
          <>
            <button type="button" className="viewer-nav viewer-nav--prev" aria-label="前の画像" disabled={index <= 0} onClick={() => go(-1)}>
              <ChevronLeft size={28} aria-hidden />
            </button>
            <button type="button" className="viewer-nav viewer-nav--next" aria-label="次の画像" disabled={index >= images.length - 1} onClick={() => go(1)}>
              <ChevronRight size={28} aria-hidden />
            </button>
          </>
        )}
        {job && <RegenOverlay state={regen} />}
      </div>

      <div className="viewer-actions">
        {/* ギャラリー: プロンプトを最初から編集できる状態で出し、そのまま再生成する */}
        {onRegenerated && current.info && <RegenForm key={current.path} image={current} running={regenerating} onStarted={setJob} />}
        {regenerating && <RegenControls state={regen} />}

        {/* リリース・キューなど、再生成しない画面では、プロンプトを読むだけ */}
        {!onRegenerated && current.info && (
          <>
            {showInfo && (
              <div className="panel panel-body viewer-info">
                <p className="measured" style={{ color: "var(--color-cool)" }}>
                  {current.info.lora ?? "LoRAなし"}
                  {current.info.seed != null ? ` ／ seed ${current.info.seed}` : ""}
                </p>
                <p className="measured" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "none" }}>
                  {current.info.prompt ?? "メタデータがありません"}
                </p>
              </div>
            )}
            <Button variant="outline" aria-pressed={showInfo} onClick={() => setShowInfo((v) => !v)}>
              <Info /> プロンプトを{showInfo ? "隠す" : "見る"}
            </Button>
          </>
        )}

        {(onToggleRelease || onDelete) && (
          <div className="viewer-buttons">
            {onToggleRelease && (
              <Button
                size="lg"
                variant={current.released ? "default" : "outline"}
                className="flex-1 min-w-[9rem]"
                disabled={busy}
                aria-pressed={!!current.released}
                onClick={() => void run(onToggleRelease)}
              >
                <Star fill={current.released ? "currentColor" : "none"} />
                {current.released ? "リリース選択中" : "リリースに選ぶ"}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="destructive"
                size="icon-lg"
                aria-label="この画像を削除"
                disabled={busy || regenerating}
                onClick={() => {
                  if (window.confirm("この画像を削除します(元に戻せません)。よろしいですか？")) void run(onDelete);
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
