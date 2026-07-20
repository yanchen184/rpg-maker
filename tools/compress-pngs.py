#!/usr/bin/env python3
"""
壓縮 assets/raw 下的 sprite sheet PNG,降首屏載入量。

做法:
  1. 首次執行先把原檔完整備份到 assets/raw-original/(可一鍵回退)。
  2. 對每張 PNG 做調色盤量化(最多 256 色)+ optimize 重壓。
     像素風 sheet 用 256 色調色盤幾乎無感,但檔案大幅縮小。
  3. RGBA(有透明)的用 method=2 量化保留 alpha;RGB 的直接量化。

安全性:
  - 只在「壓後真的比較小」時才覆蓋,否則保留原檔(避免越壓越大)。
  - 原檔已備份在 raw-original/,要回退:cp raw-original/* raw/。

用法:
  python3 tools/compress-pngs.py            # 全套壓
  python3 tools/compress-pngs.py --dry      # 只估算不寫檔
  python3 tools/compress-pngs.py --restore  # 從備份還原
"""
import os
import shutil
import sys
from PIL import Image

RAW = 'assets/raw'
BACKUP = 'assets/raw-original'
MAX_COLORS = 256


def human(n: int) -> str:
    return f'{n / 1024:.0f}KB' if n < 1024 * 1024 else f'{n / 1024 / 1024:.1f}MB'


def restore() -> None:
    if not os.path.isdir(BACKUP):
        print('沒有備份可還原:', BACKUP)
        return
    n = 0
    for f in os.listdir(BACKUP):
        if f.endswith('.png'):
            shutil.copy2(os.path.join(BACKUP, f), os.path.join(RAW, f))
            n += 1
    print(f'已從 {BACKUP} 還原 {n} 張 PNG')


def compress_one(path: str, dry: bool) -> tuple[int, int]:
    """回傳 (原大小, 新大小);不縮小就回原大小兩次。"""
    before = os.path.getsize(path)
    im = Image.open(path)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)

    if has_alpha:
        im = im.convert('RGBA')
        # 量化保留 alpha:PIL quantize 對 RGBA 用 method=2(FASTOCTREE)可保透明
        q = im.quantize(colors=MAX_COLORS, method=2)
    else:
        im = im.convert('RGB')
        q = im.quantize(colors=MAX_COLORS, method=2)

    tmp = path + '.tmp'
    q.save(tmp, 'PNG', optimize=True)
    after = os.path.getsize(tmp)

    if after < before and not dry:
        os.replace(tmp, path)
    else:
        os.remove(tmp)
        if after >= before:
            after = before  # 沒縮小,保留原檔
    return before, after


def main() -> None:
    dry = '--dry' in sys.argv
    if '--restore' in sys.argv:
        restore()
        return

    if not os.path.isdir(BACKUP):
        os.makedirs(BACKUP, exist_ok=True)
        for f in os.listdir(RAW):
            if f.endswith('.png'):
                shutil.copy2(os.path.join(RAW, f), os.path.join(BACKUP, f))
        print(f'已備份原檔到 {BACKUP}')

    files = sorted(f for f in os.listdir(RAW) if f.endswith('.png'))
    total_before = total_after = 0
    for f in files:
        b, a = compress_one(os.path.join(RAW, f), dry)
        total_before += b
        total_after += a
        pct = (1 - a / b) * 100 if b else 0
        flag = '' if a < b else '  (未縮小,保留原檔)'
        print(f'{f:42s} {human(b):>8s} -> {human(a):>8s}  -{pct:4.0f}%{flag}')

    print('─' * 70)
    print(f'{"總計":42s} {human(total_before):>8s} -> {human(total_after):>8s}  '
          f'-{(1 - total_after / total_before) * 100:.0f}%'
          + ('  [DRY,未寫檔]' if dry else ''))


if __name__ == '__main__':
    main()
