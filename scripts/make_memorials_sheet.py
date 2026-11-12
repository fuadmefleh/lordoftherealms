"""Pack the town-memory sprites (PixelLab, assets/townMemory/src/*.png) into one prop sheet.

Each sprite is cropped to what it draws and set bottom-centred in a cell of whole
32px tiles; the sheet is a row of those cells. Prints the townProps `rect` of each
(col, row, w, h in tiles) for data/townProps.json.

    python scripts/make_memorials_sheet.py
"""
import json
import math
import os
from PIL import Image

SRC = 'assets/townMemory/src'
OUT = 'assets/townMemory/memorials.png'
ORDER = ['statue', 'statue_defaced', 'statue_toppled', 'cairn', 'mound', 'charred', 'rubble', 'plaque', 'ruined_arch', 'broken_column']
T = 32

cells = []
for name in ORDER:
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    box = im.getbbox()
    im = im.crop(box)
    w, h = math.ceil(im.width / T), math.ceil(im.height / T)
    cells.append((name, im, w, h))

H = max(h for _, _, _, h in cells)
W = sum(w for _, _, w, _ in cells)
sheet = Image.new('RGBA', (W * T, H * T), (0, 0, 0, 0))
col = 0
rects = {}
for name, im, w, h in cells:
    x = col * T + (w * T - im.width) // 2
    y = H * T - im.height
    sheet.alpha_composite(im, (x, y))
    rects[name] = [col, H - h, w, h]
    col += w
sheet.save(OUT)
print(json.dumps(rects))
