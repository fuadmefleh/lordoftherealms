# A ChatGPT texture already repeated 2x2 (period 627 px in the 1254 image).
# The page overlay holds the image's middle 627 px (offset 313), saved 1:1:
# a seamless tile whose wrap is the image's own interior. A thin seam line the
# generator sometimes draws between its copies (here near x/y = 313) is
# repaired; the low-frequency lighting is flattened (wrapping).
#   python -I tile627.py <raw_shot.png> <out.png> [--fix | --fix-x | --fix-y] [--heal-x] [--heal-y]
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
src, out = sys.argv[1], sys.argv[2]
P = 627
a = np.asarray(Image.open(src).convert('RGB'), np.float32)[:P, :P].copy()


def fix_lines(a, axis):
    # a column (row) that differs from both neighbours far more than they differ from each other
    b = np.moveaxis(a, axis, 0)          # lines along axis 0
    fixed = []
    for _ in range(3):
        L = b.mean(1)                    # (n, 3) mean colour of each line
        prof = np.array([np.median(np.minimum(np.abs(b[i] - b[i-1]).sum(-1), np.abs(b[i] - b[(i+1) % len(b)]).sum(-1))) for i in range(len(b))])   # (a seam differs from both neighbours along the whole line; a joint's edge from one, a joint only in part)
        base = np.median(prof)
        near = np.zeros(len(b), bool); near[307:320] = True   # (only where the copies meet)
        i = int(np.argmax(np.where(near, prof, 0)))
        if prof[i] < base * 2.2 or prof[i] < 6:
            break
        # (the line is a few px wide: bridge a band across it from clean lines either side)
        lo, hi = b[i - 3].copy(), b[i + 2].copy()
        for k in range(-2, 2):
            w = (k + 3) / 5
            b[i + k] = lo * (1 - w) + hi * w
        fixed.append((i, round(float(prof[i]), 1), round(float(base), 1)))
        break
    return fixed


# (only when a seam line is seen: a brick's own highlight line, or a course's edge, looks
# the same; --fix-x mends the column only, --fix-y the row only)
if '--fix' in sys.argv or '--fix-x' in sys.argv:
    print('fixed cols', fix_lines(a, 1))
if '--fix' in sys.argv or '--fix-y' in sys.argv:
    print('fixed rows', fix_lines(a, 0))
# --heal-x / --heal-y: where the copies meet (x or y = 313) the texture itself may
# not continue; there the tile is cross-faded with itself rolled half a period
# (content from the image's seam-free middle). Only for a texture that runs along
# the other axis (siding boards: --heal-x), else the fade ghosts.
for ax, flag in ((1, '--heal-x'), (0, '--heal-y')):
    if flag in sys.argv:
        d = np.abs(np.arange(P) - 313)
        m = np.clip((d - 12) / 40, 0, 1)
        m = (m * m * (3 - 2 * m))
        m = m[None, :, None] if ax == 1 else m[:, None, None]
        a = a * m + np.roll(a, P // 2, axis=ax) * (1 - m)
blur = np.stack([ndimage.gaussian_filter(a[..., c], 90, mode='wrap') for c in range(3)], -1)
mean = a.reshape(-1, 3).mean(0)
f = np.clip(a * mean / np.maximum(blur, 1), 0, 255)
Image.fromarray(f.astype(np.uint8)).save(out)
d = lambda p, q: np.abs(p - q).sum(-1).mean()
print('inner', round(d(f[:, 1:], f[:, :-1]), 1), 'wrapx', round(d(f[:, 0], f[:, -1]), 1), 'wrapy', round(d(f[0], f[-1]), 1), 'mean', mean.round())
