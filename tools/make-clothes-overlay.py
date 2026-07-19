#!/usr/bin/env python3
"""從 char-body sheet 抽出衣物像素、換色生成紙娃娃 overlay sheet(同 make-hair-overlay.py 思路)。

part 判定(依 char-body-idle 第 0 幀色帶校準,見 git log):
  shirt:白/淺灰低飽和像素的「大塊連通區」(≥150px;眼白/高光每叢 ≤70px 被排除,衣區單元件 ≥950px)。
        不用垂直色帶——側面/擺臂姿勢的肩袖會跑到眼白同高度,位置分不開,只有元件大小分得開。
  pants:自動色帶——每幀先找「強藍」像素(b>r+8,深藍褲獨有)的垂直範圍(2%~98% 分位),
        該範圍內的深色非棕像素(max<=110 且 b>=r-10)全染。固定 78%~93% 色帶在側面/擺腿
        姿勢會大量漏染(腿的位置隨姿勢移動),自校準才跟得住。帶內深色輪廓線一起染成
        深棕反而自然(本來就是陰影色)。棕鞋 r>b 被 match 排除。

用法: python3 tools/make-clothes-overlay.py <body_sheet.png> <out_sheet.png> <part> <色名>
  part: shirt / pants
  色名: shirt → red|blue|green;pants → brown|green
"""
import sys
from PIL import Image

GRID = 4

PARTS = {
    'shirt': {
        'band': None,  # 走連通元件判別,不用色帶
        'min_component': 150,
        'match': lambda r, g, b: min(r, g, b) >= 140 and max(r, g, b) - min(r, g, b) <= 45,
        'lum_range': (140, 250),
        'palettes': {
            'red': ((150, 35, 45), (235, 85, 95)),
            'blue': ((35, 65, 150), (95, 145, 235)),
            'green': ((35, 115, 65), (95, 200, 125)),
        },
    },
    'pants': {
        'band': None,  # 走 auto_band:強藍像素定範圍
        'strong': lambda r, g, b: max(r, g, b) <= 110 and b > r + 8 and b >= g,
        'match': lambda r, g, b: max(r, g, b) <= 110 and b >= r - 10,
        'lum_range': (0, 110),
        'palettes': {
            'brown': ((70, 45, 25), (150, 105, 60)),
            'green': ((35, 70, 45), (85, 145, 95)),
        },
    },
}


def band_pixels(px, cell, band, match):
    """色帶判別:bbox 垂直 band 區間內符合 match 的像素座標。"""
    x0, y0, x1, y1 = cell
    ys = [y for y in range(y0, y1) for x in range(x0, x1) if px[x, y][3] > 40]
    if not ys:
        return []
    top, bot = min(ys), max(ys)
    hh = bot - top
    ba, bb = int(top + hh * band[0]), int(top + hh * band[1]) + 1
    return [(x, y) for y in range(ba, bb) for x in range(x0, x1)
            if px[x, y][3] > 40 and match(*px[x, y][:3])]


def component_pixels(px, cell, min_size, match):
    """連通元件判別:符合 match 的像素做 4-鄰接連通,只留 >= min_size 的大塊。"""
    from collections import deque
    x0, y0, x1, y1 = cell
    cand = {(x, y) for y in range(y0, y1) for x in range(x0, x1)
            if px[x, y][3] > 40 and match(*px[x, y][:3])}
    keep = []
    while cand:
        seed = cand.pop()
        comp, q = [seed], deque([seed])
        while q:
            cx, cy = q.popleft()
            for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                if (nx, ny) in cand:
                    cand.remove((nx, ny))
                    comp.append((nx, ny))
                    q.append((nx, ny))
        if len(comp) >= min_size:
            keep.extend(comp)
    return keep


def auto_band_pixels(px, cell, strong, match):
    """自動色帶:強判別像素的垂直 2%~98% 分位範圍(±2px)內,所有弱判別像素。"""
    x0, y0, x1, y1 = cell
    strong_ys = sorted(y for y in range(y0, y1) for x in range(x0, x1)
                       if px[x, y][3] > 40 and strong(*px[x, y][:3]))
    if not strong_ys:
        return []
    ba = strong_ys[int(len(strong_ys) * 0.02)] - 2
    bb = strong_ys[min(len(strong_ys) - 1, int(len(strong_ys) * 0.98))] + 2
    return [(x, y) for y in range(ba, bb + 1) for x in range(x0, x1)
            if px[x, y][3] > 40 and match(*px[x, y][:3])]


def make_overlay(src_path: str, out_path: str, part: str, color: str) -> None:
    spec = PARTS[part]
    shadow, light = spec['palettes'][color]
    lmin, lmax = spec['lum_range']
    im = Image.open(src_path).convert('RGBA')
    w, h = im.size
    px = im.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    cw, ch = w / GRID, h / GRID

    total = 0
    for row in range(GRID):
        for col in range(GRID):
            cell = (int(col * cw), int(row * ch), int((col + 1) * cw), int((row + 1) * ch))
            if spec.get('band'):
                targets = band_pixels(px, cell, spec['band'], spec['match'])
            elif spec.get('strong'):
                targets = auto_band_pixels(px, cell, spec['strong'], spec['match'])
            else:
                targets = component_pixels(px, cell, spec['min_component'], spec['match'])
            for x, y in targets:
                r, g, b, a = px[x, y]
                lum = (r + g + b) / 3
                t = max(0.0, min(1.0, (lum - lmin) / (lmax - lmin)))
                opx[x, y] = (
                    round(shadow[0] + (light[0] - shadow[0]) * t),
                    round(shadow[1] + (light[1] - shadow[1]) * t),
                    round(shadow[2] + (light[2] - shadow[2]) * t),
                    a,
                )
                total += 1
    out.save(out_path)
    print(f'{part}/{color}: {total} px -> {out_path}')


if __name__ == '__main__':
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    _, src, dst, part, color = sys.argv
    if part not in PARTS or color not in PARTS[part]['palettes']:
        sys.exit(f'part/色名不對: {part}/{color}\n{__doc__}')
    make_overlay(src, dst, part, color)
