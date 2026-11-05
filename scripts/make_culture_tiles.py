"""
Wall and roof tiles for the cultures' own ways of building (data/architecture.json).

Each tile is a 96x96 nine-slice like the kit's own (assets/buildingKit/wall_*.png,
roof_*.png): corners, edges and a middle, 32px cells. They are cut and recoloured
from the LPC sheets already in the game, never drawn whole:

  wall_whitewash, wall_plaster_ochre/rose/blue   the kit's plaster, limewashed or painted
  wall_timber_black                              the kit's timber frame, black beams on white
  wall_siding_*                                  LPC clapboard siding, its corner boards kept
  wall_adobe_white                               LPC adobe stucco, limewashed
  roof_turf, roof_thatch_dark                    the kit's thatch, grassed over or weathered
  roof_slate_blue, roof_clay_teal                the kit's slate and clay tiles, recoloured
  roof_flat_white.png                            LPC adobe stucco roof (whole sheet), limewashed

Run from the repo root: python scripts/make_culture_tiles.py
then npm run compose:buildings and npm run build:data.
"""
from PIL import Image

KIT = 'assets/buildingKit/'
LPC = 'assets/lpc/Structure/'
T = 32


def lum(p):
    return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255.0


def ramp(img, dark, light, gamma=1.0, lo=None, hi=None):
    """Recolour by brightness: each pixel's lightness picks a colour between dark and light."""
    img = img.convert('RGBA')
    px = img.load()
    vals = [lum(px[x, y]) for y in range(img.height) for x in range(img.width) if px[x, y][3] > 0]
    lo = min(vals) if lo is None else lo
    hi = max(vals) if hi is None else hi
    for y in range(img.height):
        for x in range(img.width):
            p = px[x, y]
            if p[3] == 0:
                continue
            t = max(0.0, min(1.0, (lum(p) - lo) / max(1e-6, hi - lo))) ** gamma
            px[x, y] = tuple(int(dark[i] + (light[i] - dark[i]) * t) for i in range(3)) + (p[3],)
    return img


def split(img, cut, dark_map, light_map):
    """Two ramps: pixels darker than `cut` take one, the rest the other (beams and infill)."""
    img = img.convert('RGBA')
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            p = px[x, y]
            if p[3] == 0:
                continue
            l = lum(p)
            if l < cut:
                d, li = dark_map
                t = l / cut
            else:
                d, li = light_map
                t = (l - cut) / (1 - cut)
            px[x, y] = tuple(int(d[i] + (li[i] - d[i]) * t) for i in range(3)) + (p[3],)
    return img


def nine_from(sheet, x0, y0, cols, rows):
    """A 96x96 nine-slice from chosen columns/rows (in cells) of a sheet."""
    out = Image.new('RGBA', (3 * T, 3 * T))
    for j, r in enumerate(rows):
        for i, c in enumerate(cols):
            out.paste(sheet.crop(((x0 + c) * T, (y0 + r) * T, (x0 + c + 1) * T, (y0 + r + 1) * T)), (i * T, j * T))
    return out


def main():
    plaster = Image.open(KIT + 'wall_plaster.png')
    timber = Image.open(KIT + 'wall_timber.png')
    thatch = Image.open(KIT + 'roof_thatch.png')
    slate = Image.open(KIT + 'roof_slate.png')
    clay = Image.open(KIT + 'roof_clay.png')

    # Plaster, limewashed and painted
    ramp(plaster, (150, 150, 146), (250, 250, 244), 0.7).save(KIT + 'wall_whitewash.png')
    ramp(plaster, (140, 98, 40), (236, 196, 112), 0.8).save(KIT + 'wall_plaster_ochre.png')
    ramp(plaster, (140, 74, 64), (232, 168, 150), 0.8).save(KIT + 'wall_plaster_rose.png')
    ramp(plaster, (84, 110, 138), (186, 210, 228), 0.8).save(KIT + 'wall_plaster_blue.png')
    # Black-and-white timber framing: the beams near-black, the infill limewashed
    split(timber, 0.45, ((18, 14, 12), (60, 50, 44)), ((200, 196, 186), (250, 248, 240))).save(KIT + 'wall_timber_black.png')

    # Clapboard siding: blocks of 5x3 cells (corner board, three boards, corner board), four shades a colour
    siding = Image.open(LPC + 'Walls/Siding, Plain.png').convert('RGBA')
    for name, (bx, by) in {
        'red': (40, 6), 'rust': (40, 3), 'blue': (35, 6), 'teal': (30, 3), 'yellow': (20, 3),
        'white': (0, 0), 'green': (25, 6), 'brown': (10, 0), 'grey': (5, 6), 'dark': (15, 9), 'tar': (10, 3),
    }.items():
        nine_from(siding, bx, by, [0, 1, 4], [0, 1, 2]).save(KIT + f'wall_siding_{name}.png')

    # Adobe stucco, limewashed (the sheet's own 3x3 wall)
    adobe = Image.open(LPC + 'Walls/Adobe Stucco Wall.png').convert('RGBA')
    ramp(nine_from(adobe, 0, 0, [0, 1, 2], [0, 1, 2]), (138, 128, 116), (248, 246, 236), 0.85).save(KIT + 'wall_adobe_white.png')

    # Roofs
    ramp(thatch, (40, 62, 30), (128, 168, 84), 0.9).save(KIT + 'roof_turf.png')
    ramp(thatch, (52, 40, 30), (148, 124, 92), 1.0).save(KIT + 'roof_thatch_dark.png')
    ramp(slate, (34, 48, 72), (120, 148, 180), 1.0).save(KIT + 'roof_slate_blue.png')
    ramp(clay, (24, 70, 66), (110, 176, 158), 1.0).save(KIT + 'roof_clay_teal.png')
    ramp(clay, (70, 36, 22), (176, 108, 70), 1.0).save(KIT + 'roof_clay_brown.png')
    flat = Image.open(LPC + 'Roofing/Adobe Stucco Roof.png')
    ramp(flat, (120, 112, 104), (252, 250, 244), 0.6).save(KIT + 'roof_flat_white.png')
    print('Wrote culture wall and roof tiles to ' + KIT)


if __name__ == '__main__':
    main()
