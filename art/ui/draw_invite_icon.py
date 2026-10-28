"""The «Пригласить друзей» sticker (public/assets/ui/m_invite.webp): a little person with a plus at their shoulder, drawn
like the FLUX menu stickers next to it: flat colours, a thick black outline, a darker crescent inside, a beige die-cut rim.

    python3 art/ui/draw_invite_icon.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S = 4  # drawn this many times larger, then scaled down for smooth edges
OUT = Path(__file__).resolve().parents[2] / 'public/assets/ui/m_invite.webp'

INK = (12, 9, 7)
RIM = (238, 225, 196)
# the online sticker's teal for the person and its orange for the plus
TEAL, ORANGE = (66, 125, 122), (187, 99, 47)
OUTLINE, RIM_W = 6, 10

# in the final 256 px, back to front: ('round', box, colour) is a head, ('bust', box, colour) shoulders rounded on top
# only, ('rect', box, colour) one bar of the plus
SHAPES = [
    ('bust', (22, 132, 166, 222), TEAL),
    ('round', (48, 28, 140, 120), TEAL),
    ('rect', (164, 104, 196, 200), ORANGE),
    ('rect', (132, 136, 228, 168), ORANGE),
]


def shape(draw, kind, box, grow, fill, inset=0):
    x0, y0, x1, y1 = box
    b = [(x0 - grow) * S, (y0 - grow) * S, (x1 + grow - inset) * S, (y1 + grow - inset) * S]
    if kind == 'round':
        draw.ellipse(b, fill=fill)
    elif kind == 'bust':
        r = (x1 - x0) * 0.42 + grow
        draw.rounded_rectangle(b, radius=r * S, fill=fill, corners=(True, True, False, False))
    else:
        draw.rounded_rectangle(b, radius=(7 + grow) * S, fill=fill)


def main():
    W = H = 256
    img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # the rim around everything first, then each shape's outline and fill, back to front; the plus's two bars are one
    # piece, so both outlines go down before either fill
    for kind, box, _ in SHAPES:
        shape(d, kind, box, OUTLINE + RIM_W, RIM + (255,))
    rng = np.random.default_rng(11)
    for i, (kind, box, col) in enumerate(SHAPES):
        if kind == 'rect' and SHAPES[i - 1][0] == 'rect':
            continue
        group = [s for s in SHAPES[i:i + 2] if s[0] == 'rect'] if kind == 'rect' else [SHAPES[i]]
        for k, b, _ in group:
            shape(d, k, b, OUTLINE, INK + (255,))
        for k, b, c in group:
            shape(d, k, b, 0, tuple(int(v * 0.8) for v in c) + (255,))
        # the lit face, short of the right and bottom edges: the darker crescent shows there
        for k, b, c in group:
            shape(d, k, b, 0, c + (255,), inset=6)
        if kind == 'round':
            x0, y0, x1, y1 = box
            # a pale highlight on the head's upper left
            d.ellipse([(x0 + 16) * S, (y0 + 14) * S, (x0 + 34) * S, (y0 + 30) * S], fill=tuple(min(255, int(c * 1.3)) for c in col) + (255,))
        elif kind == 'bust':
            x0, y0, x1, y1 = box
            d.rounded_rectangle([(x0 + 14) * S, (y0 + 30) * S, (x0 + 21) * S, (y1 - 12) * S], radius=3 * S, fill=tuple(min(255, int(c * 1.25)) for c in col) + (255,))
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
