"""
Palm trees for the town props (data/townProps.json, sheet "palms").

The source sheet (assets/lpc/Terrain/palm_trees_source.png, the "LPC Palm
Tree Sprite Sheet") lays its palms out freely, not on a grid, and draws them
about two and a half times the size of the LPC trees. This cuts out each palm
by its outline (dropping the faint haze round it), scales it to sit in a
3x4-tile cell like the oak (96x128), trunk at the bottom middle, and packs
them in order:

  row 0: the twelve full-grown palms
  row 1: a young palm, a dead palm, three low palms, a sprout

Run from the repo root: python scripts/make_palm_sheet.py
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/lpc/Terrain/palm_trees_source.png'
OUT = 'assets/lpc/Terrain/palm_trees.png'
CELL_W, CELL_H = 96, 128
SCALE = 0.40          # the palms' size against the LPC trees
ALPHA_CUT = 110       # below this the source is haze, not palm

# The sprites, by the top-left of their outline in the source (rows read left to right)
FULL = [(43, 91), (32, 379), (14, 665), (24, 965),
        (311, 66), (333, 367), (313, 642), (311, 924),
        (549, 51), (553, 355), (541, 637), (576, 954)]
SMALL = [(1054, 274), (1018, 503), (830, 36), (822, 261), (827, 463), (1097, 79)]


def sprites(src):
    a = np.array(src)
    mask = a[:, :, 3] >= ALPHA_CUT
    lab, _ = ndimage.label(ndimage.binary_dilation(mask, iterations=4))
    out = {}
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        y0, x0 = sl[0].start, sl[1].start
        piece = a[sl].copy()
        own = (lab[sl] == i) & mask[sl]
        piece[~own] = 0
        out[(y0, x0)] = Image.fromarray(piece, 'RGBA')
    return out


def nearest(found, key):
    return min(found.items(), key=lambda kv: abs(kv[0][0] - key[0]) + abs(kv[0][1] - key[1]))[1]


def fit(img):
    """Scale, square up the edges, and set it in a cell with its foot at the bottom middle."""
    w, h = img.size
    s = min(SCALE, (CELL_W - 2) / w, (CELL_H - 2) / h)
    a = np.array(img).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    a[:, :, :3] *= al                      # premultiply, so no dark fringe on scaling
    pm = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    small = pm.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    b = np.array(small).astype(np.float32)
    al2 = b[:, :, 3:4] / 255.0
    b[:, :, :3] = np.where(al2 > 0, b[:, :, :3] / np.maximum(al2, 1e-3), 0)
    b[:, :, 3] = np.where(b[:, :, 3] >= 128, 255, 0)   # crisp pixel edges
    b[b[:, :, 3] == 0] = 0
    small = Image.fromarray(b.clip(0, 255).astype(np.uint8), 'RGBA')
    # The trunk's foot: the middle of the lowest row with anything in it
    arr = np.array(small)[:, :, 3]
    rows = np.where(arr.any(axis=1))[0]
    foot = rows[-1]
    cols = np.where(arr[max(0, foot - 3):foot + 1].any(axis=0))[0]
    fx = int((cols[0] + cols[-1]) / 2)
    cell = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    # (a leaning palm's crown may hang off its foot: keep the whole of it in the cell)
    ox = min(max(0, CELL_W // 2 - fx), CELL_W - small.width)
    oy = CELL_H - 6 - foot
    cell.paste(small, (ox, oy), small)
    return cell


def main():
    src = Image.open(SRC).convert('RGBA')
    found = sprites(src)
    sheet = Image.new('RGBA', (CELL_W * 12, CELL_H * 2), (0, 0, 0, 0))
    for i, key in enumerate(FULL):
        sheet.alpha_composite(fit(nearest(found, key)), (i * CELL_W, 0))
    for i, key in enumerate(SMALL):
        sheet.alpha_composite(fit(nearest(found, key)), (i * CELL_W, CELL_H))
    sheet.save(OUT)
    print('wrote', OUT, sheet.size)


if __name__ == '__main__':
    main()
