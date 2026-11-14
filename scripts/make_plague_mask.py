"""Make the plague doctor's mask: an LPC head-accessory layer (a black wide-brimmed
hat, a dark hood over the head and a pale beaked mask with glass eyes).

Every frame of every animation is drawn over the LPC masculine head's own frame
(its silhouette and bounding box give where the head is, so the mask bobs and
turns with it). Writes one sheet per animation, the same names and sizes as the
head's, to

    assets/lpc/Characters/Head Accessories/Mask 01 - Plague Doctor/Black/

Used by the plague doctors on the street map (ui/innerMapPlague.js, the layers
in data/plague.json street.doctorLayers). Run from the repo root:

    python scripts/make_plague_mask.py
"""
import os
from PIL import Image

ROOT = os.path.join('assets', 'lpc', 'Characters')
HEAD = os.path.join(ROOT, 'Head', 'Head 02 - Masculine', 'Ivory')
OUT = os.path.join(ROOT, 'Head Accessories', 'Mask 01 - Plague Doctor', 'Black')
SKIP = {'Expressions.png'}
F = 64

# Palette (outline, base, light) for each part
HAT = ((14, 12, 16, 255), (34, 30, 38, 255), (62, 56, 70, 255))
BAND = (92, 30, 26, 255)
HOOD = ((18, 16, 20, 255), (40, 36, 44, 255), (58, 52, 62, 255))
BEAK = ((52, 40, 26, 255), (205, 187, 146, 255), (232, 220, 186, 255), (156, 138, 98, 255))
LENS = ((20, 24, 30, 255), (143, 179, 196, 255))


def head_box(frame):
    """(L, T, R, B) inclusive of the head's opaque pixels, or None."""
    bb = frame.getbbox()
    if not bb:
        return None
    return bb[0], bb[1], bb[2] - 1, bb[3] - 1


def put(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def draw_hood(out, head, ox, oy, box):
    """The hood over the head below the brim: the head's own silhouette, outlined."""
    L, T, R, B = box
    for y in range(T + 5, B + 2):
        for x in range(L - 1, R + 2):
            inside = 0 <= x < F and 0 <= y < F and head.getpixel((x, y))[3] > 0
            if not inside:
                continue
            edge = any(not (0 <= x + dx < F and 0 <= y + dy < F and head.getpixel((x + dx, y + dy))[3] > 0)
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            col = HOOD[0] if edge else (HOOD[2] if x < (L + R) // 2 - 3 else HOOD[1])
            put(out, ox + x, oy + y, col)
    # a fold of the hood on the shoulders
    for x in range(L + 1, R):
        put(out, ox + x, oy + B + 1, HOOD[0])


def draw_hat(out, ox, oy, box, facing):
    L, T, R, B = box
    cx = (L + R) // 2
    # the crown: a tall flat-topped crown, narrower than the head
    c0, c1 = L + 3, R - 3
    for y in range(T - 3, T + 4):
        for x in range(c0, c1 + 1):
            edge = x in (c0, c1) or y == T - 3
            col = HAT[0] if edge else (HAT[2] if x == c0 + 1 or y == T - 2 else HAT[1])
            put(out, ox + x, oy + y, col)
    # its band
    for x in range(c0 + 1, c1):
        put(out, ox + x, oy + T + 2, BAND)
    # the wide brim
    b0, b1 = L - 4, R + 4
    if facing == 'left':
        b0 -= 2
    elif facing == 'right':
        b1 += 2
    for x in range(b0, b1 + 1):
        put(out, ox + x, oy + T + 4, HAT[0] if x in (b0, b1) else HAT[2])
        put(out, ox + x, oy + T + 5, HAT[0])
    _ = cx


def draw_front(out, ox, oy, box):
    """Facing us: the beak hangs down the middle, a glass eye each side."""
    L, T, R, B = box
    cx = (L + R) / 2.0
    top = T + 10
    tip = B + 5
    n = tip - top
    for i in range(n + 1):
        y = top + i
        half = max(0.5, 4.0 * (1 - i / (n + 1)))
        x0, x1 = int(round(cx - half)), int(round(cx + half)) - 1
        for x in range(x0, x1 + 1):
            if x in (x0, x1):
                col = BEAK[0]
            elif x >= cx + 0.5:
                col = BEAK[3]
            elif x == x0 + 1 and i < n - 2:
                col = BEAK[2]
            else:
                col = BEAK[1]
            put(out, ox + x, oy + y, col)
    put(out, ox + int(cx) - 1, oy + tip + 1, BEAK[0])
    # the lenses
    ey = T + 8
    for ex in (int(cx) - 6, int(cx) + 3):
        for dx in range(3):
            for dy in range(2):
                put(out, ox + ex + dx, oy + ey + dy, LENS[0])
        put(out, ox + ex + 1, oy + ey, LENS[1])


def draw_side(out, ox, oy, box, facing):
    """Side on: the beak juts out before the face and curves down; one glass eye."""
    L, T, R, B = box
    s = -1 if facing == 'left' else 1
    root = L + 3 if facing == 'left' else R - 3
    top = T + 9
    # (top, bottom) rows of the beak at each step out from the face: thick at the root,
    # tapering and curving down to the tip
    shape = [(0, 5), (0, 5), (1, 5), (1, 5), (2, 5), (2, 6), (3, 6), (4, 6), (5, 7), (6, 7)]
    length = len(shape) - 1
    for i, (a, b) in enumerate(shape):
        x = root + s * i
        y0, y1 = top + a, top + b
        for y in range(y0, y1 + 1):
            if y in (y0, y1) or i == length:
                col = BEAK[0]
            elif y == y0 + 1:
                col = BEAK[2]
            elif y == y1 - 1:
                col = BEAK[3]
            else:
                col = BEAK[1]
            put(out, ox + x, oy + y, col)
    ex = (L + 4) if facing == 'left' else (R - 6)
    for dx in range(3):
        for dy in range(2):
            put(out, ox + ex + dx, oy + T + 8 + dy, LENS[0])
    put(out, ox + ex + 1, oy + T + 8, LENS[1])


def main():
    os.makedirs(OUT, exist_ok=True)
    made = 0
    for name in sorted(os.listdir(HEAD)):
        if not name.endswith('.png') or name in SKIP:
            continue
        src = Image.open(os.path.join(HEAD, name)).convert('RGBA')
        out = Image.new('RGBA', src.size, (0, 0, 0, 0))
        rows, cols = src.height // F, src.width // F
        for row in range(rows):
            facing = 'up' if rows == 1 else ['up', 'left', 'down', 'right'][row % 4]
            for col in range(cols):
                ox, oy = col * F, row * F
                head = src.crop((ox, oy, ox + F, oy + F))
                box = head_box(head)
                if not box:
                    continue
                draw_hood(out, head, ox, oy, box)
                if facing == 'down':
                    draw_front(out, ox, oy, box)
                elif facing in ('left', 'right'):
                    draw_side(out, ox, oy, box, facing)
                draw_hat(out, ox, oy, box, facing)
        out.save(os.path.join(OUT, name))
        made += 1
    with open(os.path.join(os.path.dirname(OUT), 'Credits.txt'), 'w', encoding='utf-8') as f:
        f.write('Mask 01 - Plague Doctor: drawn by scripts/make_plague_mask.py over the frames of the\n'
                'LPC "Head 02 - Masculine" head (see ../../Head/Credits.txt for its authors).\n')
    print(f'{made} sheets -> {OUT}')


if __name__ == '__main__':
    main()
