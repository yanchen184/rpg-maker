#!/usr/bin/env python3
"""從四視角帽子圖(2×2:TL 正面 / TR 背面 / BL 左側 / BR 右側)貼位生成紙娃娃帽子 overlay sheet。

逐幀量 body sheet 的頭部(bbox 頂端區域)位置與寬度,把對應方向的帽子視角縮放後貼上,
walk 的 head bob 自動跟住(每幀重新量)。生圖模型畫整張 overlay 對齊不可控(已兩敗),
單帽圖 + 程式貼位的位置是可控的。

用法: python3 tools/make-hat-sheets.py <hat_views.png> <body_sheet.png> <out_sheet.png>
"""
import sys
from PIL import Image

GRID = 4
# body sheet 列 = 方向 下/左/右/上 → 帽子視角象限 (col, row):正面TL/左側BL/右側BR/背面TR
VIEW_FOR_ROW = {0: (0, 0), 1: (0, 1), 2: (1, 1), 3: (1, 0)}
WIDTH_RATIO = 1.00   # 帽寬 = 頭寬 × 此值
TOP_OFFSET = 0.30    # 帽頂高出頭頂 cap_h × 此值


def crop_view(views: Image.Image, col: int, row: int) -> Image.Image:
    qw, qh = views.size[0] // 2, views.size[1] // 2
    q = views.crop((col * qw, row * qh, (col + 1) * qw, (row + 1) * qh))
    return q.crop(q.getbbox())


def head_metrics(px, cell):
    """頭頂 y、頭部(bbox 上段)水平範圍。"""
    x0, y0, x1, y1 = cell
    pts = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if px[x, y][3] > 40]
    if not pts:
        return None
    top = min(y for _, y in pts)
    bot = max(y for _, y in pts)
    hh = bot - top
    head = [(x, y) for x, y in pts if y <= top + hh * 0.22]
    hx0, hx1 = min(x for x, _ in head), max(x for x, _ in head)
    return top, hx0, hx1


def make_hat_sheet(views_path: str, body_path: str, out_path: str) -> None:
    views = Image.open(views_path).convert('RGBA')
    body = Image.open(body_path).convert('RGBA')
    w, h = body.size
    px = body.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cw, ch = w // GRID, h // GRID
    for row in range(GRID):
        view = crop_view(views, *VIEW_FOR_ROW[row])
        for col in range(GRID):
            cell = (col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)
            m = head_metrics(px, cell)
            if not m:
                continue
            top, hx0, hx1 = m
            head_w = hx1 - hx0
            cap_w = int(head_w * WIDTH_RATIO)
            cap_h = int(view.size[1] * cap_w / view.size[0])
            cap = view.resize((cap_w, cap_h), Image.NEAREST)
            cx = (hx0 + hx1) // 2 - cap_w // 2
            cy = int(top - cap_h * TOP_OFFSET)
            # clamp 在 cell 內:溢出會污染相鄰 cell(切幀後變別的方向幀裡的殘影)
            cx = max(cell[0], min(cx, cell[2] - cap_w))
            cy = max(cell[1], min(cy, cell[3] - cap_h))
            out.paste(cap, (cx, cy), cap)
    out.save(out_path)
    print(f'hat sheet -> {out_path}')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    make_hat_sheet(sys.argv[1], sys.argv[2], sys.argv[3])
