#!/usr/bin/env python3
"""把 codex 生的「單方向 1×4 橫條原圖」後處理成規格品 1024x256 透明 PNG。

流程:
  1. border flood-fill 去背(邊緣純色/chroma 當背景) → 轉 alpha
  2. 全圖 alpha 連通元件,抽出「橫向 4 個主體 sprite」(依質心 x 排序)
  3. 4 隻等比縮放到同一目標高(各 sprite 高的中位數,不超過格內可用高)、
     水平置中、共用同一 baseline(貼近底部) → 貼進 1024x256 全透明畫布(4 格各 256 寬)

用法: strip-1x4.py <raw_src.png> <out_1024x256.png> [--baseline 12] [--pad-top 8]
"""
import argparse
from collections import deque

import numpy as np
from PIL import Image
from scipy import ndimage

OUT_W, OUT_H = 1024, 256
CELL = 256
GRID = 4
TOL = 30            # 去背:對 chroma 背景色的每通道容差
MIN_COMPONENT = 200  # px;小於此的連通元件視為雜點


def flood_strip_bg(im: Image.Image) -> Image.Image:
    """從四邊 flood-fill,把與邊緣採樣色相近的像素設為 alpha 0。"""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    # 採樣邊緣主色(chroma 背景通常 1-2 色)
    seen = {}
    for x in range(0, w, 5):
        for y in (0, 1, 2, h - 3, h - 2, h - 1):
            c = px[x, y][:3]
            seen[c] = seen.get(c, 0) + 1
    for y in range(0, h, 5):
        for x in (0, 1, 2, w - 3, w - 2, w - 1):
            c = px[x, y][:3]
            seen[c] = seen.get(c, 0) + 1
    bg_colors = [c for c, _ in sorted(seen.items(), key=lambda kv: -kv[1])[:3]]

    def is_bg(c):
        return any(all(abs(c[i] - b[i]) <= TOL for i in range(3)) for b in bg_colors)

    visited = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    removed = 0
    while q:
        x, y = q.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    print(f"  flood bg_colors={bg_colors} removed={removed}px ({100.0*removed/(w*h):.1f}%)")
    return im


def extract_4_sprites(arr: np.ndarray):
    """全圖抽 alpha 連通元件,取前 4 大(依質心 x 排序)。回傳 4 個 rgba patch。"""
    lab, n = ndimage.label(arr[:, :, 3] > 16)
    if n == 0:
        raise SystemExit("去背後全透明,停")
    sizes = ndimage.sum(arr[:, :, 3] > 16, lab, range(1, n + 1))
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sizes[i] < MIN_COMPONENT:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        comps.append({"id": i + 1, "box": (x0, y0, x1, y1), "cx": (x0 + x1) / 2, "size": sizes[i]})
    comps.sort(key=lambda c: -c["size"])
    comps = comps[:GRID]
    if len(comps) != GRID:
        raise SystemExit(f"抓到 {len(comps)} 個 sprite,期望 {GRID}(調 TOL/MIN_COMPONENT 重試)")
    comps.sort(key=lambda c: c["cx"])
    patches = []
    for comp in comps:
        x0, y0, x1, y1 = comp["box"]
        patch = arr[y0:y1, x0:x1].copy()
        mask = lab[y0:y1, x0:x1] == comp["id"]
        patch[~mask] = 0
        patches.append(patch)
    return patches


def compose(src_path, out_path, baseline, pad_top):
    im = flood_strip_bg(Image.open(src_path))
    arr = np.array(im)
    patches = extract_4_sprites(arr)
    heights = sorted(p.shape[0] for p in patches)
    target_h = heights[len(heights) // 2]  # 中位數高
    max_h = CELL - baseline - pad_top
    target_h = min(target_h, max_h)

    sheet = np.zeros((OUT_H, OUT_W, 4), dtype=np.uint8)
    for c, patch in enumerate(patches):
        ph, pw = patch.shape[:2]
        scale = target_h / ph
        nw, nh = max(1, round(pw * scale)), target_h
        resample = Image.NEAREST if scale >= 1 else Image.LANCZOS
        p = np.array(Image.fromarray(patch).resize((nw, nh), resample))
        tx = int(round(c * CELL + (CELL - nw) / 2))
        ty = OUT_H - baseline - nh
        tx = max(c * CELL, min(tx, (c + 1) * CELL - nw))
        region = sheet[ty:ty + nh, tx:tx + nw]
        np.copyto(region, p, where=(p[:, :, 3:4] > 8))
    Image.fromarray(sheet).save(out_path)
    print(f"composed {out_path}  target_h={target_h} heights={heights} baseline={baseline}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--baseline", type=int, default=12)
    ap.add_argument("--pad-top", type=int, default=8)
    a = ap.parse_args()
    compose(a.src, a.out, a.baseline, a.pad_top)
