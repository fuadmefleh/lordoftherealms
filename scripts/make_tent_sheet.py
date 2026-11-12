"""Build assets/lpc/Objects/Camp/Tents.png, the tents sheet (data/townProps.json `tents`).

Sources are PixelLab drawings (scripts/pixellab.mjs style, with the LPC clan tent and
the market stall as style references) kept in assets/lpc/new/tents/. Each is laid in
its cell of the 32px grid, centred across it and standing on the cell's bottom edge
(two pixels up, for the ground shadow), so the prop's anchor row is where it meets
the ground.

    python scripts/make_tent_sheet.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'lpc', 'new', 'tents')
OUT = os.path.join(ROOT, 'assets', 'lpc', 'Objects', 'Camp', 'Tents.png')

T = 32
# name -> (col, row, w, h) in 32px cells; keep in step with data/townProps.json
LAYOUT = {
    'hide_dome':        (0, 0, 4, 4),
    'hide_patch':       (4, 0, 4, 4),
    'hide_fur':         (8, 0, 4, 4),
    'hide_bough':       (12, 0, 4, 4),
    'canvas':           (16, 0, 4, 4),
    'canvas_open':      (20, 0, 4, 4),
    'yurt_orange':      (0, 4, 4, 4),
    'yurt_red':         (4, 4, 4, 4),
    'yurt_blue':        (8, 4, 4, 4),
    'yurt_plain':       (12, 4, 4, 4),
    'market_pots':      (16, 4, 4, 4),
    'market_crates':    (20, 4, 4, 4),
    'pavilion_bell':    (0, 8, 4, 4),
    'pavilion_banners': (4, 8, 4, 4),
    'pavilion_gilt':    (8, 8, 4, 4),
    'market_bunting':   (12, 8, 4, 4),
    'pavilion_great':   (16, 8, 6, 5),
}
FOOT = 2   # (px left under the sprite: its shadow and stakes)


def main():
    cols = max(c + w for c, r, w, h in LAYOUT.values())
    rows = max(r + h for c, r, w, h in LAYOUT.values())
    sheet = Image.new('RGBA', (cols * T, rows * T))
    for name, (c, r, w, h) in LAYOUT.items():
        im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
        # hard alpha: the map draws these crisp, and a half-clear fringe shows as a halo
        a = im.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
        im.putalpha(a)
        box = im.getbbox()
        part = im.crop(box)
        cw, ch = w * T, h * T
        if part.width > cw or part.height > ch - FOOT:
            raise SystemExit(f'{name}: {part.size} does not fit its {cw}x{ch} cell')
        x = c * T + (cw - part.width) // 2
        y = r * T + ch - FOOT - part.height
        sheet.alpha_composite(part, (x, y))
    sheet.save(OUT)
    print(f'saved {OUT} {sheet.size}')


if __name__ == '__main__':
    main()
