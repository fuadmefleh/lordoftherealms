#!/usr/bin/env python3
"""
Build assets/buildingKit/interior_decor.png — the lived-in look of a room on the
street map: what lies on its tables (interiorArt.decor), what hangs on its walls
(interiorArt.wallDecor) and the smaller pieces of furniture the room planner sets
(interiorArt.furniture: dresser, cupboard, loom, ...).

Every sprite is cut from the LPC art already in the repo (assets/lpc/**, OGA-BY 3.0 /
CC-BY-SA, see assets/buildingKit/interior_decor_CREDITS.txt) or the building kit's own
furniture48.png, kept at its own pixels (no resampling): an entry's `grid` says how
many of its pixels make one map tile (32 for LPC art, 48 for the kit's pieces; a larger
grid draws the sprite smaller). A few small things the LPC set has no sprite for
(tankards, a stack of books, coins, antlers, a map, a coat rack, a cradle's blanket)
are drawn here pixel by pixel in the same palette.

Deterministic: same inputs, same sheet. Run from the repo root:

    python scripts/build-interior-decor.py

It writes the sheet and rewrites the generated entries in data/innerMapRenderer.json
(`interiorArt.decor`, `interiorArt.wallDecor` and the furniture entries that point at
the sheet); run `npm run build:data` after.
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LPC = os.path.join(ROOT, 'assets', 'lpc')
OBJ = os.path.join(LPC, 'Objects')
KIT = os.path.join(ROOT, 'assets', 'buildingKit')
OUT = os.path.join(KIT, 'interior_decor.png')
SHEET = 'assets/buildingKit/interior_decor.png'
JSON_PATH = os.path.join(ROOT, 'data', 'innerMapRenderer.json')

_cache = {}


def src(rel):
    if rel not in _cache:
        _cache[rel] = Image.open(os.path.join(OBJ if not rel.startswith('/') else ROOT, rel.lstrip('/'))).convert('RGBA')
    return _cache[rel]


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def cut(rel, x, y, w, h, keep=False):
    """A region of an LPC sheet, trimmed to what is drawn in it."""
    im = src(rel).crop((x, y, x + w, y + h))
    return im if keep else trim(im)


def stack(*parts, w=None, h=None):
    """Compose parts [(img, x, y)] on one transparent canvas, trimmed."""
    W = w or max(x + p.width for p, x, y in parts)
    H = h or max(y + p.height for p, x, y in parts)
    o = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for p, x, y in parts:
        o.alpha_composite(p, (x, y))
    return trim(o)


def half(im):
    """Half size (for a bowl on a washstand): every other pixel, nearest."""
    return im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.NEAREST)


def px(w, h, rows, pal):
    """Hand-drawn pixels: rows of palette letters ('.' clear)."""
    o = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.' and ch in pal:
                o.putpixel((x, y), pal[ch])
    return o


# ── The LPC palette's woods, metals and cloth (taken from the sheets themselves) ──
OUTL = (43, 26, 18, 255)
WD1 = (92, 54, 33, 255)      # dark wood
WD2 = (133, 82, 46, 255)     # wood
WD3 = (176, 116, 64, 255)    # light wood
PEW = (120, 124, 132, 255)
PEW2 = (170, 174, 180, 255)
GOLD1 = (148, 102, 30, 255)
GOLD2 = (218, 170, 60, 255)
GOLD3 = (250, 224, 120, 255)
PAPER = (232, 214, 168, 255)
PAPER2 = (198, 172, 120, 255)
INK = (110, 80, 50, 255)
SEA = (120, 150, 160, 255)
BONE = (226, 214, 186, 255)
BONE2 = (176, 160, 128, 255)
CLOAK = (128, 46, 38, 255)
CLOAK2 = (88, 30, 28, 255)
GREEN = (70, 104, 60, 255)
BLUE = (60, 80, 130, 255)
WOOL = (214, 200, 170, 255)
WOOL2 = (170, 150, 120, 255)


def mugs():
    pal = {'o': OUTL, 'a': WD1, 'b': WD2, 'c': WD3, 'm': PEW, 'n': PEW2, 'f': (236, 226, 200, 255)}
    one = [
        '.offffo.',
        'onbccbno',
        'oabccbao.',
        'oabccbaoo',
        'ommmmmmo.o',
        'oabccbao.o',
        'oabccbaoo',
        'oabccbao',
        'ommmmmmo',
        '.oooooo.',
    ]
    m = px(10, 10, one, pal)
    return stack((m, 0, 2), (m, 9, 0))


def books():
    pal = {'o': OUTL, 'r': CLOAK, 's': CLOAK2, 'g': GREEN, 'h': (48, 74, 42, 255), 'b': BLUE,
           'd': (40, 54, 92, 255), 'p': PAPER, 'y': GOLD2}
    rows = [
        '..oooooooooo..',
        '..obbbbbbbbbo.',
        '..obyyybbbbbdo',
        '..oppppppppppo',
        'ooooooooooooo.',
        'orrrrrrrrrrrso',
        'orryyrrrrrrrso',
        'oppppppppppppo',
        '.oooooooooooo.',
        '.ogggggggggho.',
        '.oggyygggggho.',
        '.opppppppppppo',
        '..oooooooooooo',
    ]
    return px(14, 13, rows, pal)


def coins():
    pal = {'o': (96, 62, 20, 255), 'a': GOLD1, 'b': GOLD2, 'c': GOLD3}
    pile = [
        '...oooo...',
        '..obccbo..',
        '..oaaaao..',
        '.oobccboo.',
        'obcoaaaobco',
        'oaaobccboao',
        'obcoaaaobco',
        'oaaaoooaaao',
        '.ooo...ooo.',
    ]
    one = ['.ooo.', 'obcbo', 'oaaao', '.ooo.']
    return stack((px(11, 9, pile, pal), 0, 0), (px(5, 4, one, pal), 12, 5))


def antlers():
    pal = {'o': OUTL, 'a': BONE2, 'b': BONE, 'w': WD1, 'x': WD2, 'y': WD3}
    rows = [
        'o..........................o',
        'bo..o..................o..ob',
        'ab.ob..o............o..bo.ba',
        '.abab.ob............bo.baba.',
        '..aab.ab..o......o..ba.baa..',
        '...aabab.ob......bo.babaa...',
        '....aaabbab......babbaaa....',
        '.......aaab......baaa.......',
        '.........aab....baa.........',
        '..........aabooba...........',
        '...........owwwwo...........',
        '..........owxyyxwo..........',
        '..........owxyyxwo..........',
        '..........owxxxxwo..........',
        '...........owwwwo...........',
        '............oooo............',
    ]
    return px(28, 16, rows, pal)


def wall_map():
    """A chart pinned to the wall: parchment, a coast in ink, a compass rose."""
    W, H = 30, 22
    o = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.rectangle([0, 0, W - 1, H - 1], fill=PAPER, outline=OUTL)
    d.rectangle([1, 1, W - 2, H - 2], outline=PAPER2)
    # the sea on the right, a coast of ink
    coast = [(16, 1), (15, 4), (17, 6), (16, 9), (14, 11), (16, 14), (18, 16), (17, 19), (18, 20)]
    for (x, y) in coast:
        d.rectangle([x + 1, y, W - 3, y + 2], fill=(170, 186, 170, 255))
    for a, b in zip(coast, coast[1:]):
        d.line([a, b], fill=INK)
    # roads and towns
    d.point([(6, 6), (10, 14), (12, 8)], fill=CLOAK)
    d.line([(6, 6), (12, 8), (10, 14)], fill=PAPER2)
    # a compass rose
    d.point([(24, 15), (24, 17), (23, 16), (25, 16), (24, 16)], fill=INK)
    # pins
    d.point([(1, 1), (W - 2, 1)], fill=CLOAK)
    return o


def coat_rack():
    pal = {'o': OUTL, 'w': WD1, 'x': WD2, 'y': WD3, 'c': CLOAK, 'd': CLOAK2, 'h': (96, 72, 48, 255), 'g': (64, 48, 32, 255)}
    rows = [
        '.....oo.....',
        '..o.oyxo.o..',
        '.oxoowxoxo..',
        '..oogggoo...',
        '...ghhhgo...',
        '..ogghhgxo..',
        '..occdcwo...',
        '.occcdcco...',
        '.occcdccxo..',
        '.occcdccco..',
        'occcdcccco..',
        'occcdccccco.',
        'occccdcccco.',
        'occccdcccdo.',
        'odccccdccdo.',
        '.odcccdcdo..',
        '..oddddxo...',
        '.....oxo....',
        '.....oxo....',
        '.....oxo....',
        '.....oxo....',
        '.....oxo....',
        '.....oxo....',
        '.....oxo....',
        '....owxwo...',
        '..oowwxwwoo.',
        '.owwwoooowwo',
        '.oo......oo.',
    ]
    return px(12, 28, rows, pal)


def blanket(w, h):
    o = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.rectangle([0, 0, w - 1, h - 1], fill=WOOL, outline=OUTL)
    d.line([(1, h - 2), (w - 2, h - 2)], fill=WOOL2)
    d.line([(1, 2), (w - 2, 2)], fill=(150, 60, 50, 255))
    return o


def rod(w):
    o = Image.new('RGBA', (w, 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.line([(1, 1), (w - 2, 1)], fill=WD1)
    d.point([(0, 1), (w - 1, 1)], fill=GOLD2)
    d.point([(0, 0), (w - 1, 0), (0, 2), (w - 1, 2)], fill=OUTL)
    return o


# ══════════════════════════════════════════════
# What is drawn: id -> (image, grid, extra fields)
# ══════════════════════════════════════════════

def decor_items():
    """On a table, a counter, a shelf (tile._decor)."""
    T = 32
    S = 40   # (the larger things a little smaller, to sit on a table among the rest)
    D = {}
    D['mugs'] = (mugs(), T, {})
    D['plates'] = (cut('Small Items/Dishes A.png', 0, 0, 32, 32), S, {})
    D['bread'] = (cut('Small Items/Food/Bread A.png', 0, 32, 32, 32), S, {})
    D['candles'] = (cut('Small Items/Lighting, Table.png', 128, 0, 32, 32), T, {'light': 'candle'})
    D['books'] = (books(), T, {})
    D['papers'] = (cut('Small Items/Loose Paper.png', 64, 64, 32, 32), S, {})
    D['pots'] = (stack((cut('Small Items/Flowers.png', 32, 96, 32, 32), 0, 0),
                       (cut('Small Items/Flowers.png', 64, 96, 32, 32), 11, 7)), T, {})
    D['fruit'] = (cut('Small Items/Food/Fruit B.png', 32, 32, 32, 32), S, {})
    D['cloth'] = (cut('Small Items/Tools, Sewing.png', 160, 32, 32, 32), 44, {})
    D['tools'] = (stack((cut('Small Items/Tools, Carpentry.png', 0, 64, 32, 32), 0, 2),
                        (cut('Small Items/Tools, Carpentry.png', 256, 32, 32, 32), 14, 0)), T, {})
    D['flowers'] = (cut('Small Items/Flowers.png', 0, 32, 32, 32), S, {})
    D['bottles'] = (cut('Small Items/Kitchen Clutter A.png', 128, 64, 32, 32), T, {})
    D['bowls'] = (cut('Small Items/Dishes A.png', 96, 0, 32, 32), S, {})
    D['coins'] = (coins(), T, {})
    D['herbs'] = (cut('Small Items/Food/Herbs & Spices.png', 0, 32, 32, 32), S, {})
    return D


def window(night=False):
    """A stone window cut short: its arch and the foot of its panes, the sill."""
    x = 0 if night else 32
    top = cut('/assets/lpc/Structure/Windows/Stone Windows A.png', x, 0, 32, 24, keep=True)
    foot = cut('/assets/lpc/Structure/Windows/Stone Windows A.png', x, 108, 32, 20, keep=True)
    return trim(stack((top, 0, 0), (foot, 0, 24), w=32, h=44))


def wall_items():
    """On a wall's face (tile._wallDecor). hang: the foot of the sprite, in tiles above the floor."""
    W = {}
    win = window()
    W['window'] = (win, 34, {'hang': 0.25, 'night': 'window_night', 'light': 'window'})
    W['window_night'] = (window(night=True), 34, {'hang': 0.25})
    curt = cut('Wall Items/Curtains.png', 160, 128, 64, 72)
    W['curtains'] = (stack((win, (curt.width - win.width) // 2, 3), (curt, 0, 0)), 48,
                     {'hang': 0.3, 'night': 'curtains_night', 'light': 'window'})
    W['curtains_night'] = (stack((window(night=True), (curt.width - 32) // 2, 3), (curt, 0, 0)), 48, {'hang': 0.3})
    W['torch'] = (cut('Wall Items/Lighting, Wall.png', 64, 0, 32, 64), 32, {'hang': 0.35, 'light': 'torch'})
    W['painting'] = (cut('Wall Items/Paintings, Landscape.png', 0, 0, 64, 32), 32, {'hang': 0.55})
    W['painting_portrait'] = (cut('Wall Items/Paintings, Portraits.png', 64, 0, 32, 64), 36, {'hang': 0.45})
    W['painting_king'] = (cut('Wall Items/Paintings, Portraits.png', 0, 0, 32, 64), 36, {'hang': 0.45})
    W['painting_still'] = (cut('Wall Items/Paintings, Still Life.png', 64, 0, 32, 64), 36, {'hang': 0.5})
    W['mirror'] = (cut('Wall Items/Mirrors.png', 0, 32, 32, 32), 32, {'hang': 0.5})
    W['shelf'] = (cut('Furniture/Cabinet.png', 64, 96, 32, 32), 32, {'hang': 0.55})
    W['hanging_pots'] = (cut('Small Items/Kitchen Clutter A.png', 160, 32, 32, 32), 32, {'hang': 0.5})
    herb = [cut('Small Items/Food/Herbs & Spices.png', x, y, 32, 32).transpose(Image.FLIP_TOP_BOTTOM)
            for (x, y) in ((0, 0), (96, 0), (0, 32))]
    W['hanging_herbs'] = (stack((rod(34), 0, 0), (herb[0], 2, 2), (herb[1], 12, 2), (herb[2], 23, 2)), 32, {'hang': 0.55})
    W['antlers'] = (antlers(), 22, {'hang': 0.6})
    W['map'] = (wall_map(), 32, {'hang': 0.55})
    rug = src('Furniture/Rugs/Swirling Vine Rug.png').crop((0, 64, 160, 128))
    short = Image.new('RGBA', (84, 64), (0, 0, 0, 0))
    short.alpha_composite(rug.crop((0, 0, 42, 64)), (0, 0))
    short.alpha_composite(rug.crop((118, 0, 160, 64)), (42, 0))
    tap = short.transpose(Image.ROTATE_90)
    tap.putalpha(tap.getchannel('A').point(lambda v: 255 if v else 0))   # (a rug lies sheer on a floor; hung, it is cloth)
    W['tapestry'] = (stack((rod(tap.width + 4), 0, 0), (tap, 2, 2)), 64, {'hang': 0.2})
    W['clock'] = (cut('Furniture/Clock, Grandfather.png', 0, 0, 32, 96), 52, {'hang': 0, 'stands': True})
    kit = Image.open(os.path.join(KIT, 'furniture48.png')).convert('RGBA')
    W['banner'] = (trim(kit.crop((48, 48, 96, 96))), 48, {'hang': 0.3})
    W['weapon_rack'] = (trim(kit.crop((96, 96, 144, 144))), 48, {'hang': 0, 'stands': True})
    return W


def furniture_items():
    """Pieces the room planner sets (tile._furniture.type), one tile each. top: where things lie on it."""
    F = {}
    F['dresser'] = (cut('Furniture/Dresser.png', 32, 0, 64, 64), 64, {'top': [0.06, 0.05, 0.94, 0.3]})
    F['cupboard'] = (cut('Furniture/Cabinet.png', 32, 96, 32, 80), 38, {})
    F['wardrobe'] = (cut('Furniture/Cabinet.png', 0, 0, 32, 84), 40, {})
    F['workbench'] = (stack((cut('Furniture/Table, Workshop.png', 32, 0, 80, 64), 0, 0)), 70,
                      {'top': [0.06, 0.1, 0.94, 0.45]})
    F['loom'] = (cut('Furniture/Sewing & Weaving/Loom.png', 0, 0, 64, 64), 60, {})
    stand = cut('Furniture/Sewing & Weaving/Spinning Wheel.png', 0, 0, 64, 64, keep=True)
    wheel = cut('Furniture/Sewing & Weaving/Spinning Wheel.png', 64, 0, 64, 64, keep=True)
    F['spinning_wheel'] = (stack((stand, 0, 0), (wheel, 0, 0)), 44, {})
    F['basket'] = (cut('Small Items/Baskets A.png', 64, 0, 32, 32), 40, {})
    F['firewood'] = (stack((cut('Small Items/Lumber.png', 0, 64, 64, 32), 0, 8),
                           (cut('Small Items/Lumber.png', 224, 0, 32, 32), 14, 0)), 48, {})
    F['plant'] = (cut('Furniture/Planter.png', 0, 32, 32, 32), 34, {})
    table = cut('Furniture/End Table.png', 0, 0, 32, 32)
    bowl = half(cut('Small Items/Dishes A.png', 96, 0, 32, 32))
    F['washstand'] = (stack((table, 0, 6), (bowl, (table.width - bowl.width) // 2, 4)), 30, {})
    F['chair'] = (cut('Furniture/Seating/Chair, Dining E.png', 0, 64, 32, 32), 36, {'seat': 0.55})
    F['chair_back'] = (cut('Furniture/Seating/Chair, Dining E.png', 96, 64, 32, 32), 36, {'seat': 0.55})
    basket = cut('Small Items/Baskets A.png', 32, 32, 32, 32)
    F['cradle'] = (stack((basket, 0, 0), (blanket(basket.width - 8, 6), 4, 5)), 38, {})
    crate = cut('Furniture/Crate.png', 64, 32, 32, 32)
    F['crate_stack'] = (stack((cut('Furniture/Crate.png', 0, 32, 64, 32), 0, 14), (crate, 14, 0)), 52, {})
    F['barrel_rack'] = (cut('Furniture/Barrel.png', 96, 0, 64, 64), 56, {})
    F['coat_rack'] = (coat_rack(), 30, {})
    return F


# Pieces kept in the kit's own sheet (no new art): id -> entry
KIT_FURNITURE = {
    'sack_pile': {'sheet': 'assets/buildingKit/furniture48.png', 'sx': 48, 'sy': 336, 'sw': 48, 'sh': 48},
}

# Several looks of one wall thing, picked by where it hangs
WALL_VARIANTS = {'painting': ['painting', 'painting_portrait', 'painting_still', 'painting_king']}


def pack(groups, width=480):
    """Shelf-pack every sprite on a 48px grid of cells (each sprite in whole cells)."""
    items = []
    for gname, d in groups:
        for k, (im, grid, extra) in d.items():
            items.append((gname, k, im, grid, extra))
    # tallest first keeps the shelves tight; then by name for a stable order
    order = sorted(items, key=lambda t: (-((t[2].height + 47) // 48), t[0], t[1]))
    x = y = 0
    shelf_h = 0
    placed = []
    for g, k, im, grid, extra in order:
        cw = (im.width + 47) // 48 * 48
        ch = (im.height + 47) // 48 * 48
        if x + cw > width:
            x = 0
            y += shelf_h
            shelf_h = 0
        # the sprite sits at the foot of its cells, centred
        ox = x + (cw - im.width) // 2
        oy = y + ch - im.height
        placed.append((g, k, im, grid, extra, ox, oy))
        x += cw
        shelf_h = max(shelf_h, ch)
    H = y + shelf_h
    sheet = Image.new('RGBA', (width, H), (0, 0, 0, 0))
    for g, k, im, grid, extra, ox, oy in placed:
        sheet.alpha_composite(im, (ox, oy))
    return sheet, placed


def entry(ox, oy, im, grid, extra):
    e = {'sheet': SHEET, 'sx': ox, 'sy': oy, 'sw': im.width, 'sh': im.height}
    if grid != 48:
        e['grid'] = grid
    for k, v in extra.items():
        if k in ('night',):
            continue
        e[k] = v
    return e


def fmt(e):
    return json.dumps(e, ensure_ascii=False, separators=(', ', ': '))


def write_json(decor, wall, furn):
    text = open(JSON_PATH, encoding='utf8').read()
    lines = text.split('\n')
    # (1) drop what an earlier run wrote: the generated blocks and furniture lines
    out, skip = [], False
    for ln in lines:
        if re.match(r'^        "(decor|wallDecor)": \{', ln):
            skip = True
            continue
        if skip:
            if re.match(r'^        \},?$', ln):
                skip = False
            continue
        if SHEET in ln and re.match(r'^            "[a-z_0-9]+": \{', ln):
            continue
        if any(re.match(rf'^            "{k}": \{{', ln) for k in KIT_FURNITURE):
            continue
        out.append(ln)
    lines = out
    # (2) the furniture block: its last entry gains a comma, ours follow
    i0 = next(i for i, ln in enumerate(lines) if ln.startswith('        "furniture": {'))
    i1 = next(i for i in range(i0 + 1, len(lines)) if re.match(r'^        \},?$', lines[i]))
    body = [ln.rstrip(',') for ln in lines[i0 + 1:i1]]
    body = [ln for ln in body if ln.strip()]
    for k, e in furn.items():
        body.append(f'            "{k}": {fmt(e)}')
    body = [ln + (',' if j < len(body) - 1 else '') for j, ln in enumerate(body)]
    # (3) decor and wallDecor after it
    def block(name, d):
        rows = [f'            "{k}": {fmt(v)}' for k, v in d.items()]
        rows = [r + (',' if j < len(rows) - 1 else '') for j, r in enumerate(rows)]
        return [f'        "{name}": {{'] + rows + ['        },']
    new = lines[:i0 + 1] + body + ['        },'] + block('decor', decor) + block('wallDecor', wall)
    # the last block closes without a comma when nothing follows it in interiorArt
    rest = [ln for ln in lines[i1 + 1:] if ln.strip()]
    if not rest or rest[0].startswith('    }'):
        new[-1] = '        }'
    new += lines[i1 + 1:]
    json.loads('\n'.join(new))   # still JSON
    open(JSON_PATH, 'w', encoding='utf8', newline='\n').write('\n'.join(new))


# Where each LPC sprite above came from: (credits file under assets/lpc, its section)
CREDITS = [
    ('Objects/Small Items/Credits.txt', 'Dishes'),
    ('Objects/Small Items/Credits.txt', 'Kitchen Clutter'),
    ('Objects/Small Items/Credits.txt', 'Lighting, Tabletop'),
    ('Objects/Small Items/Credits.txt', 'Loose Paper'),
    ('Objects/Small Items/Credits.txt', 'Flowers'),
    ('Objects/Small Items/Credits.txt', 'Tools, Sewing'),
    ('Objects/Small Items/Credits.txt', 'Tools, Carpentry'),
    ('Objects/Small Items/Credits.txt', 'Baskets'),
    ('Objects/Small Items/Credits.txt', 'Lumber'),
    ('Objects/Small Items/Food/Credits.txt', 'Bread A'),
    ('Objects/Small Items/Food/Credits.txt', 'Fruit B'),
    ('Objects/Small Items/Food/Credits.txt', 'Herbs & Spices'),
    ('Objects/Wall Items/Credits.txt', 'Curtains'),
    ('Objects/Wall Items/Credits.txt', 'Lighting, Wall'),
    ('Objects/Wall Items/Credits.txt', 'Mirrors'),
    ('Objects/Wall Items/Credits.txt', 'Paintings, Landscape'),
    ('Objects/Wall Items/Credits.txt', 'Paintings, Portraits'),
    ('Objects/Wall Items/Credits.txt', 'Paintings, Still Life'),
    ('Objects/Furniture/Credits.txt', 'Cabinet'),
    ('Objects/Furniture/Credits.txt', 'Clock, Grandfather'),
    ('Objects/Furniture/Credits.txt', 'Dresser'),
    ('Objects/Furniture/Credits.txt', 'Tables, Workshop'),
    ('Objects/Furniture/Credits.txt', 'Planter'),
    ('Objects/Furniture/Credits.txt', 'End Table'),
    ('Objects/Furniture/Credits.txt', 'Crate'),
    ('Objects/Furniture/Credits.txt', 'Barrel'),
    ('Objects/Furniture/Rugs/Credits.txt', 'Swirling Vine'),
    ('Objects/Furniture/Seating/Credits.txt', 'Chair, Dining (all)'),
    ('Objects/Furniture/Sewing & Weaving/Credits.txt', 'Loom'),
    ('Objects/Furniture/Sewing & Weaving/Credits.txt', 'Spinning Wheel'),
    ('Structure/Windows/Credits.txt', 'Stone Windows A'),
]


def section(path, title):
    lines = open(os.path.join(LPC, path), encoding='utf8', errors='replace').read().splitlines()
    for i, ln in enumerate(lines):
        if ln.strip() == title and i + 1 < len(lines) and lines[i + 1].startswith('---'):
            out = [ln, lines[i + 1]]
            for nxt in lines[i + 2:]:
                if out and nxt.startswith('---'):
                    out.pop()   # (the next section's title)
                    break
                out.append(nxt)
            return '\n'.join(out).rstrip()
    raise SystemExit(f'no credits for {title} in {path}')


def write_credits():
    head = [
        'assets/buildingKit/interior_decor.png',
        '=====================================',
        'Cut (not redrawn) from the Liberated Pixel Cup (LPC) art in assets/lpc, by',
        'scripts/build-interior-decor.py. Their artists and licences follow, as given in',
        'the credits files beside the originals (each section names its source sheet).',
        'The kit pieces (banner, weapon rack: assets/buildingKit/furniture48.png) are the',
        'building kit\'s own. Drawn by the script pixel by pixel: the tankards (mugs), the',
        'stack of books, the coins, the antlers, the wall map, the coat rack, the cradle\'s',
        'blanket and the tapestry\'s rod.',
        '',
    ]
    body = [f'[{path}]\n' + section(path, title) + '\n' for path, title in CREDITS]
    open(os.path.join(KIT, 'interior_decor_CREDITS.txt'), 'w', encoding='utf8', newline='\n').write('\n'.join(head + body))


def main():
    write_credits()
    D, W, F = decor_items(), wall_items(), furniture_items()
    sheet, placed = pack([('decor', D), ('wall', W), ('furn', F)])
    sheet.save(OUT, optimize=True)
    by = {}
    for g, k, im, grid, extra, ox, oy in placed:
        by[(g, k)] = entry(ox, oy, im, grid, extra)
    decor = {k: by[('decor', k)] for k in D}
    wall = {}
    for k, (im, grid, extra) in W.items():
        e = dict(by[('wall', k)])
        if extra.get('night'):
            n = by[('wall', extra['night'])]
            e['night'] = {'sx': n['sx'], 'sy': n['sy'], 'sw': n['sw'], 'sh': n['sh']}
        wall[k] = e
    for k, vs in WALL_VARIANTS.items():
        wall[k]['variants'] = [{f: by[('wall', v)][f] for f in ('sx', 'sy', 'sw', 'sh')} | ({'grid': by[('wall', v)]['grid']} if 'grid' in by[('wall', v)] else {}) for v in vs]
    furn = {k: by[('furn', k)] for k in F}
    furn.update(KIT_FURNITURE)
    if '--no-json' not in sys.argv:
        write_json(decor, wall, furn)
    print(f'{OUT}: {sheet.size[0]}x{sheet.size[1]}, {os.path.getsize(OUT)} bytes, '
          f'{len(decor)} decor, {len(wall)} wall, {len(furn)} furniture')


if __name__ == '__main__':
    main()
