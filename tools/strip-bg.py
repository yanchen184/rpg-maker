#!/usr/bin/env python3
"""Remove baked-in checkerboard 'transparency' background from generated sheets.

Flood-fills from image borders through pixels matching the checkerboard
colors (sampled from the corners) and sets them to alpha 0. Enclosed
regions (e.g. white screen glare inside a dark bezel) are untouched.

Usage: strip-bg.py <sheet.png> [...]  (edits in place; skips sheets already transparent)
"""
import sys
from collections import deque

from PIL import Image

TOL = 26  # per-channel tolerance against sampled checker colors


def sample_checker_colors(px, w, h):
    """Collect distinct colors along the border; checkerboard has ~2."""
    seen = {}
    for x in range(0, w, 7):
        for y in (0, 1, h - 2, h - 1):
            c = px[x, y][:3]
            seen[c] = seen.get(c, 0) + 1
    for y in range(0, h, 7):
        for x in (0, 1, w - 2, w - 1):
            c = px[x, y][:3]
            seen[c] = seen.get(c, 0) + 1
    colors = sorted(seen.items(), key=lambda kv: -kv[1])
    return [c for c, _ in colors[:3]]


def is_bg(color, checkers):
    return any(all(abs(color[i] - ck[i]) <= TOL for i in range(3)) for ck in checkers)


def strip(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    if px[2, 2][3] < 250:
        print(f"SKIP {path} (already transparent)")
        return
    checkers = sample_checker_colors(px, w, h)
    q = deque()
    visited = bytearray(w * h)
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    removed = 0
    while q:
        x, y = q.popleft()
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        c = px[x, y]
        if not is_bg(c, checkers):
            continue
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        if x > 0:
            q.append((x - 1, y))
        if x < w - 1:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y < h - 1:
            q.append((x, y + 1))
    im.save(path)
    pct = 100.0 * removed / (w * h)
    print(f"DONE {path} checkers={checkers} removed={removed}px ({pct:.1f}%)")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        strip(p)
