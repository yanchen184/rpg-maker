#!/usr/bin/env python3
"""修 up(背面)走路步伐:原 sheet 的 up 排四幀只有「左腳在前」與「併攏」,
缺「右腳在前」,播放起來像原地跺左腳、無左右交替(呼大呼小的姊妹病)。

根因是 source asset 缺右前幀,codex 反覆重生仍畫成左前(背面走路右腳前它畫不出)。
改走程式化:背面走路看不到臉,左右鏡像破綻最小(頭髮近對稱、白T無不對稱圖案、
深色褲鏡像看不出)。取 up 排「左前」那幀水平鏡像成「右前」,把 up 排重排成
標準循環:左前 → 併 → 右前(鏡像) → 併。只動 up 排第 2 格,其餘方向/幀不變。

用法:
  fix-up-walk.py <body_walk_sheet.png> [--cell 313] [--left-front-frame 0]
                 [--mid-frame 1] [--replace-frame 2] [--inplace]
  預設把第 2 格(index 2)換成第 0 格(左前)的水平鏡像。
  --inplace 直接覆蓋原檔(會先寫 <檔名>.bak);不給則輸出到 <檔名>.fixed.png
"""
import argparse
import shutil
import numpy as np
from PIL import Image
from scipy import ndimage


def main_body_bbox(cell_rgba):
    """回傳最大 alpha 連通元件的 (y0,y1,x0,x1, mask);全透明回 None。"""
    a = cell_rgba[:, :, 3]
    lab, n = ndimage.label(a > 16)
    if n == 0:
        return None
    sizes = ndimage.sum(a > 16, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    sl = ndimage.find_objects(lab, max_label=main)[main - 1]
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    return y0, y1, x0, x1, (lab == main)


def make_mirror_frame(src_cell, cell, whole_cell=False):
    """把 src_cell(左前)水平鏡像成右前。

    whole_cell=True:整格以格中心為軸鏡像(不重定位)。body 幀0 人形質心≈格中心
      (實測 158 vs 156.5,差 1.5px),整格鏡像後仍≈置中;而 overlay(頭髮/衣服)
      不是完整人形、質心≠人形中心,只能靠整格鏡像才會與 body 對齊 → overlay 一律走這條。
    whole_cell=False:抽本體、鏡像、本體質心重定位貼格中心。僅適合 body 這種完整人形。
    """
    if whole_cell:
        return src_cell[:, ::-1, :].copy()
    bb = main_body_bbox(src_cell)
    if bb is None:
        raise SystemExit('來源幀全透明,停')
    y0, y1, x0, x1, mask = bb
    patch = src_cell[y0:y1, x0:x1].copy()
    patch[mask[y0:y1, x0:x1] == False] = 0
    patch_m = patch[:, ::-1, :]                      # 水平翻轉
    mys, mxs = np.where(mask[y0:y1, x0:x1])
    cx_in_patch = mxs.mean()                         # 原本體質心(patch 內 x)
    new_cx = (x1 - x0) - cx_in_patch                 # 翻轉後質心
    ph, pw = y1 - y0, x1 - x0
    out = np.zeros((cell, cell, 4), dtype=np.uint8)
    tx = int(round(cell / 2 - new_cx))
    ty = y0                                          # 底緣與原幀一致
    tx = max(0, min(tx, cell - pw))
    region = out[ty:ty + ph, tx:tx + pw]
    np.copyto(region, patch_m, where=(patch_m[:, :, 3:4] > 0))
    return out


def fix(sheet_path, cell, left_front, replace, inplace, whole_cell):
    """若已有 <sheet>.bak,先從 .bak 還原再修(冪等:重跑不會二次鏡像已改的幀)。"""
    bak = sheet_path + '.bak'
    if inplace and shutil.os.path.exists(bak):
        shutil.copy2(bak, sheet_path)   # 從原始備份還原,確保鏡像來源是乾淨左前幀
    im = Image.open(sheet_path).convert('RGBA')
    arr = np.array(im)
    up_row = 3  # DIRS = down,left,right,up → up 是第 4 排

    y = up_row * cell
    src = arr[y:y + cell, left_front * cell:(left_front + 1) * cell].copy()
    mirror = make_mirror_frame(src, cell, whole_cell=whole_cell)
    arr[y:y + cell, replace * cell:(replace + 1) * cell] = mirror

    out_path = sheet_path if inplace else sheet_path.rsplit('.', 1)[0] + '.fixed.png'
    if inplace and not shutil.os.path.exists(bak):
        shutil.copy2(sheet_path, bak)
    Image.fromarray(arr).save(out_path)
    mode = 'whole-cell' if whole_cell else 'body-centroid'
    print(f'fixed up-walk ({mode}): row{up_row} frame{replace} <- mirror(frame{left_front}) '
          f'-> {out_path}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('sheets', nargs='+', help='一或多張 walk sheet(4×4)')
    ap.add_argument('--cell', type=int, default=313)
    ap.add_argument('--left-front-frame', type=int, default=0)
    ap.add_argument('--replace-frame', type=int, default=2)
    ap.add_argument('--inplace', action='store_true')
    ap.add_argument('--whole-cell', action='store_true',
                    help='整格鏡像(overlay 及要與 overlay 對齊的 body 用這個)')
    a = ap.parse_args()
    for s in a.sheets:
        fix(s, a.cell, a.left_front_frame, a.replace_frame, a.inplace, a.whole_cell)
