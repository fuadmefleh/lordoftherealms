# Repaint the town's building kits (data/buildingKit.json walls and roofs) in the
# painted style of the modern terrain, at 4x (128px a cell).
#
#   python -I build_kits.py [key | walls/key | roofs/key ...]     (all kits if none)
#
# Each kit is a 3x3 block of 32px cells (a parapet roof: 3x2) with a frame on its
# outer cells and a body. The sources are the pixel-art kits as they were drawn,
# listed in kit_sources.json. The new sheet keeps the 3x3 structure:
#   - body: the kit's painted material, one seamless 128px tile per cell, aligned to
#     the cell grid so every cell continues into its neighbour, tinted (by
#     luminance) to the old body's colour;
#   - frame: bands along the outside as wide as the old frame (frame()), painted
#     with a material's texture coloured by the old frame's profile - its colour at
#     each depth in from the edge (mouldings, outlines, light and shadow lines) -
#     the texture turned along a beam or an eave where it has a grain;
#   - features (a vent, the beams of timber framing): their own colours, smoothed,
#     with the grain of a material on top;
#   - outlines: every region blurred, the strongest wins (crisp anti-aliased
#     edges), and near each cell border the shapes come from that border's own
#     pixels, so cells that met before meet exactly now.
# Writes assets/buildingKit/modern/<walls|roofs>_<key>.png.
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'buildingKit', 'modern')
K = 4
C = 32
T = C * K

# Material textures: the 627px seamless tiles from ChatGPT (tile627.py), scaled to
# `n` repeats across one 128px cell.
TEX = {
    'brick':      ('brick_tile.png', 1),
    'ashlar':     ('ashlar_tile.png', 1),
    'fieldstone': ('fieldstone_tile.png', 1),
    'planks':     ('planks_tile.png', 1),
    'plaster':    ('plaster_tile.png', 1),
    'siding':     ('siding_tile.png', 1),
    'mudbrick':   ('mudbrick_tile.png', 1),
    'thatch':     ('thatch_tile.png', 1),
    'slate':      ('slate_tile.png', 1),
    'clay':       ('clay_tile.png', 1),
    'shingle':    ('shingle_tile.png', 1),
    'turf':       ('turf_tile.png', 1),
    'logs':       ('logs_tile.png', 1),      # make_poor_walls.py
    'daub':       ('daub_tile.png', 1),      # make_poor_walls.py
    'mudrough':   ('mudrough_tile.png', 1),  # make_poor_walls.py
}


def material(tab, key):
    """(body material, frame/feature material, body mode) for a kit."""
    if tab == 'walls':
        if key.startswith('brick'): return 'brick', 'brick', 'ref'
        if key.startswith('stone_'): return 'ashlar', 'ashlar', 'ref'
        if key == 'fieldstone': return 'fieldstone', 'ashlar', 'ref'
        if key == 'planks': return 'planks', 'planks', 'ref'
        if key == 'logs': return 'logs', 'planks', 'ref'          # rough logs (make_poor_walls.py)
        if key == 'wattle': return 'daub', 'planks', 'ref'        # wattle-and-daub between rough posts
        if key == 'mudbrick': return 'mudrough', 'plaster', 'ref'  # rough sun-dried brick, half rendered
        if key.startswith('siding'): return 'siding', 'planks', 'ref'
        if key.startswith('timber'): return 'plaster', 'planks', 'light'
        if key.startswith('adobe_brick'): return 'mudbrick', 'plaster', 'ref'
        if key.startswith('adobe'): return 'plaster', 'plaster', 'ref'
        return 'plaster', 'ashlar', 'ref'           # plaster*, whitewash: stone quoins
    if key.startswith('shingle'): return 'shingle', 'shingle', 'ref'
    if key.startswith('thatch'): return 'thatch', 'thatch', 'ref'
    if key.startswith('clay'): return 'clay', 'clay', 'ref'
    if key.startswith('slate'): return 'slate', 'slate', 'ref'
    if key == 'turf': return 'turf', 'turf', 'ref'
    if key.startswith('adobe_brick'): return 'plaster', 'mudbrick', 'ref'   # flat roofs: a parapet
    return 'plaster', 'plaster', 'ref'


def frame(tab, key):
    """The kit's frame as drawn: (top, bottom, left, right) band widths in source px."""
    if tab == 'walls':
        # (brick and stone kits were drawn with no side trim: their corners get a pilaster
        # of the same material, a shade darker - SIDE_SHADE - so the wall ends square)
        if key.startswith('brick'): return (9, 7, 4, 4)
        if key.startswith('stone_'): return (12, 10, 4, 4)
        if key.startswith('siding'): return (2, 3, 6, 6)
        if key.startswith('adobe_brick') or key == 'mudbrick': return (0, 2, 2, 2)
        if key.startswith('adobe'): return (0, 3, 2, 2)
        if key.startswith('timber'): return (0, 0, 0, 0)
        if key in ('planks', 'logs'): return (10, 10, 8, 8)
        return (10, 11, 8, 8)          # plaster*, whitewash, fieldstone
    if key.startswith('adobe_brick'): return (13, 11, 9, 8)    # parapets (3x2)
    if key in ('adobe_stucco', 'flat_white'): return (15, 8, 8, 8)
    if key.startswith('shingle'): return (3, 4, 3, 3)
    if key.startswith('clay'): return (8, 10, 8, 8)
    return (8, 9, 8, 8)                # thatch, slate, turf


# Kits whose side bands are added (not drawn in the old kit): the bands' colour scaled by this
SIDE_SHADE = {'brick': 0.82, 'stone_': 0.86}

# Every kit's outer left and right edges: a dark outline (OUTLINE of the colour kept,
# about one source pixel wide) and a soft shade running in from it (EDGE_SHADE at the
# edge, fading over EDGE_RUN source px), so a building reads as a block against the
# street or grass beside it and two houses side by side stay two houses
OUTLINE = 0.55
EDGE_SHADE = 0.16
EDGE_RUN = 3.0

# Which band sides take the frame texture turned a quarter (planks along a beam,
# straws and tile courses across a side eave)
TURN = {'planks': 'tb', 'thatch': 'lr', 'clay': 'lr', 'slate': 'lr', 'shingle': 'lr', 'turf': 'lr'}

_tex_cache = {}


def load_tex(name):
    if name not in _tex_cache:
        f, n = TEX[name]
        im = Image.open(os.path.join(HERE, f)).convert('RGB')
        # (downscale wrapping round: a 3x3 repeat, the middle cut out)
        s = T // n
        W = im.size[0]
        big = Image.new('RGB', (W * 3, W * 3))
        for yy in range(3):
            for xx in range(3):
                big.paste(im, (xx * W, yy * W))
        t = np.asarray(big.resize((s * 3, s * 3), Image.LANCZOS), np.float32)[s:2 * s, s:2 * s]
        _tex_cache[name] = np.tile(t, (n, n, 1))
    return _tex_cache[name]


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def rel_lum(t):
    L = lum(t)
    return L / max(L.mean(), 1)


# Body texture contrast (luminance relative to its mean raised to this power)
CONTRAST = {'ashlar': 1.7, 'brick': 1.15, 'fieldstone': 1.1}


def tint(tex, target, keep=0.5, contrast=1.0):
    """The texture in another colour: its luminance carries the target colour, a little
    of its own colour variation kept on top."""
    tmean = tex.reshape(-1, 3).mean(0)
    rel0 = rel_lum(tex)[..., None]
    chroma = tex - tmean * rel0
    rel = rel0 ** contrast
    return np.clip(target * rel + keep * chroma * (lum(target) / max(lum(tmean), 1)), 0, 255)


def tile_to(t, H, W):
    reps = (H // t.shape[0] + 1, W // t.shape[1] + 1) + (1,) * (t.ndim - 2)
    return np.tile(t, reps)[:H, :W]


def kit_source(v):
    im = np.asarray(Image.open(os.path.join(ROOT, v['sheet'])).convert('RGBA')).astype(np.int32)
    x0 = v.get('x', 0) * C + v.get('dx', 0)
    if v.get('kind') == 'parapet':
        rows = [im[ry:ry + C, x0:x0 + 3 * C] for ry in v['rowsY']]
        return np.concatenate(rows, 0)
    y0 = v.get('y', 0) * C
    return im[y0:y0 + 3 * C, x0:x0 + 3 * C]


def body_mask(src, mode, bands):
    H, W = src.shape[:2]
    a = src[..., 3] > 0
    if mode == 'ref':
        # The body: inside the frame's bands; in a few-colour pixel-art kit not any
        # pixel whose colour the middle cell never uses (a vent)
        t, b, l, r = bands
        band = np.zeros((H, W), bool)
        band[:t] = True
        band[H - b:] = True
        band[:, :l] = True
        band[:, W - r:] = True
        foreign = np.zeros((H, W), bool)
        if H >= 3 * C and len(np.unique(src[a][:, :3], axis=0)) <= 64:
            pal = {tuple(c) for c in src[C:2 * C, C:2 * C].reshape(-1, 4)[:, :3]}
            foreign = np.array([[tuple(src[y, x, :3]) not in pal for x in range(W)] for y in range(H)])
            foreign = ndimage.binary_opening(foreign, np.ones((2, 2)))   # (a feature, not a stray pixel)
        return a & ~foreign & ~band
    if mode == 'light':
        # timber framing: the infill is the light panels, the beams the dark wood
        # (the panels' ragged plaster edges and the beams' thin highlights cleaned away:
        # clean panels between clean beams)
        L = ndimage.gaussian_filter(lum(src[..., :3].astype(np.float32)), 0.7, mode='nearest')
        m = ndimage.binary_opening(L > 140, np.ones((3, 3)))
        m = ndimage.binary_closing(m, np.ones((3, 3)))
        lab, n = ndimage.label(m)
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz >= 40])   # (panels, not a highlight line)
        return a & m
    # a flat roof: the commonest colour (and its near shades)
    cols, counts = np.unique(src[a][:, :3], axis=0, return_counts=True)
    m = cols[np.argmax(counts)]
    return a & (np.abs(src[..., :3] - m).sum(-1) <= 18)


SIG = 0.75      # shape smoothing, in source pixels
BETA = 40.0     # outline crispness
R = 3.0         # border band (source px) whose shapes come from the border's own pixels
P = 3


def up(c, sig):
    return ndimage.zoom(ndimage.gaussian_filter(np.pad(c, P, mode='edge'), sig), K, order=1)[P * K:-P * K, P * K:-P * K]


def norm_conv(rgb, mask, sig):
    """Colours smoothed within a mask (normalized convolution), upscaled K times."""
    m = mask.astype(np.float32)
    num = np.stack([up(rgb[..., c] * m, sig) for c in range(3)], -1)
    return num / np.maximum(up(m, sig), 1e-4)[..., None]


def band_field(tab, f, alpha, bands, target, g_rel, turn, side_mul=1.0):
    """The frame's colour at 4x: each side's profile over the frame texture."""
    H, W = f.shape[:2]
    HK, WK = H * K, W * K
    out = np.zeros((HK, WK, 3), np.float32)
    if not any(bands):
        return out
    width = dict(zip('TBLR', bands))
    rows = slice(C, 2 * C) if H >= 3 * C else slice(0, H)

    def prof(side, w):
        p = []
        for k in range(w):
            if side == 'T': px, am = f[k, C:2 * C], alpha[k, C:2 * C]
            elif side == 'B': px, am = f[H - 1 - k, C:2 * C], alpha[H - 1 - k, C:2 * C]
            elif side == 'L': px, am = f[rows, k], alpha[rows, k]
            else: px, am = f[rows, W - 1 - k], alpha[rows, W - 1 - k]
            p.append(np.median(px[am], 0) if am.any() else (p[-1] if p else target))
        return np.array(p, np.float32)
    yy = (np.arange(HK) + 0.5) / K
    xx = (np.arange(WK) + 0.5) / K
    depth = {'T': np.repeat(yy[:, None], WK, 1), 'L': np.repeat(xx[None, :], HK, 0)}
    depth['B'] = H - depth['T']
    depth['R'] = W - depth['L']
    # which side owns each pixel: on a wall the top and bottom bands run the full
    # width (the quoins stand between them); a roof's eaves meet at a mitre
    score = {}
    for sd in 'TBLR':
        w = width[sd]
        score[sd] = np.where(depth[sd] < w, depth[sd] / max(w, 1e-6), np.inf) if w else np.full((HK, WK), np.inf)
    if tab == 'walls':
        tb = np.isfinite(score['T']) | np.isfinite(score['B'])
        for sd in 'LR':
            score[sd] = np.where(tb, np.inf, score[sd])
    st = np.stack([score[sd] for sd in 'TBLR'])
    side_of = np.where(np.isfinite(st.min(0)), st.argmin(0), -1)
    rel0 = tile_to(g_rel, HK, WK)[..., None]
    rel1 = tile_to(np.rot90(g_rel), HK, WK)[..., None]
    for i, sd in enumerate('TBLR'):
        w = width[sd]
        if not w:
            continue
        p = prof(sd, w)
        # the profile at 4x: sharp steps with one output pixel of blend
        d = depth[sd]
        lo = np.clip(np.floor(d).astype(int), 0, w - 1)
        hi = np.clip(lo + 1, 0, w - 1)
        fr = np.clip((d - np.floor(d) - 1 + 0.5 / K) * K + 0.5, 0, 1)[..., None]
        col = p[lo] * (1 - fr) + p[hi] * fr
        turned = (sd in 'TB' and turn == 'tb') or (sd in 'LR' and turn == 'lr')
        m = side_of == i
        if sd in 'LR':
            col = col * side_mul
        out[m] = np.clip(col * (rel1 if turned else rel0), 0, 255)[m]
    return out


def build(tab, key, v, verbose=True):
    src = kit_source(v)
    if tab == 'walls':
        # a wall's top edge is solid: a few kits leave gaps along it, which showed the
        # ground through between the roof's eave and the wall
        src = src.copy()
        src[:3, :, 3] = 255
    H, W = src.shape[:2]
    HK, WK = H * K, W * K
    mat, grain, mode = material(tab, key)
    bands = frame(tab, key) if mode == 'ref' else (0, 0, 0, 0)
    body = body_mask(src, mode, bands)
    alpha = src[..., 3] > 0
    f = src[..., :3].astype(np.float32)
    t_, b_, l_, r_ = bands
    band = np.zeros((H, W), bool)
    band[:t_] = True
    band[H - b_:] = True
    band[:, :l_] = True
    band[:, W - r_:] = True
    band &= alpha
    feat = alpha & ~body & ~band

    # ── colour fields at 4x ──
    target = (f[body] if body.any() else f[alpha]).mean(0)
    body_rgb = tile_to(tint(load_tex(mat), target, contrast=CONTRAST.get(mat, 1.0)), HK, WK)
    g_rel = rel_lum(load_tex(grain))
    side_mul = next((v for k, v in SIDE_SHADE.items() if key.startswith(k)), 1.0) if tab == 'walls' else 1.0
    band_rgb = band_field(tab, f, alpha, bands, target, g_rel, TURN.get(grain, ''), side_mul)
    # (a timber frame's beams take their colour from the dark wood only, not its highlights)
    fsrc = feat & (lum(f) < 140) if mode == 'light' else feat
    feat_rgb = (np.clip(norm_conv(f, fsrc, 0.7 if mode != 'light' else 1.2) * tile_to(g_rel, HK, WK)[..., None] ** 0.8, 0, 255)
                if feat.any() else np.zeros((HK, WK, 3), np.float32))

    if mode == 'light':
        # timber framing: the panels sit back behind the beams (a soft shadow inside
        # each panel's edge), the beams' edges darkened round the panels, and the
        # beams' grain without the plank texture's board gaps
        pm = up(body.astype(np.float32), SIG) > 0.5
        din = ndimage.distance_transform_edt(pm)
        dout = ndimage.distance_transform_edt(~pm)
        body_rgb = body_rgb * (1 - 0.22 * np.exp(-din / 5.0))[..., None]
        grain_soft = ndimage.gaussian_filter(tile_to(g_rel, HK, WK), (0.5, 3.0))
        feat_rgb = np.clip(norm_conv(f, fsrc, 1.2) * grain_soft[..., None] ** 0.8, 0, 255)
        feat_rgb = feat_rgb * (1 - 0.35 * np.exp(-dout / 2.5))[..., None]

    # ── shapes: nothing / body / frame / feature, each blurred, the strongest wins ──
    lab = np.zeros((H, W), np.int32)
    lab[body] = 1
    lab[band] = 2
    lab[feat] = 3
    out = np.zeros((HK, WK, 4), np.float32)
    ramp = np.clip(1 - (np.arange(T) + 0.5) / (R * K), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    wT, wB = ramp[:, None], ramp[::-1][:, None]
    wL, wR = ramp[None, :], ramp[::-1][None, :]
    fields = [None, body_rgb, band_rgb, feat_rgb]

    def field(o):
        return np.stack([up(c, SIG) for c in o])
    for cy in range(H // C):
        for cx in range(W // C):
            m = lab[cy * C:(cy + 1) * C, cx * C:(cx + 1) * C]
            O = np.stack([(m == i).astype(np.float32) for i in range(4)])
            st = field(O)
            # near each border: the border's own line of pixels, repeated inwards
            st = st * (1 - wT) + field(np.repeat(O[:, :1, :], C, 1)) * wT
            st = st * (1 - wB) + field(np.repeat(O[:, -1:, :], C, 1)) * wB
            st = st * (1 - wL) + field(np.repeat(O[:, :, :1], C, 2)) * wL
            st = st * (1 - wR) + field(np.repeat(O[:, :, -1:], C, 2)) * wR
            e = np.exp((st - st.max(0, keepdims=True)) * BETA)
            wts = e / e.sum(0, keepdims=True)
            sy, sx = slice(cy * T, (cy + 1) * T), slice(cx * T, (cx + 1) * T)
            rgb = np.zeros((T, T, 3), np.float32)
            for i in (1, 2, 3):
                rgb += wts[i][..., None] * fields[i][sy, sx]
            a = 1 - wts[0]
            out[sy, sx, :3] = rgb / np.maximum(a, 1e-6)[..., None]
            out[sy, sx, 3] = a * 255
    # the outer left and right edges: outline and shade (only the outer cells' outer sides,
    # so the middle cells still repeat seamlessly)
    xs = np.arange(WK) + 0.5
    d = np.minimum(xs, WK - xs)                       # out px from the nearer side
    ol = np.clip(K * 1.0 - d + 0.5, 0, 1)             # one source px, anti-aliased
    fac = (1 - (1 - OUTLINE) * ol) * (1 - EDGE_SHADE * np.exp(-d / (EDGE_RUN * K)))
    fac = np.where(d < T, fac, 1.0)
    out[..., :3] *= fac[None, :, None]
    os.makedirs(OUT_DIR, exist_ok=True)
    fn = os.path.join(OUT_DIR, f'{tab}_{key}.png')
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(fn)
    if verbose:
        print(f'{tab}/{key}: {mat} body {body.mean():.2f} frame {band.mean():.2f} features {feat.mean():.2f}')
    return fn


def main():
    srcs = json.load(open(os.path.join(HERE, 'kit_sources.json'), encoding='utf-8'))
    want = set(sys.argv[1:])
    for tab in ('walls', 'roofs'):
        for key, v in srcs[tab].items():
            if want and key not in want and f'{tab}/{key}' not in want:
                continue
            try:
                build(tab, key, v)
            except FileNotFoundError as e:
                print(f'{tab}/{key}: skipped ({os.path.basename(str(e.filename))} not made yet)')


if __name__ == '__main__':
    main()
