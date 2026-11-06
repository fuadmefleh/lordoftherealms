# Repaint the remaining pixel-art TOWN PROPS (lamp posts, fences and gates,
# tents, fountain, pool, buckets, baskets, sawhorse, lumber, campfire, flowers,
# rune-stones, the market stall / produce / sacks sheet, the vegetable crops)
# in the painted style, at 4x (128px a 32px cell), in the SAME layout as the
# original sheet, so every cell data names still works. Each is written to
# assets/modern/<the original's path under assets/>; data/innerMapRenderer.json
# `modernSheets` points the game at it (core/customSheets.js) and
# ui/sheetScale.js scales the 32px cell addresses.
#
#   python -I build_props.py [name ...]        (every sheet if none)
#
# Same method as build_details.py (whose surfaces this borrows): few-coloured
# art is labelled per pixel by material; each material's mask is smoothed and
# upscaled and the strongest wins sharply (crisp, anti-aliased silhouettes),
# colours inside a material blend softly (shade bands -> gradients, original
# colours kept), then the material's surface (grain, speckle, sheen, weave,
# ripples). Many-coloured art (tents, flowers, rune-stones, the market sheet,
# crops) is upscaled smoothly with its silhouette kept crisp, then lightly
# sharpened.
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_details as bd  # noqa: E402  (surfaces + textures)

HERE = bd.HERE
ROOT = bd.ROOT
K = bd.K
C = bd.C
BETA = bd.BETA
BLOCK = bd.BLOCK
PAD = bd.PAD
SIG = bd.SIG
RECT = 0.5

# extra materials (beta inside, surface)
MAT = dict(bd.MAT)
MAT.update({
    'wicker': (3.0, 'wicker'),
    'pwater': (2.6, 'pwater'),
    'flame':  (2.2, 'flame'),
    'marble': (3.2, 'ceramic'),
    'gold':   (3.6, 'ceramic'),
    'lamp':   (2.6, 'lamp'),
})

_rng = np.random.default_rng(20261107)
TS = bd.TS


def _n(sig):
    return ndimage.gaussian_filter(_rng.standard_normal((TS, TS)), sig, mode='wrap')


RIPPLE = bd._std(bd._norm(_n((2.2, 5))) * 0.5 + bd._norm(_n((6, 12))) * 0.5)


def surface(kind, rgb, oy, ox, vert, m):
    h, w = rgb.shape[:2]
    if kind == 'wicker':
        return rgb * (1 + 0.16 * bd.field(bd.STRAW, oy, ox, h, w)[..., None])
    if kind == 'pwater':
        r = bd.field(RIPPLE, oy, ox, h, w)
        lit = np.clip(r - 1.9, 0, None)          # thin bright glints on the crests
        return rgb * (1 + 0.03 * r[..., None]) + lit[..., None] * np.array([18, 22, 22], np.float32)
    if kind == 'flame':
        # a soft glow: the hot core lifted toward yellow-white
        L = rgb.mean(2, keepdims=True)
        return rgb + np.clip((L - 150) / 80, 0, 1) * np.array([10, 18, 12], np.float32)
    if kind == 'lamp':
        glow = ndimage.gaussian_filter((m > 0.5).astype(np.float32), 1.6 * K)
        return rgb * (0.9 + 0.25 * glow[..., None])
    return bd.surface(kind, rgb, oy, ox, vert, m)


def P(*c):
    return tuple(c)


OUTLINE = {P(15, 18, 24), P(26, 18, 19), P(27, 25, 43)}
DARK_WOOD = {P(46, 31, 28), P(43, 37, 17), P(43, 28, 29), P(43, 28, 28)}


def r_lamp(c, x, y):
    if c == P(15, 18, 24): return 'outline'
    if c in (P(243, 195, 95), P(209, 148, 40), P(244, 228, 141), P(255, 255, 255),
             P(174, 107, 63), P(127, 76, 49)):
        return 'lamp'
    return 'iron'


def r_woodout(c, x, y):
    """Plain wood whose darkest brown is its outline."""
    if c in DARK_WOOD or c in OUTLINE: return 'outline'
    return 'wood'


def r_basket(c, x, y):
    if c in DARK_WOOD: return 'outline'
    if c == P(209, 148, 40): return 'wicker'
    return 'wicker'


def r_bucket(c, x, y):
    if c in (P(15, 18, 24), P(27, 25, 43)): return 'iron'
    if c in (P(49, 72, 41), P(25, 51, 45), P(79, 143, 186), P(60, 94, 139)): return 'pwater'
    if c in (P(42, 23, 34), P(46, 31, 28)): return 'outline'
    return 'wood'


def r_fountain(c, x, y):
    if c in (P(58, 175, 194), P(108, 220, 231)): return 'pwater'
    if c in (P(161, 96, 24), P(209, 148, 40), P(121, 65, 23), P(244, 228, 141), P(96, 52, 41)): return 'gold'
    if c in (P(72, 65, 82),): return 'outline'
    return 'marble'


def r_pool(c, x, y):
    return 'pwater'


def r_fire(c, x, y):
    if c in (P(229, 96, 16), P(255, 138, 0), P(199, 52, 27), P(240, 224, 89), P(164, 38, 0)): return 'flame'
    if c in (P(41, 37, 58), P(72, 65, 82)): return 'stone'
    if c in (P(46, 31, 28), P(26, 18, 19)): return 'outline'
    return 'wood'


# name -> (source under assets/, rules or None for a smooth upscale, mask smoothing / sharpen)
SHEETS = {
    'lamp':      ('lpc/Objects/Furniture/Lighting, Outdoors.png', r_lamp, RECT),
    'sawhorse':  ('lpc/Objects/Furniture/Sawhorse.png', None, 0.4),
    'lumber':    ('lpc/Objects/Small Items/Lumber.png', r_woodout, RECT),
    'pfence':    ('lpc/Structure/Fences/Plain Fence A.png', r_woodout, RECT),
    'fence':     ('lpc/ThatchedHouses/tilesets/fence.png', r_woodout, RECT),
    'baskets':   ('lpc/Objects/Small Items/Baskets A.png', None, 0.45),
    'buckets':   ('lpc/Objects/Small Items/Buckets.png', r_bucket, 0.6),
    'fountain':  ('lpc/Structure/Misc/Fountain A.png', r_fountain, 0.6),
    'pool':      ('lpc/Structure/Misc/Pool A.png', r_pool, 0.6),
    'campfire':  ('lpc/Objects/Small Items/Fire, Camp.png', r_fire, 0.6),
    'tents':     ('lpc/Objects/Camp/Clan Tents.png', None, 0.6),
    'runestone': ('lpc/Objects/Furniture/Wolf Stone.png', None, 0.35),
    'flowers':   ('lpc/Objects/Small Items/Flowers.png', None, 0.5),
    'farm':      ('lpc/ThatchedHouses/tilesets/farming_fishing.png', None, 0.4),
    'crops':     ('lpc/crops.png', None, 0.4),
}


def load(rel):
    a = np.array(Image.open(os.path.join(ROOT, 'assets', rel)).convert('RGBA'))
    # near-opaque pixels (253 in the thatched fence) are solid, not shadow
    a[..., 3] = np.where(a[..., 3] >= 248, 255, a[..., 3])
    return a


def build_interp(rel, sharpen):
    """Many-coloured art: colour upscaled bicubic (carried out under the clear
    pixels first so edges do not darken) and sharpened; silhouette smoothed and
    kept crisp. Semi-clear shadow pixels keep their own (soft) alpha."""
    a = load(rel).astype(np.float32)
    solid = a[..., 3] >= 128
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb = a[..., :3][iy, ix]
    up = np.dstack([ndimage.zoom(rgb[..., i], K, order=3, grid_mode=True, mode='nearest') for i in range(3)])
    soft = np.dstack([ndimage.gaussian_filter(up[..., i], 1.2 * K / 4) for i in range(3)])
    up = up + sharpen * (up - soft)
    m = ndimage.zoom(ndimage.gaussian_filter(solid.astype(np.float32), 0.6, mode='nearest'), K, order=3,
                     grid_mode=True, mode='nearest')
    al = 1 / (1 + np.exp(-(m - 0.5) * 18))
    # shadows (semi-clear pixels): their colour and alpha, smoothed, where nothing solid is
    sh = (a[..., 3] > 0) & ~solid
    if sh.any():
        sa = np.where(sh, a[..., 3], 0) / 255
        sa_up = ndimage.zoom(ndimage.gaussian_filter(sa, 0.7, mode='nearest'), K, order=1,
                             grid_mode=True, mode='nearest')
        _, (jy, jx) = ndimage.distance_transform_edt(~sh, return_indices=True)
        srgb = a[..., :3][jy, jx]
        srgb_up = np.dstack([ndimage.zoom(srgb[..., i], K, order=0, grid_mode=True, mode='nearest')
                             for i in range(3)])
        up = up * al[..., None] + srgb_up * (1 - al[..., None])
        al = al + (1 - al) * np.clip(sa_up, 0, 1)
    return np.dstack([up, al * 255])


def build_mat(name, rel, rules, sig):
    a = load(rel)
    H, W = a.shape[:2]
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

            def up(mask):
                g = ndimage.gaussian_filter(mask.astype(np.float32), sig, mode='nearest')
                return ndimage.zoom(g, K, order=3, grid_mode=True, mode='nearest')

            ls = lum_src[y0:y1, x0:x1]
            gx = ndimage.sobel(ls, 1)
            gy = ndimage.sobel(ls, 0)
            jxx = ndimage.gaussian_filter(gx * gx, 1.6)
            jyy = ndimage.gaussian_filter(gy * gy, 1.6)
            vert = np.clip(0.5 + 1.2 * (jxx - jyy) / (jxx + jyy + 50), 0, 1)
            vert = ndimage.zoom(vert, K, order=1, grid_mode=True, mode='nearest')
            vert = np.where(vert > 0.5, np.clip((vert - 0.5) * 4 + 0.5, 0, 1),
                            np.clip(0.5 - (0.5 - vert) * 4, 0, 1))

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
                    st = np.stack([up(L == c) for c in cids])
                    e = np.exp((st - st.max(0, keepdims=True)) * beta_in * 2)
                    wts = e / e.sum(0, keepdims=True)
                    rgb = np.einsum('kyx,kc->yxc', wts, col[cids])
                    al = np.einsum('kyx,k->yx', wts, alp[cids])
                rgb = surface(surf, rgb, oy, ox, vert, mm)
                fields.append(np.dstack([rgb, al]))
            st = np.stack(scores)
            e = np.exp((st - st.max(0, keepdims=True)) * BETA)
            wts = e / e.sum(0, keepdims=True)
            a_out = sum(wts[i] * fields[i][..., 3] for i in range(len(fields)))
            rgb_out = sum((wts[i] * fields[i][..., 3])[..., None] * fields[i][..., :3] for i in range(len(fields)))
            rgb_out = rgb_out / np.maximum(a_out, 1e-6)[..., None]
            sy, sx = (by - y0) * K, (bx - x0) * K
            ey, ex = sy + min(B, H - by) * K, sx + min(B, W - bx) * K
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), :3] = rgb_out[sy:ey, sx:ex]
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), 3] = a_out[sy:ey, sx:ex] * 255
    return out


def build(name):
    rel, rules, sig = SHEETS[name]
    if rules is None:
        print(name, '(smooth upscale)')
        out = build_interp(rel, sig)
    else:
        out = build_mat(name, rel, rules, sig)
    bd.save(out, rel)


if __name__ == '__main__':
    for n in (sys.argv[1:] or list(SHEETS)):
        build(n)
