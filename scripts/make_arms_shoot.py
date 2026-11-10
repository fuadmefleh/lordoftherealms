"""
The archers' shooting sheets: Props/Bow/Wood/Shoot.png and Props/Crossbow/
Wood/Shoot.png (with _Behind/ twins), 6 frames x 4 facings, 128px cells round
the 64px body like the other weapon sheets.

The LPC Revised bodies have no shoot animation, so the figure's frames are
taken from sheets every layer already has (ui/innerMapCharacters.js SHOOT_PICK
lists them, and must match BODY here): side-on, the ready stance, then the
'Legacy - Swing' frames where the front arm comes up and reaches out toward
the facing (the bow arm); toward or away from the eye, 'Combat 1h - Halfslash'
frames where the fist comes up in front of the chest.

The bow and crossbow are ChatGPT's drawings (assets/lpc/new/arms/
bow_draw_source.png: the bow braced, half drawn with an arrow nocked, at full
draw, and the crossbow in profile, loaded). Nothing is drawn here: each
drawing is cut out, snapped to the LPC wood and steel ramps and placed in the
fist of each frame (positions read off the frames, FIST), like
scripts/make_arms_layers.py places the other weapons. Side-on the bow is drawn
in its three states as the arm comes up (nocked, drawn, full draw, held,
loosed); toward or away from the eye it is seen edge-on, raised in front of
the chest (canted, so it does not cover the face). The crossbow comes up from the hip and is levelled at the
shoulder, kicking back a pixel as it looses; toward or away from the eye it
is the top-down crossbow (weapons_source.png) foreshortened.

Run from the repo root: python scripts/make_arms_shoot.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_arms_layers import CELL, STEEL, WOOD, cut_source, place, quantize  # noqa: E402
from make_new_windows import key_white  # noqa: E402

SRC = 'assets/lpc/new/arms/'
OUT = 'assets/lpc/Characters/Props/'
PAL = list(STEEL) + WOOD[1:]
BOW_LEN = 34.0    # the bow's height in the cell (as scripts/make_arms_layers.py)
XBOW_LEN = 28.0

# the body's frame in each shoot frame (facing rows up, left, down, right) — ui/innerMapCharacters.js SHOOT_PICK
BODY = {
    0: [('Combat 1h - Idle', 0), ('Combat 1h - Halfslash', 1), ('Combat 1h - Halfslash', 2),
        ('Combat 1h - Halfslash', 3), ('Combat 1h - Halfslash', 3), ('Combat 1h - Halfslash', 2)],
    3: [('Combat 1h - Idle', 0), ('Legacy - Swing', 3), ('Legacy - Swing', 4),
        ('Legacy - Swing', 5), ('Legacy - Swing', 5), ('Legacy - Swing', 5)],
}
BODY[2] = BODY[0]
BODY[1] = BODY[3]
# the weapon fist in each of those frames (64px-frame coordinates, read off the LPC frames;
# the left-facing row is the right-facing one mirrored)
FIST = {
    0: [(43.8, 46), (46.4, 40), (37.7, 28), (36, 28), (36, 28), (37.7, 28)],
    2: [(24, 42), (19.4, 42.4), (37.7, 40.6), (39.6, 41.2), (39.6, 41.2), (37.7, 40.6)],
    3: [(42.5, 41), (48.5, 44.5), (49.5, 34.5), (48.5, 32.5), (48.5, 32.5), (48.5, 32.5)],
}
# side-on: which drawing (0 braced, 1 half drawn, 2 full draw) and the bow's lean (degrees toward the facing)
BOW_SIDE = [(0, 14), (0, 6), (1, 0), (2, -4), (2, -4), (0, -4)]
# side-on crossbow: degrees below level, and the kick (px back, px up)
XBOW_SIDE = [(32, 0, 0), (16, 0, 0), (2, 0, 0), (-4, 0, 0), (-8, 1, 1), (-4, 0, 0)]


def place_thin(idx, grip_src, spa, grip, d, k, across, mirror, pal):
    """make_arms_layers.place for thin art (a bow's limbs, a string): each pixel sampled 4x4 and
    kept when a third of the samples land on the drawing, in the most common of its lighter
    tones when they are a quarter of the samples (so a limb two pixels wide keeps its wood and
    does not shrink to its outline), else the most common tone."""
    h, w = idx.shape
    nx, ny = -d[1], d[0]
    SS = 4
    o = (np.arange(CELL * SS) + 0.5) / SS
    X, Y = np.meshgrid(o, o)
    vx, vy = X - grip[0], Y - grip[1]
    a = (vx * d[0] + vy * d[1]) / k
    b = (vx * nx + vy * ny) / across
    if mirror:
        b = -b
    sx = np.floor(grip_src[0] + b * spa).astype(int)
    sy = np.floor(grip_src[1] - a * spa).astype(int)
    ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
    c = np.full(sx.shape, -1)
    c[ok] = idx[sy[ok], sx[ok]]
    c = c.reshape(CELL, SS, CELL, SS).transpose(0, 2, 1, 3).reshape(CELL, CELL, SS * SS)
    npal = len(pal)
    counts = np.stack([(c == q).sum(axis=2) for q in range(npal)], axis=2)
    total = counts.sum(axis=2)
    dark = np.array([sum(col) < 200 for col in pal])
    light = counts.copy()
    light[..., dark] = 0
    best = np.where(light.sum(axis=2) * 4 >= SS * SS, light.argmax(axis=2), counts.argmax(axis=2))
    P = np.array(pal, dtype=np.uint8)
    out = np.zeros((CELL, CELL, 4), dtype=np.uint8)
    keep = total * 3 >= SS * SS
    out[keep, :3] = P[best[keep]]
    out[keep, 3] = 255
    return Image.fromarray(out, 'RGBA')


def runs(solid, gap=12, min_ink=400):
    cols = solid.any(axis=0)
    out, x = [], 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]:
                x += 1
            out.append([s, x])
        x += 1
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] < gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [r for r in merged if solid[:, r[0]:r[1]].sum() > min_ink]


def drawings():
    im = key_white(Image.open(SRC + 'bow_draw_source.png').convert('RGB'), tol=40, holes=60)
    a = np.array(im)
    out = []
    for s, e in runs(a[..., 3] > 0, gap=30):
        crop = im.crop((s, 0, e, im.height))
        out.append(crop.crop(crop.getbbox()))
    assert len(out) == 4, f'{len(out)} drawings cut, expected 4'
    return out


def bow_grip(idx):
    """The bow's handle: the middle of the wood (the rightmost run of ink) a little above the arrow."""
    h, w = idx.shape
    gy = h * 0.5
    row = np.where(idx[int(h * 0.42)] >= 0)[0]
    # the rightmost run of the row
    end = row.max()
    start = end
    while start - 1 in set(row):
        start -= 1
    return ((start + end + 1) / 2, gy)


def main():
    pieces = drawings()
    bows = [quantize(p) for p in pieces[:3]]
    grips = [bow_grip(b) for b in bows]
    spa_bow = np.mean([b.shape[0] for b in bows]) / BOW_LEN
    # the profile crossbow, turned to point up (as the weapon drawings stand)
    xb = quantize(pieces[3].rotate(90, expand=True))
    xh, xw = xb.shape
    xg_y = xh - 0.55 * xh
    xr = np.where(xb[int(xg_y)] >= 0)[0]
    xgrip = ((xr.min() + xr.max() + 1) / 2, xg_y)
    spa_xb = xh / XBOW_LEN
    # the top-down crossbow for the facings toward and away from the eye
    top = quantize(cut_source()[9])
    th, tw = top.shape
    tg_y = th - 0.28 * th
    tr = np.where(top[int(tg_y)] >= 0)[0]
    tgrip = ((tr.min() + tr.max() + 1) / 2, tg_y)
    spa_top = th / XBOW_LEN

    for name in ('Bow', 'Crossbow'):
        sheets = {k: Image.new('RGBA', (6 * CELL, 4 * CELL)) for k in ('front', 'behind')}
        for r in (0, 2, 3):
            for i in range(6):
                fx, fy = FIST[r][i]
                g = (fx + 32, fy + 32)
                layer = 'behind' if r == 0 else 'front'
                if name == 'Bow':
                    if r == 3:
                        k, lean = BOW_SIDE[i]
                        t = math.radians(lean)
                        cell = place_thin(bows[k], grips[k], spa_bow, g, (math.sin(t), -math.cos(t)), 1.0, 1.0, False, PAL)
                    else:
                        # edge-on; toward the eye canted off the face once it is raised
                        t = math.radians(30 if (r == 2 and i >= 2) else 0)
                        cell = place_thin(bows[0], grips[0], spa_bow, g, (math.sin(t), -math.cos(t)), 1.0, 0.4, r == 2, PAL)
                else:
                    if r == 3:
                        down, back, up = XBOW_SIDE[i]
                        t = math.radians(down)
                        cell = place_thin(xb, xgrip, spa_xb, (g[0] - back, g[1] - up), (math.cos(t), math.sin(t)), 1.0, 1.0, False, PAL)
                    else:
                        fy_ = 1 if r == 2 else -1
                        # held low across the body, then levelled at the foe
                        d = (0.5 * (-1 if r == 2 else 1), fy_ * 0.87) if i == 0 else (0, fy_)
                        cell = place(top, tgrip, spa_top, g, d, 0.5 if i else 0.8, 1.0, False, PAL)
                sheets[layer].alpha_composite(cell, (i * CELL, r * CELL))
        # the left-facing row: the right-facing one mirrored
        for k, sh in sheets.items():
            right = sh.crop((0, 3 * CELL, 6 * CELL, 4 * CELL))
            row = Image.new('RGBA', right.size)
            for i in range(6):
                row.paste(ImageOps.mirror(right.crop((i * CELL, 0, (i + 1) * CELL, CELL))), (i * CELL, 0))
            sh.paste(row, (0, CELL))
        for k, sh in sheets.items():
            d = OUT + name + '/' + ('_Behind/' if k == 'behind' else '') + 'Wood/'
            os.makedirs(d, exist_ok=True)
            sh.save(d + 'Shoot.png')
        print(name, 'shoot done')


if __name__ == '__main__':
    main()
