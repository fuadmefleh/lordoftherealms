"""
Town walls, composed from the building kit's own tiles (data/townEras.json art;
world/townWalls.js lays them; worlds made since terrainGen 8).

Nothing is drawn freehand: every cell is cut from the kit's painted wall sheets
(assets/buildingKit/modern/walls_<x>.png, 3x3 nine-slices of 128px cells) and
the street sheet's paving (assets/lpc/Structure/Floor/streets_modern.png, 2x2
blocks of 128px cells), shaded and masked.

Each material is a band of three rows of 128px cells in
assets/buildingKit/town_walls.png:

  row 0  the wall's top by the sides it joins (16 masks: n=1, e=2, s=4, w=8),
         and (col 16) a gate tower's top
         - stone: the wall walk paved with the street stone, a crenellated
           parapet on an open north side, a coping rim on the other open sides
         - palisade: stake tips (or a mud wall's rounded coping) running out to
           the joined sides, a narrow run of stakes seen end-on north and south
  row 1  the face, upper (stone) / the face (palisade), by its open ends
         (0 alone, 1 joined east, 2 joined west, 3 both)
  row 2  the face, lower (stone only)

Registered in data/innerMapRenderer.json hiResSheets at a quarter of its width,
so the map addresses it in 32px cells (ui/sheetScale.js).

Run from the repo root: python scripts/make_town_walls.py
"""
import json
import os

import numpy as np
from PIL import Image, ImageFilter

C = 128
OUT = 'assets/buildingKit/town_walls.png'
STREETS = 'assets/lpc/Structure/Floor/streets_modern.png'
KIT = 'assets/buildingKit/modern/walls_{}.png'
COLS = 17


def load(path):
    return Image.open(path).convert('RGBA')


def cell(img, cx, cy):
    return img.crop((cx * C, cy * C, cx * C + C, cy * C + C))


def shade(im, k):
    a = np.array(im).astype(np.float32)
    a[..., :3] = np.clip(a[..., :3] * k, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def blank():
    return Image.new('RGBA', (C, C), (0, 0, 0, 0))


def paste_box(dst, src, box):
    """src cropped to box (x0, y0, x1, y1) pasted at the same place."""
    x0, y0, x1, y1 = [int(v) for v in box]
    if x1 <= x0 or y1 <= y0:
        return
    piece = src.crop((x0, y0, x1, y1))
    dst.alpha_composite(piece, (x0, y0))


def outline_box(dst, box, rgba, w=3):
    x0, y0, x1, y1 = [int(v) for v in box]
    a = np.array(dst)
    a[y0:y0 + w, x0:x1] = rgba
    a[y1 - w:y1, x0:x1] = rgba
    a[y0:y1, x0:x0 + w] = rgba
    a[y0:y1, x1 - w:x1] = rgba
    dst.paste(Image.fromarray(a, 'RGBA'))


# ── Stone ─────────────────────────────────────────────────────────────

def stone_faces(face_sheet):
    """Upper and lower face cells by open ends: the kit nine-slice's top and
    bottom rows, its corner pilasters where the run ends."""
    top = [cell(face_sheet, i, 0) for i in range(3)]
    bot = [cell(face_sheet, i, 2) for i in range(3)]
    mid = [cell(face_sheet, i, 1) for i in range(3)]

    def join(row, idx):
        # idx: 0 alone, 1 joined east (open west: left pilaster), 2 joined west (right pilaster), 3 both
        left_open = idx in (0, 1)
        right_open = idx in (0, 2)
        out = row[1].copy()
        if left_open:
            out.paste(row[0].crop((0, 0, C // 2, C)), (0, 0))
        if right_open:
            out.paste(row[2].crop((C // 2, 0, C, C)), (C // 2, 0))
        return out

    # the upper face: the kit's top row (its coping band) over its middle stones,
    # the lower: the middle stones down to its plinth
    uppers, lowers = [], []
    for idx in range(4):
        u = join(top, idx)
        m = join(mid, idx)
        lo = join(bot, idx)
        # a long wall: the top band, then stone, then the plinth — the middle row
        # between them so the courses run on
        upper = u.copy()
        upper.paste(m.crop((0, C // 2, C, C)), (0, C // 2))
        lower = lo.copy()
        lower.paste(m.crop((0, 0, C, C // 2)), (0, 0))
        uppers.append(upper)
        lowers.append(shade(lower, 0.94))
    return uppers, lowers


def merlons(dst, stone, x0, x1, y_top, depth, tooth=26, gap=14):
    """A crenellated parapet along the top of a cell from x0 to x1: a low wall
    `depth` px under teeth `tooth` wide with gaps `gap` (the sky through them)."""
    low_top = y_top + 16
    paste_box(dst, stone, (x0, low_top, x1, y_top + depth))
    a = np.array(dst)
    # the parapet's own top, lit
    a[low_top:low_top + 3, x0:x1, :3] = np.clip(a[low_top:low_top + 3, x0:x1, :3].astype(np.int32) + 40, 0, 255).astype(np.uint8)
    dst.paste(Image.fromarray(a, 'RGBA'))
    x = x0 + 6
    while x + tooth <= x1 - 2:
        paste_box(dst, stone, (x, y_top, x + tooth, low_top))
        a = np.array(dst)
        a[y_top:y_top + 4, x:x + tooth, :3] = np.clip(a[y_top:y_top + 4, x:x + tooth, :3].astype(np.int32) + 45, 0, 255).astype(np.uint8)
        a[y_top:low_top, x + tooth - 3:x + tooth, :3] = (a[y_top:low_top, x + tooth - 3:x + tooth, :3] * 0.6).astype(np.uint8)
        dst.paste(Image.fromarray(a, 'RGBA'))
        x += tooth + gap
    # its shadow on the walk below
    a = np.array(dst)
    sy = y_top + depth
    a[sy:sy + 8, x0:x1, :3] = (a[sy:sy + 8, x0:x1, :3] * 0.72).astype(np.uint8)
    dst.paste(Image.fromarray(a, 'RGBA'))


def rim(dst, stone, side, w=14):
    """A coping rim along an open side of the wall walk."""
    box = {'e': (C - w, 0, C, C), 'w': (0, 0, w, C), 's': (0, C - 10, C, C), 'n': (0, 0, C, w)}[side]
    lit = shade(stone, 1.18)
    paste_box(dst, lit, box)
    x0, y0, x1, y1 = box
    a = np.array(dst)
    if side == 'e':
        a[:, x0:x0 + 3, :3] = (a[:, x0:x0 + 3, :3] * 0.55).astype(np.uint8)
    elif side == 'w':
        a[:, x1 - 3:x1, :3] = (a[:, x1 - 3:x1, :3] * 0.55).astype(np.uint8)
    elif side == 's':
        a[y0:y0 + 3, :, :3] = (a[y0:y0 + 3, :, :3] * 0.6).astype(np.uint8)
    dst.paste(Image.fromarray(a, 'RGBA'))


def stone_cap(mask, walk, stone):
    n, e, s, w = bool(mask & 1), bool(mask & 2), bool(mask & 4), bool(mask & 8)
    out = blank()
    out.alpha_composite(walk)
    if not e:
        rim(out, stone, 'e')
    if not w:
        rim(out, stone, 'w')
    if not s:
        rim(out, stone, 's')
    if not n:
        # the far parapet: the walk starts below it (sky through the crenels)
        a = np.array(out)
        a[0:16, :, 3] = 0
        out = Image.fromarray(a, 'RGBA')
        merlons(out, stone, 0 if w else 0, C, 0, 34)
    return out


def stone_tower(walk, stone):
    out = blank()
    out.alpha_composite(shade(walk, 0.92))
    for side in 'ews':
        rim(out, stone, side, 16)
    a = np.array(out)
    a[0:16, :, 3] = 0
    out = Image.fromarray(a, 'RGBA')
    merlons(out, stone, 0, C, 0, 34, tooth=24, gap=12)
    # the near parapet's teeth along the front, over the face
    lit = shade(stone, 1.1)
    x = 6
    while x + 24 <= C - 2:
        paste_box(out, lit, (x, C - 22, x + 24, C))
        x += 36
    outline_box(out, (0, 16, C, C), (40, 36, 34, 255), 2)
    return out


# ── Palisades ─────────────────────────────────────────────────────────

def stake_texture(face_sheet, vertical=True):
    """The kit wall's middle cell: logs turned upright for stakes, or a mud wall as it is."""
    m = cell(face_sheet, 1, 1)
    return m.rotate(90, expand=False) if vertical else m


STAKE = 21
TIP = 22           # where the stake tips start in a top cell
COL = (38, 90)     # the run of stakes seen end-on (north–south), across the cell


def stake_mask(x0, x1, y_tip, y1, pointed=True):
    """Alpha of stakes STAKE wide from x0 to x1, their points at y_tip, down to y1."""
    a = np.zeros((C, C), np.uint8)
    x = x0
    i = 0
    while x < x1:
        sx1 = min(x1, x + STAKE)
        jitter = ((i * 37) % 7) - 3
        top = y_tip + jitter
        for yy in range(max(0, top), y1):
            if pointed:
                half = (sx1 - x) / 2.0
                depth = yy - top
                reach = min(half, depth * 0.34)
                cx = (x + sx1) / 2.0
                a[yy, int(round(cx - reach)):int(round(cx + reach))] = 255
            else:
                a[yy, x:sx1] = 255
        x = sx1
        i += 1
    return a


def round_mask(x0, x1, y_top, y1):
    """A mud wall's rounded coping from x0 to x1."""
    a = np.zeros((C, C), np.uint8)
    a[y_top + 8:y1, x0:x1] = 255
    for xx in range(x0, x1):
        for yy in range(y_top, y_top + 8):
            # a rounded lip at each open end; a soft hump along the top
            a[yy, xx] = 255 if yy >= y_top + 4 - 2 * np.sin((xx - x0) / max(1, x1 - x0) * np.pi) else 0
    return a


def apply_alpha(tex, alpha, shadeK=1.0):
    t = shade(tex, shadeK) if shadeK != 1.0 else tex
    a = np.array(t)
    a[..., 3] = np.minimum(a[..., 3], alpha)
    return Image.fromarray(a, 'RGBA')


def edge_dark(img, w=3):
    """Darken the outer edge of what is opaque (each stake's outline)."""
    a = np.array(img).astype(np.int32)
    al = a[..., 3] > 0
    er = np.array(Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(w))) > 0
    rim = al & ~er
    a[rim, :3] = (a[rim, :3] * 0.5).astype(np.int32)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def coping(img, lit=7):
    """A mud wall's rounded top: each column's top few pixels lit, a shadow line under them."""
    a = np.array(img).astype(np.int32)
    H, W = a.shape[0], a.shape[1]
    for x in range(W):
        ys = np.where(a[:, x, 3] > 0)[0]
        if not len(ys):
            continue
        y0 = ys[0]
        if y0 == 0:
            continue   # (a run carried on from the cell above: no top here)
        a[y0:y0 + lit, x, :3] = np.minimum(255, a[y0:y0 + lit, x, :3] * 1.35 + 18)
        a[y0 + lit:y0 + lit + 3, x, :3] = (a[y0 + lit:y0 + lit + 3, x, :3] * 0.62)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def palisade_cells(face_sheet, mud):
    tex = stake_texture(face_sheet, vertical=not mud)
    side = shade(tex, 0.78)          # the stakes seen end-on, in their shade
    caps = []
    for mask in range(16):
        n, e, s, w = bool(mask & 1), bool(mask & 2), bool(mask & 4), bool(mask & 8)
        out = blank()
        alpha = np.zeros((C, C), np.uint8)
        x0 = 0 if w else COL[0]
        x1 = C if e else COL[1]
        if e or w or not (n or s):
            m = round_mask(x0, x1, TIP + 10, C) if mud else stake_mask(x0, x1, TIP, C)
            alpha = np.maximum(alpha, m)
        layer = apply_alpha(tex, alpha)
        out.alpha_composite(layer)
        # north–south: a narrow run seen end-on, from the cell above (n) or its own tip
        if n or s:
            col = np.zeros((C, C), np.uint8)
            top = 0 if n else TIP
            if mud:
                col = round_mask(COL[0], COL[1], top - (0 if n else 0), C) if not n else col
                if n:
                    col[:, COL[0]:COL[1]] = 255
            else:
                col = stake_mask(COL[0], COL[1], top, C) if not n else col
                if n:
                    col[:, COL[0]:COL[1]] = 255
            out.alpha_composite(apply_alpha(side, col))
        caps.append(edge_dark(coping(out) if mud else out))
    faces = []
    for idx in range(4):
        joined_e, joined_w = idx in (1, 3), idx in (2, 3)
        x0 = 0 if joined_w else COL[0] - (0 if idx else 20)
        x1 = C if joined_e else COL[1] + (0 if idx else 20)
        alpha = np.zeros((C, C), np.uint8)
        alpha[:, x0:x1] = 255
        f = apply_alpha(tex, alpha)
        a = np.array(f).astype(np.float32)
        # earth banked at the foot
        for yy in range(C - 22, C):
            a[yy, :, :3] *= 1 - 0.4 * (yy - (C - 22)) / 22
        if not mud:
            # the rope binding the stakes, a hand down from the top
            for yy in range(30, 37):
                a[yy, x0:x1, :3] *= 0.55
            a[30, x0:x1, :3] = np.minimum(255, a[30, x0:x1, :3] * 1.6)
        faces.append(edge_dark(Image.fromarray(a.astype(np.uint8), 'RGBA')))
    return caps, faces


# ── Gates ─────────────────────────────────────────────────────────────

def stone_arches(face_sheet):
    """The face over a gate's way, in row 1 cols 5-8: the arch's left springing,
    its crown, its right springing, and a one-tile arch. The way under it is open
    (transparent): the road shows through; a ring of lit voussoirs round the opening."""
    upper = stone_faces(face_sheet)[0][3]
    out = []
    ys = 62            # the soffit's height in a middle cell (the crown)
    for kind in ('left', 'mid', 'right', 'single'):
        a = np.array(upper).astype(np.int32)
        hole = np.zeros((C, C), bool)
        for x in range(C):
            if kind == 'mid':
                top = ys
            elif kind == 'single':
                u = (x - C / 2) / (C / 2 - 14)
                top = C if abs(u) >= 1 else int(ys + (C - ys) * (1 - np.sqrt(max(0.0, 1 - u * u))))
            else:
                # a quarter ellipse from the springing (at the wall, x 16) up to the crown
                xx = x if kind == 'left' else C - 1 - x
                u = (C - xx) / (C - 16)
                top = C if u >= 1 else int(ys + (C - ys) * (1 - np.sqrt(max(0.0, 1 - u * u))))
            hole[top:, x] = True
        # the voussoir ring: lit stones just outside the hole, a shadow line under them
        for x in range(C):
            col = np.where(hole[:, x])[0]
            if len(col):
                t = col[0]
                a[max(0, t - 10):t, x, :3] = np.minimum(255, a[max(0, t - 10):t, x, :3] * 1.18 + 10)
                a[max(0, t - 2):t, x, :3] = a[max(0, t - 2):t, x, :3] * 0.45
        a[hole, 3] = 0
        out.append(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA'))
    return out


def gate_frames(face_sheet, mud):
    """A palisade's gate: two great posts and a beam across their tops (row 2:
    cols 0-3 the beam's cells — post left, crown, post right, both — cols 4-6
    the posts' feet — left, right, both)."""
    tex = cell(face_sheet, 1, 1)
    post_tex = shade(tex if mud else tex.rotate(90), 0.9)
    beam_tex = shade(cell(load(KIT.format('logs')), 1, 1), 0.85)
    PW = 30

    def post(img, left, top_y):
        x0, x1 = (0, PW) if left else (C - PW, C)
        al = np.zeros((C, C), np.uint8)
        al[top_y:, x0:x1] = 255
        img.alpha_composite(apply_alpha(post_tex, al))
        a = np.array(img).astype(np.int32)
        a[top_y:, x0:x0 + 4, :3] = np.minimum(255, a[top_y:, x0:x0 + 4, :3] * 1.25)
        a[top_y:, x1 - 5:x1, :3] = a[top_y:, x1 - 5:x1, :3] * 0.55
        if top_y > 0:
            a[top_y:top_y + 5, x0:x1, :3] = np.minimum(255, a[top_y:top_y + 5, x0:x1, :3] * 1.3 + 15)
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

    beams = []
    for kind in ('left', 'mid', 'right', 'both'):
        img = blank()
        al = np.zeros((C, C), np.uint8)
        al[30:58, :] = 255
        img.alpha_composite(apply_alpha(beam_tex, al))
        a = np.array(img).astype(np.int32)
        a[30:34, :, :3] = np.minimum(255, a[30:34, :, :3] * 1.3 + 12)
        a[54:58, :, :3] = a[54:58, :, :3] * 0.5
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
        if kind in ('left', 'both'):
            img = post(img, True, 16)
        if kind in ('right', 'both'):
            img = post(img, False, 16)
        beams.append(edge_dark(img))
    feet = []
    for kind in ('left', 'right', 'both'):
        img = blank()
        if kind in ('left', 'both'):
            img = post(img, True, 0)
        if kind in ('right', 'both'):
            img = post(img, False, 0)
        a = np.array(img).astype(np.float32)
        for yy in range(C - 18, C):
            a[yy, :, :3] *= 1 - 0.35 * (yy - (C - 18)) / 18
        feet.append(edge_dark(Image.fromarray(a.astype(np.uint8), 'RGBA')))
    return beams, feet


# ── Spires (assets/buildingKit/town_spires.png) ────────────────────────
# Each style is 2 cells wide and 5 tall: a belfry of the kit's wall with an arched
# opening and the kit's bell emblem in it, a cornice, and over it a spire of the
# kit's roof tiles cut to a point (or, a campanile, a parapet and a low tiled cap).

SPIRES_OUT = 'assets/buildingKit/town_spires.png'
SPIRE_STYLES = [
    ('slate_spire', 'stone_grey', 'roofs_slate', 'spire'),
    ('dark_spire', 'stone_dark', 'roofs_slate_blue', 'spire'),
    ('beige_spire', 'stone_beige', 'roofs_slate', 'spire'),
    ('clay_campanile', 'stone_ochre', 'roofs_clay', 'campanile'),
    ('white_campanile', 'adobe_white', 'roofs_clay_brown', 'campanile'),
    ('timber_spire', 'timber', 'roofs_shingle_dark', 'spire'),
]


def tiled(tex, w, h):
    out = Image.new('RGBA', (w, h))
    for y in range(0, h, tex.size[1]):
        for x in range(0, w, tex.size[0]):
            out.paste(tex, (x, y))
    return out


def spire(wall_key, roof_key, style, bell):
    W, H = 2 * C, 5 * C
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    wall = cell(load(KIT.format(wall_key)), 1, 1)
    roof = cell(load('assets/buildingKit/modern/' + roof_key + '.png'), 1, 1)
    tw = 150
    x0 = (W - tw) // 2
    base = H
    belfry_top = H - 2 * C + 10
    img.paste(shade(tiled(wall, tw, base - belfry_top), 0.95), (x0, belfry_top))
    a = np.array(img).astype(np.int32)
    a[belfry_top:base, x0 + tw - 26:x0 + tw, :3] = a[belfry_top:base, x0 + tw - 26:x0 + tw, :3] * 0.72
    a[belfry_top:base, x0:x0 + 6, :3] = np.minimum(255, a[belfry_top:base, x0:x0 + 6, :3] * 1.15)
    ox0, ox1 = x0 + 40, x0 + tw - 40
    oy0, oy1 = belfry_top + 38, belfry_top + 150
    r = (ox1 - ox0) / 2
    for y in range(oy0, oy1):
        for x in range(ox0, ox1):
            if y < oy0 + r:
                dx = x - (ox0 + r)
                dy = (oy0 + r) - y
                if dx * dx + dy * dy > r * r:
                    continue
            a[y, x, :3] = [28, 24, 30]
            a[y, x, 3] = 255
    a[oy1:oy1 + 6, ox0 - 6:ox1 + 6, :3] = np.minimum(255, a[oy1:oy1 + 6, ox0 - 6:ox1 + 6, :3] * 1.3)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    b = bell.resize((int(r * 1.5), int(r * 1.5)), Image.LANCZOS)
    img.alpha_composite(b, (int(ox0 + r - b.size[0] / 2), int(oy0 + r * 0.55)))
    a = np.array(img).astype(np.int32)
    cx0, cx1 = x0 - 10, x0 + tw + 10
    corn = np.array(shade(tiled(wall, cx1 - cx0, 18), 1.25)).astype(np.int32)
    a[belfry_top - 18:belfry_top, cx0:cx1] = corn
    a[belfry_top - 2:belfry_top, cx0:cx1, :3] = corn[-2:, :, :3] * 0.45
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    top = belfry_top - 18
    if style == 'spire':
        spa = np.array(tiled(roof, W, top)).astype(np.int32)
        al = np.zeros((top, W), np.uint8)
        half = (tw + 30) / 2
        apex = 6
        for y in range(apex, top):
            hw = half * (y - apex) / (top - apex)
            al[y, int(W / 2 - hw):int(W / 2 + hw) + 1] = 255
        spa[..., 3] = al
        spa[:, W // 2:, :3] = spa[:, W // 2:, :3] * 0.7
        img.alpha_composite(edge_dark(Image.fromarray(np.clip(spa, 0, 255).astype(np.uint8), 'RGBA'), 5), (0, 0))
        a = np.array(img).astype(np.int32)
        a[0:8, W // 2 - 3:W // 2 + 3, :3] = [214, 178, 76]
        a[0:8, W // 2 - 3:W // 2 + 3, 3] = 255
        img = Image.fromarray(a.astype(np.uint8), 'RGBA')
    else:
        ph = 70
        al = np.zeros((top, W), np.uint8)
        for y in range(top - ph, top):
            hw = (tw / 2 + 8) * (y - (top - ph)) / ph
            al[y, int(W / 2 - hw):int(W / 2 + hw) + 1] = 255
        cap = np.array(tiled(roof, W, top)).astype(np.int32)
        cap[..., 3] = al
        cap[:, W // 2:, :3] = cap[:, W // 2:, :3] * 0.72
        img.alpha_composite(edge_dark(Image.fromarray(np.clip(cap, 0, 255).astype(np.uint8), 'RGBA'), 5))
        ws = np.array(shade(tiled(wall, tw + 20, 34), 1.1)).astype(np.int32)
        pa = np.zeros_like(ws)
        pa[14:, :] = ws[14:, :]
        for x in range(0, tw + 20, 26):
            pa[0:14, x:x + 16] = ws[0:14, x:x + 16]
        img.alpha_composite(edge_dark(Image.fromarray(np.clip(pa, 0, 255).astype(np.uint8), 'RGBA'), 3), (x0 - 10, top - 34))
    return img


def make_spires():
    emb = load('assets/modern/buildingKit/emblems.png')
    k = emb.size[0] // 160
    bell = emb.crop((128 * k, 0, 160 * k, 32 * k))
    sheet = Image.new('RGBA', (len(SPIRE_STYLES) * 2 * C, 5 * C), (0, 0, 0, 0))
    for i, (key, wall, roof, style) in enumerate(SPIRE_STYLES):
        sheet.alpha_composite(spire(wall, roof, style, bell), (i * 2 * C, 0))
        print(f'spire {key}: col {i * 2}')
    sheet.save(SPIRES_OUT)
    print(f'wrote {SPIRES_OUT} {sheet.size} (hiResSheets width {sheet.size[0] // 4})')


def main():
    data = json.load(open('data/townEras.json', encoding='utf-8'))
    mats = data['art']['materials']
    streets = load(STREETS)
    sheet = Image.new('RGBA', (COLS * C, len(mats) * 3 * C), (0, 0, 0, 0))
    for band, (key, m) in enumerate(mats.items()):
        y0 = band * 3 * C
        face = load(KIT.format(m['face']))
        if m['kind'] == 'stone':
            cx, cy = m['cap']
            walk = shade(streets.crop((cx * 32 * 4, cy * 32 * 4, cx * 32 * 4 + C, cy * 32 * 4 + C)), 0.9)
            stone = cell(face, 1, 1)
            for mask in range(16):
                sheet.alpha_composite(stone_cap(mask, walk, stone), (mask * C, y0))
            sheet.alpha_composite(stone_tower(walk, stone), (16 * C, y0))
            ups, lows = stone_faces(face)
            for i in range(4):
                sheet.alpha_composite(ups[i], (i * C, y0 + C))
                sheet.alpha_composite(lows[i], (i * C, y0 + 2 * C))
            # the gate's arch (row 1, cols 5-8: left, crown, right, single)
            for i, arch in enumerate(stone_arches(face)):
                sheet.alpha_composite(arch, ((5 + i) * C, y0 + C))
        else:
            caps, faces = palisade_cells(face, mud=m['face'] != 'logs')
            for mask in range(16):
                sheet.alpha_composite(caps[mask], (mask * C, y0))
            for i in range(4):
                sheet.alpha_composite(faces[i], (i * C, y0 + C))
            # the gate's frame (row 2: beam cols 0-3 left/crown/right/both, the posts' feet cols 4-6 left/right/both)
            beams, feet = gate_frames(face, mud=m['face'] != 'logs')
            for i, b in enumerate(beams):
                sheet.alpha_composite(b, (i * C, y0 + 2 * C))
            for i, f in enumerate(feet):
                sheet.alpha_composite(f, ((4 + i) * C, y0 + 2 * C))
        print(f'{key}: band {band}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print(f'wrote {OUT} {sheet.size} (hiResSheets width {sheet.size[0] // 4})')
    make_spires()


if __name__ == '__main__':
    main()
