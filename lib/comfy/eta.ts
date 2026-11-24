/**
 * 残り時間の見積もり。完成した画像の時刻(recent の at)の間隔から、1枚あたりの秒数を出す。
 * 間隔の中央値を使い(外れ値に強い)、止まっていた時間(10分以上の空き)は数えない。
 */
export function secondsPerImage(completedAt: number[], maxGapSec = 600): { sec: number; samples: number } | null {
  const times = [...completedAt].sort((a, b) => b - a).slice(0, 31);
  const gaps: number[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const g = (times[i] - times[i + 1]) / 1000;
    if (g > 0.5 && g < maxGapSec) gaps.push(g);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return { sec: gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2, samples: gaps.length };
}

/**
 * 1枚あたりの秒数を、ComfyUI が実際に生成にかけた時間(ミリ秒)から出す。新しい順に最大20枚の中央値。
 * 完成を確定した時刻の間隔と違い、画面を閉じていてまとめて確定されたときにも狂わない。3枚未満なら null。
 */
export function secondsFromDurations(durationsMs: number[]): { sec: number; samples: number } | null {
  const v = durationsMs.filter((m) => m > 200 && m < 3_600_000).slice(0, 20).map((m) => m / 1000).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const mid = v.length >> 1;
  return { sec: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, samples: v.length };
}

/** 残り枚数から、残り秒数。実行中の1枚は、進み具合(0〜1)の分だけ減らす。 */
export function remainingSeconds(images: number, secPerImage: number, runningProgress = 0): number {
  return Math.max(0, images - Math.min(1, Math.max(0, runningProgress))) * secPerImage;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}時間` : `${h}時間${rest}分`;
}

/** 完了予定の時刻。日をまたぐときは日付も付ける。 */
export function formatClock(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
