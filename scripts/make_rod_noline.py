"""
The fishing rod's 'line out' pose without its line (a fourth frame on the sheet).

assets/lpc/Tools/fishing_pole_cast_128.png has three frames a row (raised,
the cast, the line out) in 128px cells round the 64px body, rows up, left,
down, right. In the line-out frame the line hangs straight down from the
rod's tip to a float just under it, so the float can never land further
out than the rod reaches. This copies that frame into a fourth column with
the line and float taken out (flood-filled from the float, kept to the line's
side of the rod), so the game draws the line itself from the tip
(ROD_TIPS in src/ui/innerMapLayers/entities.js) out to where the float lands.

Run from the repo root: python scripts/make_rod_noline.py
"""
from PIL import Image

PATH = 'assets/lpc/Tools/fishing_pole_cast_128.png'
CELL = 128
LINE_OUT = 2
# Per row (up, left, down, right): a point on the float, and which pixels
# may belong to the line (the rest are the rod's own)
ROWS = [
    ((77, 85), lambda x, y: x >= 74),
    ((15, 92), lambda x, y: y >= 69),
    ((56, 95), lambda x, y: y >= 81),
    ((113, 91), lambda x, y: y >= 68),
]


def main():
    sheet = Image.open(PATH).convert('RGBA')
    frames = sheet.width // CELL
    base = sheet.crop((0, 0, CELL * min(frames, 3), sheet.height))
    out = Image.new('RGBA', (CELL * 4, sheet.height), (0, 0, 0, 0))
    out.alpha_composite(base, (0, 0))
    for r, (seed, line_side) in enumerate(ROWS):
        cell = sheet.crop((LINE_OUT * CELL, r * CELL, (LINE_OUT + 1) * CELL, (r + 1) * CELL))
        px = cell.load()
        stack, seen = [seed], {seed}
        while stack:
            x, y = stack.pop()
            px[x, y] = (0, 0, 0, 0)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in seen or not (0 <= n[0] < CELL and 0 <= n[1] < CELL):
                        continue
                    if px[n][3] == 0 or not line_side(*n):
                        continue
                    seen.add(n)
                    stack.append(n)
        out.alpha_composite(cell, (3 * CELL, r * CELL))
        print('row', r, 'erased', len(seen), 'px')
    out.save(PATH)
    print('wrote', PATH)


if __name__ == '__main__':
    main()
