"""Draws public/assets/ui/bar_hp.webp, the hero's health plate: a hand-cut cardboard wedge, low on the left and
sweeping up to a sharp top-right corner, with a dark groove of the same shape for the red fill.
The plate's colours and tape follow bar_track.webp. Run: python3 art/ui/bar_hp.py
GROOVE (in 0..1 of the picture) is what src/style.css clips the fill to; keep the two in step."""
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, S = 1024, 220, 3          # picture size and supersampling
OUT = Path(__file__).resolve().parents[2] / 'public/assets/ui/bar_hp.webp'
rng = random.Random(7)

# the plate: a flat low run on the left, then the top edge sweeps up to the corner; small tears along the edges
PLATE = [(0.006, 0.47), (0.13, 0.457), (0.135, 0.478), (0.142, 0.46), (0.33, 0.452), (0.50, 0.443), (0.57, 0.425),
         (0.635, 0.385), (0.70, 0.322), (0.707, 0.348), (0.716, 0.312), (0.80, 0.215), (0.87, 0.125), (0.925, 0.06),
         (0.968, 0.012), (0.982, 0.24), (0.974, 0.265), (0.99, 0.47), (0.996, 0.69), (0.972, 0.79), (0.90, 0.815),
         (0.83, 0.845), (0.70, 0.905), (0.60, 0.95), (0.47, 0.972), (0.462, 0.992), (0.452, 0.972), (0.30, 0.982),
         (0.10, 0.988), (0.004, 0.992)]
# the groove the health fills, the same sweep inset
GROOVE = [(0.085, 0.585), (0.55, 0.565), (0.625, 0.52), (0.70, 0.45), (0.80, 0.345), (0.87, 0.255), (0.938, 0.16),
          (0.962, 0.66), (0.945, 0.725), (0.83, 0.765), (0.70, 0.822), (0.60, 0.862), (0.45, 0.88), (0.085, 0.888)]


def px(pts):
    return [(x * W * S, y * H * S) for x, y in pts]


def ragged(pts, step=26, amp=1.1):
    """Subdivides each edge and nudges the points across it, so the cut looks made by hand."""
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        n = max(1, int(np.hypot(x1 - x0, y1 - y0) / (step * S)))
        nx, ny = -(y1 - y0), x1 - x0
        ln = np.hypot(nx, ny) or 1
        for k in range(n):
            t = k / n
            j = 0 if k == 0 else rng.uniform(-amp, amp) * S
            out.append((x0 + (x1 - x0) * t + nx / ln * j, y0 + (y1 - y0) * t + ny / ln * j))
    return out


def grain(size, base, amp, blur):
    """Flat printed colour with a soft mottle, like the other cardboard pieces."""
    n = np.random.default_rng(3).normal(0, 1, (size[1] // 8, size[0] // 8))
    n = np.array(Image.fromarray(((n * 40) + 128).clip(0, 255).astype('uint8')).resize(size, Image.BICUBIC)
                 .filter(ImageFilter.GaussianBlur(blur))).astype(float) / 128 - 1
    rgb = np.array(base, float)[None, None, :] + n[..., None] * amp
    return Image.fromarray(rgb.clip(0, 255).astype('uint8'), 'RGB')


big = (W * S, H * S)
plate, groove = ragged(px(PLATE)), ragged(px(GROOVE), step=40, amp=0.6)
ink = (18, 12, 9, 255)
img = Image.new('RGBA', big, (0, 0, 0, 0))

mask = Image.new('L', big, 0)
ImageDraw.Draw(mask).polygon(plate, fill=255)
img.paste(grain(big, (88, 70, 50), 9, 6 * S), (0, 0), mask)
d = ImageDraw.Draw(img)
d.line(plate + plate[:1], fill=ink, width=6 * S, joint='curve')

gmask = Image.new('L', big, 0)
ImageDraw.Draw(gmask).polygon(groove, fill=255)
img.paste(grain(big, (46, 37, 22), 4, 4 * S), (0, 0), gmask)
# the groove's lower lip catches the light, its upper wall is in shade
lip = Image.new('L', big, 0)
ImageDraw.Draw(lip).line(groove[len(groove) // 2:], fill=255, width=3 * S)
img.paste((112, 92, 68, 255), (0, 0), Image.composite(lip, Image.new('L', big, 0), gmask))
d.line(groove + groove[:1], fill=ink, width=4 * S, joint='curve')

# a strip of tape holding the left end down
tape = Image.new('RGBA', (64 * S, 120 * S), (0, 0, 0, 0))
td = ImageDraw.Draw(tape)
td.polygon(ragged([(0, 0), (64 * S, 3 * S), (62 * S, 120 * S), (2 * S, 117 * S)], step=16, amp=1.0),
           fill=(224, 202, 168, 235), outline=ink, width=3 * S)
td.line([(10 * S, 20 * S), (54 * S, 22 * S)], fill=(200, 176, 140, 255), width=2 * S)
tape = tape.rotate(-14, resample=Image.BICUBIC, expand=True)
img.alpha_composite(tape, (int(0.004 * W * S), int(0.40 * H * S)))

img.resize((W, H), Image.LANCZOS).save(OUT, 'WEBP', quality=90, method=6)
print(OUT, 'groove bbox', min(x for x, _ in GROOVE), max(x for x, _ in GROOVE), min(y for _, y in GROOVE), max(y for _, y in GROOVE))
