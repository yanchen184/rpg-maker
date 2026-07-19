#!/usr/bin/env python3
"""重排角色 sprite sheet:把 codex 畫歪的 4×4 格對齊到標準格。

codex 生的 sheet 人形位置不均勻(實測列距 276~300px、欄距 ~305px,格距應為 313.5px),
等分切幀會把鄰格的頭切進來,且各方向列基線差 135px+ → 角色轉向/走動時垂直大跳動。

做法:全圖 alpha 連通元件抽出 16 個人形(彼此獨立、不黏連,已驗證)→ 依質心排回
4×4 → 每格人形「腳底貼統一基線 + 水平置中」重新落位。列內原本的逐幀細微位移
(呼吸/步伐)是畫在人形內部的,平移整個元件不會破壞。

用法: python3 tools/align-char-sheet.py <in_sheet.png> <out_sheet.png> [baseline_margin]
  baseline_margin: 腳底距格底的 px(預設 28;walk/idle 要用同一值,切換才不跳)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

GRID = 4
MIN_COMPONENT = 50  # px;小於此視為雜點丟棄


def align(in_path: str, out_path: str, baseline_margin: int = 28) -> None:
    im = Image.open(in_path).convert('RGBA')
    arr = np.array(im)
    w, h = im.size
    cell_w, cell_h = w / GRID, h / GRID

    lab, n = ndimage.label(arr[:, :, 3] > 16)
    sizes = ndimage.sum(arr[:, :, 3] > 16, lab, range(1, n + 1))
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sizes[i] < MIN_COMPONENT:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        comps.append({'id': i + 1, 'box': (x0, y0, x1, y1),
                      'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2})
    if len(comps) != GRID * GRID:
        sys.exit(f'{in_path}: 期望 {GRID*GRID} 個人形,抓到 {len(comps)} 個,不敢亂排,停')

    # 依質心 y 分 4 列(每列 4 個),列內依質心 x 排序
    comps.sort(key=lambda c: c['cy'])
    rows = [sorted(comps[r * GRID:(r + 1) * GRID], key=lambda c: c['cx'])
            for r in range(GRID)]

    out = np.zeros_like(arr)
    for r, row in enumerate(rows):
        for c, comp in enumerate(row):
            x0, y0, x1, y1 = comp['box']
            patch = arr[y0:y1, x0:x1].copy()
            mask = lab[y0:y1, x0:x1] == comp['id']  # 只取本元件,鄰近雜點不帶走
            patch[~mask] = 0
            pw, ph = x1 - x0, y1 - y0
            # 目標:水平置中、腳底貼 (格底 - baseline_margin)
            tx = int(round(c * cell_w + (cell_w - pw) / 2))
            ty = int(round((r + 1) * cell_h - baseline_margin - ph))
            if ty < r * cell_h or ty + ph > (r + 1) * cell_h + 0.5:
                sys.exit(f'{in_path} r{r}c{c}: 人形高 {ph} 放不進格(ty={ty}),停')
            region = out[ty:ty + ph, tx:tx + pw]
            np.copyto(region, patch, where=(patch[:, :, 3:4] > 0))
    Image.fromarray(out).save(out_path)
    print(f'aligned {in_path} -> {out_path} (baseline_margin={baseline_margin})')


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    align(sys.argv[1], sys.argv[2],
          int(sys.argv[3]) if len(sys.argv) == 4 else 28)
