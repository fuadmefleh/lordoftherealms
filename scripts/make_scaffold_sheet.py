"""Pack the scaffold sprites (PixelLab object creator, assets/executions/src/*.png) into one prop sheet.

Each sprite is cropped to what it draws and set bottom-centred in a cell of whole
32px tiles; prints the townProps `rect` of each for data/townProps.json
(ex_gallows, ex_block, ex_stake, ex_pillory: the scaffold of systems/executions.js,
laid in the square by world/scaffolds.js).

    py -3 scripts/make_scaffold_sheet.py
"""
import json
import math
import os
from PIL import Image

SRC = 'assets/executions/src'
OUT = 'assets/executions/scaffolds.png'
ORDER = ['gallows', 'block', 'stake', 'pillory']
T = 32

cells = []
for name in ORDER:
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    im = im.crop(im.getbbox())
    cells.append((name, im, math.ceil(im.width / T), math.ceil(im.height / T)))

H = max(h for _, _, _, h in cells)
W = sum(w for _, _, w, _ in cells)
sheet = Image.new('RGBA', (W * T, H * T), (0, 0, 0, 0))
col = 0
rects = {}
for name, im, w, h in cells:
    sheet.alpha_composite(im, (col * T + (w * T - im.width) // 2, H * T - im.height))
    rects[name] = [col, H - h, w, h]
    col += w
sheet.save(OUT)
print(json.dumps(rects))
