# The crag shapes src/world/innerMap/cliffs.js lays, in Python: which cliff
# sheet cell (c, r) lands next to which. build_cliff.py pads each cell with its
# in-game neighbours (so pieces that meet are smoothed as one picture), and the
# preview script composes test scenes from the same layouts.
import random

TOP = {'tl': (5, 6), 't': (2, 5), 'tr': (6, 6), 'l': (0, 5), 'r': (4, 5),
       'bl': (5, 7), 'b': (2, 7), 'br': (6, 7)}
WALL = {'l': (5, 3), 'm': (2, 3), 'r': (6, 3)}
FOOT = {'l': (5, 8), 'm': (2, 8), 'r': (6, 8)}
ANGLED = [
    {'l': [(0, 6), (1, 6)], 'm': None, 'r': [(3, 6), (4, 6)]},
    {'l': [(0, 7), (1, 7)], 'm': (2, 7), 'r': [(3, 7), (4, 7)]},
    {'l': [(0, 8), (1, 8)], 'm': (2, 8), 'r': [(3, 8), (4, 8)]},
]
CONFIG = {
    'mountain': {'width': [4, 14], 'height': [3, 8], 'face': [2, 4], 'tier': 0.6, 'angled': 0.55},
    'snow_peak': {'width': [4, 14], 'height': [3, 8], 'face': [3, 4], 'tier': 0.7, 'angled': 0.45},
    'highlands': {'width': [3, 10], 'height': [2, 5], 'face': [2, 3], 'tier': 0.2, 'angled': 0.65},
    'hills': {'width': [4, 8], 'height': [2, 4], 'face': [2, 2], 'tier': 0, 'angled': 0.75},
}


def _rng_range(rng, v):
    a, b = v
    return a + int(rng.random() * (max(a, b) - a + 1))


def stand_angled(grid, q0, r0, w, h):
    for y in range(h):
        for x in range(w):
            if y == 0:
                cell = TOP['tl'] if x == 0 else TOP['tr'] if x == w - 1 else TOP['t']
            else:
                cell = TOP['l'] if x == 0 else TOP['r'] if x == w - 1 else None
            grid[(q0 + x, r0 + y)] = cell
    for i, row in enumerate(ANGLED):
        for x in range(w):
            cell = row['l'][x] if x < 2 else row['r'][x - (w - 2)] if x >= w - 2 else row['m']
            grid[(q0 + x, r0 + h + i)] = cell


def stand_square(grid, q0, r0, w, h, face):
    for y in range(h):
        for x in range(w):
            top, bot, L, R = y == 0, y == h - 1, x == 0, x == w - 1
            if top:
                cell = TOP['tl'] if L else TOP['tr'] if R else TOP['t']
            elif bot:
                cell = TOP['bl'] if L else TOP['br'] if R else TOP['b']
            else:
                cell = TOP['l'] if L else TOP['r'] if R else None
            grid[(q0 + x, r0 + y)] = cell
    for i in range(face):
        s = FOOT if i == face - 1 else WALL
        for x in range(w):
            grid[(q0 + x, r0 + h + i)] = s['l'] if x == 0 else s['r'] if x == w - 1 else s['m']


def crag(grid, q0, r0, cfg, rng):
    """One crag (and maybe its second step) as cliffs.js lays it. Returns (w, full height)."""
    w = _rng_range(rng, cfg['width'])
    angled = w >= 5 and rng.random() < cfg['angled']
    h = max(1, _rng_range(rng, cfg['height']) - 2) if angled else _rng_range(rng, cfg['height'])
    face = len(ANGLED) if angled else _rng_range(rng, cfg['face'])
    if angled:
        stand_angled(grid, q0, r0, w, h)
    else:
        stand_square(grid, q0, r0, w, h, face)
    tw, room = w - 4, (h - 1 if angled else h - 2)
    if tw >= 3 and room >= 4 and rng.random() < cfg['tier']:
        tf = 2
        th = min(room - tf, 2 + int(rng.random() * 2))
        tW = 3 + int(rng.random() * (tw - 2))
        tq = q0 + 2 + int(rng.random() * (tw - tW + 1))
        if th >= 2 and tW >= 5 and rng.random() < 0.5:
            stand_angled(grid, tq, r0 + 1, tW, max(1, th + tf - len(ANGLED)))
        elif th >= 2:
            stand_square(grid, tq, r0 + 1, tW, th, tf)
    return w, h + face


def adjacency(trials=4000, seed=1):
    """{cell: {(dq, dr): {neighbour: count}}}; neighbour None = open grass (ground or a crag's top)."""
    rng = random.Random(seed)
    adj = {}
    for t in range(trials):
        cfg = CONFIG[list(CONFIG)[t % len(CONFIG)]]
        grid = {}
        crag(grid, 0, 0, cfg, rng)
        for (q, r), cell in grid.items():
            if cell is None:
                continue
            d = adj.setdefault(cell, {})
            for dq in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    if dq or dr:
                        n = grid.get((q + dq, r + dr))
                        dd = d.setdefault((dq, dr), {})
                        dd[n] = dd.get(n, 0) + 1
    return adj
