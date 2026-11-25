"""Draw the displays of the dead (systems/gibbets.js, world/deadDisplays.js) and pack them into one prop sheet.

Drawn here in code (no generated art): a head on a pike, a gibbet cage at a crossroads,
and a body left hanging on the gallows (the scaffold's own gallows sprite,
assets/executions/src/gallows.png, with the hanged drawn on). Each at three stages:
fresh, rotting, bones. Prints the townProps `rect` of each for data/townProps.json
(gb_spike_*, gb_gibbet_*, gb_gallows_*).

    py -3 scripts/make_display_sheet.py
"""
import json
import math
import os
from PIL import Image, ImageDraw

SRC = 'assets/executions/src'
OUT = 'assets/executions/displays.png'
T = 32
STAGES = ['fresh', 'rotting', 'bones']

INK = (24, 18, 14, 255)
WOOD = [(52, 38, 26, 255), (82, 62, 42, 255), (108, 84, 58, 255)]
IRON = [(34, 34, 38, 255), (62, 62, 68, 255), (96, 94, 100, 255)]
BLOOD = (120, 14, 12, 255)
OLD_BLOOD = (62, 22, 16, 255)
SKIN = {'fresh': [(150, 104, 82, 255), (196, 146, 118, 255), (220, 176, 148, 255)],
        'rotting': [(86, 96, 70, 255), (120, 128, 92, 255), (146, 150, 110, 255)]}
BONE = [(150, 140, 112, 255), (204, 196, 168, 255), (236, 230, 208, 255)]
HAIR = {'fresh': (58, 40, 28, 255), 'rotting': (46, 40, 34, 255)}
CLOTH = {'fresh': [(70, 58, 44, 255), (104, 86, 62, 255)], 'rotting': [(58, 54, 44, 255), (82, 76, 60, 255)]}


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((int(x), int(y)), c)


def outline(im):
    """A 1px dark outline round everything drawn (the LPC look)."""
    src = im.copy()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if src.getpixel((x, y))[3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and src.getpixel((xx, yy))[3] > 200:
                    im.putpixel((x, y), INK)
                    break
    return im


def pole(im, x, y0, y1, wdt=3):
    for y in range(y0, y1):
        for i in range(wdt):
            c = WOOD[0] if i == 0 else WOOD[2] if i == wdt - 1 and (y // 3) % 2 == 0 else WOOD[1]
            px(im, x + i, y, c)
        if (y * 7) % 11 == 0:
            px(im, x + 1, y, WOOD[0])


def head(im, cx, cy, stage, r=6):
    """A head, as it is by its stage; cx, cy its middle."""
    if stage == 'bones':
        pal = BONE
        for y in range(-r, r + 1):
            for x in range(-r, r + 1):
                if x * x + (y * 1.15) ** 2 <= r * r:
                    c = pal[2] if x < -1 and y < 0 else pal[1] if x < r - 2 else pal[0]
                    px(im, cx + x, cy + y, c)
        # the jaw, narrower
        for y in range(r - 1, r + 3):
            for x in range(-r + 2, r - 1):
                px(im, cx + x, cy + y, pal[1] if x < 2 else pal[0])
        for x in range(-r + 3, r - 2, 2):
            px(im, cx + x, cy + r + 1, INK)  # teeth
        for ex in (-3, 2):  # sockets
            for y in (0, 1):
                for x in (0, 1):
                    px(im, cx + ex + x, cy + y, INK)
        px(im, cx, cy + 3, INK)
        px(im, cx - 1, cy + 3, INK)
        return
    pal = SKIN[stage]
    for y in range(-r, r + 2):
        for x in range(-r, r + 1):
            if x * x + (y * 1.05) ** 2 <= r * r + 2:
                c = pal[2] if x < -1 and y < 0 else pal[1] if x < r - 2 else pal[0]
                px(im, cx + x, cy + y, c)
    # hair over the crown and down one side
    hair = HAIR[stage]
    for y in range(-r, -r + 3 if stage == 'fresh' else -r + 2):
        for x in range(-r + 1, r):
            if x * x + (y * 1.05) ** 2 <= r * r + 2:
                px(im, cx + x, cy + y, hair)
    for y in range(-r + 2, 2):
        px(im, cx + r - 1, cy + y, hair)
        px(im, cx - r, cy + y, hair)
    if stage == 'fresh':
        for ex in (-3, 2):  # shut eyes
            px(im, cx + ex, cy + 0, INK)
            px(im, cx + ex + 1, cy + 0, INK)
        px(im, cx - 1, cy + 3, INK)
        px(im, cx, cy + 3, INK)  # mouth fallen open
        px(im, cx, cy + 4, BLOOD)
    else:
        for ex in (-3, 2):  # sunken, pecked
            for y in (-1, 0, 1):
                px(im, cx + ex, cy + y, INK)
                px(im, cx + ex + 1, cy + y, INK)
        for x in range(-2, 3):
            px(im, cx + x, cy + 3, INK)  # the grin of the lips gone
        px(im, cx - 1, cy + 4, BONE[1])
        px(im, cx + 1, cy + 4, BONE[1])
        for (x, y) in ((-4, -2), (3, 3), (-2, 4)):  # bare patches
            px(im, cx + x, cy + y, BONE[0])


def crow(im, x, y):
    c, h = (20, 20, 26, 255), (60, 60, 72, 255)
    for dx, dy in ((0, 0), (1, 0), (2, 0), (3, 0), (1, -1), (2, -1), (3, -1), (4, -2), (5, -2), (4, -1), (-1, 1), (0, 1), (1, 1), (2, 1), (-2, 2), (2, 2)):
        px(im, x + dx, y + dy, c)
    px(im, x + 5, y - 2, (200, 160, 40, 255))  # beak
    px(im, x + 1, y - 1, h)


def spike(stage):
    im = Image.new('RGBA', (32, 96), (0, 0, 0, 0))
    pole(im, 15, 20, 94)
    # the iron point through the head
    for y in range(8, 20):
        px(im, 16, y, IRON[2] if y < 12 else IRON[1])
    px(im, 15, 19, IRON[0])
    px(im, 17, 19, IRON[0])
    # stones heaped round its foot
    d = ImageDraw.Draw(im)
    for (x, y, rw) in ((10, 91, 3), (20, 91, 3), (14, 93, 4), (23, 93, 2)):
        d.ellipse((x - rw, y - 2, x + rw, y + 2), fill=(108, 104, 96, 255))
        px(im, x - rw + 1, y - 1, (140, 136, 126, 255))
    head(im, 16, 24, stage, r=6)
    if stage == 'fresh':
        # the neck's ragged edge, and the blood run down the pole
        for x in range(12, 21):
            px(im, x, 31, BLOOD)
        for y in range(32, 62):
            if y % 5 != 3:
                px(im, 16, y, BLOOD)
        for y in range(32, 48):
            px(im, 17, y, BLOOD)
    elif stage == 'rotting':
        for x in range(13, 20):
            px(im, x, 31, OLD_BLOOD)
        for y in range(32, 52, 2):
            px(im, 16, y, OLD_BLOOD)
        crow(im, 18, 15)
    return outline(im)


def body(im, cx, top, stage, arms_bound=True):
    """A hanged man's body under a head at (cx, top): torso, arms, legs, as the days left it."""
    if stage == 'bones':
        pal = BONE
        for y in range(top, top + 3):  # neck bones
            px(im, cx, y, pal[1])
        for i, y in enumerate(range(top + 3, top + 14)):  # ribs and spine
            px(im, cx, y, pal[1])
            if i < 8 and i % 2 == 0:
                for x in range(-4, 5):
                    if x:
                        px(im, cx + x, y, pal[2] if x < 0 else pal[1])
        for x in range(-3, 4):  # pelvis
            px(im, cx + x, top + 14, pal[1])
            px(im, cx + x, top + 15, pal[0])
        for y in range(top + 3, top + 14):  # arms
            px(im, cx - 5, y, pal[1])
            px(im, cx + 5, y, pal[0])
        for y in range(top + 16, top + 28):  # legs
            px(im, cx - 2, y, pal[1])
            px(im, cx + 2, y, pal[0])
        return
    skin = SKIN[stage]
    cloth = CLOTH[stage]
    for y in range(top, top + 2):
        px(im, cx, y, skin[1])
        px(im, cx + 1, y, skin[0])
    for y in range(top + 2, top + 15):  # shirt
        for x in range(-4, 5):
            c = cloth[1] if x < 1 else cloth[0]
            if stage == 'rotting' and (x + y) % 5 == 0:
                c = (0, 0, 0, 0) if abs(x) > 2 else skin[0]
            if c[3]:
                px(im, cx + x, y, c)
    for y in range(top + 3, top + 14):  # arms hanging, bound behind
        px(im, cx - 5, y, cloth[1])
        px(im, cx + 5, y, cloth[0])
    px(im, cx - 5, top + 14, skin[1])
    px(im, cx + 5, top + 14, skin[0])
    for y in range(top + 15, top + 27):  # breeches
        for x in (-3, -2, -1):
            px(im, cx + x, y, (58, 50, 44, 255) if stage == 'fresh' else (54, 50, 42, 255))
        for x in (1, 2, 3):
            px(im, cx + x, y, (44, 38, 34, 255))
    for x in (-3, -2, 2, 3):  # bare feet
        px(im, cx + x, top + 27, skin[0])
        px(im, cx + x, top + 28, skin[0])


def gibbet(stage):
    im = Image.new('RGBA', (64, 96), (0, 0, 0, 0))
    pole(im, 10, 6, 94, 4)
    # the arm, and its brace
    for x in range(10, 54):
        px(im, x, 7, WOOD[2])
        px(im, x, 8, WOOD[1])
        px(im, x, 9, WOOD[1])
        px(im, x, 10, WOOD[0])
    for i in range(12):
        px(im, 14 + i, 22 - i, WOOD[1])
        px(im, 15 + i, 22 - i, WOOD[0])
    # the foot: a mound of earth and stones
    d = ImageDraw.Draw(im)
    d.ellipse((2, 88, 24, 95), fill=(92, 74, 52, 255))
    for (x, y) in ((5, 91), (19, 92), (12, 93)):
        d.ellipse((x - 2, y - 1, x + 2, y + 1), fill=(118, 114, 104, 255))
    # the chain
    for y in range(11, 26):
        px(im, 46, y, IRON[2] if y % 2 else IRON[0])
        if y % 2 == 0:
            px(im, 45, y, IRON[1])
            px(im, 47, y, IRON[1])
    # the cage: a man-shaped hoop of iron, 34..58 by 26..82
    cx, y0, y1 = 46, 26, 80
    head(im, cx, y0 + 8, stage, r=5)
    body(im, cx, y0 + 14, stage)
    for y in range(y0 + 4, y1):
        w = 9 if y > y0 + 14 else 7
        for x in (-w, -w // 2 - 1, 0 if y < y0 + 6 else None, w // 2 + 1, w):
            if x is None:
                continue
            px(im, cx + x, y, IRON[1] if x <= 0 else IRON[0])
    for y in (y0 + 4, y0 + 14, y0 + 32, y1 - 1):
        w = 9 if y > y0 + 14 else 7
        for x in range(-w, w + 1):
            px(im, cx + x, y, IRON[2] if x < 0 else IRON[1])
    for x in range(-4, 5):  # the crown of the cage
        px(im, cx + x, y0 + 1 + abs(x) // 2, IRON[1])
    if stage == 'rotting':
        crow(im, 49, y0 - 1)
        for (x, y) in ((44, 80), (47, 82), (45, 84)):
            px(im, x, y, OLD_BLOOD)
    if stage == 'bones':
        for x in range(cx - 4, cx + 5, 3):  # bones fallen through the bars
            px(im, x, 90, BONE[1])
            px(im, x + 1, 90, BONE[0])
    return outline(im)


def gallows(stage):
    im = Image.open(os.path.join(SRC, 'gallows.png')).convert('RGBA')
    fig = Image.new('RGBA', im.size, (0, 0, 0, 0))
    cx = 48
    # the noose's loop sits about (48, 37..42): the head just under it, the body below
    head(fig, cx, 39, stage, r=5)
    body(fig, cx, 45, stage)
    if stage == 'rotting':
        crow(fig, cx + 2, 31)
    outline(fig)
    im.alpha_composite(fig)
    return im


HIDE = {'fresh': [(128, 40, 36, 255), (168, 72, 62, 255), (198, 108, 92, 255)],
        'rotting': [(86, 58, 38, 255), (118, 84, 56, 255), (146, 110, 76, 255)],
        'bones': [(84, 72, 58, 255), (108, 94, 76, 255), (128, 114, 94, 255)]}


def hide_shape(y):
    """Half-width of a flayed skin hung by its wrists at row y (0 = the crossbar), or None outside it."""
    if y < 0:
        return None
    if y < 3:
        return 11  # the arms, stretched along the bar to the cords
    if y < 5:
        return 7
    if y < 24:
        return 6 if 6 <= y <= 14 else 5  # the trunk, a little wider at the chest
    if y < 38:
        return 6  # the legs, apart
    return None


def skin(stage):
    """A traitor's skin on a frame by the gate (systems/flaying.js): raw and red, dried to leather, then in tatters."""
    im = Image.new('RGBA', (32, 96), (0, 0, 0, 0))
    pole(im, 15, 10, 94)
    # the crossbar the skin hangs from
    for x in range(3, 30):
        px(im, x, 11, WOOD[2])
        px(im, x, 12, WOOD[1])
        px(im, x, 13, WOOD[0])
    d = ImageDraw.Draw(im)
    for (x, y, rw) in ((10, 91, 3), (20, 91, 3), (14, 93, 4)):
        d.ellipse((x - rw, y - 2, x + rw, y + 2), fill=(108, 104, 96, 255))
    pal = HIDE[stage]
    cx, top = 16, 14
    for yy in range(0, 38):
        w = hide_shape(yy)
        if w is None:
            continue
        for x in range(-w, w + 1):
            if yy >= 24 and abs(x) <= 1:
                continue  # between the legs
            if stage == 'bones' and ((x * 3 + yy * 5) % 13 == 0 or (yy > 30 and (x + yy) % 4 == 0) or (yy > 33 and abs(x) > 3)):
                continue  # rents and holes
            c = pal[2] if x < -w + 2 else pal[0] if x > w - 2 else pal[1]
            if stage != 'fresh' and (x * 7 + yy * 3) % 11 == 0:
                c = pal[0]  # wrinkles of the dried hide
            px(im, cx + x, top + yy, c)
    # the empty face at the top, a fold of the scalp with its hair
    for x in range(-2, 3):
        px(im, cx + x, top - 1, pal[1] if stage != 'bones' else pal[0])
        px(im, cx + x, top - 2, HAIR['fresh'] if stage == 'fresh' else HAIR['rotting'])
    for ex in (-1, 1):
        px(im, cx + ex, top + 1, INK)  # the eyeholes
    # the cords at the wrists
    for x in (cx - 12, cx + 12):
        px(im, x, top, (190, 170, 120, 255))
        px(im, x, top - 1, (190, 170, 120, 255))
    if stage == 'fresh':
        for (x, y0, y1) in ((cx - 3, top + 24, top + 50), (cx + 4, top + 22, top + 44), (cx, top + 20, top + 30)):
            for y in range(y0, y1):
                if y % 4 != 1:
                    px(im, x, y, BLOOD)
        crow(im, cx + 6, top - 4)
    elif stage == 'rotting':
        crow(im, cx - 10, top - 3)
    return outline(im)


def main():
    os.makedirs(SRC, exist_ok=True)
    made = []
    for kind, fn in (('spike', spike), ('gibbet', gibbet), ('gallows', gallows), ('skin', skin)):
        for st in STAGES:
            im = fn(st)
            name = f'display_{kind}_{st}'
            im.save(os.path.join(SRC, name + '.png'))
            made.append((f'{kind}_{st}', im))
    cells = []
    for name, im in made:
        bb = im.getbbox()
        # (keep the full width a sprite was drawn on, so the poles stand where they were drawn)
        im = im.crop((0, bb[1], im.width, im.height))
        cells.append((name, im, math.ceil(im.width / T), math.ceil(im.height / T)))
    H = max(h for _, _, _, h in cells)
    W = sum(w for _, _, w, _ in cells)
    sheet = Image.new('RGBA', (W * T, H * T), (0, 0, 0, 0))
    col = 0
    rects = {}
    for name, im, w, h in cells:
        sheet.alpha_composite(im, (col * T + (w * T - im.width) // 2, H * T - im.height))
        rects[name] = [col, H - h, w, h]
        col += w
    sheet.save(OUT)
    print(json.dumps(rects))


if __name__ == '__main__':
    main()
