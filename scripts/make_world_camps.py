"""Build the world map's camp sprites: a village still a camp of tents (a colony
freshly founded in play, a dawn village) is drawn with these instead of the
timber houses (ui/renderer/features.js renderSettlements).

    assets/tiles/pop_center_images/campCanvas00.png  canvas tents (colonies)
    assets/tiles/pop_center_images/campHide00.png    hide shelters (the dawn)

Each is a 256x384 frame like villageSmall00.png: the hex face is the lower part
(about y 190-370), so the tents stand in a loose ring there about a fire, on a
patch of trodden earth. The tents come from assets/lpc/Objects/Camp/Tents.png
(scripts/make_tent_sheet.py), the fire from the LPC camp fire.

    python scripts/make_world_camps.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENTS = os.path.join(ROOT, 'assets', 'lpc', 'Objects', 'Camp', 'Tents.png')
FIRE = os.path.join(ROOT, 'assets', 'lpc', 'Objects', 'Small Items', 'Fire, Camp.png')
OUT = os.path.join(ROOT, 'assets', 'tiles', 'pop_center_images')
T = 32

# (col, row) of each 4x4-cell tent in the sheet (keep in step with make_tent_sheet.py)
SETS = {
    'campCanvas00.png': [(16, 0), (20, 0), (16, 0), (20, 0), (16, 0)],
    'campHide00.png': [(0, 0), (8, 0), (4, 0), (12, 0), (0, 0)],
}
# Where each tent stands (its foot, in the 256x384 frame), back row first so the front overlaps
SPOTS = [(78, 262), (178, 258), (128, 236), (64, 334), (190, 330)]
SCALE = 0.62


def tent(sheet, col, row):
    box = (col * T, row * T, (col + 4) * T, (row + 4) * T)
    im = sheet.crop(box)
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    w, h = im.size
    return im.resize((max(1, round(w * SCALE)), max(1, round(h * SCALE))), Image.NEAREST)


def ground():
    """A soft patch of trodden earth on the hex face."""
    g = Image.new('RGBA', (256, 384), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    d.ellipse((28, 214, 228, 352), fill=(122, 98, 62, 150))
    d.ellipse((60, 238, 196, 330), fill=(138, 112, 72, 120))
    return g.filter(ImageFilter.GaussianBlur(6))


def main():
    sheet = Image.open(TENTS).convert('RGBA')
    fire_sheet = Image.open(FIRE).convert('RGBA')
    fire = fire_sheet.crop((0, 32, 32, 64))  # a lit fire frame
    fire = fire.resize((28, 28), Image.NEAREST)
    for name, cells in SETS.items():
        frame = ground()
        for (col, row), (fx, fy) in zip(cells, SPOTS):
            t = tent(sheet, col, row)
            frame.alpha_composite(t, (fx - t.width // 2, fy - t.height))
            if (fx, fy) == SPOTS[2]:
                # the fire in the ring's middle, before the front tents
                frame.alpha_composite(fire, (128 - 14, 296 - 28))
        frame.save(os.path.join(OUT, name))
        print('wrote', name)


if __name__ == '__main__':
    main()
