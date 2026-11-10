"""
The buckler, round shield, kite shield and pavise as LPC prop layers
(data/arms.json sprite.layers), from a ChatGPT drawing, held exactly as the
heater shield is held.

Source: assets/lpc/new/arms/shields_source.png, ChatGPT's drawing of each
shield's face (top row: buckler, round, kite, pavise, the faces painted red)
and its back (bottom row: the wood, the strap and grip), flat and upright.
Nothing is drawn here.

The heater shield (Props/Shield 01 - Heater Shield) is one flat shape seen in
a few ways in its frames: turned, tilted, foreshortened, its face toward us or
its back. For every frame its silhouette is matched by an affine map of its
upright face (the face in 'Legacy - Swing', row 0, frame 1): the map that sends
the upright shape's centre and spread onto the frame's, turned through the
angle (and mirror) that overlaps best. The new shield is put through the same
map, sized to its own proportions round the heater's centre, its face drawn
where the heater shows its painted face and its back where the heater shows
its wood, in front of the body or behind it as the heater is.

The red paint is split off into Paint/<Colour> layers recoloured to the
heater's own paint ramps (the liveries' colours), so a company's shields
carry its paint as the heater's do.

Writes assets/lpc/Characters/Props/Shield 0N - <Name>/{Base, Paint/<Colour>}/<anim>.png
and the same under _Behind/. Run from the repo root: python scripts/make_arms_shields.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402

C = 'assets/lpc/Characters/Props/'
HEATER = C + 'Shield 01 - Heater Shield/'
SRC = 'assets/lpc/new/arms/shields_source.png'
ANIMS = ['Combat 1h - Idle', 'Combat 1h - Slash', 'Combat 1h - Halfslash', 'Legacy - Swing', 'Combat 1h - Backslash']
# folder, size in the heater's pixels (width, height), painted?
SHIELDS = [
    ('Shield 02 - Buckler', (8, 8), False),
    ('Shield 03 - Round Shield', (15, 15), True),
    ('Shield 04 - Kite Shield', (12, 20), True),
    ('Shield 05 - Pavise', (15, 21), True),
]
PAINTS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Cyan', 'Black', 'Brown', 'White', 'Navy', 'Wine', 'Forest']
STEEL = [(27, 25, 43), (72, 65, 82), (114, 107, 126), (134, 126, 127), (168, 179, 184), (227, 231, 211)]
WOOD = [(42, 23, 34), (84, 54, 30), (117, 80, 45), (148, 107, 68), (162, 121, 75)]
LEATHER = [(70, 40, 37), (107, 60, 46), (127, 76, 49)]
RED = [(89, 21, 21), (123, 32, 8), (149, 56, 28), (181, 73, 54)]   # the heater's Paint/Red ramp
PALETTE = STEEL + WOOD[1:] + LEATHER + RED
NPAINT = len(PALETTE) - len(RED)   # indices from here on are paint


def load(path):
    return Image.open(path).convert('RGBA') if os.path.exists(path) else None


def cut():
    """The eight drawings: [(front, back)] per shield, as palette-index maps."""
    im = key_white(Image.open(SRC).convert('RGB'), tol=40)
    a = np.array(im)
    from scipy import ndimage
    lab, n = ndimage.label(a[..., 3] > 0)
    objs = ndimage.find_objects(lab)
    boxes = [(s[1].start, s[0].start, s[1].stop, s[0].stop) for s in objs if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 2000]
    top = sorted([b for b in boxes if (b[1] + b[3]) / 2 < a.shape[0] / 2], key=lambda b: b[0])
    bot = sorted([b for b in boxes if (b[1] + b[3]) / 2 >= a.shape[0] / 2], key=lambda b: b[0])
    assert len(top) == 4 and len(bot) == 4, (len(top), len(bot))
    pal = np.array(PALETTE)

    def q(box):
        c = np.array(im.crop(box)).astype(int)
        d = ((c[..., None, :3] - pal[None, None]) ** 2).sum(axis=3)
        idx = d.argmin(axis=2)
        idx[c[..., 3] < 128] = -1
        return idx
    return [(q(t), q(b)) for t, b in zip(top, bot)]


def moments(mask):
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs + 0.5, ys + 0.5], axis=1)
    mu = pts.mean(axis=0)
    cov = np.cov((pts - mu).T) + np.eye(2) * 0.08
    return mu, cov


def sqrtm(m):
    w, v = np.linalg.eigh(m)
    return v @ np.diag(np.sqrt(np.maximum(w, 1e-6))) @ v.T


def render_mask(A, muH, muV, H):
    """The upright heater mask H sent through A (canonical → frame) into a 64px cell."""
    inv = np.linalg.inv(A)
    o = np.arange(64) + 0.5
    X, Y = np.meshgrid(o, o)
    P = np.stack([X - muV[0], Y - muV[1]], axis=-1) @ inv.T + muH
    ix, iy = np.floor(P[..., 0]).astype(int), np.floor(P[..., 1]).astype(int)
    ok = (ix >= 0) & (ix < H.shape[1]) & (iy >= 0) & (iy < H.shape[0])
    out = np.zeros((64, 64), bool)
    out[ok] = H[iy[ok], ix[ok]]
    return out


def fit(H, V):
    """The affine map (2x2, about the centres) that best lays the upright heater H onto the frame's V."""
    muH, cH = moments(H)
    muV, cV = moments(V)
    a = sqrtm(cV)
    b = np.linalg.inv(sqrtm(cH))
    best = (-1, None)
    for mirror in (False, True):
        M = np.diag([-1, 1]) if mirror else np.eye(2)
        for deg in range(0, 360, 3):
            t = math.radians(deg)
            R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
            A = a @ R @ M @ b
            m = render_mask(A, muH, muV, H)
            iou = (m & V).sum() / max(1, (m | V).sum())
            if iou > best[0]:
                best = (iou, A)
    return best[1], muH, muV, best[0]


def place(idx, size, A, muH, muV):
    """The shield drawing idx (sized size in the heater's pixels, centred on muH) through A: a 64px index cell."""
    h, w = idx.shape
    SS = 4
    inv = np.linalg.inv(A)
    o = (np.arange(64 * SS) + 0.5) / SS
    X, Y = np.meshgrid(o, o)
    P = np.stack([X - muV[0], Y - muV[1]], axis=-1) @ inv.T   # in the heater's upright frame, about its centre
    sx = np.floor(w / 2 + P[..., 0] * w / size[0]).astype(int)
    sy = np.floor(h / 2 + P[..., 1] * h / size[1]).astype(int)
    ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
    c = np.full(sx.shape, -1)
    c[ok] = idx[sy[ok], sx[ok]]
    c = c.reshape(64, SS, 64, SS).transpose(0, 2, 1, 3).reshape(64, 64, SS * SS)
    counts = np.stack([(c == q).sum(axis=2) for q in range(len(PALETTE))], axis=2)
    out = np.where(counts.sum(axis=2) * 2 >= SS * SS, counts.argmax(axis=2), -1)
    return out


def ramps():
    """Each paint colour's ramp, matched pixel for pixel to the heater's red."""
    red = np.array(load(HEATER + 'Paint/Red/Combat 1h - Slash.png'))
    out = {}
    for name in PAINTS:
        im = load(HEATER + 'Paint/' + name + '/Combat 1h - Slash.png')
        if im is None:
            continue
        b = np.array(im)
        m = {}
        for i, rc in enumerate(RED):
            sel = (red[..., 3] > 0) & (np.abs(red[..., :3].astype(int) - rc).sum(axis=2) == 0)
            if sel.any():
                m[i] = tuple(int(v) for v in b[sel][0][:3])
        out[name] = [m.get(i, RED[i]) for i in range(len(RED))]
    return out


def main():
    pieces = cut()
    paints = ramps()
    # the upright heater face, the shape every frame is a view of
    up = np.array(load(HEATER + 'Wood/Oak/Legacy - Swing.png'))[0:64, 64:128, 3] > 0
    for (front, back), (folder, size, painted) in zip(pieces, SHIELDS):
        base = C + folder + '/'
        for anim in ANIMS:
            sheets = {}
            for behind in (False, True):
                sub = '_Behind/' if behind else ''
                wood = load(HEATER + 'Wood/Oak/' + sub + anim + '.png')
                if wood is None:
                    continue
                paint = load(HEATER + 'Paint/Red/' + sub + anim + '.png')
                trim = load(HEATER + 'Trim/Steel/' + sub + anim + '.png')
                W, Hh = wood.size
                cells = {}
                for r in range(Hh // 64):
                    for f in range(W // 64):
                        box = (f * 64, r * 64, f * 64 + 64, r * 64 + 64)
                        V = np.array(wood.crop(box))[..., 3] > 0
                        if trim is not None:
                            V |= np.array(trim.crop(box))[..., 3] > 0
                        if V.sum() < 6:
                            continue
                        face = paint is not None and (np.array(paint.crop(box))[..., 3] > 0).sum() > 3
                        A, muH, muV, _ = fit(up, V)
                        cell = place(front if face else back, size, A, muH, muV)
                        # the LPC dark outline round the shield's edge
                        solid = cell >= 0
                        inner = solid.copy()
                        inner[1:-1, 1:-1] = solid[1:-1, 1:-1] & solid[:-2, 1:-1] & solid[2:, 1:-1] & solid[1:-1, :-2] & solid[1:-1, 2:]
                        cell[solid & ~inner] = 0
                        cells[(r, f)] = cell
                sheets[behind] = (W, Hh, cells)
            for behind, (W, Hh, cells) in sheets.items():
                sub = '_Behind/' if behind else ''
                outs = {'Base': np.zeros((Hh, W, 4), np.uint8)}
                if painted:
                    for name in paints:
                        outs['Paint/' + name] = np.zeros((Hh, W, 4), np.uint8)
                for (r, f), cell in cells.items():
                    for y in range(64):
                        for x in range(64):
                            i = cell[y, x]
                            if i < 0:
                                continue
                            Y, X = r * 64 + y, f * 64 + x
                            if i < NPAINT:
                                outs['Base'][Y, X] = PALETTE[i] + (255,)
                            elif painted:
                                for name, ramp in paints.items():
                                    outs['Paint/' + name][Y, X] = ramp[i - NPAINT] + (255,)
                for key, arr in outs.items():
                    d = base + sub + key + '/'
                    os.makedirs(d, exist_ok=True)
                    Image.fromarray(arr, 'RGBA').save(d + anim + '.png')
        print(folder, 'done')


if __name__ == '__main__':
    main()
