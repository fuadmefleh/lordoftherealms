#!/usr/bin/env python3
"""
scripts/build-animal-sheets.py

Turns the big hand-out animal sheets in assets/lpc/Animals/ into small,
even-celled game sheets the inner map draws (data/animals.json points at the
outputs):

    python scripts/build-animal-sheets.py            # every animal
    python scripts/build-animal-sheets.py wolf bear  # just these
    python scripts/build-animal-sheets.py --contact out.png   # and a contact sheet

Each source sheet is 1254x1254: a 4x4 grid of 313.5px cells, one row per
direction (up, left, down, right — the LPC order), four frames a row (walk,
attack, or death ending lying down). The cells are not whole pixels, the art
floats in them and the sheets are AI-drawn (soft alpha speckle, the odd
fleck of a neighbour's hoof), so for every cell:

  * alpha under the sheet's floor is dropped (24; 110 for a hazy background)
    and specks — bits of alpha far smaller than the animal — are removed;
  * the row's frames' union box is found, the row is scaled down (box
    filter) and laid into an even 128px cell with the animal's feet on one
    baseline (FOOT_Y) and the row centred on one line — frames of a row keep
    their places relative to each other, so the walk does not jitter.

Every sheet of one animal (walk, attack, death) shares the cell, the
baseline and the scale, so they line up when the game swaps between them;
a sheet drawn at another size than its fellows carries a factor (the old
deer walk sheets are a different series; the arctic fox's death is drawn
big). The animal's size in the world is data/animals.json drawTiles: the
cell's width in tiles. The script prints, for each animal, the drawTiles that
gives its body (the side view's length) the length in tiles of LENGTH below.

Outputs: assets/lpc/Animals/<id>/<id>_<action>_sheet.png (originals kept).
"""
import os
import sys

from PIL import Image

try:
    import numpy as np
    from scipy import ndimage
except ImportError:  # speck removal is skipped without them
    np = None
    ndimage = None

HERE = os.path.dirname(os.path.abspath(__file__))
ANIMALS = os.path.join(HERE, '..', 'assets', 'lpc', 'Animals')

GRID = 4
CELL = 128          # output cell, px
FOOT_Y = 124        # output baseline (feet), px from the cell top
SCALE = 0.39        # source px → output px (a 313px cell → 122px)
ALPHA_MIN = 24
SPECK_SHARE = 0.004  # bits under this share of the cell's biggest blob are specks

# animal: { action: (source, factor, alpha floor) }
SOURCES = {
    'stag': {
        'walk': ('Retro Stag Walking Sprite Sheet.png', 1.45, ALPHA_MIN),
        'attack': ('stag/stag_attack.png', 1, ALPHA_MIN),
        'death': ('stag/stag_death_clean.png', 1, ALPHA_MIN),
    },
    'doe': {
        'walk': ('Pixel Deer Walking Sprite Sheet.png', 1.55, ALPHA_MIN),
        'attack': ('doe/doe_attack.png', 1, ALPHA_MIN),
        'death': ('doe/doe_death.png', 1, ALPHA_MIN),
    },
    'arctic_fox': {
        'walk': ('arctic_fox/arctic_fox_walk.png', 1, ALPHA_MIN),
        'attack': ('arctic_fox/arctic_fox_attack.png', 1, ALPHA_MIN),
        'death': ('arctic_fox/arctic_fox_death.png', 0.85, ALPHA_MIN),
    },
    'boar': {
        'walk': ('boar/boar_walk.png', 1.4, 110),
        'attack': ('boar/boar_attack.png', 1.4, ALPHA_MIN),
        'death': ('boar/boar_death.png', 1.4, ALPHA_MIN),
    },
    'lion': {'attack': ('lion/lion_attack_clean.png', 1, ALPHA_MIN)},
    'panther': {'walk': ('panther/panther_walk_clean.png', 1, 110)},
    'rabbit': {'death': ('rabbit/rabbit_death_clean.png', 1, ALPHA_MIN)},
    'snow_rabbit': {'walk': ('snow_rabbit/snow_rabbit_walk_clean.png', 1, 110)},
    'wolf': {
        'walk': ('wolf/wolf_walk_clean.png', 1, ALPHA_MIN),
        'attack': ('wolf/wolf_attack.png', 1.12, ALPHA_MIN),
    },
    'fox': {'walk': ('fox/fox_walk.png', 1.25, ALPHA_MIN)},
}
ANIMAL_IDS = ['stag', 'doe', 'elk', 'reindeer', 'mountain_goat', 'rabbit', 'snow_rabbit', 'sheep', 'highland_cow',
              'boar', 'fox', 'arctic_fox', 'wolf', 'bear', 'polar_bear', 'lion', 'panther', 'elephant']
ACTIONS = ['walk', 'attack', 'death']

# Body length (side view) in tiles: how big each animal is in the world
LENGTH = {
    'rabbit': 0.5, 'snow_rabbit': 0.5, 'fox': 0.85, 'arctic_fox': 0.75, 'wolf': 1.25, 'boar': 1.1,
    'sheep': 1.05, 'mountain_goat': 1.15, 'highland_cow': 1.75, 'stag': 1.6, 'doe': 1.4, 'elk': 1.95,
    'reindeer': 1.55, 'bear': 1.75, 'polar_bear': 2.05, 'lion': 1.8, 'panther': 1.5, 'elephant': 3.1,
}


def source_for(animal, action):
    s = SOURCES.get(animal, {}).get(action)
    if s:
        return s
    return (f'{animal}/{animal}_{action}.png', 1, ALPHA_MIN)


def clean_cell(cell, floor):
    """Drop faint alpha and specks: keep only blobs of a fair size."""
    r, g, b, a = cell.split()
    a = a.point(lambda v: 0 if v < floor else v)
    if np is not None:
        arr = np.array(a)
        lab, n = ndimage.label(arr > 0, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndimage.sum(np.ones_like(arr), lab, index=range(1, n + 1))
            keep = np.zeros(n + 1, dtype=bool)
            keep[1:] = sizes >= max(6, sizes.max() * SPECK_SHARE)
            # a fleck at the cell's edge is a neighbour's hoof or antler tip, spilt over
            edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
            for k in edge:
                if sizes[k - 1] < sizes.max() * 0.25:
                    keep[k] = False
            arr = np.where(keep[lab], arr, 0).astype('uint8')
        a = Image.fromarray(arr)
    return Image.merge('RGBA', (r, g, b, a))


def build_sheet(path, factor, floor):
    im = Image.open(os.path.join(ANIMALS, path)).convert('RGBA')
    W, H = im.size
    cw, ch = W / GRID, H / GRID
    scale = SCALE * factor
    sheet = Image.new('RGBA', (CELL * GRID, CELL * GRID), (0, 0, 0, 0))
    side_len = 0
    for row in range(GRID):
        cells = []
        for col in range(GRID):
            box = (round(col * cw), round(row * ch), round((col + 1) * cw), round((row + 1) * ch))
            cells.append(clean_cell(im.crop(box), floor))
        boxes = [c.getbbox() for c in cells]
        live = [b for b in boxes if b]
        if not live:
            continue
        ux0 = min(b[0] for b in live)
        ux1 = max(b[2] for b in live)
        uy1 = max(b[3] for b in live)
        midx = (ux0 + ux1) / 2
        if row in (1, 3):
            side_len = max(side_len, max(b[2] - b[0] for b in live) * scale)
        for col, c in enumerate(cells):
            sw, sh = max(1, round(c.width * scale)), max(1, round(c.height * scale))
            small = c.resize((sw, sh), Image.BOX)
            # the row's feet on FOOT_Y and its middle on the cell centre
            ox = round(CELL / 2 - midx * scale)
            oy = round(FOOT_Y - uy1 * scale)
            frame = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
            frame.alpha_composite(small, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
            r_, g_, b_, a_ = frame.split()
            frame = Image.merge('RGBA', (r_, g_, b_, a_.point(lambda v: 0 if v < ALPHA_MIN else v)))
            sheet.alpha_composite(frame, (col * CELL, row * CELL))
    return sheet, side_len


def build(animal):
    out = {}
    for action in ACTIONS:
        src, factor, floor = source_for(animal, action)
        if not os.path.exists(os.path.join(ANIMALS, src)):
            print(f'  {animal} {action}: no source ({src})')
            continue
        sheet, side = build_sheet(src, factor, floor)
        dest = os.path.join(ANIMALS, animal, f'{animal}_{action}_sheet.png')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        sheet.save(dest, optimize=True)
        out[action] = (dest, side)
    walk_len = out.get('walk', (None, 0))[1]
    draw = LENGTH.get(animal, 1) * CELL / walk_len if walk_len else 0
    print(f'{animal}: cell {CELL}x{CELL}, anchor ({CELL // 2}, {FOOT_Y}), body {walk_len:.0f}px -> drawTiles {draw:.2f} '
          f'({", ".join(out)})')
    return out


def contact(path, animals):
    """Every built sheet of the animals side by side, on grass, for a look."""
    thumbs = []
    for a in animals:
        for action in ACTIONS:
            p = os.path.join(ANIMALS, a, f'{a}_{action}_sheet.png')
            if os.path.exists(p):
                thumbs.append(Image.open(p).convert('RGBA'))
    if not thumbs:
        return
    per = 3
    size = CELL * GRID
    rows = (len(thumbs) + per - 1) // per
    img = Image.new('RGBA', (size * per, size * rows), (104, 140, 84, 255))
    for i, t in enumerate(thumbs):
        x, y = (i % per) * size, (i // per) * size
        img.alpha_composite(t, (x, y))
        for k in range(1, GRID + 1):  # baselines
            for xx in range(x, x + size, 4):
                img.putpixel((xx, y + (k - 1) * CELL + FOOT_Y), (255, 255, 0, 255))
    img.save(path)


if __name__ == '__main__':
    args = sys.argv[1:]
    sheet_out = None
    if '--contact' in args:
        i = args.index('--contact')
        sheet_out = args[i + 1]
        del args[i:i + 2]
    todo = args or ANIMAL_IDS
    for a in todo:
        build(a)
    if sheet_out:
        contact(sheet_out, todo)
    sys.exit(0)
