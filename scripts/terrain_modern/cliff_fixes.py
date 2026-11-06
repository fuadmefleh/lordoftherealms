# Mend the LPC cliff art where cliffs.js puts pieces side by side that the
# LPC sheet never drew together. build_cliff.py runs this on every season's
# sheet before it smooths and upscales, as a pure pixel REMAP (each mended
# pixel copies another pixel of the same sheet), worked out on the spring
# sheet and applied alike to all, so materials and seasonal colours agree.
#
# 1. The angled front (cells (0..1, 6..8) and their mirror (3..4, 6..8)):
#    - its outer foot (0,8) is a spike of rock cut off straight at the cell's
#      right edge, with a wedge of grass beside it in (1,8): the wedge is
#      filled with rock, so the face comes down to one flat foot whose bottom
#      edge is the straight front's (2,8);
#    - its rock is redrawn from the straight front's own strata (2,7)/(2,8),
#      bent to run along the rim above and the foot below, so the bands run
#      on unbroken from piece to piece and round into the straight front.
# 2. The sides of a crag's top (TOP.l / tl / bl and their mirrors): the LPC
#    side rim is a one-pixel line of sideways tufts that smooths into a spiky
#    dark fringe; it is replaced by the top rim (2,5) turned on its side, so
#    the sides read like the top edge, mitred at the corners.
import numpy as np
from scipy import ndimage

C = 32
ROCK = {(107, 60, 46), (96, 52, 41), (127, 76, 49), (68, 39, 37), (46, 31, 28), (174, 107, 63)}
FOOTB = 7    # rows of the foot's shading, anchored to the face's bottom
WB = 10      # width of a side rim (rows of the top rim turned on its side)


def _rock_mask(spr):
    rgb = spr[..., :3].astype(np.int32)
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    keys = np.array([(r << 16) | (g << 8) | b for r, g, b in ROCK])
    return np.isin(key, keys) & (spr[..., 3] == 255)


def _angled_side(spr, rock, flip):
    """Remap for one side of the angled front: a list of (dst, src) sheet coords."""
    y0 = 6 * C

    # The side's frame: X 0..95 over its outer column, inner column, straight front;
    # Y 0..95 over rows 6..8 (the right side is mirrored into the same frame)
    def sx(X):
        return 5 * C - 1 - X if flip else X

    def at(Y, X):
        return y0 + Y, sx(X)

    R = np.array([[rock[at(Y, X)] for X in range(3 * C)] for Y in range(3 * C)])
    # The straight front's rock in each of its columns: top (rim) and bottom (foot)
    a = np.array([np.argmax(R[:, 2 * C + x]) for x in range(C)])
    b = np.array([3 * C - 1 - np.argmax(R[::-1, 2 * C + x]) for x in range(C)])
    # The outer edge of the foot (the spike's left side), as a line
    ys, xs_ = [], []
    for Y in range(2 * C, 3 * C - 6):
        row = np.nonzero(R[Y, :C])[0]
        if len(row):
            ys.append(Y)
            xs_.append(row[0])
    k, m = np.polyfit(ys, xs_, 1)

    def xo(Y):
        return k * Y + m

    # The new face: its rock, the grass wedge beside the spike filled, and the
    # straight front's foot carried along under it
    face = R[:, :2 * C].copy()
    band = np.zeros_like(face)
    for Y in range(2 * C, 3 * C):
        for X in range(2 * C):
            if X <= xo(Y) + 1:
                continue
            if Y <= b[X % C]:
                face[Y, X] = True
            else:
                band[Y, X] = True
                face[Y, X] = False
    # Rim and foot of the face, column by column, as offsets from the straight front's
    yr = np.array([np.argmax(face[:, X]) for X in range(2 * C)], np.float32)
    yb = np.array([3 * C - 1 - np.argmax(face[::-1, X]) for X in range(2 * C)], np.float32)
    A, B = float(np.median(a)), float(np.median(b))     # (its rim's tufts make a ragged)
    off_t = np.concatenate([yr - A, np.zeros(C)])
    off_b = np.concatenate([yb - B, np.zeros(C)])
    off_t = ndimage.gaussian_filter1d(ndimage.median_filter(off_t, 7, mode="nearest"), 4, mode="nearest")
    off_b = ndimage.gaussian_filter1d(ndimage.median_filter(off_b, 7, mode="nearest"), 4, mode="nearest")
    ramp = np.clip((2 * C - np.arange(3 * C)) / 4.0, 0, 1)   # into the straight front: no offset
    off_t, off_b = off_t * ramp, off_b * ramp
    # (bands keep their thickness across the slope, not up and down it)
    cos_t = 1 / np.sqrt(1 + np.gradient(off_t) ** 2)
    cos_b = 1 / np.sqrt(1 + np.gradient(off_b) ** 2)

    pairs = []
    for Y in range(3 * C):
        for X in range(2 * C):
            x = X % C
            if band[Y, X]:
                pairs.append((at(Y, X), at(Y, 2 * C + x)))
                continue
            if not face[Y, X]:
                continue
            if B + off_b[X] - Y < FOOTB:
                v = B - (B + off_b[X] - Y) * cos_b[X]
            else:
                v = A + (Y - A - off_t[X]) * cos_t[X]
                lo, hi = A + 3, B - FOOTB
                if v >= hi:
                    v = lo + (v - lo) % (hi - lo)
            v = int(round(min(max(v, a[x]), b[x])))
            pairs.append((at(Y, X), at(v, 2 * C + x)))
    return pairs, off_t


def _side_rims():
    """Remap: the sides of a crag's top become its top rim (2,5) turned on its side."""
    S = (5 * C, 2 * C)       # (2,5), the top rim

    def s(col, row):        # a pixel of the top rim: its column along the edge, row in from it
        return S[0] + row, S[1] + col % C

    pairs = []

    def put(cell, x, y, src):
        c, r = cell
        pairs.append(((r * C + y, c * C + x), src))

    for y in range(C):
        for x in range(C):
            xr = C - 1 - x                       # in from the right edge
            # left side: TOP.l (0,5); TOP.tl (5,6) below its mitre; TOP.bl (5,7) above its mitre
            if x < WB:
                put((0, 5), x, y, s(y, x))
                if x < y:
                    put((5, 6), x, y, s(y, x))
                if x < C - 1 - y:
                    put((5, 7), x, y, s(y, x))
            if y < WB and y <= x:
                put((5, 6), x, y, s(x, y))
            # right side, mirrored (the rim's columns run the other way up it)
            if xr < WB:
                put((4, 5), x, y, s(C - 1 - y, xr))
                if xr < y:
                    put((6, 6), x, y, s(C - 1 - y, xr))
                if x > y:
                    put((6, 7), x, y, s(C - 1 - y, xr))
            if y < WB and y <= xr:
                put((6, 6), x, y, s(x, y))
    return pairs


def remap(spr, K):
    """All the mends for a sheet, worked out on the spring sheet: ([(dst, src)], shear)
    where shear {(c, r): per output column, rows to shift the rock's grain by} lays
    the painted rock's ledges along the bent strata of the angled front's sides."""
    rock = _rock_mask(spr)
    left, off_l = _angled_side(spr, rock, False)
    right, off_r = _angled_side(spr, rock, True)
    shear = {}
    xo = (np.arange(C * K) + 0.5) / K - 0.5
    for r in (6, 7, 8):
        for c in (0, 1):
            shear[(c, r)] = np.interp(c * C + xo, np.arange(3 * C), off_l) * K
        for c in (3, 4):
            shear[(c, r)] = np.interp(5 * C - 1 - (c * C + xo), np.arange(3 * C), off_r) * K
    return left + right + _side_rims(), shear


def apply(arr, pairs):
    """Apply a remap to a sheet (any season): every pixel read from the unmended sheet."""
    out = arr.copy()
    d = np.array([p[0] for p in pairs])
    s = np.array([p[1] for p in pairs])
    out[d[:, 0], d[:, 1]] = arr[s[:, 0], s[:, 1]]
    return out
