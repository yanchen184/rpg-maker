#!/usr/bin/env python3
"""
4x4 sprite sheet 錨定後處理:生圖模型控不住每格基線/水平中心,切格播放會漂移。
逐格處理:
  1. 清除與主體不連通的孤立小 alpha 碎片(跨格裁切殘片、雜點)
  2. 垂直:腳底平移到固定基線(跳躍幀用 --lift 逐幀抬升,單位 px,長度 16)
  3. 水平:用「腳部區域的 alpha 中位數 x」當 root 錨對齊格中心——不能用整體
     bbox 中心,球拍往左右伸會把身體反向推偏(codex 評審裁定)
  4. 選配 --scale 對整格內容等比縮放(NEAREST 保 pixel art),用於跨 sheet 統一角色身高

用法:
  anchor-sheet.py <sheet.png>                      # 只量測:印每格 bbox/身高/root 漂移
  anchor-sheet.py <sheet.png> -o out.png           # 錨定全部 16 格貼地
  anchor-sheet.py <sheet.png> -o out.png --lift 0,0,0,10,24,36,44,48,48,40,26,12,0,0,0,0
  anchor-sheet.py <sheet.png> -o out.png --scale 1.10
"""
import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

GRID = 4
BASELINE_FRAC = 0.90   # 腳底基線 = 格高 * 0.90
ALPHA_THRESHOLD = 8    # 忽略近透明雜點
FOOT_STRIP_FRAC = 0.12  # root 錨取 sprite bbox 底部這比例高度內的 alpha
MIN_COMPONENT_FRAC = 0.015  # 面積 < 最大連通塊 1.5% 的孤立塊視為碎片清掉
EDGE_COMPONENT_FRAC = 0.10  # 貼格邊的孤立塊放寬到 10%(跨格裁切殘片較大;拋球懸空不貼邊,不受影響)
EDGE_MARGIN = 2


def clean_cell(cell: Image.Image) -> Image.Image:
    """清掉與主體不連通的碎片:雜點(<1.5% 主體)與貼格邊的跨格裁切殘片(<10% 主體)。
    球拍/拋球等合法元件不受影響——球拍與手相連,拋球懸空不貼格邊。"""
    arr = np.array(cell)
    mask = arr[..., 3] > ALPHA_THRESHOLD
    if not mask.any():
        return cell
    labels, n = ndimage.label(mask)
    if n <= 1:
        return cell
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    main_area = sizes.max()
    h, w = mask.shape
    drop_ids = []
    for i in range(1, n + 1):
        area = sizes[i - 1]
        if area == main_area:
            continue
        ys, xs = np.nonzero(labels == i)
        touches_edge = (ys.min() <= EDGE_MARGIN or ys.max() >= h - 1 - EDGE_MARGIN
                        or xs.min() <= EDGE_MARGIN or xs.max() >= w - 1 - EDGE_MARGIN)
        limit = EDGE_COMPONENT_FRAC if touches_edge else MIN_COMPONENT_FRAC
        if area < main_area * limit:
            drop_ids.append(i)
    if drop_ids:
        arr[np.isin(labels, drop_ids) & mask] = 0
    return Image.fromarray(arr)


def cell_bbox(cell: Image.Image):
    alpha = cell.getchannel("A").point(lambda a: 255 if a > ALPHA_THRESHOLD else 0)
    return alpha.getbbox()


def root_x(cell: Image.Image, box) -> float:
    """腳部區域 alpha 的中位數 x = 身體 root(排除伸出去的球拍/手臂)"""
    x0, y0, x1, y1 = box
    strip_h = max(4, round((y1 - y0) * FOOT_STRIP_FRAC))
    arr = np.array(cell.getchannel("A"))
    strip = arr[y1 - strip_h:y1, :] > ALPHA_THRESHOLD
    xs = np.nonzero(strip)[1]
    if xs.size == 0:
        return (x0 + x1) / 2
    return float(np.median(xs))


def torso_y(cell: Image.Image) -> float | None:
    """白色球衣最大連通塊的質心 y = 軀幹参考。
    空中幀腳會收起,以腳底對 lift 會讓身體視覺高度不單調(codex 裁定),改跟軀幹。"""
    arr = np.array(cell)
    white = (arr[..., 3] > ALPHA_THRESHOLD) & (arr[..., :3] > 200).all(axis=-1)
    if not white.any():
        return None
    labels, n = ndimage.label(white)
    sizes = ndimage.sum(white, labels, range(1, n + 1))
    ys = np.nonzero(labels == int(np.argmax(sizes)) + 1)[0]
    return float(ys.mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("-o", "--out", help="輸出路徑;省略 = 只量測不寫檔")
    ap.add_argument("--lift", help="16 個逗號分隔的抬升 px(跳躍弧線),預設全 0")
    ap.add_argument("--scale", type=float, default=1.0, help="整格等比縮放(統一跨 sheet 身高)")
    ap.add_argument("--cell", type=int, default=0,
                    help="輸出每格邊長 px(輸出畫布 = cell*4,保證整除);預設沿用來源格邊長")
    ap.add_argument("--no-anchor", action="store_true",
                    help="只清碎片/縮放/切格正規化,不做腳底或軀幹對齊平移。"
                         "用於水平飛(dive)、肖像(faces)這類「腳底基線」語意不成立、"
                         "生圖模型每格本就置中的 sheet。")
    args = ap.parse_args()

    img = Image.open(args.sheet).convert("RGBA")
    cw, ch = img.width // GRID, img.height // GRID
    baseline = round(ch * BASELINE_FRAC)
    # 輸出格邊長:來源尺寸(如 1254)常不被 4 整除,切格會累積 0.5px 誤差且輸出無法整數均分。
    # 用固定 ocw 建輸出畫布(ocw*4),每格獨立貼入 → 輸出保證可被 4 整除。
    ocw = och = args.cell if args.cell else cw

    lifts = [0] * (GRID * GRID)
    if args.lift:
        lifts = [int(x) for x in args.lift.split(",")]
        if len(lifts) != GRID * GRID:
            print(f"--lift 需要 {GRID * GRID} 個值,收到 {len(lifts)}", file=sys.stderr)
            return 1

    out_baseline = round(och * BASELINE_FRAC)
    out = Image.new("RGBA", (ocw * GRID, och * GRID), (0, 0, 0, 0)) if args.out else None
    print(f"來源格 {cw}x{ch} -> 輸出格 {ocw}x{och} 基線 y={out_baseline}(frac {BASELINE_FRAC})縮放 {args.scale}")

    # 先過一遍:清碎片、縮放、量測,並取「貼地幀軀幹質心相對腳底的中位高度」當空中幀的軀幹基準
    cells = []
    grounded_torso_off = []
    for i in range(GRID * GRID):
        r, c = divmod(i, GRID)
        cell = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        cell = clean_cell(cell)
        if args.scale != 1.0:
            sw, sh = round(cw * args.scale), round(ch * args.scale)
            cell = cell.resize((sw, sh), Image.NEAREST)
        box = cell_bbox(cell)
        ty = torso_y(cell)
        cells.append((cell, box, ty))
        if box is not None and ty is not None and lifts[i] == 0:
            grounded_torso_off.append(box[3] - ty)  # 腳底到軀幹質心的距離
    torso_off = float(np.median(grounded_torso_off)) if grounded_torso_off else None

    for i in range(GRID * GRID):
        r, c = divmod(i, GRID)
        cell, box, ty = cells[i]
        if box is None:
            print(f"  格{i + 1:2d}: 空格,跳過")
            continue
        x0, y0, x1, y1 = box
        if args.no_anchor:
            # 不對齊:整格內容以 bbox 中心置中到輸出格中心,保留原圖的垂直姿態
            # (水平飛/肖像沒有一致腳底基線,腳底對齊會把飛行幀拉歪)
            tx = round(ocw / 2 - (x0 + x1) / 2)
            ty_dst = round(och / 2 - (y0 + y1) / 2)
            mode = "center"
        else:
            rx = root_x(cell, box)
            # 目標:root 對到「輸出格中心」,腳底/軀幹對到「輸出格基線」(以輸出格座標為準)
            tx = round(ocw / 2 - rx)
            if lifts[i] > 0 and ty is not None and torso_off is not None:
                # 空中幀:軀幹質心跟拋物線(基線上方 torso_off + lift),不受收腿影響
                ty_dst = round(out_baseline - torso_off - lifts[i] - ty)
                mode = "torso"
            else:
                ty_dst = out_baseline - lifts[i] - y1
                mode = "feet"
        rx_str = f"{rx:5.1f}" if not args.no_anchor else "  -  "
        print(f"  格{i + 1:2d}: bbox 底 y={y1:3d} 高={y1 - y0:3d} root x={rx_str} -> dx={tx:+4d} dy={ty_dst:+4d} lift={lifts[i]} [{mode}]")
        if out is not None:
            sprite = cell.crop(box)
            out.paste(sprite, (c * ocw + x0 + tx, r * och + y0 + ty_dst), sprite)

    if out is not None:
        out.save(args.out)
        print(f"寫出 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
