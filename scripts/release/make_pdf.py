# folder-to-pdf スキル(~/.claude/skills/folder-to-pdf/scripts)のコピー。アプリのリリースタブから呼ぶ。スキル側を直したらここも合わせる。
"""Shrink images and bundle them into PDFs, one PDF per leaf subfolder.

Layout: ROOT/<top>/<sub>/*.jpg|png  ->  OUT/<top>_<sub>.pdf
Subfolders whose PDF already exists in OUT are skipped (unless --force).
Oversized output is split into <top>_<sub>_<i>of<n>.pdf.
"""
import argparse, glob, io, math, os, re, subprocess, sys, zipfile
from PIL import Image

DPI = 150


def natkey(s):
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', s)]


def encode(path, long_edge, quality):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    s = long_edge / max(w, h)
    if s < 1:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True)
    return buf.getvalue(), im.size


def write_pdf(path, pages):
    out = io.BytesIO()
    offs = []

    def obj(b):
        offs.append(out.tell())
        out.write(b)

    out.write(b'%PDF-1.4\n')
    n = len(pages)
    obj(b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    kids = ' '.join(f'{3 + i * 3} 0 R' for i in range(n))
    obj(f'2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {n} >>\nendobj\n'.encode())
    for i, (data, (w, h)) in enumerate(pages):
        pid, cid, iid = 3 + i * 3, 4 + i * 3, 5 + i * 3
        pw, ph = w * 72 / DPI, h * 72 / DPI
        obj(f'{pid} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.2f} {ph:.2f}] /Resources << /XObject << /Im0 {iid} 0 R >> >> /Contents {cid} 0 R >>\nendobj\n'.encode())
        content = f'q {pw:.2f} 0 0 {ph:.2f} 0 0 cm /Im0 Do Q'.encode()
        obj(f'{cid} 0 obj\n<< /Length {len(content)} >>\nstream\n'.encode() + content + b'\nendstream\nendobj\n')
        obj(f'{iid} 0 obj\n<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(data)} >>\nstream\n'.encode() + data + b'\nendstream\nendobj\n')
    xref = out.tell()
    total = len(offs) + 1
    out.write(f'xref\n0 {total}\n0000000000 65535 f \n'.encode())
    for o in offs:
        out.write(f'{o:010d} 00000 n \n'.encode())
    out.write(f'trailer\n<< /Size {total} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    with open(path, 'wb') as f:
        f.write(out.getvalue())
    return out.tell()


def collect(sp):
    return [os.path.join(sp, f) for f in sorted(os.listdir(sp), key=natkey)
            if re.search(r'\.(jpe?g|png)$', f, re.I)]


def split(pages, target):
    total = sum(len(d) for d, _ in pages)
    parts = max(1, math.ceil(total / target))
    per = total / parts
    groups, cur, acc = [], [], 0
    for p in pages:
        if cur and acc >= per and len(groups) < parts - 1:
            groups.append(cur)
            cur, acc = [], 0
        cur.append(p)
        acc += len(p[0])
    groups.append(cur)
    return groups


def already_done(out_dir, base):
    if os.path.exists(os.path.join(out_dir, base + '.pdf')):
        return True
    return bool(glob.glob(os.path.join(glob.escape(out_dir), glob.escape(base) + '_*of*.pdf')))


def zip_name(tops):
    """'20261104_01_A(x)' + '20261104_02_B' -> '20261104_A（x）・B.zip'"""
    date, titles = None, []
    for t in tops:
        m = re.match(r'^(\d{8})_(?:\d+_)?(.+)$', t)
        date = date or (m.group(1) if m else '')
        titles.append((m.group(2) if m else t).replace('(', '（').replace(')', '）'))
    return f'{date}_{"・".join(titles)}.zip' if date else f'{"・".join(titles)}.zip'


def make_zips(root, out_dir, tops, dry):
    """Zip the source folders (JPGs as-is, top folder names kept), one ZIP per date prefix."""
    groups = {}
    for t in tops:
        groups.setdefault(t[:8], []).append(t)
    for _, ts in groups.items():
        files = []
        for t in ts:
            for dp, dns, fns in os.walk(os.path.join(root, t)):
                dns[:] = sorted((d for d in dns if not d.lower().startswith('pixiv')), key=natkey)
                files += [os.path.join(dp, f) for f in sorted(fns, key=natkey)]
        if not files:
            continue
        zp = os.path.join(out_dir, zip_name(ts))
        if dry:
            print(f'zip   {os.path.basename(zp)} ({len(files)} files)')
            continue
        with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as z:  # JPGは圧縮済みなので無圧縮で格納
            for f in files:
                z.write(f, os.path.relpath(f, root))
        print(f'zip   {os.path.basename(zp)}: {len(files)} files {os.path.getsize(zp) / 1e6:.1f}MB', flush=True)


def make_pixiv(root, out_dir, tops, dry):
    """上位フォルダごとに Pixiv投稿用9枚 + Booth告知画像を <out>/<top>_pixiv/ へ作る(既存ならスキップ)。"""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pixiv_share.py')
    for t in tops:
        dest = os.path.join(out_dir, f'{t}_pixiv')
        if os.path.isdir(dest) and os.listdir(dest):
            print(f'skip  {t}_pixiv (exists)')
            continue
        if dry:
            print(f'pixiv {t}_pixiv')
            continue
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        r = subprocess.run([sys.executable, script, os.path.join(root, t), '--out', out_dir],
                           capture_output=True, text=True, encoding='utf-8', env=env)
        print(r.stdout, end='')
        if r.returncode:
            print(f'WARNING: pixiv failed for {t}: {r.stderr.strip()}', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', help=r'e.g. X:\202611')
    ap.add_argument('--out', help='default: <root>_PDF')
    ap.add_argument('--long-edge', type=int, default=1920)
    ap.add_argument('--quality', type=int, default=70)
    ap.add_argument('--limit-mb', type=float, default=50)
    ap.add_argument('--only', action='append', help='top folder name (exact); repeatable')
    ap.add_argument('--zip', action=argparse.BooleanOptionalAction, default=True,
                    help='zip the selected source folders as-is (per date). default on; --no-zip to skip')
    ap.add_argument('--pdf', action=argparse.BooleanOptionalAction, default=True,
                    help='make the PDFs. default on; --no-pdf to skip (e.g. ZIP only)')
    ap.add_argument('--pixiv', action=argparse.BooleanOptionalAction, default=True,
                    help='make <top>_pixiv/ (9 picks + Booth teaser image). default on; --no-pixiv to skip')
    ap.add_argument('--force', action='store_true', help='rebuild even if PDF exists')
    ap.add_argument('--dry-run', action='store_true', help='only list what would be built')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # -I では PYTHONIOENCODING が効かず日本語名で落ちる

    root = a.root.rstrip('\\/')
    out_dir = a.out or root + '_PDF'
    limit = a.limit_mb * 1e6
    target = limit * 0.98
    if not a.dry_run:
        os.makedirs(out_dir, exist_ok=True)

    built = skipped = 0
    selected = []
    for name in sorted(os.listdir(root), key=natkey):
        top = os.path.join(root, name)
        if not os.path.isdir(top) or (a.only and name not in a.only):
            continue
        selected.append(name)
        for sub in (sorted(os.listdir(top), key=natkey) if a.pdf else []):
            sp = os.path.join(top, sub)
            if not os.path.isdir(sp) or sub.lower().startswith('pixiv'):  # pixiv は手選びサンプル置き場
                continue
            files = collect(sp)
            if not files:
                continue
            base = f'{name}_{sub}'
            if not a.force and already_done(out_dir, base):
                skipped += 1
                print(f'skip  {base} (exists)')
                continue
            if a.dry_run:
                print(f'todo  {base} ({len(files)} images)')
                built += 1
                continue
            pages = [encode(f, a.long_edge, a.quality) for f in files]
            groups = split(pages, target)
            for i, g in enumerate(groups, 1):
                fn = f'{base}.pdf' if len(groups) == 1 else f'{base}_{i}of{len(groups)}.pdf'
                size = write_pdf(os.path.join(out_dir, fn), g)
                print(f'built {fn}: {len(g)} pages {size / 1e6:.1f}MB', flush=True)
                if size > limit:
                    print(f'WARNING: {fn} exceeds {a.limit_mb}MB', file=sys.stderr)
            built += 1
    if a.zip:
        os.makedirs(out_dir, exist_ok=True)
        make_zips(root, out_dir, selected, a.dry_run)
    if a.pixiv:
        if not a.dry_run:
            os.makedirs(out_dir, exist_ok=True)
        make_pixiv(root, out_dir, selected, a.dry_run)
    print(f'done: {built} {"to build" if a.dry_run else "built"}, {skipped} skipped')


if __name__ == '__main__':
    main()
