"""
Body armour and the leather cap as LPC character layers (data/arms.json
sprite.layer), from ChatGPT redraws fitted to the LPC frames.

The sources (assets/lpc/new/arms/<name>_source.png) are ChatGPT's redraws of
a reference made here: the LPC body in its four facings (the 'Idle' frame of
each row: front, left, back, right), upscaled 8x, wearing the grey long-sleeved
shirt (or, for the cap, the Norman helm). ChatGPT drew the armour in place of
the shirt (the cap in place of the helm). Nothing is drawn in this script:

 1. Each source figure is registered to its reference frame (their bounding
    boxes), and the redraw is read back one art pixel at a time inside the
    shirt's own pixels (so the armour has the shirt's exact silhouette), its
    colours reduced to a small palette.
 2. Every frame of every animation of the shirt (the uncoloured template
    sheets under Clothing/<build>/Torso/<shirt>/) is then filled from the
    redraw of its facing: the frame is aligned to that facing's reference
    (the offset where the most shading levels agree), and each of its pixels
    takes the redraw's colour at the same place when the shirt's shading
    level agrees there, else the colour of the nearest redraw pixel with the
    same shading level and the same checker parity (so a mail weave or a
    quilting row carries on down a moving sleeve).
 3. The cap: the Norman helm's four views are the cap's silhouette (cut at the
    brow, so no nasal and no cheek pieces), coloured from the redraw; every
    frame of the helm's sheets is one of the four views moved, and the cap is
    put where the helm is.

Writes assets/lpc/Characters/Clothing/<build>/Armour/<Name>/<anim>.png and
assets/lpc/Characters/Head Accessories/Cap 01 - Leather/Leather/<anim>.png.
Run from the repo root: python scripts/make_arms_wear.py
"""
import glob
import hashlib
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402

C = 'assets/lpc/Characters/'
SRC = 'assets/lpc/new/arms/'
BUILDS = {'Masculine, Thin': ('Body 02 - Masculine, Thin', 'Head 02 - Masculine'),
          'Feminine, Thin': ('Body 01 - Feminine, Thin', 'Head 01 - Feminine')}
LONG = 'Shirt 01 - Longsleeve Shirt'
TEE = 'Shirt 04 - T-shirt'
# name: (source, the shirt whose silhouette it takes)
ARMOURS = {
    'Gambeson': ('gambeson_source.png', LONG),
    'Leather': ('leather_source.png', TEE),
    'Mail': ('mail_source.png', LONG),
    'Brigandine': ('brigandine_source.png', TEE),
    'Plate': ('plate_source.png', LONG),
}
# the template shirt's shading levels (outline .. highlight)
LEVELS = {(42, 23, 34): 0, (39, 25, 32): 0, (111, 100, 100): 1, (149, 128, 128): 2,
          (196, 181, 159): 3, (227, 231, 211): 4, (235, 237, 233): 5}
# the reference sheet (scratch refs, see the docstring): the facings in the order drawn, and each frame's crop
REF_ROWS = (2, 1, 0, 3)
REF_CROP = (8, 4, 56, 64)
HELM_CROP = (16, 4, 48, 36)
HELM = 'Head Accessories/Helm 03 - Norman/'
CAP = 'Head Accessories/Cap 01 - Leather/Leather/'


def frame(layers, anim, r, f):
    out = Image.new('RGBA', (64, 64))
    for l in layers:
        p = C + l + '/' + anim + '.png'
        if os.path.exists(p):
            out.alpha_composite(Image.open(p).convert('RGBA').crop((f * 64, r * 64, f * 64 + 64, r * 64 + 64)))
    return out


def figures(path, n=4):
    """The bounding boxes of the n figures in a ChatGPT source, left to right."""
    im = key_white(Image.open(path).convert('RGB'), tol=30)
    a = np.array(im)[..., 3] > 0
    cols = a.sum(axis=0) > 2
    runs, x = [], 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]:
                x += 1
            runs.append([s, x])
        x += 1
    runs = sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:n]
    runs.sort()
    boxes = []
    for s, e in runs:
        rows = np.where(a[:, s:e].any(axis=1))[0]
        boxes.append((s, rows.min(), e, rows.max() + 1))
    return Image.open(path).convert('RGB'), boxes


def sample(src, box_out, box_ref, mask, crop):
    """The redraw read back on the reference frame's grid: {(x, y): rgb} for the pixels in mask."""
    X0, Y0, X1, Y1 = box_out
    x0, y0, x1, y1 = box_ref
    sx, sy = (X1 - X0) / (x1 - x0), (Y1 - Y0) / (y1 - y0)
    a = np.array(src).astype(int)
    out = {}
    for (x, y) in mask:
        cx = X0 + (x + 0.5 - x0) * sx
        cy = Y0 + (y + 0.5 - y0) * sy
        wx, wy = max(1, int(sx * 0.22)), max(1, int(sy * 0.22))
        win = a[int(cy) - wy:int(cy) + wy + 1, int(cx) - wx:int(cx) + wx + 1].reshape(-1, 3)
        out[(x, y)] = tuple(int(v) for v in np.median(win, axis=0))
    return out


def reduce(colours, k=10, iters=12):
    """k-means the sampled colours down to a small palette; returns {key: rgb}."""
    keys = list(colours)
    pts = np.array([colours[q] for q in keys], dtype=float)
    k = min(k, len(pts))
    order = np.argsort(pts.sum(axis=1))
    cent = pts[order[np.linspace(0, len(pts) - 1, k).astype(int)]]
    for _ in range(iters):
        lab = ((pts[:, None] - cent[None]) ** 2).sum(axis=2).argmin(axis=1)
        for j in range(k):
            if (lab == j).any():
                cent[j] = pts[lab == j].mean(axis=0)
    lab = ((pts[:, None] - cent[None]) ** 2).sum(axis=2).argmin(axis=1)
    return {q: tuple(int(v) for v in cent[lab[i]]) for i, q in enumerate(keys)}


def levels(img):
    """{(x, y): level} of a template frame's opaque pixels."""
    px = img.load()
    out = {}
    for y in range(img.height):
        for x in range(img.width):
            p = px[x, y]
            if p[3] > 0:
                out[(x, y)] = LEVELS.get(p[:3], 2)
    return out


def fill(target, ref_lv, ref_col, lookup):
    """A target template frame's levels filled from a facing's redraw (see the docstring)."""
    if not target:
        return {}
    best, off = -1, (0, 0)
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            n = sum(1 for (x, y), l in target.items() if ref_lv.get((x - dx, y - dy)) == l)
            if n > best:
                best, off = n, (dx, dy)
    dx, dy = off
    out = {}
    for (x, y), l in target.items():
        q = (x - dx, y - dy)
        if ref_lv.get(q) == l and q in ref_col:
            out[(x, y)] = ref_col[q]
            continue
        cands = lookup.get((l, (x + y) % 2)) or lookup.get((l, 1 - (x + y) % 2))
        if not cands:
            near = min(ref_lv, key=lambda p: abs(ref_lv[p] - l))
            out[(x, y)] = ref_col.get(near, (90, 90, 90))
            continue
        qx, qy = q
        p = min(cands, key=lambda c: (c[0] - qx) ** 2 + (c[1] - qy) ** 2)
        out[(x, y)] = ref_col[p]
    return out


def armour(name, source, shirt):
    path = SRC + source
    if not os.path.exists(path):
        print('skip', name, '(no source)')
        return
    src, boxes = figures(path)
    base_m = ['Body/Body 02 - Masculine, Thin/Peach', 'Head/Head 02 - Masculine/Peach',
              'Clothing/Masculine, Thin/Legs/Pants 03 - Pants/Charcoal']
    # the facings' redraws on the reference grid
    facing = {}
    for i, r in enumerate(REF_ROWS):
        full = frame(base_m + ['Clothing/Masculine, Thin/Torso/' + LONG + '/Gray'], 'Idle', r, 0).crop(REF_CROP)
        bb = full.getbbox()
        tmpl = Image.open(C + 'Clothing/Masculine, Thin/Torso/' + LONG + '/Idle.png').convert('RGBA')
        lv = levels(tmpl.crop((0, r * 64, 64, r * 64 + 64)))
        lv = {(x - REF_CROP[0], y - REF_CROP[1]): l for (x, y), l in lv.items()}
        col = sample(src, boxes[i], bb, lv.keys(), REF_CROP)
        facing[r] = (lv, col)
    # one palette for the whole piece
    allc = {(r, q): c for r, (lv, col) in facing.items() for q, c in col.items()}
    red = reduce(allc, k=10)
    for r in facing:
        lv, col = facing[r]
        col = {q: red[(r, q)] for q in col}
        # the outline stays the LPC dark
        for q, l in lv.items():
            if l == 0:
                col[q] = (27, 25, 43)
        lookup = {}
        for (x, y), l in lv.items():
            lookup.setdefault((l, (x + y) % 2), []).append((x, y))
        facing[r] = (lv, col, lookup)
    for build in BUILDS:
        tdir = C + 'Clothing/' + build + '/Torso/' + shirt + '/'
        odir = C + 'Clothing/' + build + '/Armour/' + name + '/'
        os.makedirs(odir, exist_ok=True)
        for tp in sorted(glob.glob(tdir + '*.png')):
            anim = os.path.basename(tp)[:-4]
            if anim == 'Demo':
                continue
            t = Image.open(tp).convert('RGBA')
            out = Image.new('RGBA', t.size)
            px = out.load()
            rows = t.height // 64
            for r in range(rows):
                face = r if rows == 4 else 0
                lv, col, lookup = facing[face]
                for f in range(t.width // 64):
                    cell = t.crop((f * 64, r * 64, f * 64 + 64, r * 64 + 64))
                    tl = {(x - REF_CROP[0], y - REF_CROP[1]): l for (x, y), l in levels(cell).items()}
                    for (x, y), c in fill(tl, lv, col, lookup).items():
                        px[f * 64 + x + REF_CROP[0], r * 64 + y + REF_CROP[1]] = c + (255,)
            out.save(odir + anim + '.png')
        print(name, build, 'done')


def cap():
    path = SRC + 'cap_source.png'
    if not os.path.exists(path):
        print('skip cap (no source)')
        return
    src, boxes = figures(path)
    idle = Image.open(C + HELM + 'Idle.png').convert('RGBA')
    views = {}
    for i, r in enumerate(REF_ROWS):
        cell = idle.crop((0, r * 64, 64, r * 64 + 64))
        bb = cell.getbbox()
        a = np.array(cell)[..., 3] > 0
        # the cap: the helm's dome, cut at the brow (no nasal, no cheek pieces)
        keep = 13 if r != 0 else 15
        mask = [(x, y) for y in range(bb[1], min(bb[3], bb[1] + keep)) for x in range(bb[0], bb[2]) if a[y, x]]
        # the reference head frame (where the source figure stands)
        full = frame(['Body/Body 02 - Masculine, Thin/Peach', 'Head/Head 02 - Masculine/Peach',
                      'Clothing/Masculine, Thin/Torso/' + LONG + '/Gray', 'Hair/Short 01 - Buzzcut/Brown', HELM[:-1] + '/Iron'],
                     'Idle', r, 0).crop(HELM_CROP)
        rb = full.getbbox()
        m2 = [(x - HELM_CROP[0], y - HELM_CROP[1]) for x, y in mask]
        col = sample(src, boxes[i], rb, m2, HELM_CROP)
        views[r] = (bb, {(x + HELM_CROP[0], y + HELM_CROP[1]): c for (x, y), c in col.items()})
    allc = {(r, q): c for r, (bb, col) in views.items() for q, c in col.items()}
    red = reduce(allc, k=7)
    # the outline: the rim of the cap's own silhouette
    for r, (bb, col) in views.items():
        col = {q: red[(r, q)] for q in col}
        for (x, y) in list(col):
            if any((x + dx, y + dy) not in col for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                col[(x, y)] = (42, 23, 34)
        views[r] = (bb, col)
    # the helm's views, by their pixels, to place the cap in every frame
    keyed = {}
    for r in range(4):
        cell = idle.crop((0, r * 64, 64, r * 64 + 64))
        bb = cell.getbbox()
        keyed[hashlib.md5(np.array(cell.crop(bb))[..., 3].tobytes()).hexdigest()] = r
    os.makedirs(C + CAP, exist_ok=True)
    for hp in sorted(glob.glob(C + HELM + 'Iron/*.png')):
        anim = os.path.basename(hp)[:-4]
        h = Image.open(hp).convert('RGBA')
        out = Image.new('RGBA', h.size)
        px = out.load()
        for r in range(h.height // 64):
            for f in range(h.width // 64):
                cell = h.crop((f * 64, r * 64, f * 64 + 64, r * 64 + 64))
                bb = cell.getbbox()
                if not bb:
                    continue
                v = keyed.get(hashlib.md5(np.array(cell.crop(bb))[..., 3].tobytes()).hexdigest())
                if v is None:
                    v = r if h.height // 64 == 4 else 0
                vb, col = views[v]
                dx, dy = bb[0] - vb[0], bb[1] - vb[1]
                for (x, y), c in col.items():
                    X, Y = x + dx, y + dy
                    if 0 <= X < 64 and 0 <= Y < 64:
                        px[f * 64 + X, r * 64 + Y] = c + (255,)
        out.save(C + CAP + anim + '.png')
    print('cap done')


if __name__ == '__main__':
    which = sys.argv[1:]
    for name, (source, shirt) in ARMOURS.items():
        if not which or name in which:
            armour(name, source, shirt)
    if not which or 'Cap' in which:
        cap()
