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
a sheet drawn at another size than its fellows carries a factor. If a row
(antlers, a body lying full length) would overflow the cell, every sheet of
the animal is shrunk alike to fit. The animal's size in the world is data/animals.json drawTiles: the
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
SPECK_SHARE = 0.004
MARGIN = 0.22       # share of a cell cut round it, for art that strays over the grid lines  # bits under this share of the cell's biggest blob are specks

# animal: { action: (source, factor, alpha floor) }
SOURCES = {
    'stag': {'death': ('stag/stag_death_clean.png', 1, ALPHA_MIN)},
    # the first death was drawn bigger, greyer and without the outline: redrawn from the attack sheet
    'arctic_fox': {'death': ('arctic_fox/arctic_fox_death_redo.png', 1, ALPHA_MIN)},
    'polar_bear': {'attack': ('polar_bear/polar_bear_attack.png', 0.93, ALPHA_MIN)},
    # the farm animals (2026-11-09): ChatGPT drew some sheets a little smaller than the walk
    'pig': {'death': ('pig/pig_death_clean.png', 1.08, ALPHA_MIN)},
    'goat': {'attack': ('goat/goat_attack_clean.png', 1.09, ALPHA_MIN)},
    'duck': {'attack': ('duck/duck_attack_clean.png', 1.06, ALPHA_MIN), 'death': ('duck/duck_death_clean.png', 1.05, ALPHA_MIN)},
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
              'boar', 'fox', 'arctic_fox', 'wolf', 'bear', 'polar_bear', 'lion', 'panther', 'elephant',
              'pig', 'chicken', 'goat', 'cow', 'horse', 'duck']
ACTIONS = ['walk', 'attack', 'death']

# Body length (side view) in tiles: how big each animal is in the world
LENGTH = {
    'rabbit': 0.5, 'snow_rabbit': 0.5, 'fox': 0.85, 'arctic_fox': 0.75, 'wolf': 1.25, 'boar': 1.1,
    'sheep': 1.05, 'mountain_goat': 1.15, 'highland_cow': 1.75, 'stag': 1.6, 'doe': 1.4, 'elk': 1.95,
    'reindeer': 1.55, 'bear': 1.75, 'polar_bear': 2.05, 'lion': 1.8, 'panther': 1.5, 'elephant': 3.1,
    # farm animals (drawn 2026-11-09, same series)
    'pig': 1.1, 'chicken': 0.42, 'duck': 0.45, 'goat': 1.0, 'cow': 1.75, 'horse': 2.0,
}


def source_for(animal, action):
    s = SOURCES.get(animal, {}).get(action)
    if s:
        return s
    # a sheet ChatGPT drew on a solid or fake-checkerboard ground is keyed into <name>_clean.png
    clean = f'{animal}/{animal}_{action}_clean.png'
    if os.path.exists(os.path.join(ANIMALS, clean)):
        return (clean, 1, ALPHA_MIN)
    return (f'{animal}/{animal}_{action}.png', 1, ALPHA_MIN)


def clean_cell(cell, floor, core=None):
    """Drop faint alpha and specks: keep only blobs of a fair size. core (x0, y0, x1, y1): the
    cell proper inside a wider crop; a blob belongs to the cell whose core holds its middle (a
    body lying full length, drawn over the grid line, is kept whole; the neighbour's is dropped)."""
    r, g, b, a = cell.split()
    a = a.point(lambda v: 0 if v < floor else v)
    if np is not None:
        arr = np.array(a)
        lab, n = ndimage.label(arr > 0, structure=np.ones((3, 3)))
        if core is not None and n:
            mids = ndimage.center_of_mass(arr > 0, lab, range(1, n + 1))
            mine = np.zeros(n + 1, dtype=bool)
            mine[1:] = [core[0] <= x < core[2] and core[1] <= y < core[3] for y, x in mids]
            sizes = ndimage.sum(np.ones_like(arr), lab, index=range(1, n + 1))
            # (a small bit of the cell's own animal off in the margin, near it, stays)
            big = max((sizes[k - 1] for k in range(1, n + 1) if mine[k]), default=0)
            for k in range(1, n + 1):
                y, x = mids[k - 1]
                if not mine[k] and sizes[k - 1] < big * 0.02 and core[0] - 12 <= x < core[2] + 12                         and core[1] - 12 <= y < core[3] + 12:
                    mine[k] = True
            arr = np.where(mine[lab], arr, 0).astype('uint8')
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


def build_sheet(path, factor, floor, fit=1.0):
    im = Image.open(os.path.join(ANIMALS, path)).convert('RGBA')
    W, H = im.size
    cw, ch = W / GRID, H / GRID
    # each cell is cut with a margin round it (the art often strays over the grid lines);
    # clean_cell keeps the blobs whose middle is in the cell proper
    m = round(cw * MARGIN) if np is not None else 0
    if m:
        padded = Image.new('RGBA', (W + 2 * m, H + 2 * m), (0, 0, 0, 0))
        padded.paste(im, (m, m))
        im = padded
    scale = SCALE * factor * fit
    sheet = Image.new('RGBA', (CELL * GRID, CELL * GRID), (0, 0, 0, 0))
    side_len = 0
    over = 0  # how far the widest/tallest row overflows the cell (>1: it would be clipped)
    for row in range(GRID):
        cells = []
        for col in range(GRID):
            box = (round(col * cw), round(row * ch), round((col + 1) * cw) + 2 * m, round((row + 1) * ch) + 2 * m)
            core = (m, m, box[2] - box[0] - m, box[3] - box[1] - m) if m else None
            cells.append(clean_cell(im.crop(box), floor, core))
        boxes = [c.getbbox() for c in cells]
        live = [b for b in boxes if b]
        if not live:
            continue
        ux0 = min(b[0] for b in live)
        ux1 = max(b[2] for b in live)
        uy1 = max(b[3] for b in live)
        uy0 = min(b[1] for b in live)
        midx = (ux0 + ux1) / 2
        over = max(over, (ux1 - ux0) * scale / (CELL - 2), (uy1 - uy0) * scale / (FOOT_Y - 1))
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
    return sheet, side_len, over


def build(animal):
    out = {}
    todo = []
    for action in ACTIONS:
        src, factor, floor = source_for(animal, action)
        if not os.path.exists(os.path.join(ANIMALS, src)):
            print(f'  {animal} {action}: no source ({src})')
            continue
        todo.append((action, src, factor, floor))
    # a row wider or taller than the cell would be clipped (antlers, a body lying full length):
    # shrink every sheet of the animal alike, so they still line up (drawTiles makes up the size)
    fit = 1.0
    for action, src, factor, floor in todo:
        fit = min(fit, 1 / max(1e-6, build_sheet(src, factor, floor)[2]))
    if fit > 0.99:  # a pixel or two over: the cell's own margin takes it
        fit = 1.0
    else:
        print(f'  {animal}: shrunk to {fit:.2f} to fit the cell')
    for action, src, factor, floor in todo:
        sheet, side, _ = build_sheet(src, factor, floor, fit)
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
