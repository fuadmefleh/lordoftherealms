"""
Town props redrawn with ChatGPT, fitted into the 32px-cell layout of their LPC
sheets so every prop and building that names a cell keeps working. Written over
the 4x "modern" sheets (assets/modern/<path>, 128px a cell) that
data/innerMapRenderer.json modernSheets points the game at.

Each recipe names its source (a ChatGPT drawing of separate objects on a flat
background, in reading order) and, for each object in turn, the cell rectangle
[col, row, w, h] it fills. An object is scaled, keeping its shape, to fit the box
the old sprite took up in that rectangle (so a bucket stays bucket-sized), and
stood on that box's bottom, centred across it. The rectangles are cleared
first; cells nothing names (unused by any prop or building) keep what they had.

Run from the repo root: python scripts/make_new_props.py [name ...]
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402

C = 128
NEW = 'assets/lpc/new'

# the sheets (their path under assets/, and their size in cells)
SHEETS = {
    'planter':  ('lpc/Objects/Furniture/Planter.png', (5, 3)),
    'barrel':   ('lpc/Objects/Furniture/Barrel.png', (5, 2)),
    'crate':    ('lpc/Objects/Furniture/Crate.png', (3, 4)),
    'sawhorse': ('lpc/Objects/Furniture/Sawhorse.png', (2, 3)),
    'lumber':   ('lpc/Objects/Small Items/Lumber.png', (10, 3)),
    'buckets':  ('lpc/Objects/Small Items/Buckets.png', (3, 2)),
    'baskets':  ('lpc/Objects/Small Items/Baskets A.png', (3, 2)),
    'lamp':     ('lpc/Objects/Furniture/Lighting, Outdoors.png', (2, 3)),
    'hay':      ('lpc/Objects/Small Items/Hay & Straw.png', (4, 3)),
    'fountain': ('lpc/Structure/Misc/Fountain A.png', (2, 3)),
    'runestone': ('lpc/Objects/Furniture/Wolf Stone.png', (4, 4)),
    'campfire': ('lpc/Objects/Small Items/Fire, Camp.png', (4, 2)),
    'pillar':   ('lpc/Structure/Pillars/Stone Pillar A.png', (9, 12)),
    'clan_tents': ('lpc/Objects/Camp/Clan Tents.png', (6, 3)),
    'pool':     ('lpc/Structure/Misc/Pool A.png', (3, 3)),
    'flowers':  ('lpc/Objects/Small Items/Flowers.png', (9, 4)),
    'chimney':  ('lpc/Structure/Roofing/Brick Chimney A.png', (6, 6)),
    'signs':    ('lpc/Structure/Signs/Sign Backgrounds A.png', (2, 2)),
    'awnings':  ('lpc/Structure/Windows/Window Awnings A.png', (9, 6)),
    'emblems':  ('buildingKit/emblems.png', (5, 4)),
    'door':     ('lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png', (28, 32)),
    'arched':   ('lpc/Structure/Doors/64x64px Arched Doors/Arched Double Doors A.png', (8, 12)),
    'frame':    ('lpc/Structure/Doors/32x64px Doors/Doorframe A.png', (12, 6)),
    'farm':     ('lpc/ThatchedHouses/tilesets/farming_fishing.png', (20, 20)),
    'kitfurn':  ('buildingKit/furniture.png', (4, 8)),
    'grocks':   ('lpc/Terrain/Rocks, Grasslands.png', (6, 12)),
    'crops':    ('lpc/crops.png', (32, 32)),
    'chest':    ('lpc/Objects/Furniture/Chest.png', (4, 3)),   # no repaint before
    'harvest':  ('lpc/Objects/Small Items/Harvest.png', (6, 3)),   # new: the haystack, the sheaf, the town well
    **{f'plants_{x}': (f'lpc/Terrain/plants_{x}.png', (16, 5)) for x in ('spring', 'summer', 'autumn', 'winter')},   # no repaint before: started from the original at 4x
}

# The ground plants (map scatter on brush and tall grass, water's-edge dressing): 24 drawings a
# season, each filling one or more cells of the plants sheet; 'f' marks a mirrored copy.
PLANT_CELLS = [
    [(0, 0, 1, 1), (0, 1, 1, 1, 'f')], [(1, 0, 1, 1), (1, 1, 1, 1, 'f')],          # round bushes
    [(2, 0, 1, 1), (2, 1, 1, 1, 'f')], [(3, 0, 1, 1), (3, 1, 1, 1, 'f')],          # rosettes
    [(4, 0, 1, 1), (4, 1, 1, 1, 'f')], [(5, 0, 1, 1), (5, 1, 1, 1, 'f')],          # broad leaves
    [(6, 0, 1, 1), (6, 1, 1, 1, 'f')], [(7, 0, 1, 1)],                             # dense shrubs
    [(0, 2, 1, 2)], [(1, 2, 1, 2)], [(2, 2, 1, 2)],                                # conifer shrubs
    [(3, 2, 2, 2)], [(5, 2, 3, 2)],                                                # fern, giant fern
    [(8, 1, 1, 1), (10, 1, 1, 1, 'f')], [(9, 1, 1, 1)],                            # grass tufts
    [(8, 2, 1, 2), (9, 2, 1, 2, 'f'), (10, 2, 1, 2)],                              # tall grass
    [(11, 0, 1, 2), (12, 0, 1, 2, 'f'), (13, 0, 1, 2)],                            # tall reeds
    [(12, 2, 1, 1), (12, 4, 1, 1, 'f')], [(12, 3, 1, 1), (13, 3, 1, 1, 'f')],      # lily pads
    [(13, 2, 1, 1), (13, 4, 1, 1, 'f')],                                           # lily pad in flower
    [(14, 0, 1, 1), (15, 0, 1, 1, 'f')], [(14, 1, 1, 1), (15, 1, 1, 1, 'f')],      # lily flowers
    [(14, 2, 1, 1), (14, 3, 1, 1, 'f'), (14, 4, 1, 1)], [(15, 2, 1, 1), (15, 3, 1, 1, 'f'), (15, 4, 1, 1)],  # cattails
]

# a source, and the sheet and cell rectangle each of its drawings fills, in reading order
# (a third entry: more rectangles the same drawing fills, e.g. an animation's frames)
RECIPES = {
    # the haystack and the wheat sheaf (data/townProps.json, sheet "harvest"; they were cut from the
    # wheat field's tiles before); the 32px sheet is the 4x one scaled down
    'harvest': ('harvest_source.png', [('harvest', [0, 0, 3, 3, 0.7]), ('harvest', [3, 1, 1, 2, 0.85])], 'downscale'),
    # the town well, 2x2 (it had one furniture cell before and stood smaller than a barrel)
    'well': ('farm_source.png', [(None, None)] * 12 + [('harvest', [4, 1, 2, 2, 0.85])], 'downscale', 'holes'),
    # the chest sheet's small closed chest (a chest afloat): the furniture's treasure chest
    'chest': ('furniture_source.png', [(None, None)] * 3 + [('chest', [2, 0, 1, 1])] + [(None, None)] * 28),
    # the field crops (data/crops.json art: sprout, young, nearly grown, ripe; hemp's last two
    # stages two cells tall), then the sown mound
    'crops': ('crops_source.png', [('crops', [c, r, 1, h]) for c, r, h in (
        (6, 11, 1), (6, 13, 1), (6, 15, 1), (6, 17, 1),          # cabbage
        (10, 1, 1), (10, 3, 1), (10, 5, 1), (10, 7, 1),          # turnip
        (0, 1, 1), (0, 3, 1), (0, 5, 1), (0, 7, 1),              # carrot
        (12, 1, 1), (12, 3, 1), (12, 5, 1), (16, 5, 1),          # flax
        (30, 1, 1), (30, 2, 2), (30, 4, 2), (30, 8, 2),          # hemp
        (9, 11, 1), (9, 13, 1), (9, 15, 1), (9, 17, 1),          # herbs
        (20, 11, 1), (20, 19, 1), (20, 13, 1), (20, 17, 1),      # strawberry
        (0, 9, 1))], 'small', 'shadows', 'gaps'),                                   # sown
    **{f'plants_{x}': (f'plants_{x}_source.png', [(f'plants_{x}', list(cs[0]), [list(c) for c in cs[1:]]) for cs in PLANT_CELLS], 'fresh')
       for x in ('spring', 'summer', 'autumn', 'winter')},
    # the grassland rocks (map fallback rocks, water's-edge stones): ten shapes, a colour band of four rows each
    'grocks': ('grocks_source.png', [('grocks', [c, r + 4 * b, w, h]) for b in range(3) for c, r, w, h in (
        (0, 0, 2, 3), (2, 0, 2, 2), (4, 0, 2, 2), (2, 2, 2, 1), (0, 3, 2, 1), (2, 3, 2, 1),
        (4, 2, 1, 1), (5, 2, 1, 1), (5, 3, 1, 1), (4, 3, 1, 1))]),
    # the interior furniture, 4 a row (innerMapRenderer.json interiorArt); its 32nd, a well, is skipped:
    # that cell is the town well, drawn in 'farm'
    'furniture': ('furniture_source.png', [('kitfurn', [i % 4, i // 4, 1, 1]) for i in range(31)] + [(None, None)]),
    'emblems': ('emblems_source.png', [('emblems', [c, r, 1, 1]) for r in range(4) for c in range(5)]),
    # oak, walnut, dark, red, blue, green, gold, navy panel doors; oak, dark, walnut, olive arched doors
    'doors': ('doors_source.png', [('door', [c, r, 1, 2]) for c, r in
                                   ((7, 1), (7, 9), (7, 29), (21, 1), (21, 5), (21, 9), (21, 13), (21, 29))]
              + [('arched', [0, r, 2, 2]) for r in (1, 4, 7, 10)], 'stretch'),
    # twelve frames, three down each of four columns, drawn a row at a time (their openings keyed out)
    'frames': ('frames_source.png', [('frame', [3 * k, 2 * j, 3, 2]) for j in range(3) for k in range(4)], 'holes', 'stretch'),
    'farm': ('farm_source.png', [
        ('farm', [5, 3, 3, 5, 0.68]), ('farm', [0, 0, 1, 2]), ('farm', [3, 0, 2, 2]), ('farm', [6, 0, 1, 2, 0.8]),
        ('farm', [3, 2, 2, 2, 0.8]), ('farm', [1, 2, 1, 2, 0.75])]
        + [('farm', [c, 10, 1, 1, 0.75]) for c in (8, 9, 10, 12, 13, 14)] + [('kitfurn', [3, 7, 1, 1])], 'holes'),
    # (an awning is used as the one cell 16px down from a cell's top: row 0.5 / 3.5)
    'parts': ('parts_source.png', [('chimney', [c, r, 1, 2]) for c in (1, 4) for r in (0, 2, 4)]
              + [('signs', [0, 0, 1, 1]), ('signs', [1, 0, 1, 1]), ('signs', [0, 1, 1, 1]), ('signs', [1, 1, 1, 1])]
              + [('awnings', [c, r, 1, 1]) for r in (0.5, 3.5) for c in (2, 5, 8)]),
    'flowers': ('flowers_source.png', [('flowers', [c, 1, 1, 1]) for c in (0, 1, 2, 3, 5, 7, 8)]
                + [('flowers', [c, r, 1, 1]) for r in (2, 3) for c in (5, 6, 7, 8)]),
    'props2': ('props2_source.png', [
        ('lamp', [0, 0, 1, 3]), ('lamp', [1, 0, 1, 3]), (None, None), (None, None),   # (the hay: 'hay' below)
        ('fountain', [0, 0, 2, 3]), ('runestone', [0, 0, 2, 2]), ('runestone', [2, 0, 2, 2]), ('campfire', [0, 0, 1, 1]),
        ('campfire', [0, 1, 1, 1], [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]]),
        ('pillar', [0, 0, 2, 3]), ('pillar', [3, 0, 2, 3]), ('pillar', [6, 0, 2, 3]), ('pillar', [2, 0, 1, 3]),
        ('clan_tents', [0, 0, 3, 3]), ('clan_tents', [3, 0, 3, 3]), ('pool', [0, 0, 3, 3])]),
    # the loose hay and straw, redrawn with real transparency (the white-keyed piles kept specks of
    # the background caught between their strands)
    'hay': ('hay_source.png', [('hay', [0, 0, 2, 3]), ('hay', [2, 0, 2, 3])]),
    'props1': ('props1_source.png', [
        ('barrel', [0, 0, 1, 2, 0.8]), ('barrel', [1, 0, 1, 2, 0.8]), ('barrel', [3, 0, 2, 2, 0.8]), ('crate', [0, 0, 1, 2, 0.8]),
        ('crate', [1, 1, 1, 1, 0.75]), ('crate', [2, 1, 1, 1]), ('sawhorse', [0, 0, 1, 2]), ('lumber', [0, 2, 2, 1]),
        ('lumber', [2, 2, 2, 1]), ('buckets', [0, 0, 1, 1, 0.75]), ('baskets', [2, 0, 1, 2, 0.7])]),
    'planter': ('planter_source.png', [
        ('planter', [1, 0, 1, 3]), ('planter', [2, 0, 1, 3]), ('planter', [0, 1, 1, 2]), ('planter', [3, 1, 1, 2, 0.8]),
        ('planter', [4, 1, 1, 2]), ('planter', [3, 0, 1, 1, 0.85]), ('planter', [4, 0, 1, 1])]),
}


def objects(im, min_frac=0.03):
    """The separate drawings of a source, in reading order (rows by their middles)."""
    a = np.array(im)
    mask = a[..., 3] > 0
    lab, k = ndimage.label(ndimage.binary_dilation(mask, iterations=4))
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    objs = ndimage.find_objects(lab)
    found = []
    for i in range(k):
        if sizes[i] < sizes.max() * min_frac:
            continue
        b = objs[i]
        sub = a[b].copy()
        sub[lab[b] != i + 1] = 0
        found.append(((b[0].start + b[0].stop) / 2, (b[1].start + b[1].stop) / 2, b[0].stop - b[0].start,
                      Image.fromarray(sub, 'RGBA')))
    # group into rows: a drawing joins a row when its height span overlaps the row's
    # (so a sprout beside a tall stalk stays in its row)
    found.sort(key=lambda f: f[0] - f[2] / 2)
    rows = []
    for f in found:
        top, bot = f[0] - f[2] / 2, f[0] + f[2] / 2
        if rows and top < rows[-1][1] - min(f[2], rows[-1][2]) * 0.3:
            rows[-1][0].append(f)
            rows[-1][1] = max(rows[-1][1], bot)
            rows[-1][2] = min(rows[-1][2], f[2])
        else:
            rows.append([[f], bot, f[2]])
    rows = [r[0] for r in rows]
    return [f[3] for row in rows for f in sorted(row, key=lambda f: f[1])]


def old_box(key, c, r, w, h):
    """The old sprite's box inside the rectangle, at 4x (x0, y0, x1, y1, relative to the rectangle)."""
    # (every season's plants take the summer sheet's boxes: in winter the old leafy plants were stubs)
    path = SHEETS['plants_summer' if key.startswith('plants_') else key][0]
    a = np.array(Image.open(os.path.join('assets', path)).convert('RGBA'))
    sub = a[int(r * 32):int((r + h) * 32), int(c * 32):int((c + w) * 32), 3] > 0
    ys, xs = np.where(sub)
    if not len(ys):
        return 0, 0, w * C, h * C
    return xs.min() * 4, ys.min() * 4, (xs.max() + 1) * 4, (ys.max() + 1) * 4


def fit(im, w, h, box, stretch=False):
    x0, y0, x1, y1 = box
    if stretch:   # fill the box exactly (a door in its doorway)
        t = im.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    else:
        s = min((x1 - x0) / im.width, (y1 - y0) / im.height)
        t = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    block = Image.new('RGBA', (w * C, h * C), (0, 0, 0, 0))
    block.alpha_composite(t, ((x0 + x1 - t.width) // 2, y1 - t.height))
    return block


def build(name):
    source, items, *opts = RECIPES[name]
    # ('shadows': key wider from the edge in, taking the pale grey ground shadows drawn under plants;
    #  'gaps': key the little patches of background caught between leaves, but not a white petal)
    src = Image.open(os.path.join(NEW, source))
    if src.mode == 'RGBA' and np.array(src)[..., 3].min() < 16:
        keyed = src.convert('RGBA')   # drawn with real transparency: nothing to key
    else:
        keyed = key_white(src, tol=70 if 'shadows' in opts else 28, holes=40 if 'gaps' in opts else 'holes' in opts)
    objs = objects(keyed, min_frac=0.004 if 'small' in opts else 0.03)
    if len(objs) != len(items):
        raise SystemExit(f'{name}: found {len(objs)} drawings, want {len(items)}')
    sheets = {}
    clear = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    flat = []
    for im, item in zip(objs, items):
        if item[0] is None:
            continue
        for rect in [item[1]] + (item[2] if len(item) > 2 else []):
            flat.append((im, item[0], rect))
    for im, key, rect in flat:
        c, r, w, h = rect[:4]
        if 'f' in rect[4:]:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        shrink = next((x for x in rect[4:] if isinstance(x, float)), 1.0)
        if key not in sheets:
            path, (cols, rows) = SHEETS[key]
            mod = os.path.join('assets/modern', path)
            if not os.path.exists(mod):   # no repaint yet: the original at 4x, cell for cell
                o = Image.open(os.path.join('assets', path)).convert('RGBA')
                os.makedirs(os.path.dirname(mod), exist_ok=True)
                o.resize((o.width * 4, o.height * 4), Image.NEAREST).save(mod)
            sheets[key] = Image.open(mod).convert('RGBA')
            if 'fresh' in opts:   # nothing of the old sheet kept (the plant scatter takes any lone cell)
                sheets[key] = Image.new('RGBA', sheets[key].size, (0, 0, 0, 0))
            assert sheets[key].size == (cols * C, rows * C), (key, sheets[key].size)
        sheet = sheets[key]
        for y in range(h):
            for x in range(w):
                sheet.paste(clear, (int((c + x) * C), int((r + y) * C)))
        # (a sheet this script writes in full has no old sprite to measure: its whole rectangle)
        box = (0, 0, w * C, h * C) if 'downscale' in opts else old_box(key, c, r, w, h)
        if shrink != 1.0:   # smaller than the old sprite (the LPC one was out of scale with a person)
            x0, y0, x1, y1 = box
            bw, bh = (x1 - x0) * shrink, (y1 - y0) * shrink
            box = (round((x0 + x1 - bw) / 2), round(y1 - bh), round((x0 + x1 + bw) / 2), y1)
        sheet.alpha_composite(fit(im, w, h, box, 'stretch' in opts), (int(c * C), int(r * C)))
    for key, sheet in sheets.items():
        out = os.path.join('assets/modern', SHEETS[key][0])
        sheet.save(out)
        print('wrote', out, sheet.size)
        if 'downscale' in opts:
            small = os.path.join('assets', SHEETS[key][0])
            sheet.resize((sheet.width // 4, sheet.height // 4), Image.LANCZOS).save(small)
            print('wrote', small)


def door_awnings():
    """The awnings over doors: a doorway with its frame is a tile and a half wide, so these are
    48px across (Door Awnings.png, six in a row, white, yellow, orange, slate, blue, green), where a
    window's awning is the one cell of Window Awnings A. The 32px sheet is the 4x one scaled down."""
    objs = objects(key_white(Image.open(os.path.join(NEW, 'parts_source.png'))))[10:16]
    W, H = 48 * 4, 32 * 4
    sheet = Image.new('RGBA', (W * 6, H), (0, 0, 0, 0))
    for i, im in enumerate(objs):
        # the canopy across the whole width, its poles to the bottom, as the window awnings sit
        sheet.alpha_composite(_fit_box(im, W, H, (0, 16, W, H)), (i * W, 0))
    out = 'assets/modern/lpc/Structure/Windows/Door Awnings.png'
    sheet.save(out)
    small = 'assets/lpc/Structure/Windows/Door Awnings.png'
    sheet.resize((sheet.width // 4, sheet.height // 4), Image.LANCZOS).save(small)
    print('wrote', out, small)


def _fit_box(im, W, H, box):
    x0, y0, x1, y1 = box
    t = im.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    block = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    block.alpha_composite(t, (x0, y0))
    return block


if __name__ == '__main__':
    for n in sys.argv[1:] or list(RECIPES) + ['door_awnings']:
        door_awnings() if n == 'door_awnings' else build(n)
