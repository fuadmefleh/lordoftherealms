"""
Farm tool overlays for LPC characters, posed from the arming sword's sheets.

The sword prop (assets/lpc/Characters/Props/Sword 01 - Arming Sword) has a
sheet for each swing the townsfolk use at field work: 'Combat 1h - Halfslash'
(cutting a ripe crop: a sickle) and 'Legacy - Swing' (hoeing and weeding: a
hoe). For every frame (128px cells round the 64px body, 6 frames x 4 rows:
up, left, down, right) the sword's grip and blade direction are read off its
pixels (the pale motion trail left out), and the tool is drawn in that pose:

  sickle  a short wooden handle from the grip, an iron crescent at its end
  hoe     a long handle through the grip, a flat iron blade across its end

Writes assets/lpc/Tools/sickle_halfslash_128.png and hoe_swing_128.png
(768x512: the body's six frames, 128px cells, the 64px frame centred).
Run from the repo root: python scripts/make_farm_tools.py
"""
import math
from PIL import Image

SWORD = 'assets/lpc/Characters/Props/Sword 01 - Arming Sword/'
OUT = 'assets/lpc/Tools/'
CELL, FRAMES, ROWS = 128, 6, 4
TRAIL = {(227, 231, 211), (168, 179, 184)}  # the motion trail's two tones (the blade is drawn in the darker ones)
WOOD, WOOD_DARK = (139, 94, 52, 255), (84, 54, 30, 255)
IRON, IRON_DARK, IRON_LIGHT = (150, 156, 164, 255), (52, 54, 64, 255), (214, 220, 224, 255)
BODY = (64, 70)  # the body's middle in a 128px cell


def pose(cell):
    """(grip, unit direction to the tip) of the sword in a cell, or None."""
    solid = {(x, y) for y in range(CELL) for x in range(CELL)
             if cell.getpixel((x, y))[3] > 128 and cell.getpixel((x, y))[:3] not in TRAIL}
    # The sword is the largest blob (stray specks and smears left out)
    pts, seen = [], set()
    for start in solid:
        if start in seen:
            continue
        blob, stack = [], [start]
        seen.add(start)
        while stack:
            x, y = stack.pop()
            blob.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in solid and n not in seen:
                        seen.add(n)
                        stack.append(n)
        if len(blob) > len(pts):
            pts = blob
    if len(pts) < 6:
        return None
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    proj = [(p[0] - mx) * ux + (p[1] - my) * uy for p in pts]
    lo, hi = min(proj), max(proj)
    a = (mx + ux * lo, my + uy * lo)
    b = (mx + ux * hi, my + uy * hi)
    # The grip is the end nearer the body
    da = math.hypot(a[0] - BODY[0], a[1] - BODY[1])
    db = math.hypot(b[0] - BODY[0], b[1] - BODY[1])
    grip, tip = (a, b) if da <= db else (b, a)
    L = math.hypot(tip[0] - grip[0], tip[1] - grip[1]) or 1
    d = ((tip[0] - grip[0]) / L, (tip[1] - grip[1]) / L)
    # The hand holds the hilt a little in from its end
    return (grip[0] + d[0] * 2, grip[1] + d[1] * 2), d


def put(img, x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def line(img, p, q, c, width=1):
    n = int(max(abs(q[0] - p[0]), abs(q[1] - p[1]))) + 1
    for i in range(n + 1):
        t = i / max(1, n)
        x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
        put(img, x, y, c)
        if width > 1:
            put(img, x + 1, y, c)
            put(img, x, y + 1, c)


def handle(img, a, b):
    """A wooden handle with a dark edge under it."""
    line(img, (a[0] + 0.6, a[1] + 0.6), (b[0] + 0.6, b[1] + 0.6), WOOD_DARK)
    line(img, a, b, WOOD)


def sickle(img, grip, d):
    end = (grip[0] + d[0] * 7, grip[1] + d[1] * 7)
    handle(img, (grip[0] - d[0] * 2, grip[1] - d[1] * 2), end)
    # The crescent: from the handle's end, out and round
    n = (-d[1], d[0])
    R = 6.5
    cx, cy = end[0] + d[0] * R, end[1] + d[1] * R
    base = math.atan2(-d[1], -d[0])
    for i in range(0, 25):
        t = base + i * (math.pi * 1.15) / 24
        for rr, col in ((R + 0.8, IRON_DARK), (R, IRON), (R - 0.9, IRON_LIGHT)):
            put(img, cx + math.cos(t) * rr * 1.0 + n[0] * 0, cy + math.sin(t) * rr, col)


def hoe(img, grip, d):
    back = (grip[0] - d[0] * 5, grip[1] - d[1] * 5)
    end = (grip[0] + d[0] * 17, grip[1] + d[1] * 17)
    handle(img, back, end)
    # A flat iron blade across the end, turned down towards the ground
    n = (-d[1], d[0])
    if n[1] < 0:
        n = (-n[0], -n[1])
    for k in range(0, 6):
        a = (end[0] + n[0] * k - d[0] * 1.5, end[1] + n[1] * k - d[1] * 1.5)
        b = (end[0] + n[0] * k + d[0] * 1.5, end[1] + n[1] * k + d[1] * 1.5)
        line(img, a, b, IRON_DARK if k in (0, 5) else IRON)


def build(src, dst, draw):
    sheet = Image.open(SWORD + src + '.png').convert('RGBA')
    out = Image.new('RGBA', (FRAMES * CELL, ROWS * CELL), (0, 0, 0, 0))
    for r in range(ROWS):
        for f in range(FRAMES):
            cell = sheet.crop((f * CELL, r * CELL, (f + 1) * CELL, (r + 1) * CELL))
            p = pose(cell)
            if not p:
                continue
            tile = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
            draw(tile, *p)
            out.alpha_composite(tile, (f * CELL, r * CELL))
    out.save(OUT + dst)
    print('wrote', OUT + dst)


if __name__ == '__main__':
    build('Combat 1h - Halfslash', 'sickle_halfslash_128.png', sickle)
    build('Legacy - Swing', 'hoe_swing_128.png', hoe)
