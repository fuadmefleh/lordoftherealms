#!/usr/bin/env python3
"""
scripts/build-glove-sheets.py

Glove and gauntlet sheets for the LPC characters (the hands kit slot,
data/arms.json sprite.layer of leather_gloves / gauntlets). The LPC pack has
no glove art, so the hands are found in the body's own sheets and painted over:

  * the hand mask, per frame: the body's painted pixels that a longsleeve
    shirt, pants, boots and the head all leave bare (what is left of the skin
    is the hands; the shirt's cuff is the wrist line);
  * gauntlets grow the mask one pixel into the sleeve round the wrist (a cuff)
    and keep a hard dark edge;
  * the colour: each hand pixel's shade (the skin's own ramp, outline to
    highlight) is mapped onto the material's ramp, so the LPC shading and the
    outline carry over.

Written for both builds and every animation sheet the body has (Walk, Idle,
Combat 1h - Slash/Halfslash/Backslash/Idle, Legacy - Swing, Sitting, Emotes,
Climb, Run, Jump), as

    assets/lpc/Characters/Clothing/<build>/Hands/<Gloves|Gauntlets>/<Colour>/<anim>.png

the same frame layout as the body (64px cells, rows up/left/down/right).
Composited over the body by ui/innerMapCharacters.js through Arms.lookLayers.

    python scripts/build-glove-sheets.py [--preview out.png]
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CHARS = os.path.join(HERE, '..', 'assets', 'lpc', 'Characters')

BUILDS = {
    'Masculine, Thin': {'body': 'Body/Body 02 - Masculine, Thin/Peach', 'head': 'Head/Head 02 - Masculine/Peach'},
    'Feminine, Thin': {'body': 'Body/Body 01 - Feminine, Thin/Peach', 'head': 'Head/Head 01 - Feminine/Peach'},
}
# what covers the skin that is not a hand (the first sheet of each list that the anim has)
COVERS = [
    ['Torso/Shirt 01 - Longsleeve Shirt/Amber'],
    ['Legs/Pants 03 - Pants/Amber'],
    ['Feet/Shoes 02 - Boots/Brown', 'Feet/Shoes 01 - Shoes/Brown', 'Feet/Shoes 01 - Shoes'],
]
FEET_Y = 52  # a frame's bare skin below this with no shoe sheet to take it away is a foot

# the material ramps, outline to highlight (5 shades)
RAMPS = {
    ('Gloves', 'Leather'): ['#2a170c', '#4e2e17', '#6e4322', '#8c5a30', '#a8754a'],
    ('Gloves', 'Black'): ['#121014', '#1f1c22', '#2e2a33', '#403b46', '#58525f'],
    ('Gloves', 'Tan'): ['#3b2814', '#6b4a28', '#8f6a3e', '#b08a58', '#cdab7a'],
    ('Gauntlets', 'Steel'): ['#1b1e24', '#4a525e', '#76808c', '#a6b0ba', '#dfe6ec'],
    ('Gauntlets', 'Iron'): ['#1c1b1b', '#433f3c', '#635d58', '#857e76', '#aaa299'],
    ('Gauntlets', 'Bronze'): ['#2a1a08', '#6a4318', '#94622a', '#bf8a42', '#e4b86e'],
}


def _hex(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _load(path):
    if not os.path.exists(path):
        return None
    return np.array(Image.open(path).convert('RGBA'))


def _cover(build, anim, shape):
    """Alpha of everything that hides non-hand skin (a missing sheet hides nothing)."""
    out = np.zeros(shape[:2], bool)
    for options in COVERS:
        got = None
        for rel in options:
            got = _load(os.path.join(CHARS, 'Clothing', build, rel, anim + '.png'))
            if got is not None and got.shape[:2] == shape[:2]:
                break
            got = None
        if got is not None:
            out |= got[..., 3] > 0
        elif options[0].startswith('Feet/'):
            # no shoe sheet for this anim: take the bare skin low in each frame as feet
            rows = np.arange(shape[0]) % 64
            out |= (rows >= FEET_Y)[:, None]
    return out


def _skin(body_dir, body):
    """Pixels painted in the body's own skin palette (the colours of its Walk sheet)."""
    walk = _load(os.path.join(CHARS, body_dir, 'Walk.png'))
    pal = np.unique(walk[walk[..., 3] > 0][:, :3], axis=0)
    rgb = body[..., :3]
    ok = np.zeros(body.shape[:2], bool)
    for c in pal:
        ok |= np.all(rgb == c, axis=-1)
    return ok


def hand_mask(build, anim):
    """(body RGBA, mask of hand pixels) for one animation sheet, or None."""
    spec = BUILDS[build]
    body = _load(os.path.join(CHARS, spec['body'], anim + '.png'))
    if body is None:
        return None
    m = (body[..., 3] > 0) & ~_cover(build, anim, body.shape)
    # only the skin: the LPC combat body sheets carry stray pixels of a blade and
    # its slash (and eye specks) baked in; those are not hands
    m &= _skin(spec['body'], body)
    head = _load(os.path.join(CHARS, spec['head'], anim + '.png'))
    if head is not None and head.shape == body.shape:
        # the head, and the neck it sits on: grow the head down two pixels
        h = head[..., 3] > 0
        h2 = h.copy()
        h2[1:] |= h[:-1]
        h2[2:] |= h[:-2]
        m &= ~h2
    # drop specks (a lone pixel of the neck or an ankle): keep pixels with a masked neighbour
    n = np.zeros_like(m, dtype=np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                n += np.roll(np.roll(m, dy, 0), dx, 1)
    m &= n >= 2
    return body, m


def _shade_rank(body, m):
    """Each masked pixel's place on the skin's ramp, 0 (outline) .. 1 (highlight)."""
    rgb = body[..., :3].astype(np.float32)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    vals = np.unique(np.round(lum[m]).astype(int))
    if len(vals) <= 1:
        return np.where(m, 0.6, 0)
    rank = {v: i / (len(vals) - 1) for i, v in enumerate(vals)}
    out = np.zeros(m.shape, np.float32)
    ys, xs = np.nonzero(m)
    for y, x in zip(ys, xs):
        out[y, x] = rank[int(round(lum[y, x]))]
    return out


def paint(body, m, kind, colour):
    ramp = [_hex(c) for c in RAMPS[(kind, colour)]]
    mask = m.copy()
    if kind == 'Gauntlets':
        # a cuff: one pixel more round the hand, onto the painted arm (not out into the air)
        grow = mask.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            grow |= np.roll(np.roll(mask, dy, 0), dx, 1)
        mask = grow & (body[..., 3] > 0)
    rank = _shade_rank(body, m)
    # the grown cuff takes the shade of the arm pixel under it
    if kind == 'Gauntlets':
        extra = mask & ~m
        rank = np.where(extra, np.clip(_shade_rank(body, extra) * 0.8 + 0.1, 0, 1), rank)
    out = np.zeros(body.shape, np.uint8)
    idx = np.clip(np.round(rank * (len(ramp) - 1)).astype(int), 0, len(ramp) - 1)
    for i, c in enumerate(ramp):
        sel = mask & (idx == i)
        out[sel, 0], out[sel, 1], out[sel, 2] = c
    out[mask, 3] = 255
    # a hard dark edge where the glove meets the air or the sleeve
    edge = mask & ~(np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
    if kind == 'Gauntlets':
        out[edge, 0], out[edge, 1], out[edge, 2] = ramp[0]
    else:
        dark = mask & edge & (idx <= 1)
        out[dark, 0], out[dark, 1], out[dark, 2] = ramp[0]
    return out


def anims(build):
    d = os.path.join(CHARS, BUILDS[build]['body'])
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith('.png'))


def build_all():
    n = 0
    for build in BUILDS:
        for anim in anims(build):
            got = hand_mask(build, anim)
            if got is None:
                continue
            body, m = got
            for (kind, colour) in RAMPS:
                dest = os.path.join(CHARS, 'Clothing', build, 'Hands', kind, colour)
                os.makedirs(dest, exist_ok=True)
                Image.fromarray(paint(body, m, kind, colour)).save(os.path.join(dest, anim + '.png'), optimize=True)
                n += 1
    print(f'{n} glove sheets written')


if __name__ == '__main__':
    build_all()
