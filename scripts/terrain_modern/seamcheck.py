# Every pair of cells that can meet (their LPC borders are pixel-identical and
# not empty): how well do the new pieces meet across that border, against the
# ordinary step between neighbouring pixels inside a cell?
import sys
import numpy as np
from PIL import Image

lpc = np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(np.int32)
new = np.asarray(Image.open(sys.argv[2]).convert('RGBA')).astype(np.float32)
K = new.shape[1] // lpc.shape[1]
C, T = 32, 32 * K
rows, cols = lpc.shape[0] // C, lpc.shape[1] // C
cell = lambda a, cy, cx, s: a[cy*s:(cy+1)*s, cx*s:(cx+1)*s]

def premul(a):
    return a[..., :3] * (a[..., 3:4] / 255.0)

cells = [(cy, cx) for cy in range(rows) for cx in range(cols) if cell(lpc, cy, cx, C)[..., 3].any()]
res = {'h': [], 'v': []}
worst = []
for (ay, ax) in cells:
    A = cell(lpc, ay, ax, C)
    for (by, bx) in cells:
        B = cell(lpc, by, bx, C)
        for kind, ea, eb, na, nb in (
            ('h', A[:, -1], B[:, 0], lambda a: a[:, -1], lambda b: b[:, 0]),
            ('v', A[-1, :], B[0, :], lambda a: a[-1, :], lambda b: b[0, :]),
        ):
            if not np.array_equal(ea, eb) or not ea[:, 3].any():
                continue
            # skip plain uniform borders (fill against fill): they always meet
            if len({tuple(p) for p in ea}) == 1:
                continue
            NA = premul(cell(new, ay, ax, T)); NB = premul(cell(new, by, bx, T))
            d = np.abs(na(NA) - nb(NB)).sum(-1).mean()
            res[kind].append(d)
            worst.append((round(float(d), 1), kind, (ay, ax), (by, bx)))
# ordinary neighbour step inside cells (premultiplied)
P = premul(new)
inner_h = np.abs(P[:, 1:] - P[:, :-1]).sum(-1)
inner_v = np.abs(P[1:] - P[:-1]).sum(-1)
mask = new[..., 3] > 250
print('pairs h/v:', len(res['h']), len(res['v']))
print('seam mean h/v: %.1f / %.1f' % (np.mean(res['h']), np.mean(res['v'])))
print('inner step h/v: %.1f / %.1f' % (inner_h[mask[:, 1:]].mean(), inner_v[mask[1:]].mean()))
worst.sort(reverse=True)
print('worst:', worst[:12])
