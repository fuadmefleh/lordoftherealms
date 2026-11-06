# Tilled-soil autotile: soil laid over the ground with ragged, rounded edges,
# for the player's tilled ground (ui/innerMapDigging.js drawTilled) and the
# towns' ploughed fields (world/townProps.js). Written from the furrowed soil
# (tilled.png / tilled_wet.png, make_furrows.py), so the furrows run on
# straight across every cell.
#
# Layout (128px cells, 4 across):
#   rows 0-3  the 16 cells by which of the four sides carry on into tilled
#             ground: index = T*1 + R*2 + B*4 + L*8, at (index % 4, index >> 2)
#   row 4     inside corners: soil all round but one diagonal, a grass notch
#             in that corner: TL, TR, BL, BR
#   row 5     plain soil (cols 0-2)
#
# Every edge follows one ragged line per side (top, bottom, left, right), each
# a function of the position along it that repeats every tile: two cells side
# by side along an edge meet exactly, and a corner or a notch is made of the
# same lines, so it meets the cells round it too.
import math
import numpy as np
from PIL import Image

N = 128
SS = 4                      # supersampling for smooth edges
M = 0.12 * N                # the soil comes to within this of the tile's side
A = 0.16 * N               # how ragged the edge is
RC = 0.30 * N              # an outer corner's rounding
RN = 0.08 * N               # an inside corner's rounding
RIM = 0.035 * N             # a darker rim inside the edge


def line(t, a, b, c):
    """A ragged edge offset at position t along a side (repeats every N)."""
    w = 0.45 * math.sin(2 * math.pi * t / N + a) + 0.38 * math.sin(2 * math.pi * 2 * t / N + b) \
        + 0.17 * math.sin(2 * math.pi * 5 * t / N + c)
    return M + A * (0.5 + 0.5 * w)


def lines():
    eT = np.vectorize(lambda t: line(t, 0.3, 1.9, 4.1))
    eB = np.vectorize(lambda t: line(t, 2.2, 0.7, 2.9))
    eL = np.vectorize(lambda t: line(t, 1.1, 3.0, 0.5))
    eR = np.vectorize(lambda t: line(t, 4.0, 2.4, 1.6))
    return eT, eB, eL, eR


def mask(T, R, B, L, notch=None):
    """The soil's depth inside its edge (px; >0 soil) at SS x resolution, for one cell."""
    n = N * SS
    u = (np.arange(n)[None, :] + 0.5) / SS
    v = (np.arange(n)[:, None] + 0.5) / SS
    U = np.broadcast_to(u, (n, n)); V = np.broadcast_to(v, (n, n))
    eT, eB, eL, eR = lines()
    big = 1e3
    dT = V - eT(U) if not T else np.full((n, n), big)
    dB = (N - V) - eB(U) if not B else np.full((n, n), big)
    dL = U - eL(V) if not L else np.full((n, n), big)
    dR = (N - U) - eR(V) if not R else np.full((n, n), big)
    d = np.minimum(np.minimum(dT, dB), np.minimum(dL, dR))
    # round the outer corners where two edges meet
    for da, db in ((dT, dL), (dT, dR), (dB, dL), (dB, dR)):
        if da is not None and (da < big).any() and (db < big).any():
            near = (da < RC) & (db < RC)
            r = RC - np.sqrt(np.clip(RC - da, 0, None) ** 2 + np.clip(RC - db, 0, None) ** 2)
            d = np.where(near, np.minimum(d, r), d)
    if notch:
        # the grass notch in one corner: where both that corner's lines would have edged the soil
        sides = {'TL': (V - eT(U), U - eL(V)), 'TR': (V - eT(U), (N - U) - eR(V)),
                 'BL': ((N - V) - eB(U), U - eL(V)), 'BR': ((N - V) - eB(U), (N - U) - eR(V))}
        p, q = sides[notch]
        # p, q < 0: in the notch. Depth into the soil: the larger of the two, with the notch's corner rounded
        inside = np.maximum(p, q)
        # the notch's tip (where both lines turn) rounded off: a circle of radius RN inside the grass
        # (a fillet: near the tip the grass reaches round in a curve of radius RN, not a square step)
        # (the grass pocket's tip rounded: within RN of the corner, the distance to a circle centred RN
        #  back inside the pocket; continuous with the straight edges at p = -RN and q = -RN)
        tip = (p > -RN) & (q > -RN)
        rr = np.sqrt((RN + p) ** 2 + (RN + q) ** 2) - RN
        inside = np.where(tip, rr, inside)
        d = np.minimum(d, inside)
    return d


def cell(tex, d):
    n = N * SS
    a = np.clip(d * SS / SS + 0.5, 0, 1)                          # anti-aliased at SS
    a_img = Image.fromarray((a * 255).astype(np.uint8)).resize((N, N), Image.BOX)
    depth = Image.fromarray(np.clip(d, 0, 255).astype(np.float32)).resize((N, N), Image.BOX)
    dep = np.asarray(depth, np.float32)
    shade = 1 - 0.22 * np.clip(1 - dep / RIM, 0, 1)               # darker just inside the edge
    rgb = np.clip(tex * shade[..., None], 0, 255)
    return np.concatenate([rgb, np.asarray(a_img, np.float32)[..., None]], axis=2)


def build(texfile, out):
    tex = np.asarray(Image.open(texfile).convert('RGB').resize((N, N), Image.LANCZOS), np.float32)
    sheet = np.zeros((6 * N, 4 * N, 4), np.float32)
    for idx in range(16):
        T, R, B, L = bool(idx & 1), bool(idx & 2), bool(idx & 4), bool(idx & 8)
        c, r = idx % 4, idx >> 2
        sheet[r * N:(r + 1) * N, c * N:(c + 1) * N] = cell(tex, mask(T, R, B, L))
    for i, k in enumerate(['TL', 'TR', 'BL', 'BR']):
        sheet[4 * N:5 * N, i * N:(i + 1) * N] = cell(tex, mask(True, True, True, True, notch=k))
    full = np.concatenate([tex, np.full((N, N, 1), 255, np.float32)], axis=2)
    for i in range(3):
        sheet[5 * N:6 * N, i * N:(i + 1) * N] = full
    Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8), 'RGBA').save(out)
    print('wrote', out)


build('tilled.png', 'out_tilled_autotile.png')
build('tilled_wet.png', 'out_tilled_autotile_wet.png')
