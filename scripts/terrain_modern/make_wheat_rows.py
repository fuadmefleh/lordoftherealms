# The wheat sheet's growing stages (row 5: sprouts, young, green) are field
# fills laid over the tilled soil, so they follow its furrows: the same RIDGES
# ridges a tile, with the same wobble as make_furrows.py, so a sown field's
# rows run straight on across every tile.
#   cell (0,5) sprouts: seedlings standing along each ridge
#   cell (1,5) young:   a band of shoots along each ridge, soil between
#   cell (2,5) green:   nearly closed cover, a narrow gap along each trough
# Written into out_wheat.png (128px cells).
import math
import numpy as np
from PIL import Image, ImageDraw

N = 128
RIDGES = 4
SS = 4                                   # supersampling for the seedlings
young = np.asarray(Image.open('wheat_young.png').convert('RGB').resize((N, N), Image.LANCZOS), np.float32)
out = Image.open('out_wheat.png').convert('RGBA')


def wob(x):
    return 1.6 * math.sin(2 * math.pi * x / N) + 0.9 * math.sin(2 * math.pi * 2 * x / N + 1.3)


def ridge_y(k, x):
    # sin(2pi R (y + wob)/N) = 1  ->  y = N/(4R) + k N/R - wob
    return N / (4 * RIDGES) + k * N / RIDGES - wob(x)


def band(half):
    """Alpha of a band of the given half-width round every ridge (wrapping), soft-edged."""
    y = np.arange(N)[:, None] + 0.5
    x = np.arange(N)[None, :] + 0.5
    w = 1.6 * np.sin(2 * np.pi * x / N) + 0.9 * np.sin(2 * np.pi * 2 * x / N + 1.3)
    ph = (y + w - N / (4 * RIDGES)) % (N / RIDGES)          # 0 at a ridge top
    d = np.minimum(ph, N / RIDGES - ph)                       # distance to the nearest ridge
    # a ragged edge from the leaves themselves: lighter leaf tips reach further
    lum = young.mean(2)
    reach = half + 3.0 * (lum - lum.mean()) / (lum.std() + 1e-6)
    return np.clip((reach - d) / 1.5 + 0.5, 0, 1)


def cell_from(alpha):
    rgba = np.concatenate([young, (alpha * 255)[..., None]], axis=2)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')


# young: bands; green: nearly closed
out.paste(cell_from(band(8.5)), (N, 5 * N))
out.paste(cell_from(band(13.5)), (2 * N, 5 * N))

# sprouts: seedlings along each ridge, drawn at SS x and brought down smooth
big = Image.new('RGBA', (N * SS, N * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(big)
greens = [(70, 128, 40), (96, 156, 48), (128, 182, 62), (150, 196, 74)]
for k in range(RIDGES):
    for j in range(8):
        h = ((k * 7 + j * 13) * 2654435761) % 1000 / 1000
        x0 = (j + 0.5) * N / 8 + (h - 0.5) * 6
        y0 = ridge_y(k, x0) + 1.5
        for b in range(4):
            ang = -math.pi / 2 + (b - 1.5) * 0.42 + (h - 0.5) * 0.3
            ln = 5.0 + 3.0 * ((h * 7 + b * 0.37) % 1)
            col = greens[(b + int(h * 4)) % 4]
            for ox in (-N, 0, N):                         # drawn wrapping round the tile
                for oy in (-N, 0, N):
                    xa, ya = (x0 + ox) * SS, (y0 + oy) * SS
                    xb, yb = xa + math.cos(ang) * ln * SS, ya + math.sin(ang) * ln * SS
                    d.line([(xa, ya), (xb, yb)], fill=col + (255,), width=int(1.4 * SS))
sprouts = big.resize((N, N), Image.LANCZOS)
out.paste(sprouts, (0, 5 * N))
out.save('out_wheat.png')
bg = Image.new('RGBA', (N * 3, N * 2), (116, 74, 51, 255))
soil = Image.open('tilled.png').convert('RGBA').resize((N, N))
for i in range(3):
    for yy in range(2):
        bg.paste(soil, (i * N, yy * N))
        bg.alpha_composite(out.crop((i * N, 5 * N, (i + 1) * N, 6 * N)), (i * N, yy * N))
bg.convert('RGB').resize((N * 6, N * 4)).save('wheat_rows_view.png')
print('ok')
