# Build a high-res cliff sheet (assets/lpc/Terrain/cliff_<season>.png) in the
# exact LPC layout (16x14 cells of 32px) at K x the resolution.
#
#   python build_cliff.py <season> <out.png> [K]
#
# Unlike build_sheet.py (which maps whole materials), this keeps EVERY colour
# region of the LPC cliff art as its own shape: each colour's mask is smoothed
# and upscaled and the strongest wins at each output pixel, so the strata
# lines, dark outlines, cave mouths, ladders and cobble rims keep their exact
# structure, only drawn smooth instead of in pixel steps. Then:
#   - the rock colours keep their LPC colour, with the painted rock.png's fine
#     grain laid over them (its high-pass detail, partially);
#   - the grass / dirt / water / snow FILL colours become the painted textures,
#     aligned to the cell exactly as the ground sheet's fills are, so a cliff
#     top blends into the ground round it;
#   - their RIM colours (outlines, tuft shade, shore bands) become the same
#     texture shaded by the LPC colour's brightness (as build_sheet.py does).
# The material of a pixel is read from the SPRING sheet (the seasons share its
# layout); its colour from the season's sheet. Winter: wherever the winter
# sheet has snow, the painted snow.
#
# Mends (cliff_fixes.py, run first on every season alike): the angled front's
# feet joined into one foot with its strata bent round from the straight
# front's, and the sides of a crag's top drawn as its top rim turned on its
# side (the LPC sheet never drew those pieces side by side).
#
# Seams: each cell is smoothed with a margin of the cells cliffs.js lays round
# it (scripts/terrain_modern/cliff_layout.py), so pieces that meet in the game
# are smoothed as one picture and meet exactly.
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cliff_layout import adjacency  # noqa: E402
import cliff_fixes  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SEASON = sys.argv[1]
OUT = sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 4
SIG = 0.75       # mask smoothing, in source pixels (small: thin strata lines survive)
BETA = 40        # edge crispness (softmax sharpness)
PAD = 4          # neighbours' margin, source pixels
GRAIN = 0.55     # how much of the painted rock's grain lies over the LPC rock
TUFT = 0.18      # grass blades poke out a little over what they meet
C = 32
T = C * K


def P(*c):
    return tuple(c)


# Spring keys, by role
GRASS_FILL = {P(92, 154, 42), P(124, 184, 47)}
GRASS_RIM = {P(70, 130, 50), P(37, 86, 46), P(28, 69, 37), P(48, 100, 47)}
DIRT_FILL = {P(162, 121, 75), P(173, 132, 79), P(148, 107, 68)}
DIRT_RIM = {P(117, 80, 45), P(97, 72, 44)}
WATER_FILL = {P(42, 133, 152)}
WATER_RIM = {P(33, 112, 135), P(58, 175, 194), P(108, 220, 231), P(24, 80, 111), P(58, 90, 114)}
ROCK = {P(107, 60, 46), P(96, 52, 41), P(127, 76, 49), P(68, 39, 37), P(46, 31, 28), P(174, 107, 63)}
# Winter colours that are snow (the fill and the snow's own pattern / tufts; and its blue outlines)
SNOW_FILL = {P(224, 242, 243), P(189, 230, 229), P(255, 255, 255)}
SNOW_RIM = {P(79, 143, 186), P(115, 190, 211), P(138, 190, 201), P(60, 94, 139)}

SEASON_BASE = {
    'spring': {'grass': (92, 154, 42), 'water': (42, 133, 152)},
    'summer': {'grass': (70, 130, 50), 'water': (42, 133, 152)},
    'autumn': {'grass': (191, 166, 63), 'water': (79, 137, 157)},
    'winter': {'grass': (224, 242, 243), 'water': (79, 137, 157)},
}[SEASON]
BASE = {'grass': SEASON_BASE['grass'], 'dirt': (173, 132, 79), 'water': SEASON_BASE['water'],
        'snow': (224, 242, 243)}


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def load_tex(name):
    return np.asarray(Image.open(os.path.join(HERE, name)).convert('RGB').resize((T, T), Image.LANCZOS),
                      dtype=np.float32)


def tint(t, frm, to):
    return np.clip(t * (np.array(to, np.float32) / np.array(frm, np.float32)), 0, 255)


tex = {'grass': load_tex('grass.png'), 'dirt': load_tex('dirt.png'), 'water': load_tex('water.png'),
       'snow': load_tex('snow.png')}
# (the same season rules as build_sheet.py, so the ground and the cliffs agree)
if SEASON == 'summer':
    tex['grass'] = tint(tex['grass'], (92, 154, 42), (70, 130, 50))
if SEASON == 'autumn':
    tex['grass'] = load_tex('grass_autumn.png')
if SEASON in ('autumn', 'winter'):
    tex['water'] = tint(tex['water'], (42, 133, 152), (79, 137, 157))
if SEASON == 'winter':
    tex['grass'] = tex['snow']

# The painted rock's fine grain: its luminance over a blurred copy of itself
_rk = load_tex('rock.png').mean(2)
_rk_lo = ndimage.gaussian_filter(_rk, 2.2 * K, mode='wrap')
ROCK_GRAIN = np.clip(1 + GRAIN * (_rk / np.maximum(_rk_lo, 1) - 1), 0.6, 1.4).astype(np.float32)


def main():
    spr = np.asarray(Image.open(os.path.join(HERE, 'lpc_cliff_spring.png')).convert('RGBA'))
    sea = np.asarray(Image.open(os.path.join(HERE, f'lpc_cliff_{SEASON}.png')).convert('RGBA'))
    # Mend the pieces the LPC sheet never drew side by side (cliff_fixes.py)
    mend, shear = cliff_fixes.remap(spr, K)
    spr, sea = cliff_fixes.apply(spr, mend), cliff_fixes.apply(sea, mend)
    H, W = spr.shape[:2]

    # Classes: one per (material, colour), with the fills merged per material.
    # Each class: (kind, colour-or-material, shade, alpha)
    classes = {}
    lab = np.full((H, W), -1, np.int32)

    def cls(key):
        if key not in classes:
            classes[key] = len(classes)
        return classes[key]

    for y in range(H):
        for x in range(W):
            a = int(sea[y, x, 3]) if sea[y, x, 3] else int(spr[y, x, 3])
            if a == 0:
                continue
            k = tuple(int(v) for v in spr[y, x, :3])
            s = tuple(int(v) for v in sea[y, x, :3]) if sea[y, x, 3] else k
            if a < 255:                                  # the translucent shadow
                key = ('flat', s, 1.0, a)
            elif SEASON == 'winter' and s in SNOW_FILL:
                key = ('tex', 'snow', 1.0, 255)
            elif SEASON == 'winter' and s in SNOW_RIM:
                # (the snow's icy blue edge: tinted channel by channel, not just darkened)
                key = ('tex', 'snow', tuple(round(s[i] / BASE['snow'][i], 3) for i in range(3)), 255)
            elif k in GRASS_FILL:
                key = ('tex', 'grass', 1.0, 255)
            elif k in GRASS_RIM:
                key = ('tex', 'grass', round(lum(s) / lum(BASE['grass']), 3), 255)
            elif k in DIRT_FILL and s in DIRT_FILL:
                key = ('tex', 'dirt', 1.0, 255)
            elif k in DIRT_RIM and s == k:
                key = ('tex', 'dirt', round(lum(s) / lum(BASE['dirt']), 3), 255)
            elif k in WATER_FILL:
                key = ('tex', 'water', 1.0, 255)
            elif k in WATER_RIM:
                key = ('tex', 'water', round(lum(s) / lum(BASE['water']), 3), 255)
            elif k in ROCK:
                key = ('rock', s, 1.0, 255)
            else:                                        # vines, ladders, odd pixels: as drawn
                key = ('flat', s, 1.0, 255)
            lab[y, x] = cls(key)

    cells = [(cy, cx) for cy in range(H // C) for cx in range(W // C)
             if (lab[cy*C:(cy+1)*C, cx*C:(cx+1)*C] >= 0).any()]

    # Each cell is smoothed together with a margin of its in-game neighbours
    # (the most common one each side and corner, as cliffs.js lays them; open
    # grass where nothing is), so pieces that meet are smoothed as one picture.
    # A cell cliffs.js never lays keeps its neighbours on the sheet.
    open_cls = cls(('tex', 'snow' if SEASON == 'winter' else 'grass', 1.0, 255))
    keys = sorted(classes, key=classes.get)
    NC = len(keys)
    print(SEASON, 'classes', NC)
    adj = adjacency()
    lab_pad = np.pad(lab, PAD, mode='edge')

    def cell_lab(c, r):
        return lab[r*C:(r+1)*C, c*C:(c+1)*C]

    def padded(cy, cx):
        if (cx, cy) not in adj:
            return lab_pad[cy*C:(cy+1)*C + 2*PAD, cx*C:(cx+1)*C + 2*PAD].copy()
        a = adj[(cx, cy)]
        P2 = np.full((C + 2*PAD, C + 2*PAD), open_cls, np.int32)
        P2[PAD:PAD+C, PAD:PAD+C] = cell_lab(cx, cy)
        for (dq, dr), ns in a.items():
            n = max(ns, key=ns.get)
            src_ = np.full((C, C), open_cls, np.int32) if n is None else cell_lab(*n)
            src_ = np.where(src_ >= 0, src_, -1)
            ys = slice(PAD + C, PAD*2 + C) if dr > 0 else slice(0, PAD) if dr < 0 else slice(PAD, PAD + C)
            xs = slice(PAD + C, PAD*2 + C) if dq > 0 else slice(0, PAD) if dq < 0 else slice(PAD, PAD + C)
            sy = slice(0, PAD) if dr > 0 else slice(C - PAD, C) if dr < 0 else slice(0, C)
            sx = slice(0, PAD) if dq > 0 else slice(C - PAD, C) if dq < 0 else slice(0, C)
            P2[ys, xs] = src_[sy, sx]
        return P2

    def up(c):
        # smooth, then a cubic upscale: round shapes, no pixel steps
        g = ndimage.gaussian_filter(c, SIG, mode='nearest')
        return ndimage.zoom(g, K, order=3, grid_mode=True, mode='nearest')[PAD*K:-PAD*K, PAD*K:-PAD*K]

    def colour_of(key):
        kind, what, shade, a = key
        if kind == 'tex':
            return tex[what] * np.array(shade, np.float32)
        c = np.broadcast_to(np.array(what, np.float32), (T, T, 3))
        if kind == 'rock':
            return c * ROCK_GRAIN[..., None]
        return c

    colours = [colour_of(k) for k in keys]
    alphas = [k[3] / 255.0 for k in keys]
    grass_cls = {i for i, k in enumerate(keys) if k[0] == 'tex' and k[1] == ('snow' if SEASON == 'winter' else 'grass')}
    gl = tex['grass'].mean(2)
    blade = (gl - gl.mean()) / (gl.std() + 1e-6)

    out = np.zeros((H * K, W * K, 4), np.float32)
    for (cy, cx) in cells:
        m = padded(cy, cx)
        present = sorted(int(v) for v in np.unique(m) if v >= 0)
        st = np.stack([up((m == i).astype(np.float32)) for i in present] + [up((m < 0).astype(np.float32))])
        # grass: its light blades lift its claim a little (soft, blade-shaped edges)
        gs = [j for j, i in enumerate(present) if i in grass_cls]
        if gs:
            gsum = st[gs].sum(0)
            lift = TUFT * np.clip((gsum - 0.2) / 0.3, 0, 1) * np.clip(1 - (gsum - 0.6) / 0.3, 0, 1) * blade
            for j in gs:
                st[j] = st[j] + lift * (st[j] / np.maximum(gsum, 1e-6))
        e = np.exp((st - st.max(0, keepdims=True)) * BETA)
        wts = e / e.sum(0, keepdims=True)
        rgb = np.zeros((T, T, 3), np.float32)
        a = np.zeros((T, T), np.float32)
        for j, i in enumerate(present):
            wa = wts[j] * alphas[i]
            col = colours[i]
            if keys[i][0] == 'rock' and (cx, cy) in shear:
                # (the angled front's sides: the grain's ledges run along its bent strata)
                yy = (np.arange(T)[:, None] - np.round(shear[(cx, cy)])[None, :].astype(int)) % T
                col = np.array(keys[i][1], np.float32) * ROCK_GRAIN[yy, np.arange(T)[None, :]][..., None]
            rgb += wa[..., None] * col
            a += wa
        rgb = rgb / np.maximum(a, 1e-6)[..., None]
        out[cy*T:(cy+1)*T, cx*T:(cx+1)*T, :3] = rgb
        out[cy*T:(cy+1)*T, cx*T:(cx+1)*T, 3] = a * 255
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT)
    print('wrote', OUT, out.shape)


main()
