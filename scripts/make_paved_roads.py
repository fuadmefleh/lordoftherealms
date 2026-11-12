# Paved (cobbled) versions of the overworld dirt road sprites: same shape and
# shading, resurfaced as grey setts with a darker kerb. Deterministic.
import sys, os, glob, math, random
from PIL import Image, ImageFilter
SRC, DST = sys.argv[1], sys.argv[2]
CELL = 9
def cobble_field(w, h, seed):
    rnd = random.Random(seed)
    pts = {}
    for gy in range(-1, h // CELL + 2):
        off = (CELL // 2) if gy % 2 else 0
        for gx in range(-1, w // CELL + 2):
            pts[(gx, gy)] = (gx * CELL + off + rnd.uniform(-2, 2), gy * CELL + rnd.uniform(-1.5, 1.5), rnd.uniform(-0.08, 0.08))
    return pts
def setts(x, y, pts):
    gx, gy = int(x // CELL), int(y // CELL)
    best = []
    for dy in (-1, 0, 1):
        for dx in (-2, -1, 0, 1, 2):
            p = pts.get((gx + dx, gy + dy))
            if p: best.append(((p[0] - x) ** 2 + (p[1] - y) ** 2, p))
    best.sort(key=lambda b: b[0])
    d1, p1 = best[0]; d2 = best[1][0]
    return math.sqrt(d2) - math.sqrt(d1), p1[2]
os.makedirs(DST, exist_ok=True)
for f in sorted(glob.glob(os.path.join(SRC, 'hexRoad-*.png'))):
    im = Image.open(f).convert('RGBA'); w, h = im.size; px = im.load()
    a = im.split()[3]
    inner = a.point(lambda v: 255 if v > 90 else 0).filter(ImageFilter.MinFilter(5))
    ip = inner.load()
    pts = cobble_field(w, h, 7)
    out = Image.new('RGBA', (w, h)); op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, al = px[x, y]
            if al == 0: continue
            lum = (0.3 * r + 0.59 * g + 0.11 * b) / 200.0
            base = 0.78 + 0.32 * min(1.25, lum)
            edge, tint = setts(x, y, pts)
            if ip[x, y] == 0:            # the kerb: darker worn stone along the edges
                c = (92, 88, 82); k = 0.85 * base
            else:
                c = (150, 146, 138); k = base * (1 + tint)
                if edge < 1.1: k *= 0.62        # mortar joint between setts
                elif edge < 2.0: k *= 0.9       # rounded sett edge
            op[x, y] = (max(0, min(255, int(c[0] * k))), max(0, min(255, int(c[1] * k))), max(0, min(255, int(c[2] * k + 4))), al)
    out.save(os.path.join(DST, os.path.basename(f).replace('hexRoad-', 'hexRoadPaved-')))
print('done')
