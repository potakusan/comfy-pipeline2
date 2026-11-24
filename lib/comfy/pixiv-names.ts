/**
 * Pixiv 用ファイルを保存するときの名前。
 *  サムネイル 0.jpg → 00_{フォルダ名}.jpg
 *  サンプル  NN_{グループ}_{元の番号}.jpg → NN_{フォルダ名}_{グループ}.jpg (連番はグループをまたいで続く)
 *  告知タイル NN_booth.jpg → NN_{フォルダ名}_booth.jpg (サンプルの続きの番号)
 * files は表示順(サンプルは出力時の並び順)のまま渡す。
 */
export function pixivSaveNames(work: string, files: { name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const pad = (n: number) => String(n).padStart(2, "0");
  let seq = 0;
  const thumb = files.find((f) => f.name.toLowerCase() === "0.jpg");
  if (thumb) out.set(thumb.name, `00_${work}.jpg`);
  const booth = files.find((f) => /_booth\.jpe?g$/i.test(f.name));
  for (const f of files) {
    if (f === thumb || f === booth) continue;
    const m = /^\d+_(.+)_[^_]+(\.[A-Za-z0-9]+)$/.exec(f.name);
    seq++;
    out.set(f.name, m ? `${pad(seq)}_${work}_${m[1]}${m[2]}` : `${pad(seq)}_${work}_${f.name}`);
  }
  if (booth) out.set(booth.name, `${pad(seq + 1)}_${work}_booth.jpg`);
  return out;
}

/** Booth に追記する一行: 「MM/DD タイトル_{n}枚」。作品フォルダ名は YYYYMMDD_タイトル。 */
export function boothLine(work: string, count: number): string {
  const m = /^\d{4}(\d{2})(\d{2})_(.*)$/.exec(work);
  return m ? `${m[1]}/${m[2]} ${m[3]}_${count}枚` : `${work}_${count}枚`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Pixiv のキャプション。作品フォルダ名(YYYYMMDD_…)の月と、サブフォルダの画像の合計枚数から作る。 */
export function pixivCaption(work: string, count: number): string {
  const mm = Number(/^\d{4}(\d{2})\d{2}_/.exec(work)?.[1]);
  const month = mm >= 1 && mm <= 12 ? mm : null;
  const booth = month ? `Booth${month}月まとめに同梱 Included in the ${MONTHS[month - 1]} Compilation on BOOTH!` : "Booth月まとめに同梱 Included in the monthly Compilation on BOOTH!";
  return `Total: ${count} images / ${booth}
(プロフにリンクあり / Link available on profile page)`;
}
