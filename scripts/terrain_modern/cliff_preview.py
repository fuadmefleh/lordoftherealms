# Compose test scenes of crags as cliffs.js lays them, over the painted ground,
# from a cliff sheet and its season's terrain sheet; and check the seams.
#
#   python cliff_preview.py <cliff.png> <terrain.png> <out_prefix> [px_per_tile]
#
# Writes <out_prefix>_scene.png (whole scene at px_per_tile, default 38) and
# <out_prefix>_zoom.png (a part at twice that), and prints how well every pair
# of cells cliffs.js puts side by side meets, against the step between
# neighbouring pixels inside a cell.
import os
import sys
import random
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cliff_layout import CONFIG, crag, stand_square, stand_angled, adjacency  # noqa: E402

cliff = Image.open(sys.argv[1]).convert('RGBA')
terr = Image.open(sys.argv[2]).convert('RGBA')
prefix = sys.argv[3]
PX = int(sys.argv[4]) if len(sys.argv) > 4 else 38
k = cliff.width // 512
kt = terr.width // 512
T = 32 * k
GRASS = [(1, 1), (3, 2), (4, 2), (5, 2)]   # data/spritesheets/terrain.json fills.grass


def cell(img, c, r, kk):
    return img.crop((c * 32 * kk, r * 32 * kk, (c + 1) * 32 * kk, (r + 1) * 32 * kk))


# A scene: a mountain crag with a second step, an angled crag, a wide angled one
# with an angled step, two small hills crags, a square tall one
grid = {}
stand_square(grid, 2, 2, 10, 7, 3)
stand_square(grid, 5, 3, 5, 2, 2)
stand_angled(grid, 15, 2, 7, 3)
stand_angled(grid, 24, 2, 11, 5)
stand_angled(grid, 27, 3, 5, 1)
stand_square(grid, 2, 15, 4, 2, 2)
stand_angled(grid, 9, 15, 5, 1)
stand_square(grid, 17, 14, 3, 3, 4)
rng = random.Random(7)
crag(grid, 24, 14, CONFIG['mountain'], rng)
W, H = 38, 26
canvas = Image.new('RGBA', (W * T, H * T))
for r in range(H):
    for q in range(W):
        g = GRASS[((q * 83492791) ^ (r * 29765729)) % len(GRASS)]
        canvas.paste(cell(terr, *g, kt).resize((T, T), Image.LANCZOS), (q * T, r * T))
for (q, r), c in grid.items():
    if c is not None and q < W and r < H:
        canvas.alpha_composite(cell(cliff, *c, k), (q * T, r * T))
scene = canvas.resize((W * PX, H * PX), Image.LANCZOS)
scene.save(prefix + '_scene.png')
z = canvas.crop((0, 0, 22 * T, 12 * T)).resize((22 * PX * 2, 12 * PX * 2), Image.LANCZOS)
z.save(prefix + '_zoom.png')

# Seams: every pair cliffs.js lays side by side
a = np.asarray(cliff).astype(np.float32)


def prem(x):
    return x[..., :3] * (x[..., 3:4] / 255.0)


P = prem(a)
worst = []
for c, dirs in adjacency(2000).items():
    for (dq, dr), ns in dirs.items():
        if (dq and dr) or not (dq > 0 or dr > 0):
            continue
        for n in ns:
            if n is None:
                continue
            A = P[c[1]*T:(c[1]+1)*T, c[0]*T:(c[0]+1)*T]
            B = P[n[1]*T:(n[1]+1)*T, n[0]*T:(n[0]+1)*T]
            ea, eb = (A[:, -1], B[:, 0]) if dq else (A[-1, :], B[0, :])
            worst.append((round(float(np.abs(ea - eb).sum(-1).mean()), 1), c, (dq, dr), n, ns[n]))
inner = np.abs(P[:, 1:] - P[:, :-1]).sum(-1)[a[:, 1:, 3] > 250].mean()
worst.sort(reverse=True)
print('inner step %.1f; seams mean %.1f' % (inner, np.mean([w[0] for w in worst])))
print('worst:', worst[:10])
