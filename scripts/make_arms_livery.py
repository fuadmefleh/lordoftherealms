"""
Livery on the soldiers' armour, and leather that reads as leather.
Nothing is drawn here: ChatGPT's drawings and the LPC sheets are cut,
aligned and recoloured to the LPC shirts' own colour ramps.

 1. Tabard (a surcoat over mail and plate, so a mailed man still shows his
    side's colours): assets/lpc/new/arms/tabard_source.png is ChatGPT's
    redraw of the mail source (mail_source.png) with a sleeveless red cloth
    tunic over the mail. scripts/make_arms_wear.py fits it to every frame of
    the long-sleeved shirt exactly as it fits the armour; the tunic is the
    red part of that fit. Each of its shading tones goes to the matching
    tone of an LPC shirt colour (the shirt's own ramp: the template
    shirt's levels -> that colour's pixels), one sheet set per livery colour:
    Clothing/<build>/Armour/Tabard/<Colour>/<anim>.png.
 2. Brigandine: its cloth cover (the reds) recoloured the same way, studs and
    sleeves kept: Clothing/<build>/Armour/Brigandine/<Colour>/<anim>.png (the
    red sheets in Armour/Brigandine stay for a man with no livery).
 3. Leather: its brown moved onto a buff, yellower leather ramp (no skin tone
    has that hue) with the seams kept dark, so a leather coat on any skin
    reads as leather, not a bare chest. In place; a second run changes nothing.

The livery colours: data/arms.json looks.liveryColours (the battle
liveries in data/military.json battlefield.looks.liveries). Run from the repo
root after scripts/make_arms_wear.py: python scripts/make_arms_livery.py
"""
import glob
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_arms_wear as wear  # noqa: E402

C = 'assets/lpc/Characters/'
BUILDS = ('Masculine, Thin', 'Feminine, Thin')
LONG = 'Shirt 01 - Longsleeve Shirt'
TEMPLATE_LEVELS = wear.LEVELS
BRIG_REDS = [(50, 13, 14), (68, 19, 21), (87, 26, 28), (105, 31, 33), (117, 42, 44)]   # levels 1..5
LEATHER = {
    (36, 27, 27): (38, 28, 22), (47, 29, 31): (58, 40, 26), (70, 38, 28): (92, 66, 36),
    (90, 45, 30): (116, 86, 46), (114, 56, 35): (142, 108, 58), (141, 71, 42): (168, 132, 72),
    (159, 88, 52): (194, 158, 94), (186, 126, 91): (228, 204, 142),
}


def colours():
    with open('data/arms.json', encoding='utf-8') as f:
        return json.load(f)['looks']['liveryColours']


def ramp(build, colour):
    """[level 0..5] -> rgb of an LPC shirt colour (the template's levels read through it)."""
    d = C + 'Clothing/' + build + '/Torso/' + LONG + '/'
    t = np.array(Image.open(d + 'Idle.png').convert('RGBA'))
    c = np.array(Image.open(d + colour + '/Idle.png').convert('RGBA'))
    out = {}
    for y, x in zip(*np.nonzero(t[..., 3])):
        lv = TEMPLATE_LEVELS.get(tuple(int(v) for v in t[y, x, :3]))
        if lv is not None and lv not in out:
            out[lv] = tuple(int(v) for v in c[y, x, :3])
    return [out.get(i, out.get(4)) for i in range(6)]


def recolour(src_dir, out_dir, mapping):
    """Every sheet of src_dir with its colours mapped (unmapped pixels cleared when mapping is a
    function returning None)."""
    os.makedirs(out_dir, exist_ok=True)
    for p in glob.glob(src_dir + '*.png'):
        a = np.array(Image.open(p).convert('RGBA'))
        flat = a.reshape(-1, 4)
        cache = {}
        for i in np.nonzero(flat[:, 3])[0]:
            k = tuple(int(v) for v in flat[i, :3])
            if k not in cache:
                cache[k] = mapping(k)
            v = cache[k]
            if v is None:
                flat[i] = 0
            else:
                flat[i, :3] = v
        Image.fromarray(a, 'RGBA').save(out_dir + os.path.basename(p))


def is_red(c):
    r, g, b = c
    return r > 70 and r > 1.9 * g and r > 1.6 * b


def tabard():
    src = 'tabard_source.png'
    if not os.path.exists(wear.SRC + src):
        print('skip tabard (no source)')
        return
    # the redraw fitted to every frame like any armour, into a scratch folder
    wear.armour('_Tabard Fit', src, LONG)
    for build in BUILDS:
        fit = C + 'Clothing/' + build + '/Armour/_Tabard Fit/'
        # the cloth's tones (the reds of the fit), darkest first -> shirt levels 1..5
        reds = set()
        for p in glob.glob(fit + '*.png'):
            a = np.array(Image.open(p).convert('RGBA')).reshape(-1, 4)
            reds |= {tuple(int(v) for v in q[:3]) for q in a[a[:, 3] > 0] if is_red(tuple(int(v) for v in q[:3]))}
        reds = sorted(reds, key=sum)
        lv = {c: 1 + round(i * 4 / max(1, len(reds) - 1)) for i, c in enumerate(reds)}
        for colour in colours():
            R = ramp(build, colour)
            recolour(fit, C + 'Clothing/' + build + '/Armour/Tabard/' + colour + '/',
                     lambda c, R=R: R[lv[c]] if c in lv else None)
        shutil.rmtree(fit)
        print('tabard', build, len(reds), 'tones')


def brigandine():
    lv = {c: i + 1 for i, c in enumerate(BRIG_REDS)}
    for build in BUILDS:
        base = C + 'Clothing/' + build + '/Armour/Brigandine/'
        for colour in colours():
            R = ramp(build, colour)
            recolour(base, base + colour + '/', lambda c, R=R: R[lv[c]] if c in lv else c)
        print('brigandine', build)


def leather():
    for build in BUILDS:
        base = C + 'Clothing/' + build + '/Armour/Leather/'
        recolour(base, base, lambda c: LEATHER.get(c, c))
        print('leather', build)


if __name__ == '__main__':
    which = set(sys.argv[1:]) or {'tabard', 'brigandine', 'leather'}
    if 'leather' in which:
        leather()
    if 'brigandine' in which:
        brigandine()
    if 'tabard' in which:
        tabard()
