"""
Graveyard props drawn with ChatGPT (the town props' painted series, props1_source.png as the
style reference), cut into one keyed PNG each under assets/lpc/new/graves/<id>.png, with
assets/lpc/new/graves/manifest.json: { id: { w, h, tilesW, tilesH } }.

Sources (assets/lpc/new/graves/source/), drawings of separate objects on flat white:
  graves_a_source.png  3x3: cross_wood, board_wood, headstone_plain / headstone_round,
                       headstone_carved, headstone_old / headstone_broken, grave_mound, grave_open
  graves_b_source.png  2x2: tomb, crypt / grave_fence, ossuary
  bone_mill_source.png the bone mill alone

Each object is keyed off the white (flood from the borders, enclosed white pockets too, then
defringed), every blob is given to the grid cell holding its middle (a broken headstone's two
pieces stay together), cropped, and scaled, keeping its shape, to fit its tiles box (128 px a
tile, the town props' scale) at FILL of the box; the railing is scaled to exactly one tile wide
so sections join end to end.

Run from the repo root: python scripts/make_graves.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402

TILE = 128
FILL = 0.86
OUT = 'assets/lpc/new/graves'
SRC = os.path.join(OUT, 'source')

# source: (grid cols, rows, [ids in reading order])
SOURCES = {
    'graves_a_source.png': (3, 3, ['cross_wood', 'board_wood', 'headstone_plain',
                                   'headstone_round', 'headstone_carved', 'headstone_old',
                                   'headstone_broken', 'grave_mound', 'grave_open']),
    'graves_b_source.png': (2, 2, ['tomb', 'crypt', 'grave_fence', 'ossuary']),
    'bone_mill_source.png': (1, 1, ['bone_mill']),
}
# id: (tilesW, tilesH) - the box the sprite is fitted into
TILES = {
    'cross_wood': (1, 1), 'board_wood': (1, 1), 'headstone_plain': (1, 1), 'headstone_round': (1, 1),
    'headstone_carved': (1, 1), 'headstone_old': (1, 1), 'headstone_broken': (1, 1),
    'grave_mound': (2, 1), 'grave_open': (2, 1), 'tomb': (2, 1), 'crypt': (3, 3),
    'grave_fence': (1, 1), 'ossuary': (2, 2), 'bone_mill': (3, 3),
}


def cut(path, cols, rows):
    """The grid's objects, each cropped to itself, in reading order."""
    im = Image.open(path).convert('RGB')
    keyed = np.array(key_white(im, holes=12, clean=True))
    alpha = keyed[..., 3] > 24
    lab, n = ndimage.label(alpha, structure=np.ones((3, 3)))
    sizes = ndimage.sum(alpha, lab, range(1, n + 1))
    mids = ndimage.center_of_mass(alpha, lab, range(1, n + 1))
    H, W = alpha.shape
    cells = [[] for _ in range(cols * rows)]
    for k in range(n):
        if sizes[k] < max(40, sizes.max() * 0.004):    # specks
            continue
        y, x = mids[k]
        cells[min(rows - 1, int(y / H * rows)) * cols + min(cols - 1, int(x / W * cols))].append(k + 1)
    out = []
    for ks in cells:
        assert ks, f'{path}: a cell is empty'
        mask = np.isin(lab, ks)
        ys, xs = np.nonzero(mask)
        sub = keyed[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        sub[~mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]] = 0
        out.append(Image.fromarray(sub, 'RGBA'))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for name, (cols, rows, ids) in SOURCES.items():
        path = os.path.join(SRC, name)
        if not os.path.exists(path):
            print(f'  no source {name}')
            continue
        for sid, sprite in zip(ids, cut(path, cols, rows)):
            tw, th = TILES[sid]
            if sid == 'grave_fence':
                # drawn with a post at each end: cut the right one off, so sections laid end to
                # end share one post at each joint (the left post of the next section)
                col = (np.array(sprite)[..., 3] > 40).sum(axis=0)
                post = col > col.max() * 0.8
                x = len(post) - 1
                while x > 0 and not post[x]:
                    x -= 1
                while x > 0 and post[x]:
                    x -= 1
                sprite = sprite.crop((0, 0, x, sprite.height))
                s = tw * TILE / sprite.width
            else:
                s = min(tw * TILE * FILL / sprite.width, th * TILE * FILL / sprite.height)
            w, h = max(1, round(sprite.width * s)), max(1, round(sprite.height * s))
            small = sprite.resize((w, h), Image.LANCZOS)
            small.save(os.path.join(OUT, f'{sid}.png'), optimize=True)
            manifest[sid] = {'w': w, 'h': h, 'tilesW': tw, 'tilesH': max(th, -(-h // TILE))}
            print(f'{sid}: {w}x{h} ({tw}x{manifest[sid]["tilesH"]} tiles)')
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
