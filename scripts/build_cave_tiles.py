"""Build assets/lpc/new/cave_tiles.png: the underground art for caves and mines
(world/innerMap/mines.js, ui/innerMapLayers/caves.js), composed from the LPC
cliff sheet (the painted 4x one) and a few LPC props. 8 x 8 cells of 32px
logical, drawn at 4x (128px a cell): see CELLS in ui/innerMapLayers/caves.js.

    python scripts/build_cave_tiles.py
"""
import os
from PIL import Image, ImageDraw, ImageEnhance

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def A(*p):
    return os.path.join(ROOT, 'assets', 'lpc', *p)


K = 4
C = 32 * K  # a cell, px

cliff = Image.open(A('Terrain', 'cliff_summer.png')).convert('RGBA')
rocks = Image.open(A('Terrain', 'Rocks, Cliffs.png')).convert('RGBA')
dung = Image.open(A('Objects', 'Small Items', 'Dungeon Elements.png')).convert('RGBA')
ladder = Image.open(A('Objects', 'Furniture', 'Ladder.png')).convert('RGBA')
ck = cliff.size[0] // 512  # the cliff sheet's own scale (4)


def cell(c, r):
    """A cliff-sheet cell at C px."""
    im = cliff.crop((c * 32 * ck, r * 32 * ck, (c + 1) * 32 * ck, (r + 1) * 32 * ck))
    return im.resize((C, C), Image.LANCZOS) if im.size[0] != C else im


def up(im, k=K):
    return im.resize((im.size[0] * k, im.size[1] * k), Image.NEAREST)


def seamless(src):
    """A tileable square from a texture crop: the crop over itself shifted half a tile, faded out to the edges."""
    w, h = src.size
    sh = Image.new('RGBA', src.size)
    sh.paste(src.crop((w // 2, h // 2, w, h)), (0, 0))
    sh.paste(src.crop((0, h // 2, w // 2, h)), (w // 2, 0))
    sh.paste(src.crop((w // 2, 0, w, h // 2)), (0, h // 2))
    sh.paste(src.crop((0, 0, w // 2, h // 2)), (w // 2, h // 2))
    m = Image.new('L', src.size)
    px = m.load()
    for y in range(h):
        for x in range(w):
            dx = abs(x - w / 2 + 0.5) / (w / 2)
            dy = abs(y - h / 2 + 0.5) / (h / 2)
            d = max(dx, dy)
            px[x, y] = int(255 * max(0.0, min(1.0, (1 - d) * 2.2)))
    out = sh.copy()
    out.paste(src, (0, 0), m)
    return out


atlas = Image.new('RGBA', (8 * C, 8 * C), (0, 0, 0, 0))


def put(im, c, r, dx=0, dy=0):
    atlas.alpha_composite(im, (c * C + dx, r * C + dy))


# ── The plateau of the dirt crag: its sand top and its rim of stones ──
plat = cliff.crop((5 * 32 * ck, 1 * 32 * ck, 7 * 32 * ck, 5 * 32 * ck))  # 2 x 4 cells
if plat.size[0] != 2 * C:
    plat = plat.resize((2 * C, 4 * C), Image.LANCZOS)
RIM = 38  # the rim's depth, px at 4x
floors = []
for i, (ox, oy) in enumerate([(56, 56), (90, 70), (62, 96), (96, 100)]):
    s = seamless(plat.crop((ox, oy, ox + C, oy + C)))
    floors.append(s)
    put(s, i, 0)
trod = ImageEnhance.Brightness(floors[0]).enhance(0.78)
trod = ImageEnhance.Color(trod).enhance(0.8)
put(trod, 4, 0)

# rim bands (straight runs of the plateau's rim), each C long
band_top = plat.crop((C // 2, 0, C // 2 + C, RIM))
band_bot = plat.crop((C // 2, 2 * C - RIM, C // 2 + C, 2 * C))
band_left = plat.crop((0, C // 2, RIM, C // 2 + C))
band_right = plat.crop((2 * C - RIM, C // 2, 2 * C, C // 2 + C))
corner = {
    'nw': plat.crop((0, 0, RIM + 6, RIM + 6)),
    'ne': plat.crop((2 * C - RIM - 6, 0, 2 * C, RIM + 6)),
    'sw': plat.crop((0, 2 * C - RIM - 6, RIM + 6, 2 * C)),
    'se': plat.crop((2 * C - RIM - 6, 2 * C - RIM - 6, 2 * C, 2 * C)),
}

# ── The rock face (the plateau's own, meeting the sand) ──
face_l = plat.crop((0, 3 * C, C, 4 * C))
face_r = plat.crop((C, 3 * C, 2 * C, 4 * C))
face_m = cell(2, 4)
face_both = face_l.copy()
face_both.paste(face_r.crop((C // 2, 0, C, C)), (C // 2, 0))
faces = [face_m, face_l, face_r, face_both]
for i, f in enumerate(faces):
    put(f, i, 1)
    g = f.copy()
    g.alpha_composite(band_top, (0, 0))
    if i in (1, 3):
        g.alpha_composite(corner['nw'], (0, 0))
    if i in (2, 3):
        g.alpha_composite(corner['ne'], (C - corner['ne'].size[0], 0))
    put(g, 4 + i, 1)

# ── The rock top: the mass of the rock, dark, its rim where it meets open ground ──
base = ImageEnhance.Brightness(cell(2, 3)).enhance(0.42)
base = ImageEnhance.Color(base).enhance(0.75)
for mask in range(16):
    t = base.copy()
    N, E, S, W = mask & 1, mask & 2, mask & 4, mask & 8
    if N:
        t.alpha_composite(band_top, (0, 0))
    if S:
        t.alpha_composite(band_bot, (0, C - RIM))
    if W:
        t.alpha_composite(band_left, (0, 0))
    if E:
        t.alpha_composite(band_right, (C - RIM, 0))
    if N and W:
        t.alpha_composite(corner['nw'], (0, 0))
    if N and E:
        t.alpha_composite(corner['ne'], (C - corner['ne'].size[0], 0))
    if S and W:
        t.alpha_composite(corner['sw'], (0, C - corner['sw'].size[1]))
    if S and E:
        t.alpha_composite(corner['se'], (C - corner['se'].size[0], C - corner['se'].size[1]))
    put(t, mask % 8, 2 + mask // 8)

# ── Ore in the rock face: nuggets of a colour, outlined, catching the light ──
ORES = [
    ('ore', [(70, 30, 20), (138, 59, 34), (190, 98, 56), (230, 150, 105)]),
    ('copper', [(22, 60, 48), (47, 122, 95), (79, 174, 134), (160, 226, 196)]),
    ('tin', [(60, 66, 74), (125, 138, 150), (169, 182, 194), (225, 232, 238)]),
    ('silver_ore', [(70, 76, 84), (154, 163, 173), (207, 214, 221), (255, 255, 255)]),
    ('gold_ore', [(90, 62, 8), (167, 122, 18), (224, 181, 50), (255, 242, 160)]),
    ('coal', [(8, 8, 8), (24, 24, 26), (44, 44, 48), (90, 90, 98)]),
    ('gems', None),
    ('salt', [(120, 118, 110), (200, 200, 192), (232, 232, 224), (255, 255, 255)]),
]
NUGGETS = [(6, 8, 4, 3), (14, 6, 3, 3), (21, 11, 4, 3), (9, 16, 3, 2), (17, 18, 5, 3), (24, 22, 3, 3), (5, 24, 3, 2), (12, 25, 2, 2)]
GEMS = [(200, 40, 60), (140, 60, 200), (40, 120, 220), (40, 170, 90)]


def px(d, x, y, col, a=255):
    d.rectangle([x * K, y * K, x * K + K - 1, y * K + K - 1], fill=col + (a,))


def nugget(d, x, y, w, h, ramp):
    """A lump w x h logical px at (x, y), drawn at K: outline, body, a lit edge, a glint."""
    o, b, li, hi = ramp
    for yy in range(-1, h + 1):
        for xx in range(-1, w + 1):
            ex, ey = xx in (-1, w), yy in (-1, h)
            if ex and ey:
                continue
            col = o if (ex or ey) else (li if yy == 0 or xx == 0 else b)
            px(d, x + xx, y + yy, col)
    px(d, x, y, hi)


for i, (oid, ramp) in enumerate(ORES):
    ov = Image.new('RGBA', (C, C))
    d = ImageDraw.Draw(ov)
    if oid == 'gems':
        for j, (x, y, w, h) in enumerate(NUGGETS[:6]):
            g = GEMS[j % 4]
            dark = tuple(int(v * 0.45) for v in g)
            light = tuple(min(255, int(v * 1.5) + 40) for v in g)
            nugget(d, x, y, max(2, w - 1), h, (dark, g, light, (255, 255, 255)))
    elif oid == 'coal':
        # a seam: dark streaks along the strata
        for (x, y, w) in [(3, 9, 12), (12, 10, 14), (2, 20, 9), (15, 21, 13), (7, 27, 10)]:
            w = min(w, 31 - x)
            for xx in range(w):
                yy = y + (1 if (xx // 4) % 2 else 0)
                px(d, x + xx, yy - 1, ramp[0], 200)
                px(d, x + xx, yy, ramp[1])
                px(d, x + xx, yy + 1, ramp[2])
            px(d, x + 1, y, ramp[3])
    else:
        for (x, y, w, h) in NUGGETS:
            nugget(d, x, y, w, h, ramp)
    put(ov, i, 4)


# ── Props on the floor ──
def crop_up(src, box):
    return up(src.crop(box))


rubble = Image.new('RGBA', (C, C))
pile = crop_up(dung, (0, 99, 25, 122))
pile = pile.resize((int(pile.size[0] * 1.15), int(pile.size[1] * 1.15)), Image.NEAREST)
rubble.alpha_composite(pile, (0, 22))
for box, at in [((128, 96, 160, 126), (28, 46)), ((129, 71, 158, 95), (4, 56)), ((163, 77, 190, 91), (66, 34)), ((170, 108, 185, 116), (78, 92))]:
    r = crop_up(rocks, box)
    r = r.resize((int(r.size[0] * 0.62), int(r.size[1] * 0.62)), Image.NEAREST)
    rubble.alpha_composite(r, at)
put(rubble, 5, 0)

loose = Image.new('RGBA', (C, C))
for box, at in [((163, 77, 190, 91), (18, 60)), ((170, 108, 185, 116), (74, 48)), ((170, 108, 185, 116), (52, 88))]:
    r = crop_up(rocks, box)
    r = r.resize((int(r.size[0] * 0.55), int(r.size[1] * 0.55)), Image.NEAREST)
    loose.alpha_composite(r, at)
put(loose, 6, 0)

crys = Image.new('RGBA', (C, C))
cd = ImageDraw.Draw(crys)
for (x, y, w, h, col) in [(10, 14, 4, 12, (120, 200, 240)), (15, 10, 4, 16, (150, 170, 250)), (19, 15, 3, 11, (190, 150, 240)), (7, 19, 3, 7, (130, 220, 230))]:
    dark = tuple(int(v * 0.4) for v in col)
    light = tuple(min(255, v + 70) for v in col)
    pts = [(x * K, (y + h) * K), (x * K, (y + 2) * K), ((x + w / 2) * K, y * K), ((x + w) * K, (y + 2) * K), ((x + w) * K, (y + h) * K)]
    cd.polygon(pts, fill=col + (255,), outline=dark + (255,))
    cd.line([((x + 1) * K, (y + 3) * K), ((x + 1) * K, (y + h - 1) * K)], fill=light + (255,), width=K)
put(crys, 7, 0)

WOOD = [(44, 26, 12), (92, 60, 30), (122, 82, 42), (156, 107, 56)]


def plank(d, x0, y0, x1, y1, vertical):
    """A squared timber from (x0, y0) to (x1, y1) logical px: outlined, grained, its lit edge."""
    d.rectangle([x0 * K, y0 * K, x1 * K - 1, y1 * K - 1], fill=WOOD[0] + (255,))
    d.rectangle([(x0 + 1) * K, (y0 + 1) * K, (x1 - 1) * K - 1, (y1 - 1) * K - 1], fill=WOOD[2] + (255,))
    if vertical:
        for yy in range(y0 + 2, y1 - 1, 3):
            if x1 - x0 > 3:
                d.rectangle([(x0 + 2) * K, yy * K, (x1 - 1) * K - 1, yy * K + K // 2], fill=WOOD[1] + (255,))
        d.rectangle([(x0 + 1) * K, (y0 + 1) * K, (x0 + 2) * K - 1, (y1 - 1) * K - 1], fill=WOOD[3] + (255,))
    else:
        for xx in range(x0 + 2, x1 - 1, 4):
            d.rectangle([xx * K, (y0 + 2) * K, xx * K + K // 2, (y1 - 1) * K - 1], fill=WOOD[1] + (255,))
        d.rectangle([(x0 + 1) * K, (y0 + 1) * K, (x1 - 1) * K - 1, (y0 + 2) * K - 1], fill=WOOD[3] + (255,))


def timbers(im, inset=2, top=2, post=4, beam=5, bottom=32):
    d = ImageDraw.Draw(im)
    plank(d, inset, top, inset + post, bottom, True)
    plank(d, 32 - inset - post, top, 32 - inset, bottom, True)
    plank(d, inset - 1, top, 32 - inset + 1, top + beam, False)


# ── A set of mine timbers: a pair of posts and a cap beam ──
sup = Image.new('RGBA', (C, C))
timbers(sup)
put(sup, 0, 5)

# ── The ladder up the shaft ──
lad = crop_up(ladder, (3, 7, 29, 90))
lad = lad.resize((int(lad.size[0] * 0.9), C), Image.NEAREST)
lc = Image.new('RGBA', (C, C))
lc.alpha_composite(lad, ((C - lad.size[0]) // 2, 0))
put(lc, 1, 5)

# ── Daylight at the way out: the sand lit from below ──
day = floors[0].copy()
glow = Image.new('RGBA', (C, C))
gd = ImageDraw.Draw(glow)
for i in range(16):
    gd.rectangle([0, C - (i + 1) * 8, C, C - i * 8], fill=(255, 244, 214, int(20 + (15 - i) * 9)))
day.alpha_composite(glow)
put(day, 2, 5)

# ── The face being cut into: cracks, a hollow, the open drift in its timbers ──
crack = crop_up(dung, (40, 69, 57, 96))
st1 = Image.new('RGBA', (C, C))
st1.alpha_composite(crack, (30, 20))
st1.alpha_composite(crack.transpose(Image.FLIP_LEFT_RIGHT), (66, 44))
put(st1, 3, 5)


def hollow(depth):
    im = Image.new('RGBA', (C, C))
    d = ImageDraw.Draw(im)
    x0, x1 = 7 * K, 25 * K
    top = (32 - depth) * K
    d.rounded_rectangle([x0 - K, top - K, x1 + K, C + 8 * K], radius=8 * K, fill=(46, 30, 20, 255))
    d.rounded_rectangle([x0, top, x1, C + 8 * K], radius=7 * K, fill=(16, 11, 8, 255))
    d.rectangle([x0, C - 2 * K, x1, C - 1], fill=(84, 60, 38, 255))
    return im


put(hollow(13), 4, 5)
op = hollow(27)
timbers(op, inset=5, top=4, post=3, beam=4, bottom=31)
put(op, 5, 5)


# ── A shaft sunk into the ground: a pit, deeper, its timber collar, its ladder ──
def pit(rad, deep, collar=False, lad_on=False):
    im = Image.new('RGBA', (C, C))
    d = ImageDraw.Draw(im)
    cx, cy = C // 2, C // 2 + 2 * K
    d.ellipse([cx - rad - 5 * K, cy - rad - 3 * K, cx + rad + 5 * K, cy + rad + 4 * K], fill=(120, 86, 52, 255))
    d.ellipse([cx - rad - 3 * K, cy - rad - 2 * K, cx + rad + 3 * K, cy + rad + 2 * K], fill=(96, 66, 40, 255))
    if collar:
        s = rad
        d.rectangle([cx - s - 2 * K, cy - s - 2 * K, cx + s + 2 * K, cy + s + 2 * K], fill=WOOD[0] + (255,))
        d.rectangle([cx - s - K, cy - s - K, cx + s + K, cy + s + K], fill=WOOD[2] + (255,))
        for i in range(-s, s + K, 4 * K):
            d.rectangle([cx + i, cy - s - K, cx + i + K // 2, cy - s - 1], fill=WOOD[1] + (255,))
            d.rectangle([cx + i, cy + s + 1, cx + i + K // 2, cy + s + K], fill=WOOD[1] + (255,))
        d.rectangle([cx - s, cy - s, cx + s, cy + s], fill=(10, 7, 5, 255))
        d.rectangle([cx - s, cy - s, cx + s, cy - s + 3 * K], fill=(40, 27, 18, 255))
    else:
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(56, 37, 22, 255))
        d.ellipse([cx - rad + K, cy - rad + deep * K, cx + rad - K, cy + rad - K], fill=(16, 10, 6, 255))
    if lad_on:
        l2 = crop_up(ladder, (3, 7, 29, 60))
        l2 = l2.resize((int(l2.size[0] * 0.62), int(l2.size[1] * 0.5)), Image.NEAREST)
        im.alpha_composite(l2, (cx - l2.size[0] // 2, cy - rad - 6 * K))
    return im


put(pit(7 * K, 3), 0, 6)
put(pit(9 * K, 2), 1, 6)
put(pit(9 * K, 1, collar=True), 2, 6)
put(pit(9 * K, 1, collar=True, lad_on=True), 3, 6)

out = os.path.join(ROOT, 'assets', 'lpc', 'new', 'cave_tiles.png')
atlas.save(out)
print('wrote', out, atlas.size)
