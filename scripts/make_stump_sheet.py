"""
The stumps the felled trees leave (data/townProps.json sheet "stumps",
tp_stump_*), one sheet a season: assets/lpc/Terrain/stumps_<season>.png.

Drawn with ChatGPT from the tree sheet (scripts/make_tree_sheet.py) as the
reference, so each matches its tree's bark, roots and size:

  assets/lpc/new/stumps_source.png         the 16 tree stumps, 4x4, the trees' order
  assets/lpc/new/stumps_winter_source.png  the same with snow on them
  assets/lpc/new/palm_stumps_source.png    four palm stumps in a row: tall palm,
                                           young palm, dead palm, low palm

Each grid cell is keyed off its background (make_new_windows.key_white), the
stump and the chips beside it kept together, and fitted to its own tree: the
tree's trunk is measured on the tree sheet (its width TRUNK_ROWS above its foot,
over the root flare and under the crown) and the stump is scaled so its cut
trunk (just under the cut face) is that wide, starting from the tree's own scale
on the sheet (never larger: a broad tree's flared foot reads wider than its
trunk). The palm stumps are fitted the same way to their palms on the palm sheet.
Each is set in a 3x2-tile cell (96x64) with the stump's foot where the tree's
trunk stands: the bottom middle, 6px up (make_palm_sheet.fit), so a tree and its
stump share an anchor and the stump stands exactly where the trunk did:

  row 0: oak, birch, willow, apple, cherry, maple, golden birch, cypress
  row 1: spruce, gnarled tree, sapling, dead tree, pear, linden, poplar, great oak
  row 2: palm, young palm, dead palm, low palm

Spring, summer and autumn share the plain drawing; winter has the snow (the
palms keep none: they grow where it doesn't fall).

Run from the repo root: python scripts/make_stump_sheet.py [--preview out.png]
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_tree_sheet as TS  # noqa: E402  (the trees' cells and scale)
import make_palm_sheet as P  # noqa: E402
from make_new_windows import key_white  # noqa: E402

NEW = 'assets/lpc/new'
OUT = 'assets/lpc/Terrain'
CW, CH = 96, 64          # a stump's cell: 3x2 tiles
PALM_FOOT = 24           # px across a tall palm's foot on the palm sheet: where the palm stumps' fitting starts
# The palm each palm stump is fitted to on the palm sheet (assets/lpc/Terrain/palm_trees.png, 12 a row):
# a tall palm, the young palm, the dead palm; the low palm's trunk is hidden in its fronds,
# so its stump takes the tall palm stump's scale
PALM_CELLS = (0, 12, 13, None)
TRUNK_ROWS = (8, 9, 10)  # rows above a tree's foot its trunk is measured on: above the root flare, under the crown
CUT_AT = (0.72, 0.8)     # how far up a stump its cut trunk is measured (just under the cut face)
FOOT = 6                 # px from the cell's bottom to the trunk's foot (as the trees)
N = 4


def grid_cells(im, cols, rows):
    """Each grid cell's drawing (stump and chips), cropped to itself, and the stump's own box."""
    a = np.array(im)
    H, W = a.shape[:2]
    out = []
    for r in range(rows):
        for c in range(cols):
            y0, y1 = int(r * H / rows), int((r + 1) * H / rows)
            x0, x1 = int(c * W / cols), int((c + 1) * W / cols)
            sub = a[y0:y1, x0:x1].copy()
            mask = sub[..., 3] > 0
            lab, n = ndimage.label(mask)
            if n == 0:
                raise SystemExit(f'empty cell {r},{c}')
            sizes = ndimage.sum(mask, lab, range(1, n + 1))
            # specks under a few px are keying dust; the biggest blob is the stump
            keep = [i + 1 for i in range(n) if sizes[i] >= 12]
            sub[~np.isin(lab, keep)] = 0
            main = lab == (int(np.argmax(sizes)) + 1)
            ys, xs = np.where(main)
            cim = Image.fromarray(sub, 'RGBA')
            bb = cim.getbbox()
            body = (xs.min() - bb[0], ys.min() - bb[1], xs.max() - bb[0], ys.max() - bb[1])
            out.append((cim.crop(bb), body))
    return out


def shrink(img, s):
    """Scale down premultiplied, hard alpha edges (as make_palm_sheet.fit)."""
    w, h = img.size
    a = np.array(img).astype(np.float32)
    a[:, :, :3] *= a[:, :, 3:4] / 255.0
    pm = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    small = pm.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    b = np.array(small).astype(np.float32)
    al = b[:, :, 3:4] / 255.0
    b[:, :, :3] = np.where(al > 0, b[:, :, :3] / np.maximum(al, 1e-3), 0)
    b[:, :, 3] = np.where(b[:, :, 3] >= 110, 255, 0)
    b[b[:, :, 3] == 0] = 0
    return Image.fromarray(b.clip(0, 255).astype(np.uint8), 'RGBA')


def place(drawing, body, s):
    """The drawing scaled by s into a 96x64 cell, the stump's foot at the bottom middle."""
    small = shrink(drawing, s)
    bx0, by0, bx1, by1 = (v * s for v in body)
    fx = (bx0 + bx1) / 2
    cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    ox = round(CW / 2 - fx)
    oy = round(CH - FOOT - by1)
    cell.paste(small, (ox, oy), small)
    return cell


def _run(row, x):
    """The length of the run of solid pixels through column x of a row (0 when x is clear)."""
    if not row[x]:
        near = np.where(row)[0]
        if not len(near):
            return 0, x
        x = int(near[np.argmin(np.abs(near - x))])
    a = x
    while a > 0 and row[a - 1]:
        a -= 1
    b = x
    while b < len(row) - 1 and row[b + 1]:
        b += 1
    return b - a + 1, (a + b) / 2


def run_width(mask, cx, rows):
    """How wide it is through column cx at these rows up from its bottom, averaged."""
    ys = np.where(mask.any(axis=1))[0]
    bottom = ys[-1]
    ws = [_run(mask[bottom - k], int(round(cx)))[0] for k in rows]
    return float(np.mean(ws))


def palm_bases():
    """The palms' trunk widths on the palm sheet (px), by PALM_CELLS (None where hidden)."""
    sheet = np.array(Image.open(os.path.join(OUT, 'palm_trees.png')).convert('RGBA'))[..., 3] > 0
    out = []
    for i in PALM_CELLS:
        if i is None:
            out.append(None)
            continue
        cell = sheet[(i // 12) * P.CELL_H:(i // 12 + 1) * P.CELL_H, (i % 12) * P.CELL_W:(i % 12 + 1) * P.CELL_W]
        out.append(run_width(cell, P.CELL_W // 2, TRUNK_ROWS))
    return out


def tree_bases(season='summer'):
    """Each tree's trunk width on the tree sheet (px): above the root flare, under the crown."""
    sheet = np.array(Image.open(os.path.join(OUT, f'trees2_{season}.png')).convert('RGBA'))[..., 3] > 0
    out = []
    for i in range(16):
        cell = sheet[(i // 8) * P.CELL_H:(i // 8 + 1) * P.CELL_H, (i % 8) * P.CELL_W:(i % 8 + 1) * P.CELL_W]
        out.append(run_width(cell, P.CELL_W // 2, TRUNK_ROWS))
    return out


def fit_scale(img, body, s0, want, cut_at=CUT_AT):
    """The scale that makes the stump's cut trunk (just under its cut face) as wide as its tree's
    trunk (want px), from the tree's own scale s0 (the scale ChatGPT drew it at)."""
    small = np.array(shrink(img, s0))[..., 3] > 0
    lab, _ = ndimage.label(small)
    bx = (body[0] + body[2]) / 2 * s0
    by = body[3] * s0
    # the stump's own blob (not the chips beside it)
    ys, xs = np.where(lab > 0)
    k = int(np.argmin((xs - bx) ** 2 + (ys - by * 0.8) ** 2))
    main = lab == lab[ys[k], xs[k]]
    ys = np.where(main.any(axis=1))[0]
    h = ys[-1] - ys[0] + 1
    have = run_width(main, bx, range(int(h * cut_at[0]), int(h * cut_at[1]) + 1))
    s = s0 * want / max(1.0, have)
    # (never past the tree's own scale: a broad tree's flared foot reads wider than its trunk)
    return max(s0 * 0.3, min(s0, s)), have


def tree_scales():
    """Each tree's scale on the tree sheet (make_tree_sheet.main's own sum)."""
    srcs = {s: TS.cells(Image.open(os.path.join(TS.DIR, f'trees2_source_{s}.png')).convert('RGBA')) for s in TS.SEASONS}
    return [min(min(TS.SCALE, (P.CELL_W - 2) / t.width, (P.CELL_H - 8) / t.height)
                for t in (srcs[x][i] for x in TS.SEASONS)) for i in range(16)]


def main():
    preview = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--preview' else None
    # Each stump fitted to its own tree: scaled so its foot is as wide as the trunk's foot on
    # the tree sheet (starting from the tree's own scale, which ChatGPT drew them at)
    scales0 = tree_scales()
    bases = tree_bases()
    plain = grid_cells(key_white(Image.open(os.path.join(NEW, 'stumps_source.png'))), N, N)
    snowy = grid_cells(key_white(Image.open(os.path.join(NEW, 'stumps_winter_source.png'))), N, N)
    palms = grid_cells(key_white(Image.open(os.path.join(NEW, 'palm_stumps_source.png'))), 4, 1)
    # ChatGPT drew the palm stumps bigger than the palms: one scale for the four, the
    # tall palm's stump as wide as a tall palm's foot on the palm sheet
    palm0 = PALM_FOOT / (palms[0][1][2] - palms[0][1][0] + 1)
    palm_scales = []
    for i, ((img, body), want) in enumerate(zip(palms, palm_bases())):
        if want is None:
            palm_scales.append(palm_scales[0])
            continue
        sc, have = fit_scale(img, body, palm0, want)
        palm_scales.append(sc)
        print(f'palm stump {i}: trunk {want:.1f}px, stump cut {have:.1f}px -> scale {sc:.3f}')
    scales = []
    for i, (img, body) in enumerate(plain):
        # (the dead tree's stump is broken off in spikes: its trunk is measured lower down)
        sc, have = fit_scale(img, body, scales0[i], bases[i], (0.4, 0.5) if i == 11 else CUT_AT)
        scales.append(sc)
        print(f'stump {i:2d}: trunk {bases[i]:.1f}px, stump cut {have:.1f}px at the tree scale -> scale x{sc / scales0[i]:.2f}')
    sheets = {}
    for season in TS.SEASONS:
        src = snowy if season == 'winter' else plain
        sheet = Image.new('RGBA', (CW * 8, CH * 3), (0, 0, 0, 0))
        for i, (img, body) in enumerate(src):
            sheet.alpha_composite(place(img, body, scales[i]), ((i % 8) * CW, (i // 8) * CH))
        for i, (img, body) in enumerate(palms):
            sheet.alpha_composite(place(img, body, palm_scales[i]), (i * CW, 2 * CH))
        out = os.path.join(OUT, f'stumps_{season}.png')
        sheet.save(out)
        sheets[season] = sheet
        print('wrote', out, sheet.size)
    if preview:
        # each tree over its stump, side by side, 3x: summer and winter
        trees = {s: Image.open(os.path.join(OUT, f'trees2_{s}.png')).convert('RGBA') for s in ('summer', 'winter')}
        pv = Image.new('RGBA', (16 * 2 * P.CELL_W, 2 * (P.CELL_H + 8)), (110, 150, 80, 255))
        for k, s in enumerate(('summer', 'winter')):
            for i in range(16):
                tr = trees[s].crop(((i % 8) * P.CELL_W, (i // 8) * P.CELL_H, (i % 8 + 1) * P.CELL_W, (i // 8 + 1) * P.CELL_H))
                st = sheets[s].crop(((i % 8) * CW, (i // 8) * CH, (i % 8 + 1) * CW, (i // 8 + 1) * CH))
                y = k * (P.CELL_H + 8)
                pv.alpha_composite(tr, (i * 2 * P.CELL_W, y))
                pv.alpha_composite(st, (i * 2 * P.CELL_W + P.CELL_W, y + P.CELL_H - CH))
        pv = pv.resize((pv.width * 2, pv.height * 2), Image.NEAREST)
        pv.save(preview)
        print('preview', preview)


if __name__ == '__main__':
    main()
