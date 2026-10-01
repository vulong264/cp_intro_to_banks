# Prepares the team photos in this folder from the cut-outs in original/:
# a square head-and-shoulders crop on a light backdrop, at twice the display size, as WebP.
# Needs Python with Pillow and numpy:  python3 assets/team/prepare.py [preview.png]
# The page build (build.mjs) needs neither; it embeds <key>.webp for each person its switches show.
import io, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = ROOT + 'original/'
CROP = 540        # square taken from the supplied photo, in its own pixels
ABOVE = 56        # space kept above the top of the hair
SIZE = 192        # output pixels: shown at 96 px
QUALITY = 74
# Per person: horizontal centre of the head and the top of the hair, in the supplied photo's pixels.
PEOPLE = {
    'harley': dict(src='harley.png', centre=320, top=32),
    'ben': dict(src='ben.png', centre=323, top=65),
    'andy': dict(src='andy.png', centre=290, top=56),
}

def backdrop(n):
    y, x = np.mgrid[0:n, 0:n] / (n - 1)
    t = ((x + y) / 2)[..., None]
    rgb = (np.array([245, 245, 245]) * (1 - t) + np.array([226, 226, 226]) * t).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, np.full((n, n), 255, np.uint8)]), 'RGBA')

def portrait(p, size=SIZE):
    im = Image.open(SRC + p['src']).convert('RGBA')
    square = Image.new('RGBA', (CROP, CROP), (0, 0, 0, 0))
    square.alpha_composite(im, (CROP // 2 - p['centre'], ABOVE - p['top']))
    small = square.convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')
    out = backdrop(size)
    out.alpha_composite(small)
    return out.convert('RGB')

if __name__ == '__main__':
    made = []
    for key, p in PEOPLE.items():
        im = portrait(p)
        buf = io.BytesIO(); im.save(buf, 'WEBP', quality=QUALITY, method=6)
        open(ROOT + key + '.webp', 'wb').write(buf.getvalue())
        made.append(im)
        print(f'{key:7} {SIZE}x{SIZE}  {buf.tell() / 1024:.1f} KB')
    if len(sys.argv) > 1:
        sheet = Image.new('RGB', (SIZE * len(made) + 32 * (len(made) + 1), SIZE + 64), (22, 22, 22))
        for i, im in enumerate(made): sheet.paste(im, (32 + i * (SIZE + 32), 32))
        sheet.save(sys.argv[1])
