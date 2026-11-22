"""Make the maimed body's LPC layers: stumps, hooks, wooden legs, crutches and
the marks on a face (a scarred-out eye, a blindfold over put-out eyes, cropped
ears, a slit nose, a copper nose, a brand on the cheek).

Every sheet is drawn here, pixel by pixel, from the LPC sheets themselves:
the hands are where the Gloves layer is, the feet where the Shoes (and the
High Socks) are, the eyes where the eye overlay is, so each frame of each
animation of both bodies gets its own fitted overlay.

Output: assets/lpc/Characters/Maimed/<Layer>/<Masculine|Feminine>/<Anim>.png,
64x64 frames in the LPC layout (rows up, left, down, right). Layers named
'Erase - ...' are masks: ui/innerMapCharacters.js draws them with
destination-out, cutting the hand or foot out of everything beneath (body,
sleeves, gloves, boots), and the next layer draws the stump, hook or peg.
ui/maimLook.js picks the layers for a body (systems/maimMarks.js visible()).

Conventions (match the LPC eye patch, which covers the LEFT eye): the first
hand lost is the RIGHT (a thief's hand), the first foot the LEFT, the first
ear the RIGHT, the brand on the RIGHT cheek.

Run: python scripts/make_maim_layers.py [outdir]
"""
import os
import sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CH = os.path.join(ROOT, 'assets', 'lpc', 'Characters')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(CH, 'Maimed')
W = 64
ANIMS = ['Walk', 'Idle', 'Combat 1h - Slash', 'Combat 1h - Halfslash', 'Legacy - Swing',
         'Combat 1h - Idle', 'Sitting', 'Emotes', 'Climb']
UP, LEFT, DOWN, RIGHT = 0, 1, 2, 3

BUILDS = {
    'Masculine': {
        'body': 'Body/Body 02 - Masculine, Thin/Ivory',
        'head': 'Head/Head 02 - Masculine',
        'cloth': 'Clothing/Masculine, Thin',
    },
    'Feminine': {
        'body': 'Body/Body 01 - Feminine, Thin/Ivory',
        'head': 'Head/Head 01 - Feminine',
        'cloth': 'Clothing/Feminine, Thin',
    },
}
EYES = 'Head/Head Overlay - Eyes/Brown'

# ── palette ──
OUTLINE = (40, 26, 20, 255)
STEEL = (204, 208, 216, 255)
STEEL_DIM = (150, 154, 164, 255)
STEEL_OUT = (36, 38, 46, 255)
LEATHER = (104, 66, 38, 255)
LEATHER_DK = (64, 40, 24, 255)
LINEN = (200, 188, 152, 255)
LINEN_DK = (150, 136, 104, 255)
WOOD = (182, 132, 82, 255)
WOOD_DK = (126, 84, 50, 255)
WOOD_OUT = (54, 34, 22, 255)
SCAR = (156, 82, 78, 255)
SCAR_DK = (104, 46, 44, 255)
CLOTH = (86, 80, 96, 255)
CLOTH_DK = (52, 48, 62, 255)
COPPER = (188, 116, 54, 255)
COPPER_HI = (230, 168, 96, 255)
BURN = (150, 58, 40, 255)
BURN_HI = (206, 116, 76, 255)


def load(rel, anim):
    p = os.path.join(CH, rel, anim + '.png')
    return Image.open(p).convert('RGBA') if os.path.exists(p) else None


def lum(c):
    return (c[0] + c[1] + c[2]) / 3


def frame_pts(im, f, r):
    """Opaque pixels of frame (f, r) in frame coordinates → {(x, y): rgba}."""
    if im is None:
        return {}
    px = im.load()
    out = {}
    if (f + 1) * W > im.width or (r + 1) * W > im.height:
        return out
    for y in range(W):
        for x in range(W):
            p = px[f * W + x, r * W + y]
            if p[3] > 0:
                out[(x, y)] = p
    return out


def components(pts):
    seen = set()
    out = []
    for start in pts:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        comp = []
        while stack:
            a, b = stack.pop()
            comp.append((a, b))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (a + dx, b + dy)
                    if q in pts and q not in seen:
                        seen.add(q)
                        stack.append(q)
        out.append(comp)
    return out


def solid(pts, least=4):
    """Drop the stray specks some LPC sheets carry (the slash sheets keep bits of the
    blade's swoosh, near-black or white, on every layer)."""
    keep = set()
    for c in components(pts):
        ml = mean_lum(c, pts)
        if len(c) >= least and 25 < ml < 200:
            keep.update(c)
    return {p: pts[p] for p in keep}


def centroid(c):
    return (sum(p[0] for p in c) / len(c), sum(p[1] for p in c) / len(c))


def mean_lum(c, pts):
    return sum(lum(pts[p]) for p in c) / len(c)


def near(p, mask, d=1):
    x, y = p
    for dx in range(-d, d + 1):
        for dy in range(-d, d + 1):
            if (x + dx, y + dy) in mask:
                return True
    return False


class Frame:
    """One frame of every overlay sheet being drawn."""

    def __init__(self, sheets, f, r):
        self.sheets, self.f, self.r = sheets, f, r

    def put(self, layer, x, y, c):
        if 0 <= x < W and 0 <= y < W:
            self.sheets[layer].putpixel((self.f * W + x, self.r * W + y), c)

    def get(self, layer, x, y):
        if 0 <= x < W and 0 <= y < W:
            return self.sheets[layer].getpixel((self.f * W + x, self.r * W + y))
        return (0, 0, 0, 0)


# ── which hand / foot is which ─────────────────────────────

def hand_sides(gl_pts, d):
    """Split the gloves' pixels into the character's right and left hand: { 'R': set, 'L': set }."""
    sides = {'R': set(), 'L': set()}
    comps = [c for c in components(gl_pts)]
    if not comps:
        return sides
    if d in (UP, DOWN):
        for c in comps:
            cx = centroid(c)[0]
            viewer_left = cx < 31.5
            side = ('R' if viewer_left else 'L') if d == DOWN else ('L' if viewer_left else 'R')
            sides[side].update(c)
        return sides
    near_side, far_side = ('L', 'R') if d == LEFT else ('R', 'L')
    comps.sort(key=lambda c: -mean_lum(c, gl_pts))
    if len(comps) == 1:
        sides[near_side if mean_lum(comps[0], gl_pts) > 75 else far_side].update(comps[0])
        return sides
    big = [c for c in comps if len(c) >= 4]
    first = big[0] if big else comps[0]
    sides[near_side].update(first)
    for c in comps:
        if c is first:
            continue
        # (a stray pixel of the far hand, or the far hand itself)
        sides[far_side].update(c)
    return sides


def split_cols(mask):
    """A column dividing two feet: a gap in the mask, else the mean x."""
    xs = sorted({p[0] for p in mask})
    for a, b in zip(xs, xs[1:]):
        if b - a > 1:
            return (a + b) / 2
    return sum(p[0] for p in mask) / len(mask)


def foot_sides(shoe_pts, sock_pts, gl, d, prev_near_back):
    """Split the feet (shoes) and shins (socks) into the character's right and left:
    ({'R': shoes, 'L': shoes}, {'R': shins, 'L': shins}, near_back)."""
    feet = {'R': set(), 'L': set()}
    shins = {'R': set(), 'L': set()}
    allm = set(shoe_pts) | set(sock_pts)
    if not allm:
        return feet, shins, prev_near_back
    cut = split_cols(set(shoe_pts) or allm)
    if d in (UP, DOWN):
        for m, out in ((shoe_pts, feet), (sock_pts, shins)):
            for p in m:
                viewer_left = p[0] < cut
                side = ('R' if viewer_left else 'L') if d == DOWN else ('L' if viewer_left else 'R')
                out[side].add(p)
        return feet, shins, prev_near_back
    fwd = -1 if d == LEFT else 1
    near_side, far_side = ('L', 'R') if d == LEFT else ('R', 'L')
    # Which of the two (the forward foot, the back foot) is the near leg?
    near_back = prev_near_back
    sc = [c for c in components(shoe_pts) if len(c) >= 8]
    if len(sc) == 2:
        bright = max(sc, key=lambda c: mean_lum(c, shoe_pts))
        other = sc[0] if sc[1] is bright else sc[1]
        near_back = centroid(bright)[0] * fwd < centroid(other)[0] * fwd
    elif gl['near'] and gl['far']:
        # the arms swing against the legs: the near hand forward, the near leg back
        near_back = centroid(list(gl['near']))[0] * fwd > centroid(list(gl['far']))[0] * fwd
    for m, out in ((shoe_pts, feet), (sock_pts, shins)):
        for p in m:
            forward = (p[0] - cut) * fwd > 0
            is_near = (not forward) if near_back else forward
            out[near_side if is_near else far_side].add(p)
    return feet, shins, near_back


def _widen(mask, keep_out):
    """The mask and one pixel to each side (trouser and boot edges are wider than the sock or shoe)."""
    out = set(mask)
    for (x, y) in mask:
        for q in ((x - 1, y), (x + 1, y)):
            if q not in keep_out:
                out.add(q)
    return out


def cut_foot(foot, boot_pts, other_foot):
    """What comes off with a foot: the shoe, the boot round it, an edge pixel."""
    if not foot:
        return set()
    xs = [p[0] for p in foot]
    lo, hi = min(xs) - 1, max(xs) + 1
    top = min(p[1] for p in foot)
    boot = {p for p in boot_pts if lo <= p[0] <= hi and p[1] >= top - 1 and p not in other_foot}
    return _widen(foot | boot, other_foot)


def cut_leg(foot, shin, other):
    """What a wooden leg replaces: the foot and the shin's lower half (the LPC knee is high)."""
    if not foot:
        return set()
    top = min(p[1] for p in foot if p[1] >= max(q[1] for q in foot) - 7)
    low = {p for p in shin if p[1] >= top - 1}
    return _widen(foot | low, other)


def grow(mask, d):
    out = set(mask)
    for (x, y) in mask:
        for dx in range(-d, d + 1):
            for dy in range(-d, d + 1):
                out.add((x + dx, y + dy))
    return out


def clip_far(fr, layer, allowed, occluder):
    """Clear this frame's pixels of a layer that lie outside `allowed` and behind the body."""
    for y in range(W):
        for x in range(W):
            if fr.get(layer, x, y)[3] and (x, y) not in allowed and (x, y) in occluder:
                fr.put(layer, x, y, (0, 0, 0, 0))


# ── drawing ────────────────────────────────────────────────

def outline_around(fr, layer, core, colour):
    for (x, y) in list(core):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                q = (x + dx, y + dy)
                if q not in core and fr.get(layer, *q)[3] == 0:
                    fr.put(layer, q[0], q[1], colour)


def line_pts(a, b):
    (x0, y0), (x1, y1) = a, b
    n = int(max(abs(x1 - x0), abs(y1 - y0)))
    if n == 0:
        return [(int(round(x0)), int(round(y0)))]
    return [(int(round(x0 + (x1 - x0) * i / n)), int(round(y0 + (y1 - y0) * i / n))) for i in range(n + 1)]


def _armward(p, hand_c):
    """Is body pixel p on the arm's side of the hand (toward the shoulder), not the hip's?"""
    hx, hy = hand_c
    sx, sy = (31.5 + (6 if hx >= 31.5 else -6), 36)
    vx, vy = sx - hx, sy - hy
    n = (vx * vx + vy * vy) ** 0.5 or 1
    px, py = p[0] - hx, p[1] - hy
    m = (px * px + py * py) ** 0.5 or 1
    return (px * vx + py * vy) / (n * m) > 0.45


def wrist_of(hand, body_pts):
    """The arm's pixels touching the hand, on the shoulder's side: [(x, y)], or None."""
    hc = centroid(list(hand))
    ring = [p for p in body_pts if p not in hand and near(p, hand, 1) and _armward(p, hc)]
    return ring or None


def draw_cuff(fr, layer, hand, body_pts, colour, dark):
    """A binding round the wrist: the arm's last two pixels before the hand."""
    ring = wrist_of(hand, body_pts)
    if not ring:
        return
    hc = centroid(list(hand))
    ring = set(ring)
    for p in body_pts:
        if p in hand or not (p in ring or (near(p, ring, 1) and near(p, hand, 2) and _armward(p, hc))):
            continue
        fr.put(layer, p[0], p[1], dark if lum(body_pts[p]) < 70 else colour)


def draw_stump_hand(fr, layer, hand, body_pts):
    """The arm ends two pixels past the wrist, bound in a rag and outlined round."""
    if not hand:
        return
    ring = wrist_of(hand, body_pts)
    if not ring:
        return
    wx, wy = centroid(ring)
    hx, hy = centroid(list(hand))
    dx, dy = hx - wx, hy - wy
    m = (dx * dx + dy * dy) ** 0.5 or 1
    dx, dy = dx / m, dy / m
    nx, ny = -dy, dx
    bs = [(p[0] - wx) * nx + (p[1] - wy) * ny for p in ring]
    bc, half = (max(bs) + min(bs)) / 2, (max(bs) - min(bs)) / 2
    stub = set()
    for p in hand:
        a = (p[0] - wx) * dx + (p[1] - wy) * dy
        b = (p[0] - wx) * nx + (p[1] - wy) * ny - bc
        if 0 < a <= 2.6 and abs(b) <= max(1.0, half - 0.5):
            stub.add(p)
    for p in stub:
        a = (p[0] - wx) * dx + (p[1] - wy) * dy
        fr.put(layer, p[0], p[1], LINEN if a < 1.8 else LINEN_DK)
    around = hand | {q for q in ring}
    for p in stub:
        for ex in (-1, 0, 1):
            for ey in (-1, 0, 1):
                q = (p[0] + ex, p[1] + ey)
                if q in stub or q in ring:
                    continue
                if q in hand or q not in body_pts:
                    fr.put(layer, q[0], q[1], OUTLINE)
    del around


def snap(dx, dy):
    import math
    if dx == 0 and dy == 0:
        return (0, 1)
    a = math.atan2(dy, dx)
    k = round(a / (math.pi / 4)) % 8
    return [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)][k]


def draw_hook(fr, layer, hand, body_pts, dim=False):
    if not hand:
        return
    ring = wrist_of(hand, body_pts)
    draw_cuff(fr, layer, hand, body_pts, LEATHER, LEATHER_DK)
    if not ring:
        return
    wx, wy = centroid(ring)
    hx, hy = centroid(list(hand))
    d = snap(hx - wx, hy - wy)
    # the hook curls away from the body's middle
    side = 1 if hx >= 31.5 else -1
    n = (-d[1], d[0])
    if n[0] * side < 0 or (n[0] == 0 and n[1] < 0):
        n = (-n[0], -n[1])
    ax, ay = int(round(wx + d[0])), int(round(wy + d[1]))
    shape = [(1, 0), (2, 0), (3, 0), (4, 1), (3, 2), (2, 2)]
    core = set()
    pts = [(ax, ay)] + [(ax + d[0] * a + n[0] * b, ay + d[1] * a + n[1] * b) for a, b in shape]
    for a, b in zip(pts, pts[1:]):
        core.update(line_pts(a, b))
    col = STEEL_DIM if dim else STEEL
    for (x, y) in core:
        fr.put(layer, x, y, col)
    outline_around(fr, layer, core, STEEL_OUT)


def draw_stump_foot(fr, layer, foot, body_pts, light=LINEN, dark=LINEN_DK, edge=OUTLINE):
    """The leg ends at the ankle, bound in a rag: two rows of wrap, outlined round."""
    if not foot:
        return
    top = min(p[1] for p in foot)
    cols = sorted({x for (x, y) in foot if (x, top - 1) in body_pts})
    if len(cols) < 2:
        cols = sorted({x for (x, y) in foot if y == top})
    if not cols:
        return
    lo, hi = cols[0] + 1, cols[-1] - 1
    if hi < lo:
        lo, hi = cols[0], cols[-1]
    for x in range(lo, hi + 1):
        fr.put(layer, x, top, light)
        fr.put(layer, x, top + 1, dark)
        fr.put(layer, x, top + 2, edge)
    for y in (top, top + 1):
        fr.put(layer, lo - 1, y, edge)
        fr.put(layer, hi + 1, y, edge)


def draw_peg(fr, layer, leg, foot, body_pts, ground, d):
    """A peg of ash from below the knee to the ground, strapped on."""
    if not leg:
        return
    top = min(p[1] for p in leg)
    top_xs = [p[0] for p in leg if p[1] <= top + 1]
    xt = sum(top_xs) / len(top_xs)
    # the ankle: the shin's lowest pixels (or the leg's top again)
    shin = [p for p in leg if p not in foot]
    if shin and d in (LEFT, RIGHT):
        lo = max(p[1] for p in shin)
        xs = [p[0] for p in shin if p[1] >= lo - 1]
        xb = sum(xs) / len(xs)
    else:
        xb = xt
    xb = max(xt - 2, min(xt + 2, xb))
    # (down / up: two pixels wide; side-on one and a half)
    wide = 2 if d in (UP, DOWN) else 1
    core = set()
    for y in range(top, ground + 1):
        t = (y - top) / max(1, ground - top)
        cx = xt + (xb - xt) * t
        x0 = int(round(cx - wide / 2))
        w = wide if y < ground - 1 else 1
        for x in range(x0, x0 + w):
            core.add((x, y))
    for (x, y) in core:
        fr.put(layer, x, y, WOOD if (x, y) == min(((a, b) for (a, b) in core if b == y)) else WOOD_DK)
    outline_around(fr, layer, core, WOOD_OUT)
    # the strap: the row above the cut, across the leg
    lo_x = min(p[0] for p in leg if p[1] <= top + 1) - 1
    hi_x = max(p[0] for p in leg if p[1] <= top + 1) + 1
    for (x, y) in body_pts:
        if y == top - 1 and lo_x <= x <= hi_x and (x, y) not in leg:
            fr.put(layer, x, y, LEATHER_DK if lum(body_pts[(x, y)]) < 70 else LEATHER)


def draw_crutch(fr, layer, hand, ground, d):
    if not hand:
        return
    hx, hy = centroid(list(hand))
    if d in (UP, DOWN):
        x = min(p[0] for p in hand) - 1 if hx < 31.5 else max(p[0] for p in hand) + 1
        top, bot = (int(round(hx)), int(hy) - 10), (x, ground)
    else:
        fwd = -1 if d == LEFT else 1
        x = int(round(hx))
        top, bot = (x - fwd, int(hy) - 10), (x + fwd, ground)
    core = set(line_pts(top, bot))
    tx, ty = top
    for k in range(-1, 2):
        core.add((tx + k, ty))
    # the grip, where the hand closes on it
    gy = int(round(hy))
    for (x, y) in list(core):
        fr.put(layer, x, y, WOOD_DK if y == gy else WOOD)
    outline_around(fr, layer, core, WOOD_OUT)


# ── the face ────────────────────────────────────────────────

def eye_sides(eye_pts, d):
    comps = components(eye_pts)
    out = {'R': set(), 'L': set()}
    for c in comps:
        cx = centroid(c)[0]
        if d == DOWN:
            out['R' if cx < 31.5 else 'L'].update(c)
        elif d == LEFT:
            out['L'].update(c)
        elif d == RIGHT:
            out['R'].update(c)
    return out


def draw_scar_eye(fr, layer, eye, head_pts):
    if not eye:
        return
    ys = [p[1] for p in eye]
    y0, y1 = min(ys), max(ys)
    for (x, y) in eye:
        fr.put(layer, x, y, SCAR_DK if y == y0 else SCAR)
    cx = int(round(centroid(list(eye))[0]))
    for y in range(y0 - 2, y1 + 3):
        if (cx, y) in head_pts:
            fr.put(layer, cx, y, SCAR_DK)


def draw_blindfold(fr, layer, ey0, head_pts, d):
    rows = [ey0, ey0 + 1, ey0 + 2]
    for (x, y) in head_pts:
        if y in rows:
            edge = not all((x + dx, y) in head_pts for dx in (-1, 1))
            fr.put(layer, x, y, CLOTH_DK if (y != ey0 + 1 or edge) else CLOTH)
    if d == UP:
        # the knot at the back, its two ends hanging
        xs = [x for (x, y) in head_pts if y == ey0 + 1]
        if xs:
            cx = int(round(sum(xs) / len(xs)))
            for (x, y, c) in ((cx, ey0 + 1, CLOTH_DK), (cx - 1, ey0 + 3, CLOTH), (cx, ey0 + 4, CLOTH),
                              (cx + 1, ey0 + 3, CLOTH), (cx + 1, ey0 + 4, CLOTH_DK)):
                fr.put(layer, x, y, c)


def head_rows(head_pts, y):
    return sorted(x for (x, yy) in head_pts if yy == y)


def draw_ear(fr, layer, side, ey0, head_pts, d):
    """A notch of scar at the ear's top (seen front-on or from behind)."""
    if d not in (UP, DOWN):
        return
    viewer_left = (side == 'R') if d == DOWN else (side == 'L')
    for y in (ey0 - 1, ey0):
        xs = head_rows(head_pts, y)
        if not xs:
            continue
        x = xs[0] if viewer_left else xs[-1]
        fr.put(layer, x, y, SCAR_DK if y == ey0 - 1 else SCAR)
        fr.put(layer, x + (1 if viewer_left else -1), y - 1 if y == ey0 - 1 else y, SCAR_DK)


def nose_spot(eyes_all, head_pts, d, ey1):
    if d == DOWN:
        if not eyes_all:
            return None
        xs = [p[0] for p in eyes_all]
        cx = (min(xs) + max(xs)) / 2
        return [(int(cx), ey1 + 1), (int(cx) + 1, ey1 + 1), (int(cx), ey1 + 2), (int(cx) + 1, ey1 + 2)]
    if d in (LEFT, RIGHT):
        out = []
        for y in (ey1 + 1, ey1 + 2):
            xs = head_rows(head_pts, y)
            if xs:
                tip = xs[0] if d == LEFT else xs[-1]
                out.append((tip, y))
                out.append((tip + (1 if d == LEFT else -1), y))
        return out
    return None


def draw_slit_nose(fr, layer, spot, d):
    if not spot:
        return
    if d == DOWN:
        x = spot[0][0]
        for y in (spot[0][1], spot[2][1]):
            fr.put(layer, x + 1, y, SCAR_DK)
        fr.put(layer, x + 1, spot[2][1] + 1, SCAR)
    else:
        for i, (x, y) in enumerate(spot):
            fr.put(layer, x, y, SCAR_DK if i % 2 == 0 else SCAR)


def draw_copper_nose(fr, layer, spot, d):
    if not spot:
        return
    for i, (x, y) in enumerate(spot):
        fr.put(layer, x, y, COPPER_HI if i == 0 else COPPER)


def draw_brand(fr, layer, eye, head_pts):
    """A burned mark on the cheek below the eye: a raw ring, angry red at its heart."""
    if not eye:
        return
    cx = int(round(centroid(list(eye))[0])) - 1
    y0 = max(p[1] for p in eye) + 1
    for (x, y, c) in ((cx, y0, BURN), (cx - 1, y0 + 1, BURN), (cx, y0 + 1, BURN_HI), (cx + 1, y0 + 1, BURN),
                      (cx, y0 + 2, BURN), (cx - 1, y0, SCAR_DK), (cx + 1, y0 + 2, SCAR_DK)):
        if (x, y) in head_pts:
            fr.put(layer, x, y, c)


# ── the sheets ─────────────────────────────────────────────

LAYERS = [
    'Erase - Right Hand', 'Erase - Left Hand', 'Stump - Right Hand', 'Stump - Left Hand',
    'Hook - Right Hand', 'Hook - Left Hand',
    'Erase - Right Foot', 'Erase - Left Foot', 'Stump - Right Foot', 'Stump - Left Foot',
    'Erase - Right Leg', 'Erase - Left Leg', 'Peg - Right Leg', 'Peg - Left Leg',
    'Crutch - Right', 'Crutch - Left',
    'Scar - Left Eye', 'Blindfold', 'Crop - Right Ear', 'Crop - Left Ear',
    'Slit Nose', 'Copper Nose', 'Brand - Right Cheek',
]

MASK = (255, 255, 255, 255)


def make(build, cfg, anim):
    body = load(cfg['body'], anim)
    if body is None:
        return 0
    gloves = load(cfg['cloth'] + '/Hands/Gloves/Tan', anim)
    shoes = load(cfg['cloth'] + '/Feet/Shoes 01 - Shoes', anim)
    boots = load(cfg['cloth'] + '/Feet/Shoes 02 - Boots', anim)
    socks = load(cfg['cloth'] + '/Feet/Socks 02 - High Socks', anim)
    head = load(cfg['head'], anim)
    eyes = load(EYES, anim)
    down_eyes = eyes
    seated = anim == 'Sitting'
    cols, rows = body.width // W, body.height // W
    sheets = {name: Image.new('RGBA', (cols * W, rows * W), (0, 0, 0, 0)) for name in LAYERS}
    for r in range(rows):
        d = UP if rows == 1 else r
        near_back = True
        # (twice round the cycle, so the first frames inherit the last ones' reckoning)
        for pass_ in (0, 1):
            for f in range(cols):
                fr = Frame(sheets, f, r)
                body_pts = solid(frame_pts(body, f, r), 1)
                gl_pts = solid(frame_pts(gloves, f, r), 1)
                shoe_pts = solid(frame_pts(shoes, f, r), 10)
                boot_pts = solid(frame_pts(boots, f, r), 10)
                sock_pts = solid(frame_pts(socks, f, r), 4)
                hands = hand_sides(gl_pts, d)
                near_side = 'L' if d == LEFT else 'R'
                gl = {'near': hands[near_side] if d in (LEFT, RIGHT) else None,
                      'far': hands['R' if near_side == 'L' else 'L'] if d in (LEFT, RIGHT) else None}
                feet, shins, near_back = foot_sides(shoe_pts, sock_pts, gl, d, near_back)
                if pass_ == 0:
                    continue
                ground = max((p[1] for p in shoe_pts), default=61)
                for side, word in (('R', 'Right'), ('L', 'Left')):
                    hand = hands[side]
                    far = d in (LEFT, RIGHT) and side != near_side
                    for p in hand:
                        fr.put(f'Erase - {word} Hand', p[0], p[1], MASK)
                    draw_stump_hand(fr, f'Stump - {word} Hand', hand, body_pts)
                    draw_hook(fr, f'Hook - {word} Hand', hand, body_pts, dim=far)
                    other = 'L' if side == 'R' else 'R'
                    foot = cut_foot(feet[side], boot_pts, feet[other])
                    # (seated, the legs splay: a peg drawn to the ground would stand like a chair's leg,
                    # so the seated peg is its end only, the foot's place capped in wood)
                    leg = foot if seated else cut_leg(foot, shins[side], feet[other] | shins[other])
                    for p in foot:
                        fr.put(f'Erase - {word} Foot', p[0], p[1], MASK)
                    for p in leg:
                        fr.put(f'Erase - {word} Leg', p[0], p[1], MASK)
                    draw_stump_foot(fr, f'Stump - {word} Foot', foot, body_pts)
                    if seated:
                        draw_stump_foot(fr, f'Peg - {word} Leg', foot, body_pts, WOOD, WOOD_DK, WOOD_OUT)
                    else:
                        draw_peg(fr, f'Peg - {word} Leg', leg, foot, body_pts, ground, d)
                    if far:
                        # Side-on, the far limb is behind the body: what was drawn past the limb's
                        # own place is kept only where the body doesn't stand in front of it
                        occ = grow(set(body_pts), 1)
                        clip_far(fr, f'Stump - {word} Hand', grow(hand, 2), occ)
                        clip_far(fr, f'Hook - {word} Hand', grow(hand, 2), occ)
                        clip_far(fr, f'Stump - {word} Foot', grow(foot, 1), occ)
                        clip_far(fr, f'Peg - {word} Leg', grow(leg, 1), occ)
                    # the crutch: in that hand front-on or from behind; side-on, in the near hand
                    # (laid by when seated or climbing)
                    held = hand if d in (UP, DOWN) else hands[near_side]
                    if anim not in ('Sitting', 'Climb'):
                        draw_crutch(fr, f'Crutch - {word}', held, ground, d)
                # the face
                head_pts = frame_pts(head, f, r)
                eye_pts = frame_pts(eyes, f, r)
                es = eye_sides(eye_pts, d)
                ref = eye_pts or frame_pts(down_eyes, f, DOWN if rows > DOWN else 0)
                if not ref or not head_pts:
                    continue
                ey0 = min(p[1] for p in ref)
                ey1 = max(p[1] for p in ref)
                draw_scar_eye(fr, 'Scar - Left Eye', es['L'], head_pts)
                draw_blindfold(fr, 'Blindfold', ey0, head_pts, d)
                draw_ear(fr, 'Crop - Right Ear', 'R', ey0, head_pts, d)
                draw_ear(fr, 'Crop - Left Ear', 'L', ey0, head_pts, d)
                spot = nose_spot(eye_pts, head_pts, d, ey1) if eye_pts else None
                draw_slit_nose(fr, 'Slit Nose', spot, d)
                draw_copper_nose(fr, 'Copper Nose', spot, d)
                draw_brand(fr, 'Brand - Right Cheek', es['R'], head_pts)
    n = 0
    for name, im in sheets.items():
        # (an empty sheet is written too — the crutch laid by when seated, no face on the climb —
        # so the game's loader finds every sheet a layer names instead of asking for a missing file)
        p = os.path.join(OUT, name, build)
        os.makedirs(p, exist_ok=True)
        im.save(os.path.join(p, anim + '.png'), optimize=True)
        n += 1
    return n


def main():
    total = 0
    for build, cfg in BUILDS.items():
        for anim in ANIMS:
            total += make(build, cfg, anim)
    print(f'{total} sheets written to {OUT}')


if __name__ == '__main__':
    main()
