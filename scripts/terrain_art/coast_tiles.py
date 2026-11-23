"""Derived coast tiles for terrainGen 16 (run from repo root: python scripts/terrain_art/coast_tiles.py).

- temperate/hexShingle00-03: temperate beaches (cooler sand with pebbles and dune grass, no palms),
  from tropics_wetlands/hexSand00-03 blended with cold/hexDirtCold.
- cold/hexFjord00-03: fjord water (deep, cold slate-teal), from ocean/hexOceanCalm00-03.
- cold/hexSkerry00-01: cold skerries (rocky islets in cold water, moss dulled), from ocean/hexIslandRocky00-01.
Deterministic (seeded); re-running gives the same files.
"""
import colorsys, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

T = 'assets/tiles/'

def load(p):
    return Image.open(T + p).convert('RGBA')

def save(im, p):
    os.makedirs(os.path.dirname(T + p), exist_ok=True)
    im.save(T + p)

def hsv_map(im, f, mask=None):
    px = im.load()
    w, h = im.size
    out = im.copy()
    po = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or (mask and not mask(r, g, b)):
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            hh, s, v = f(hh, s, v)
            rr, gg, bb = colorsys.hsv_to_rgb(hh % 1, max(0, min(1, s)), max(0, min(1, v)))
            po[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), a)
    return out

# ── fjord water: darker, colder, a little greener than the open sea
def fjord(h, s, v):
    # (hue a touch toward teal, colour kept, light taken down: deep still water between cliffs)
    return (h - 0.035, s * 0.85, v * 0.68)

for i in range(4):
    save(hsv_map(load(f'ocean/hexOceanCalm0{i}.png'), fjord), f'cold/hexFjord0{i}.png')

# ── cold skerries: the rocky islets' water as fjord water, their moss dulled toward lichen
is_water = lambda r, g, b: b > r + 25 and b > g + 5
is_moss = lambda r, g, b: g > r + 8 and g > b + 8
for i in range(2):
    im = load(f'ocean/hexIslandRocky0{i}.png')
    im = hsv_map(im, fjord, is_water)
    im = hsv_map(im, lambda h, s, v: (h + 0.03, s * 0.42, v * 0.9), is_moss)
    save(im, f'cold/hexSkerry0{i}.png')

# ── temperate shingle beach
dirt = load('cold/hexDirtCold00.png')
for i in range(4):
    sand = load(f'tropics_wetlands/hexSand0{i}.png')
    alpha = sand.split()[3]
    cool = Image.blend(sand, dirt, 0.28)
    cool = hsv_map(cool, lambda h, s, v: (h, s * 0.8, v * 1.02))
    cool.putalpha(alpha)
    rng = random.Random(9100 + i)
    layer = Image.new('RGBA', sand.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = sand.size
    inside = lambda x, y: alpha.getpixel((int(x), int(y))) > 250
    # dune grass tufts toward the landward (upper) half
    for _ in range(14):
        x, y = rng.uniform(30, w - 30), rng.uniform(150, 260)
        if not inside(x, y) or not inside(x, y + 6):
            continue
        for k in range(rng.randint(6, 11)):
            ang = rng.uniform(-0.9, 0.9)
            ln = rng.uniform(9, 17)
            col = rng.choice([(118, 128, 76, 235), (138, 146, 88, 235), (98, 110, 66, 235)])
            d.line([(x + k - 4, y), (x + k - 4 + ang * ln, y - ln)], fill=col, width=2)
    # pebbles, thicker toward the sea (lower half)
    # (shingle in drifts: pebbles gather in a few bands along the shore, the sand between bare)
    bands = [rng.uniform(230, 350) for _ in range(3)]
    for _ in range(170):
        x, y = rng.uniform(15, w - 15), rng.uniform(150, 370)
        if not inside(x, y):
            continue
        near = min(abs(y - b) for b in bands)
        if rng.random() < min(0.92, near / 22):
            continue
        rx = rng.choice([1.4, 1.8, 2.2, 2.6, 3.2, 4.0])
        ry = rx * rng.uniform(0.55, 0.8)
        base = rng.randint(104, 140)
        warm = rng.choice([(22, 16, 6), (16, 12, 4), (10, 8, 4), (26, 18, 8)])
        c = tuple(max(0, min(255, base + t)) for t in warm)
        d.ellipse([x - rx + 0.8, y - ry + 1.2, x + rx + 0.8, y + ry + 1.2], fill=(110, 94, 66, 110))   # shadow
        d.ellipse([x - rx, y - ry, x + rx, y + ry], fill=c + (230,))
        if rx > 2:
            d.ellipse([x - rx * 0.55, y - ry * 0.75, x + rx * 0.1, y - ry * 0.15], fill=tuple(min(255, v + 28) for v in c) + (150,))  # light
    layer = layer.filter(ImageFilter.GaussianBlur(0.55))
    out = Image.alpha_composite(cool, layer)
    out.putalpha(ImageChops.multiply(out.split()[3], alpha))
    save(out, f'temperate/hexShingle0{i}.png')
print('done')
