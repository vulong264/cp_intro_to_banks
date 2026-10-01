# Prepares the web-ready logo files in this folder from the files in original/:
# transparent background, trimmed, sized at twice the display size, compressed.
# Needs Python with Pillow and numpy:  python3 assets/logos/prepare.py [preview.png]
# The page build itself (build.mjs) needs neither; it only embeds the .webp files found here.
import io, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = ROOT + 'original/'

def white_to_alpha(im):
    """Turns a white background into transparency and keeps soft edges (colour-to-alpha against white)."""
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    alpha = (1.0 - a).max(axis=2)
    alpha[alpha < 0.035] = 0.0
    safe = np.where(alpha > 0, alpha, 1.0)
    rgb = np.clip(1.0 - (1.0 - a) / safe[..., None], 0, 1)
    out = np.dstack([rgb, alpha])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')

def trim(im, pad=0):
    alpha = np.asarray(im.getchannel('A'))
    ys, xs = np.where(alpha > 10)
    box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + 1 + pad, im.width), min(ys.max() + 1 + pad, im.height))
    return im.crop(box)

def resize(im, w, h):
    return im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')

def flat(im, bg):
    a = np.asarray(im).astype(np.float32) / 255.0
    return a[..., :3] * a[..., 3:4] + np.array(bg, np.float32) / 255.0 * (1 - a[..., 3:4])

def encode(im, name, bg, floor=37.0):
    """Smallest WebP that stays faithful to the clean artwork as seen on its background.
    Flat logos do best as a small colour palette stored losslessly; gradients may do better as lossy."""
    ref = flat(im, bg)
    tries = []
    def add(label, src, **kw):
        buf = io.BytesIO(); src.save(buf, 'WEBP', method=6, **kw)
        got = flat(Image.open(io.BytesIO(buf.getvalue())).convert('RGBA'), bg)
        mse = float(((ref - got) ** 2).mean())
        tries.append((buf.tell(), label, 99.0 if mse == 0 else 10 * math.log10(1.0 / mse), buf.getvalue()))
    for n in (24, 32, 48, 64, 96, 128, 192, 256):
        add(f'{n} colours', im.quantize(colors=n, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert('RGBA'), lossless=True, quality=100)
    for q, aq in ((70, 85), (78, 90), (85, 95)):
        add(f'lossy q{q}', im, quality=q, alpha_quality=aq)
    ok = [t for t in tries if t[2] >= floor]
    size, label, psnr, data = min(ok, key=lambda t: t[0]) if ok else max(tries, key=lambda t: t[2])
    open(ROOT + name + '.webp', 'wb').write(data)
    return size, f'{label}, {psnr:.0f} dB'

def client(src, key, scale=1.0, already_alpha=False, k=54, max_h=44, max_w=150):
    im = Image.open(SRC + src).convert('RGBA')
    im = im if already_alpha else white_to_alpha(im)
    im = trim(im)
    r = im.width / im.height
    h = min(max_h, k / math.sqrt(r) * scale)
    w = h * r
    if w > max_w: w, h = max_w, max_w / r
    out = resize(im, round(w * 2), round(h * 2))
    size, how = encode(out, key, (245, 245, 245))
    print(f'{key:20} ratio {r:4.2f}  shown {round(w)}x{round(h)}  file {out.width}x{out.height}  {size/1024:4.1f} KB  {how}')
    return Image.open(ROOT + key + '.webp').convert('RGBA')

def badge(src, key, seeds, shown=104):
    im = Image.open(SRC + src).convert('RGB')
    arr = np.asarray(im)
    near = Image.fromarray(np.where(arr.min(axis=2) > 228, 255, 0).astype(np.uint8)).copy()  # copy: fromarray images are read-only
    for sx, sy in seeds:
        x, y = (im.width - 1 if sx else 0), (im.height - 1 if sy else 0)
        if near.getpixel((x, y)) == 255: ImageDraw.floodfill(near, (x, y), 128)
    outside = np.asarray(near) == 128
    edge = np.asarray(Image.fromarray((outside * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(7))) > 0
    rgba = np.dstack([arr, np.full(arr.shape[:2], 255, np.uint8)])
    soft = np.asarray(white_to_alpha(im))
    rgba[edge] = soft[edge]            # soft edge where the frame meets the outside
    rgba[outside] = (0, 0, 0, 0)
    out = trim(Image.fromarray(rgba, 'RGBA'))
    r = out.width / out.height
    out = resize(out, round(shown * 2 * r), shown * 2)
    size, how = encode(out, key, (10, 10, 10))
    print(f'{key:20} ratio {r:4.2f}  shown {round(shown * r)}x{shown}  file {out.width}x{out.height}  {size/1024:4.1f} KB  {how}')
    return Image.open(ROOT + key + '.webp').convert('RGBA')

made = {}
made['aws-advanced-tier'] = badge('aws-advanced-tier-services.png', 'aws-advanced-tier', [(1, 0), (0, 1)])
made['aws-ai-competency'] = badge('aws-generative-ai-services-competency.webp', 'aws-ai-competency', [(0, 0), (1, 0), (0, 1), (1, 1)])
SCALE = dict(tps=1.12, mbbank=1.0, tpbank=1.0, ensign=1.08, buymed=1.0, sleek=1.0, nanoco=1.0)
made['tps'] = client('tps-colour.png', 'tps', SCALE['tps'], already_alpha=True)
made['mbbank'] = client('mbbank.webp', 'mbbank', SCALE['mbbank'], already_alpha=True)
made['tpbank'] = client('tpbank.jpg', 'tpbank', SCALE['tpbank'])
made['ensign'] = client('ensign.png', 'ensign', SCALE['ensign'], already_alpha=True)
made['buymed'] = client('buymed.png', 'buymed', SCALE['buymed'])
made['sleek'] = client('sleek.png', 'sleek', SCALE['sleek'])
made['nanoco'] = client('nanoco.webp', 'nanoco', SCALE['nanoco'])

# Preview: clients on the light panel, badges on the page background.
names = ['tps', 'mbbank', 'tpbank', 'ensign', 'buymed', 'sleek', 'nanoco']
W = sum(made[n].width for n in names) + 80 * (len(names) + 1)
sheet = Image.new('RGBA', (W, 560), (10, 10, 10, 255))
panel = Image.new('RGBA', (W - 80, 168), (245, 245, 245, 255))
sheet.paste(panel, (40, 40)); x = 80
for n in names:
    im = made[n]; sheet.alpha_composite(im, (x, 40 + (168 - im.height) // 2)); x += im.width + 80
x = 80
for n in ['aws-advanced-tier', 'aws-ai-competency']:
    im = made[n]; sheet.alpha_composite(im, (x, 280)); x += im.width + 48
if len(sys.argv) > 1: sheet.convert('RGB').save(sys.argv[1])
total = sum(os.path.getsize(ROOT + f) for f in os.listdir(ROOT) if f.endswith('.webp'))
print(f'total {total/1024:.1f} KB raw, about {total*4/3/1024:.1f} KB once embedded')
