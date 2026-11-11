# A poor house's windows, which the kit lacked (it has only glazed windows in stone frames):
# a small hole in the wall in a rough timber frame, shut with plank shutters, open on a dark
# room, or covered with oiled cloth.
#
#   python -I make_poor_windows.py
#
# Painted at 4x (128px a cell) in the modern kit's style, from the plank texture
# (planks_tile.png) the kits are painted with; writes
#   assets/modern/lpc/Structure/Windows/Poor Windows.png   (3 cells: shut, open, cloth)
#   assets/lpc/Structure/Windows/Poor Windows.png          (the same at 32px a cell)
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
T = 128


def planks(w, h, colour, turn=False, seed=0):
    """A patch of the plank texture tinted to a colour (boards upright, or across if turn)."""
    tex = np.asarray(Image.open(os.path.join(HERE, 'planks_tile.png')).convert('RGB').resize((256, 256), Image.LANCZOS), np.float32)
    if turn:
        tex = np.rot90(tex)
    tex = np.roll(tex, seed * 37, axis=1)
    reps = (h // tex.shape[0] + 1, w // tex.shape[1] + 1, 1)
    t = np.tile(tex, reps)[:h, :w]
    L = t @ np.array([0.299, 0.587, 0.114], np.float32)
    rel = (L / max(1.0, L.mean()))[..., None]
    return np.clip(np.array(colour, np.float32) * rel, 0, 255)


def shade_box(a, x0, y0, x1, y1, k=0.35, w=4):
    """Darken a rectangle's inner edge (a soft bevel)."""
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.minimum.reduce([xx - x0, x1 - 1 - xx, yy - y0, y1 - 1 - yy]).astype(np.float32)
    f = 1 - k * np.exp(-d / w)
    a[y0:y1, x0:x1, :3] *= f[..., None]


def frame(cell, x0, y0, x1, y1, b=9):
    """A rough timber frame round an opening (x0..x1, y0..y1 inside), lintel a little wider."""
    wood = (92, 68, 46)
    out = cell
    for (a, bb, c, d, turn) in [
        (x0 - b - 4, y0 - b, x1 + b + 4, y0, True),     # lintel
        (x0 - b, y1, x1 + b, y1 + b - 2, True),         # sill
        (x0 - b, y0, x0, y1, False),                    # posts
        (x1, y0, x1 + b, y1, False),
    ]:
        out[bb:d, a:c, :3] = planks(c - a, d - bb, wood, turn, seed=a + bb)
        out[bb:d, a:c, 3] = 255
        shade_box(out, a, bb, c, d, 0.4, 2.5)


def make():
    sheet = np.zeros((T, 3 * T, 4), np.float32)
    # the opening: about 60% of the stone window's, low on the cell as the glazed ones sit
    ox0, oy0, ox1, oy1 = 34, 30, 94, 100
    for i in range(3):
        cell = np.zeros((T, T, 4), np.float32)
        if i == 0:
            # shut: two plank shutters meeting in the middle, a batten across each
            sh = planks(ox1 - ox0, oy1 - oy0, (128, 96, 64), False, seed=3)
            cell[oy0:oy1, ox0:ox1, :3] = sh
            cell[oy0:oy1, ox0:ox1, 3] = 255
            mid = (ox0 + ox1) // 2
            cell[oy0:oy1, mid - 1:mid + 1, :3] *= 0.45
            for by in (oy0 + 14, oy1 - 18):
                cell[by:by + 7, ox0 + 2:ox1 - 2, :3] = planks(ox1 - ox0 - 4, 7, (104, 76, 50), True, seed=by)
                shade_box(cell, ox0 + 2, by, ox1 - 2, by + 7, 0.35, 1.5)
            shade_box(cell, ox0, oy0, ox1, oy1, 0.45, 4)
        elif i == 1:
            # open: the dark room behind, the shutters folded back against the wall either side
            yy = np.linspace(0, 1, oy1 - oy0)[:, None]
            cell[oy0:oy1, ox0:ox1, :3] = np.array([30, 22, 18], np.float32) * (0.7 + 0.5 * yy)[..., None]
            cell[oy0:oy1, ox0:ox1, 3] = 255
            for sx0 in (ox0 - 9 - 22, ox1 + 9):
                cell[oy0:oy1, sx0:sx0 + 22, :3] = planks(22, oy1 - oy0, (124, 92, 62), False, seed=sx0)
                cell[oy0:oy1, sx0:sx0 + 22, 3] = 255
                cell[oy0 + 12:oy0 + 18, sx0:sx0 + 22, :3] *= 0.7
                cell[oy1 - 18:oy1 - 12, sx0:sx0 + 22, :3] *= 0.7
                shade_box(cell, sx0, oy0, sx0 + 22, oy1, 0.4, 2)
        else:
            # oiled cloth stretched on a cross of sticks: dull, a little light through it
            yy, xx = np.mgrid[oy0:oy1, ox0:ox1]
            n = ndimage.gaussian_filter(np.random.default_rng(7).standard_normal((oy1 - oy0, ox1 - ox0)), 3)
            cloth = np.array([176, 150, 104], np.float32) * (0.92 + 0.6 * n)[..., None]
            cell[oy0:oy1, ox0:ox1, :3] = cloth
            cell[oy0:oy1, ox0:ox1, 3] = 255
            shade_box(cell, ox0, oy0, ox1, oy1, 0.5, 6)
            mx, my = (ox0 + ox1) // 2, (oy0 + oy1) // 2
            cell[oy0:oy1, mx - 3:mx + 3, :3] = planks(6, oy1 - oy0, (88, 64, 44), False, seed=1)
            cell[my - 3:my + 3, ox0:ox1, :3] = planks(ox1 - ox0, 6, (88, 64, 44), True, seed=2)
        frame(cell, ox0, oy0, ox1, oy1)
        # one dark outline round the whole, as the kit's pieces have
        a = cell[..., 3] > 0
        edge = a & ~ndimage.binary_erosion(a, iterations=2)
        cell[edge, :3] *= 0.55
        sheet[:, i * T:(i + 1) * T] = cell
    img = Image.fromarray(np.clip(sheet + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    big = os.path.join(ROOT, 'assets/modern/lpc/Structure/Windows/Poor Windows.png')
    small = os.path.join(ROOT, 'assets/lpc/Structure/Windows/Poor Windows.png')
    img.save(big)
    img.resize((img.width // 4, img.height // 4), Image.LANCZOS).save(small)
    print('wrote', big, small)


if __name__ == '__main__':
    make()
