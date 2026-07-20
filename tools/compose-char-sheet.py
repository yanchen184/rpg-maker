#!/usr/bin/env python3
"""把 4 條「單方向走路/待機」橫條組成一張標準 4×4 角色 sheet,並統一人形大小。

背景:生圖模型畫不出跨格對齊的整張 4×4(四方向不等高、畫出格界),已兩敗。改為
一方向生一條 1×4 橫條(codex 只需管一列內 4 幀對齊,容易得多),再由本工具:
  1. 每格抽 alpha 連通主體(去鄰格滲入)
  2. 量 4 方向所有幀的人形高度,取「目標高」(預設用各方向中位數的最大者,
     讓側面不會被畫矮就顯得小)
  3. 每格人形等比縮放到目標高 → 水平置中 → 腳底貼統一基線
  4. 排進 CELL×CELL 的 4×4 sheet

這樣「左右走變小」被根治:所有方向所有幀縮到同一人高。

用法:
  compose-char-sheet.py <out_sheet.png> <down_strip> <left_strip> <right_strip> <up_strip>
    [--cell 313] [--baseline 28] [--target-h N]
每條 strip 是 1×4(WxH = 4*cell x cell),或任意寬只要能均切 4 格。
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage

GRID = 4
MIN_COMPONENT = 50


def extract_cell_sprites(strip_path: str):
    """回傳該方向 4 幀的 (rgba_patch, height) list,patch 已去背去鄰格。"""
    im = Image.open(strip_path).convert('RGBA')
    arr = np.array(im)
    w, h = im.size
    cw = w / 4
    out = []
    for c in range(4):
        x0, x1 = int(round(c * cw)), int(round((c + 1) * cw))
        sub = arr[:, x0:x1]
        lab, n = ndimage.label(sub[:, :, 3] > 16)
        if n == 0:
            raise SystemExit(f'{strip_path} 第 {c} 格全透明,停')
        sizes = ndimage.sum(sub[:, :, 3] > 16, lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1  # 最大連通元件 = 本體
        sl = ndimage.find_objects(lab, max_label=main)[main - 1]
        y0, y1, sx0, sx1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        patch = sub[y0:y1, sx0:sx1].copy()
        patch[lab[y0:y1, sx0:sx1] != main] = 0
        out.append(patch)
    return out


def compose(out_path, strips, cell, baseline, target_h):
    dirs = [extract_cell_sprites(s) for s in strips]  # [down,left,right,up] 各 4 patch
    heights = [p.shape[0] for d in dirs for p in d]
    if target_h is None:
        # 各方向中位數高的最大者:避免被某方向畫矮拖小,又不被離群值撐爆
        per_dir_med = [sorted(p.shape[0] for p in d)[len(d) // 2] for d in dirs]
        target_h = max(per_dir_med)
    target_h = min(target_h, cell - baseline - 2)  # 不能高過格子

    sheet = np.zeros((cell * GRID, cell * GRID, 4), dtype=np.uint8)
    for r, day in enumerate(dirs):
        for c, patch in enumerate(day):
            ph, pw = patch.shape[:2]
            scale = target_h / ph
            nw, nh = max(1, round(pw * scale)), target_h
            # 像素風縮放:縮小用 LANCZOS 保細節、放大用 NEAREST 保銳利邊
            resample = Image.NEAREST if scale >= 1 else Image.LANCZOS
            pimg = Image.fromarray(patch).resize((nw, nh), resample)
            p = np.array(pimg)
            tx = int(round(c * cell + (cell - nw) / 2))
            ty = int(round((r + 1) * cell - baseline - nh))
            region = sheet[ty:ty + nh, tx:tx + nw]
            np.copyto(region, p, where=(p[:, :, 3:4] > 8))
    Image.fromarray(sheet).save(out_path)
    print(f'composed {out_path}  target_h={target_h} cell={cell} baseline={baseline}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('strips', nargs=4, help='down left right up 各一條 1x4 橫條')
    ap.add_argument('--cell', type=int, default=313)
    ap.add_argument('--baseline', type=int, default=28)
    ap.add_argument('--target-h', type=int, default=None)
    a = ap.parse_args()
    compose(a.out, a.strips, a.cell, a.baseline, a.target_h)
