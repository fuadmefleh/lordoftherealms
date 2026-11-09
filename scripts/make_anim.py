"""
The moving parts the ambient layer spins (data/ambient.json `parts`, ui/innerMapLayers/ambient.js):
ChatGPT drew them face-on on real transparency (assets/lpc/new/anim/source/). Each is cut out, its
hub found (where its arms cross), and the sprite cropped to a square centred
on that hub, so it turns about the hub without wobbling; written as assets/lpc/new/anim/<id>.png
(128 px a tile) with assets/lpc/new/anim/manifest.json: { id: { file, w, h, tilesW, tilesH,
frames, pivot } }, merged into gamedata.ambient.art by build:data.

Run from the repo root: python scripts/make_anim.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage  # noqa: F401 (labels below)

TILE = 128
DIR = 'assets/lpc/new/anim'
# source: [(id, tiles)] in order left to right
SOURCES = {'wheel_sails_source.png': [('waterwheel', 3), ('windmill_sails', 4)]}


def hub(a):
    """The hub: where the drawing's arms cross - the middle of its widest rows and of its tallest
    columns (a wheel's middle; the sails' crossing). The painted iron boss sits there."""
    op = a[..., 3] > 0
    rows, cols = op.sum(axis=1), op.sum(axis=0)
    return np.nonzero(rows >= rows.max() * 0.85)[0].mean(), np.nonzero(cols >= cols.max() * 0.85)[0].mean()


def main():
    path = os.path.join(DIR, 'manifest.json')
    manifest = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    for name, items in SOURCES.items():
        a = np.array(Image.open(os.path.join(DIR, 'source', name)).convert('RGBA'))
        a[a[..., 3] <= 24] = 0
        lab, n = ndimage.label(ndimage.binary_dilation(a[..., 3] > 0, iterations=6))
        sizes = ndimage.sum(a[..., 3] > 0, lab, range(1, n + 1))
        keep = sorted(range(1, n + 1), key=lambda i: -sizes[i - 1])[:len(items)]
        boxes = sorted([(ndimage.find_objects((lab == i).astype(int))[0], i) for i in keep], key=lambda b: b[0][1].start)
        for (b, i), (sid, tiles) in zip(boxes, items):
            sub = a[b].copy()
            sub[lab[b] != i] = 0
            cy, cx = hub(sub)
            H, W = sub.shape[:2]
            half = int(np.ceil(max(cy, H - cy, cx, W - cx))) + 2
            sq = np.zeros((2 * half, 2 * half, 4), np.uint8)
            oy, ox = int(round(half - cy)), int(round(half - cx))
            sq[oy:oy + H, ox:ox + W] = sub
            size = tiles * TILE
            im = Image.fromarray(sq, 'RGBA').resize((size, size), Image.LANCZOS)
            im.save(os.path.join(DIR, f'{sid}.png'), optimize=True)
            manifest[sid] = {'file': f'{sid}.png', 'w': size, 'h': size, 'tilesW': tiles, 'tilesH': tiles,
                             'frames': 1, 'pivot': [0.5, 0.5]}
            print(f'{sid}: {size}px, hub at ({cx:.0f}, {cy:.0f}) of {W}x{H}')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
