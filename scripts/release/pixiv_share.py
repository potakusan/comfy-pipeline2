# folder-to-pdf スキルのコピー。差分: 設定の場所を環境変数で変えられる / --pick で投稿用の画像を手で選べる。
"""Pixiv投稿用に、作品フォルダから投稿用の画像(--pick で好きな枚数。省略時はランダムに9枚)と、Booth告知タイル(別の9枚)を作る。

    python pixiv_share.py "X:\\202611\\20261119_カズサ（ミレニアムチア）"

- 元: <作品フォルダ>\\<グループ>\\NN.jpg(リリース用コピー済みのモザイク画像)
- 出力: <out>\\<作品フォルダ名>_pixiv\\ (既定の out は <作品フォルダの親>_PDF)
  - 01〜09: 選んだ9枚をそのままコピー
  - 10_booth.jpg: 別の9枚を3x3に並べて薄くモザイクをかけ、上帯・下帯を付けた告知画像
- 同じプリセットからは1グループにつき1枚まで。プリセットはリリース用コピーが
  ギャラリーのmosaic画像とバイト一致することを利用して、元のファイル名から逆引きする。
"""

import argparse
import hashlib
import json
import random
import re
import shutil
import statistics
import sys
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFont

BOOTH_URL = "https://otuzbirci.booth.pm/"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
FONT_REGULAR = r"C:\Windows\Fonts\meiryo.ttc"
FONT_BOLD = r"C:\Windows\Fonts\meiryob.ttc"
COUNT = 9
UNKNOWN_PREFIX = "unknown:"
UNKNOWN_PICKS = 3  # プリセットを逆引きできないグループ(前戯側など)から抜く枚数
MIN_GAP = 5  # その間に挟む最小枚数
THUMB_NAME = "0.jpg"  # 手で切り抜いたサムネイル(画面から作る)。セットの作り直しでは触らない


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def preset_key_from_gallery_name(name: str) -> str:
    """`<プリセット名>_00003__mosaic.jpg` / `_00008__rev__mosaic.jpg` -> `<プリセット名>`"""
    stem = Path(name).stem.removesuffix("_mosaic")
    return re.sub(r"_\d{5}(?:_.*)?$", "", stem)


# comfy-pipeline の設定(outputDir)の場所。環境変数 COMFY_PIPELINE_DIR で変えられる。--gallery を渡せば参照しない。
import os

COMFY_CONFIG = Path(os.environ.get("COMFY_PIPELINE_DIR", r"D:\GitHub\comfy-pipeline")) / ".comfy-pipeline.json"


def load_output_dir() -> Path | None:
    """comfy-pipelineの設定(outputDir)を読み取り専用で参照する。"""
    try:
        return Path(json.loads(COMFY_CONFIG.read_text(encoding="utf-8"))["outputDir"])
    except (OSError, KeyError, ValueError):
        return None


def index_gallery(output_dir: Path, sizes: set[int]) -> dict[int, list[Path]]:
    """サイズが一致しうるギャラリーのmosaic画像だけを、サイズ別に集める。"""
    by_size: dict[int, list[Path]] = {}
    for p in output_dir.glob("*/mosaic/*"):
        if p.suffix.lower() in IMG_EXT:
            size = p.stat().st_size
            if size in sizes:
                by_size.setdefault(size, []).append(p)
    return by_size


def collect_images(work_dir: Path) -> list[tuple[str, Path]]:
    """(グループ名, 画像パス) を自然順で返す。"""
    out: list[tuple[str, Path]] = []
    for group in sorted(p for p in work_dir.iterdir() if p.is_dir() and not p.name.lower().startswith("pixiv")):
        files = [f for f in group.iterdir() if f.suffix.lower() in IMG_EXT]
        files.sort(key=lambda f: (len(f.stem), f.stem))
        out.extend((group.name, f) for f in files)
    return out


def resolve_presets(images, output_dir: Path | None) -> tuple[dict[Path, str], int]:
    """画像ごとのプリセット名を返す。逆引きできない画像は「グループ単位で1プリセット」扱い。"""
    keys: dict[Path, str] = {}
    unmatched = 0
    by_size: dict[int, list[Path]] = {}
    if output_dir and output_dir.exists():
        by_size = index_gallery(output_dir, {p.stat().st_size for _, p in images})
    hash_cache: dict[Path, str] = {}
    for group, path in images:
        found = None
        cands = by_size.get(path.stat().st_size, [])
        if cands:
            digest = md5(path)
            for c in cands:
                if hash_cache.setdefault(c, md5(c)) == digest:
                    found = preset_key_from_gallery_name(c.name)
                    break
        if found is None:
            unmatched += 1
            found = f"unknown:{group}"
        keys[path] = found
    return keys, unmatched


def pick_spaced(
    groups: dict[str, list[Path]], used: dict[str, set[int]], n: int, rng: random.Random
) -> list[Path]:
    """プリセット不明グループから、番号順で互いに MIN_GAP 枚以上離れた画像を最大n枚選ぶ。
    リリース用コピーは元ファイル名順(=同じプリセットが隣り合う)なので、離すことで別プリセットに寄せる。"""
    out: list[Path] = []
    keys = list(groups)
    rng.shuffle(keys)
    for k in keys:
        files, taken = groups[k], used[k]
        order = list(range(len(files)))
        rng.shuffle(order)
        for i in order:
            if len(out) >= n:
                return out
            if all(abs(i - j) > MIN_GAP for j in taken):
                taken.add(i)
                out.append(files[i])
    return out


def pick_distinct(
    pool: dict[str, list[Path]], n: int, rng: random.Random
) -> list[Path]:
    """プリセットをランダムな順に見て、各プリセットから1枚ずつ最大n枚を選ぶ。"""
    presets = [k for k, v in pool.items() if v]
    rng.shuffle(presets)
    return [rng.choice(pool[k]) for k in presets[:n]]


def pixelate(img: Image.Image, block: int) -> Image.Image:
    w, h = img.size
    small = img.resize((max(1, w // block), max(1, h // block)), Image.BILINEAR)
    return small.resize((w, h), Image.NEAREST)


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (resized.width - tw) // 2
    top = (resized.height - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def draw_centered(draw, text, font, cx, y, fill="black"):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def qr_image(text: str, size: int) -> Image.Image:
    """QRコードを size 四方の白黒画像にする(余白は呼び出し側で確保する)。"""
    matrix = segno.make(text, error="m").matrix
    n = len(matrix)
    img = Image.new("1", (n, n), 1)
    for y, row in enumerate(matrix):
        for x, bit in enumerate(row):
            if bit:
                img.putpixel((x, y), 0)
    return img.convert("RGB").resize((size, size), Image.NEAREST)


def make_booth_image(
    paths: list[Path], total: int, ym: str, tile_w: int, block: int
) -> Image.Image:
    tiles_src = [Image.open(p).convert("RGB") for p in paths]
    ratio = statistics.median(i.height / i.width for i in tiles_src)
    tile = (tile_w, round(tile_w * ratio))
    cols = 3
    rows = -(-len(tiles_src) // cols)
    width = tile[0] * cols

    top_h = round(width * 0.2)
    bottom_h = round(width * 0.24)
    canvas = Image.new("RGB", (width, top_h + tile[1] * rows + bottom_h), "white")
    for i, src in enumerate(tiles_src):
        t = cover(src, tile)
        if block > 1:
            t = pixelate(t, block)
        canvas.paste(t, ((i % cols) * tile[0], top_h + (i // cols) * tile[1]))

    draw = ImageDraw.Draw(canvas)
    big = ImageFont.truetype(FONT_BOLD, round(top_h * 0.38), index=0)
    mid = ImageFont.truetype(FONT_BOLD, round(top_h * 0.30), index=0)
    draw_centered(draw, "More on Booth", big, width / 2, round(top_h * 0.10))
    draw_centered(draw, f"合計 {total} 枚", mid, width / 2, round(top_h * 0.54))

    by = top_h + tile[1] * rows
    qr_size = round(bottom_h * 0.72)
    qr = qr_image(BOOTH_URL, qr_size)
    pad = round((bottom_h - qr_size) / 2)
    canvas.paste(qr, (pad, by + pad))

    text_x = pad * 2 + qr_size
    url_text = f"Booth: {BOOTH_URL}"
    avail = width - text_x - pad
    url_size = round(bottom_h * 0.17)
    url_font = ImageFont.truetype(FONT_BOLD, url_size, index=0)
    while draw.textlength(url_text, font=url_font) > avail and url_size > 10:
        url_size -= 2
        url_font = ImageFont.truetype(FONT_BOLD, url_size, index=0)
    sub_font = ImageFont.truetype(FONT_REGULAR, round(bottom_h * 0.15), index=0)
    draw.text((text_x, by + round(bottom_h * 0.24)), url_text, font=url_font, fill="black")
    draw.text((text_x, by + round(bottom_h * 0.56)), f"収録先： {ym} 作品まとめ", font=sub_font, fill="black")
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("work_dir", type=Path, help="作品フォルダ(直下にグループフォルダ)")
    ap.add_argument("--out", type=Path, help="出力先(既定: <作品フォルダの親>_PDF)")
    ap.add_argument("--gallery", type=Path, help="ギャラリー出力フォルダ(既定: comfy-pipelineの設定の outputDir)")
    ap.add_argument("--seed", type=int, help="乱数シード(再現用)")
    ap.add_argument("--tile-width", type=int, default=600)
    ap.add_argument("--mosaic-block", type=int, default=0, help="告知画像に追加でかけるモザイクのブロック(px)。0=かけない。小さいほど薄い")
    ap.add_argument(
        "--pick",
        action="append",
        default=[],
        metavar="グループ/ファイル名",
        help="投稿用に使う画像を手で指定する(複数指定可。例: 前戯/03.jpg)。告知画像用の9枚は、残りから自動で選ぶ",
    )
    ap.add_argument(
        "--adopt",
        action="store_true",
        help="既にある出力フォルダの画像(手で差し替えたもの)をmd5で元画像に結び付け、前戯→本番・番号昇順に並べ直す。告知画像が無ければ残りから作る",
    )
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    work_dir = args.work_dir
    if not work_dir.is_dir():
        print(f"作品フォルダが見つかりません: {work_dir}", file=sys.stderr)
        return 1
    m = re.match(r"(\d{4})(\d{2})\d{2}_", work_dir.name)
    if not m:
        print("フォルダ名が YYYYMMDD_ で始まっていません", file=sys.stderr)
        return 1
    ym = f"{m.group(1)}/{m.group(2)}"
    out_root = args.out or work_dir.parent.with_name(work_dir.parent.name + "_PDF")
    out_dir = out_root / f"{work_dir.name}_pixiv"
    if args.adopt and not out_dir.is_dir():
        print(f"--adopt の対象フォルダがありません: {out_dir}", file=sys.stderr)
        return 1
    if not args.adopt and out_dir.exists() and any(f.name != THUMB_NAME for f in out_dir.iterdir()):
        print(f"出力先が既にあります(上書きしません): {out_dir}", file=sys.stderr)
        return 1

    images = collect_images(work_dir)
    if not images:
        print("画像がありません", file=sys.stderr)
        return 1
    gallery = args.gallery or load_output_dir()
    keys, unmatched = resolve_presets(images, gallery)
    if unmatched:
        print(f"プリセットを逆引きできなかった画像: {unmatched}/{len(images)} (グループ単位で1プリセット扱い)")

    rng = random.Random(args.seed)
    group_of = {p: g for g, p in images}
    pool: dict[str, list[Path]] = {}
    for _, p in images:
        pool.setdefault(keys[p], []).append(p)
    print(f"画像 {len(images)} 枚 / プリセット {len(pool)} 種")

    known = {k: v for k, v in pool.items() if not k.startswith(UNKNOWN_PREFIX)}
    unknown = {k: v for k, v in pool.items() if k.startswith(UNKNOWN_PREFIX)}
    used_idx: dict[str, set[int]] = {k: set() for k in unknown}

    def select() -> list[Path]:
        """プリセット不明のグループから UNKNOWN_PICKS 枚(互いに MIN_GAP 枚以上離す)+ 残りは既知プリセットから。"""
        got = pick_spaced(unknown, used_idx, UNKNOWN_PICKS, rng)
        got += pick_distinct(known, COUNT - len(got), rng)
        rng.shuffle(got)
        for p in got:
            if p in known.get(keys[p], []):
                known[keys[p]].remove(p)
        return got

    order = {p: i for i, (_, p) in enumerate(images)}  # グループ順(前戯→本番)→番号順
    has_booth = False
    if args.adopt:
        by_md5 = {md5(p): p for _, p in images}
        picked = []
        existing_files: dict[Path, Path] = {}
        for f in sorted(out_dir.iterdir()):
            if f.name == THUMB_NAME:
                continue
            if f.name.endswith("_booth.jpg"):
                has_booth = True
                continue
            src = by_md5.get(md5(f))
            if src is None:
                print(f"元画像と一致しないファイルがあります: {f.name}", file=sys.stderr)
                return 1
            picked.append(src)
            existing_files[src] = f
        picked.sort(key=order.__getitem__)
        for p in picked:  # 告知タイルは、差し替え済みの画像を除いた残りから(前戯側は間隔も保つ)
            k = keys[p]
            if k in unknown:
                used_idx[k].add(unknown[k].index(p))
            elif p in known.get(k, []):
                known[k].remove(p)
        teaser = [] if has_booth else select()
    elif args.pick:
        by_name = {f"{g}/{p.name}": p for g, p in images}
        picked = []
        for spec in args.pick:
            key = spec.replace("\\", "/")
            if key not in by_name:
                print(f"--pick の画像が見つかりません: {spec}", file=sys.stderr)
                return 1
            if by_name[key] not in picked:
                picked.append(by_name[key])
        # 指定された順(画面でドラッグして並べた順)のまま、01,02,… にする
        for p in picked:  # 手で選んだ画像は、告知タイルの候補から外す(前戯側は間隔も保つ)
            k = keys[p]
            if k in unknown:
                used_idx[k].add(unknown[k].index(p))
            elif p in known.get(k, []):
                known[k].remove(p)
        teaser = select()
    else:
        picked = select()
        picked.sort(key=order.__getitem__)
        teaser = select()
    for label, got in (("投稿用", picked), ("告知用", teaser)):
        if len(got) < COUNT and not ((args.adopt or args.pick) and label == "投稿用"):
            print(f"警告: {label}は{len(got)}枚しか選べませんでした(プリセット不足)")
    if not teaser and not has_booth:
        print("告知画像に使える画像がありません", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    if args.adopt:  # 一時名を経由して、並べ直しで名前が衝突しないようにする
        tmp = {p: f.with_name(f".tmp_{i}") for i, (p, f) in enumerate(existing_files.items())}
        for p, f in existing_files.items():
            f.rename(tmp[p])
        for i, p in enumerate(picked, 1):
            tmp[p].rename(out_dir / f"{i:02d}_{group_of[p]}_{p.name}")
    else:
        for i, p in enumerate(picked, 1):
            shutil.copy2(p, out_dir / f"{i:02d}_{group_of[p]}_{p.name}")
    booth_name = None
    if teaser:
        booth = make_booth_image(teaser, len(images), ym, args.tile_width, args.mosaic_block)
        booth_name = f"{len(picked) + 1:02d}_booth.jpg"
        booth.save(out_dir / booth_name, quality=92)

    print(f"出力: {out_dir}")
    for i, p in enumerate(picked, 1):
        print(f"  {i:02d} {keys[p]}  ({group_of[p]}/{p.name})")
    if booth_name:
        print(f"  告知画像 {booth_name}: {booth.size[0]}x{booth.size[1]}")
        for p in teaser:
            print(f"    {keys[p]}  ({group_of[p]}/{p.name})")
    else:
        print("  告知画像は既にあるため作り直していません")
    return 0


if __name__ == "__main__":
    sys.exit(main())
