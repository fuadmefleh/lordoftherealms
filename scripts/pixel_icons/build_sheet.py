# Packs the made pixel icons (assets/icons/pixel/src/*.png, in icons.json order)
# into assets/icons/pixel/icons.png and writes data/pixelIcons.json, the emoji →
# cell manifest src/ui/pixelIcons.js reads. Icons not made (or listed in
# icons.json "rejected") are left out and stay emoji. Run after generate.py, then
# npm run build:data.
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CELL, COLS = 32, 16
spec = json.load(open(os.path.join(ROOT, 'scripts', 'pixel_icons', 'icons.json'), encoding='utf-8'))
rejected = set(spec.get('rejected', []))
made = []
for ic in spec['icons']:
    p = os.path.join(ROOT, 'assets', 'icons', 'pixel', 'src', ic['file'])
    if ic['emoji'] in rejected or not os.path.exists(p):
        continue
    made.append((ic, p))
rows = max(1, (len(made) + COLS - 1) // COLS)
sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
icons = {}
for i, (ic, p) in enumerate(made):
    im = Image.open(p).convert('RGBA')
    if im.size != (CELL, CELL):
        im = im.resize((CELL, CELL), Image.NEAREST)
    sheet.alpha_composite(im, ((i % COLS) * CELL, (i // COLS) * CELL))
    icons[ic['emoji']] = i
sheet.save(os.path.join(ROOT, 'assets', 'icons', 'pixel', 'icons.png'))
out = {
    '_doc': 'Emoji drawn as pixel icons (src/ui/pixelIcons.js): emoji -> cell index in sheet (cols wide, cell px square). Made with PixelLab by scripts/pixel_icons/ (make_list.py, generate.py, build_sheet.py); emoji not here stay emoji.',
    'sheet': 'assets/icons/pixel/icons.png', 'cell': CELL, 'cols': COLS, 'icons': icons,
}
json.dump(out, open(os.path.join(ROOT, 'data', 'pixelIcons.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(icons), 'icons packed,', rows, 'rows')
