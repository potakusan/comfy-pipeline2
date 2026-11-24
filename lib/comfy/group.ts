/**
 * 画像ファイル名から「プリセット名単位」のグループ名を取り出す。v1 の getPoseGroup と同じ規則:
 * ComfyUI が付ける連番(_00001_)と、再生成の _rev_NNNN を剥がし、同じプリセットの画像が同じ名前になるようにする。
 */
export function getPoseGroup(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  // 再生成をさらに再生成すると "_rev_0001_rev_0002" のように連なるので、末尾から繰り返し剥がす
  const withoutRev = stem.replace(/(?:_rev_\d+)+$/, "");
  const withoutCounter = withoutRev.replace(/_\d{5}_?$/, "");
  return (withoutCounter || withoutRev || stem).replace(/_+$/, "") || stem;
}
