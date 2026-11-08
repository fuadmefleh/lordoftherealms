"""
The wild bushes and rocks made with ChatGPT (data/townProps.json, sheets
"bushes" and "rocks2"), cut the way the trees are (scripts/make_tree_sheet.py).

Sources, 4x4 grids of 16 in the same order:
  assets/lpc/Terrain/bushes_source_<season>.png   (one a season)
  assets/lpc/Terrain/rocks2_source.png            (rocks don't turn with the year)

Bushes are set in a 3x2-tile cell (96x64), rocks in a 3x3-tile cell (96x96),
foot at the bottom middle, 8 to a row. One scale per slot across the seasons,
so a bush keeps its size as the year turns.

  bushes row 0: leafy, low, red berry, blueberry, holly, hawthorn, wild rose, fern
  bushes row 1: reeds, juniper, heather, boxwood, bramble, shrub, lavender, hedge

Like the trees, a bush or rock blocks only the bottom middle cell, where it
stands (src/world/townProps.js): the rest of it is walked behind.

Run from the repo root: python scripts/make_wild_sheets.py
"""
import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_palm_sheet as P  # noqa: E402  (fit: scale into a cell, foot at the bottom middle)
import make_tree_sheet as TS  # noqa: E402  (cells: cut a 4x4 grid by its outlines)

DIR = 'assets/lpc/Terrain'
SEASONS = ['spring', 'summer', 'autumn', 'winter']


def sheet_of(imgs, scales, cw, ch, bottom=6):
    P.CELL_W, P.CELL_H = cw, ch
    sheet = Image.new('RGBA', (cw * 8, ch * 2), (0, 0, 0, 0))
    for i, im in enumerate(imgs):
        P.SCALE = scales[i]
        cell = P.fit(im)
        if bottom != 6:  # set the foot lower/higher than the palms' 6px
            a = np.array(cell)
            rows = np.where(a[..., 3].any(axis=1))[0]
            shift = (ch - bottom - 1) - rows[-1]
            cell = Image.fromarray(np.roll(a, shift, axis=0), 'RGBA')
        sheet.alpha_composite(cell, ((i % 8) * cw, (i // 8) * ch))
    return sheet


def bushes(scale=0.2):
    cw, ch = 96, 64
    srcs = {s: TS.cells(Image.open(os.path.join(DIR, f'bushes_source_{s}.png')).convert('RGBA')) for s in SEASONS}
    scales = [min(min(scale, (cw - 2) / t.width, (ch - 8) / t.height) for t in (srcs[s][i] for s in SEASONS))
              for i in range(16)]
    for s in SEASONS:
        out = os.path.join(DIR, f'bushes_{s}.png')
        sheet_of(srcs[s], scales, cw, ch, bottom=4).save(out)
        print('wrote', out)


def rocks(scale=0.24):
    cw, ch = 96, 96
    imgs = TS.cells(Image.open(os.path.join(DIR, 'rocks2_source.png')).convert('RGBA'))
    scales = [min(scale, (cw - 2) / t.width, (ch - 8) / t.height) for t in imgs]
    sheet = sheet_of(imgs, scales, cw, ch, bottom=4)
    out = os.path.join(DIR, 'rocks2.png')
    sheet.save(out)
    print('wrote', out)


if __name__ == '__main__':
    what = sys.argv[1:] or ['bushes', 'rocks']
    if 'bushes' in what:
        bushes()
    if 'rocks' in what:
        rocks()
