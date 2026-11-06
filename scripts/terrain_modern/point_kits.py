# Point data/buildingKit.json's wall and roof kits at the repainted sheets
# (assets/buildingKit/modern/<walls|roofs>_<key>.png, made by build_kits.py), each a
# single kit at the sheet's top-left, 128px a cell (data/innerMapRenderer.json
# hiResSheets lists the folder as 96px-wide originals). A kit with no repainted
# sheet keeps its pixel art. Then: npm run compose:buildings && npm run build:data
#   python -I point_kits.py
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
KIT = os.path.join(ROOT, 'data', 'buildingKit.json')
NL = chr(10)

src = json.load(open(os.path.join(HERE, 'kit_sources.json'), encoding='utf-8'))
raw = open(KIT, encoding='utf-8').read()
data = json.loads(raw)
n = 0
for tab in ('walls', 'roofs'):
    for key, old in src[tab].items():
        rel = f'assets/buildingKit/modern/{tab}_{key}.png'
        if not os.path.exists(os.path.join(ROOT, rel)):
            data['kit'][tab][key] = old
            continue
        v = {k: val for k, val in old.items() if k not in ('sheet', 'x', 'y', 'dx', 'rowsY')}
        v['sheet'] = rel
        v['x'] = 0
        if old.get('kind') == 'parapet':
            v['rowsY'] = [0, 32]
        else:
            v['y'] = 0
        # (keys in the order the file had them)
        data['kit'][tab][key] = {k: v[k] for k in ['kind', 'sheet', 'x', 'y', 'rowsY', 'stack'] if k in v}
        n += 1


def section(text, name, value):
    """Rewrite one top-level kit section ("walls"/"roofs") in place, leaving the rest
    of the hand-formatted file as it is."""
    i = text.index(f'"{name}": {{')
    depth, j = 0, text.index('{', i)
    for j in range(j, len(text)):
        depth += {'{': 1, '}': -1}.get(text[j], 0)
        if depth == 0:
            break
    body = json.dumps(value, indent=2, ensure_ascii=False).replace(NL, NL + '    ')
    return text[:i] + f'"{name}": ' + body + text[j + 1:]


for tab in ('walls', 'roofs'):
    raw = section(raw, tab, data['kit'][tab])
with open(KIT, 'w', encoding='utf-8', newline=NL) as fh:
    fh.write(raw)
print(f'{n} kits point at assets/buildingKit/modern/')
