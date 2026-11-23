"""Derived landscape tiles for terrainGen 17 (run from repo root: python scripts/terrain_art/landscape_tiles.py).

All recoloured / composited from existing painted tiles (no sprite drawn from scratch):
- cold/hexGlacier00-03: ice fields between the peaks (blue-white crevassed ice), from cold/hexSnowField00-03.
- cold/hexGlacierPeak00-01: ice-capped peaks, from cold/hexMountainSnow00-01 with the snow turned to glacier ice.
- desert/hexBadlands00-03: red-ochre eroded uplands with banded rock, from hexHighlands01-03 (+ hexHills01).
- desert/hexCanyon00-02: deeper red rock in hard light and shade for canyon hexes, from hexHighlands01-03.
- volcanic/hexVolcano00-01: a dark basalt cone with a glowing crater and lava runs, from hexMountain01-02.
- volcanic/hexAshPlains00-03: dark, rich volcanic soil dusted with ash, from hexPlains01-03.
- ocean/hexReef00-03: turquoise shallows with coral patches, from ocean/hexOceanCalm00-03.
Deterministic (seeded); re-running gives the same files.
"""
import colorsys, os, random, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance

T = 'assets/tiles/'


def load(p):
    return Image.open(T + p).convert('RGBA')


def save(im, p):
    os.makedirs(os.path.dirname(T + p), exist_ok=True)
    im.save(T + p, optimize=True)


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
            hh, s, v = f(hh, s, v, x, y)
            rr, gg, bb = colorsys.hsv_to_rgb(hh % 1, max(0, min(1, s)), max(0, min(1, v)))
            po[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), a)
    return out


def noise(size, seed, scale, octaves=3):
    """Smooth value noise 0..255 (an L image): random grids upscaled and summed."""
    rng = random.Random(seed)
    w, h = size
    acc = None
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gw, gh = max(2, int(w / scale) + 2), max(2, int(h / scale) + 2)
        g = Image.new('L', (gw, gh))
        g.putdata([rng.randint(0, 255) for _ in range(gw * gh)])
        g = g.resize(size, Image.BICUBIC)
        # (a running weighted mean of the octaves)
        acc = g if acc is None else Image.blend(acc, g, amp / (tot + amp))
        tot += amp
        amp *= 0.5
        scale /= 2
    return acc


def inside_mask(im, thr=250):
    return im.split()[3].point(lambda a: 255 if a > thr else 0)


# ── 1. glaciers ─────────────────────────────────────────────
def ice(h, s, v, x, y):
    # snow to glacier ice: cool cyan-blue, the shadows deep and saturated, the lights near white
    hue = 0.55
    sat = min(1, s * 1.15 + (1 - v) * 0.55 + 0.05)
    return (hue, sat, v * 0.98 + 0.02)


def crevasses(im, seed, count, band=(170, 360), length=(26, 54), dark=(84, 140, 186), angle=0.25):
    """Thin dark-blue cracks with a pale lip, in loose parallel sets across the ice."""
    rng = random.Random(seed)
    w, h = im.size
    alpha = im.split()[3]
    ok = lambda x, y: 0 <= x < w and 0 <= y < h and alpha.getpixel((int(x), int(y))) > 250
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        cx, cy = rng.uniform(30, w - 30), rng.uniform(*band)
        ang = angle + rng.uniform(-0.25, 0.25)
        for k in range(rng.randint(2, 3)):          # a set of near-parallel cracks
            ox, oy = cx + rng.uniform(-8, 8), cy + k * rng.uniform(9, 14)
            ln = rng.uniform(*length)
            pts = []
            for t in range(8):
                f = t / 7
                bend = math.sin(f * math.pi) * rng.uniform(-3, 3)
                pts.append((ox + math.cos(ang) * (f - 0.5) * ln, oy + math.sin(ang) * (f - 0.5) * ln + bend))
            if not all(ok(x, y) for x, y in pts):
                continue
            wdt = 2
            d.line([(x, y + 1.5) for x, y in pts], fill=(240, 250, 255, 150), width=wdt)   # lip
            d.line(pts, fill=dark + (150,), width=wdt)
            d.line(pts[2:6], fill=tuple(int(c * 0.7) for c in dark) + (170,), width=1)
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    out = Image.alpha_composite(im, layer)
    out.putalpha(ImageChops.multiply(out.split()[3], alpha))
    return out


for i in range(4):
    im = hsv_map(load(f'cold/hexSnowField0{i}.png'), ice)
    im = crevasses(im, 7100 + i, 6)
    save(im, f'cold/hexGlacier0{i}.png')

is_snow = lambda r, g, b: (r + g + b) / 3 > 150 and max(r, g, b) - min(r, g, b) < 70
for i in range(2):
    im = load(f'cold/hexMountainSnow0{i}.png')
    im = hsv_map(im, ice, is_snow)
    im = crevasses(im, 7200 + i, 3, band=(270, 350), length=(16, 28), angle=0.1)
    save(im, f'cold/hexGlacierPeak0{i}.png')


# ── 2. badlands and canyons ─────────────────────────────────
def badland(depth):
    def f(h, s, v, x, y):
        green = 0.12 < h < 0.45 and s > 0.18
        # (rock bands: strata across the slopes, a little wavy)
        band = 0.5 + 0.5 * math.sin(y * 0.21 + math.sin(x * 0.035) * 2.2)
        if green:
            # the grass and brush dried to rust and ochre scrub
            return (0.07 + (h - 0.2) * 0.1, min(1, s * 0.6 + 0.2), min(1, v * (0.98 - depth * 0.15) + 0.04))
        # bare rock to red sandstone, banded
        return (0.03 + band * 0.03, min(1, 0.42 + s * 0.6 + band * 0.1 + depth * 0.08), min(1, v * (0.95 + band * 0.16 - depth * 0.2) + 0.03))
    return f


for i in range(4):
    src = load(f'hexHighlands0{(i % 3) + 1}.png')
    if i == 3:
        src = src.transpose(Image.FLIP_LEFT_RIGHT)    # (a fourth face: the first mirrored)
    im = hsv_map(src, badland(0))
    save(im, f'desert/hexBadlands0{i}.png')

for i in range(3):
    im = hsv_map(load(f'hexHighlands0{i + 1}.png'), badland(0.6))
    # (sheer walls: the rock's light and shade pushed apart, its strata deeper)
    alpha = im.split()[3]
    im = ImageEnhance.Contrast(im).enhance(1.25)
    im = ImageEnhance.Brightness(ImageEnhance.Color(im).enhance(0.8)).enhance(0.92)
    im.putalpha(alpha)
    save(im, f'desert/hexCanyon0{i}.png')


# ── 3. volcanoes and volcanic soil ─────────────────────────
def basalt(h, s, v, x, y):
    green = 0.12 < h < 0.45 and s > 0.18
    if green:
        return (0.1, s * 0.35, v * 0.42)                     # scorched scrub
    if v > 0.72 and s < 0.25:
        return (0.06, 0.06, 0.38 + (v - 0.72) * 0.5)         # snow to ash
    return (0.03, min(1, s * 0.4 + 0.08), v * 0.36 + 0.03)   # rock to dark basalt


def top_of(im):
    a = im.split()[3]
    w, h = im.size
    for y in range(h):
        xs = [x for x in range(w) if a.getpixel((x, y)) > 200]
        if xs:
            return (sum(xs) / len(xs), y)
    return (w / 2, 0)


for i in range(2):
    base = load(f'hexMountain0{i + 1}.png')
    im = hsv_map(base, basalt)
    alpha = base.split()[3]
    sx, sy = top_of(base)
    rng = random.Random(7300 + i)
    w, h = im.size
    glow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    # the crater: a hot mouth just below the summit
    cx, cy = sx, sy + 16
    d.ellipse([cx - 15, cy - 6, cx + 15, cy + 7], fill=(255, 120, 30, 255))
    d.ellipse([cx - 8, cy - 3, cx + 8, cy + 4], fill=(255, 220, 120, 255))
    # lava runs down the flanks, wandering
    for k in range(4):
        x, y = cx + rng.uniform(-10, 10), cy + 4
        pts = [(x, y)]
        drift = rng.uniform(-0.9, 0.9)
        for _ in range(rng.randint(14, 26)):
            x += drift + rng.uniform(-1.6, 1.6)
            y += rng.uniform(4, 7)
            if y >= h or alpha.getpixel((int(max(0, min(w - 1, x))), int(y))) < 250:
                break
            pts.append((x, y))
        if len(pts) > 3:
            d.line(pts, fill=(255, 92, 20, 235), width=4)
            d.line(pts[: len(pts) // 2], fill=(255, 196, 90, 235), width=2)
    halo = glow.filter(ImageFilter.GaussianBlur(7))
    halo = Image.eval(halo, lambda c: c)
    im = Image.alpha_composite(im, Image.blend(Image.new('RGBA', im.size, (0, 0, 0, 0)), halo, 0.9))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(1.1)))
    im.putalpha(alpha)
    # a little smoke off the crater, kept inside the tile
    smoke = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(smoke)
    for k in range(7):
        r = 8 + k * 2.2
        px, py = cx + k * 3.5 + rng.uniform(-3, 3), cy - 10 - k * 7
        if py - r < 0:
            break
        ds.ellipse([px - r, py - r * 0.8, px + r, py + r * 0.8], fill=(92, 86, 84, max(30, 150 - k * 18)))
    smoke = smoke.filter(ImageFilter.GaussianBlur(4))
    im = Image.alpha_composite(im, smoke)
    save(im, f'volcanic/hexVolcano0{i}.png')


def ashsoil(h, s, v, x, y):
    green = 0.1 < h < 0.45
    if green:
        return (h + 0.05, min(1, s * 0.72 + 0.05), v * 0.62)   # deep, lush green on dark soil
    return (0.07, s * 0.3, v * 0.38)                           # bare ground to black loam


for i in range(4):
    base = load(f'hexPlains0{(i % 3) + 1}.png')
    im = hsv_map(base, ashsoil)
    alpha = base.split()[3]
    # pale ash drifts in patches
    n = noise(im.size, 7400 + i, 50, 3).point(lambda v: max(0, min(255, (v - 125) * 4)))
    ash = Image.new('RGBA', im.size, (138, 134, 128, 255))
    im = Image.composite(ash, im, n.point(lambda v: int(v * 0.62)))
    # dark pumice crumbs
    rng = random.Random(7450 + i)
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = im.size
    for _ in range(320):
        x, y = rng.uniform(10, w - 10), rng.uniform(120, h - 10)
        if alpha.getpixel((int(x), int(y))) < 250:
            continue
        r = rng.choice([1.0, 1.4, 1.8, 2.4])
        c = rng.randint(28, 52)
        d.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=(c, c - 4, c - 6, 200))
    im = Image.alpha_composite(im, layer.filter(ImageFilter.GaussianBlur(0.5)))
    im.putalpha(alpha)
    save(im, f'volcanic/hexAshPlains0{i}.png')


# ── 4. reefs ───────────────────────────────────────────────
def shallows(h, s, v, x, y):
    return (h - 0.075, s * 0.78, min(1, v * 1.32 + 0.08))


CORALS = [(196, 118, 104), (190, 150, 96), (150, 110, 126), (204, 140, 112), (160, 160, 100), (112, 128, 96)]
for i in range(4):
    base = load(f'ocean/hexOceanCalm0{i}.png')
    alpha = base.split()[3]
    im = hsv_map(base, shallows)
    w, h = im.size
    # pale sand under the clear water where the reef is thickest
    n = noise(im.size, 7500 + i, 46, 3)
    sand = n.point(lambda v: max(0, min(255, (v - 128) * 5)))
    im = Image.composite(Image.new('RGBA', im.size, (196, 232, 214, 255)), im, sand.point(lambda v: int(v * 0.45)))
    # coral heads in clusters on the sand
    rng = random.Random(7550 + i)
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    heads = []
    for _ in range(60):
        x, y = rng.uniform(20, w - 20), rng.uniform(130, h - 20)
        if alpha.getpixel((int(x), int(y))) > 250 and sand.getpixel((int(x), int(y))) > 120:
            heads.append((x, y, rng.choice(CORALS)))
    for _ in range(1400):
        if not heads:
            break
        hx, hy, hc = heads[rng.randrange(len(heads))]
        x, y = hx + rng.gauss(0, 7), hy + rng.gauss(0, 4.5)
        if not (0 <= x < w and 0 <= y < h) or alpha.getpixel((int(x), int(y))) < 250:
            continue
        r = rng.choice([1.2, 1.6, 2.0, 2.6])
        c = hc if rng.random() < 0.75 else rng.choice(CORALS)
        sh = tuple(int(v * 0.55) for v in c)
        d.ellipse([x - r + 0.8, y - r * 0.7 + 1.2, x + r + 0.8, y + r * 0.7 + 1.2], fill=sh + (150,))
        d.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=c + (200,))
        if r > 1.8:
            d.ellipse([x - r * 0.5, y - r * 0.6, x + r * 0.1, y - r * 0.1], fill=tuple(min(255, v + 34) for v in c) + (170,))
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    # (seen through the water: the coral veiled in turquoise)
    out = Image.alpha_composite(im, layer)
    out = Image.alpha_composite(out, Image.new('RGBA', im.size, (90, 196, 196, 46)))
    out.putalpha(alpha)
    save(out, f'ocean/hexReef0{i}.png')
print('done')
