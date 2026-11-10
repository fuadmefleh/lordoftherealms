"""
Props that animate in place: ChatGPT drew each as a strip of frames (what stands still the same each
time, only the water or the flames moving) on real transparency. Each frame is cut from its share of
the strip, the same window from each (so the stone does not jitter from frame to frame), scaled alike
to fit the prop's cells, stood on the bottom and centred, and laid side by side in the prop's modern
sheet; data/ambient.json `objects.<id>.frames` plays them.

  fountain   assets/lpc/new/fountain_anim_source.png -> Fountain A.png, frame k at cells [2k, 0, 2, 3]
  campfire   assets/lpc/new/campfire_anim_source.png -> Fire, Camp.png, frame k at cells [k, 1, 1, 1]
             (the row above, the cold campfire, is kept)

Run from the repo root: python scripts/make_prop_frames.py [name ...]
"""
import sys

import numpy as np
from PIL import Image

C = 128
# name: (source, sheet, sheet size in cells, frames, frame cells w x h, first frame's cell, fill)
PROPS = {
    'fountain': ('assets/lpc/new/fountain_anim_source.png', 'assets/modern/lpc/Structure/Misc/Fountain A.png',
                 (8, 3), 4, (2, 3), (0, 0), 0.94),
    'campfire': ('assets/lpc/new/campfire_anim_source.png', 'assets/modern/lpc/Objects/Small Items/Fire, Camp.png',
                 (4, 2), 4, (1, 1), (0, 1), 0.96),
}
# props whose still part ChatGPT redrew a little differently each frame: every frame takes the first
# frame's pixels except where either frame has the moving part (here flame), so the stones and logs
# stand exactly still and only the fire moves
STEADY = {'campfire': 'flame'}


def _flame(f):
    """Flame and its glow: bright, saturated reds, oranges and yellows."""
    rgb = f[..., :3].astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hot = (f[..., 3] > 40) & (r > 170) & (r - b > 90) & (g < r + 10)
    from scipy import ndimage
    return ndimage.binary_dilation(hot, iterations=12)   # (its dark outline too)


def build(name):
    src, out, (SW, SH), FRAMES, (CW, CH), (c0, r0), FILL = PROPS[name]
    a = np.array(Image.open(src).convert('RGBA'))
    a[a[..., 3] <= 24] = 0
    # the strip's shares: the same window cut from each (the union of the drawings in them, in the
    # share's own coordinates), so whatever stands still in the drawing stands still on the map
    q = a.shape[1] / FRAMES
    x0s, x1s, y0s, y1s = [], [], [], []
    for k in range(FRAMES):
        ys, xs = np.nonzero(a[:, int(k * q):int((k + 1) * q), 3] > 0)
        x0s.append(xs.min()); x1s.append(xs.max() + 1); y0s.append(ys.min()); y1s.append(ys.max() + 1)
    x0, x1, y0, y1 = min(x0s), max(x1s), min(y0s), max(y1s)
    bw, bh = x1 - x0, y1 - y0
    s = min(CW * C * FILL / bw, CH * C * FILL / bh)
    try:
        sheet = Image.open(out).convert('RGBA')
        if sheet.size != (SW * C, SH * C):
            sheet = Image.new('RGBA', (SW * C, SH * C), (0, 0, 0, 0))
    except FileNotFoundError:
        sheet = Image.new('RGBA', (SW * C, SH * C), (0, 0, 0, 0))
    clear = Image.new('RGBA', (CW * C, CH * C), (0, 0, 0, 0))
    first = a[y0:y1, int(0 * q) + x0:int(0 * q) + x1]
    for k in range(FRAMES):
        ox = int(k * q)
        frame = a[y0:y1, ox + x0:ox + x1].copy()
        if name in STEADY and k:
            keep = ~(_flame(first) | _flame(frame))
            frame[keep] = first[keep]
        im = Image.fromarray(frame, 'RGBA').resize((round(bw * s), round(bh * s)), Image.LANCZOS)
        px, py = (c0 + k * CW) * C, r0 * C
        sheet.paste(clear, (px, py))
        sheet.alpha_composite(im, (px + (CW * C - im.width) // 2, py + CH * C - im.height))
    sheet.save(out)
    print('wrote', out, sheet.size)


if __name__ == '__main__':
    for n in (sys.argv[1:] or PROPS):
        build(n)
