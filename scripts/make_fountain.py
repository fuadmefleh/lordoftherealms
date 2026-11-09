"""
The town fountain, animated: ChatGPT drew it as a strip of four frames (the same stone each time,
only the water moving) on real transparency, assets/lpc/new/fountain_anim_source.png. Each frame
is cut from its quarter of the strip, the same window from each (so the stone does not jitter from
frame to frame), scaled alike to fit the prop's 2 x 3 cells, stood on the bottom and
centred, and laid side by side in the modern sheet: frame k at cells [2k, 0, 2, 3]
(assets/modern/lpc/Structure/Misc/Fountain A.png, 8 x 3 cells of 128 px). data/ambient.json
`objects.tp_fountain.frames` plays them (step [2, 0]).

Run from the repo root: python scripts/make_fountain.py
"""
import numpy as np
from PIL import Image

C = 128
SRC = 'assets/lpc/new/fountain_anim_source.png'
OUT = 'assets/modern/lpc/Structure/Misc/Fountain A.png'
FRAMES, CW, CH, FILL = 4, 2, 3, 0.94


def main():
    a = np.array(Image.open(SRC).convert('RGBA'))
    a[a[..., 3] <= 24] = 0
    H, W = a.shape[:2]
    # the strip's quarters: the same window cut from each (the union of the drawings in them, in the
    # quarter's own coordinates), so whatever stands still in the drawing stands still on the map
    q = W / FRAMES
    x0s, x1s, y0s, y1s = [], [], [], []
    for k in range(FRAMES):
        ys, xs = np.nonzero(a[:, int(k * q):int((k + 1) * q), 3] > 0)
        x0s.append(xs.min()); x1s.append(xs.max() + 1); y0s.append(ys.min()); y1s.append(ys.max() + 1)
    x0, x1, y0, y1 = min(x0s), max(x1s), min(y0s), max(y1s)
    bw, bh = x1 - x0, y1 - y0
    s = min(CW * C * FILL / bw, CH * C * FILL / bh)
    sheet = Image.new('RGBA', (FRAMES * CW * C, CH * C), (0, 0, 0, 0))
    for k in range(FRAMES):
        ox = int(k * q)
        sub = Image.fromarray(a[y0:y1, ox + x0:ox + x1], 'RGBA')
        im = sub.resize((round(bw * s), round(bh * s)), Image.LANCZOS)
        sheet.alpha_composite(im, (k * CW * C + (CW * C - im.width) // 2, CH * C - im.height))
    sheet.save(OUT)
    print('wrote', OUT, sheet.size)


if __name__ == '__main__':
    main()
