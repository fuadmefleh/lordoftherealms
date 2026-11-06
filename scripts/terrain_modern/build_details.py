# Repaint the pixel-art DETAILS of town buildings and the props beside them
# (doors, door frames, windows, awnings, chimneys, sign boards, emblems,
# pillars, planters, hay, barrels, crates) in the painted style of the modern
# building kits, at 4x (128px a 32px cell), in the SAME layout as the original
# sheet. Each is written to assets/modern/<the original's path under assets/>;
# data/innerMapRenderer.json `modernSheets` points the game at it and
# `hiResSheets` gives the original's width (ui/sheetScale.js).
#
#   python -I build_details.py [name ...]        (every sheet if none)
#
# How (edge-aware, like build_cliff.py):
#   - every pixel is labelled by (colour, material): the material comes from the
#     sheet's rules below (wood, stone, iron, glass, cloth, straw, leaf, ...);
#   - SHAPES: each material's mask is smoothed and upscaled (cubic) and the
#     strongest wins with a sharp softmax - silhouettes and outlines stay crisp,
#     only anti-aliased instead of stepped;
#   - COLOUR inside a material: its colours' masks compete with a SOFT softmax,
#     so the pixel art's flat shade bands become painted gradients, keeping the
#     original colours (variants still read);
#   - then the material's surface: wood grain running along the boards (the
#     direction read from the pixel art's own edges), fine stone speckle, iron
#     sheen, glass with a soft diagonal reflection (and a warm glow when lit),
#     the painted thatch's straws on hay, the painted grass's blades on leaves.
# The sheet is processed in blocks of cells with a margin, so neighbouring
# cells are smoothed as one picture and meet exactly.
import os
import sys
import colorsys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
K = 4
C = 32
SIG = 0.72        # mask smoothing, source px
BETA = 40         # crispness between materials
BLOCK = 4         # cells per processing block (each way)
PAD = 4           # margin, source px

# material -> (soft softmax beta inside it, surface)
MAT = {
    'outline': (12, None),
    'wood':    (5.0, 'wood'),
    'paint':   (3.2, 'paintwood'),
    'stone':   (3.2, 'stone'),
    'iron':    (5.0, 'iron'),
    'glass_dark': (3.0, 'glass_dark'),
    'glass_pale': (3.0, 'glass_pale'),
    'glass_lit':  (3.0, 'glass_lit'),
    'cloth':   (4.0, 'cloth'),
    'straw':   (2.4, 'straw'),
    'leaf':    (3.0, 'leaf'),
    'ceramic': (3.2, 'ceramic'),
    'flower':  (5.0, None),
    'water':   (3.0, 'glass_dark'),
    'flat':    (6.0, None),
    'shadow':  (2.0, None),
}


def P(*c):
    return tuple(c)


def hsv(c):
    return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)


def lum(c):
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255


OUTLINE = {P(15, 18, 24), P(26, 18, 19)}
IRON = {P(75, 75, 96), P(106, 117, 135), P(168, 179, 184), P(114, 107, 126), P(134, 126, 127),
        P(129, 142, 151), P(52, 48, 67), P(89, 94, 112), P(56, 43, 51)}


def r_door(c, x, y):
    if c in OUTLINE: return 'outline'
    if c in IRON: return 'iron'
    return 'wood'


def r_frame(c, x, y):
    if c in OUTLINE: return 'outline'
    col = x // C
    return 'wood' if col >= 9 else 'stone'


def r_window(c, x, y):
    if c == P(0, 0, 0): return 'glass_dark'
    if c == P(224, 242, 243): return 'glass_pale'
    if c == P(244, 228, 141): return 'glass_lit'
    if c in (P(72, 65, 82), P(114, 107, 126)): return 'iron'
    if c in (P(68, 39, 37), P(100, 65, 51), P(127, 76, 49), P(174, 107, 63)): return 'wood'
    return 'stone'


def r_stone(c, x, y):
    if c in OUTLINE or lum(c) < 0.11: return 'outline'
    return 'stone'


def r_sign(c, x, y):
    if c in OUTLINE: return 'outline'
    return 'paint'


def r_awning(c, x, y):
    if c in (P(0, 0, 0), P(15, 18, 24)): return 'outline'
    if c in (P(42, 23, 34), P(68, 39, 37), P(96, 52, 41), P(62, 17, 26)): return 'wood'
    return 'cloth'


def r_planter(c, x, y):
    if c in OUTLINE: return 'outline'
    h, s, v = hsv(c)
    h *= 360
    if c in (P(13, 40, 62), P(25, 51, 45)): return 'leaf'
    if 70 <= h <= 175 and s > 0.25: return 'leaf'
    if c in (P(239, 116, 126), P(255, 173, 151), P(94, 32, 67), P(121, 42, 83), P(244, 228, 141),
             P(243, 195, 95), P(209, 148, 40), P(224, 156, 76)):
        return 'flower'
    if (h <= 45 or h >= 340) and s > 0.3: return 'wood'
    return 'ceramic'


def r_hay(c, x, y):
    return 'straw'


def r_barrel(c, x, y):
    if c in (P(27, 25, 43), P(41, 37, 58)): return 'iron'
    if c in (P(25, 51, 45), P(49, 72, 41), P(60, 94, 139), P(79, 143, 186)): return 'water'
    return 'wood'


def r_crate(c, x, y):
    if c in IRON: return 'iron'
    return 'wood'


def r_flat(c, x, y):
    return 'flat'


# name -> (source under assets/, rules, colour quantisation or None[, mask smoothing[, options]])
# (rectilinear structure art - panes, panels, mouldings - is smoothed less, so
# square corners stay square; round things - hay, barrels, leaves - more)
# options:
#   colour_sig  smoothing of the colour masks inside a material (default: the mask smoothing)
#   beta_scale  how much crisper the shade bands inside a material stay (x the MAT beta)
#   vert        grain direction forced (1 = boards run up and down)
#   grain       'door': a bolder, coarser grain that still reads at 2x
#   glazing     panes and cames drawn crisp (see glaze())
#   cloth       'awning': no weave, soft folds down the cloth
RECT = 0.5
GLAZING = {'glazing': True}
SHEETS = {
    'doorframe':  ('lpc/Structure/Doors/32x64px Doors/Doorframe A.png', r_frame, None, RECT),
    'door':       ('lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png', r_door, None, RECT,
                   {'colour_sig': 0.32, 'beta_scale': 3.5, 'vert': 1.0, 'grain': 'door'}),
    'arched':     ('lpc/Structure/Doors/64x64px Arched Doors/Arched Double Doors A.png', r_door, None, RECT),
    'stonewin':   ('lpc/Structure/Windows/Stone Windows A.png', r_window, None, RECT, GLAZING),
    'ornwin_a':   ('lpc/Structure/Windows/Ornamental Windows A.png', r_window, None, RECT, GLAZING),
    'ornwin_b':   ('lpc/Structure/Windows/Ornamental Windows B.png', r_window, None, RECT, GLAZING),
    'awning':     ('lpc/Structure/Windows/Window Awnings A.png', r_awning, None, 0.58,
                   {'colour_sig': 0.62, 'beta_scale': 1.6, 'cloth': 'awning'}),
    'chimney':    ('lpc/Structure/Roofing/Brick Chimney A.png', r_stone, None, RECT),
    'sign':       ('lpc/Structure/Signs/Sign Backgrounds A.png', r_sign, None, RECT),
    'pillar':     ('lpc/Structure/Pillars/Stone Pillar A.png', r_stone, None, RECT),
    'planter':    ('lpc/Objects/Furniture/Planter.png', r_planter, None),
    'hay':        ('lpc/Objects/Small Items/Hay & Straw.png', r_hay, None),
    'barrel':     ('lpc/Objects/Furniture/Barrel.png', r_barrel, None),
    'crate':      ('lpc/Objects/Furniture/Crate.png', r_crate, None, RECT),
    'emblems':    ('buildingKit/emblems.png', None, None),
}


# ── surfaces: tileable fields in OUTPUT pixels (TS x TS, wrapped) ──
TS = 512
_rng = np.random.default_rng(20261106)


def _norm(a):
    a = a - a.mean()
    return a / (np.abs(a).max() + 1e-6)


def _std(a):
    a = a - a.mean()
    return np.clip(a / (a.std() + 1e-6), -3, 3)


def _noise(sig):
    return ndimage.gaussian_filter(_rng.standard_normal((TS, TS)), sig, mode='wrap')


def _tex_hp(name, size, sig):
    t = np.asarray(Image.open(os.path.join(HERE, name)).convert('L').resize((size, size), Image.LANCZOS),
                   np.float32)
    t = np.tile(t, (TS // size + 1, TS // size + 1))[:TS, :TS] if size < TS else t[:TS, :TS]
    return _norm(t - ndimage.gaussian_filter(t, sig, mode='wrap'))


# wood grain along y (fibres), with a few darker long streaks and knots of tone
_g = _norm(_noise((16, 0.7))) * 0.6 + _norm(_noise((40, 1.8))) * 0.4
GRAIN_V = _std(_g + 0.35 * _norm(_noise((6, 0.5))))
GRAIN_H = GRAIN_V.T.copy()
# a door's boards: coarser fibres and long darker streaks, so the grain survives being drawn at 2x
_rng2 = np.random.default_rng(20261107)


def _noise2(sig):
    return ndimage.gaussian_filter(_rng2.standard_normal((TS, TS)), sig, mode='wrap')


GRAIN_DOOR = _std(_norm(_noise2((28, 1.5))) * 0.5 + _norm(_noise2((90, 3.5))) * 0.3
                  + _norm(_noise2((7, 0.7))) * 0.2)
# an awning's folds: soft vertical swells, their spacing wandering a little
_fx = np.arange(TS, dtype=np.float32)
_wob = ndimage.gaussian_filter1d(_rng2.standard_normal(TS), 40, mode='wrap')
_wob = _wob / (np.abs(_wob).max() + 1e-6)
FOLDS = np.tile(np.sin(2 * np.pi * (_fx / 22.0 + 0.35 * _wob))[None, :], (TS, 1)).astype(np.float32)
SPECKLE = _std(_norm(_noise(1.6)) * 0.4 + _norm(_noise(4.0)) * 0.35 + _norm(_noise(12.0)) * 0.25)
CLOTH = _std(_norm(_noise((0.6, 3))) * 0.5 + _norm(_noise((3, 0.6))) * 0.3 + _norm(_noise(12)) * 0.2)
STRAW = _tex_hp('thatch_tile.png', 256, 6)
LEAF = _tex_hp('grass.png', 256, 5)


def field(F, oy, ox, h, w):
    ys = (np.arange(h) + oy) % TS
    xs = (np.arange(w) + ox) % TS
    return F[np.ix_(ys, xs)]


def surface(kind, rgb, oy, ox, vert, m, opts=None):
    """Lay a material's surface over its colour field rgb (h,w,3)."""
    opts = opts or {}
    h, w = rgb.shape[:2]
    if kind is None:
        return rgb
    L = rgb.mean(2, keepdims=True)
    if kind == 'wood' and opts.get('grain') == 'door':
        # the panels' bevels pressed in harder (the shade bands' contrast lifted
        # locally), then the boards' grain
        soft = np.dstack([ndimage.gaussian_filter(rgb[..., i], 3.0) for i in range(3)])
        rgb = rgb + 0.9 * (rgb - soft)
        return rgb * (1 + 0.095 * field(GRAIN_DOOR, oy, ox, h, w)[..., None])
    if kind == 'cloth' and opts.get('cloth') == 'awning':
        f = field(FOLDS, oy, ox, h, w)
        return rgb * (1 + 0.045 * f[..., None] + 0.008 * field(CLOTH, oy, ox, h, w)[..., None])
    if kind in ('wood', 'paintwood'):
        g = vert * field(GRAIN_V, oy, ox, h, w) + (1 - vert) * field(GRAIN_H, oy, ox, h, w)
        amp = 0.085 if kind == 'wood' else 0.035
        return rgb * (1 + amp * g[..., None])
    if kind == 'stone':
        return rgb * (1 + 0.035 * field(SPECKLE, oy, ox, h, w)[..., None])
    if kind == 'iron':
        s = field(SPECKLE, oy, ox, h, w)[..., None]
        # a cool sheen: darks a touch blue, lights lifted
        out = rgb * (1 + 0.03 * s)
        hi = np.clip((L - 90) / 120, 0, 1)
        return out + hi * 30 + np.array([0, 2, 8], np.float32)
    if kind == 'cloth':
        return rgb * (1 + 0.03 * field(CLOTH, oy, ox, h, w)[..., None])
    if kind == 'straw':
        return rgb * (1 + 0.32 * field(STRAW, oy, ox, h, w)[..., None])
    if kind == 'leaf':
        return rgb * (1 + 0.22 * field(LEAF, oy, ox, h, w)[..., None])
    if kind == 'ceramic':
        return rgb * (1 + 0.012 * field(SPECKLE, oy, ox, h, w)[..., None])
    if kind.startswith('glass'):
        yy, xx = np.mgrid[oy:oy + h, ox:ox + w].astype(np.float32)
        # soft diagonal reflection bands, across the whole window
        u = ((xx * 0.9 + yy) / (C * K * 1.35)) % 1.0
        band = np.exp(-((u - 0.30) / 0.07) ** 2) + 0.55 * np.exp(-((u - 0.47) / 0.03) ** 2)
        sky = (yy % (C * K)) / (C * K)          # a little lighter toward each cell's top
        n = field(SPECKLE, oy, ox, h, w) * 0.3
        if kind == 'glass_dark':
            base = rgb * 0.85 + np.array([18, 26, 40], np.float32)
            base = base + (1 - sky[..., None]) * np.array([6, 10, 16], np.float32)
            return base + band[..., None] * np.array([40, 52, 66], np.float32)
        if kind == 'glass_pale':
            base = rgb * (0.88 + 0.10 * (1 - sky[..., None])) + np.array([-12, -4, 6], np.float32)
            return base + band[..., None] * 28 + n[..., None] * 3
        # lit: warm glow, brighter in the middle of the pane, orange toward the edges
        glow = ndimage.gaussian_filter((m > 0.5).astype(np.float32), 2.5 * K)
        warm = np.array([255, 214, 120], np.float32) * (0.80 + 0.28 * glow[..., None])
        warm = warm + (1 - glow[..., None]) * np.array([0, -24, -40], np.float32)
        return warm * 0.85 + rgb * 0.15 + band[..., None] * 16
    return rgb


def build_interp(name, rel):
    """Art already shaded in many colours (the emblems): its colour upscaled smoothly
    (bicubic, colours carried out under the clear pixels first so edges do not
    darken), a little sharpened; its silhouette smoothed and kept crisp."""
    src = os.path.join(ROOT, 'assets', rel)
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    H, W = a.shape[:2]
    solid = a[..., 3] >= 128
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb = a[..., :3][iy, ix]
    up = np.dstack([ndimage.zoom(rgb[..., i], K, order=3, grid_mode=True, mode='nearest') for i in range(3)])
    soft = np.dstack([ndimage.gaussian_filter(up[..., i], 1.2 * K / 4) for i in range(3)])
    up = up + 0.35 * (up - soft)
    m = ndimage.zoom(ndimage.gaussian_filter(solid.astype(np.float32), 0.6, mode='nearest'), K, order=3,
                     grid_mode=True, mode='nearest')
    al = 1 / (1 + np.exp(-(m - 0.5) * 18))
    o = np.dstack([up, al * 255])
    return o


def build(name):
    if SHEETS[name][1] is None:
        rel = SHEETS[name][0]
        out = build_interp(name, rel)
        return save(out, rel)
    rel, rules, quant = SHEETS[name][:3]
    sig = SHEETS[name][3] if len(SHEETS[name]) > 3 else SIG
    opts = SHEETS[name][4] if len(SHEETS[name]) > 4 else {}
    csig = opts.get('colour_sig', sig)
    bscale = opts.get('beta_scale', 1.0)
    src = os.path.join(ROOT, 'assets', rel)
    im = Image.open(src).convert('RGBA')
    if quant:
        # (many-coloured art: its colours merged to a working palette first)
        a = im.getchannel('A')
        q = im.convert('RGB').quantize(quant, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        im = q.convert('RGB').convert('RGBA')
        im.putalpha(a.point(lambda v: 255 if v >= 128 else 0))
    a = np.asarray(im)
    H, W = a.shape[:2]

    # labels: (colour, alpha, material) -> index
    keys, idx = [], {}
    lab = np.full((H, W), -1, np.int32)
    for y in range(H):
        for x in range(W):
            al = int(a[y, x, 3])
            if al == 0:
                continue
            c = tuple(int(v) for v in a[y, x, :3])
            mat = 'shadow' if al < 255 else rules(c, x, y)
            k = (c, al, mat)
            if k not in idx:
                idx[k] = len(keys)
                keys.append(k)
            lab[y, x] = idx[k]
    mats = sorted({k[2] for k in keys})
    mat_of = np.array([mats.index(k[2]) for k in keys] + [-1], np.int32)
    col = np.array([k[0] for k in keys], np.float32)
    alp = np.array([k[1] / 255 for k in keys], np.float32)
    print(name, W, 'x', H, 'colours', len(keys), 'materials', mats)

    lum_src = a[..., :3].astype(np.float32).mean(2) * (a[..., 3] > 0)
    out = np.zeros((H * K, W * K, 4), np.float32)
    B = BLOCK * C
    for by in range(0, H, B):
        for bx in range(0, W, B):
            y0, y1 = max(by - PAD, 0), min(by + B + PAD, H)
            x0, x1 = max(bx - PAD, 0), min(bx + B + PAD, W)
            L = lab[y0:y1, x0:x1]
            if (L[by - y0:by - y0 + B, bx - x0:bx - x0 + B] < 0).all():
                continue
            M = np.where(L >= 0, mat_of[L], -1)

            def up(mask, s=sig):
                g = ndimage.gaussian_filter(mask.astype(np.float32), s, mode='nearest')
                return ndimage.zoom(g, K, order=3, grid_mode=True, mode='nearest')

            # the grain's direction: along the pixel art's edges (vertical edges -> vertical grain)
            ls = lum_src[y0:y1, x0:x1]
            gx = ndimage.sobel(ls, 1)
            gy = ndimage.sobel(ls, 0)
            jxx = ndimage.gaussian_filter(gx * gx, 1.6)
            jyy = ndimage.gaussian_filter(gy * gy, 1.6)
            vert = np.clip(0.5 + 1.2 * (jxx - jyy) / (jxx + jyy + 50), 0, 1)
            vert = ndimage.zoom(vert, K, order=1, grid_mode=True, mode='nearest')
            vert = np.where(vert > 0.5, np.clip((vert - 0.5) * 4 + 0.5, 0, 1), np.clip(0.5 - (0.5 - vert) * 4, 0, 1))
            if 'vert' in opts:
                vert = np.full_like(vert, opts['vert'])

            present = sorted(int(v) for v in np.unique(M) if v >= 0)
            hh, ww = (y1 - y0) * K, (x1 - x0) * K
            oy, ox = y0 * K, x0 * K
            scores = [up(M < 0)]
            fields = [np.zeros((hh, ww, 4), np.float32)]
            for mi in present:
                mname = mats[mi]
                beta_in, surf = MAT[mname]
                mm = up(M == mi)
                scores.append(mm if mname != 'shadow' else mm * 0.98)
                cids = sorted(int(v) for v in np.unique(L[M == mi]))
                if len(cids) == 1:
                    rgb = np.broadcast_to(col[cids[0]], (hh, ww, 3)).astype(np.float32)
                    al = np.full((hh, ww), alp[cids[0]], np.float32)
                else:
                    st = np.stack([up(L == c, csig) for c in cids])
                    e = np.exp((st - st.max(0, keepdims=True)) * beta_in * bscale * 2)
                    wts = e / e.sum(0, keepdims=True)
                    rgb = np.einsum('kyx,kc->yxc', wts, col[cids])
                    al = np.einsum('kyx,k->yx', wts, alp[cids])
                rgb = surface(surf, rgb, oy, ox, vert, mm, opts)
                fields.append(np.dstack([rgb, al]))
            st = np.stack(scores)
            beta = np.full((len(scores), 1, 1), BETA, np.float32)
            e = np.exp((st - st.max(0, keepdims=True)) * beta)
            wts = e / e.sum(0, keepdims=True)
            # premultiplied blend
            a_out = sum(wts[i] * fields[i][..., 3] for i in range(len(fields)))
            rgb_out = sum((wts[i] * fields[i][..., 3])[..., None] * fields[i][..., :3] for i in range(len(fields)))
            rgb_out = rgb_out / np.maximum(a_out, 1e-6)[..., None]
            # keep only the block's own area
            sy, sx = (by - y0) * K, (bx - x0) * K
            ey, ex = sy + min(B, H - by) * K, sx + min(B, W - bx) * K
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), :3] = rgb_out[sy:ey, sx:ex]
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), 3] = a_out[sy:ey, sx:ex] * 255
    if opts.get('glazing'):
        glaze(out, a, rules)
    save(out, rel)


def _nn(v):
    return np.repeat(np.repeat(v, K, 0), K, 1)


def glaze(out, a, rules):
    """Redraw a window sheet's glazing crisp: the panes and the cames (lead / iron
    glazing bars) between them, with any stone mullion or transom set in it, are
    one region drawn from the pixel art's own grid - straight muntins, square
    pane corners - instead of the soft mask blend, which rounded each small pane
    into a blob. Glass keeps its kind (dark, pale, lit): a soft reflection across
    the window, the came's shadow along each pane's upper-left edges, a slight
    tone of its own per pane (old glass), and the warm glow when lit; cames get
    a lead ridge. The region's outer edge is anti-aliased into the frame."""
    H, W = a.shape[:2]
    mat = np.full((H, W), '', object)
    for y in range(H):
        for x in range(W):
            if a[y, x, 3] == 255:
                mat[y, x] = rules(tuple(int(v) for v in a[y, x, :3]), x, y)
    glass = np.isin(mat, ['glass_dark', 'glass_pale', 'glass_lit'])
    came = mat == 'iron'
    # the glazing: the panes, the bars between them (closing across gaps of up
    # to five px - a mullion with its edge lines), and the came round them
    G = np.zeros((H, W), bool)
    hl, vl = np.ones((1, 6), bool), np.ones((6, 1), bool)
    for cx in range(0, W, C):
        g = np.pad(glass[:, cx:cx + C], 6)
        cl = (ndimage.binary_closing(g, hl) | ndimage.binary_closing(g, vl))[6:-6, 6:-6]
        G[:, cx:cx + C] = cl | (ndimage.binary_dilation(cl, np.ones((3, 3), bool)) & came[:, cx:cx + C])
    G &= a[..., 3] == 255
    # (a lattice of wooden bars - often diagonal - stays as the soft blend drew it:
    # only glazing barred with cames or stone is redrawn on the grid)
    wood = ndimage.binary_dilation(mat == 'wood', np.ones((3, 3), bool))
    comp, n = ndimage.label(G)
    if n:
        G &= ~np.isin(comp, np.unique(comp[wood & G]))
    glass &= G
    if not G.any():
        return

    def hi(mask, s):
        g = ndimage.gaussian_filter(mask.astype(np.float32), s, mode='nearest')
        return ndimage.zoom(g, K, order=1, grid_mode=True, mode='nearest')

    def crisp(v, k):
        return 1 / (1 + np.exp(-(v - 0.5) * k))

    aG = crisp(hi(G, 0.3), 18)
    ga = crisp(hi(glass, 0.2), 26)
    rgb = a[..., :3].astype(np.float32)
    # the bars' colour carried under the glass, nearest-neighbour (crisp bars)
    _, (iy, ix) = ndimage.distance_transform_edt(glass, return_indices=True)
    bar = _nn(rgb[iy, ix])
    barcame = _nn(came[iy, ix])
    # the cames a flat lead, lit along their upper edge; a touch of stone speckle on mullions
    lip = np.clip(ndimage.shift(ga, (1, 0), order=0, mode='nearest') - ga, 0, 1) * barcame
    sp = np.tile(SPECKLE, (H * K // TS + 1, W * K // TS + 1))[:H * K, :W * K]
    bar = np.where(barcame[..., None], bar + 10 + lip[..., None] * 26, bar * (1 + 0.035 * sp[..., None]))
    # the glass: each kind's colour (nearest), each pane a tone of its own
    _, (jy, jx) = ndimage.distance_transform_edt(~glass, return_indices=True)
    panes, n = ndimage.label(glass)
    tone = np.concatenate([[1.0], 1 + 0.045 * np.random.default_rng(H * 1000 + W).standard_normal(n)]).astype(np.float32)
    gcol = _nn(rgb[jy, jx] * tone[panes[jy, jx]][..., None])
    gk = _nn(mat[jy, jx])
    lit = _nn((mat == 'glass_lit').astype(np.float32))
    # the cames' shadow on the glass along each pane's upper and left edges
    sh = ndimage.shift(ndimage.gaussian_filter(1 - ga, 0.9), (1.2, 1.2), order=1, mode='nearest')
    gl = np.zeros_like(gcol)
    for kind in ('glass_dark', 'glass_pale', 'glass_lit'):
        m = gk == kind
        if not m.any():
            continue
        sf = surface(kind, gcol, 0, 0, None, lit)
        depth = 0.30 if kind != 'glass_lit' else 0.18
        sf = sf * (1 - depth * np.clip(sh, 0, 1))[..., None]
        gl[m] = sf[m]
    inner = ga[..., None] * gl + (1 - ga[..., None]) * bar
    out[..., :3] = aG[..., None] * inner + (1 - aG[..., None]) * out[..., :3]


def save(out, rel):
    dst = os.path.join(ROOT, 'assets', 'modern', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    o = np.clip(out + 0.5, 0, 255).astype(np.uint8)
    o[o[..., 3] < 3] = 0
    Image.fromarray(o, 'RGBA').save(dst, optimize=True)
    print('  wrote', dst, o.shape[1], 'x', o.shape[0])


if __name__ == '__main__':
    for n in (sys.argv[1:] or list(SHEETS)):
        build(n)
