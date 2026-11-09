"""
New windows drawn with ChatGPT, cut into the 32px-cell layout of the LPC window
sheets so every building that names a cell keeps working. Written over the 4x
"modern" sheets (assets/modern/lpc/Structure/Windows/*.png, 128px a cell) that
data/innerMapRenderer.json modernSheets points the game at.

Sources (assets/lpc/Structure/Windows/new/):
  tall_source.png    3x3: rows arched / ornate crest / gothic lattice;
                     columns night / day / lit
  small_source.png   3x3: rows small square / round / ogee; same columns

Sheet columns are the states (0 night, 1 day, 2 lit). A tall window is cut into
a top, a middle and a bottom cell, and the arched one is also drawn as top +
bottom alone, so the glass where the cells meet repeats: the window is scaled
to the cell's width, then nudged in height until its panes repeat a whole
number of times in a cell and the bottom cell starts at the same point of the
pattern the top cell ends on. The middle cell is that pattern repeated.

  Stone Windows A       rows 0-2 tall arched, row 3 small square
  Ornamental Windows A  rows 0-2 tall ornate (rows 3-4 unused, cleared)
  Ornamental Windows B  row 0 round, row 1 ogee, rows 2-3 the lattice (top + bottom)

Run from the repo root: python scripts/make_new_windows.py
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = 'assets/lpc/Structure/Windows/new'
OUT = 'assets/modern/lpc/Structure/Windows'
C = 128          # a cell at 4x
WIDTH = 124      # a window's width in its cell


def key_white(im, tol=28):
    """Flood the flat background away from the borders (ChatGPT gives white, not alpha)."""
    a = np.array(im.convert('RGBA')).astype(np.int16)
    bg = a[0, 0, :3]
    near = (np.abs(a[..., :3] - bg).max(axis=2) <= tol)
    lab, _ = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    out = a.astype(np.uint8)
    out[np.isin(lab, list(border)), 3] = 0
    return Image.fromarray(out, 'RGBA')


def pieces(im, n=3):
    """The n x n drawings of a grid source, each cropped to itself."""
    a = np.array(im)
    mask = a[..., 3] > 0
    lab, k = ndimage.label(ndimage.binary_dilation(mask, iterations=3))
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    keep = [i for i in range(k) if sizes[i] > sizes.max() * 0.15]
    boxes = [objs[i] for i in keep]
    H, W = mask.shape
    grid = [[None] * n for _ in range(n)]
    for i, b in zip(keep, boxes):
        cy, cx = (b[0].start + b[0].stop) / 2, (b[1].start + b[1].stop) / 2
        r, c = int(cy / H * n), int(cx / W * n)
        sub = a[b].copy()
        sub[lab[b] != i + 1] = 0
        grid[r][c] = Image.fromarray(sub, 'RGBA')
    assert all(all(x is not None for x in row) for row in grid), 'a drawing is missing'
    return grid


def scale(im, w, h):
    return im.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)


def period(a, y0, y1):
    """The panes' repeat in rows y0..y1 (autocorrelation of the darkness down the middle)."""
    W = a.shape[1]
    band = a[y0:y1, W // 5: W - W // 5]
    lum = (band[..., :3].astype(float) @ [0.3, 0.59, 0.11]) * (band[..., 3] > 0)
    prof = lum.mean(axis=1)
    prof = prof - prof.mean()
    ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
    ac /= ac[0] or 1
    lo = 8
    hi = min(len(ac) - 1, 70)
    best = lo + int(np.argmax(ac[lo:hi]))
    return best


def fit_tall(im, cells):
    """A window cut into `cells` cells (2: top + bottom, 3: top + middle + bottom)."""
    s = WIDTH / im.width
    base = scale(im, WIDTH, im.height * s)
    a = np.array(base)
    H = a.shape[0]
    p = period(a, int(H * 0.4), int(H * 0.75))
    best = None
    for k in range(2, 12):
        pt = C / k                       # the repeat it must become
        f = pt / p
        if not 0.75 <= f <= 1.35:
            continue
        Hf = H * f
        # how far the bottom cell's start (Hf - C) is off the pattern the top cell ends on
        off = ((Hf - C) - C) % pt
        off = min(off, pt - off)
        score = off + abs(f - 1) * 20
        if best is None or score < best[0]:
            best = (score, f, pt)
    _, f, pt = best
    # settle the height so the bottom cell starts exactly on the pattern
    Hf = H * f
    n = round((Hf - 2 * C) / pt)
    Hf = 2 * C + n * pt
    win = np.array(scale(Image.fromarray(a), WIDTH, Hf))
    Hf = win.shape[0]
    canvas = np.zeros((C * cells, C, 4), np.uint8)
    x0 = (C - WIDTH) // 2
    # the pane pattern, starting where the top cell ends
    pattern = lambda n: win[[C + int(y % pt) for y in range(n)]]
    top = win[:C]
    if Hf - C >= C:
        bot = win[Hf - C:]
    else:   # a short window: the pattern carries on down to its lower part
        bot = np.concatenate([pattern(2 * C - Hf), win[C:]])
    canvas[:C, x0:x0 + WIDTH] = top
    canvas[C * (cells - 1):, x0:x0 + WIDTH] = bot
    if cells == 3:
        canvas[C:2 * C, x0:x0 + WIDTH] = pattern(C)
    return canvas, (round(p, 1), round(f, 3), round(pt, 2))


def fit_small(im):
    w = WIDTH
    h = im.height * w / im.width
    if h > C - 4:
        h = C - 4
        w = im.width * h / im.height
    cell = np.zeros((C, C, 4), np.uint8)
    t = np.array(scale(im, w, h))
    y0 = (C - t.shape[0]) // 2
    x0 = (C - t.shape[1]) // 2
    cell[y0:y0 + t.shape[0], x0:x0 + t.shape[1]] = t
    return cell


def put(sheet, col, row, block):
    h = block.shape[0]
    sheet[row * C: row * C + h, col * C: col * C + C] = block


def main():
    tall = pieces(key_white(Image.open(os.path.join(SRC, 'tall_source.png'))))
    small = pieces(key_white(Image.open(os.path.join(SRC, 'small_source.png'))))
    sheets = {
        'Stone Windows A.png': (4, [('tall', 0, 0, 3), ('small', 0, 3, 1)]),
        'Ornamental Windows A.png': (5, [('tall', 1, 0, 3)]),
        'Ornamental Windows B.png': (4, [('small', 1, 0, 1), ('small', 2, 1, 1), ('tall', 2, 2, 2)]),
    }
    for name, (nrows, parts) in sheets.items():
        sheet = np.zeros((nrows * C, 3 * C, 4), np.uint8)
        for kind, src_row, row, cells in parts:
            for col in range(3):
                if kind == 'tall':
                    block, info = fit_tall(tall[src_row][col], cells)
                    print(name, 'row', row, 'col', col, 'period/f/repeat', info)
                else:
                    block = fit_small(small[src_row][col])
                put(sheet, col, row, block)
        out = os.path.join(OUT, name)
        Image.fromarray(sheet, 'RGBA').save(out)
        print('wrote', out)


if __name__ == '__main__':
    sys.exit(main())
