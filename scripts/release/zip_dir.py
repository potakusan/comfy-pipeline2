"""フォルダの中身を ZIP にまとめる(ダウンロード用)。JPG は圧縮済みなので無圧縮で格納する。

    python zip_dir.py <フォルダ> <出力.zip>
"""
import os
import sys
import zipfile


def main() -> int:
    src, dest = sys.argv[1], sys.argv[2]
    if not os.path.isdir(src):
        print(f"フォルダがありません: {src}", file=sys.stderr)
        return 1
    tmp = dest + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        for dp, dns, fns in os.walk(src):
            dns.sort()
            for f in sorted(fns):
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, src))
    os.replace(tmp, dest)
    print(f"zip {os.path.basename(dest)} {os.path.getsize(dest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
