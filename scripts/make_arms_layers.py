"""
The arms system's LPC weapon layers (data/arms.json sprite.layer), posed from
ChatGPT drawings.

Source: assets/lpc/new/arms/weapons_source.png, ChatGPT's drawing of ten
weapons standing upright, point up, on white (dagger, bearded axe, Dane axe,
flanged mace, spear, pike, bill, halberd, bow, crossbow). Nothing is drawn
here: each weapon is cut out, its colours snapped to the arming sword's own
LPC ramps (steel, wood), and it is placed in every frame of the arming
sword's sheets by the sword's pose there (scripts/arms_pose.py: the hand,
the blade's direction, its foreshortening, in front of the body or behind):

  swing   (dagger, axes, mace) along the sword's blade, as the sword swings
  pole    (spear, pike, bill, halberd) in the ready stance slanted forward from
          the front fist side-on (the head out in front of the face), upright
          seen from the front or back; levelled toward the facing in the cuts
          side-on (a thrust as the hand drives forward), slanted across the body
          toward the facing seen from the front or back (a shaft pointing
          straight at the eye foreshortens to a stub)
          (the Dane axe swings like the swords, but is held slanted forward in
          the ready stance, its head clear of the face)
  bow     upright in the hand, the string toward the body
  xbow    levelled toward the facing, the stock at the hand

The metal is recoloured to the sword's own Bronze and Steel ramps and a grey iron
ramp (IRON). Run scripts/make_arms_sword.py first (the sword's ready stance and
iron, which the weapons here follow), then this, then scripts/make_arms_shoot.py.
Writes assets/lpc/Characters/Props/<Weapon>/<Metal>/<anim>.png and
.../_Behind/<Metal>/<anim>.png, 128px cells round the 64px body like the
sword's sheets (ui/innerMapCharacters.js keeps the whole cell when a layer is
oversized, so a pike is not cut off at the frame).

Run from the repo root: python scripts/make_arms_layers.py [Weapon ...]
"""
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_pose import ANIMS, CELL, poses  # noqa: E402
from make_new_windows import key_white  # noqa: E402

SRC = 'assets/lpc/new/arms/'
OUT = 'assets/lpc/Characters/Props/'

IRON = [(27, 25, 43), (68, 64, 70), (98, 94, 98), (122, 118, 118), (152, 148, 142), (190, 186, 176)]
STEEL = [(27, 25, 43), (72, 65, 82), (114, 107, 126), (134, 126, 127), (168, 179, 184), (227, 231, 211)]
METALS = {
    'Steel': STEEL,
    # grey iron: darker and flatter than steel, warmer, never near-black (the LPC sword's own Iron
    # ramp, (0,0,0) (37,32,37) (57,43,52) (82,65,74) (111,101,99) (148,128,129), read as black on a
    # flat axe head; scripts/make_arms_sword.py moves the LPC iron sword onto this ramp too)
    'Iron': IRON,
    'Bronze': [(27, 19, 19), (70, 40, 37), (96, 52, 41), (121, 65, 24), (162, 97, 24), (225, 157, 77)],
}
WOOD = [(42, 23, 34), (84, 54, 30), (117, 80, 45), (148, 107, 68), (162, 121, 75), (190, 146, 96)]
PALETTE = STEEL + WOOD[1:]
FULL = 28.0   # the arming sword's length seen square-on, in the cell's pixels

# source order, then: layer folder, art length (cell px, square-on), grip (share of the length up
# from the butt), mode, metals made
WEAPONS = [
    ('Dagger', 17, 0.16, 'swing', ('Bronze', 'Iron', 'Steel')),
    ('Axe', 28, 0.12, 'swing', ('Bronze', 'Iron', 'Steel')),
    ('Dane Axe', 42, 0.28, 'swing', ('Iron', 'Steel')),
    ('Mace', 26, 0.14, 'swing', ('Bronze', 'Iron', 'Steel')),
    ('Spear', 52, 0.36, 'pole', ('Bronze', 'Iron', 'Steel')),
    ('Pike', 74, 0.32, 'pole', ('Iron', 'Steel')),
    ('Bill', 54, 0.32, 'pole', ('Iron', 'Steel')),
    ('Halberd', 54, 0.32, 'pole', ('Iron', 'Steel')),
    ('Bow', 34, 0.5, 'bow', ('Wood',)),
    ('Crossbow', 28, 0.28, 'xbow', ('Wood',)),
]
# facing rows: up, left, down, right — the axis toward the facing
FACE = [(0, -1), (-1, 0), (0, 1), (1, 0)]


def cut_source():
    """The ten drawings, left to right: RGBA crops of the keyed source."""
    im = key_white(Image.open(SRC + 'weapons_source.png').convert('RGB'), tol=40, holes=60)
    a = np.array(im)
    solid = a[..., 3] > 0
    # columns with ink, grouped into runs (a crossbow's string and prod stay with it)
    cols = solid.any(axis=0)
    runs, x = [], 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]:
                x += 1
            runs.append([s, x])
        x += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 12:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    merged = [r for r in merged if solid[:, r[0]:r[1]].sum() > 400]
    out = []
    for s, e in merged:
        crop = im.crop((s, 0, e, im.height))
        out.append(crop.crop(crop.getbbox()))
    return out


def quantize(img):
    """Every opaque pixel snapped to the nearest LPC ramp colour: an index map (-1 clear)."""
    a = np.array(img).astype(np.int32)
    pal = np.array(PALETTE)
    d = ((a[..., None, :3] - pal[None, None]) ** 2).sum(axis=3)
    idx = d.argmin(axis=2)
    idx[a[..., 3] < 128] = -1
    return idx


def _fist(p, fx):
    """The front fist in the side-on ready stance: ahead of and above the sword's grip (the rear hand)."""
    return (p['grip'][0] + fx * 13, p['grip'][1] - 4)


def pose_for(mode, anim, row, p, name=None):
    """(grip, dir, along-scale, across-scale, mirror, layer) of a weapon in a frame from the sword's pose p."""
    fx, fy = FACE[row]
    side = row in (1, 3)
    if mode == 'swing':
        if name == 'Dane Axe' and anim == 'Combat 1h - Idle':
            # the two-hander held ready slanting forward, its head out in front of the face
            if side:
                t = math.radians(52)
                return _fist(p, fx), (fx * math.sin(t), -math.cos(t)), 1.0, 1.0, row == 1, 'front'
            return p['grip'], ((0.3 if row == 2 else -0.3), -0.95), 0.95, 1.0, row == 1, 'behind' if row == 0 else p['layer']
        k = max(0.3, min(1.0, p['len'] / FULL))
        return p['grip'], p['dir'], k, 1.0, row == 1, p['layer']
    if mode == 'pole':
        if anim == 'Combat 1h - Idle':
            if side:
                # held ready slanting forward, the head out in front of the face, the butt behind the heel
                t = math.radians(38)
                return _fist(p, fx), (fx * math.sin(t), -math.cos(t)), 1.0, 1.0, row == 1, 'front'
            # seen from the front or behind: upright, off to the weapon's side
            d = (0.12 if row == 2 else -0.12, -1)
            n = math.hypot(*d)
            return p['grip'], (d[0] / n, d[1] / n), 1.0, 1.0, row == 1, 'behind' if row == 0 else p['layer']
        # levelled at the foe, a little down
        if side:
            d = (fx * math.cos(math.radians(8)), math.sin(math.radians(8)))
            return p['grip'], d, 1.0, 1.0, row == 1, 'front'
        # toward or away from the eye: slanted across the body toward the facing (a shaft
        # pointing straight at the eye foreshortens to a stub that reads as pointing at the ground)
        t = math.radians(40)
        sx = -1 if row == 2 else 1
        return p['grip'], (sx * math.sin(t), fy * math.cos(t)), 0.85, 1.0, row == 2, 'behind' if row == 0 else 'front'
    if mode == 'bow':
        # upright, held out at arm's length toward the facing, the string toward the body;
        # seen from the front or back, edge-on
        g = (p['grip'][0] + fx * 13, p['grip'][1] - 2) if side else p['grip']
        return g, (0, -1), 1.0, 1.0 if side else 0.45, row == 1, 'behind' if row == 0 else 'front'
    if mode == 'xbow':
        if side:
            return p['grip'], (fx, 0.05), 1.0, 0.45, row == 1, 'front'
        return p['grip'], (0, fy), 0.5, 1.0, False, 'behind' if row == 0 else 'front'
    raise ValueError(mode)


def place(idx, grip_src, spa, grip, d, k, across, mirror, metal_pal):
    """Render one weapon (index map idx, grip at grip_src, spa source px per cell px) into a 128px cell:
    4x4 samples a pixel, kept when half of them land on the drawing, in the colour most of them hit."""
    h, w = idx.shape
    nx, ny = -d[1], d[0]          # across the weapon
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
    npal = len(metal_pal)
    counts = np.stack([(c == q).sum(axis=2) for q in range(npal)], axis=2)
    total = counts.sum(axis=2)
    best = counts.argmax(axis=2)
    pal = np.array(metal_pal, dtype=np.uint8)
    out = np.zeros((CELL, CELL, 4), dtype=np.uint8)
    keep = total * 2 >= SS * SS
    out[keep, :3] = pal[best[keep]]
    out[keep, 3] = 255
    return Image.fromarray(out, 'RGBA')


def outline(cell):
    """Darken the pale pixels on the weapon's rim to the ramp's outline tone (LPC edges)."""
    a = np.array(cell)
    solid = a[..., 3] > 0
    inner = ndimage.binary_erosion(solid)
    rim = solid & ~inner
    lum = a[..., :3].astype(int).sum(axis=2)
    a[rim & (lum > 330), :3] = (a[rim & (lum > 330), :3] * 0.55).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')


def main():
    pieces = cut_source()
    assert len(pieces) == len(WEAPONS), f'{len(pieces)} drawings cut, expected {len(WEAPONS)}'
    P = poses()
    only = set(sys.argv[1:])
    for crop, (name, length, gshare, mode, metals) in zip(pieces, WEAPONS):
        if only and name not in only:
            continue
        idx = quantize(crop)
        h, w = idx.shape
        spa = h / length
        # the grip: on the shaft, gshare up from the butt; across, the middle of the ink in that row
        gy = h - gshare * h
        row = np.where(idx[int(gy)] >= 0)[0]
        gx = (row.min() + row.max() + 1) / 2 if len(row) else w / 2
        if mode in ('bow',):
            # the bow's grip is at its back (the wood), and the string runs on the left
            row = np.where(idx[int(gy)] >= 0)[0]
            gx = row.max() - 1 if len(row) else w / 2
        for metal in metals:
            pal = list(METALS.get(metal, STEEL)) + WOOD[1:]
            for anim in ANIMS:
                rows = P[anim]
                n = len(rows[0])
                sheets = {'front': Image.new('RGBA', (n * CELL, 4 * CELL)), 'behind': Image.new('RGBA', (n * CELL, 4 * CELL))}
                for r in range(4):
                    last = None
                    for i in range(n):
                        p = rows[r][i] or last
                        if not p:
                            continue
                        last = p
                        grip, d, k, across, mirror, layer = pose_for(mode, anim, r, p, name)
                        cell = outline(place(idx, (gx, gy), spa, grip, d, k, across, mirror, pal))
                        sheets[layer].alpha_composite(cell, (i * CELL, r * CELL))
                for layer, sheet in sheets.items():
                    d = OUT + name + '/' + ('_Behind/' if layer == 'behind' else '') + metal + '/'
                    os.makedirs(d, exist_ok=True)
                    sheet.save(d + anim + '.png')
        print(name, 'done', metals)


if __name__ == '__main__':
    main()
