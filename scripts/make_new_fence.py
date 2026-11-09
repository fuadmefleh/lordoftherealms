"""
The town fence, redrawn with ChatGPT and assembled from its parts into the
joined-fence sheet (data/townProps.json fence.join; world/townProps.js
joinFences): one cell for each set of sides a piece of fence runs out to, the
gate shut and open, and the run pieces either side of a gate with its gateposts.

Source: assets/lpc/new/fence_source.png, four parts in reading order: a post,
a straight section (two posts and the rails between), the gate shut, and the
gate swung open seen edge-on.

Written over the 4x modern sheet assets/modern/lpc/ThatchedHouses/tilesets/fence.png
(3 x 7 cells of 128px) in the old layout, at the old one's measure: the post in
the middle of its cell, the rails at the same heights, a thin rail running
up and down to the next cell for a fence going north and south.

Run from the repo root: python scripts/make_new_fence.py
"""
import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402
from make_new_props import objects  # noqa: E402

C = 128
OUT = 'assets/modern/lpc/ThatchedHouses/tilesets/fence.png'
POST = (48, 12, 80, 102)       # x0, y0, x1, y1 of the post in its cell
RAILS = (28, 90)               # the rails' top and bottom
BAR = (57, 71)                 # the thin rail run north / south, across


def rail_strip(section):
    """The rails between the section's posts, cropped to their height."""
    a = np.array(section)
    W = a.shape[1]
    mid = a[:, int(W * 0.35):int(W * 0.65)]
    rows = np.where((mid[..., 3] > 0).mean(axis=1) > 0.6)[0]
    top, bot = rows.min(), rows.max() + 1
    return Image.fromarray(mid[top:bot])


def tile_x(strip, w, h):
    """The rails `w` long and `h` high, the strip repeated along."""
    s = strip.resize((max(1, round(strip.width * h / strip.height)), h), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    x = 0
    while x < w:
        out.alpha_composite(s, (x, 0))
        x += s.width
    return out


def main():
    post, section, gate, gate_open = objects(key_white(Image.open('assets/lpc/new/fence_source.png'), holes=True))
    rails = rail_strip(section)
    rh = RAILS[1] - RAILS[0]
    px0, py0, px1, py1 = POST
    post_img = post.resize((px1 - px0, py1 - py0), Image.LANCZOS)
    # the rail run north / south: the post's shaft (not its cap), slimmed and drawn out
    shaft = post.crop((0, int(post.height * 0.35), post.width, int(post.height * 0.9)))
    bar = shaft.resize((BAR[1] - BAR[0], C), Image.LANCZOS)

    def cell(mask, gatepost=None, post=True):
        im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
        cx = (px0 + px1) // 2
        if 'n' in mask:
            im.alpha_composite(bar.crop((0, 0, bar.width, py0 + 6)), (BAR[0], 0))
        if 's' in mask:
            im.alpha_composite(bar.crop((0, 0, bar.width, C - py1 + 6)), (BAR[0], py1 - 6))
        if 'w' in mask:
            im.alpha_composite(tile_x(rails, cx, rh), (0, RAILS[0]))
        if 'e' in mask:
            im.alpha_composite(tile_x(rails, C - cx, rh), (cx, RAILS[0]))
        if gatepost == 'right':      # the run up to a gate on its east: a gatepost at the cell's edge
            im.alpha_composite(tile_x(rails, C - cx, rh), (cx, RAILS[0]))
            im.alpha_composite(post_img, (C - (px1 - px0), py0))
        if gatepost == 'left':
            im.alpha_composite(tile_x(rails, cx, rh), (0, RAILS[0]))
            im.alpha_composite(post_img, (0, py0))
        if post:
            im.alpha_composite(post_img, (px0, py0))
        return im

    join = {'post': (0, 1), 'e': (0, 0), 'ew': (1, 0), 'w': (2, 0), 'n': (0, 1), 'ns': (1, 1), 's': (2, 1),
            'es': (0, 2), 'esw': (1, 2), 'sw': (2, 2), 'nes': (0, 3), 'nesw': (1, 3), 'nsw': (2, 3),
            'ne': (0, 4), 'new': (1, 4), 'nw': (2, 4)}
    sheet = Image.new('RGBA', (3 * C, 7 * C), (0, 0, 0, 0))
    for mask, (c, r) in join.items():
        if mask == 'post':
            continue              # (shares its cell with 'n', as the old sheet did)
        sheet.alpha_composite(cell(mask), (c * C, r * C))
    # either side of a gate: the run's post, and a gatepost against the gate
    sheet.alpha_composite(cell('w', gatepost='right'), (0, 5 * C))
    sheet.alpha_composite(cell('e', gatepost='left'), (2 * C, 5 * C))
    # the gate, shut (across its cell) and open (swung back against its left post)
    sheet.alpha_composite(gate.resize((C, py1 - 8), Image.LANCZOS), (C, 5 * C + 8))
    sheet.alpha_composite(gate_open.resize((36, C - 16), Image.LANCZOS), (C, 6 * C + 8))
    sheet.save(OUT)
    print('wrote', OUT, sheet.size)

    # The plain fence (Structure/Fences/Plain Fence A: the old vertical fence pieces kept for
    # old saves, the posts at a building lot's corners, a corral's fallback picture), laid out
    # as it was: a 3x3 block of joined pieces, a north-south run, a run piece, a short section
    # and two lone posts
    plain = Image.new('RGBA', (5 * C, 4 * C), (0, 0, 0, 0))
    for (c, r), mask in {(0, 0): 'es', (1, 0): 'esw', (2, 0): 'sw', (0, 1): 'nes', (1, 1): 'nesw', (2, 1): 'nsw',
                         (0, 2): 'ne', (1, 2): 'new', (2, 2): 'nw', (3, 0): 's', (3, 1): 'ns', (3, 2): 'n',
                         (4, 2): 'ew', (0, 3): 'e', (2, 3): 'w', (3, 3): '', (4, 3): ''}.items():
        plain.alpha_composite(cell(mask), (c * C, r * C))
    plain.alpha_composite(cell('ew', post=False), (C, 3 * C))
    out2 = 'assets/modern/lpc/Structure/Fences/Plain Fence A.png'
    plain.save(out2)
    print('wrote', out2, plain.size)


if __name__ == '__main__':
    main()
