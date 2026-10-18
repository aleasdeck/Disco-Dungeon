"""The «Статистика» menu sticker (public/assets/ui/m_stats.webp): three bars of a chart on a plank, drawn like the
FLUX menu stickers next to it: flat colours, a thick black outline, a darker crescent inside, a beige die-cut rim.

    python3 art/ui/draw_stats_icon.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S = 4  # drawn this many times larger, then scaled down for smooth edges
OUT = Path(__file__).resolve().parents[2] / 'public/assets/ui/m_stats.webp'

INK = (12, 9, 7)
RIM = (238, 225, 196)
# the colours of the online sticker's three discs, and the settings gear's grey-brown for the plank
TEAL, ORANGE, MUSTARD, PLANK = (66, 125, 122), (187, 99, 47), (200, 160, 62), (128, 108, 80)
OUTLINE, RIM_W = 6, 10

# (x0, y0, x1, y1, radius, colour) in the final 256 px, back to front
SHAPES = [
    (41, 124, 91, 204, 9, TEAL),
    (103, 84, 153, 204, 9, MUSTARD),
    (165, 40, 215, 204, 9, ORANGE),
    (26, 192, 230, 222, 10, PLANK),
]


def rect(draw, box, grow, r, fill):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([(x0 - grow) * S, (y0 - grow) * S, (x1 + grow) * S, (y1 + grow) * S], radius=(r + grow) * S, fill=fill)


def main():
    W = H = 256
    img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # the rim around everything first, then each shape's outline and fill, back to front
    for x0, y0, x1, y1, r, _ in SHAPES:
        rect(d, (x0, y0, x1, y1), OUTLINE + RIM_W, r, RIM + (255,))
    rng = np.random.default_rng(7)
    for x0, y0, x1, y1, r, col in SHAPES:
        rect(d, (x0, y0, x1, y1), OUTLINE, r, INK + (255,))
        rect(d, (x0, y0, x1, y1), 0, r, tuple(int(c * 0.8) for c in col) + (255,))
        # the lit face, short of the right and bottom edges: the darker crescent shows there
        x0b, y0b, x1b, y1b = x0, y0, x1 - 6, y1 - 6
        rect(d, (x0b, y0b, x1b, y1b), 0, max(2, r - 3), col + (255,))
        # a pale highlight stroke down the left of each bar
        if col != PLANK:
            d.rounded_rectangle([(x0 + 7) * S, (y0 + 9) * S, (x0 + 12) * S, (min(y1, 190) - 6) * S], radius=3 * S, fill=tuple(min(255, int(c * 1.25)) for c in col) + (255,))
        else:
            d.rounded_rectangle([(x0 + 10) * S, (y0 + 7) * S, (x1 - 40) * S, (y0 + 11) * S], radius=2 * S, fill=tuple(min(255, int(c * 1.22)) for c in col) + (255,))
    # a little printed grain over the colours, as on the stickers around it
    a = np.asarray(img).astype(np.float32)
    grain = rng.normal(1, 0.035, a.shape[:2])[..., None]
    a[..., :3] = np.clip(a[..., :3] * grain, 0, 255)
    img = Image.fromarray(a.astype(np.uint8), 'RGBA').resize((W, H), Image.LANCZOS)
    img = img.crop(img.getbbox())
    k = 256 / max(img.size)
    if k < 1:
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    img.save(OUT, 'WEBP', quality=90, method=6)
    print(OUT, img.size)


if __name__ == '__main__':
    main()
