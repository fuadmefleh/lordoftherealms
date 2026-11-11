# The poor walls the building kit lacked: rough log walls and wattle-and-daub.
#
#   python -I make_poor_walls.py
#
# Writes, for build_kits.py to paint like every other kit:
#   - logs_tile.png / daub_tile.png: seamless body textures (one 128px cell's worth,
#     drawn at 512px), painted from periodic noise so they wrap exactly;
#   - assets/buildingKit/interior_wattle.png: the inside of a wattle house (interior());
#   - assets/buildingKit/wall_logs.png / wall_wattle.png: 96px pixel-art source kits,
#     the frame and body colours build_kits.py reads its profile and tint from
#     (logs: the plank kit's frame round a weathered log body; wattle: the plaster
#     kit's frame turned to rough timber posts round a muddy daub body).
# A fixed numpy seed: the same art every run.
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
N = 512
rng = np.random.default_rng(20261111)


def pnoise(shape, sy, sx):
    """Periodic smooth noise (wraps exactly), sigma sy, sx px; mean 0, sd 1."""
    n = rng.standard_normal(shape)
    n = ndimage.gaussian_filter(n, (sy, sx), mode='wrap')
    return (n - n.mean()) / (n.std() + 1e-9)


def save(a, name):
    Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(HERE, name))


# ── Logs: four round logs a cell, laid one on another, mud chinking between ──
def logs():
    LOGS = 4
    h = N // LOGS
    y = np.arange(N)[:, None].repeat(N, 1).astype(np.float32)
    x = np.arange(N)[None, :].repeat(N, 0).astype(np.float32)
    # each log's edges wander a little along its length (periodic in x)
    wob = pnoise((LOGS + 1, N), 0.01, 40)[:, :] * 3.0
    k = np.floor(y / h).astype(int)
    t = (y - k * h + wob[k, x.astype(int)]) / h      # 0..1 across the log
    t = np.clip(t, 0, 1)
    gap = 0.07                                       # chinking each side
    inlog = (t > gap) & (t < 1 - gap)
    u = np.clip((t - gap) / (1 - 2 * gap), 0, 1)
    # round: lit from above, shade underneath
    shade = 0.55 + 0.55 * np.sin(np.pi * u) ** 0.7 - 0.22 * u
    # bark: long streaks along the log, a finer grain, a few knots
    grain = 0.10 * pnoise((N, N), 1.2, 30) + 0.06 * pnoise((N, N), 0.6, 8) + 0.05 * pnoise((N, N), 3, 3)
    knots = np.clip(pnoise((N, N), 6, 6) - 2.3, 0, None)
    lumv = shade * (1 + grain) - 0.35 * knots
    wood = np.array([128, 100, 72], np.float32)
    grey = np.array([120, 112, 100], np.float32)
    mix = np.clip(0.55 + 0.25 * pnoise((N, N), 20, 60), 0, 1)[..., None]   # weathered grey, as the logs inside
    col = (wood * (1 - mix) + grey * mix) * lumv[..., None]
    # chinking: mud and moss pressed between the logs, in shadow under each log
    mud = np.array([92, 84, 66], np.float32) * (0.8 + 0.12 * pnoise((N, N), 1.5, 1.5))[..., None]
    out = np.where(inlog[..., None], col, mud)
    # the log's own edge: a soft dark line where it meets the chinking
    edge = np.exp(-np.minimum(np.abs(t - gap), np.abs(t - (1 - gap))) * h / 1.8)
    out = out * (1 - 0.35 * edge)[..., None]
    save(out, 'logs_tile.png')


# ── Daub: mud and straw smeared over woven hazel, cracked ──
def daub():
    y = np.arange(N)[:, None].repeat(N, 1).astype(np.float32)
    x = np.arange(N)[None, :].repeat(N, 0).astype(np.float32)
    base = 1.0 + 0.08 * pnoise((N, N), 30, 30) + 0.05 * pnoise((N, N), 6, 6) + 0.04 * pnoise((N, N), 1.2, 1.2)
    # smears: the hand that laid it, long low ridges at a slant
    sm = pnoise((N, N), 2.5, 14)
    sm = ndimage.rotate(np.tile(sm, (3, 3)), 18, reshape=False, mode='wrap')[N:2 * N, N:2 * N]
    base += 0.05 * sm
    # straw flecks
    fl = (pnoise((N, N), 0.7, 2.0) > 3.0).astype(np.float32)
    base += 0.10 * ndimage.gaussian_filter(fl, 0.6, mode='wrap') * 3
    # the weave showing through where the daub has fallen away
    # (none: one cell repeats along the wall, and a hole in each cell reads as a pattern)
    worn = np.zeros((N, N), np.float32)
    rows = 8
    ph = (y / (N / rows)) % 1.0
    stake = ((x / (N / 6)) % 1.0)
    over = ((np.floor(y / (N / rows)) + np.floor(x / (N / 6))) % 2) * 2 - 1
    withy = 0.75 + 0.35 * np.sin(np.pi * ph) ** 0.6 + 0.10 * over * np.cos(2 * np.pi * stake)
    withy *= 1 + 0.08 * pnoise((N, N), 0.8, 10)
    mud = np.array([150, 124, 92], np.float32)
    wood = np.array([104, 80, 54], np.float32)
    col = mud * base[..., None]
    col = col * (1 - worn[..., None]) + (wood * withy[..., None]) * worn[..., None]
    # a rim of shadow round each worn patch, and hairline cracks
    rim = np.clip(ndimage.gaussian_filter(worn, 3, mode='wrap') - worn, 0, 1)
    col *= (1 - 0.45 * rim)[..., None]
    cr = np.abs(pnoise((N, N), 5, 5))
    crack = np.exp(-cr * 18) * np.clip(pnoise((N, N), 30, 30) + 0.3, 0, 1)
    col *= (1 - 0.30 * crack)[..., None]
    save(col, 'daub_tile.png')


# ── Source kits (96px): the frame colours build_kits.py reads, the body colour it tints to ──
def source_kits():
    pl = np.asarray(Image.open(os.path.join(ROOT, 'assets/buildingKit/wall_planks.png')).convert('RGBA')).astype(np.float32)[:96, :96].copy()
    # logs: the plank kit's frame (beams top and bottom, corner posts) round a log body of a greyer brown
    body = np.zeros((96, 96), bool)
    body[10:96 - 10, 8:96 - 8] = True
    logbody = np.array([108, 96, 80], np.float32)   # (weathered grey-brown, as the logs inside)
    L = (pl[..., :3] @ np.array([0.299, 0.587, 0.114])) / max(1, (pl[..., :3][body] @ np.array([0.299, 0.587, 0.114])).mean())
    pl[body, :3] = (logbody * L[body][:, None])
    # (the frame weathered dark: rough beams, not a joiner's trim)
    fr = ~body & (pl[..., 3] > 0)
    pl[fr, :3] = np.array([92, 70, 50], np.float32) * L[fr][:, None] / max(1e-3, L[fr].mean())
    Image.fromarray(np.clip(pl, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(ROOT, 'assets/buildingKit/wall_logs.png'))

    ps = np.asarray(Image.open(os.path.join(ROOT, 'assets/buildingKit/wall_plaster.png')).convert('RGBA')).astype(np.float32)[:96, :96].copy()
    # wattle: the plaster kit's stone quoins and bands become rough dark timber, its body mud
    body = np.zeros((96, 96), bool)
    body[10:96 - 11, 8:96 - 8] = True
    lum = ps[..., :3] @ np.array([0.299, 0.587, 0.114])
    timber = np.array([88, 64, 44], np.float32)
    daubc = np.array([146, 120, 88], np.float32)
    fr = ~body & (ps[..., 3] > 0)
    ps[fr, :3] = timber * (lum[fr] / max(1, lum[fr].mean()))[:, None]
    ps[body, :3] = daubc * (lum[body] / max(1, lum[body].mean()))[:, None]
    Image.fromarray(np.clip(ps, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(ROOT, 'assets/buildingKit/wall_wattle.png'))




# ── Inside a wattle-and-daub house (interiorArt.walls.wattle): the back wall's face
# (96x32: daub between rough posts on a sole plate) above the wall tops (96x96 of the
# daub seen from above, darker), at the interior's 32px a tile ──
def interior():
    d = np.asarray(Image.open(os.path.join(HERE, 'daub_tile.png')).convert('RGB').resize((96, 96), Image.LANCZOS), np.float32)
    out = np.zeros((128, 96, 4), np.float32)
    face = d[:32].copy() * 0.92
    wood = np.asarray(Image.open(os.path.join(HERE, 'planks_tile.png')).convert('RGB').resize((96, 96), Image.LANCZOS), np.float32)
    wl = (wood @ np.array([0.299, 0.587, 0.114])) / max(1, (wood @ np.array([0.299, 0.587, 0.114])).mean())
    post = np.array([86, 62, 42], np.float32)
    for x0 in (0, 48):
        face[:, x0:x0 + 6] = post * wl[:32, x0:x0 + 6, None]
        face[:, x0 + 5:x0 + 6] *= 0.6
    face[28:32] = post * 0.8 * wl[28:32, :, None]
    face *= np.linspace(1.0, 0.82, 32)[:, None, None]
    out[:32, :, :3] = face
    out[32:, :, :3] = d * 0.6   # (the top in shade, darker than the face, as the other inside walls)
    out[..., 3] = 255
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(ROOT, 'assets/buildingKit/interior_wattle.png'))


# ── Rough mud brick: sun-dried bricks laid unevenly, each its own shade, half rendered over
# with mud that has worn away in patches (mudrough_tile.png), and its source kit
# (assets/buildingKit/wall_mudbrick.png: the adobe brick kit in an earthy brown) ──
def mudbrick():
    L = lambda a: a @ np.array([0.299, 0.587, 0.114], np.float32)
    b = np.asarray(Image.open(os.path.join(HERE, 'mudbrick_tile.png')).convert('RGB').resize((N, N), Image.LANCZOS), np.float32)
    d = np.asarray(Image.open(os.path.join(HERE, 'daub_tile.png')).convert('RGB'), np.float32)
    lb = L(b) / max(1, L(b).mean())
    ld = L(d) / max(1, L(d).mean())
    # each brick a shade of its own, the courses wavering
    shade = 1 + 0.08 * pnoise((N, N), 5, 16) + 0.03 * pnoise((N, N), 1.5, 1.5)
    lb = 1 + (lb - 1) * 0.9
    cover = np.clip((pnoise((N, N), 26, 34) - 0.45) * 1.6, 0, 1)
    lum = (lb * shade) * (1 - cover) + (ld * 0.97) * cover
    col = np.array([150, 112, 80], np.float32) * lum[..., None]
    save(col, 'mudrough_tile.png')
    src = np.asarray(Image.open(os.path.join(ROOT, 'assets/lpc/Structure/Walls/Adobe Brick Wall.png')).convert('RGBA')).astype(np.float32)[:96, :96].copy()
    a = src[..., 3] > 0
    l = L(src[..., :3])
    body = np.zeros((96, 96), bool)
    body[0:96 - 2, 2:96 - 2] = True
    for m, c in ((a & body, (136, 108, 82)), (a & ~body, (104, 76, 54))):
        src[m, :3] = np.array(c, np.float32) * (l[m] / max(1, l[m].mean()))[:, None]
    Image.fromarray(np.clip(src, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(ROOT, 'assets/buildingKit/wall_mudbrick.png'))


# ── --colours: each outside wall's own colour (the mean of its kit sheet's middle cell), printed
# as the line for data/architecture.json wealth.wallColours (the inside wall is tinted to it) ──
def colours():
    import json
    walls = json.load(open(os.path.join(ROOT, 'data/buildingKit.json'), encoding='utf-8'))['kit']['walls']
    out = {}
    for key, v in walls.items():
        im = np.asarray(Image.open(os.path.join(ROOT, v['sheet'])).convert('RGBA'), np.float32)
        c = im[im.shape[0] // 3:2 * im.shape[0] // 3, im.shape[1] // 3:2 * im.shape[1] // 3]
        rgb = c[..., :3][c[..., 3] > 0].mean(0)
        out[key] = '#%02x%02x%02x' % tuple(int(round(x)) for x in rgb)
    print('        "wallColours": ' + json.dumps(out) + ',')


if __name__ == '__main__' and '--colours' in __import__('sys').argv:
    colours()
elif __name__ == '__main__':
    logs()
    daub()
    source_kits()
    interior()
    mudbrick()
    print('logs_tile.png, daub_tile.png, wall_logs.png, wall_wattle.png, interior_wattle.png, mudrough_tile.png, wall_mudbrick.png')
