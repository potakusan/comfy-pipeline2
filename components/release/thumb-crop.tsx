"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/use-poll";
import { fitRect, moveRect, resizeFromCorner, type Corner, type Rect } from "@/lib/comfy/crop";
import { Button } from "@/components/ui/button";

export interface CropSource {
  key: string; // "グループ/ファイル名"
  url: string;
  label: string;
}

const RATIOS: { id: string; label: string; ar: number | null }[] = [
  { id: "free", label: "自由", ar: null },
  { id: "1:1", label: "正方形", ar: 1 },
  { id: "3:4", label: "3:4", ar: 3 / 4 },
  { id: "4:3", label: "4:3", ar: 4 / 3 },
];

type Drag = { mode: "move" | Corner; start: Rect; px: number; py: number };
const OPPOSITE: Record<Corner, { fx: 0 | 1; fy: 0 | 1 }> = { nw: { fx: 1, fy: 1 }, ne: { fx: 0, fy: 1 }, sw: { fx: 1, fy: 0 }, se: { fx: 0, fy: 0 } };

/**
 * Pixiv のサムネイル(0.jpg)用の切り抜き。Pixiv は正方形でサムネを作るので、余白を切って見栄えよくする。
 * 枠は自由な縦横比(元の縦横比のままでもよい)。ドラッグで動かし、四隅で大きさを変える。
 */
export function ThumbCrop({ month, work, sources, onClose, onSaved }: { month: string; work: string; sources: CropSource[]; onClose: () => void; onSaved: () => void }) {
  const [srcIndex, setSrcIndex] = useState(0);
  const [ratio, setRatio] = useState("free");
  const [rect, setRect] = useState<Rect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [imgRatio, setImgRatio] = useState(0.6);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const src = sources[srcIndex];

  // Pixiv は正方形でサムネイルを作る: 切り抜いた画像の中央から、1辺が(切り抜き後の)横幅の正方形が使われる。それを右に見せる
  // (横が縦より長い切り抜きのときは、収まる最大の正方形)
  useEffect(() => {
    const c = preview.current;
    if (!c || !imgEl || !imgEl.naturalWidth) return;
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    const cw = rect.w * nw;
    const ch = rect.h * nh;
    const side = Math.max(1, Math.min(cw, ch));
    c.width = 240;
    c.height = 240;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 240, 240);
    ctx.drawImage(imgEl, rect.x * nw + (cw - side) / 2, rect.y * nh + (ch - side) / 2, side, side, 0, 0, 240, 240);
  }, [rect, imgEl, srcIndex]);
  const ar = RATIOS.find((r) => r.id === ratio)?.ar ?? null;

  const norm = (e: React.PointerEvent) => {
    const b = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  const down = (mode: Drag["mode"], e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = norm(e);
    drag.current = { mode, start: rect, px: p.x, py: p.y };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = norm(e);
    if (d.mode === "move") setRect(moveRect(d.start, p.x - d.px, p.y - d.py));
    else {
      const o = OPPOSITE[d.mode];
      setRect(resizeFromCorner({ x: d.start.x + d.start.w * o.fx, y: d.start.y + d.start.h * o.fy }, p, ar, imgRatio));
    }
  };
  const up = () => {
    drag.current = null;
  };

  const choose = (i: number) => {
    setSrcIndex(i);
    setRect(fitRect(ar, imgRatio));
  };
  const chooseRatio = (id: string) => {
    setRatio(id);
    setRect(fitRect(RATIOS.find((r) => r.id === id)?.ar ?? null, imgRatio));
  };

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ width: number; height: number }>("/api/release/thumb", "POST", { month, top: work, path: src.key, crop: rect });
      toast.success(`サムネイル 0.jpg を保存しました(${r.width}×${r.height})`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  const handle = (c: Corner) => {
    const pos: React.CSSProperties = { [c.startsWith("n") ? "top" : "bottom"]: -14, [c.endsWith("w") ? "left" : "right"]: -14 };
    return (
      <span
        key={c}
        data-corner={c}
        onPointerDown={(e) => down(c, e)}
        style={{ position: "absolute", width: 28, height: 28, borderRadius: 999, background: "var(--color-paper)", border: "2px solid var(--color-ink)", touchAction: "none", cursor: `${c}-resize`, ...pos }}
      />
    );
  };

  return (
    <div className="editor" role="dialog" aria-label="サムネイルを切り抜く" style={{ zIndex: 500 }}>
      <div className="editor-head">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="閉じる">
          <X />
        </Button>
        <strong style={{ flex: 1 }}>サムネイル(0.jpg)を切り抜く</strong>
        <Button onClick={() => void save()} disabled={saving}>
          <Check /> 保存
        </Button>
      </div>
      <div className="editor-area" style={{ touchAction: "none" }}>
        <div ref={stage} className="crop-stage" style={{ position: "relative", maxWidth: "100%", lineHeight: 0, userSelect: "none", margin: 14 }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src.key}
            src={src.url}
            alt={src.label}
            draggable={false}
            onLoad={(e) => {
              const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
              setImgRatio(r);
              setImgEl(e.currentTarget);
              setRect(fitRect(ar, r));
            }}
            style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100dvh - 16rem)" }}
          />
          {/* 枠の外を暗くする: 大きな影で枠の外側だけを覆う */}
          <div
            className="crop-rect"
            onPointerDown={(e) => down("move", e)}
            style={{
              position: "absolute",
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              outline: "2px solid #fff",
              touchAction: "none",
              cursor: "move",
            }}
          >
            {/* Pixiv が正方形のサムネイルに使う範囲(右のプレビューと同じ) */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                aspectRatio: "1 / 1",
                ...(rect.w * imgRatio <= rect.h ? { width: "100%" } : { height: "100%" }),
                border: "1px dashed #fff",
                pointerEvents: "none",
              }}
            />
            {(["nw", "ne", "sw", "se"] as Corner[]).map(handle)}
          </div>
        </div>
      </div>
      <div className="editor-tools" style={{ display: "grid", gap: "var(--space-xs)", padding: "var(--space-sm)" }}>
        <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
          <span className="label">Pixiv のサムネイル(正方形)</span>
          <canvas ref={preview} aria-label="Pixiv サムネイルのプレビュー" style={{ width: "min(100%, 11rem)", aspectRatio: "1 / 1", border: "var(--rule-hair) solid var(--color-rule)", background: "#fff" }} />
          <span className="label" style={{ fontSize: "var(--text-xs)" }}>切り抜いた範囲の中央、1辺が横幅の正方形で表示されます</span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
          <span className="label">枠の形</span>
          {RATIOS.map((r) => (
            <button key={r.id} type="button" className="chip" aria-pressed={ratio === r.id} onClick={() => chooseRatio(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", overflowX: "auto", paddingBottom: 4 }} aria-label="切り抜く画像を選ぶ">
          {sources.map((s, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={s.key} src={s.url} alt={s.label} onClick={() => choose(i)} style={{ height: 56, flex: "none", borderRadius: 4, outline: i === srcIndex ? "3px solid var(--color-ink)" : "1px solid var(--color-rule)", cursor: "pointer" }} />
          ))}
        </div>
        <p className="label" style={{ fontSize: "var(--text-xs)" }}>
          枠をドラッグで移動、四隅で大きさを変えます。Pixiv のサムネイルは正方形に切り出されるので、余白を切って見せたい部分を入れてください。
        </p>
      </div>
    </div>
  );
}
