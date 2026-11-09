"""
The palms redrawn with ChatGPT (data/townProps.json sheet "palms",
assets/lpc/Terrain/palm_trees.png), in place of the LPC palm sheet that
scripts/make_palm_sheet.py cut.

Source: assets/lpc/new/palms_source.png, 18 palms in reading order: the twelve
full-grown palms, then a young palm, a dead palm, three low palms and a sprout.
One scale for all of them, so they keep the sizes ChatGPT drew them at against
each other, set like the trees in a 3x4-tile cell (96x128), trunk at the
bottom middle (make_palm_sheet.fit), the same layout as before:

  row 0: the twelve full-grown palms
  row 1: young, dead, low, low (coconuts), low fan palm, sprout

Run from the repo root: python scripts/make_new_palms.py
"""
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_palm_sheet as P  # noqa: E402  (fit: scale into a 96x128 cell, foot at the bottom middle)
from make_new_windows import key_white  # noqa: E402
from make_new_props import objects  # noqa: E402

OUT = 'assets/lpc/Terrain/palm_trees.png'
SCALE = 0.34   # as the drawn trees (scripts/make_tree_sheet.py)


def main():
    palms = objects(key_white(Image.open('assets/lpc/new/palms_source.png'), holes=2, clean=True))
    if len(palms) != 18:
        raise SystemExit(f'found {len(palms)} palms, want 18')
    P.SCALE = min([SCALE] + [min((P.CELL_W - 2) / p.width, (P.CELL_H - 8) / p.height) for p in palms])
    sheet = Image.new('RGBA', (P.CELL_W * 12, P.CELL_H * 2), (0, 0, 0, 0))
    for i, p in enumerate(palms):
        sheet.alpha_composite(P.fit(p), ((i % 12) * P.CELL_W, (i // 12) * P.CELL_H))
    sheet.save(OUT)
    print('wrote', OUT, sheet.size, 'scale', round(P.SCALE, 3))


if __name__ == '__main__':
    main()
