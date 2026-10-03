# -*- coding: utf-8 -*-
r"""Block Gunner 2D - convert icons/icon-512.png to a multi-size Windows .ico.

Usage: python make_icon.py <input.png> <output.ico>
Requires Pillow. Used by packaging\exe\pack.bat (or by hand for repackaging).
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("Pillow is required: pip install Pillow\n")
    sys.exit(2)

try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # Pillow < 9.1
    RESAMPLE = Image.LANCZOS

SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main(argv):
    if len(argv) < 3:
        sys.stderr.write("usage: python make_icon.py <input.png> <output.ico>\n")
        return 2
    src, dst = argv[1], argv[2]
    if not os.path.isfile(src):
        sys.stderr.write("input not found: %s\n" % src)
        return 2
    out_dir = os.path.dirname(os.path.abspath(dst))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    img = Image.open(src).convert("RGBA")
    img = img.resize((256, 256), RESAMPLE)
    img.save(dst, format="ICO", sizes=SIZES)
    sys.stdout.write("icon written: %s (%d sizes)\n" % (dst, len(SIZES)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))