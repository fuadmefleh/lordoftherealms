# New pixel-art trees in the LPC trees' own style, palette and scale (32px a
# cell, the same 4-tone leaf ramps lit from the upper left, leafy flecks, dark
# rim along the underside). Not wired into the game: it writes a review sheet.
#
#   python -I make_new_trees.py            -> scratch/new_trees_*.png
#
# Each kind is drawn for the four seasons. Canopies are built from round leaf
# clumps (later = nearer, painted over), each shaded as a dome; a crevice of
# shade where a nearer clump overlaps; the value is broken by short leaf
# strokes before it is cut into the 4 tones, which gives the LPC fleck.
# Bare winter crowns are grown as recursive branches inside the summer
# crown's outline, with snow lying along the top of the branches.
import os
import sys
import math
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'new_trees_out')


def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def ramp(*cs):
    return [hx(c) for c in cs]


# light -> dark, then the rim/outline colour. The first four sets are sampled
# from the LPC tree sheets themselves.
LEAF = {
    'spring': ramp('#7cb82f', '#5c9a2a', '#3b7330', '#1c4525', '#19332d'),
    'summer': ramp('#75a743', '#468232', '#25562e', '#19332d', '#2a1722'),
    'autumn': ramp('#eb7127', '#c3511a', '#95381c', '#603429', '#2a1722'),
    'pine': ramp('#25562e', '#19332d', '#172038', '#0f1218', '#0f1218'),
    'pine_snow': ramp('#ebede9', '#8abec9', '#4f899d', '#174562', '#101820'),
    'gold': ramp('#f9c22b', '#e3901d', '#a85a1c', '#603429', '#2a1722'),
    'red': ramp('#ea4f36', '#b5272d', '#7f1b2a', '#4c1a26', '#2a1722'),
    'willow': ramp('#a8ca58', '#75a743', '#468232', '#25562e', '#19332d'),
    'willow_aut': ramp('#d9c45a', '#a8a33a', '#757a2c', '#3f4a22', '#2a1722'),
    'blossom': ramp('#fbe6ec', '#f2a9c2', '#c86b98', '#7a3b63', '#3b1f33'),
    'cypress': ramp('#3b7330', '#25562e', '#19332d', '#172038', '#0f1218'),
    'young': ramp('#9cc944', '#6fa83a', '#3b7330', '#1c4525', '#19332d'),
}
BARK = ramp('#7f4a33', '#603429', '#442725', '#2e1f1c', '#40361d')   # lit, mid, dark, rim, ground
BIRCH = ramp('#ebede9', '#c7cfcc', '#929fa3', '#2e222f', '#40361d')
SNOW = ramp('#ebede9', '#e0f2f3', '#a4dddb', '#4f8fba')
APPLE = ramp('#f5a097', '#e83b3b', '#891e2b')
TWIG = ramp('#7a5a3a', '#5a3d2c', '#3a2620')

SEASONS = ['spring', 'summer', 'autumn', 'winter']


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = np.zeros((h, w, 4), np.uint8)

    def put(self, x, y, c, a=255):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y, x, :3] = c
            self.px[y, x, 3] = a

    def get_a(self, x, y):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y, x, 3]
        return 0

    def image(self):
        return Image.fromarray(self.px, 'RGBA')


def leaf_noise(w, h, rng, density=0.55, lens=(2, 3)):
    """Short leaf strokes of +-1: the LPC fleck."""
    f = np.zeros((h, w))
    n = int(w * h * density)
    dirs = [(1, -1), (1, 0), (1, 1), (1, -1), (0, 1)]
    for _ in range(n):
        x, y = rng.integers(0, w), rng.integers(0, h)
        dx, dy = dirs[rng.integers(0, len(dirs))]
        s = 1 if rng.random() < 0.5 else -1
        for i in range(rng.integers(lens[0], lens[1] + 1)):
            xx, yy = x + dx * i, y + dy * i
            if 0 <= xx < w and 0 <= yy < h:
                f[yy, xx] += s
    return np.clip(f, -1.5, 1.5) / 1.5


def shift(a, dx, dy, fill):
    """out[y, x] = a[y + dy, x + dx] (fill outside)."""
    h, w = a.shape
    out = np.full_like(a, fill)
    ys = slice(max(0, -dy), h - max(0, dy))
    xs = slice(max(0, -dx), w - max(0, dx))
    ys2 = slice(max(0, dy), h - max(0, -dy))
    xs2 = slice(max(0, dx), w - max(0, -dx))
    out[ys, xs] = a[ys2, xs2]
    return out


def smooth_noise(w, h, rng, sigma):
    from scipy import ndimage
    n = ndimage.gaussian_filter(rng.standard_normal((h, w)), sigma)
    return n / (n.std() + 1e-9)


def _nb(m, dx, dy):
    return shift(m, dx, dy, False)


def canopy(cv, clumps, pal, rng, edge=1.6, fleck=0.3, light=(-0.55, -0.75, 0.55),
           top_bias=0.3, holes=0.0, cut=(0.68, 0.46, 0.25), crevice=0.16, unify=0.45):
    """Paint leaf clumps [(cx, cy, rx, ry)] onto the canvas. Returns the mask.

    edge: how far (px) the leafy silhouette wanders in and out of the clumps.
    unify: how much the whole crown is lit as one dome (vs clump by clump)."""
    w, h = cv.w, cv.h
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    noise = leaf_noise(w, h, rng, 0.42, (2, 3))
    blob = smooth_noise(w, h, rng, 1.1)
    L = np.array(light)
    L = L / np.linalg.norm(L)
    owner = -np.ones((h, w), int)
    val = np.zeros((h, w))
    top = min(c[1] - c[3] for c in clumps)
    bot = max(c[1] + c[3] for c in clumps)
    left = min(c[0] - c[2] for c in clumps)
    right = max(c[0] + c[2] for c in clumps)
    gcx, gcy = (left + right) / 2, (top + bot) / 2
    grx, gry = (right - left) / 2, (bot - top) / 2

    def dome(cx, cy, rx, ry):
        nx = (xx - cx) / rx
        ny = (yy - cy) / ry
        d = np.sqrt(nx * nx + ny * ny)
        nz = np.sqrt(np.clip(1 - np.minimum(d, 1) ** 2, 0, 1))
        return d, nx * L[0] + ny * L[1] + nz * L[2]

    _, glit = dome(gcx, gcy, grx, gry)
    g = 1 - (yy - top) / max(bot - top, 1)
    order = sorted(range(len(clumps)), key=lambda i: clumps[i][1])
    for k in order:
        cx, cy, rx, ry = clumps[k]
        d, lit = dome(cx, cy, rx, ry)
        r = min(rx, ry)
        inside = (1 - d) * r + blob * edge + noise * 0.6 > 0
        lit = lit * (1 - unify) + glit * unify
        v = 0.5 + 0.45 * lit * (1 - top_bias) + top_bias * (g - 0.5)
        owner[inside] = k
        val[inside] = v[inside]
    mask = owner >= 0
    # tidy the silhouette: no lone pixels hanging off, no pinholes
    for _ in range(2):
        n4 = sum(_nb(mask, dx, dy).astype(int) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        mask = (mask & (n4 >= 2)) | (~mask & (n4 >= 4))
    owner[~mask] = -1
    # crevice: a back clump's pixels just above a nearer clump
    rank = {k: i for i, k in enumerate(order)}
    rk = np.vectorize(lambda o: rank.get(o, -1))(owner)
    for dx, dy, amt in ((0, 1, 1.0), (0, 2, 0.6), (1, 1, 0.5)):
        sh = shift(rk, dx, dy, -1)   # sh[y, x] = rk[y + dy, x + dx]
        val[(sh > rk) & (rk >= 0)] -= amt * crevice
    if holes:
        hole = (blob < -1.4) & (val < 0.5) & (rng.random((h, w)) < holes * 8)
        mask &= ~hole
    v = val + noise * fleck
    tone = np.where(v > cut[0], 0, np.where(v > cut[1], 1, np.where(v > cut[2], 2, 3)))
    # a lone speck of one tone inside another reads as noise: mostly merge it
    same = [shift(tone, dx, dy, -9) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
    lone = (same[0] == same[1]) & (same[1] == same[2]) & (same[2] == same[3]) & (same[0] != tone) & (same[0] >= 0)
    lone &= rng.random((h, w)) < 0.35
    tone = np.where(lone, same[0], tone)
    m = mask
    edge_px = m & ~(_nb(m, 0, -1) & _nb(m, 0, 1) & _nb(m, -1, 0) & _nb(m, 1, 0))
    low = (yy - top) / max(bot - top, 1)
    tone = np.where(edge_px & (low > 0.5), 3, tone)
    tone = np.where(edge_px & (low > 0.3), np.maximum(tone, 2), tone)
    tone = np.where(edge_px, np.maximum(tone, 1), tone)
    for t in range(4):
        sel = m & (tone == t)
        cv.px[sel, :3] = pal[t]
        cv.px[sel, 3] = 255
    # a one-pixel rim of outline under the crown
    rim = ~m & _nb(m, 0, -1) & (low > 0.7)
    cv.px[rim, :3] = pal[4]
    cv.px[rim, 3] = 255
    return m


def trunk(cv, x, y0, y1, w0, w1, rng, pal=BARK, roots=True, marks=False, lean=0.0):
    """A trunk from the ground (y0) up to y1, w0 wide at the foot."""
    for y in range(int(y1), int(y0) + 1):
        t = (y0 - y) / max(y0 - y1, 1)
        w = w0 + (w1 - w0) * t
        if roots and y0 - y < 3:
            w += (3 - (y0 - y)) * 1.6
        cx = x + lean * (y0 - y)
        l, r = int(round(cx - w / 2)), int(round(cx + w / 2))
        for xx in range(l, r + 1):
            u = (xx - l) / max(r - l, 1)
            if xx == r:
                c = pal[3]
            elif u < 0.3:
                c = pal[0]
            elif u < 0.65:
                c = pal[1]
            else:
                c = pal[2]
            if not marks and rng.random() < 0.12 and 0 < xx - l < r - l:
                c = pal[2] if c != pal[2] else pal[1]
            cv.put(xx, y, c)
        if marks and rng.random() < 0.22:   # birch: dark lenticels
            mx = rng.integers(l, r + 1)
            ln = rng.integers(1, max(2, int(w * 0.7)))
            for i in range(ln):
                cv.put(mx + i, y, pal[3] if i % 2 == 0 or rng.random() < 0.5 else pal[2])
    if roots:
        for xx in range(int(x - w0 / 2 - 4), int(x + w0 / 2 + 5)):
            if rng.random() < 0.55:
                cv.put(xx, y0 + 1, pal[4])
        cv.put(x - w0 / 2 - 3, y0, pal[2])
        cv.put(x + w0 / 2 + 3, y0, pal[3])


def line(cv, x0, y0, x1, y1, th, pal, snow=False, rng=None, taper=True):
    """A branch: th px thick across its direction, lit on its upper/left side."""
    x0, y0, x1, y1 = round(x0), round(y0), round(x1), round(y1)
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    steep = abs(y1 - y0) >= abs(x1 - x0)
    for i in range(n):
        t = i / max(n - 1, 1)
        x = round(x0 + (x1 - x0) * t)
        y = round(y0 + (y1 - y0) * t)
        tt = max(1, int(round(th * ((1 - 0.5 * t) if taper else 1))))
        for k in range(tt):
            c = pal[0] if (k == 0 and tt > 1) else (pal[2] if k == tt - 1 and tt > 1 else pal[1])
            off = k - (tt - 1) // 2
            if steep:
                cv.put(x + off, y, c)
            else:
                cv.put(x, y + off, c)
        if snow and not steep and rng.random() < 0.8:
            cv.put(x, y - (tt - 1) // 2 - 1, SNOW[0] if rng.random() < 0.7 else SNOW[2])


def grow(cv, x, y, ang, ln, th, depth, rng, inside, pal=TWIG, snow=False, droop=0.0, spread=0.55):
    if depth == 0 or ln < 1.5:
        # a tuft of fine twig ends
        for _ in range(2):
            a = ang + (rng.random() - 0.5) * 1.6
            cv.put(x + math.cos(a) * 1.5, y + math.sin(a) * 1.5, pal[2] if rng.random() < 0.5 else pal[1])
        return
    x1 = x + math.cos(ang) * ln
    y1 = y + math.sin(ang) * ln
    tries = 0
    while not inside(x1, y1) and tries < 3:
        ln *= 0.6
        x1 = x + math.cos(ang) * ln
        y1 = y + math.sin(ang) * ln
        tries += 1
    if not inside(x1, y1):
        return
    p = BARK if th >= 2.5 else pal
    line(cv, x, y, x1, y1, th, p, snow and th < 2.5, rng)
    kids = 2 + (1 if rng.random() < 0.45 else 0)
    for k in range(kids):
        da = (rng.random() - 0.5) * spread + (k - (kids - 1) / 2) * spread
        # crowns spread upward and out: pull the branches a little toward up
        a2 = ang + da + droop
        a2 += (-math.pi / 2 - a2) * 0.04
        grow(cv, x1, y1, a2, ln * (0.66 + rng.random() * 0.16), max(th * 0.62, 1), depth - 1, rng, inside,
             pal, snow, droop, spread)


def ellipse_inside(clumps, pad=1.0):
    def f(x, y):
        return any(((x - cx) / (rx * pad)) ** 2 + ((y - cy) / (ry * pad)) ** 2 <= 1 for cx, cy, rx, ry in clumps)
    return f


def bare_crown(cv, x, ytop_trunk, clumps, rng, snow, density=1.0, pal=TWIG, droop=0.0, step=2.0,
               influence=11.0, kill=2.2, start=None, **_):
    """A bare crown grown by space colonisation: twig ends are scattered all
    through the summer crown's outline and the branches grow toward them, so
    the twigs fill the crown as a real tree's do. droop bends the ends down."""
    inside = ellipse_inside(clumps, 1.0)
    left = min(c[0] - c[2] for c in clumps); right = max(c[0] + c[2] for c in clumps)
    top = min(c[1] - c[3] for c in clumps); bot = max(c[1] + c[3] for c in clumps)
    area = sum(math.pi * c[2] * c[3] for c in clumps)
    n = int(area / 7 * density)
    pts = []
    while len(pts) < n:
        px, py = rng.uniform(left, right), rng.uniform(top, bot)
        if inside(px, py):
            pts.append((px, py))
    pts = np.array(pts)
    nodes = [(float(x), float(ytop_trunk))]
    parent = [-1]
    # the trunk keeps climbing until the crown is near
    for (sx, sy) in (start or []):
        nodes.append((sx, sy)); parent.append(len(nodes) - 2)
    alive = np.ones(len(pts), bool)
    for _ in range(160):
        if not alive.any():
            break
        P = np.array(nodes)
        A = pts[alive]
        d = np.sqrt(((A[:, None, :] - P[None, :, :]) ** 2).sum(-1))
        near = d.argmin(1)
        nd = d[np.arange(len(A)), near]
        grow_dir = {}
        for i in np.nonzero(nd < influence)[0]:
            j = near[i]
            v = (A[i] - P[j]) / max(nd[i], 1e-6)
            grow_dir.setdefault(j, []).append(v)
        if not grow_dir:
            # nothing in reach: the newest node pushes straight up
            j = len(nodes) - 1
            grow_dir[j] = [np.array([0.0, -1.0])]
        for j, vs in grow_dir.items():
            v = np.mean(vs, 0)
            v[1] += droop
            v = v / (np.linalg.norm(v) + 1e-9)
            nx_, ny_ = P[j] + v * step + rng.normal(0, 0.35, 2)
            nodes.append((nx_, ny_)); parent.append(j)
        P = np.array(nodes)
        idx = np.nonzero(alive)[0]
        dd = np.sqrt(((pts[idx][:, None, :] - P[None, -len(grow_dir):, :]) ** 2).sum(-1)).min(1)
        alive[idx[dd < kill]] = False
    # pipe model: a branch is as thick as the twigs it carries
    cnt = np.ones(len(nodes))
    for i in range(len(nodes) - 1, 0, -1):
        if parent[i] >= 0:
            cnt[parent[i]] += cnt[i] * 0.55
    maxc = cnt[0]
    order = sorted(range(1, len(nodes)), key=lambda i: cnt[i])   # thin first, thick drawn over
    for i in order:
        p = parent[i]
        x0, y0 = nodes[p]; x1, y1 = nodes[i]
        th = 0.6 + 3.4 * math.sqrt(cnt[i] / maxc)
        line(cv, x0, y0, x1, y1, th, BARK if th >= 2.4 else pal, False, rng, taper=False)
    # fine twig ends off every tip
    tips = set(range(len(nodes))) - set(parent)
    for i in tips:
        p = parent[i]
        if p < 0:
            continue
        vx, vy = nodes[i][0] - nodes[p][0], nodes[i][1] - nodes[p][1]
        a0 = math.atan2(vy, vx)
        for _ in range(2):
            a = a0 + rng.uniform(-0.7, 0.7)
            ln = rng.uniform(1.5, 3.5)
            line(cv, nodes[i][0], nodes[i][1], nodes[i][0] + math.cos(a) * ln, nodes[i][1] + math.sin(a) * ln,
                 1, [pal[2]] * 3, taper=False)
    # the trunk runs on up into the crown as a tapering leader
    line(cv, x, ytop_trunk + 4, x, ytop_trunk - 8, 4, BARK)
    if snow:
        # snow settled along the tops of the boughs
        a = cv.px[..., 3] > 0
        y0_ = max(0, int(top) - 2); y1_ = int(bot) + 1
        for y in range(max(1, y0_), min(cv.h, y1_)):
            for x in range(cv.w):
                if a[y, x] and not a[y - 1, x] and rng.random() < 0.22:
                    cv.put(x, y - 1, SNOW[0] if rng.random() < 0.75 else SNOW[2])


def scatter_fruit(cv, mask, rng, n, pal=APPLE):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return
    for _ in range(n):
        i = rng.integers(0, len(xs))
        x, y = xs[i], ys[i]
        if mask[y:y + 2, x:x + 2].all():
            cv.put(x, y, pal[0]); cv.put(x + 1, y, pal[1])
            cv.put(x, y + 1, pal[1]); cv.put(x + 1, y + 1, pal[2])


def snow_cap(cv, mask, rng, amount=0.75):
    """Snow along the tops of a crown: the first pixels from above."""
    h, w = mask.shape
    for x in range(w):
        col = np.nonzero(mask[:, x])[0]
        if not len(col):
            continue
        prev = False
        for y in range(h):
            m = mask[y, x]
            if m and not prev and rng.random() < amount:
                cv.put(x, y, SNOW[0])
                if y + 1 < h and mask[y + 1, x] and rng.random() < 0.6:
                    cv.put(x, y + 1, SNOW[2])
            prev = m


# ── the kinds ────────────────────────────────────────────────────────────────
# Each returns an RGBA image W x H with the foot of the trunk at the bottom
# centre (one row of ground shade below it).

def make_oak(season, seed):
    """A big old oak: broad, lumpy crown of many clumps on a thick trunk."""
    rng = np.random.default_rng(seed)
    W, H = 128, 136
    cv = Canvas(W, H)
    cx, foot = 64, 128
    cl = [(64, 46, 30, 22), (38, 58, 20, 17), (90, 56, 21, 17), (52, 30, 20, 16), (80, 32, 19, 15),
          (66, 70, 26, 14), (30, 72, 14, 11), (100, 72, 14, 11), (64, 18, 14, 10)]
    trunk(cv, cx, foot, 70, 14, 9, rng)
    # two low limbs into the crown
    line(cv, cx - 3, 92, cx - 22, 70, 4, BARK)
    line(cv, cx + 3, 88, cx + 24, 68, 4, BARK)
    if season == 'winter':
        bare_crown(cv, cx, 74, cl, rng, True, depth=8, n=5, ln=16, spread=0.55)
    else:
        m = canopy(cv, cl, LEAF[season], rng, holes=0.04, top_bias=0.22, cut=(0.72, 0.48, 0.26))
    return cv.image()


def make_birch(season, seed):
    """Silver birch: slim white trunks, light airy crown."""
    rng = np.random.default_rng(seed)
    W, H = 80, 132
    cv = Canvas(W, H)
    cx, foot = 40, 124
    cl = [(40, 34, 15, 16), (30, 52, 13, 14), (52, 48, 12, 15), (40, 70, 15, 12), (46, 22, 9, 9),
          (28, 76, 9, 8)]
    trunk(cv, cx - 4, foot, 30, 6, 2, rng, BIRCH, marks=True, lean=0.05)
    trunk(cv, cx + 5, foot - 2, 46, 4, 2, rng, BIRCH, roots=False, marks=True, lean=-0.06)
    if season == 'winter':
        bare_crown(cv, cx - 1, 60, cl, rng, True, depth=7, n=4, ln=12,
                   pal=ramp('#8a6b5a', '#5e4a42', '#3a2c2a'), droop=0.08)
    else:
        pal = {'spring': LEAF['young'], 'summer': LEAF['spring'], 'autumn': LEAF['gold']}[season]
        canopy(cv, cl, pal, rng, holes=0.10, fleck=0.24)
    return cv.image()


def make_willow(season, seed):
    """Weeping willow: a dome with long hanging strands."""
    rng = np.random.default_rng(seed)
    W, H = 128, 132
    cv = Canvas(W, H)
    cx, foot = 64, 124
    trunk(cv, cx, foot, 52, 12, 7, rng)
    line(cv, cx - 2, 72, cx - 20, 50, 4, BARK)
    line(cv, cx + 2, 70, cx + 22, 52, 4, BARK)
    dome = [(64, 40, 34, 18), (44, 46, 20, 14), (84, 46, 20, 14), (64, 28, 22, 12)]
    if season == 'winter':
        inside = ellipse_inside([(64, 60, 52, 50)])
        for i in range(5):
            a = -math.pi / 2 + (i - 2) * 0.5
            grow(cv, cx, 64, a, 20, 3.2, 4, rng, inside, TWIG, False, 0.0, 0.5)
        _strands(cv, rng, cx, dome, ramp('#d8bc6a', '#c9a95a', '#9e7a46', '#6b5034', '#3a2620'), density=0.5, length=(30, 60),
                 snow=True)
        return cv.image()
    pal = LEAF['willow'] if season != 'autumn' else LEAF['willow_aut']
    if season == 'spring':
        pal = ramp('#c3dc68', '#9cc944', '#6fa83a', '#3b7330', '#19332d')
    m = canopy(cv, dome, pal, rng, fleck=0.22)
    _strands(cv, rng, cx, dome, pal, density=1.0, length=(26, 64))
    return cv.image()


def _strands(cv, rng, cx, dome, pal, density=1.0, length=(26, 64), snow=False):
    xs = np.arange(cx - 52, cx + 53)
    for back in (True, False):
        for x0 in xs:
            if rng.random() > 0.42 * density:
                continue
            d = abs(x0 - cx) / 52
            # strands hang from the dome's underside
            y0 = 44 + (1 - d * d) * 12 - (0 if back else 4) + rng.integers(-3, 3)
            ln = rng.integers(*length) * (1 - 0.45 * d * d)
            x = float(x0)
            for i in range(int(ln)):
                y = y0 + i
                x += (rng.random() - 0.5) * 0.5 + (0.05 if x0 > cx else -0.05)
                t = i / ln
                if back:
                    c = pal[3] if t < 0.7 else pal[2]
                else:
                    side = (x0 - cx) / 52
                    base = 1 if side < 0.2 else 2
                    c = pal[base - 1] if (t > 0.85 or rng.random() < 0.18 - side * 0.1) else pal[base]
                    if i == 0:
                        c = pal[3]
                if snow and rng.random() < 0.05:
                    c = SNOW[1]
                cv.put(x, y, c)
                if not back and not snow and t < 0.9:
                    cv.put(x + 1, y, pal[min(3, pal.index(c) + 1)] if c in pal else c)


def make_apple(season, seed):
    """An orchard tree: short, wide, spring blossom, red fruit later."""
    rng = np.random.default_rng(seed)
    W, H = 96, 100
    cv = Canvas(W, H)
    cx, foot = 48, 94
    cl = [(48, 36, 24, 15), (30, 44, 15, 12), (66, 44, 15, 12), (48, 52, 20, 10), (40, 24, 12, 9),
          (58, 26, 12, 9)]
    trunk(cv, cx, foot, 52, 9, 6, rng, lean=0.04)
    line(cv, cx, 62, cx - 16, 48, 3, BARK)
    line(cv, cx + 1, 60, cx + 15, 47, 3, BARK)
    if season == 'winter':
        bare_crown(cv, cx, 60, cl, rng, True, depth=7, n=5, ln=10, spread=0.6)
        return cv.image()
    pal = {'spring': LEAF['blossom'], 'summer': LEAF['summer'], 'autumn': LEAF['summer']}[season]
    m = canopy(cv, cl, pal, rng, holes=0.03)
    if season == 'spring':
        # green leaves among the blossom
        ys, xs = np.nonzero(m)
        for _ in range(140):
            i = rng.integers(0, len(xs))
            if rng.random() < 0.6:
                cv.put(xs[i], ys[i], LEAF['spring'][2])
    elif season == 'summer':
        scatter_fruit(cv, m, rng, 18, ramp('#cfe06a', '#9cbc34', '#5a7a26'))
    else:
        scatter_fruit(cv, m, rng, 26)
    return cv.image()


def make_maple(season, seed):
    """A round maple that turns red in autumn."""
    rng = np.random.default_rng(seed)
    W, H = 96, 124
    cv = Canvas(W, H)
    cx, foot = 48, 118
    cl = [(48, 40, 28, 26), (34, 54, 16, 14), (62, 54, 16, 14), (48, 66, 22, 10)]
    trunk(cv, cx, foot, 70, 9, 6, rng)
    if season == 'winter':
        bare_crown(cv, cx, 76, cl, rng, True, depth=8, n=4, ln=14, spread=0.5)
        return cv.image()
    pal = {'spring': LEAF['spring'], 'summer': LEAF['summer'], 'autumn': LEAF['red']}[season]
    canopy(cv, cl, pal, rng)
    return cv.image()


def make_cypress(season, seed):
    """A tall narrow evergreen column."""
    rng = np.random.default_rng(seed)
    W, H = 48, 132
    cv = Canvas(W, H)
    cx, foot = 24, 126
    trunk(cv, cx, foot, 110, 6, 5, rng)
    cl = []
    for i in range(11):
        t = i / 10                      # 0 at the foot of the crown, 1 at the tip
        y = 110 - t * 102
        r = 12.5 * math.sin(math.pi * (0.18 + 0.8 * t)) ** 0.8 * (1 - 0.35 * t) + 2
        cl.append((24 + rng.uniform(-1.5, 1.5), y, r, 10 + 3 * (1 - t)))
    pal = LEAF['pine_snow'] if season == 'winter' else LEAF['cypress']
    canopy(cv, cl, pal, rng, edge=1.2, fleck=0.26, light=(-0.8, -0.35, 0.5), top_bias=0.25, crevice=0.08, unify=0.7)
    return cv.image()


def make_young(season, seed):
    """A young tree: a thin stem and a small crown, for filling gaps."""
    rng = np.random.default_rng(seed)
    W, H = 48, 76
    cv = Canvas(W, H)
    cx, foot = 24, 70
    cl = [(24, 24, 13, 13), (17, 34, 8, 7), (31, 33, 8, 7)]
    trunk(cv, cx, foot, 34, 4, 3, rng)
    if season == 'winter':
        bare_crown(cv, cx, 38, cl, rng, True, depth=6, n=3, ln=8)
        return cv.image()
    pal = {'spring': LEAF['young'], 'summer': LEAF['summer'], 'autumn': LEAF['gold']}[season]
    canopy(cv, cl, pal, rng)
    return cv.image()


def make_snag(season, seed):
    """A dead, broken tree: the same all year, snow on it in winter."""
    rng = np.random.default_rng(seed)
    W, H = 64, 112
    cv = Canvas(W, H)
    cx, foot = 32, 106
    grey = ramp('#9a8a78', '#76655a', '#54453d', '#2e1f1c', '#40361d')
    top = 34
    trunk(cv, cx, foot, top, 14, 10, rng, grey)
    # splintered top: tall jagged points, the inner wood paler
    for x in range(cx - 6, cx + 7):
        u = (x - (cx - 6)) / 12
        spike = int(10 * abs(math.sin(u * 7.3 + 1.1)) * (1 - abs(u - 0.4)) + rng.integers(0, 3))
        for y in range(top - spike, top + 1):
            c = grey[0] if u < 0.35 else (grey[1] if u < 0.7 else grey[2])
            if y == top - spike:
                c = hx('#b8a890')
            cv.put(x, y, c)
        if x == cx + 6:
            for y in range(top - spike, top + 1):
                cv.put(x, y, grey[3])
    # a hollow
    for y in range(64, 72):
        for x in range(cx - 1, cx + 3):
            e = ((x - cx - 1) / 2.2) ** 2 + ((y - 68) / 4.2) ** 2
            if e < 1:
                cv.put(x, y, hx('#1a1210') if e < 0.55 else grey[3])
    # one bare limb, one broken stub
    line(cv, cx - 5, 58, cx - 18, 46, 3, grey)
    line(cv, cx - 18, 46, cx - 20, 38, 2, grey)
    line(cv, cx - 15, 48, cx - 23, 47, 1, grey)
    line(cv, cx + 6, 52, cx + 13, 47, 3, grey, taper=False)
    cv.put(cx + 13, 46, hx('#b8a890')); cv.put(cx + 14, 47, hx('#b8a890'))
    # moss low on the shaded side
    for y in range(foot - 14, foot - 2):
        if rng.random() < 0.6:
            cv.put(cx + 5 + rng.integers(0, 3), y, LEAF['summer'][2 if rng.random() < 0.6 else 1])
    if season == 'winter':
        a = cv.px[..., 3] > 0
        for x in range(W):
            for y in range(1, H - 8):
                if a[y, x] and not a[y - 1, x]:
                    cv.put(x, y - 1, SNOW[0])
                    if rng.random() < 0.5:
                        cv.put(x, y, SNOW[2])
                    break
    return cv.image()


KINDS = [
    ('Old oak', make_oak),
    ('Birch', make_birch),
    ('Willow', make_willow),
    ('Apple', make_apple),
    ('Maple', make_maple),
    ('Cypress', make_cypress),
    ('Young tree', make_young),
    ('Dead snag', make_snag),
]


def build_all():
    out = {}
    for i, (name, fn) in enumerate(KINDS):
        out[name] = {s: fn(s, 1000 + i * 17) for s in SEASONS}
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    trees = build_all()
    for name, by in trees.items():
        for s, im in by.items():
            im.save(os.path.join(OUT, '%s_%s.png' % (name.lower().replace(' ', '_'), s)))
    print('wrote', OUT)
