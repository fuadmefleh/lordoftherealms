#!/usr/bin/env python3
"""
scripts/build-companion-sheets.py

Builds the game sheets of the player's own animals (dog, cat, hawk:
data/animalCompanions.json species.*.sprite) from PixelLab frames, laid out
as the painted animal series (scripts/build-animal-sheets.py): 512x512, a 4x4
grid of 128px cells, rows up/left/down/right, four frames a row, the feet on
one baseline (FOOT_Y) and each direction centred on the cell.

The frames came from PixelLab (2026-11-14, see assets/lpc/Animals/Credits.txt):
a still per animal drawn with generate-with-style-v2 against crops of the
series (wolf, fox, duck), turned to every side with generate-8-rotations-v3,
then animated per side with animate-with-text-v3 on a 128px canvas (walk,
idle, the dog's bite; the hawk's wing beat). All frames of one side share the
canvas of its still, so one shift per side (the still's feet on FOOT_Y, its
middle on the cell's) keeps walk, idle and attack lined up when the game
swaps between them. The left row is the right row mirrored.

    python scripts/build-companion-sheets.py [dog cat hawk]

assets/lpc/Animals/_pixellab_frames/ holds <animal>_<action>_<side>_<i>.png (side e/n/s, PixelLab's
numbering, frame 0 = the still) and <animal>128_<side>.png (the stills).
PICKS below says which four frames make each row.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ANIMALS = os.path.join(HERE, '..', 'assets', 'lpc', 'Animals')
FRAMES = os.path.join(ANIMALS, '_pixellab_frames')
CELL = 128
FOOT_Y = 124
ALPHA_MIN = 24

# animal: { sheet action: (frame action name, { side: [4 frame indices] }) }
PICKS = {
    'dog': {
        'walk': ('walk', {'e': [2, 4, 6, 8], 'n': [1, 3, 5, 7], 's': [1, 3, 5, 7]}),
        'idle': ('idle', {'e': [0, 1, 2, 3], 'n': [0, 1, 2, 3], 's': [0, 1, 2, 3]}),
        # the lunge and bite (2026-11-17): crouch, spring, jaws agape, the snap, back,
        # and back in its stance (8: without it the bite ended with the head still
        # thrust out and snapped back to the walk); seven frames a row, so the
        # attack sheet is seven cells wide (sprite.attackCols)
        'attack': ('bite', {'e': [2, 3, 4, 5, 6, 7, 8], 'n': [2, 3, 4, 5, 6, 7, 8], 's': [2, 3, 4, 5, 6, 7, 8]}),
    },
    'cat': {
        'walk': ('walk', {'e': [1, 3, 5, 7], 'n': [1, 3, 5, 7], 's': [1, 3, 5, 7]}),
        'idle': ('idle', {'e': [0, 1, 2, 3], 'n': [0, 1, 2, 3], 's': [0, 1, 2, 3]}),
    },
    'hawk': {
        'fly': ('fly', {'e': [0, 2, 4, 6], 'n': [0, 1, 2, 3], 's': [0, 1, 2, 3]}),
    },
}
# frames drawn on a canvas whose still was moved off the still's own place (room
# ahead to lunge into): animal_action: { side: (dx, dy) the still was moved by }
CANVAS_SHIFT = {
    'dog_bite': {'e': (-15, 0), 'n': (0, 6), 's': (0, -6)},
}
# actions whose every frame stands its own feet on FOOT_Y: the bite's frames walk
# their feet about the canvas (the dog coming at you, the 's' side, sank 12px over
# the bite and its crouch hovered 8px over the walk's ground, a pop at each end);
# the game's own lunge (sprite.attackLunge) carries the body forward instead
FEET_EACH = {'dog_bite'}
# the game sheet's rows: (row, side, mirrored)
ROWS = [(0, 'n', False), (1, 'e', True), (2, 's', False), (3, 'e', False)]


def clean(im):
    r, g, b, a = im.convert('RGBA').split()
    return Image.merge('RGBA', (r, g, b, a.point(lambda v: 0 if v < ALPHA_MIN else v)))


def build(src, animal):
    stills = {s: clean(Image.open(os.path.join(src, f'{animal}128_{s}.png'))) for s in 'ens'}
    shift = {}
    for s, im in stills.items():
        x0, _, x1, y1 = im.getbbox()
        shift[s] = (round(CELL / 2 - (x0 + x1) / 2), FOOT_Y - y1)
    out = {}
    for action, (name, sides) in PICKS[animal].items():
        ncols = max(len(v) for v in sides.values())
        sheet = Image.new('RGBA', (CELL * ncols, CELL * 4), (0, 0, 0, 0))
        for row, side, mirror in ROWS:
            frames = []
            for i in sides[side]:
                fr = clean(Image.open(os.path.join(src, f'{animal}_{name}_{side}_{i}.png')))
                if fr.size != (CELL, CELL):
                    fr = fr.resize((CELL, CELL), Image.BOX)
                frames.append(fr)
            cx, cy = CANVAS_SHIFT.get(f'{animal}_{name}', {}).get(side, (0, 0))
            dx, dy = shift[side][0] - cx, shift[side][1] - cy
            # a lunge reaching past the cell is pulled back into it (the game's own
            # lunge offset carries the body forward on screen)
            boxes = [f.getbbox() for f in frames if f.getbbox()]
            if boxes:
                dx = max(min(dx, CELL - 1 - max(b[2] for b in boxes)), -min(b[0] for b in boxes))
                dy = max(min(dy, CELL - max(b[3] for b in boxes)), -min(b[1] for b in boxes))
            if mirror:
                dx = -dx
            for col, fr in enumerate(frames):
                fdy = dy
                if f'{animal}_{name}' in FEET_EACH and fr.getbbox():
                    _, top, _, bottom = fr.getbbox()
                    fdy = max(FOOT_Y - bottom, -top)
                if mirror:
                    fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
                cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
                cell.alpha_composite(fr, (max(0, dx), max(0, fdy)), (max(0, -dx), max(0, -fdy)))
                sheet.alpha_composite(cell, (col * CELL, row * CELL))
        dest = os.path.join(ANIMALS, animal, f'{animal}_{action}_sheet.png')
        sheet.save(dest, optimize=True)
        out[action] = dest
    # the side view's body length in the cell (drawTiles = length in tiles * CELL / this)
    bb = stills['e'].getbbox()
    print(f'{animal}: {", ".join(out)}; side length {bb[2] - bb[0]}px, height {bb[3] - bb[1]}px')


if __name__ == '__main__':
    for a in (sys.argv[1:] or PICKS):
        build(FRAMES, a)
