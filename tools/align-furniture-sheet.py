#!/usr/bin/env python3
"""對齊家具 sprite sheet:讓動畫各幀底緣落在同一平面、(選)統一整體大小。

問題:codex 生的 2×2(或任意 grid)家具 sheet,各幀本體底緣高度不一
(實測 plant-small 上下排差 64px、kitchen-counter 差 39px),anchor=[0.5,1]
貼位時每幀底緣位置不同 → 動畫播放時家具整個上下彈跳;plant-small 還上排大
下排小,忽大忽小。

做法(逐格):
  1. 抽該格 alpha 主體的 bounding box(去雜點:alpha>16 的最大連通元件)
  2. (選 --unify-size)量各幀主體高度,等比縮放到目標高(治忽大忽小)
  3. 主體底緣貼統一基線(格底 - baseline_margin)、水平置中重新落位
局部動畫(蒸汽/水流/葉搖)是畫在主體上方或內部的細節,平移/等比縮放整個
主體不會破壞這些幀間差異——它們仍在各自幀裡,只是整體被擺正。

用法:
  align-furniture-sheet.py <in_sheet.png> <out_sheet.png> [cols] [rows]
      [--baseline N] [--unify-size] [--size-metric main|bbox]
  cols/rows 預設從 4 幀方形 sheet 推 2×2;非方形要顯式給。
  --baseline: 主體底緣距格底 px(預設 4;家具通常貼近格底)
  --unify-size: 開啟「統一各幀主體高度」(治忽大忽小,如 plant-small)
  --size-metric: 量高度用整個連通主體(main)還是含動畫的 bbox 全高(bbox);
                 預設 main,避免蒸汽/水流那幀被判定較高而縮小
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage


def main_component_box(cell_alpha: np.ndarray):
    """回傳該格 alpha 最大連通元件的 (y0,y1,x0,x1) 與 mask;全透明回 None。"""
    mask = cell_alpha > 16
    if not mask.any():
        return None
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    sl = ndimage.find_objects(lab, max_label=main)[main - 1]
    y0, y1 = sl[0].start, sl[0].stop
    x0, x1 = sl[1].start, sl[1].stop
    return (y0, y1, x0, x1), (lab == main)


def align(in_path, out_path, cols, rows, baseline, unify_size, size_metric,
          align_mode='baseline'):
    im = Image.open(in_path).convert('RGBA')
    arr = np.array(im)
    H, W = arr.shape[:2]
    ch, cw = H // rows, W // cols

    # 先掃各格,拿到主體 box + 「量測高度」
    cells = []  # (r,c, full_bbox(含所有 alpha), main_mask_full, measure_h)
    for r in range(rows):
        for c in range(cols):
            cell = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            a = cell[:, :, 3]
            # 含動畫在內的完整 alpha bbox(搬移要搬整格內容,連蒸汽一起)
            ys, xs = np.where(a > 16)
            if len(ys) == 0:
                cells.append(None)
                continue
            fby0, fby1 = ys.min(), ys.max() + 1
            fbx0, fbx1 = xs.min(), xs.max() + 1
            mc = main_component_box(a)
            if size_metric == 'main' and mc is not None:
                (my0, my1, _, _), _ = mc
                measure_h = my1 - my0
                base_y = my1  # 用主體底緣當基線(蒸汽在上不影響)
            else:
                measure_h = fby1 - fby0
                base_y = fby1
            cells.append({
                'r': r, 'c': c,
                'patch': cell[fby0:fby1, fbx0:fbx1].copy(),
                'fbx0': fbx0, 'fby0': fby0,
                'base_y_in_patch': base_y - fby0,   # 主體底緣在 patch 內的 y
                'cx_in_patch': (fbx0 + fbx1) / 2 - fbx0,
                'measure_h': measure_h,
                'patch_w': fbx1 - fbx0,
            })

    valid = [c for c in cells if c is not None]
    if not valid:
        raise SystemExit(f'{in_path}: 全透明,停')

    target_h = None
    if unify_size:
        hs = sorted(c['measure_h'] for c in valid)
        target_h = hs[len(hs) // 2]  # 中位數,避免離群幀撐爆/拖小

    out = np.zeros_like(arr)
    for cell in valid:
        patch = cell['patch']
        ph, pw = patch.shape[:2]
        base_y = cell['base_y_in_patch']
        cx = cell['cx_in_patch']
        if unify_size and cell['measure_h'] > 0:
            scale = target_h / cell['measure_h']
            nw, nh = max(1, round(pw * scale)), max(1, round(ph * scale))
            resample = Image.NEAREST if scale >= 1 else Image.LANCZOS
            patch = np.array(Image.fromarray(patch).resize((nw, nh), resample))
            base_y *= scale
            cx *= scale
            ph, pw = nh, nw
        r, c = cell['r'], cell['c']
        # 垂直落位:baseline=主體底緣貼格底 / center=patch 中心貼格中心 / top=patch 頂貼格頂+邊距
        if align_mode == 'center':
            ty = int(round(r * ch + ch / 2 - ph / 2))
        elif align_mode == 'top':
            ty = int(round(r * ch + baseline))
        else:  # baseline
            ty = int(round((r + 1) * ch - baseline - base_y))
        tx = int(round(c * cw + cw / 2 - cx))
        # 夾邊界防溢出
        ty = max(r * ch, min(ty, (r + 1) * ch - ph))
        tx = max(c * cw, min(tx, (c + 1) * cw - pw))
        region = out[ty:ty + ph, tx:tx + pw]
        h2, w2 = region.shape[:2]
        p = patch[:h2, :w2]
        np.copyto(region, p, where=(p[:, :, 3:4] > 0))

    Image.fromarray(out).save(out_path)
    tag = f'unify_size target_h={target_h} ' if unify_size else ''
    print(f'aligned {in_path} -> {out_path} ({cols}x{rows} {tag}baseline={baseline})')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('inp')
    ap.add_argument('out')
    ap.add_argument('cols', nargs='?', type=int, default=2)
    ap.add_argument('rows', nargs='?', type=int, default=2)
    ap.add_argument('--baseline', type=int, default=4)
    ap.add_argument('--unify-size', action='store_true')
    ap.add_argument('--size-metric', choices=['main', 'bbox'], default='main')
    ap.add_argument('--align-mode', choices=['baseline', 'center', 'top'],
                    default='baseline',
                    help='baseline=底緣貼格底(落地家具) center=質心置中(地毯) top=頂邊對齊(掛牆物)')
    a = ap.parse_args()
    align(a.inp, a.out, a.cols, a.rows, a.baseline, a.unify_size, a.size_metric,
          a.align_mode)
