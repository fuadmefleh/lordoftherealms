# Some LPC clothing ships only walk-style sheets (overalls, shorts, boots, socks,
# suspenders): with no "Combat 1h - Slash" / "Halfslash" / "Legacy - Swing" /
# "Combat 1h - Idle" sheet the layer is skipped in those animations, and a farmer
# swinging a hoe loses their trousers (a guard on guard, the ready stance, stood
# barefoot). This writes the missing sheets from the nearest item that has them,
# in the same colour:
#   overalls          <- Pants 03 - Pants (the legs are what move in a swing)
#   shorts            <- Pants 03 - Pants, cut off where the shorts end on that
#                        facing's walk frames
#   boots             <- Shoes 01 - Shoes, its shaft grown up the shin as far as
#                        the boots stand above the shoes on their own Idle sheet
#                        (these are always rewritten: they are derived)
#   socks, suspenders <- a transparent sheet (under the shoes / a thin strap)
# Existing sheets are never overwritten.
#
#   python scripts/make_combat_clothing.py
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'lpc', 'Characters', 'Clothing')
ANIMS = ['Combat 1h - Slash', 'Combat 1h - Halfslash', 'Legacy - Swing', 'Combat 1h - Idle']
BODIES = {'Masculine, Thin': 'Body 02 - Masculine, Thin', 'Feminine, Thin': 'Body 01 - Feminine, Thin'}
FRAME = 64
PLAN = {
    ('Legs', 'Pants 05 - Overalls'): ('Legs', 'Pants 03 - Pants', None),
    ('Legs', 'Shorts 01 - Shorts'): ('Legs', 'Pants 03 - Pants', 'cut'),
    ('Legs', 'Shorts 02 - Short Shorts'): ('Legs', 'Pants 03 - Pants', 'cut'),
    ('Feet', 'Shoes 02 - Boots'): ('Feet', 'Shoes 01 - Shoes', 'shaft'),
    ('Feet', 'Socks 01 - Ankle Socks'): None,
    ('Feet', 'Socks 02 - High Socks'): None,
    ('Torso 2', 'Accessory 01 - Suspenders'): None,
}


def cut_rows(walk):
    """Per facing row: the lowest opaque row of the item on its walk frames (in-frame y)."""
    rows = []
    for d in range(walk.height // FRAME):
        low = 0
        for f in range(walk.width // FRAME):
            box = walk.crop((f * FRAME, d * FRAME, (f + 1) * FRAME, (d + 1) * FRAME)).getbbox()
            if box:
                low = max(low, box[3])
        rows.append(low or FRAME)
    return rows


def shaft_rows(item_dir, donor_dir):
    """Per facing row: how many px the boot's top stands above the shoe's (their Idle sheets)."""
    out = []
    bi = Image.open(os.path.join(item_dir, 'Idle.png')).convert('RGBA')
    si = Image.open(os.path.join(donor_dir, 'Idle.png')).convert('RGBA')
    for d in range(bi.height // FRAME):
        bb = bi.crop((0, d * FRAME, FRAME, (d + 1) * FRAME)).getbbox()
        sb = si.crop((0, d * FRAME, FRAME, (d + 1) * FRAME)).getbbox()
        out.append(max(0, sb[1] - bb[1]) if bb and sb else 0)
    return out


def grow_shaft(img, body, rows):
    """The shoe's upper, carried up the shin: each column of a shoe climbs `rows[facing]` px
    over the leg (where the body is painted), in the upper's own shade, outlined at its top
    and its sides, so the shoe reads as a boot."""
    px = img.load()
    bp = body.load() if body is not None and body.size == img.size else None
    w, h = img.size
    for d in range(h // FRAME):
        grow = rows[min(d, len(rows) - 1)]
        if not grow:
            continue
        for fx in range(w // FRAME):
            x0, y0 = fx * FRAME, d * FRAME
            tops = {}
            for x in range(x0, x0 + FRAME):
                for y in range(y0, y0 + FRAME):
                    if px[x, y][3] > 0:
                        tops[x] = y
                        break
            if not tops:
                continue
            outline = min((px[x, t] for x, t in tops.items()), key=lambda c: sum(c[:3]))
            for x, t in tops.items():
                below = px[x, t + 1] if t + 1 < y0 + FRAME and px[x, t + 1][3] > 0 else px[x, t]
                edge = (x - 1 not in tops) or (x + 1 not in tops)
                top = t
                for y in range(t - 1, max(y0, t - grow) - 1, -1):
                    if bp is not None and bp[x, y][3] == 0:
                        break
                    px[x, y] = outline if edge else below
                    top = y
                if top < t:
                    if not edge:
                        px[x, t] = below
                    px[x, top] = outline
    return img


def main():
    made = 0
    for build in sorted(os.listdir(ROOT)):
        for (part, item), donor in PLAN.items():
            idir = os.path.join(ROOT, build, part, item)
            if not os.path.isdir(idir):
                continue
            for colour in sorted(os.listdir(idir)):
                cdir = os.path.join(idir, colour)
                walk_p = os.path.join(cdir, 'Walk.png')
                if not os.path.isdir(cdir) or not os.path.exists(walk_p):
                    continue
                walk = Image.open(walk_p).convert('RGBA')
                cuts = cut_rows(walk) if donor and donor[2] == 'cut' else None
                shaft = donor and donor[2] == 'shaft'
                if shaft:
                    ddir = os.path.join(ROOT, build, donor[0], donor[1], colour)
                    if not os.path.exists(os.path.join(cdir, 'Idle.png')) or not os.path.exists(os.path.join(ddir, 'Idle.png')):
                        continue
                    grow = shaft_rows(cdir, ddir)
                for anim in ANIMS:
                    out = os.path.join(cdir, anim + '.png')
                    if os.path.exists(out) and not shaft:
                        continue
                    src = os.path.join(ROOT, build, donor[0], donor[1], colour, anim + '.png') if donor else None
                    if donor and not os.path.exists(src):
                        print('no donor for', build, item, colour, anim)
                        continue
                    if donor:
                        img = Image.open(src).convert('RGBA')
                        if cuts:
                            px = img.load()
                            for d, low in enumerate(cuts):
                                for y in range(d * FRAME + low, min(img.height, (d + 1) * FRAME)):
                                    for x in range(img.width):
                                        px[x, y] = (0, 0, 0, 0)
                        if shaft:
                            bdir = os.path.join(ROOT, '..', 'Body', BODIES.get(build, ''), 'Peach', anim + '.png')
                            body = Image.open(bdir).convert('RGBA') if os.path.exists(bdir) else None
                            img = grow_shaft(img, body, grow)
                    else:
                        # the size the animation's other layers use (the body's own sheet)
                        bdir = os.path.join(ROOT, '..', 'Body', BODIES.get(build, ''), 'Peach', anim + '.png')
                        size = Image.open(bdir).size if os.path.exists(bdir) else (6 * FRAME, 4 * FRAME)
                        img = Image.new('RGBA', size, (0, 0, 0, 0))
                    img.save(out)
                    made += 1
    print('sheets written:', made)


main()
