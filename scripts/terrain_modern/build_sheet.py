# Build a high-res terrain sheet in the exact LPC layout (16x26 cells) from
# the LPC sheet's geometry and new material textures.
#
#   python build_sheet.py <lpc_spring.png> <out.png> [K SIG BETA TUFT R GTOL [SEASON SEASON_SHEET]]
#
# The geometry and every pixel's material come from the SPRING sheet (all seasons
# share its layout); a season's own sheet gives its colours (rim shading) and the
# season's rules (winter: grass and snowed dirt become snow; winter_ice: the water
# freezes) and textures.
#
# K: the scale (4: 32px cells -> 128px).
# Every LPC colour is mapped to a material; each material is blurred and the
# strongest wins at each output pixel (smooth outlines, thin rings kept), and is
# filled from that material's seamless texture, aligned to the cell, so pieces
# line up. Rim colours (outlines, shore shadows, light bands, foam) keep their
# shading; the old fill pattern gives way to the texture.
# Seams: within R source pixels of a cell's border the outline comes from that
# border's GROUP profile: borders that differ in at most GTOL pixels (left with
# right, top with bottom) share one profile, so pieces that meet, meet exactly.
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

K = int(sys.argv[3]) if len(sys.argv) > 3 else 4
SIG = float(sys.argv[4]) if len(sys.argv) > 4 else 1.3    # mask smoothing, in source pixels
BETA = float(sys.argv[5]) if len(sys.argv) > 5 else 60    # edge crispness (softmax sharpness)
TUFT = float(sys.argv[6]) if len(sys.argv) > 6 else 0.25  # how far grass blades poke out
R = float(sys.argv[7]) if len(sys.argv) > 7 else 8        # border band, in source pixels
GTOL = int(sys.argv[8]) if len(sys.argv) > 8 else 3       # border groups: pixels allowed to differ
SEASON = sys.argv[9] if len(sys.argv) > 9 else 'spring'
SEASON_SHEET = sys.argv[10] if len(sys.argv) > 10 else None
C = 32
T = C * K

# The LPC palette, by material
MAT = {
    'grass': [(92,154,42), (124,184,47), (70,130,50), (37,86,46), (158,207,35), (28,69,37)],
    'dirt': [(173,132,79), (162,121,75), (148,107,68), (117,80,45), (97,72,44), (139,121,73)],
    'bank': [(107,60,46), (127,76,49), (96,52,41), (68,39,37)],
    'sand': [(244,215,160), (238,204,140)],
    'clay': [(248,188,118), (224,156,76), (207,111,48)],
    'water': [(42,133,152), (33,112,135), (29,96,123), (24,80,111), (58,175,194)],
    'foam': [(164,221,219)],
    'deep': [(23,58,85), (23,69,98), (37,58,94), (32,54,75), (37,71,88), (42,82,97)],
    'snow': [],
    'ice': [],
}
BASE = {'grass': (92,154,42), 'dirt': (173,132,79), 'bank': (173,132,79), 'sand': (244,215,160),
        'clay': (248,188,118), 'water': (42,133,152), 'foam': (164,221,219), 'deep': (23,58,85),
        'snow': (224,242,243), 'ice': (164,221,219)}
# A season's own base colours (its shading is measured against these)
SEASON_BASE = {
    'summer': {'grass': (70,130,50)},
    'autumn': {'grass': (191,166,63), 'water': (79,137,157)},
    'winter': {'water': (79,137,157)},
    'winter_ice': {'water': (79,137,157)},
}
SNOWY = {(224,242,243), (189,230,229), (255,255,255), (138,190,201), (79,143,186), (115,190,211), (37,58,94), (58,90,114), (60,94,139)}
ICY = {(164,221,219), (138,190,201)}
ALWAYS = {'bank', 'foam'}          # features: their shading kept everywhere
# Rim colours: outlines, shore shadows and highlight bands, kept wherever they are.
# Every other shade is the old fill pattern, given over to the new texture.
RIM = {(37,86,46), (28,69,37), (70,130,50),          # grass outline and tuft shade
       (117,80,45), (97,72,44),                       # dirt edge
       (29,96,123), (24,80,111), (58,175,194),        # water shore shadow and light band
       (224,156,76), (207,111,48),                    # clay / wet sand outline
       (23,69,98), (37,58,94), (32,54,75), (37,71,88), (42,82,97)}   # deep water rings
SHADOW = (42, 23, 34)
TEXFILES = None
SPARSE = 0.0
# A profile (PROFILE=<json>) builds another tileset with the same machinery: its
# materials (name -> [rgb...]), BASE colours, RIM colours, ALWAYS and texture files.
import os, json
if os.environ.get('PROFILE'):
    _p = json.load(open(os.environ['PROFILE'], encoding='utf-8'))
    MAT = {k: [tuple(c) for c in v] for k, v in _p['MAT'].items()}
    BASE = {k: tuple(v) for k, v in _p['BASE'].items()}
    RIM = {tuple(c) for c in _p.get('RIM', [])}
    ALWAYS = set(_p.get('ALWAYS', []))
    TEXFILES = _p['TEX']
    SPARSE = float(_p.get('SPARSE', 0))
    SHADOW = tuple(_p.get('SHADOW', SHADOW))
NAMES = list(MAT)
NL = len(NAMES) + 1               # every material, and "nothing" last


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def load_tex(path):
    return np.asarray(Image.open(path).convert('RGB').resize((T, T), Image.LANCZOS), dtype=np.float32)


def main():
    src = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    H, W = src.shape[:2]
    if TEXFILES:
        tex = {k: load_tex(v) for k, v in TEXFILES.items()}
    else:
      tex = {'grass': load_tex('grass.png'), 'dirt': load_tex('dirt.png'), 'sand': load_tex('sand.png'),
           'water': load_tex('water.png'), 'clay': load_tex('clay.png'), 'deep': load_tex('deep.png'),
           'snow': load_tex('snow.png'), 'ice': load_tex('ice.png')}

    def tint(t, frm, to):
        # the same texture in another colour: each channel scaled from the old base to the new
        return np.clip(t * (np.array(to, np.float32) / np.array(frm, np.float32)), 0, 255)
    if SEASON == 'summer':
        tex['grass'] = tint(tex['grass'], BASE['grass'], SEASON_BASE['summer']['grass'])
    if SEASON == 'autumn':
        tex['grass'] = load_tex('grass_autumn.png')
    if SEASON in ('autumn', 'winter', 'winter_ice'):
        tex['water'] = tint(tex['water'], BASE['water'], (79, 137, 157))
    if not TEXFILES:
        tex['bank'] = tex['dirt']
    # foam: the water's own ripples, lifted to the LPC foam's pale teal
    if 'water' in tex and 'foam' in NAMES and 'foam' not in tex:
        w = tex['water']
        tex['foam'] = (w - w.reshape(-1, 3).mean(0)) * 0.6 + np.array([164, 221, 219], np.float32)

    # Per pixel: material index (-1 none), shading factor, rim, shadow.
    # The material is the spring sheet's; the colour (for shading) the season's.
    sea = np.asarray(Image.open(SEASON_SHEET).convert('RGBA')) if SEASON_SHEET else src
    base = dict(BASE); base.update(SEASON_BASE.get(SEASON, {}))
    lookup = {}
    for i, m in enumerate(NAMES):
        for c in MAT[m]:
            lookup[c] = i
    wint = SEASON in ('winter', 'winter_ice')
    mat = np.full((H, W), -1, np.int16)
    shade = np.ones((H, W), np.float32)
    shadow = np.zeros((H, W), np.float32)
    rim = np.zeros((H, W), bool)
    unknown = {}
    for y in range(H):
        for x in range(W):
            r, g, b, a = src[y, x]
            if a == 0:
                continue
            key = (int(r), int(g), int(b))
            if key == SHADOW:
                shadow[y, x] = a / 255.0
                continue
            i = lookup.get(key)
            if i is None:
                unknown[key] = unknown.get(key, 0) + 1
                continue
            sk = tuple(int(v) for v in sea[y, x, :3]) if sea[y, x, 3] else key
            m = NAMES[i]
            if wint and (m == 'grass' or (m in ('dirt', 'bank') and sk in SNOWY)):
                m = 'snow'
            elif wint and m == 'bank' and sk == (79, 137, 157):
                m = 'water'
            if SEASON == 'winter_ice' and m in ('water', 'foam') and sk in ICY:
                m = 'ice'
            mat[y, x] = NAMES.index(m)
            shade[y, x] = lum(sk) / lum(base[m])
            rim[y, x] = key in RIM or m in ALWAYS
    s_all = np.where(rim, shade, 1.0).astype(np.float32)

    # Border groups
    cells = [(cy, cx) for cy in range(H // C) for cx in range(W // C)
             if (mat[cy*C:(cy+1)*C, cx*C:(cx+1)*C] >= 0).any() or shadow[cy*C:(cy+1)*C, cx*C:(cx+1)*C].any()]

    def seqs(cy, cx):
        m = mat[cy*C:(cy+1)*C, cx*C:(cx+1)*C]
        sv = s_all[cy*C:(cy+1)*C, cx*C:(cx+1)*C]
        return {'L': (m[:, 0], sv[:, 0]), 'R': (m[:, -1], sv[:, -1]), 'T': (m[0, :], sv[0, :]), 'B': (m[-1, :], sv[-1, :])}

    profile = {}
    for axis, sides in (('v', 'LR'), ('h', 'TB')):
        items = [((cy, cx), sd) for (cy, cx) in cells for sd in sides]
        data = [seqs(*c)[sd] for c, sd in items]
        parent = list(range(len(items)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        mats = np.stack([d[0] for d in data])
        for i in range(len(items)):
            diff = (mats != mats[i]).sum(1)
            for j in np.nonzero(diff <= GTOL)[0]:
                ri, rj = find(i), find(int(j))
                if ri != rj:
                    parent[rj] = ri
        groups = {}
        for i in range(len(items)):
            groups.setdefault(find(i), []).append(i)
        sizes = sorted((len(v) for v in groups.values()), reverse=True)
        print(axis, 'borders', len(items), 'groups', len(groups), 'largest', sizes[:6])
        for members in groups.values():
            oh = np.zeros((NL, C), np.float32)
            sv = np.zeros(C, np.float32)
            for i in members:
                mseq, sseq = data[i]
                for k in range(C):
                    oh[mseq[k] if mseq[k] >= 0 else NL - 1, k] += 1
                sv += sseq
            oh /= len(members)
            sv /= len(members)
            for i in members:
                profile[(items[i][0], items[i][1])] = (oh, sv)

    out = np.zeros((H * K, W * K, 4), np.float32)
    P = 3  # padding (clamped) round each cell
    ramp = np.clip(1 - (np.arange(T) + 0.5) / (R * K), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    wT, wB = ramp[:, None], ramp[::-1][:, None]
    wL, wR = ramp[None, :], ramp[::-1][None, :]

    def up(c, sig):
        return ndimage.zoom(ndimage.gaussian_filter(np.pad(c, P, mode='edge'), sig), K, order=1)[P*K:-P*K, P*K:-P*K]

    for (cy, cx) in cells:
        m = mat[cy*C:(cy+1)*C, cx*C:(cx+1)*C]
        # A sparse cell (seedlings a pixel or two across): grow each speck a pixel, so the
        # smoothing keeps it as a small tuft instead of erasing it
        if SPARSE and 0 < (m >= 0).mean() < SPARSE:
            m = m.copy()
            for i in np.unique(m[m >= 0]):
                grown = ndimage.binary_dilation(m == i) & (m < 0)
                m[grown] = i
        sd = shadow[cy*C:(cy+1)*C, cx*C:(cx+1)*C]
        s_eff = s_all[cy*C:(cy+1)*C, cx*C:(cx+1)*C]
        pf = {side: profile[((cy, cx), side)] for side in 'LRTB'}

        # Shading: the cell's own, and near each border the group's
        s1 = SIG * 0.8
        s_up = up(s_eff, s1)
        s_up = s_up * (1 - wT) + up(np.repeat(pf['T'][1][None, :], C, 0), s1) * wT
        s_up = s_up * (1 - wB) + up(np.repeat(pf['B'][1][None, :], C, 0), s1) * wB
        s_up = s_up * (1 - wL) + up(np.repeat(pf['L'][1][:, None], C, 1), s1) * wL
        s_up = s_up * (1 - wR) + up(np.repeat(pf['R'][1][:, None], C, 1), s1) * wR

        # Materials: each blurred, the strongest wins; near each border the group's profile
        labels = [i for i in range(len(NAMES)) if (m == i).any() or any(pf[side][0][i].any() for side in 'LRTB')]
        O = np.stack([(m == i).astype(np.float32) for i in labels] + [(m < 0).astype(np.float32)])

        def field(o):
            return np.stack([up(c, SIG) for c in o])

        def prof(side):
            return pf[side][0][labels + [NL - 1]]          # (labels + nothing, C)
        st = field(O)
        st = st * (1 - wT) + field(np.repeat(prof('T')[:, None, :], C, axis=1)) * wT
        st = st * (1 - wB) + field(np.repeat(prof('B')[:, None, :], C, axis=1)) * wB
        st = st * (1 - wL) + field(np.repeat(prof('L')[:, :, None], C, axis=2)) * wL
        st = st * (1 - wR) + field(np.repeat(prof('R')[:, :, None], C, axis=2)) * wR
        # Grass blades poke out over what it meets: the texture's light blades lift its claim
        if 'grass' in NAMES and NAMES.index('grass') in labels:
            gi = labels.index(NAMES.index('grass'))
            g = tex['grass'].mean(2)
            # (only where grass is truly at hand: never a blade sprouting out of open water)
            near = np.clip((st[gi] - 0.15) / 0.25, 0, 1)
            st[gi] = st[gi] + TUFT * near * (g - g.mean()) / (g.std() + 1e-6)
        e = np.exp((st - st.max(0, keepdims=True)) * BETA)   # softmax, sharp: anti-aliased edges
        wts = e / e.sum(0, keepdims=True)
        alpha = 1 - wts[-1]
        wsum = np.zeros((T, T), np.float32)
        rgb = np.zeros((T, T, 3), np.float32)
        for j, i in enumerate(labels):
            wsum += wts[j]
            rgb += wts[j][..., None] * tex[NAMES[i]]
        rgb = np.where(wsum[..., None] > 1e-6, rgb / np.maximum(wsum, 1e-6)[..., None], 0)
        rgb = np.clip(rgb * s_up[..., None], 0, 255)
        # Translucent shadow beneath
        sdu = ndimage.zoom(np.pad(sd, P, mode='edge'), K, order=1)[P*K:-P*K, P*K:-P*K]
        sa = np.clip(sdu, 0, 1) * (1 - alpha)
        a_out = alpha + sa
        col = (rgb * alpha[..., None] + np.array(SHADOW, np.float32) * sa[..., None]) / np.maximum(a_out, 1e-6)[..., None]
        out[cy*T:(cy+1)*T, cx*T:(cx+1)*T, :3] = col
        out[cy*T:(cy+1)*T, cx*T:(cx+1)*T, 3] = a_out * 255
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(sys.argv[2])
    print('wrote', sys.argv[2], out.shape)


main()
