# A contact sheet of the made icons, big and at HUD size, for checking by eye.
#   python scripts/pixel_icons/contact.py out.png [start] [count]
import json
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = json.load(open(os.path.join(ROOT, 'scripts', 'pixel_icons', 'icons.json'), encoding='utf-8'))
out, start, count = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0, int(sys.argv[3]) if len(sys.argv) > 3 else 40
icons = spec['icons'][start:start + count]
COLS, CELL = 8, 112
rows = (len(icons) + COLS - 1) // COLS
sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (52, 44, 36, 255))
d = ImageDraw.Draw(sheet)
for i, ic in enumerate(icons):
    x, y = (i % COLS) * CELL, (i // COLS) * CELL
    p = os.path.join(ROOT, 'assets', 'icons', 'pixel', 'src', ic['file'])
    d.text((x + 3, y + 2), f'{start + i}', fill=(255, 220, 120, 255))
    if not os.path.exists(p):
        d.text((x + 30, y + 40), 'missing', fill=(255, 90, 90, 255))
        continue
    im = Image.open(p).convert('RGBA')
    sheet.alpha_composite(im.resize((80, 80), Image.NEAREST), (x + 16, y + 12))
    sheet.alpha_composite(im.resize((20, 20), Image.NEAREST), (x + 4, y + 88))
    d.text((x + 28, y + 94), ic['desc'][:14], fill=(200, 200, 200, 255))
sheet.save(out)
