import { describe, expect, it } from "vitest";
import { fitRect, moveRect, resizeFromCorner, toPixels } from "./crop";

describe("crop", () => {
  it("枠は画像の外へ出ない", () => {
    expect(moveRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.9, -2)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
  });
  it("縦横比を固定して角を引くと、その比率を保つ(正方形)", () => {
    const imgRatio = 960 / 1600;
    const r = resizeFromCorner({ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.2 }, 1, imgRatio);
    expect((r.w * 960) / (r.h * 1600)).toBeCloseTo(1, 5);
    expect(r.x).toBeCloseTo(0.1);
  });
  it("固定比率で下にはみ出すときは、高さに合わせて縮める", () => {
    const r = resizeFromCorner({ x: 0, y: 0.8 }, { x: 1, y: 1 }, 1, 0.6);
    expect(r.y + r.h).toBeLessThanOrEqual(1.0000001);
    expect((r.w * 0.6) / r.h).toBeCloseTo(1, 5);
  });
  it("反対側へ引き越しても反転して扱える", () => {
    const r = resizeFromCorner({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }, null, 1);
    expect(r).toMatchObject({ x: 0.2, y: 0.3 });
    expect(r.w).toBeCloseTo(0.3);
    expect(r.h).toBeCloseTo(0.2);
  });
  it("初期枠と、ピクセル変換", () => {
    const r = fitRect(1, 960 / 1600);
    expect((r.w * 960) / (r.h * 1600)).toBeCloseTo(1, 5);
    expect(toPixels({ x: 0, y: 0, w: 1, h: 1 }, 100, 50)).toEqual({ left: 0, top: 0, width: 100, height: 50 });
  });
});
