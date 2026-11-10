"""
Two fixes to the LPC arming sword's own sheets (assets/lpc/Characters/Props/
Sword 01 - Arming Sword/<Metal>/ and _Behind/<Metal>/). Nothing is drawn:

 1. The ready stance seen side-on ('Combat 1h - Idle', rows left and right):
    the LPC sword stands up past the face there. Its pixels are turned about
    the grip (resampled 4x4, the colour most samples hit) so the blade slants
    further forward, out in front of the face. Every metal.
 2. Iron: the LPC iron ramp is near-black in its darker half. Every Iron sheet
    is moved onto the grey iron ramp of scripts/make_arms_layers.py (IRON),
    tone for tone.

Run before scripts/make_arms_layers.py (whose weapons take the sword's pose
in each frame): python scripts/make_arms_sword.py
"""
import glob
import math
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_pose import CELL, pose_of, wrists  # noqa: E402
from make_arms_layers import IRON  # noqa: E402

SWORD = 'assets/lpc/Characters/Props/Sword 01 - Arming Sword/'
LPC_IRON = [(0, 0, 0), (37, 32, 37), (57, 43, 52), (82, 65, 74), (111, 101, 99), (148, 128, 129)]
IDLE = 'Combat 1h - Idle'
TURN = math.radians(26)   # how much further forward the blade is turned


def _cell(im, r, f):
    return im.crop((f * CELL, r * CELL, (f + 1) * CELL, (r + 1) * CELL))


def _turn(cell, grip, ang):
    """The cell's pixels turned by ang (radians, clockwise on screen) about grip: each pixel
    sampled 4x4, kept when half the samples land on the sprite, in the colour most of them hit."""
    import numpy as np
    a = np.array(cell)
    SS = 4
    o = (np.arange(CELL * SS) + 0.5) / SS
    X, Y = np.meshgrid(o, o)
    c, s_ = math.cos(-ang), math.sin(-ang)
    vx, vy = X - grip[0], Y - grip[1]
    sx = np.floor(grip[0] + vx * c - vy * s_).astype(int)
    sy = np.floor(grip[1] + vx * s_ + vy * c).astype(int)
    ok = (sx >= 0) & (sx < CELL) & (sy >= 0) & (sy < CELL)
    key = np.full(sx.shape, -1)
    flat = a.reshape(-1, 4)
    idx = np.where(ok, sy.clip(0, CELL - 1) * CELL + sx.clip(0, CELL - 1), 0)
    solid = ok & (flat[idx][..., 3] > 0)
    key[solid] = idx[solid]
    key = key.reshape(CELL, SS, CELL, SS).transpose(0, 2, 1, 3).reshape(CELL, CELL, SS * SS)
    out = np.zeros((CELL, CELL, 4), dtype=np.uint8)
    for y in range(CELL):
        for x in range(CELL):
            ks = key[y, x][key[y, x] >= 0]
            if len(ks) * 2 < SS * SS:
                continue
            cols = [tuple(flat[k]) for k in ks]
            out[y, x] = max(set(cols), key=cols.count)
    return Image.fromarray(out, 'RGBA')


def ready_side(metal):
    paths = [SWORD + metal + '/', SWORD + '_Behind/' + metal + '/']
    if not all(os.path.exists(d + IDLE + '.png') for d in paths):
        return
    idle = [Image.open(d + IDLE + '.png').convert('RGBA') for d in paths]
    # the original steel sheets fix where the hand holds it (the same for every metal)
    st = [Image.open(SWORD + m + 'Steel/' + IDLE + '.png').convert('RGBA') for m in ('', '_Behind/')]
    for r in (1, 3):
        fx = -1 if r == 1 else 1
        for f in range(idle[0].width // CELL):
            pose = pose_of(_cell(st[0], r, f), _cell(st[1], r, f), wrists(IDLE, r, f))
            if abs(math.degrees(math.atan2(pose['dir'][0], -pose['dir'][1]))) > 60:
                return   # turned already (a second run leaves the sheets as they are)
            for k in (0, 1):
                turned = _turn(_cell(idle[k], r, f), pose['grip'], fx * TURN)
                idle[k].paste(turned, (f * CELL, r * CELL))
    for d, im in zip(paths, idle):
        im.save(d + IDLE + '.png')


def iron():
    m = dict(zip(LPC_IRON, IRON))
    for p in glob.glob(SWORD + 'Iron/*.png') + glob.glob(SWORD + '_Behind/Iron/*.png'):
        im = Image.open(p).convert('RGBA')
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                c = px[x, y]
                if c[3] and c[:3] in m:
                    px[x, y] = m[c[:3]] + (c[3],)
        im.save(p)


if __name__ == '__main__':
    for metal in sorted(os.listdir(SWORD + '_Behind')):
        if os.path.isdir(SWORD + metal):
            ready_side(metal)
    iron()
    print('sword done')
