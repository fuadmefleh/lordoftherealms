# The things a town job puts in your hands, painted for the street map: what
# you carry (a grain sack, a crate, an armful of firewood, a hod of bricks),
# what a work spot is marked with (the axe at the woodpile, the shovel where a
# pit is to be dug, the bell where the crier stands) and the piles that shrink
# at a pick-up and grow at a drop-off. One atlas, 128px a cell (4x a 32px map
# cell, like the other modern sheets), read by ui/jobItems.js through
# data/mapTasks.json `itemArt`.
#
#   python -I build_job_items.py            -> assets/modern/items/job_items.png
#                                              + prints the itemArt rects
#
# Two sources:
#   - CUT: items already repainted in the modern style (build_details.py,
#     build_props.py): sacks, firewood, crates, barrels, buckets, baskets,
#     planks, fish - cut out of their sheets, so the carried sack is the same
#     sack as the pile in the farmyard;
#   - PAINTED: the rest, drawn here as shapes at 4x supersampling and shaded
#     like the painted kits: a soft height field per part gives each piece its
#     roundness (lit from the upper left), a fine grain/speckle per material,
#     a darker rim for the outline and a contact shadow where one part sits on
#     another.
import os
import sys
import json
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'modern', 'items', 'job_items.png')
CELL = 128
SS = 4                 # supersampling for painted parts
N = CELL * SS
COLS = 8

_rng = np.random.default_rng(20261106)
LIGHT = np.array([-0.55, -0.75, 0.62])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


# ── cutting from the modern sheets ──────────────────────────────

def sheet(rel):
    return np.array(Image.open(os.path.join(ROOT, 'assets', 'modern', rel)).convert('RGBA'))


def cut(rel, box, keep_largest=True):
    """box = (x, y, w, h) in the 4x sheet; the piece's own pixels only."""
    a = sheet(rel)
    x, y, w, h = box
    c = a[y:y + h, x:x + w].copy()
    if keep_largest:
        lab, n = ndimage.label(c[..., 3] > 30)
        if n > 1:
            sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
            keep = 1 + int(np.argmax(sizes))
            # keep the main piece and anything touching it once grown a little
            grown = ndimage.binary_dilation(lab == keep, iterations=3)
            ids = set(np.unique(lab[grown])) - {0}
            c[~np.isin(lab, list(ids)) & (c[..., 3] > 0)] = 0
    return Image.fromarray(c)


# ── painting ─────────────────────────────────────────────────────

def canvas():
    return Image.new('L', (N, N), 0)


def S(v):
    return v * SS


def poly(pts, img=None):
    img = img or canvas()
    ImageDraw.Draw(img).polygon([(S(x), S(y)) for x, y in pts], fill=255)
    return img


def ell(cx, cy, rx, ry, img=None):
    img = img or canvas()
    ImageDraw.Draw(img).ellipse([S(cx - rx), S(cy - ry), S(cx + rx), S(cy + ry)], fill=255)
    return img


def rrect(x0, y0, x1, y1, r, img=None):
    img = img or canvas()
    ImageDraw.Draw(img).rounded_rectangle([S(x0), S(y0), S(x1), S(y1)], radius=S(r), fill=255)
    return img


def line(pts, w, img=None):
    img = img or canvas()
    d = ImageDraw.Draw(img)
    P = [(S(x), S(y)) for x, y in pts]
    d.line(P, fill=255, width=int(S(w)), joint='curve')
    for x, y in P:
        d.ellipse([x - S(w) / 2, y - S(w) / 2, x + S(w) / 2, y + S(w) / 2], fill=255)
    return img


def curve(p0, p1, p2, steps=24):
    out = []
    for i in range(steps + 1):
        t = i / steps
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def M(img):
    return np.asarray(img, dtype=np.float32) / 255


def noise(sig, aniso=None):
    n = _rng.standard_normal((N, N)).astype(np.float32)
    n = ndimage.gaussian_filter(n, aniso or sig)
    return n / (n.std() + 1e-6)


TEX = {}


def tex(kind):
    if kind not in TEX:
        if kind == 'grain':      # wood, along x
            TEX[kind] = 0.6 * noise(0, (1.2, 14)) + 0.4 * noise(0, (3, 30))
        elif kind == 'grainv':   # wood, along y
            TEX[kind] = 0.6 * noise(0, (14, 1.2)) + 0.4 * noise(0, (30, 3))
        elif kind == 'weave':    # burlap / cloth
            yy, xx = np.mgrid[0:N, 0:N]
            w = np.sin(xx * 0.9) * np.sin(yy * 0.9)
            TEX[kind] = 0.5 * w + 0.5 * noise(1.5)
        elif kind == 'speckle':
            TEX[kind] = noise(1.2)
        elif kind == 'smooth':
            TEX[kind] = noise(6)
        elif kind == 'straw':
            TEX[kind] = 0.7 * noise(0, (16, 1.0)) + 0.3 * noise(2)
    return TEX[kind]


class Pic:
    """Parts painted in order onto a 4x canvas, then brought down to 128px."""

    def __init__(self):
        self.rgb = np.zeros((N, N, 3), np.float32)
        self.a = np.zeros((N, N), np.float32)

    def part(self, mask, color, round_=10, tex_=None, tex_amt=0.06, rim=0.5, gloss=0.0,
             shade=1.0, shadow=0.35, grad=0.12, flat=False):
        m = M(mask) if not isinstance(mask, np.ndarray) else mask
        m = ndimage.gaussian_filter(m, 0.9)
        if m.max() <= 0:
            return self
        # contact shadow of this part onto what is already there
        if shadow > 0 and self.a.max() > 0:
            sh = ndimage.shift(ndimage.gaussian_filter(m, S(1.6)), (S(1.6), S(1.0)), order=1)
            k = np.clip(sh * shadow * self.a * (1 - m), 0, 1)
            self.rgb *= (1 - k[..., None] * 0.8)
        col = np.array(color, np.float32) / 255
        if flat:
            lit = np.ones_like(m)
        else:
            h = ndimage.gaussian_filter(m, S(round_ / 4))
            gy, gx = np.gradient(h * S(round_ / 2))
            nz = np.ones_like(h)
            nrm = np.sqrt(gx * gx + gy * gy + nz)
            dot = (-gx * LIGHT[0] - gy * LIGHT[1] + nz * LIGHT[2]) / nrm
            lit = 0.45 + 0.75 * np.clip(dot, 0, 1)
            lit = 1 + (lit - 1) * shade
        # a soft top-to-bottom fall-off over the part's own height
        ys = np.where(m.max(axis=1) > 0.5)[0]
        if len(ys) and grad:
            yy = np.arange(N, dtype=np.float32)
            t = np.clip((yy - ys[0]) / max(1, ys[-1] - ys[0]), 0, 1)
            lit = lit * (1 + grad * (0.5 - t))[:, None]
        c = col[None, None, :] * lit[..., None]
        if tex_:
            c = c * (1 + tex_amt * tex(tex_)[..., None])
        if gloss:
            g = np.clip((lit - 1.0) * 3, 0, 1) ** 2 * gloss
            c = c + g[..., None] * (1 - c)
        # outline: the rim just inside the edge, darker
        inner = ndimage.gaussian_filter((ndimage.distance_transform_edt(m > 0.5) > S(1.1)).astype(np.float32), 1.2)
        edge = np.clip(m - inner, 0, 1)
        c = c * (1 - rim * edge[..., None])
        c = np.clip(c, 0, 1)
        self.rgb = self.rgb * (1 - m[..., None]) + c * m[..., None]
        self.a = self.a + m * (1 - self.a)
        return self

    def stroke(self, pts, w, color, **kw):
        kw.setdefault('round_', w * 1.2)
        return self.part(line(pts, w), color, **kw)

    def image(self):
        rgba = np.dstack([self.rgb, self.a]) * 255
        im = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')
        # premultiplied-style downsample keeps dark fringes off the edges
        pm = np.dstack([self.rgb * self.a[..., None], self.a])
        pmi = [Image.fromarray(np.clip(pm[..., i] * 255, 0, 255).astype(np.uint8)).resize((CELL, CELL), Image.LANCZOS)
               for i in range(4)]
        arr = np.dstack([np.asarray(p, np.float32) for p in pmi])
        al = arr[..., 3:4] / 255
        rgb = np.where(al > 0.003, arr[..., :3] / np.maximum(al, 1e-3), 0)
        out = np.dstack([np.clip(rgb, 0, 255), arr[..., 3]]).astype(np.uint8)
        del im
        return Image.fromarray(out, 'RGBA')


# palette
WOOD = (132, 88, 52)
WOOD_L = (170, 122, 74)
WOOD_D = (92, 58, 34)
IRON = (118, 124, 134)
IRON_D = (70, 74, 84)
BRASS = (196, 150, 62)
KRAFT = (184, 146, 98)
TWINE = (214, 192, 140)
CREAM = (236, 224, 196)
WAX = (166, 34, 30)
LEATHER = (118, 70, 40)
LEATHER_R = (122, 44, 36)
GOLD = (226, 182, 70)
BRICK = (172, 82, 58)
BURLAP = (196, 168, 120)
ROPE = (150, 118, 72)
WHEAT = (222, 186, 96)
STRAW = (200, 164, 80)
GREEN = (92, 142, 64)
GREEN_D = (60, 104, 48)
GLASS = (96, 150, 120)
STONE = (150, 146, 138)


def p_parcel():
    p = Pic()
    # a box in three-quarter view: front, side, top
    p.part(poly([(30, 58), (84, 58), (84, 104), (30, 104)]), KRAFT, round_=4, tex_='speckle', tex_amt=0.05, grad=0.15)
    p.part(poly([(84, 58), (100, 46), (100, 92), (84, 104)]), tuple(int(v * 0.78) for v in KRAFT), round_=4, tex_='speckle', shadow=0)
    p.part(poly([(30, 58), (46, 46), (100, 46), (84, 58)]), tuple(min(255, int(v * 1.12)) for v in KRAFT), round_=4, tex_='speckle', shadow=0)
    # twine round it both ways and a bow on top
    p.stroke([(57, 58), (57, 104)], 3.2, TWINE, shadow=0.2, rim=0.35)
    p.stroke([(30, 80), (84, 80), (100, 68)], 3.2, TWINE, shadow=0.2, rim=0.35)
    p.stroke([(38, 52), (92, 52)], 3.0, TWINE, shadow=0.1, rim=0.35)
    p.stroke([(72, 46), (57, 58)], 3.0, TWINE, shadow=0.1, rim=0.35)
    p.part(ell(64, 50, 8, 4.5), TWINE, round_=4, rim=0.4)
    p.part(ell(55, 47, 6, 3.5), TWINE, round_=4, rim=0.4)
    return p


def p_letter():
    p = Pic()
    env = [(24, 58), (100, 48), (106, 92), (30, 102)]
    p.part(poly(env), CREAM, round_=3, tex_='speckle', tex_amt=0.03, grad=0.1)
    # the flap's folds
    p.stroke([(24, 58), (66, 80), (100, 48)], 1.6, (196, 180, 150), shadow=0, rim=0.1, flat=True)
    p.stroke([(30, 102), (62, 82)], 1.4, (206, 192, 164), shadow=0, rim=0.1, flat=True)
    p.stroke([(106, 92), (70, 79)], 1.4, (206, 192, 164), shadow=0, rim=0.1, flat=True)
    # the wax seal
    p.part(ell(66, 80, 10, 9), WAX, round_=8, gloss=0.5, rim=0.45)
    p.part(ell(66, 80, 5.5, 5), (140, 26, 24), round_=4, shadow=0, rim=0.2)
    return p


def p_ledger():
    p = Pic()
    # pages block under the cover, then the cover
    p.part(poly([(30, 62), (90, 52), (102, 92), (42, 104)]), CREAM, round_=3, tex_='straw', tex_amt=0.05)
    p.part(poly([(26, 56), (88, 46), (98, 84), (36, 96)]), LEATHER_R, round_=6, tex_='speckle', tex_amt=0.06, gloss=0.15)
    p.stroke([(40, 54), (50, 93)], 3.6, (90, 32, 26), shadow=0, rim=0.3)
    # a clasp strap and a gilt line
    p.stroke([(92, 66), (104, 64)], 4.0, LEATHER, shadow=0.2)
    p.part(rrect(98, 61, 106, 69, 1.5), BRASS, round_=3, gloss=0.6)
    p.stroke([(58, 60), (82, 56)], 1.4, GOLD, shadow=0, rim=0.1, gloss=0.4)
    p.stroke([(61, 72), (85, 68)], 1.4, GOLD, shadow=0, rim=0.1, gloss=0.4)
    return p


def p_quill():
    p = Pic()
    # an ink pot with a feather quill in it, beside a sheet
    p.part(poly([(22, 84), (78, 76), (88, 104), (30, 110)]), CREAM, round_=3, tex_='speckle', tex_amt=0.03)
    p.stroke([(34, 90), (70, 85)], 1.3, (120, 110, 100), shadow=0, rim=0, flat=True)
    p.stroke([(36, 97), (66, 93)], 1.3, (120, 110, 100), shadow=0, rim=0, flat=True)
    p.part(ell(84, 96, 15, 13), (40, 46, 60), round_=12, gloss=0.6)
    p.part(ell(84, 84, 8, 3.5), (24, 26, 34), round_=3, shadow=0)
    vane = curve((84, 84), (88, 40), (112, 14), 20)
    left = [(x - 7 * math.sin(math.pi * i / 20) ** 0.7, y - 2) for i, (x, y) in enumerate(vane)]
    p.part(poly(vane[::-1] + left[6:] + [vane[-1]]), (240, 236, 226), round_=5, tex_='straw', tex_amt=0.05)
    p.stroke(vane, 1.6, (200, 190, 170), shadow=0, rim=0.2)
    return p


def p_purse():
    p = Pic()
    # a few coins spilled beside it
    for cx, cy in [(92, 98), (100, 92), (84, 104)]:
        p.part(ell(cx, cy, 9, 5), GOLD, round_=4, gloss=0.6, rim=0.45)
    p.part(ell(56, 82, 26, 24), LEATHER, round_=18, tex_='speckle', tex_amt=0.06, gloss=0.15)
    # gathered neck and tie
    p.part(poly([(44, 60), (68, 60), (74, 48), (38, 48)]), tuple(int(v * 0.92) for v in LEATHER), round_=6, tex_='grainv', tex_amt=0.1)
    p.part(ell(56, 46, 20, 6), tuple(int(v * 1.1) for v in LEATHER), round_=6)
    p.stroke([(40, 60), (72, 60)], 3.2, TWINE, rim=0.3)
    p.stroke([(72, 60), (80, 70)], 2.6, TWINE, rim=0.3)
    p.part(ell(68, 102, 8, 4.5), GOLD, round_=4, gloss=0.6, rim=0.45)
    return p


def p_bricks():
    p = Pic()
    # a stack of bricks on a hod: four layers, staggered
    bw, bh = 30, 12
    for row in range(4):
        y = 98 - row * (bh + 1)
        off = 0 if row % 2 == 0 else bw / 2
        for i in range(3 if row % 2 == 0 else 2):
            x = 22 + off + i * (bw + 1.5)
            shade = 0.9 + 0.2 * _rng.random()
            col = tuple(int(min(255, v * shade)) for v in BRICK)
            p.part(rrect(x, y, x + bw, y + bh, 2), col, round_=4, tex_='speckle', tex_amt=0.1, shadow=0.3, rim=0.45)
            p.part(poly([(x + 2, y), (x + 6, y - 4), (x + bw + 4, y - 4), (x + bw, y)]),
                   tuple(min(255, int(v * 1.12)) for v in col), round_=2, tex_='speckle', tex_amt=0.1, shadow=0, rim=0.3)
    return p


def p_bale():
    p = Pic()
    p.part(rrect(20, 44, 108, 104, 16), BURLAP, round_=16, tex_='weave', tex_amt=0.08, grad=0.15)
    p.stroke([(44, 46), (40, 102)], 4.5, ROPE, shadow=0.25, rim=0.35)
    p.stroke([(84, 46), (88, 102)], 4.5, ROPE, shadow=0.25, rim=0.35)
    p.stroke([(22, 74), (106, 72)], 4.0, ROPE, shadow=0.25, rim=0.35)
    return p


def p_wheat():
    p = Pic()
    # a bound sheaf: stalks fanned below the band, ears at the top
    for i in range(16):
        t = i / 15
        x0 = 44 + 40 * t
        p.stroke([(x0, 110), (60 + 8 * t, 74), (40 + 48 * t, 34)], 2.2, STRAW, round_=2, shadow=0.1, rim=0.25,
                 tex_='straw', tex_amt=0.06)
    for i in range(16):
        t = i / 15
        ang = -0.6 + 1.2 * t
        cx, cy = 40 + 48 * t, 30 - 8 * math.cos(ang)
        p.part(ell(cx, cy, 4.2, 9.5), WHEAT, round_=5, shadow=0.25, rim=0.4, tex_='straw', tex_amt=0.08)
    p.stroke([(52, 76), (78, 76)], 6.0, (170, 130, 62), shadow=0.3, rim=0.4, tex_='straw', tex_amt=0.1)
    return p


def p_herbs():
    p = Pic()
    for i in range(9):
        t = i / 8
        p.stroke([(58 + 10 * t, 108), (62 + 4 * t, 80), (32 + 60 * t, 32 + 10 * abs(t - 0.5))], 2.0, GREEN_D, round_=2,
                 shadow=0.1, rim=0.2)
    leaves = [(30, 40), (42, 30), (54, 26), (66, 24), (78, 28), (90, 36), (98, 46), (36, 54), (50, 44), (62, 40),
              (76, 42), (88, 52), (46, 60), (78, 58), (62, 54)]
    for j, (x, y) in enumerate(leaves):
        g = GREEN if j % 3 else (118, 160, 82)
        p.part(ell(x, y, 8, 5.5), g, round_=5, shadow=0.3, rim=0.4)
    for x, y in [(44, 34), (70, 30), (90, 44)]:
        p.part(ell(x, y, 3.5, 3.5), (186, 150, 210), round_=3, shadow=0.2, rim=0.35)
    p.stroke([(54, 82), (76, 80)], 4.5, TWINE, shadow=0.3, rim=0.35)
    return p


def p_vial():
    p = Pic()
    p.part(ell(64, 84, 24, 24), (110, 140, 96), round_=18, gloss=0.8, rim=0.45)
    p.part(rrect(54, 40, 74, 66, 4), (110, 140, 96), round_=6, gloss=0.6, rim=0.45, shadow=0)
    p.part(rrect(52, 26, 76, 44, 5), (168, 128, 82), round_=6, tex_='speckle', tex_amt=0.1)
    p.part(ell(64, 92, 18, 12), (78, 52, 92), round_=10, gloss=0.3, shadow=0, rim=0.1)
    p.stroke([(52, 66), (76, 66)], 3.0, TWINE, shadow=0.2, rim=0.3)
    return p


def _handle(p, a, b, w=7, col=WOOD_L):
    p.stroke([a, b], w, col, round_=w, tex_='grain', tex_amt=0.12, shadow=0.25)


def p_axe():
    p = Pic()
    _handle(p, (34, 114), (86, 20))
    head = [(74, 22), (100, 12), (112, 30), (104, 54), (84, 40)]
    p.part(poly(head), IRON, round_=8, gloss=0.5, tex_='speckle', tex_amt=0.04)
    p.stroke([(103, 15), (108, 32), (102, 50)], 2.4, (200, 206, 214), shadow=0, rim=0, gloss=0.6)
    return p


def p_pickaxe():
    p = Pic()
    _handle(p, (34, 114), (78, 26))
    head = curve((20, 40), (70, 0), (118, 44), 24)
    p.stroke(head, 9, IRON, round_=8, gloss=0.5)
    p.part(rrect(70, 16, 88, 34, 4), IRON_D, round_=5, gloss=0.3)
    return p


def p_shovel():
    p = Pic()
    _handle(p, (28, 16), (70, 76))
    p.stroke([(22, 12), (36, 22)], 6, WOOD_D, shadow=0.2)
    blade = [(62, 70), (82, 58), (110, 92), (102, 114), (84, 116)]
    p.part(poly(blade), IRON, round_=10, gloss=0.45, tex_='speckle', tex_amt=0.05)
    p.part(rrect(62, 62, 78, 76, 3), IRON_D, round_=4, shadow=0.2)
    return p


def p_scythe():
    p = Pic()
    snath = curve((26, 116), (52, 60), (80, 16), 20)
    p.stroke(snath, 6, WOOD_L, tex_='grain', tex_amt=0.12)
    p.stroke([(44, 80), (58, 74)], 5, WOOD_D, shadow=0.2)
    blade = curve((80, 14), (112, 26), (118, 66), 24)
    inner = curve((116, 62), (106, 34), (80, 24), 24)
    p.part(poly(blade + inner), IRON, round_=6, gloss=0.6)
    return p


def p_hammer():
    p = Pic()
    _handle(p, (38, 116), (74, 42), 8)
    p.part(rrect(46, 22, 108, 46, 5), IRON, round_=10, gloss=0.5)
    p.part(rrect(98, 20, 112, 48, 4), IRON_D, round_=6, gloss=0.4, shadow=0.2)
    return p


def p_bell():
    p = Pic()
    _handle(p, (64, 14), (64, 46), 10, WOOD)
    bell = [(42, 92), (46, 60), (54, 46), (74, 46), (82, 60), (86, 92)]
    p.part(poly(bell), BRASS, round_=16, gloss=0.75)
    p.part(ell(64, 92, 26, 7), (226, 186, 92), round_=6, gloss=0.6, shadow=0)
    p.part(ell(64, 100, 6, 6), IRON_D, round_=5, gloss=0.4)
    return p


def p_lantern():
    p = Pic()
    p.stroke(curve((50, 30), (64, 6), (78, 30), 12), 3.5, IRON_D, shadow=0)
    p.part(poly([(42, 36), (86, 36), (78, 26), (50, 26)]), IRON_D, round_=4, gloss=0.3)
    p.part(rrect(46, 38, 82, 98, 3), (255, 214, 120), round_=14, gloss=0.4, rim=0.2, shade=0.5)
    p.part(ell(64, 72, 9, 16), (255, 246, 210), round_=8, shadow=0, rim=0, shade=0.2)
    for x in (46, 64, 82):
        p.stroke([(x, 38), (x, 98)], 3.4, IRON_D, shadow=0.1, rim=0.3)
    p.part(rrect(40, 96, 88, 106, 3), IRON_D, round_=4, gloss=0.3)
    return p


def p_candle():
    p = Pic()
    p.part(ell(64, 104, 30, 9), BRASS, round_=8, gloss=0.6)
    p.part(rrect(52, 46, 76, 102, 6), (240, 230, 200), round_=12, gloss=0.3)
    p.part(ell(64, 47, 12, 4), (250, 244, 224), round_=4, shadow=0)
    p.stroke([(64, 46), (64, 38)], 1.6, (50, 40, 30), shadow=0, rim=0)
    p.part(poly(curve((56, 38), (60, 18), (64, 8), 10) + curve((64, 8), (70, 20), (72, 38), 10)),
           (255, 196, 80), round_=6, shade=0.3, rim=0.1, shadow=0)
    p.part(ell(64, 30, 4, 7), (255, 248, 210), round_=3, shade=0.2, rim=0, shadow=0)
    return p


def p_snare():
    p = Pic()
    p.part(poly([(60, 30), (70, 30), (68, 104), (62, 104)]), WOOD_L, round_=6, tex_='grainv', tex_amt=0.1)
    p.part(poly([(56, 30), (74, 30), (65, 18)]), WOOD, round_=4)
    loop = [(64 + 34 * math.cos(a), 86 + 16 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)]
    p.stroke(loop, 2.6, (186, 160, 112), shadow=0.25, rim=0.3)
    p.stroke([(64, 40), (78, 60), (96, 84)], 2.4, (186, 160, 112), shadow=0.2, rim=0.3)
    return p


def p_orb():
    p = Pic()
    p.part(poly([(40, 108), (88, 108), (80, 88), (48, 88)]), WOOD_D, round_=6, tex_='grain', tex_amt=0.1)
    p.part(ell(64, 62, 30, 30), (150, 140, 220), round_=26, gloss=0.85, rim=0.35)
    p.part(ell(58, 66, 14, 10), (196, 170, 240), round_=10, shade=0.4, shadow=0, rim=0)
    p.part(ell(54, 50, 6, 4), (250, 248, 255), round_=4, shade=0.1, shadow=0, rim=0)
    return p


def p_stool():
    p = Pic()
    for a, b in [((40, 64), (28, 112)), ((88, 64), (100, 112)), ((64, 68), (64, 116))]:
        p.stroke([a, b], 7, WOOD, tex_='grainv', tex_amt=0.12)
    p.stroke([(34, 94), (94, 94)], 4, WOOD_D, shadow=0.2)
    p.part(ell(64, 60, 38, 13), WOOD_L, round_=10, tex_='grain', tex_amt=0.12, gloss=0.2)
    return p


def p_swords():
    p = Pic()
    for flip in (1, -1):
        cx = 64
        a, b = (cx - flip * 40, 112), (cx + flip * 36, 18)
        p.stroke([a, b], 8, (190, 156, 108), tex_='grain', tex_amt=0.1, shadow=0.3)
        mx, my = a[0] + (b[0] - a[0]) * 0.22, a[1] + (b[1] - a[1]) * 0.22
        p.stroke([(mx - 12, my - 5 * flip), (mx + 12, my + 5 * flip)], 6, WOOD_D, shadow=0.2)
    return p


def p_hurdle():
    p = Pic()
    for x in (28, 64, 100):
        p.stroke([(x, 34), (x, 110)], 6, WOOD, tex_='grainv', tex_amt=0.12)
    for y in (48, 64, 80, 96):
        p.stroke([(22, y + 3), (106, y - 3)], 5, WOOD_L, tex_='grain', tex_amt=0.12, shadow=0.35)
    return p


def p_rat():
    p = Pic()
    tail = curve((30, 84), (8, 92), (14, 66), 20)
    p.stroke(tail, 3.2, (200, 150, 150), shadow=0, rim=0.3)
    p.part(ell(56, 80, 30, 18), (112, 104, 98), round_=14, tex_='speckle', tex_amt=0.08)
    p.part(poly([(76, 70), (108, 82), (78, 94)]), (124, 116, 108), round_=10, tex_='speckle', tex_amt=0.08)
    p.part(ell(78, 66, 7, 7), (190, 150, 150), round_=5)
    p.part(ell(94, 78, 2.6, 2.6), (20, 18, 18), round_=2, gloss=0.6, shadow=0, rim=0)
    p.part(ell(108, 82, 3, 3), (220, 160, 160), round_=2, shadow=0)
    for x in (46, 68):
        p.part(ell(x, 97, 5, 3), (190, 150, 150), round_=3, shadow=0.2)
    return p


def p_tracks():
    p = Pic()
    for (cx, cy, s) in [(40, 92, 1), (76, 62, 1), (52, 40, 0.85), (90, 22, 0.75)]:
        col = (70, 52, 38)
        p.part(ell(cx, cy, 8 * s, 7 * s), col, round_=4, flat=True, rim=0.1, shadow=0)
        for dx, dy in [(-8, -8), (-2.5, -11), (3.5, -11), (9, -7)]:
            p.part(ell(cx + dx * s, cy + dy * s, 3 * s, 3.6 * s), col, round_=2, flat=True, rim=0.1, shadow=0)
    return p


def p_fruit_basket(basket):
    """The round basket with apples heaped in it."""
    p = Pic()
    p.a[:] = 0
    base = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    base.alpha_composite(basket, ((CELL - basket.width) // 2, CELL - 4 - basket.height))
    b = np.asarray(base.resize((N, N), Image.LANCZOS), np.float32) / 255
    p.rgb = b[..., :3].copy()
    p.a = b[..., 3].copy()
    ys = np.where(p.a.max(axis=1) > 0.5)[0]
    top = ys[0] / SS if len(ys) else 30
    for i, (dx, dy) in enumerate([(-22, 8), (-6, 10), (12, 9), (26, 7), (-14, 0), (4, 0), (20, -1), (-4, -9), (12, -9)]):
        col = (188, 40, 36) if i % 3 else (214, 120, 40)
        p.part(ell(64 + dx, top + 14 + dy, 10, 9.5), col, round_=9, gloss=0.55, shadow=0.4, rim=0.45)
        p.stroke([(64 + dx + 1, top + 6 + dy), (64 + dx + 3, top + 2 + dy)], 1.6, WOOD_D, shadow=0, rim=0)
    return p


PAINTED = {
    'parcel': p_parcel, 'letter': p_letter, 'ledger': p_ledger, 'quill': p_quill, 'purse': p_purse,
    'bricks': p_bricks, 'bale': p_bale, 'wheat': p_wheat, 'herbs': p_herbs, 'vial': p_vial,
    'axe': p_axe, 'pickaxe': p_pickaxe, 'shovel': p_shovel, 'scythe': p_scythe, 'hammer': p_hammer,
    'bell': p_bell, 'lantern': p_lantern, 'candle': p_candle, 'snare': p_snare, 'orb': p_orb,
    'stool': p_stool, 'swords': p_swords, 'hurdle': p_hurdle, 'rat': p_rat, 'tracks': p_tracks,
}

FF = 'lpc/ThatchedHouses/tilesets/farming_fishing.png'
CUT = {
    'sack':        (FF, (192, 259, 128, 125)),
    'sack_pile':   (FF, (384, 259, 257, 253)),
    'grain_sack':  (FF, (193, 540, 127, 100)),
    'firewood':    (FF, (200, 0, 120, 128)),
    'firewood_pile': (FF, (412, 20, 208, 220)),
    'log':         (FF, (673, 12, 55, 93)),
    'fish':        (FF, (2304, 416, 128, 64)),
    'crate':       ('lpc/Objects/Furniture/Crate.png', (256, 128, 128, 128)),
    'crate_big':   ('lpc/Objects/Furniture/Crate.png', (0, 128, 128, 128)),
    'barrel':      ('lpc/Objects/Furniture/Barrel.png', (0, 0, 128, 256)),
    'bucket':      ('lpc/Objects/Small Items/Buckets.png', (0, 128, 128, 128)),
    'basket':      ('lpc/Objects/Small Items/Baskets A.png', (256, 0, 128, 128)),
    'planks':      ('lpc/Objects/Small Items/Lumber.png', (640, 128, 128, 128)),
}


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def build():
    pieces = {}
    for name, (rel, box) in CUT.items():
        pieces[name] = trim(cut(rel, box))
    pieces['fruit_basket'] = trim(p_fruit_basket(trim(cut(*CUT['basket'])).resize((110, 92))).image())
    for name, fn in PAINTED.items():
        pieces[name] = trim(fn().image())
    # piles wider than a cell are scaled to fit one
    names = list(pieces)
    rows = (len(names) + COLS - 1) // COLS
    atlas = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    rects = {}
    for i, n in enumerate(names):
        im = pieces[n]
        k = min(1, (CELL - 4) / im.width, (CELL - 4) / im.height)
        if k < 1:
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        cx, cy = (i % COLS) * CELL, (i // COLS) * CELL
        x = cx + (CELL - im.width) // 2
        y = cy + CELL - 2 - im.height          # sits on the cell's floor
        atlas.alpha_composite(im, (x, y))
        rects[n] = [x, y, im.width, im.height, round(1 / k, 3) if k < 1 else 1]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    atlas.save(OUT, optimize=True)
    return rects


if __name__ == '__main__':
    r = build()
    print(json.dumps(r))
    sys.stderr.write('wrote %s (%d items)\n' % (OUT, len(r)))
