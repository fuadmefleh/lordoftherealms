# Some LPC clothing ships only walk-style sheets (overalls, shorts, boots, socks,
# suspenders): with no "Combat 1h - Slash" / "Halfslash" / "Legacy - Swing"
# sheet the layer is skipped in those animations, and a farmer swinging a hoe
# loses their trousers. This writes the missing sheets from the nearest item that
# has them, in the same colour:
#   overalls          <- Pants 03 - Pants (the legs are what move in a swing)
#   shorts            <- Pants 03 - Pants, cut off where the shorts end on that
#                        facing's walk frames
#   boots             <- Shoes 01 - Shoes
#   socks, suspenders <- a transparent sheet (under the shoes / a thin strap)
# Existing sheets are never overwritten.
#
#   python scripts/make_combat_clothing.py
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'lpc', 'Characters', 'Clothing')
ANIMS = ['Combat 1h - Slash', 'Combat 1h - Halfslash', 'Legacy - Swing']
FRAME = 64
PLAN = {
    ('Legs', 'Pants 05 - Overalls'): ('Legs', 'Pants 03 - Pants', None),
    ('Legs', 'Shorts 01 - Shorts'): ('Legs', 'Pants 03 - Pants', 'cut'),
    ('Legs', 'Shorts 02 - Short Shorts'): ('Legs', 'Pants 03 - Pants', 'cut'),
    ('Feet', 'Shoes 02 - Boots'): ('Feet', 'Shoes 01 - Shoes', None),
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
                for anim in ANIMS:
                    out = os.path.join(cdir, anim + '.png')
                    if os.path.exists(out):
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
                    else:
                        # the size the animation's other layers use: 6 frames of 64 across, 4 facings
                        img = Image.new('RGBA', (6 * FRAME, 4 * FRAME), (0, 0, 0, 0))
                    img.save(out)
                    made += 1
    print('sheets written:', made)


main()
