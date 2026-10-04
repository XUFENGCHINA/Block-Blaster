#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make-pack.py - 把材质包文件夹打成单个 .bgpack 文件（JSON + 内嵌 data URI 图片）。

用法:
    python tools/make-pack.py <材质包文件夹> [-o 输出.bgpack]
                              [--max-width 1280] [--style-size 64] [--no-resize]

材质包文件夹示例:
    my-pack/
      pack.json
      background.png          # pack.json 里 background 写 "background.png"
      styles/neon.png         # styles[].image 写 "styles/neon.png"
      styles/blaze.png

工具会把 pack.json 里的图片相对路径读出来，转成 data URI 内嵌进单个 .bgpack。
完全离线；Pillow 可用时会自动按上限压缩尺寸，没有 Pillow 时按原图直接内嵌。

图片建议:
    background.png   压到 1280 宽以内、1MB 以内
    styles/*.png     32x32 或 64x64 即可（游戏里按 30x30 绘制）
"""

import argparse
import base64
import io
import json
import os
import sys

MAX_BYTES = 4 * 1024 * 1024


def fail(msg):
    print("[X] " + msg)
    sys.exit(1)


def load_pillow():
    try:
        from PIL import Image
        return Image
    except Exception:
        return None


def resample_filter(Image):
    try:
        return Image.Resampling.LANCZOS
    except Exception:
        return getattr(Image, "LANCZOS", 1)


def image_to_data_uri(path, max_width, no_resize, Image):
    if not os.path.isfile(path):
        fail("找不到图片文件: " + path)
    with open(path, "rb") as fp:
        raw = fp.read()
    ext = os.path.splitext(path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif ext == ".gif":
        mime = "image/gif"
    else:
        mime = "image/png"
    plain = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
    if Image is None or no_resize or max_width <= 0:
        if Image is None:
            print("[!] 未安装 Pillow，原样内嵌: " + os.path.basename(path))
        return plain
    try:
        img = Image.open(io.BytesIO(raw))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        if img.width > max_width:
            height = max(1, int(round(img.height * max_width / float(img.width))))
            img = img.resize((max_width, height), resample_filter(Image))
            print("[i] 压缩 %s -> %dx%d" % (os.path.basename(path), img.width, img.height))
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:
        print("[!] Pillow 处理失败，改为原样内嵌 %s (%s)" % (os.path.basename(path), exc))
        return plain


def main():
    ap = argparse.ArgumentParser(description="把材质包文件夹打成单个 .bgpack（JSON + data URI 图片）")
    ap.add_argument("folder", nargs="?", help="含 pack.json 的材质包文件夹")
    ap.add_argument("-o", "--out", help="输出 .bgpack 路径（默认 <文件夹名>.bgpack）")
    ap.add_argument("--max-width", type=int, default=1280, help="背景图最大宽度（默认 1280）")
    ap.add_argument("--style-size", type=int, default=64, help="角色贴图最大宽度（默认 64）")
    ap.add_argument("--no-resize", action="store_true", help="不做任何尺寸压缩")
    args = ap.parse_args()

    if not args.folder:
        ap.print_help()
        print("")
        print("示例: python tools/make-pack.py tools/材质包示例 -o 我的材质包.bgpack")
        return

    folder = os.path.abspath(args.folder)
    if not os.path.isdir(folder):
        fail("找不到文件夹: " + folder)
    pack_path = os.path.join(folder, "pack.json")
    if not os.path.isfile(pack_path):
        fail("文件夹里缺少 pack.json（可参考 tools/材质包示例/pack.json）")
    try:
        with open(pack_path, "r", encoding="utf-8") as fp:
            pack = json.load(fp)
    except Exception as exc:
        fail("pack.json 解析失败: %s" % exc)
    if not isinstance(pack, dict):
        fail("pack.json 根节点必须是 JSON 对象")
    if not pack.get("name"):
        fail("pack.json 缺少 name")
    styles = pack.get("styles")
    if not isinstance(styles, list) or not styles:
        fail("pack.json 缺少 styles（至少 1 套角色样式）")

    Image = load_pillow()
    pack["format"] = pack.get("format", 1)

    if pack.get("background") and not str(pack["background"]).startswith("data:"):
        pack["background"] = image_to_data_uri(os.path.join(folder, pack["background"]),
                                               args.max_width, args.no_resize, Image)
    panels = pack.get("panels")
    if isinstance(panels, dict) and panels.get("image") and not str(panels["image"]).startswith("data:"):
        panels["image"] = image_to_data_uri(os.path.join(folder, panels["image"]),
                                            args.max_width, args.no_resize, Image)

    for i, style in enumerate(styles):
        if not isinstance(style, dict):
            fail("styles[%d] 必须是对象" % i)
        if style.get("image") and not str(style["image"]).startswith("data:"):
            style["image"] = image_to_data_uri(os.path.join(folder, style["image"]),
                                               args.style_size, args.no_resize, Image)
        style.setdefault("color", "#35e0f5")
        style.setdefault("dark", "#0a2c3a")

    out = args.out or (os.path.basename(os.path.normpath(folder)) + ".bgpack")
    try:
        with open(out, "w", encoding="utf-8") as fp:
            json.dump(pack, fp, ensure_ascii=False, indent=2)
    except Exception as exc:
        fail("写入失败: %s" % exc)

    size = os.path.getsize(out)
    print("")
    print("[OK] 已生成: " + os.path.abspath(out))
    print("     大小: %.2f MB%s" % (size / 1048576.0,
          "  (超过 4MB，游戏会拒绝安装，请压缩图片)" if size > MAX_BYTES else ""))
    print("     安装: 打开游戏 -> 主菜单 -> 🎨 材质包 -> 选择 .bgpack 文件")
    print("     提示: 序列化后不能超过 4MB，图片建议压到 1MB 以内。")


if __name__ == "__main__":
    main()