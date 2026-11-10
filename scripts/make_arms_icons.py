"""
Inventory icons for the arms and their stuffs, cut from ChatGPT's two icon
sheets (assets/lpc/new/arms/icons_arms_source.png, 6 x 5 cells, and
icons_wear_source.png, 4 x 4 cells) and its single icons (icon_<id>_source.png; white backgrounds keyed out, each item
trimmed and set square). Nothing is drawn here.

Writes assets/items/arms/<good id>.png (64x64), the pictures ui/icons.js
itemIcon shows in place of the goods' emoji.
Run from the repo root: python scripts/make_arms_icons.py
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_new_windows import key_white  # noqa: E402

SRC = 'assets/lpc/new/arms/'
OUT = 'assets/items/arms/'
SIZE = 64
SHEETS = [
    ('icons_arms_source.png', 6, 5, [
        'bronze_dagger', 'iron_dagger', 'rondel_dagger', 'bronze_sword', 'iron_sword', 'weapons',
        'steel_arming_sword', 'steel_sword', 'bronze_axe', 'iron_axe', 'dane_axe', 'bronze_mace',
        'iron_mace', 'flanged_mace', 'bronze_spear', 'spear', 'pike', 'iron_bill',
        'halberd', 'enchanted_weapon', 'bow', 'crossbow', 'buckler', 'shield',
        'heater_shield', 'kite_shield', 'pavise', None, None, None]),
    ('icons_wear_source.png', 4, 4, [
        'leather_cap', 'helmet', 'steel_helm', 'gambeson',
        'leather_armor', 'chainmail', 'brigandine', 'plate_armor',
        'tin', 'bronze_bar', 'steel', 'haft',
        'grip', 'shield_boss', 'whetstone', 'arrows']),
    # one icon alone (ChatGPT, drawn after the arms sheets with them as its reference)
    ('icon_bolts_source.png', 1, 1, ['bolts']),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for src, cols, rows, ids in SHEETS:
        im = key_white(Image.open(SRC + src).convert('RGB'), tol=36, holes=150, clean=True)
        cw, ch = im.width / cols, im.height / rows
        for i, gid in enumerate(ids):
            if not gid:
                continue
            c, r = i % cols, i // cols
            cell = im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
            bb = cell.getbbox()
            cell = cell.crop(bb)
            side = max(cell.size) + 8
            sq = Image.new('RGBA', (side, side))
            sq.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
            sq.resize((SIZE, SIZE), Image.LANCZOS).save(OUT + gid + '.png')
        print(src, 'done')


if __name__ == '__main__':
    main()
