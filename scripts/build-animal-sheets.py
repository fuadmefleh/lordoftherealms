#!/usr/bin/env python3
"""
scripts/build-animal-sheets.py

Turns the big hand-out animal walk sheets in assets/lpc/Animals/ into small,
even-celled game sheets the inner map draws (data/animals.json points at the
outputs):

    python scripts/build-animal-sheets.py

Each source sheet is 1254x1254: a 4x4 grid of 313.5px cells, one row per
direction (up, left, down, right — the LPC order), four walk frames a row.
The cells are not whole pixels and the art floats in them, so for every row
the frames' union box is found, the row is scaled down (box filter) and laid
into an even cell with the animal's feet on one baseline and its body
centred on one line — frames of a row keep their places relative to each
other, so the walk does not jitter. Faint alpha speckle (alpha < 24) in the
sources is dropped. Prints the cell size and anchor for data/animals.json.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ANIMALS = os.path.join(HERE, '..', 'assets', 'lpc', 'Animals')

SHEETS = [
    # source, output, scale
    ('Pixel Deer Walking Sprite Sheet.png', 'deer_doe.png', 0.45),
    ('Retro Stag Walking Sprite Sheet.png', 'deer_stag.png', 0.45),
]
GRID = 4
CELL = 112          # output cell, px
FOOT_Y = 104        # output baseline (feet), px from the cell top
ALPHA_MIN = 24


def clean(im):
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v < ALPHA_MIN else v)
    return Image.merge('RGBA', (r, g, b, a))


def build(src, out, scale):
    im = clean(Image.open(os.path.join(ANIMALS, src)).convert('RGBA'))
    W, H = im.size
    cw, ch = W / GRID, H / GRID
    sheet = Image.new('RGBA', (CELL * GRID, CELL * GRID), (0, 0, 0, 0))
    for row in range(GRID):
        cells = []
        for col in range(GRID):
            box = (round(col * cw), round(row * ch), round((col + 1) * cw), round((row + 1) * ch))
            cells.append(im.crop(box))
        boxes = [c.getbbox() for c in cells]
        boxes = [b for b in boxes if b]
        ux0 = min(b[0] for b in boxes)
        ux1 = max(b[2] for b in boxes)
        uy1 = max(b[3] for b in boxes)
        midx = (ux0 + ux1) / 2
        for col, c in enumerate(cells):
            sw, sh = max(1, round(c.width * scale)), max(1, round(c.height * scale))
            small = c.resize((sw, sh), Image.BOX)
            # place so the row's feet sit on FOOT_Y and its middle on the cell centre
            ox = round(CELL / 2 - midx * scale)
            oy = round(FOOT_Y - uy1 * scale)
            frame = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
            frame.alpha_composite(small, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
            sheet.alpha_composite(frame, (col * CELL, row * CELL))
    sheet = clean(sheet)
    sheet.save(os.path.join(ANIMALS, out), optimize=True)
    print(f'{out}: cell {CELL}x{CELL}, anchor ({CELL // 2}, {FOOT_Y}), {GRID}x{GRID}, rows up/left/down/right')


if __name__ == '__main__':
    for s in SHEETS:
        build(*s)
    sys.exit(0)
