# Makes the pixel icons in scripts/pixel_icons/icons.json with PixelLab (one
# generation each, through scripts/pixellab.mjs create), in the look of
# style_ref.png. Skips icons already made, so it resumes; delete a PNG (or pass
# --redo <emoji...>) to make it again. Output: assets/icons/pixel/src/<codepoints>.png
#   python scripts/pixel_icons/generate.py [--only N] [--workers 4] [--style] [--redo 🗡 📜]
# (--style: in style_ref.png's look; it pulled every icon toward its red and gold, so off by default)
import json
import os
import subprocess
import time
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'scripts', 'pixel_icons')
OUT = os.path.join(ROOT, 'assets', 'icons', 'pixel', 'src')


def main():
    spec = json.load(open(os.path.join(HERE, 'icons.json'), encoding='utf-8'))
    argv = sys.argv[1:]
    redo = set(argv[argv.index('--redo') + 1:]) if '--redo' in argv else set()
    only = int(argv[argv.index('--only') + 1]) if '--only' in argv else None
    workers = int(argv[argv.index('--workers') + 1]) if '--workers' in argv else 4
    os.makedirs(OUT, exist_ok=True)
    todo = [ic for ic in spec['icons'][:only]
            if ic['emoji'] in redo or not os.path.exists(os.path.join(OUT, ic['file']))]

    def make(ic):
        path = os.path.join(OUT, ic['file'])
        desc = ic['desc'] + spec['suffix']
        cmd = ['node', os.path.join(ROOT, 'scripts', 'pixellab.mjs'), 'create', path, '--desc', desc, '--size', '32',
               '--view', 'side']
        if '--style' in argv:
            cmd += ['--style', os.path.join(HERE, 'style_ref.png'), '--crop', '0,0,32,32', '--strength', '30']
        fails = 0
        for _attempt in range(40):
            r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
            if r.returncode == 0:
                print('made', ic['file'], ic['desc'], flush=True)
                return True
            err = (r.stderr or r.stdout).strip()[-200:]
            # (PixelLab caps jobs at once: a 429 just waits its turn and costs nothing)
            if '429' in err:
                time.sleep(8)
                continue
            fails += 1
            print('retry', ic['file'], err, flush=True)
            if fails >= 3:
                break
        print('FAILED', ic['file'], flush=True)
        return False

    with ThreadPoolExecutor(max_workers=workers) as pool:
        made = sum(1 for ok in pool.map(make, todo) if ok)
    print('done', made, 'of', len(todo), flush=True)


main()
