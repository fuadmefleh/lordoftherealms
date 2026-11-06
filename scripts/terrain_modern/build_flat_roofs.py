# Paint the flat-roof kits (data/buildingKit.json roofs of kind 'parapet') in the
# painted style of the modern terrain, at 4x (128px a cell).
#
#   python -I build_flat_roofs.py [key ...]        (all four if none)
#
# A parapet roof is a 3x2 block of cells: the left, middle and right columns, the
# far (top) row and the near (bottom) row that sits on the wall. The middle column
# repeats across a wide building, so everything in it depends on x only through
# the 128px cell grid. The roof is drawn as a real flat roof seen from the south:
#   - a parapet all round: a coping (its stones jointed, lit on the outer edge, a
#     dark line where it drops inside), the inner face of the far parapet showing
#     as a darker band, the near coping lipped over the wall below;
#   - a deck inside it in the culture's surface (stone slabs, fired tiles, packed
#     clay), its joints bevelled, each slab a touch lighter or darker than the next;
#   - the parapet's shade across the deck under the far wall and down the west side;
#   - things on the deck, in the end columns only (each appears once a building):
#     a roof hatch at the west end, a vent or a water jar at the east, and drain
#     spouts through the near parapet;
#   - the outer left and right edges outlined and shaded like every other kit, so
#     two flat-roofed houses side by side stay two houses.
# Writes assets/buildingKit/modern/roofs_<key>.png.
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'buildingKit', 'modern')
T = 128
W, H = 3 * T, 2 * T

# Parapet bands (4x px): side copings, the far coping, the far parapet's inner face, the near coping
SIDE = 26
TOP = 22
FACE = 14
BOT = 28

KITS = {
    # whitewashed parapet, pale limestone slabs (Desert)
    'flat_white': dict(parapet=(238, 235, 226), coping_tex='plaster', coping_joint=0,
                       deck=(214, 205, 188), deck_tex='plaster', slab=(64, 64), bond=False,
                       hatch=(120, 86, 58), east='dome', trim=None),
    # stucco parapet with a dark wooden trim line, packed clay deck (Desert)
    'adobe_stucco': dict(parapet=(226, 212, 182), coping_tex='plaster', coping_joint=0,
                         deck=(198, 170, 128), deck_tex='clay', slab=None, cracks=True,
                         hatch=(112, 78, 50), east='jar', trim=(122, 78, 48)),
    # pale mud-brick parapet, fired tile deck (Desert)
    'adobe_brick': dict(parapet=(212, 196, 168), coping_tex='mudbrick', coping_joint=0,
                        deck=(192, 140, 100), deck_tex='plaster', slab=(32, 32), bond=False,
                        hatch=(108, 76, 50), east='vent', trim=None),
    # mauve-tan mud-brick parapet, packed earth deck laid in big rough slabs (Nomadic)
    'adobe_brick_tan': dict(parapet=(168, 142, 136), coping_tex='mudbrick', coping_joint=0,
                            deck=(176, 150, 118), deck_tex='plaster', slab=(64, 42), bond=True,
                            hatch=(100, 70, 46), east='jar', trim=None),
}

TEX = {'plaster': 'plaster_tile.png', 'mudbrick': 'mudbrick_tile.png', 'clay': 'plaster_tile.png',
       'crazy': 'crazy_tile.png', 'planks': 'planks_tile.png'}


def load_tex(name, reps=1):
    """A seamless 627px texture scaled to repeat `reps` times across one 128px cell."""
    im = Image.open(os.path.join(HERE, TEX[name])).convert('RGB')
    s = T // reps
    w = im.size[0]
    big = Image.new('RGB', (w * 3, w * 3))
    for yy in range(3):
        for xx in range(3):
            big.paste(im, (xx * w, yy * w))
    t = np.asarray(big.resize((s * 3, s * 3), Image.LANCZOS), np.float32)[s:2 * s, s:2 * s]
    return np.tile(t, (reps, reps, 1))


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def tint(tex, target, contrast=1.0, keep=0.35):
    """The texture in the target colour (its luminance carries the colour, some grain kept)."""
    tmean = tex.reshape(-1, 3).mean(0)
    rel0 = (lum(tex) / max(lum(tmean), 1))[..., None]
    chroma = tex - tmean * rel0
    return np.clip(np.asarray(target, np.float32) * rel0 ** contrast + keep * chroma, 0, 255)


def tile_to(t, h, w):
    reps = (h // t.shape[0] + 1, w // t.shape[1] + 1) + (1,) * (t.ndim - 2)
    return np.tile(t, reps)[:h, :w]


def periodic_noise(h, w, period, sig, seed):
    """Smooth noise that repeats every `period` px across (so the middle column tiles)."""
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((h, period)).astype(np.float32)
    n = ndimage.gaussian_filter(n, sig, mode='wrap')
    n /= max(n.std(), 1e-6)
    return tile_to(n, h, w)


def slab_field(h, w, sw, sh, bond, seed):
    """(joint darkness, bevel light, per-slab shade) for a deck laid in sw x sh slabs."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    row = np.floor(yy / sh)
    off = (row % 2) * (sw / 2) if bond else 0
    lx = (xx + off) % sw
    ly = yy % sh
    dist = np.minimum(np.minimum(lx, sw - lx), np.minimum(ly, sh - ly))
    joint = np.exp(-(dist / 1.3) ** 2)
    # light on the slab's upper-left lip, shade on its lower-right
    bevel = 0.10 * np.exp(-((lx - 2.2) / 1.6) ** 2) + 0.08 * np.exp(-((ly - 2.2) / 1.6) ** 2) \
        - 0.10 * np.exp(-((sw - lx - 2.2) / 1.6) ** 2) - 0.10 * np.exp(-((sh - ly - 2.2) / 1.6) ** 2)
    rng = np.random.default_rng(seed)
    per_row = int(T // sw)
    rows = int(np.ceil(h / sh)) + 1
    shade = rng.uniform(-0.05, 0.05, (rows, max(per_row, 1) + 1)).astype(np.float32)
    col = (np.floor((xx + off) / sw) % max(per_row, 1)).astype(int)
    s = shade[row.astype(int), col]
    return joint, bevel, s


def crack_field(h, w, seed):
    """Fine dark hairline cracks in packed clay, from the crazy-paving joints, faint."""
    t = lum(load_tex('crazy', 1))
    t = (t - t.mean()) / t.std()
    lines = np.clip(-t - 1.2, 0, None)
    lines = ndimage.gaussian_filter(lines, 0.6, mode='wrap')
    return tile_to(lines / max(lines.max(), 1e-6), h, w)


def box(img, x0, y0, x1, y1, col, alpha=1.0):
    """Fill a rectangle with a colour (with some grain kept underneath)."""
    sub = img[y0:y1, x0:x1]
    g = lum(sub)[..., None] / max(lum(sub).mean(), 1)
    sub[:] = sub * (1 - alpha) + np.asarray(col, np.float32) * g ** 0.4 * alpha


def soft_shadow(img, mask, dx, dy, strength, sig):
    """A soft shadow cast by `mask` offset by (dx, dy)."""
    m = np.roll(np.roll(mask.astype(np.float32), dy, 0), dx, 1)
    m = ndimage.gaussian_filter(m, sig)
    m = np.clip(m - mask, 0, 1)
    img *= (1 - strength * m)[..., None]


def build(key, k):
    rng_seed = sum(map(ord, key))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # ── the deck ──
    if k['deck_tex'] == 'clay':
        deck = tint(load_tex('clay', 2), k['deck'], contrast=1.6)
    else:
        deck = tint(load_tex(k['deck_tex'], 2), k['deck'], contrast=1.4)
    deck = tile_to(deck, H, W)
    mott = periodic_noise(H, W, T, 9, rng_seed)
    deck *= (1 + 0.035 * mott)[..., None]
    if k.get('slab'):
        sw, sh = k['slab']
        joint, bevel, shade = slab_field(H, W, sw, sh, k.get('bond', False), rng_seed)
        deck *= (1 + shade + bevel)[..., None]
        deck *= (1 - 0.38 * joint)[..., None]
    if k.get('cracks'):
        deck *= (1 - 0.22 * crack_field(H, W, rng_seed))[..., None]
    img = deck.copy()

    # ── parapet: the copings ──
    par = np.asarray(k['parapet'], np.float32)
    if k['coping_tex'] == 'mudbrick':
        cop_h = tint(load_tex('mudbrick', 2), par, contrast=1.0)                       # along the top and bottom
        cop_v = np.rot90(tint(load_tex('mudbrick', 2), par, contrast=1.0)).copy()       # down the sides
    else:
        cop_h = tint(load_tex('plaster', 2), par, contrast=1.3)
        cop_v = cop_h
    cop_h = tile_to(cop_h, H, W)
    cop_v = tile_to(cop_v, H, W)

    left = xx < SIDE
    right = xx >= W - SIDE
    top = yy < TOP
    face = (yy >= TOP) & (yy < TOP + FACE) & ~left & ~right
    bot = yy >= H - BOT
    sides = (left | right) & ~top & ~bot
    img[top | bot] = cop_h[top | bot]
    img[sides] = cop_v[sides]

    # rounded coping: lit along its outer half, a dark line where it drops to the deck
    def ramp(d, w):
        return np.clip(d / w, 0, 1)
    # far coping: light at the outside (top), shading toward the inside
    img[top] *= (1.08 - 0.16 * ramp(yy, TOP))[top][..., None]
    # near coping: its top face, lit, a dark lip at the deck edge and a drip line at the bottom
    dn = yy - (H - BOT)
    img[bot] *= (1.05 - 0.04 * ramp(dn, BOT))[bot][..., None]
    lip = bot & (dn < 3)
    img[lip] *= 0.72
    drip = yy >= H - 3
    img[drip] *= 0.62
    # side copings: lit on the outside edge, darker inside
    dl = np.where(left, xx, np.where(right, W - 1 - xx, 99))
    img[sides] *= (1.06 - 0.12 * ramp(dl, SIDE))[sides][..., None]
    inner_side = sides & (dl >= SIDE - 3)
    img[inner_side] *= 0.74
    inner_top = top & (yy >= TOP - 2) & ~left & ~right
    img[inner_top] *= 0.8

    # far parapet's inner face: a vertical face in shadow, darker toward the deck
    fc = tile_to(tint(load_tex(k['coping_tex'] if k['coping_tex'] != 'clay' else 'plaster', 2), par * 0.74, contrast=1.1), H, W)
    img[face] = fc[face] * (1.0 - 0.18 * ramp(yy - TOP, FACE))[face][..., None]
    # the side parapets' inner faces run down beside the far face (the corners)
    corner = (yy >= TOP) & (yy < TOP + FACE) & (left | right)
    img[corner] = cop_v[corner] * 0.86

    # coping joints for a stone/plaster parapet (every half cell, so the middle tiles)
    if k['coping_joint']:
        j = k['coping_joint']
        jx = (xx % j) < 2
        img[(top | bot) & jx & ~left & ~right] *= 0.75

    # a wooden trim line inside the coping (stucco roofs)
    if k.get('trim') is not None:
        tr = np.asarray(k['trim'], np.float32)
        band = ((yy >= TOP - 6) & (yy < TOP - 3) & ~left & ~right) | \
               ((dl >= SIDE - 7) & (dl < SIDE - 4) & ~top & ~bot) | \
               (bot & (dn >= 5) & (dn < 8) & (dl >= SIDE - 4))
        img[band] = tr * (lum(img[band]) / max(lum(par), 1))[..., None] ** 0.3

    # ── shade on the deck: under the far parapet and down the west side ──
    deck_m = ~(top | face | bot | left | right)
    dy = yy - (TOP + FACE)
    dxl = xx - SIDE
    sh = 0.30 * np.exp(-np.maximum(dy, 0) / 9.0)
    sh += 0.18 * np.exp(-np.maximum(dxl, 0) / 7.0)
    sh += 0.08 * np.exp(-np.maximum(W - SIDE - xx, 0) / 5.0)   # a hint on the east side too
    img[deck_m] *= (1 - np.clip(sh, 0, 0.45))[deck_m][..., None]

    # ── things on the deck (end columns only) ──
    rng = np.random.default_rng(rng_seed)
    # a roof hatch at the west end: planked trapdoor in a frame, a shadow to the south-east
    hx0, hy0 = 50, 64
    hx1, hy1 = hx0 + 40, hy0 + 34
    hm = np.zeros((H, W), bool)
    hm[hy0:hy1, hx0:hx1] = True
    soft_shadow(img, hm, 3, 4, 0.45, 1.6)
    planks = tile_to(tint(np.rot90(load_tex('planks', 2)).copy(), k['hatch'], contrast=1.2), H, W)
    img[hm] = planks[hm]
    fr = hm & ~((yy >= hy0 + 3) & (yy < hy1 - 3) & (xx >= hx0 + 3) & (xx < hx1 - 3))
    img[fr] *= 0.62
    img[hm & (yy >= hy0 + 3) & (yy < hy0 + 5) & (xx >= hx0 + 3) & (xx < hx1 - 3)] *= 1.18
    # an iron ring on the hatch
    ring = ((xx - (hx0 + 20)) ** 2 + (yy - (hy0 + 22)) ** 2)
    img[(ring >= 9) & (ring <= 18)] = (52, 48, 44)

    # east end: a vent, a little dome, or a water jar, on the near row
    ex, ey = W - 72, H - BOT - 52
    if k['east'] == 'vent':
        vm = np.zeros((H, W), bool)
        vm[ey:ey + 26, ex:ex + 26] = True
        soft_shadow(img, vm, 3, 4, 0.5, 1.6)
        img[vm] = tile_to(tint(load_tex('mudbrick', 4), np.asarray(k['parapet']) * 0.92), H, W)[vm]
        img[vm & (yy < ey + 4)] *= 1.15
        hole = (yy >= ey + 7) & (yy < ey + 19) & (xx >= ex + 7) & (xx < ex + 19)
        img[hole] = (46, 38, 34)
        img[vm & ~hole & ((xx >= ex + 22) | (yy >= ey + 22))] *= 0.8
    elif k['east'] == 'dome':
        cx, cy, r = ex + 13, ey + 14, 14
        d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / r ** 2
        dm = d2 <= 1
        soft_shadow(img, dm, 3, 4, 0.5, 1.8)
        # lit from the upper left
        shade = 1.12 - 0.35 * np.clip(((xx - cx) + (yy - cy)) / (2 * r) + 0.5, 0, 1)
        img[dm] = (np.asarray(k['parapet'], np.float32) * shade[..., None])[dm]
        img[dm & (d2 > 0.82)] *= 0.86
        vent = (np.abs(xx - cx) < 5) & (yy >= cy + 4) & (yy < cy + 8)
        img[vent & dm] = (60, 52, 46)
    else:   # jar: a big clay water jar, round, with a dark mouth
        cx, cy, r = ex + 13, ey + 14, 13
        d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / r ** 2
        dm = d2 <= 1
        soft_shadow(img, dm, 3, 4, 0.5, 1.8)
        clay = np.asarray((176, 104, 66), np.float32)
        shade = 1.15 - 0.4 * np.clip(((xx - cx) + (yy - cy)) / (2 * r) + 0.5, 0, 1)
        img[dm] = (clay * shade[..., None])[dm]
        m2 = ((xx - cx) ** 2 + (yy - cy) ** 2) <= 5.5 ** 2
        img[m2] = (70, 44, 30)
        rim = (((xx - cx) ** 2 + (yy - cy) ** 2) > 5.5 ** 2) & (((xx - cx) ** 2 + (yy - cy) ** 2) <= 8 ** 2)
        img[rim] = (clay * 1.12)
    # drain spouts through the near parapet, one at each end
    for sx in (60, W - 60):
        slot = (xx >= sx - 6) & (xx < sx + 6) & (yy >= H - BOT) & (yy < H - BOT + 10)
        img[slot] = (64, 54, 46)
        spout = (xx >= sx - 4) & (xx < sx + 4) & (yy >= H - BOT + 10) & (yy < H - 2)
        img[spout] = (np.asarray((120, 82, 54), np.float32) * (1.1 - 0.25 * ((xx - sx + 4) / 8))[..., None])[spout]
        # a stain on the coping below the spout's mouth
        stain = (np.abs(xx - sx) < 7) & (yy >= H - 10) & (yy < H - 3)
        img[stain] *= 0.86

    # ── the outer outline: dark line round the outside, a soft shade in from the left and right ──
    d_side = np.minimum(xx + 0.5, W - xx - 0.5)
    ol = np.clip(4.0 - d_side + 0.5, 0, 1)
    fac = (1 - 0.45 * ol) * (1 - 0.16 * np.exp(-d_side / 12.0))
    fac = np.where(d_side < T, fac, 1.0)
    img *= fac[..., None]
    ot = np.clip(3.0 - (yy + 0.5) + 0.5, 0, 1)
    img *= (1 - 0.4 * ot)[..., None]

    out = np.dstack([np.clip(img + 0.5, 0, 255), np.full((H, W), 255, np.float32)]).astype(np.uint8)
    os.makedirs(OUT_DIR, exist_ok=True)
    fn = os.path.join(OUT_DIR, f'roofs_{key}.png')
    Image.fromarray(out, 'RGBA').save(fn)
    print('roofs/' + key)
    return fn


def main():
    want = set(sys.argv[1:])
    for key, k in KITS.items():
        if not want or key in want:
            build(key, k)


if __name__ == '__main__':
    main()
