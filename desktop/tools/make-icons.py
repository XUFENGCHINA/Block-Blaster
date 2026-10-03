#!/usr/bin/env python3
# -*- coding: ascii -*-
"""Generate Block Gunner 2D PWA icons (pixel-art cyan block + gun).

Outputs:
  icons/icon-192.png
  icons/icon-512.png
  icons/icon-maskable-512.png

Maskable icon keeps a >=20% safe margin on every side.
Run:  python desktop/tools/make-icons.py
"""
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ICONS = os.path.join(ROOT, "icons")

# ---- palette (r, g, b) ----
BG0 = (5, 7, 13)          # theme background #05070d
BG1 = (10, 18, 32)        # subtle pixel grid
OUT = (6, 34, 48)         # block outline (dark teal)
CY = (53, 224, 245)       # cyan body  #35e0f5
CY_L = (157, 240, 255)    # highlight
CY_D = (13, 109, 134)     # shade
EYE = (3, 24, 36)         # eyes
GUN_OUT = (24, 34, 48)    # gun outline
GUN = (198, 214, 232)     # gun metal
GUN_D = (104, 122, 146)   # gun shade
FLASH = (255, 210, 74)    # muzzle flash
FLASH2 = (255, 138, 61)
WHITE = (255, 255, 255)

S = 32  # pixel-art grid


def new_sprite(bg=BG0, grid=BG1):
    px = [[bg for _ in range(S)] for _ in range(S)]
    for y in range(S):
        for x in range(S):
            if (x + y) % 4 == 0:
                px[y][x] = grid
    return px


def rect(px, x0, y0, x1, y1, c):
    for y in range(max(0, y0), min(S - 1, y1) + 1):
        for x in range(max(0, x0), min(S - 1, x1) + 1):
            px[y][x] = c


def put(px, x, y, c):
    if 0 <= x < S and 0 <= y < S:
        px[y][x] = c


def block_gun():
    """32x32 pixel-art: cyan block character holding a gun, muzzle flash right."""
    px = new_sprite()

    # ---- character body (block) ----
    rect(px, 3, 8, 20, 27, OUT)        # outline
    rect(px, 4, 9, 19, 26, CY)         # body
    rect(px, 4, 9, 19, 11, CY_L)       # top light
    rect(px, 4, 9, 5, 26, CY_L)        # left light
    rect(px, 17, 12, 19, 26, CY_D)     # right shade
    rect(px, 6, 24, 19, 26, CY_D)      # bottom shade

    # ---- face ----
    rect(px, 7, 14, 9, 16, EYE)
    rect(px, 13, 14, 15, 16, EYE)
    put(px, 7, 14, WHITE)
    put(px, 13, 14, WHITE)
    rect(px, 9, 20, 14, 20, EYE)       # grin
    put(px, 8, 21, EYE)
    put(px, 15, 21, EYE)

    # ---- gun (in front, pointing right) ----
    rect(px, 15, 11, 29, 17, GUN_OUT)
    rect(px, 17, 12, 29, 15, GUN)
    rect(px, 17, 12, 29, 12, WHITE)
    rect(px, 17, 15, 29, 15, GUN_D)
    rect(px, 16, 16, 19, 21, GUN_OUT)  # grip outline
    rect(px, 17, 16, 18, 20, GUN_D)    # grip
    rect(px, 26, 10, 27, 11, GUN_D)    # rear sight

    # ---- muzzle flash ----
    rect(px, 30, 12, 30, 16, FLASH2)
    rect(px, 30, 13, 31, 15, FLASH)
    put(px, 31, 14, WHITE)
    put(px, 29, 14, WHITE)
    return px


def render(px, size, art_scale, bg):
    """Upscale the 32x32 sprite with nearest-neighbour (crisp pixels)."""
    art = Image.new("RGB", (S, S))
    art.putdata([px[y][x] for y in range(S) for x in range(S)])
    art = art.resize((S * art_scale, S * art_scale), Image.NEAREST)
    img = Image.new("RGB", (size, size), bg)
    off = (size - S * art_scale) // 2
    img.paste(art, (off, off))
    return img


def main():
    os.makedirs(ICONS, exist_ok=True)
    px = block_gun()

    # ASCII preview for quick eyeballing (stdout is ascii-only)
    letters = {BG0: ".", BG1: ",", OUT: "#", CY: "C", CY_L: "c", CY_D: "d",
               EYE: "E", GUN_OUT: "X", GUN: "g", GUN_D: "x", FLASH: "*",
               FLASH2: "o", WHITE: "w"}
    for row in px:
        print("".join(letters.get(c, "?") for c in row))

    # regular icons: art occupies ~87% (small padding), crisp integer scales
    render(px, 512, 14, BG0).save(os.path.join(ICONS, "icon-512.png"))
    render(px, 192, 5, BG0).save(os.path.join(ICONS, "icon-192.png"))
    # maskable: art is 256/512 = 50% => 25% safe margin on every side (>= 20%)
    render(px, 512, 8, BG0).save(os.path.join(ICONS, "icon-maskable-512.png"))

    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png"):
        with Image.open(os.path.join(ICONS, name)) as im:
            print("saved %s %dx%d %s" % (name, im.size[0], im.size[1], im.mode))


if __name__ == "__main__":
    main()