#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 30 天冲刺进度壁纸。

背景若给了 --bg，则在其上叠一层暗色蒙版保证文字可读；不给则画渐变。
所有尺寸按画布宽度相对 3200 等比缩放，换分辨率不用改代码。
文字全部画在独立 RGBA 图层上再合成，这样半透明才生效。

用法：
  python make_wallpaper.py --day 3 --title "进阶查询" \
      --next-day 4 --next-title "索引与执行计划" \
      --done 3 --total 31 --out out.png [--bg bg.png]
"""

import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# 与桌面清单 HTML 同一套配色
BG = (13, 17, 23)
CARD = (18, 26, 35)
LINE = (36, 44, 56)
TXT = (230, 237, 243)
MUTED = (139, 148, 158)
DIM = (92, 103, 115)
GREEN = (74, 222, 128)
AMBER = (240, 180, 41)

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
REG = os.path.join(FONT_DIR, "msyh.ttc")
BOLD = os.path.join(FONT_DIR, "msyhbd.ttc")


def load_font(path, size):
    """msyh*.ttc 是字体集合，index=0 是常规字重。"""
    try:
        if path.lower().endswith(".ttc"):
            return ImageFont.truetype(path, size, index=0)
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(REG, size, index=0)


def gradient(size):
    """左上偏亮的深色渐变，避免纯色太平。"""
    w, h = size
    small = Image.new("RGB", (64, 40))
    px = small.load()
    for y in range(40):
        for x in range(64):
            t = (x / 63.0) * 0.55 + (y / 39.0) * 0.45
            px[x, y] = (
                int(13 + 9 * (1 - t)),
                int(17 + 13 * (1 - t)),
                int(23 + 20 * (1 - t)),
            )
    return small.resize((w, h), Image.BICUBIC)


def scrim(size, bg_img):
    """在背景图上压一层从左下深、右上浅的暗色蒙版，保证文字对比度。"""
    w, h = size
    bg_img = bg_img.convert("RGB").resize((w, h), Image.LANCZOS)
    bg_img = bg_img.filter(ImageFilter.GaussianBlur(radius=max(1, w // 1400)))

    mask_small = Image.new("L", (64, 40))
    mp = mask_small.load()
    for y in range(40):
        for x in range(64):
            t = (x / 63.0) ** 1.5 * 0.45 + (1 - y / 39.0) * 0.35
            mp[x, y] = int(max(90, min(235, 235 - 130 * t)))
    mask = mask_small.resize((w, h), Image.BICUBIC)
    solid = Image.new("RGB", (w, h), BG)
    return Image.composite(bg_img, solid, Image.eval(mask, lambda v: 255 - v))


def fit_font(d, text, path, start, max_width, min_size, step):
    """按最大宽度自动收字号。"""
    size = start
    while size > min_size:
        f = load_font(path, size)
        bb = d.textbbox((0, 0), text, font=f)
        if bb[2] - bb[0] <= max_width:
            return f
        size -= step
    return load_font(path, min_size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=int, required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--next-day", type=int, default=-1)
    ap.add_argument("--next-title", default="")
    ap.add_argument("--done", type=int, default=0)
    ap.add_argument("--total", type=int, default=31)
    ap.add_argument("--date", default="")
    ap.add_argument("--bg", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=0)
    ap.add_argument("--height", type=int, default=0)
    args = ap.parse_args()

    W = args.width or int(os.environ.get("WALLPAPER_W", 3200))
    H = args.height or int(os.environ.get("WALLPAPER_H", 2000))

    if args.bg:
        if not os.path.exists(args.bg):
            sys.stderr.write("bg not found: %s\n" % args.bg)
            return 2
        base = scrim((W, H), Image.open(args.bg))
    else:
        base = gradient((W, H))

    canvas = base.convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    s = W / 3200.0  # 一切尺寸基于 3200 宽设计稿缩放
    pad = int(200 * s)

    # ---- 背景水印数字（底部卡片之上，避免透过半透明卡片显脏）----
    card_h = int(300 * s)
    card_y0 = H - pad - card_h
    wm_font = load_font(BOLD, int(1150 * s))
    wm_text = "%02d" % args.day
    bb = d.textbbox((0, 0), wm_text, font=wm_font)
    wm_w, wm_h = bb[2] - bb[0], bb[3] - bb[1]
    wm_y = max(pad, card_y0 - int(50 * s) - wm_h)
    d.text((W - pad + int(120 * s) - wm_w, wm_y),
           wm_text, font=wm_font, fill=GREEN + (20,))

    # ---- 顶部小标 ----
    f_kick = load_font(REG, int(44 * s))
    d.text((pad, pad), "全栈 30 天冲刺   ·   第 %d 天" % args.day,
           font=f_kick, fill=GREEN + (255,))

    # ---- 主标题 ----
    max_w = W - pad * 2 - int(260 * s)
    f_title = fit_font(d, args.title, BOLD, int(200 * s), max_w, int(90 * s), int(8 * s))
    tb = d.textbbox((0, 0), args.title, font=f_title)
    ty = pad + int(120 * s)
    d.text((pad, ty), args.title, font=f_title, fill=TXT + (255,))

    # ---- 日期 ----
    if args.date:
        f_date = load_font(REG, int(42 * s))
        d.text((pad, ty + (tb[3] - tb[1]) + int(70 * s)), args.date,
               font=f_date, fill=DIM + (255,))

    # ---- 底部卡片 ----
    card_x0, card_w = pad, W - pad * 2
    d.rounded_rectangle(
        [card_x0, card_y0, card_x0 + card_w, card_y0 + card_h],
        radius=int(26 * s), fill=CARD + (200,), outline=LINE + (255,),
        width=max(1, int(2 * s)),
    )

    inner_x = card_x0 + int(56 * s)
    inner_w = card_w - int(112 * s)
    text_y = card_y0 + int(52 * s)

    f_label = load_font(REG, int(42 * s))
    f_num = load_font(BOLD, int(58 * s))

    d.text((inner_x, text_y + int(6 * s)), "已完成", font=f_label, fill=MUTED + (255,))
    nxt_x = inner_x + int(150 * s)
    d.text((nxt_x, text_y), "%d / %d 天" % (args.done, args.total),
           font=f_num, fill=TXT + (255,))
    pct = 0 if args.total <= 0 else int(round(args.done * 100.0 / args.total))
    nb = d.textbbox((0, 0), "%d / %d 天" % (args.done, args.total), font=f_num)
    d.text((nxt_x + (nb[2] - nb[0]) + int(28 * s), text_y + int(6 * s)),
           "%d%%" % pct, font=f_label, fill=GREEN + (255,))

    if args.next_day >= 0 and args.next_title:
        f_next = load_font(REG, int(44 * s))
        txt = "明天  ·  D%d  %s" % (args.next_day, args.next_title)
        nb = d.textbbox((0, 0), txt, font=f_next)
        d.text((card_x0 + card_w - int(56 * s) - (nb[2] - nb[0]), text_y + int(6 * s)),
               txt, font=f_next, fill=AMBER + (255,))
    elif args.next_day < 0:
        f_done = load_font(BOLD, int(48 * s))
        txt = "30 天全部走完"
        nb = d.textbbox((0, 0), txt, font=f_done)
        d.text((card_x0 + card_w - int(56 * s) - (nb[2] - nb[0]), text_y),
               txt, font=f_done, fill=GREEN + (255,))

    # ---- 进度条 ----
    bar_y = card_y0 + int(160 * s)
    bar_h = int(12 * s)
    r = bar_h // 2
    d.rounded_rectangle([inner_x, bar_y, inner_x + inner_w, bar_y + bar_h],
                        radius=r, fill=(33, 41, 54, 255))
    ratio = 0.0 if args.total <= 0 else max(0.0, min(1.0, args.done / float(args.total)))
    fill_w = int(inner_w * ratio)
    if fill_w > 0:
        d.rounded_rectangle([inner_x, bar_y, inner_x + max(fill_w, bar_h), bar_y + bar_h],
                            radius=r, fill=GREEN + (255,))

    out = Image.alpha_composite(canvas, layer).convert("RGB")
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    out.save(args.out, "PNG")
    print(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
