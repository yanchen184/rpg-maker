#!/usr/bin/env python3
"""待機微動(呼吸)合成器:四向待機 sheet 每列 4 格常是同一靜幀複製,
生圖模型做不出跨格微動循環(codex 裁定)。改用程式對每列首格程式化合成
A -> B -> A -> C 四幀呼吸循環:

  A = 原始靜幀
  B = 下沉幀:軀幹以上整體下移(肩沉、頭低、拍頭跟著沉)
  C = 上抬幀:軀幹以上整體上移(肩抬、頭起、拍頭跟著上)

關鍵約束(codex D 項必改):腳底像素固定不動 —— 呼吸是上半身起伏,不是整張
sprite 上下平移。做法:找每格 sprite 的腳底 y,由腳底往上做「垂直位移量隨高度
線性遞增」的 shear——腳底位移 0,頭頂位移最大,中間線性內插。這樣腳釘死、身體有
可辨識的起伏,且第 4 格回第 1 格平滑(C 之後接回 A)。

用法:
  make-idle-breath.py <in_sheet.png> -o <out_sheet.png> [--cell 320] [--rise 3]
    --cell  每格邊長(輸出/輸入同尺寸方陣;預設由 sheet 寬/4 推)
    --rise  頭頂最大位移 px(B 下沉 +rise、C 上抬 -rise;預設 3)
"""
import argparse
import sys

import numpy as np
from PIL import Image

GRID = 4
ALPHA_THRESHOLD = 8
# 腳底安全帶:sprite bbox 底往上這比例高度內視為「腳」,位移量鎖 0(完全不動)
FOOT_LOCK_FRAC = 0.10


def sprite_vspan(cell: np.ndarray):
    """回傳該格 sprite 內容的 (y_top, y_bottom);全透明回 None。"""
    mask = cell[..., 3] > ALPHA_THRESHOLD
    if not mask.any():
        return None
    ys = np.nonzero(mask.any(axis=1))[0]
    return int(ys.min()), int(ys.max())


def breathe(cell: np.ndarray, rise: float) -> np.ndarray:
    """把軀幹以上垂直位移:腳底(bbox 底部 FOOT_LOCK_FRAC 帶)位移 0,
    頭頂位移 = rise(正=下沉/負=上抬),中間線性內插。用逐列整數捲動實現,
    腳定住、身體平滑起伏。rise 可為負。"""
    span = sprite_vspan(cell)
    if span is None:
        return cell.copy()
    y_top, y_bot = span
    h = cell.shape[0]
    foot_lock_y = y_bot - round((y_bot - y_top) * FOOT_LOCK_FRAC)  # 此 y 以下位移鎖 0
    out = np.zeros_like(cell)
    for y in range(h):
        if y >= foot_lock_y:
            shift = 0  # 腳:不動
        elif y <= y_top:
            shift = rise  # 頭頂:最大位移
        else:
            # y_top..foot_lock_y 之間線性:y=foot_lock_y ->0, y=y_top ->rise
            frac = (foot_lock_y - y) / max(1, (foot_lock_y - y_top))
            shift = rise * frac
        s = int(round(shift))
        src_y = y - s  # 目標列 y 取自來源列 y-s(位移 +s = 內容往下 s)
        if 0 <= src_y < h:
            out[y] = cell[src_y]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--cell", type=int, default=0)
    ap.add_argument("--rise", type=float, default=3.0,
                    help="頭頂最大呼吸位移 px(B 下沉 +rise、C 上抬 -rise)")
    args = ap.parse_args()

    img = Image.open(args.sheet).convert("RGBA")
    arr = np.array(img)
    cell = args.cell if args.cell else img.width // GRID
    if img.width % cell or img.height % cell:
        print(f"警告:sheet {img.size} 無法被 cell={cell} 整除", file=sys.stderr)

    out = np.zeros_like(arr)
    for row in range(GRID):
        # 每列取「第 1 格」當基準 A
        y0, y1 = row * cell, (row + 1) * cell
        a = arr[y0:y1, 0:cell]
        b = breathe(a, +args.rise)   # 下沉
        c = breathe(a, -args.rise)   # 上抬
        frames = [a, b, a, c]        # A -> B -> A -> C
        for col in range(GRID):
            out[y0:y1, col * cell:(col + 1) * cell] = frames[col]
        print(f"  列{row + 1}: A->B->A->C 合成完成 (rise=±{args.rise}px, 腳鎖定)")

    Image.fromarray(out).save(args.out)
    print(f"寫出 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
