"""
The wild trees made with ChatGPT (data/townProps.json, sheet "trees2"), one
sheet a season: assets/lpc/Terrain/trees2_<season>.png.

The sources (assets/lpc/Terrain/trees2_source_<season>.png) are 4x4 grids of
16 trees in the same order every season, drawn about three times the size of
the LPC trees. Each grid cell is cut by its outline (dropping the faint haze
round it), scaled like the palms (scripts/make_palm_sheet.py: a 3x4-tile cell,
96x128, trunk at the bottom middle) and packed 8 to a row:

  row 0: oak, birch, willow, apple, cherry, maple, golden birch, cypress
  row 1: spruce, gnarled tree, sapling, dead tree, pear, linden, poplar, great oak

(ChatGPT drew the summer source on a painted checkerboard, not true transparency;
the source kept here already has it keyed out.)

Run from the repo root: python scripts/make_tree_sheet.py
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_palm_sheet as P  # noqa: E402  (fit: scale into a 96x128 cell, foot at the bottom middle)

DIR = 'assets/lpc/Terrain'
SEASONS = ['spring', 'summer', 'autumn', 'winter']
SCALE = 0.34          # the trees' size against the LPC trees
ALPHA_CUT = 170       # below this the source is haze, not tree
MARGIN = 60           # px past its square a tree may reach
N = 4


def cells(src):
    a = np.array(src)
    H, W = a.shape[:2]
    ch, cw = H / N, W / N
    out = []
    for r in range(N):
        for c in range(N):
            # a tree may poke past its square (a tall spruce's tip into the row above):
            # look a margin wider and keep the pieces whose middle lies in the square
            y0, y1 = int(r * ch), int((r + 1) * ch)
            x0, x1 = int(c * cw), int((c + 1) * cw)
            Y0, Y1 = max(0, y0 - MARGIN), min(H, y1 + MARGIN)
            X0, X1 = max(0, x0 - MARGIN), min(W, x1 + MARGIN)
            sub = a[Y0:Y1, X0:X1].copy()
            mask = sub[..., 3] >= ALPHA_CUT
            lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
            sizes = ndimage.sum(mask, lab, range(1, n + 1))
            cents = ndimage.center_of_mass(mask, lab, range(1, n + 1))
            ids = [i + 1 for i in range(n)
                   if sizes[i] > sizes.max() * 0.04
                   and y0 <= cents[i][0] + Y0 < y1 and x0 <= cents[i][1] + X0 < x1]
            keep = np.isin(lab, ids) & mask
            sub[~keep] = 0
            sub[keep, 3] = 255
            im = Image.fromarray(sub, 'RGBA')
            out.append(im.crop(im.getbbox()))
    return out


def main():
    srcs = {s: cells(Image.open(os.path.join(DIR, f'trees2_source_{s}.png')).convert('RGBA')) for s in SEASONS}
    for s in SEASONS:
        trees = srcs[s]
        sheet = Image.new('RGBA', (P.CELL_W * 8, P.CELL_H * 2), (0, 0, 0, 0))
        for i, im in enumerate(trees):
            # one scale for a tree in every season (the one that fits its biggest drawing),
            # so it keeps its size as the year turns
            P.SCALE = min(min(SCALE, (P.CELL_W - 2) / t.width, (P.CELL_H - 8) / t.height)
                          for t in (srcs[x][i] for x in SEASONS))
            sheet.alpha_composite(P.fit(im), ((i % 8) * P.CELL_W, (i // 8) * P.CELL_H))
        out = os.path.join(DIR, f'trees2_{s}.png')
        sheet.save(out)
        print('wrote', out, sheet.size)


if __name__ == '__main__':
    main()
