/** 画像の切り抜き枠(0〜1の割合)の計算。画面の操作(ドラッグ)から使う純粋関数。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Corner = "nw" | "ne" | "sw" | "se";

export const MIN_SIZE = 0.05;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 枠を動かす(画像の外へは出さない) */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
}

/**
 * 角をドラッグして大きさを変える。反対側の角(fixed)は動かさない。
 * ar: 縦横比(幅/高さ、ピクセル)を固定するとき。null で自由。imgRatio: 画像の 幅/高さ。
 */
export function resizeFromCorner(fixed: { x: number; y: number }, pt: { x: number; y: number }, ar: number | null, imgRatio: number): Rect {
  const px = clamp(pt.x, 0, 1);
  const py = clamp(pt.y, 0, 1);
  const sx = px >= fixed.x ? 1 : -1;
  const sy = py >= fixed.y ? 1 : -1;
  const availW = sx > 0 ? 1 - fixed.x : fixed.x;
  const availH = sy > 0 ? 1 - fixed.y : fixed.y;
  let w = Math.abs(px - fixed.x);
  let h = Math.abs(py - fixed.y);
  if (ar) {
    h = (w * imgRatio) / ar;
    if (h > availH) {
      h = availH;
      w = (h * ar) / imgRatio;
    }
  }
  w = Math.max(w, MIN_SIZE);
  h = Math.max(h, MIN_SIZE);
  return { x: sx > 0 ? fixed.x : fixed.x - w, y: sy > 0 ? fixed.y : fixed.y - h, w: Math.min(w, availW), h: Math.min(h, availH) };
}

/** 縦横比を固定したときの、画像の中央いっぱいの枠 */
export function fitRect(ar: number | null, imgRatio: number): Rect {
  if (!ar) return { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  let w = 0.9;
  let h = (w * imgRatio) / ar;
  if (h > 0.9) {
    h = 0.9;
    w = (h * ar) / imgRatio;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** 割合の枠 → ピクセルの切り抜き範囲(画像の内側に収める) */
export function toPixels(r: Rect, width: number, height: number) {
  const left = clamp(Math.round(r.x * width), 0, width - 1);
  const top = clamp(Math.round(r.y * height), 0, height - 1);
  return { left, top, width: clamp(Math.round(r.w * width), 1, width - left), height: clamp(Math.round(r.h * height), 1, height - top) };
}
