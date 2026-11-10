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
# animation strips: source -> (id, frames, tiles tall); the frames side by side, evenly spaced, the
# same window cut from each (what stands still stays still), the pivot at the pole's foot
STRIPS = {'pennant_source.png': ('pennant', 6, 1.6)}


def strip(name, sid, frames, tall, manifest):
    a = np.array(Image.open(os.path.join(DIR, 'source', name)).convert('RGBA'))
    a[a[..., 3] <= 24] = 0
    q = a.shape[1] / frames
    x0s, x1s, y0s, y1s = [], [], [], []
    for k in range(frames):
        ys, xs = np.nonzero(a[:, int(k * q):int((k + 1) * q), 3] > 0)
        x0s.append(xs.min()); x1s.append(xs.max() + 1); y0s.append(ys.min()); y1s.append(ys.max() + 1)
    x0, x1, y0, y1 = min(x0s), max(x1s), min(y0s), max(y1s)
    fh = round(tall * TILE)
    fw = round((x1 - x0) * fh / (y1 - y0))
    out = Image.new('RGBA', (fw * frames, fh), (0, 0, 0, 0))
    for k in range(frames):
        ox = int(k * q)
        out.alpha_composite(Image.fromarray(a[y0:y1, ox + x0:ox + x1], 'RGBA').resize((fw, fh), Image.LANCZOS), (k * fw, 0))
    out.save(os.path.join(DIR, f'{sid}.png'), optimize=True)
    # the pole: the first frame's column of opaque pixels reaching furthest down, from the left
    f0 = np.array(out.crop((0, 0, fw, fh)))[..., 3] > 40
    low = [np.nonzero(f0[:, x])[0].max() if f0[:, x].any() else -1 for x in range(fw)]
    deep = [x for x in range(fw) if low[x] >= max(low) - 2]
    px = (min(deep) + max(deep)) / 2 / fw
    manifest[sid] = {'file': f'{sid}.png', 'w': fw, 'h': fh, 'tilesW': round(fw / TILE, 3), 'tilesH': tall,
                     'frames': frames, 'pivot': [round(px, 3), 1.0]}
    print(f'{sid}: {frames} frames of {fw}x{fh}, pole at {px:.2f}')


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
    for name, (sid, frames, tall) in STRIPS.items():
        strip(name, sid, frames, tall, manifest)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
