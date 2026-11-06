# Paint the town streets' paving sheet: assets/lpc/Structure/Floor/streets_modern.png
#
#   python -I build_streets.py
#
# Each surface is a block of 2x2 cells (128px a cell, so 256px a block) holding one
# repeat of a painted seamless texture (ChatGPT tiles, tile627.py); world/
# townPlanner.js lays a street tile from the cell its (q & 1, r & 1) picks, so the
# pattern runs on unbroken across the street at twice the size of one cell.
# Each surface is tinted to the colour of the structure/floors.png cell the culture
# paved with before, so every culture keeps its own street look. The block layout
# (cell addresses in 32px units, as data/architecture.json `streets` gives them):
#   row 0: cobble grey [0,0], cobble beige [2,0], brick red [4,0], flags cream [6,0],
#          brick cream (laid lengthways) [8,0], square slabs cream [10,0],
#          flags dark [12,0], brick dark [14,0]
#   row 2: herringbone blue [0,2], flags grey [2,2], cobble mauve [4,2],
#          square slabs grey [6,2], flags tan [8,2], packed sand [10,2],
#          river cobbles (turned) [12,2], crazy paving grey [14,2]
#   row 4: cobble light [0,4]
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'lpc', 'Structure', 'Floor', 'streets_modern.png')
FLOORS = os.path.join(ROOT, 'assets', 'lpc', 'Structure', 'Floor', 'floors.png')
K = 4
B = 2 * 32 * K          # a block: 2x2 cells at 128px

# (block x, block y in cells) <- (texture, floors.png cell to take the colour from,
#  options: rot = turn a quarter, zoom = repeats across the block, contrast)
SURFACES = [
    ((0, 0), 'cobble', (29, 58), {}),
    ((2, 0), 'cobble', (28, 53), {}),
    ((4, 0), 'brick', None, {'colour': (164, 85, 60)}),
    ((6, 0), 'flagstone', (13, 51), {}),
    ((8, 0), 'brick', (22, 51), {'rot': True}),
    ((10, 0), 'square', (26, 51), {}),
    ((12, 0), 'flagstone', (8, 57), {'contrast': 1.3}),
    ((14, 0), 'brick', (11, 57), {}),
    ((0, 2), 'herringbone', (10, 53), {'contrast': 1.2}),
    ((2, 2), 'flagstone', (13, 59), {}),
    ((4, 2), 'cobble', (24, 60), {}),
    ((6, 2), 'square', (26, 59), {}),
    ((8, 2), 'flagstone', (13, 53), {}),
    ((10, 2), 'sand', (2, 59), {'zoom': 2}),
    ((12, 2), 'cobble', (6, 59), {'rot': True, 'contrast': 1.15}),
    ((14, 2), 'crazy', (12, 56), {}),
    ((0, 4), 'cobble', (24, 58), {}),
]
TEXFILE = {'cobble': 'cobble_tile.png', 'brick': 'brick_tile.png', 'flagstone': 'flagstone_tile.png',
           'square': 'square_tile.png', 'herringbone': 'herringbone_tile.png', 'crazy': 'crazy_tile.png',
           'sand': 'sand.png'}


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def periodic_resize(im, size):
    """Resize a seamless tile, wrapping round (a 3x3 repeat, the middle cut out)."""
    W = im.size[0]
    big = Image.new('RGB', (W * 3, W * 3))
    for yy in range(3):
        for xx in range(3):
            big.paste(im, (xx * W, yy * W))
    return np.asarray(big.resize((size * 3, size * 3), Image.LANCZOS), np.float32)[size:2 * size, size:2 * size]


def surface(tex, target, zoom=1, rot=False, contrast=1.0):
    im = Image.open(os.path.join(HERE, TEXFILE[tex])).convert('RGB')
    if rot:
        im = im.transpose(Image.ROTATE_90)
    t = np.tile(periodic_resize(im, B // zoom), (zoom, zoom, 1))
    tmean = t.reshape(-1, 3).mean(0)
    rel0 = (lum(t) / max(lum(t).mean(), 1))[..., None]
    chroma = t - tmean * rel0
    target = np.array(target, np.float32)
    return np.clip(target * rel0 ** contrast + 0.5 * chroma * (lum(target) / max(lum(tmean), 1)), 0, 255)


def main():
    floors = np.asarray(Image.open(FLOORS).convert('RGB'), np.float32)
    rows = max(by for (bx, by), *_ in SURFACES) // 2 + 1
    out = np.zeros((rows * B, 8 * B, 4), np.float32)
    for (bx, by), tex, cell, opt in SURFACES:
        if cell:
            c, r = cell
            target = floors[r * 32:(r + 1) * 32, c * 32:(c + 1) * 32].reshape(-1, 3).mean(0)
        else:
            target = opt['colour']
        s = surface(tex, target, opt.get('zoom', 1), opt.get('rot', False), opt.get('contrast', 1.0))
        y0, x0 = by * 32 * K, bx * 32 * K
        out[y0:y0 + B, x0:x0 + B, :3] = s
        out[y0:y0 + B, x0:x0 + B, 3] = 255
        print(f'[{bx},{by}] {tex} <- {cell or opt["colour"]} mean {np.round(target).astype(int).tolist()}')
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT)
    print('wrote', os.path.relpath(OUT, ROOT), out.shape[1], 'x', out.shape[0])


main()
