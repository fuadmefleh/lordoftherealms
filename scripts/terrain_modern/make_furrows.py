# Tilled soil: the seamless soil texture (soil.png, from ChatGPT) shaped into
# ploughed furrows. The ridges are made here, not painted, so that they line up
# from tile to tile: exactly RIDGES ridges a tile, each wobbling a little along
# its length with a period that also divides the tile.
#   tilled.png      dry turned earth
#   tilled_wet.png  the same, watered: darker, richer, a faint sheen on the ridges
import numpy as np
from PIL import Image

N = 128
RIDGES = 4
soil = np.asarray(Image.open('soil.png').convert('RGB').resize((N, N), Image.LANCZOS), np.float32)
y = np.arange(N)[:, None] + 0.5
x = np.arange(N)[None, :] + 0.5
# wobble: two gentle waves along the ridge, periods 1 and 1/2 of the tile
wob = 1.6 * np.sin(2 * np.pi * x / N) + 0.9 * np.sin(2 * np.pi * 2 * x / N + 1.3)
ph = 2 * np.pi * RIDGES * (y + wob) / N
h = np.sin(ph)                                   # +1 ridge top, -1 trough
lit = np.cos(ph)                                  # the ridge's north face catches the light (light from above-left)
shade = 1 + 0.20 * h + 0.10 * lit
shade = np.where(h < -0.55, shade - 0.18 * (-h - 0.55) / 0.45, shade)   # dark in the trough
dry = np.clip(soil * shade[..., None], 0, 255)
Image.fromarray(dry.astype(np.uint8)).save('tilled.png')

wet = soil * np.array([0.70, 0.66, 0.66], np.float32)          # darker, the red brown deepened
wet = wet * shade[..., None]
sheen = np.clip((h - 0.75) / 0.25, 0, 1) * np.clip(lit + 0.2, 0, 1) * 16
wet = np.clip(wet + sheen[..., None], 0, 255)
Image.fromarray(wet.astype(np.uint8)).save('tilled_wet.png')

# check: the tile must wrap
for name, t in (('tilled', dry), ('tilled_wet', wet)):
    d = lambda a, b: np.abs(a - b).sum(-1).mean()
    print(name, 'wrap x %.1f y %.1f, inner x %.1f y %.1f' % (d(t[:, 0], t[:, -1]), d(t[0], t[-1]),
          d(t[:, 1:], t[:, :-1]), d(t[1:], t[:-1])))
big = Image.new('RGB', (N * 6, N * 3))
for i, n in enumerate(['tilled', 'tilled_wet']):
    im = Image.open(n + '.png')
    for yy in range(3):
        for xx in range(3):
            big.paste(im, (i * N * 3 + xx * N, yy * N))
big.save('tilled_view.png')
