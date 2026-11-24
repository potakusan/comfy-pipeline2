import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, remainingSeconds, secondsPerImage } from "./eta";

describe("secondsPerImage", () => {
  it("間隔の中央値を使い、10分以上の空きは数えない", () => {
    const t0 = 1_000_000_000_000;
    const at = [0, 20, 41, 60, 80, 5000].map((s) => t0 + s * 1000); // 最後は止まっていた後の1枚
    const r = secondsPerImage(at)!;
    expect(r.sec).toBeCloseTo(20, 0);
    expect(r.samples).toBe(4);
  });
  it("実績が足りなければ null", () => {
    expect(secondsPerImage([])).toBeNull();
    expect(secondsPerImage([1000])).toBeNull();
  });
});

describe("format", () => {
  it("残り秒数は、実行中の1枚の進み具合を引く", () => {
    expect(remainingSeconds(10, 30, 0.5)).toBe(285);
    expect(remainingSeconds(0, 30, 0)).toBe(0);
  });
  it("時間の表記", () => {
    expect(formatDuration(45)).toBe("45秒");
    expect(formatDuration(600)).toBe("10分");
    expect(formatDuration(3600)).toBe("1時間");
    expect(formatDuration(5000)).toBe("1時間23分");
  });
  it("完了時刻は、日をまたぐと日付が付く", () => {
    const now = new Date(2026, 10, 24, 22, 0).getTime();
    expect(formatClock(new Date(2026, 10, 24, 23, 5).getTime(), now)).toBe("23:05");
    expect(formatClock(new Date(2026, 10, 25, 1, 30).getTime(), now)).toBe("11/25 01:30");
  });
});
