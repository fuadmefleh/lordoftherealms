# Repaint the LPC TREES (and the map's other scatter: palms, shore plants,
# grassland rocks) in the painted (modern) style at 4x (128px a 32px cell), in
# the SAME layout as the original sheet, so every cell data names still works.
# Each is written to assets/modern/<the original's path under assets/>;
# data/innerMapRenderer.json `modernSheets` points the game at it
# (core/customSheets.js) and ui/sheetScale.js scales the 32px cell addresses.
#
#   python -I build_trees.py [name ...]        (every sheet if none)
#
# Same edge-aware method as build_details.py / build_props.py: each pixel is
# labelled by material (foliage, bark, ground shadow); each material's mask is
# smoothed and upscaled and the strongest wins sharply, so silhouettes stay
# crisp, only anti-aliased; colours inside a material blend softly, so the
# pixel art's shade bands become painted gradients in the original palette.
# The pixel art's one-pixel outlines belong to whichever material they edge
# (a dark rim on the foliage, the bark's own dark side) instead of drawing a
# hard black line.
#
# Foliage is then painted as clustered leaves: two layers of round leaf clumps
# (big ones and small ones inside them), each lit from the upper left with a
# shadowed crevice between them; the clumps also push the silhouette in and
# out, so loose clumps break the outline instead of stepped pixels.
# Bark gets a grain running up the trunk (build_details.py's wood grain).
# Palms are many-coloured art: upscaled smoothly with a crisp silhouette
# (build_props.build_interp), their fronds lightly streaked.
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_details as bd  # noqa: E402  (surfaces, textures, save)
import build_props as bp    # noqa: E402  (smooth upscale for many-coloured art)

ROOT = bd.ROOT
K = bd.K
C = bd.C
BETA = 40
BLOCK = 4
PAD = 5


def P(*c):
    return tuple(c)


# the LPC trees' bark (and the branches of the bare winter trees)
BARK = {P(68, 39, 37), P(46, 31, 28), P(96, 52, 41), P(107, 60, 46), P(64, 54, 29), P(97, 72, 44),
        P(127, 76, 49)}
# one-pixel outlines: they go to the material they edge
OUTLINE = {P(15, 18, 24), P(16, 24, 32), P(42, 23, 34), P(26, 18, 19), P(23, 32, 56), P(13, 40, 62)}
# the snow lying on the bare winter trees' branches
SNOW = {P(235, 237, 233), P(224, 242, 243)}

# name -> (source under assets/, kind, options)
SHEETS = {
    'trees_spring': ('lpc/Terrain/trees_spring.png', 'tree', {}),
    'trees_summer': ('lpc/Terrain/trees_summer.png', 'tree', {}),
    'trees_autumn': ('lpc/Terrain/trees_autumn.png', 'tree', {}),
    'trees_winter': ('lpc/Terrain/trees_winter.png', 'tree', {'winter': True}),
    'palms':        ('lpc/Terrain/palm_trees.png', 'palm', {}),
    'rocks':        ('lpc/Terrain/Rocks, Grasslands.png', 'rock', {}),
    'plants_spring': ('lpc/Terrain/plants_spring.png', 'plant', {}),
    'plants_summer': ('lpc/Terrain/plants_summer.png', 'plant', {}),
    'plants_autumn': ('lpc/Terrain/plants_autumn.png', 'plant', {}),
    'plants_winter': ('lpc/Terrain/plants_winter.png', 'plant', {}),
}


# ── leaf clumps: a height field of round clumps over the whole output sheet ──
def clump_field(H, W, spacing, rmin, rmax, seed):
    """Leaf clumps on a jittered grid (out px): round, their rims lobed into
    leaves; where they overlap the LOWER one is in front (painted foliage: each
    clump's lit top laps over the shaded underside of the one above).
    Returns (height 0..1 of the clump showing, shade: its own surface lit
    from the upper left, about 0 on average)."""
    rng = np.random.default_rng(seed)
    pri = np.full((H, W), -1e9, np.float32)
    h = np.zeros((H, W), np.float32)
    sh = np.zeros((H, W), np.float32)
    R = int(np.ceil(rmax * 1.2)) + 1
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
    lx, ly, lz = -0.5, -0.7, 0.62
    ln = np.sqrt(lx * lx + ly * ly + lz * lz)
    for y in range(-spacing, H + spacing, spacing):
        for x in range(-spacing, W + spacing, spacing):
            cy = y + rng.uniform(0, spacing)
            cx = x + rng.uniform(0, spacing)
            r = rng.uniform(rmin, rmax)
            iy, ix = int(cy), int(cx)
            dy, dx = yy - (cy - iy), (xx - (cx - ix)) / 1.1
            th = np.arctan2(dy, dx)
            k = int(rng.integers(6, 10))
            lobes = 1 + 0.10 * np.cos(k * th + rng.uniform(0, 6.3)) + 0.05 * np.cos((k + 3) * th + rng.uniform(0, 6.3))
            rr = r * lobes
            d2 = (dx * dx + dy * dy) / (rr * rr)
            inside = d2 < 1
            dome = np.sqrt(np.clip(1 - d2, 0, None))
            nx, ny = dx / rr, dy / rr
            shade = (nx * lx + ny * ly + dome * lz) / ln
            p = np.where(inside, cy + dome * r * 0.35, -1e9).astype(np.float32)
            y0, x0 = iy - R, ix - R
            sy0, sx0 = max(0, -y0), max(0, -x0)
            y0c, x0c = max(0, y0), max(0, x0)
            y1c, x1c = min(H, y0 + 2 * R + 1), min(W, x0 + 2 * R + 1)
            if y1c <= y0c or x1c <= x0c:
                continue
            ys = slice(sy0, sy0 + (y1c - y0c))
            xs = slice(sx0, sx0 + (x1c - x0c))
            win = (slice(y0c, y1c), slice(x0c, x1c))
            take = p[ys, xs] > pri[win]
            pri[win] = np.where(take, p[ys, xs], pri[win])
            h[win] = np.where(take, dome[ys, xs], h[win])
            sh[win] = np.where(take, shade[ys, xs], sh[win])
    h = ndimage.gaussian_filter(h, 0.8)
    sh = ndimage.gaussian_filter(sh, 0.9)
    sh = sh - np.median(sh)
    return h.astype(np.float32), sh.astype(np.float32)


_FIELDS = {}


def fields(H, W):
    key = (H, W)
    if key not in _FIELDS:
        big_h, big_s = clump_field(H, W, 26, 20.0, 28.0, 1)
        sm_h, sm_s = clump_field(H, W, 11, 7.0, 10.0, 2)
        _FIELDS[key] = (big_h, big_s, sm_h, sm_s)
    return _FIELDS[key]


def tree_labels(a, winter):
    """Per pixel: (colour, alpha, material). Outline pixels take the material of
    the nearest non-outline pixel."""
    H, W = a.shape[:2]
    rgb = a[..., :3].astype(np.int32)
    keyc = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]

    def isin(s):
        return np.isin(keyc, np.array([(r << 16) | (g << 8) | b for r, g, b in s]))

    solid = a[..., 3] == 255
    out = solid & isin(OUTLINE)
    bark = solid & isin(BARK)
    snow = solid & isin(SNOW)
    mat = np.full((H, W), '', object)
    mat[a[..., 3] > 0] = 'shadow'
    mat[solid] = 'leaf'
    mat[bark] = 'wood'
    if winter:
        # the bare trees' snow lies on their branches: it is part of them
        near_bark = ndimage.binary_dilation(bark, np.ones((3, 3), bool), iterations=2)
        mat[snow & near_bark] = 'wood'
    # conifers (the sheet's bottom rows, right of the stumps): needles in tiers,
    # not round clumps
    # (each crown taken whole: a crown whose middle lies there)
    comp, n = ndimage.label(mat == 'leaf', np.ones((3, 3), bool))
    if n:
        cy = ndimage.center_of_mass(np.ones((H, W)), comp, range(1, n + 1))
        for i, (y, x) in enumerate(cy, 1):
            if y >= 12 * C and x >= 4 * C:
                mat[comp == i] = 'needle'
    known = solid & ~out
    dist, (iy, ix) = ndimage.distance_transform_edt(~known, return_indices=True)
    mat[out] = mat[iy, ix][out]
    # the foliage's outline softened into a deep shade of the leaves it edges
    # (a painted crown has a dark underside, not a black line round it); a
    # solid dark sprite (the sheet's canopy shadows) keeps its colour
    lo = out & np.isin(mat, ['leaf', 'needle']) & (dist <= 2)
    near = a[..., :3][iy, ix].astype(np.float32)
    a[..., :3] = np.where(lo[..., None], (0.35 * a[..., :3] + 0.65 * near * 0.68).round(), a[..., :3]).astype(np.uint8)
    return mat


def build_tree(name, rel, opts):
    winter = opts.get('winter', False)
    a = np.array(Image.open(os.path.join(ROOT, 'assets', rel)).convert('RGBA'))
    H, W = a.shape[:2]
    mat = tree_labels(a, winter)
    keys, idx = [], {}
    lab = np.full((H, W), -1, np.int32)
    for y in range(H):
        for x in range(W):
            if a[y, x, 3] == 0:
                continue
            k = (tuple(int(v) for v in a[y, x, :3]), int(a[y, x, 3]), mat[y, x])
            if k not in idx:
                idx[k] = len(keys)
                keys.append(k)
            lab[y, x] = idx[k]
    mats = ['leaf', 'needle', 'wood', 'shadow']
    mat_of = np.array([mats.index(k[2]) for k in keys] + [-1], np.int32)
    col = np.array([k[0] for k in keys], np.float32)
    alp = np.array([k[1] / 255 for k in keys], np.float32)
    print(name, W, 'x', H, 'colours', len(keys))

    big_h, big_s, sm_h, sm_s = fields(H * K, W * K)
    # each canopy's volume: its mask blurred into a mound, lit from the upper left
    # (a round crown, bright on its upper left, falling into shade below)
    leafm = np.isin(mat, ['leaf', 'needle']).astype(np.float32)
    mound = ndimage.gaussian_filter(leafm, 5.0)
    gy, gx = np.gradient(mound * 40)
    lx, ly, lz = -0.5, -0.75, 0.6
    nn = np.sqrt(gx * gx + gy * gy + 1)
    vol = (-gx * lx - gy * ly + lz) / nn / np.sqrt(lx * lx + ly * ly + lz * lz)
    vol = ndimage.zoom(vol - np.median(vol[leafm > 0]), K, order=1, grid_mode=True, mode='nearest').astype(np.float32)
    # mask smoothing (source px) and colour blending per material
    SIG = {'leaf': 0.85, 'needle': 0.6, 'wood': 0.42 if winter else 0.55, 'shadow': 0.9}
    CSIG = {'leaf': 1.3, 'needle': 0.7, 'wood': 0.55, 'shadow': 0.9}
    CBETA = {'leaf': 4.5, 'needle': 6.0, 'wood': 9.0, 'shadow': 4.0}

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

            def up(mask, s):
                g = ndimage.gaussian_filter(mask.astype(np.float32), s, mode='nearest')
                return ndimage.zoom(g, K, order=3, grid_mode=True, mode='nearest')

            hh, ww = (y1 - y0) * K, (x1 - x0) * K
            oy, ox = y0 * K, x0 * K
            bh = big_h[oy:oy + hh, ox:ox + ww]
            bs = big_s[oy:oy + hh, ox:ox + ww]
            sh_ = sm_h[oy:oy + hh, ox:ox + ww]
            ss = sm_s[oy:oy + hh, ox:ox + ww]
            vv = vol[oy:oy + hh, ox:ox + ww]

            # bark grain direction: along the pixel art's edges (trunks run up)
            ls = a[y0:y1, x0:x1, :3].astype(np.float32).mean(2) * (L >= 0)
            gx = ndimage.sobel(ls, 1)
            gy = ndimage.sobel(ls, 0)
            jxx = ndimage.gaussian_filter(gx * gx, 1.6)
            jyy = ndimage.gaussian_filter(gy * gy, 1.6)
            vert = np.clip(0.5 + 1.2 * (jxx - jyy) / (jxx + jyy + 50), 0, 1)
            vert = ndimage.zoom(vert, K, order=1, grid_mode=True, mode='nearest')
            vert = np.clip((vert - 0.5) * 4 + 0.5, 0, 1)

            present = sorted(int(v) for v in np.unique(M) if v >= 0)
            bg = up(M < 0, SIG['leaf'])
            scores = [bg]
            flds = [np.zeros((hh, ww, 4), np.float32)]
            for mi in present:
                mname = mats[mi]
                mm = up(M == mi, SIG[mname])
                if mname == 'leaf':
                    # the clumps push the crown's outline out and in: the edge moved
                    # by up to ~7 out px along the signed distance to the smoothed
                    # silhouette, so loose clumps break the outline
                    ins = mm > 0.5
                    sd = ndimage.distance_transform_edt(ins) - ndimage.distance_transform_edt(~ins)
                    off = np.clip(10 * (bh - 0.42) + 3 * (sh_ - 0.4), -6, 7)
                    m2 = np.where(np.abs(sd) < 12, np.clip(0.5 + (sd + off) / 3.0, 0, 1), mm)
                    scores[0] = np.clip(scores[0] + (mm - m2), 0, 1)
                    mm = m2
                elif mname == 'needle':
                    # (a conifer's tiers keep their shape: only a little leafy wobble)
                    ins = mm > 0.5
                    sd = ndimage.distance_transform_edt(ins) - ndimage.distance_transform_edt(~ins)
                    off = np.clip(4 * (sh_ - 0.45), -2, 2.5)
                    m2 = np.where(np.abs(sd) < 8, np.clip(0.5 + (sd + off) / 2.0, 0, 1), mm)
                    scores[0] = np.clip(scores[0] + (mm - m2), 0, 1)
                    mm = m2
                scores.append(mm if mname != 'shadow' else mm * 0.98)
                cids = sorted(int(v) for v in np.unique(L[M == mi]))
                if len(cids) == 1:
                    rgb = np.broadcast_to(col[cids[0]], (hh, ww, 3)).astype(np.float32).copy()
                    al = np.full((hh, ww), alp[cids[0]], np.float32)
                else:
                    st = np.stack([up(L == c, CSIG[mname]) for c in cids])
                    e = np.exp((st - st.max(0, keepdims=True)) * CBETA[mname] * 2)
                    wts = e / e.sum(0, keepdims=True)
                    rgb = np.einsum('kyx,kc->yxc', wts, col[cids])
                    al = np.einsum('kyx,k->yx', wts, alp[cids])
                if mname == 'leaf':
                    # clustered leaves: big clumps lit from the upper left with dark
                    # crevices between them, small leaves within
                    gap = np.clip(1 - bh * 4.0, 0, 1)
                    f = (1 + 0.28 * vv + 0.36 * bs + 0.10 * ss - 0.10 * gap)
                    lumv = rgb.mean(2, keepdims=True)
                    # (lights glint a little warmer, darks stay in the palette)
                    rgb = rgb * f[..., None] + np.clip(bs, 0, None)[..., None] * 18 * (lumv / 255 + 0.2)
                elif mname == 'needle':
                    # needle tiers: the crown's volume and fine sprays of needles
                    f = 1 + 0.22 * vv + 0.16 * ss
                    rgb = rgb * f[..., None]
                elif mname == 'wood':
                    g = vert * bd.field(bd.GRAIN_V, oy, ox, hh, ww) + (1 - vert) * bd.field(bd.GRAIN_H, oy, ox, hh, ww)
                    rgb = rgb * (1 + 0.10 * g[..., None])
                flds.append(np.dstack([rgb, al]))
            st = np.stack(scores)
            e = np.exp((st - st.max(0, keepdims=True)) * BETA)
            wts = e / e.sum(0, keepdims=True)
            a_out = sum(wts[i] * flds[i][..., 3] for i in range(len(flds)))
            rgb_out = sum((wts[i] * flds[i][..., 3])[..., None] * flds[i][..., :3] for i in range(len(flds)))
            rgb_out = rgb_out / np.maximum(a_out, 1e-6)[..., None]
            sy, sx = (by - y0) * K, (bx - x0) * K
            ey, ex = sy + min(B, H - by) * K, sx + min(B, W - bx) * K
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), :3] = rgb_out[sy:ey, sx:ex]
            out[by * K:by * K + (ey - sy), bx * K:bx * K + (ex - sx), 3] = a_out[sy:ey, sx:ex] * 255
    return out


def build_palm(rel, sharpen=0.45):
    out = bp.build_interp(rel, sharpen)
    # the fronds' leaflets: fine streaks across them, so a frond reads as feathered
    H, W = out.shape[:2]
    big_h, big_s, sm_h, sm_s = fields(H, W)
    rgb = out[..., :3]
    lumv = rgb.mean(2)
    green = (rgb[..., 1] > rgb[..., 0] * 1.05) & (lumv > 40)
    m = ndimage.gaussian_filter(green.astype(np.float32), 1.5)
    out[..., :3] = rgb * (1 + m * 0.10 * sm_s)[..., None]
    return out


def build(name):
    rel, kind, opts = SHEETS[name]
    if kind == 'tree':
        out = build_tree(name, rel, opts)
    elif kind == 'palm':
        print(name, '(smooth upscale)')
        out = build_palm(rel)
    elif kind == 'rock':
        # few-coloured stone: build_props's material method, all stone
        out = bp.build_mat(name, rel, lambda c, x, y: 'outline' if c in bd.OUTLINE else 'stone', 0.6)
    else:
        print(name, '(smooth upscale)')
        out = bp.build_interp(rel, 0.4)
    bd.save(out, rel)


if __name__ == '__main__':
    for n in (sys.argv[1:] or list(SHEETS)):
        build(n)
