#!/usr/bin/env python3
"""從 char-body sheet 抽出髮色像素、換色生成紙娃娃 hair overlay sheet。

生圖模型畫不準 overlay 對齊(兩次都遮臉/偏移),改走程式化:
逐 cell 找角色 bbox,取上半部(髮區)中「棕色系」像素,重新映射成目標髮色。
產出的 overlay 與 body sheet 天生逐像素對齊。

用法: python3 tools/make-hair-overlay.py <body_sheet.png> <out_sheet.png> [色名]
色名: blonde(預設) / pink / silver
"""
import sys
from PIL import Image

PALETTES = {
    # (陰影色, 亮色):依原像素亮度在兩色間插值
    'blonde': ((158, 116, 50), (232, 192, 104)),
    'pink': ((170, 80, 120), (240, 160, 200)),
    'silver': ((120, 125, 140), (225, 228, 238)),
}

GRID = 4
HAIR_REGION = 0.48  # 角色 bbox 頂部往下這個比例內才視為髮區(避開鞋子/膚色陰影)


def is_hair_color(r: int, g: int, b: int) -> bool:
    """深棕髮色:偏紅棕、不亮(膚色 r>=170 排除、白衣/藍褲不符 r>g>b)"""
    return r > g > b and (r - b) > 12 and 35 <= r < 170


def make_overlay(src_path: str, out_path: str, color: str) -> None:
    im = Image.open(src_path).convert('RGBA')
    w, h = im.size
    px = im.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    shadow, light = PALETTES[color]
    cw, ch = w / GRID, h / GRID

    total = 0
    for row in range(GRID):
        for col in range(GRID):
            x0, y0 = int(col * cw), int(row * ch)
            x1, y1 = int((col + 1) * cw), int((row + 1) * ch)
            # 角色 bbox(非透明像素範圍)
            ys = [y for y in range(y0, y1) for x in range(x0, x1) if px[x, y][3] > 60]
            if not ys:
                continue
            top, bot = min(ys), max(ys)
            limit = top + (bot - top) * HAIR_REGION
            for y in range(top, int(limit) + 1):
                for x in range(x0, x1):
                    r, g, b, a = px[x, y]
                    if a > 60 and is_hair_color(r, g, b):
                        lum = (r + g + b) / 3
                        t = max(0.0, min(1.0, (lum - 45) / 75))
                        nr = int(shadow[0] + (light[0] - shadow[0]) * t)
                        ng = int(shadow[1] + (light[1] - shadow[1]) * t)
                        nb = int(shadow[2] + (light[2] - shadow[2]) * t)
                        opx[x, y] = (nr, ng, nb, a)
                        total += 1

    out.save(out_path)
    print(f'DONE {out_path} color={color} hair_px={total}')


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    color = sys.argv[3] if len(sys.argv) > 3 else 'blonde'
    make_overlay(src, dst, color)
