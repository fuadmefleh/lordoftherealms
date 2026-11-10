"""
The arming sword's pose in every frame of its LPC sheets: where the hand holds
it, which way the blade points, how foreshortened it is, and whether it is
drawn in front of the body or behind it. scripts/make_arms_layers.py places
the other weapons by it.

The sword sheets (assets/lpc/Characters/Props/Sword 01 - Arming Sword/Steel
and _Behind/Steel) are 128px cells round the 64px body. The blade's motion
trail is drawn in the blade's two light tones only, so the sword itself is
found from its outline and hilt tones (the dark ones); its axis is their
principal direction, and the grip end is the end nearer the crossguard (the
widest place across the axis).
"""
import math
from PIL import Image

SWORD = 'assets/lpc/Characters/Props/Sword 01 - Arming Sword/'
CELL = 128
DARK = {(27, 25, 43), (72, 65, 82), (114, 107, 126), (134, 126, 127)}
ANIMS = ['Combat 1h - Idle', 'Combat 1h - Slash', 'Combat 1h - Halfslash', 'Legacy - Swing', 'Combat 1h - Backslash']


def _cells(path):
    im = Image.open(path).convert('RGBA')
    return im, im.width // CELL


def _blobs(pts):
    pts = set(pts)
    seen, out = set(), []
    for s in pts:
        if s in seen:
            continue
        stack, blob = [s], []
        seen.add(s)
        while stack:
            x, y = stack.pop()
            blob.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in pts and n not in seen:
                        seen.add(n)
                        stack.append(n)
        out.append(blob)
    return out


WRISTS = 'assets/lpc/Characters/_ Guides & Palettes/Body Guidelines/Masculine Thin/Wrists/'
WRIST = (92, 154, 42)   # the guide's wrist-band tone


def wrists(anim, r, i):
    """The wrist-band pixels of the body guide in a frame, in 128px-cell coordinates."""
    try:
        g = Image.open(WRISTS + anim + '.png').convert('RGBA')
    except OSError:
        return []
    px = g.load()
    return [(x + 32, y + 32) for y in range(64) for x in range(64)
            if (i + 1) * 64 <= g.width and px[i * 64 + x, r * 64 + y][3] > 0 and px[i * 64 + x, r * 64 + y][:3] == WRIST]


def pose_of(front, behind, hands=()):
    """{grip, dir, len, layer} of the sword in a cell (front and behind crops), or None."""
    dark, nf, nb = [], 0, 0
    for img, tag in ((front, 'f'), (behind, 'b')):
        px = img.load()
        for y in range(CELL):
            for x in range(CELL):
                p = px[x, y]
                if p[3] > 128 and p[:3] in DARK:
                    dark.append((x, y))
                    if tag == 'f':
                        nf += 1
                    else:
                        nb += 1
    if len(dark) < 4:
        return None
    # the biggest dark blob (stray specks of the trail's edge left out)
    blobs = sorted(_blobs(dark), key=len, reverse=True)
    pts = blobs[0]
    for b in blobs[1:]:
        if len(b) >= 3:
            pts = pts + b
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    proj = [((p[0] - mx) * ux + (p[1] - my) * uy, (p[0] - mx) * -uy + (p[1] - my) * ux) for p in pts]
    lo = min(a for a, _ in proj)
    hi = max(a for a, _ in proj)
    L = hi - lo
    ends = [(mx + ux * lo, my + uy * lo), (mx + ux * hi, my + uy * hi)]
    # the grip is the end at the hand (the body guide's wrists), else the end nearer the body
    refs = list(hands) or [(64, 72)]
    near = [min(math.hypot(e[0] - h[0], e[1] - h[1]) for h in refs) for e in ends]
    if near[0] <= near[1]:
        grip, d = ends[0], (ux, uy)
    else:
        grip, d = ends[1], (-ux, -uy)
    # the hand closes round the hilt a couple of pixels in from the pommel
    grip = (grip[0] + d[0] * 2, grip[1] + d[1] * 2)
    return {'grip': grip, 'dir': d, 'len': L, 'layer': 'front' if nf >= nb else 'behind'}


def poses(metal='Steel'):
    """{anim: [[pose or None per frame] per row]} for the sword's sheets."""
    out = {}
    for anim in ANIMS:
        f, n = _cells(SWORD + metal + '/' + anim + '.png')
        b, _ = _cells(SWORD + '_Behind/' + metal + '/' + anim + '.png')
        rows = []
        for r in range(4):
            row = []
            for i in range(n):
                box = (i * CELL, r * CELL, (i + 1) * CELL, (r + 1) * CELL)
                row.append(pose_of(f.crop(box), b.crop(box), wrists(anim, r, i)))
            rows.append(row)
        out[anim] = rows
    return out


FULL = 16.0  # the sword's length seen square-on (its longest in the ready stance)
