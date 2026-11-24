"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Hand, ImageDown, Pencil, Redo2, Save, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { applyMosaicToPath, computeAutoMosaicSize, mimeFromExt } from "@/lib/client/mosaic-canvas";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ReplacePanel } from "./replace-panel";

const MAX_HISTORY = 20;
const MIN_POINTS = 3;
const ZOOMS = [1, 2, 3, 4] as const;

interface Props {
  /** mosaic/ の中の画像(出力フォルダからの相対パス) */
  path: string;
  /** アルバム名(<名前>_release の <名前>) */
  album: string;
  /** この画像の元の画像(リリース用フォルダ直下)のファイル名。無ければ null(作り直しはできない) */
  sourceName: string | null;
  /** 何枚目か / 全部で何枚(モザイク処理済みの画像の中で) */
  index: number;
  total: number;
  /** 前(-1)・次(+1)の画像へ */
  onNavigate: (delta: -1 | 1) => void;
  /** 変更(保存・差し戻し)があったとき。一覧を取り直す */
  onChanged: () => void;
  /** 作り直して差し替えたとき(新しいモザイク画像のパス) */
  onReplaced: (newPath: string) => void;
  /** アルバムから外したとき */
  onRemoved: () => void;
  onClose: () => void;
}

/** アプリ内の確認(ホーム画面のアプリなどでは window.confirm が出ないことがあるため、自前で出す) */
interface Ask {
  text: string;
  actions: { label: string; danger?: boolean; run: () => void | Promise<void> }[];
}

/**
 * モザイクの手動調整。指でなぞって囲んだ範囲にモザイクをかける(投げ縄)、モザイクなしの元画像へ差し戻す、が主な操作。
 * v1 の GalleryMosaicEditor と同じく、実解像度の canvas に直接描くので、保存すると画像そのものが置き換わる。
 * 拡大中は「なぞる」と「移動」を切り替える(1本指のなぞりと画面のスクロールが衝突するため)。
 */
export function MosaicEditor({ path, album, sourceName, index, total, onNavigate, onChanged, onReplaced, onRemoved, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const natural = useRef<{ w: number; h: number } | null>(null);
  const past = useRef<ImageData[]>([]);
  const future = useRef<ImageData[]>([]);
  const points = useRef<{ x: number; y: number }[]>([]);
  const drawing = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [tool, setTool] = useState<"draw" | "move">("draw");
  const [block, setBlock] = useState(10);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** 作り直して差し替えている間は、前後への移動・閉じる・保存を止める(途中で画面が変わると、差し替えが宙に浮くため) */
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);

  const filename = path.split("/").pop() ?? path;

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    const n = natural.current;
    if (!wrap || !n) return;
    const scale = Math.min(wrap.clientWidth / n.w, wrap.clientHeight / n.h);
    setFit({ w: Math.max(1, Math.round(n.w * scale)), h: Math.max(1, Math.round(n.h * scale)) });
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recompute]);

  // 画像を実解像度で読み込む。保存・差し戻しのあとに古い画像をつかまないよう、毎回キャッシュを避ける
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !overlay || !ctx) return;
      canvas.width = overlay.width = img.naturalWidth;
      canvas.height = overlay.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      natural.current = { w: img.naturalWidth, h: img.naturalHeight };
      setBlock(computeAutoMosaicSize(Math.max(img.naturalWidth, img.naturalHeight)));
      recompute();
      setLoading(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoadError("画像を読み込めませんでした");
      setLoading(false);
    };
    img.src = `/api/gallery/image?path=${encodeURIComponent(path)}&t=${Date.now()}`;
    return () => {
      cancelled = true;
    };
  }, [path, recompute]);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    past.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (past.current.length > MAX_HISTORY) past.current.shift();
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const step = (from: React.MutableRefObject<ImageData[]>, to: React.MutableRefObject<ImageData[]>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = from.current.pop();
    if (!img) return;
    to.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(img, 0, 0);
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
    setDirty(true);
  };

  // ---- なぞる ----------------------------------------------------------------------
  const toImage = (e: React.PointerEvent) => {
    const overlay = overlayRef.current!;
    const r = overlay.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * overlay.width, y: ((e.clientY - r.top) / r.height) * overlay.height };
  };

  const drawPreview = () => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext("2d");
    if (!overlay || !ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const pts = points.current;
    if (pts.length < 2) return;
    // 画面上で約2.5px の線になるよう、画像解像度に換算する
    const r = overlay.getBoundingClientRect();
    ctx.lineWidth = Math.max(2, (2.5 * overlay.width) / r.width);
    ctx.lineJoin = "round";
    // プレビュー専用の線(画像そのものには書き込まない)。色はテーマのトークンから読む
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "orange";
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool !== "draw" || loading) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    points.current = [toImage(e)];
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    points.current.push(toImage(e));
    drawPreview();
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = points.current;
    points.current = [];
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || pts.length < MIN_POINTS) return;
    pushHistory();
    applyMosaicToPath(ctx, pts, block);
    setDirty(true);
  };

  // ---- 保存・差し戻し・閉じる ---------------------------------------------------------
  async function save(): Promise<boolean> {
    const canvas = canvasRef.current;
    if (!canvas || loading) return false;
    const mime = mimeFromExt(filename);
    if (!mime) {
      toast.error("この画像形式(gif/avif など)は手動編集の保存に対応していません");
      return false;
    }
    setSaving(true);
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, 0.95));
      if (!blob) throw new Error("画像を作れませんでした");
      const res = await fetch(`/api/mosaic/save?path=${encodeURIComponent(path)}`, { method: "POST", headers: { "Content-Type": mime }, body: blob });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "保存できませんでした");
      setDirty(false);
      onChanged();
      toast.success("保存しました");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function askRestore() {
    setAsk({
      text: "この画像のモザイクをすべてやめて、元の画像(モザイクなし)に差し戻します。手で足したモザイクも消えます。",
      actions: [{ label: "差し戻す", danger: true, run: restore }],
    });
  }

  async function restore() {
    setRestoring(true);
    try {
      const r = await api<{ path: string }>("/api/mosaic/restore", "POST", { path, scalePercent: 40, quality: 100 });
      toast.success("モザイクなしに差し戻しました");
      setDirty(false);
      onChanged();
      onReplaced(r.path); // 差し戻した画像(名前が変わることがある)を開き直す
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "差し戻せませんでした");
    } finally {
      setRestoring(false);
    }
  }

  /** 保存していない変更があるときは、保存するか破棄するかを聞いてから、前後への移動・閉じる操作を行う */
  const guard = (go: () => void) => {
    if (busy) return;
    if (!dirty) return go();
    setAsk({
      text: "保存していない変更があります。",
      actions: [
        { label: "保存して続ける", run: async () => ((await save()) ? go() : undefined) },
        { label: "破棄して続ける", danger: true, run: go },
      ],
    });
  };
  const close = () => guard(onClose);
  const navigate = (d: -1 | 1) => guard(() => onNavigate(d));

  function askRemove() {
    if (!sourceName) return;
    setAsk({
      text: "この画像をアルバムから外します(リリース用コピーとモザイク画像を消し、リリース選択も解除します)。ギャラリーの元の画像は残ります。",
      actions: [
        {
          label: "外す",
          danger: true,
          run: async () => {
            try {
              await api("/api/mosaic/remove", "POST", { folder: album, filename: sourceName });
              toast.success("アルバムから外しました");
              setDirty(false);
              onRemoved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "外せませんでした");
            }
          },
        },
      ],
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft" && !(e.target instanceof HTMLInputElement)) navigate(-1);
      if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) navigate(1);
      if ((e.ctrlKey || e.metaKey) && e.key === "z") step(past, future);
      if ((e.ctrlKey || e.metaKey) && e.key === "y") step(future, past);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const w = fit ? Math.round(fit.w * zoom) : undefined;
  const h = fit ? Math.round(fit.h * zoom) : undefined;

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="モザイクの調整">
      <header className="editor-head">
        <Button type="button" variant="ghost" size="icon" aria-label="閉じる" disabled={busy} onClick={close}>
          <X />
        </Button>
        <span style={{ flex: 1 }} />
        <Button type="button" variant="ghost" size="icon" aria-label="元に戻す" disabled={!canUndo} onClick={() => step(past, future)}>
          <Undo2 />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="やり直す" disabled={!canRedo} onClick={() => step(future, past)}>
          <Redo2 />
        </Button>
        <Button type="button" size="sm" disabled={saving || loading || !dirty || busy} onClick={() => void save()}>
          <Save /> {saving ? "保存中…" : "保存"}
        </Button>
      </header>

      <div className="editor-area" ref={wrapRef} data-tool={tool}>
        {loading && <p className="label" style={{ margin: "auto" }}>読み込み中…</p>}
        {loadError && <p role="alert" style={{ margin: "auto", color: "var(--color-bad)" }}>{loadError}</p>}
        <div className="editor-stage" style={{ width: w, height: h, visibility: loading ? "hidden" : "visible" }}>
          <canvas ref={canvasRef} aria-label="編集中の画像" />
          <canvas
            ref={overlayRef}
            aria-hidden
            className="editor-overlay"
            data-tool={tool}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
      </div>

      <div className="editor-tools">
        <p className="measured" style={{ overflowWrap: "anywhere", color: "var(--color-muted)" }}>{filename}</p>
        {ask && (
          <section className="panel panel-body" role="alertdialog" aria-label="確認" style={{ borderColor: "var(--color-accent)" }}>
            <p>{ask.text}</p>
            <div className="btn-grid">
              {ask.actions.map((a) => (
                <Button
                  key={a.label}
                  variant={a.danger ? "destructive" : "default"}
                  onClick={() => {
                    setAsk(null);
                    void a.run();
                  }}
                >
                  {a.label}
                </Button>
              ))}
              <Button variant="outline" onClick={() => setAsk(null)}>
                やめる
              </Button>
            </div>
          </section>
        )}
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="chip" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}>
            <Pencil size={16} aria-hidden style={{ marginRight: 6 }} /> なぞってモザイク
          </button>
          <button type="button" className="chip" aria-pressed={tool === "move"} onClick={() => setTool("move")}>
            <Hand size={16} aria-hidden style={{ marginRight: 6 }} /> 移動
          </button>
          <span style={{ flex: 1 }} />
          {ZOOMS.map((z) => (
            <button key={z} type="button" className="chip" aria-pressed={zoom === z} aria-label={`${z}倍に拡大`} onClick={() => setZoom(z)}>
              <span className="measured">{z}×</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <span className="label" id="blk">粗さ</span>
          <Slider aria-labelledby="blk" aria-label="モザイクの粗さ" min={2} max={60} step={1} value={[block]} onValueChange={([v]) => setBlock(v)} />
          <span className="measured" style={{ minWidth: "3.5em", textAlign: "right" }}>{block}px</span>
        </div>
        <Button type="button" variant="outline" disabled={restoring || loading || busy} onClick={askRestore}>
          <ImageDown /> {restoring ? "差し戻し中…" : "モザイクなしに差し戻す"}
        </Button>
        {sourceName && <ReplacePanel album={album} sourceName={sourceName} onBusy={setBusy} onReplaced={onReplaced} />}
        {sourceName && (
          <Button type="button" variant="destructive" disabled={busy} onClick={askRemove}>
            <Trash2 /> アルバムから外す
          </Button>
        )}
        <p className="label" style={{ fontSize: "var(--text-xs)" }}>
          モザイクをかけたい範囲を、指でぐるっと囲んでください。拡大したまま動かすときは「移動」に切り替えます。
        </p>
        {/* 画像送り: サイドバー(スマホでは操作パネル)の一番下に固定する。全件を目視で確認するときに、親指の位置で次々に送れるように */}
        <nav className="editor-nav" aria-label="画像送り">
          <Button type="button" variant="outline" size="lg" aria-label="前の画像" disabled={busy || index <= 0} onClick={() => navigate(-1)}>
            <ChevronLeft /> 前へ
          </Button>
          <span className="measured" style={{ textAlign: "center", minWidth: "4.5em" }} aria-live="polite">
            {index + 1} / {total}
          </span>
          <Button type="button" variant="outline" size="lg" aria-label="次の画像" disabled={busy || index >= total - 1} onClick={() => navigate(1)}>
            次へ <ChevronRight />
          </Button>
        </nav>
      </div>
    </div>
  );
}
