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
import colorsys
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
    """A coat rack, not a dress form: a turned pole on three feet, pegs at its head, a
    felt hat on the left peg and a cloak hung from the right one, falling straight down
    one side of the pole (the pole seen whole above and below it)."""
    pal = {'o': OUTL, 'w': WD1, 'x': WD2, 'y': WD3, 'c': CLOAK, 'd': CLOAK2,
           'h': (104, 80, 54, 255), 'g': (70, 52, 34, 255), 'b': (150, 120, 70, 255)}
    rows = [
        '.......oo.......',
        '......oyxo......',
        '..ooo.owxo......',
        '.ohhho.wx..oo...',
        'ohhbbhowxooxo...',
        'ogggggggxwxco...',
        '.ooooo.wxocco...',
        '.......wxoccdo..',
        '.......wxocdcco.',
        '.......wxoccdco.',
        '.......wxocdccdo',
        '.......wxocdccdo',
        '.......wxoccdcdo',
        '.......wxocdccdo',
        '.......wxocdcdco',
        '.......wxoccdcdo',
        '.......wxocdcdco',
        '.......wxocdcddo',
        '.......wxodddddo',
        '.......wxooddoo.',
        '.......wx..oo...',
        '.......wx.......',
        '......owxo......',
        '.......wx.......',
        '.......wx.......',
        '......owxwo.....',
        '....oowxowxoo...',
        '..oowwo...owwoo.',
        '..oo.........oo.',
    ]
    return px(16, len(rows), rows, pal)


def shelf_bare():
    """The kit's shelf (furniture_big.png) with its jars and bottles gone: each of its five
    compartments the dark of its back board (a shop's shelf in a shortage; its wares are
    drawn onto the boards by ui/interiorDress.js drawWares)."""
    big = Image.open(os.path.join(KIT, 'furniture_big.png')).convert('RGBA').crop((576, 0, 624, 101))
    back, shade = (42, 20, 19, 255), (34, 18, 19, 255)
    for (y0, y1) in ((12, 25), (29, 41), (45, 57), (61, 73), (78, 90)):
        for y in range(y0, y1 + 1):
            for x in range(7, 42):
                big.putpixel((x, y), back)
        # (the board's own shadow on the back, under the board above)
        for x in range(7, 42):
            big.putpixel((x, y0), shade)
    return big


def blanket(w, h):
    o = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.rectangle([0, 0, w - 1, h - 1], fill=WOOL, outline=OUTL)
    d.line([(1, h - 2), (w - 2, h - 2)], fill=WOOL2)
    d.line([(1, 2), (w - 2, 2)], fill=(150, 60, 50, 255))
    return o


def straw_loose():
    """Straw kicked about a cellar's floor (tile._decor on bare floor): a few strands, flat."""
    o = Image.new('RGBA', (24, 9), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    lo, mid, hi = (150, 116, 52, 255), (196, 160, 78, 255), (226, 198, 112, 255)
    for (x0, y0, x1, y1, c) in ((1, 6, 9, 4, mid), (4, 8, 13, 7, lo), (7, 3, 15, 5, hi), (12, 6, 21, 3, mid),
                                (15, 8, 23, 7, lo), (2, 3, 6, 1, hi), (17, 2, 22, 1, lo), (9, 7, 11, 2, mid)):
        d.line([(x0, y0), (x1, y1)], fill=c)
    return o


def grain_spill():
    """Grain spilt from a sack (tile._decor on bare floor): a low fan of kernels."""
    o = Image.new('RGBA', (20, 7), (0, 0, 0, 0))
    k1, k2, k3 = (178, 140, 70, 255), (210, 176, 96, 255), (132, 98, 46, 255)
    pts = [(2, 5), (4, 4), (5, 6), (7, 3), (8, 5), (9, 4), (10, 6), (11, 3), (12, 5), (13, 4), (14, 6),
           (15, 5), (17, 5), (6, 5), (9, 2), (12, 2), (16, 4), (3, 6), (8, 6), (11, 5)]
    for i, (x, y) in enumerate(pts):
        o.putpixel((x, y), (k1, k2, k3)[i % 3])
    return o


def puddle():
    """A damp patch on a cellar's flags (tile._decor on bare floor): dark water, a glint."""
    o = Image.new('RGBA', (22, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    d.ellipse([0, 1, 21, 7], fill=(38, 44, 52, 120))
    d.ellipse([3, 2, 15, 6], fill=(30, 36, 46, 150))
    d.line([(6, 3), (10, 3)], fill=(150, 170, 190, 150))
    return o


def cobweb(right=False):
    """A cobweb in the top corner of a cellar's back wall (tile._wallDecor cobweb / cobweb_r):
    the tile's full width, the web in its left corner (the right corner's mirrored)."""
    W, H = 32, 20
    o = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    silk, faint = (226, 226, 220, 170), (210, 210, 204, 110)
    # radials from the corner
    for (x, y) in ((17, 0), (15, 6), (11, 12), (5, 17), (0, 19)):
        d.line([(0, 0), (x, y)], fill=silk)
    # the spiral: sagging threads between the radials
    for k in (0.3, 0.55, 0.8, 1.0):
        pts = [(round(x * k), round(y * k)) for (x, y) in ((17, 0), (15, 6), (11, 12), (5, 17), (0, 19))]
        for a, b in zip(pts, pts[1:]):
            d.line([a, b], fill=faint)
    # a loose strand hanging down
    d.line([(9, 9), (10, 16)], fill=faint)
    return o.transpose(Image.FLIP_LEFT_RIGHT) if right else o


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

# ── Flames put out (the unlit candles, torch and candelabra: ui/interiorDress.js draws them
# where the light model has them unlit) ──
def _hsv(p):
    r,g,b,a=p; return colorsys.rgb_to_hsv(r/255,g/255,b/255)
def snuff(im, mode='wax', band=0.0):
    """A flame put out. mode 'wax' (candles): in each column with wax (a white run of 3+ px),
    the flame and its bright core above the wax go; elsewhere nothing. mode 'all' (a torch):
    every flame-coloured pixel goes, leaving the empty bowl."""
    im=im.copy(); px=im.load(); w,h=im.size
    def flame(p):
        if p[3]==0: return False
        hh,s,v=_hsv(p); return 0.0<=hh<=0.17 and s>0.45 and v>0.65
    def white(p):
        if p[3]==0: return False
        hh,s,v=_hsv(p); return s<0.3 and v>0.8
    if mode=='all':
        for y in range(h):
            for x in range(w):
                if flame(px[x,y]): px[x,y]=(0,0,0,0)
        return im
    # (band: a top share of the sprite where every flame colour is flame — a candelabra's
    # candles stand above its gilded arms, whose gold must stay)
    for y in range(int(h * band)):
        for x in range(w):
            if flame(px[x,y]): px[x,y]=(0,0,0,0)
    tops={}
    for x in range(w):
        for y in range(h-2):
            if white(px[x,y]) and white(px[x,y+1]) and white(px[x,y+2]):
                # (a run of three: the candle's wax, not the flame's 1-2 px core)
                tops[x]=y; break
    for x in range(w):
        # (the flame can stand a pixel or two wider than its candle)
        near=[tops[c] for c in range(x-2,x+3) if c in tops]
        if not near: continue
        top=max(near)
        for y in range(top):
            if flame(px[x,y]) or (x in tops and white(px[x,y])): px[x,y]=(0,0,0,0)
    # (the wick: a dark pixel atop each candle's wax)
    return im


def decor_items():
    """On a table, a counter, a shelf (tile._decor)."""
    T = 32
    S = 40   # (the larger things a little smaller, to sit on a table among the rest)
    D = {}
    D['mugs'] = (mugs(), T, {})
    D['plates'] = (cut('Small Items/Dishes A.png', 0, 0, 32, 32), S, {})
    D['bread'] = (cut('Small Items/Food/Bread A.png', 0, 32, 32, 32), S, {})
    D['candles'] = (cut('Small Items/Lighting, Table.png', 128, 0, 32, 32), T, {'light': 'candle'})
    D['candles_unlit'] = (snuff(cut('Small Items/Lighting, Table.png', 128, 0, 32, 32)), T, {})
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
    # ── A shop's wares (world/innerMap/shopStock.js: what its market holds, on its shelves,
    # counters, barrels, sacks and crates; data/shopStock.json says which good is which) ──
    D['ware_grain'] = (cut('Small Items/Food/Grains, Grasses.png', 128, 32, 32, 32), S, {})
    D['ware_flour'] = (cut('Small Items/Food/Grains, Grasses.png', 224, 32, 32, 32), S, {})
    D['ware_salt'] = (cut('Small Items/Food/Grains, Grasses.png', 64, 32, 32, 32), S, {})
    D['ware_fish'] = (cut('Small Items/Food/Seafood A.png', 128, 0, 32, 32), S, {})
    D['ware_crab'] = (cut('Small Items/Food/Seafood A.png', 352, 0, 32, 32), S, {})
    D['ware_meat'] = (cut('Small Items/Food/Meats B.png', 96, 0, 32, 32), S, {})
    D['ware_sausage'] = (cut('Small Items/Food/Meats B.png', 32, 0, 32, 32), S, {})
    D['ware_cheese'] = (cut('Small Items/Food/Cheese A.png', 128, 32, 32, 32), S, {})
    D['ware_eggs'] = (cut('Small Items/Food/Eggs.png', 0, 32, 32, 32), S, {})
    D['ware_cabbage'] = (cut('Small Items/Food/Vegetables A.png', 224, 0, 32, 32), S, {})
    D['ware_roots'] = (cut('Small Items/Food/Vegetables A.png', 0, 32, 32, 32), S, {})
    D['ware_mushrooms'] = (cut('Small Items/Food/Mushrooms.png', 0, 32, 32, 32), S, {})
    D['ware_ingots'] = (cut('Small Items/Ores & Ingots/Alloys.png', 64, 0, 32, 32), S, {})
    D['ware_copper'] = (cut('Small Items/Ores & Ingots/Alloys.png', 32, 0, 32, 32), S, {})
    D['ware_coal'] = (cut('Small Items/Ores & Ingots/Ore, Coal.png', 32, 0, 32, 32), S, {})
    D['ware_stone'] = (cut('Small Items/Ores & Ingots/Ore, Stone.png', 0, 0, 32, 32), S, {})
    D['ware_cloth'] = (cut('Small Items/Fabric/Fabric Rolls, Groups.png', 0, 0, 32, 32), 44, {})
    D['ware_wool'] = (cut('Small Items/Fabric/Fabric Rolls.png', 0, 0, 32, 32), 44, {})
    D['ware_leather'] = (cut('Small Items/Fabric/Fabric Rolls.png', 96, 0, 32, 32), 44, {})
    D['ware_planks'] = (cut('Small Items/Lumber.png', 160, 32, 32, 32), S, {})
    D['ware_sack'] = (cut('Small Items/Kitchen Clutter A.png', 32, 96, 32, 32), S, {})
    # ── On a cellar's bare floor (world/innerMap/floors.js _dressCellar): drawn here ──
    D['straw_loose'] = (straw_loose(), T, {})
    D['grain_spill'] = (grain_spill(), T, {})
    D['puddle'] = (puddle(), T, {})
    return D


def window(night=False):
    """A stone window cut short: its arch and the foot of its panes, the sill."""
    x = 0 if night else 32
    top = cut('/assets/lpc/Structure/Windows/Stone Windows A.png', x, 0, 32, 24, keep=True)
    foot = cut('/assets/lpc/Structure/Windows/Stone Windows A.png', x, 108, 32, 20, keep=True)
    return trim(stack((top, 0, 0), (foot, 0, 24), w=32, h=44))


def shutters(win):
    """The window shut for the night: two leaves of boards filling its opening (drawn here
    pixel by pixel in the LPC woods: upright boards, a batten across, the seam between)."""
    o = win.copy()
    dark = lambda p: p[3] and sum(p[:3]) < 330
    stone = lambda p: p[3] and not dark(p)
    tone = [WD2, WD3, WD2, WD1]
    for y in range(win.height):
        row = [win.getpixel((x, y)) for x in range(win.width)]
        xs = [x for x in range(1, win.width - 1) if dark(row[x])
              and any(stone(row[k]) for k in range(0, x)) and any(stone(row[k]) for k in range(x + 1, win.width))]
        if not xs:
            continue
        x0, x1 = min(xs), max(xs)
        for x in range(x0, x1 + 1):
            p = tone[(x - x0) % 4]
            if (y - 5) % 9 in (5, 6):                       # a batten across each leaf
                p = WD3 if (y - 5) % 9 == 5 else WD1
            if x in (x0, x1) or x == win.width // 2 - 1:   # the leaves' edges, the seam
                p = OUTL
            o.putpixel((x, y), p)
    return o


def wall_items():
    """On a wall's face (tile._wallDecor). hang: the foot of the sprite, in tiles above the floor."""
    W = {}
    win = window()
    shut = shutters(window(night=True))
    W['window'] = (win, 34, {'hang': 0.25, 'night': 'window_night', 'shut': 'window_shut', 'light': 'window'})
    W['window_night'] = (window(night=True), 34, {'hang': 0.25})
    W['window_shut'] = (shut, 34, {'hang': 0.25})
    curt = cut('Wall Items/Curtains.png', 160, 128, 64, 72)
    W['curtains'] = (stack((win, (curt.width - win.width) // 2, 3), (curt, 0, 0)), 48,
                     {'hang': 0.3, 'night': 'curtains_night', 'shut': 'curtains_shut', 'light': 'window'})
    W['curtains_night'] = (stack((window(night=True), (curt.width - 32) // 2, 3), (curt, 0, 0)), 48, {'hang': 0.3})
    W['curtains_shut'] = (stack((shut, (curt.width - 32) // 2, 3), (curt, 0, 0)), 48, {'hang': 0.3})
    W['torch'] = (cut('Wall Items/Lighting, Wall.png', 64, 0, 32, 64), 32, {'hang': 0.35, 'light': 'torch'})
    W['torch_unlit'] = (snuff(cut('Wall Items/Lighting, Wall.png', 64, 0, 32, 64), 'all'), 32, {'hang': 0.35})
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
    # (in the top corner of a cellar's back wall: its top at the face's head)
    W['cobweb'] = (cobweb(), 32, {'hang': 0.92})
    W['cobweb_r'] = (cobweb(right=True), 32, {'hang': 0.92})
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
    # (the wheel's layer without the yarn's long arc over its head: drawn, it rose half a
    # tile above the piece and over the wall behind it; the wheel and the distaff's wool stay)
    wheel = cut('Furniture/Sewing & Weaving/Spinning Wheel.png', 64, 30, 64, 34, keep=True)
    F['spinning_wheel'] = (stack((stand, 0, 0), (wheel, 0, 30), w=64, h=64), 44, {})
    F['basket'] = (cut('Small Items/Baskets A.png', 64, 0, 32, 32), 40, {})
    # (the kit's candelabra, its candles out)
    kit48 = Image.open(os.path.join(KIT, 'furniture48.png')).convert('RGBA')
    F['candle_unlit'] = (snuff(kit48.crop((0, 48, 48, 96)), 'wax', 0.36), 48, {})
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
    F['coat_rack'] = (coat_rack(), 27, {})
    F['shelf_bare'] = (shelf_bare(), 48, {})
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
        if k in ('night', 'shut'):
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
    ('Objects/Small Items/Food/Credits.txt', 'Grains, Grasses'),
    ('Objects/Small Items/Food/Credits.txt', 'Seafood A'),
    ('Objects/Small Items/Food/Credits.txt', 'Meats B'),
    ('Objects/Small Items/Food/Credits.txt', 'Cheese A'),
    ('Objects/Small Items/Food/Credits.txt', 'Eggs'),
    ('Objects/Small Items/Food/Credits.txt', 'Vegetables A'),
    ('Objects/Small Items/Food/Credits.txt', 'Mushrooms'),
    ('Objects/Small Items/Fabric/Credits.txt', 'Fabric Rolls, Groups'),
    ('Objects/Small Items/Fabric/Credits.txt', 'Fabric Rolls'),
    ('Objects/Small Items/Ores & Ingots/Credits.txt', 'Alloys & Ores'),
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
        'The kit pieces (banner, weapon rack: assets/buildingKit/furniture48.png; the emptied shop shelf: furniture_big.png) are the',
        'building kit\'s own. Drawn by the script pixel by pixel: the tankards (mugs), the',
        'stack of books, the coins, the antlers, the wall map, the coat rack, the cradle\'s',
        'blanket, the tapestry\'s rod, the window shutters, and a cellar\'s loose straw,',
        'spilt grain, damp patches and cobwebs.',
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
        for alt in ('night', 'shut'):
            if extra.get(alt):
                n = by[('wall', extra[alt])]
                e[alt] = {'sx': n['sx'], 'sy': n['sy'], 'sw': n['sw'], 'sh': n['sh']}
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
