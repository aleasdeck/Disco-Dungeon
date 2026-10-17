"""Draws the corner's health bar and spark shards as die-cut cardboard stickers (beige rim, black ink, flat print).

Vladislav picked the shapes on the shape page: health «Мягкий перехват» (a tall left end, a dip with a step on top, a
pinched waist and a slanted right end, after his sketch) and sparks «Острие к скиллу» (one long crystal with a broken
left end and its point at the ability gem, split into three by two cracks). Run from the repo root:

    python3 art/ui/draw_hp_spk.py

It writes public/assets/ui/hp_empty|hp_full|hp_shield.webp and spk_1..3_on|off.webp and prints the numbers style.css
needs: the red span of the bar and the width of each shard picture.
"""
from PIL import Image, ImageDraw
import numpy as np

OUT = 'public/assets/ui/'
SS = 4  # supersampling
RIM, RIM_EDGE, INK = (220, 207, 177), (176, 158, 118), (10, 4, 2)


def noise(img, amount, seed):
    """a faint print grain on the opaque part"""
    a = np.asarray(img).astype(np.int16)
    rng = np.random.default_rng(seed)
    n = rng.integers(-amount, amount + 1, a.shape[:2])[..., None]
    a[..., :3] = np.clip(a[..., :3] + n, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def outline(d, p, width, fill):
    """a closed outline of the given width with round joints (each corner gets a dot)"""
    d.line(p + [p[0]], fill=fill, width=width, joint='curve')
    r = width / 2
    for x, y in p:
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def sticker(size, p, ink, rim, paint):
    """rim and ink around outline p (pixel coords at SS scale); paint(draw, layer) prints the inside"""
    w, h = size
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    outline(d, p, 2 * (ink + rim) + 3 * SS, RIM_EDGE + (255,))
    outline(d, p, 2 * (ink + rim), RIM + (255,))
    d.polygon(p, fill=RIM + (255,))
    inside = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    paint(ImageDraw.Draw(inside), inside)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).polygon(p, fill=255)
    img.paste(inside, (0, 0), mask)
    outline(d, p, 2 * ink, INK + (255,))
    return img


def shrink(img):
    w, h = img.size
    return img.resize((w // SS, h // SS), Image.LANCZOS)


# ---------- health ----------
HP = [(0, 4), (150, 15), (174, 3), (320, 0), (274, 66), (210, 56), (128, 56), (6, 68)]
HP = [(x, y * 1.25) for x, y in HP]  # drawn a quarter taller than the box it was written in, like on the shape page
HW, MARGIN = 1024, 32
scale = (HW - 2 * MARGIN) / 320
HH = round(85 * scale + 2 * MARGIN)
hp_px = [((MARGIN + x * scale) * SS, (MARGIN + y * scale) * SS) for x, y in HP]


def flat(col):
    def paint(d, layer):
        d.rectangle([0, 0, layer.width, layer.height], fill=col + (255,))
        # a soft band of lighter print along the top, like the shine on the turn button
        d.rectangle([0, 0, layer.width, (MARGIN + 30) * SS], fill=tuple(min(255, c + 14) for c in col) + (255,))
    return paint


for key, col in [('hp_empty', (46, 36, 28)), ('hp_full', (200, 45, 59)), ('hp_shield', (119, 172, 211))]:
    img = shrink(sticker((HW * SS, HH * SS), hp_px, 9 * SS, 14 * SS, flat(col)))
    noise(img, 3, 7).save(OUT + key + '.webp', quality=92)
red = np.asarray(Image.open(OUT + 'hp_full.webp').convert('RGB')).astype(int)
xs = np.where(((red[..., 0] > 170) & (red[..., 1] < 90)).any(axis=0))[0]
print(f'hp {HW}x{HH}: red runs x {xs.min()}..{xs.max() + 1}')

# ---------- sparks ----------
# the crystal is 230 x 30: T and B its top and bottom edges, L its broken left end, the point on the right;
# a crack point is (x, t), t being the share of the way from the top edge down to the bottom one
T = [(0, 4), (120, 2), (196, 4), (230, 16)]
B = [(0, 27), (110, 30), (200, 28), (230, 16)]
L = [(0, 4), (4, 11), (0, 18), (4, 23), (0, 27)]
R = [(230, 16)]
CRACKS = [[(76, 0), (70, 0.45), (80, 0.7), (74, 1)], [(150, 0), (158, 0.35), (148, 0.6), (155, 1)]]
SC, SM = 3.2, 14  # pixels per unit and the margin round each shard


def edge_y(e, x):
    if x <= e[0][0]:
        return e[0][1]
    for (ax, ay), (bx, by) in zip(e, e[1:]):
        if x <= bx:
            return ay + (by - ay) * (x - ax) / (bx - ax)
    return e[-1][1]


def at(x, t):
    return (x, edge_y(T, x) + t * (edge_y(B, x) - edge_y(T, x)))


bounds = [L] + [[at(*c) for c in cr] for cr in CRACKS] + [R]
pieces = []
for k in range(3):
    a, b = bounds[k], bounds[k + 1]
    tops = [q for q in T if a[0][0] < q[0] < b[0][0]]
    bots = [q for q in B if a[-1][0] < q[0] < b[-1][0]][::-1]
    pieces.append([a[0]] + tops + b + bots + a[::-1][:-1])

# the facets of the whole crystal: the ridge a bit above the middle, the point's facets past the bend at x ~ 198
ridge = [(x, edge_y(T, x) + 0.5 * (edge_y(B, x) - edge_y(T, x))) for x in range(0, 231, 2)]
upper = [(-5, -5), (235, -5)] + ridge[::-1]
point_line = [(196, 4), (199, 16), (200, 28)]
upper_point = [(196, -5), (235, -5), (230, 16), (199, 16)]
lower_point = [(199, 16), (230, 16), (235, 35), (200, 35)]
shine = [(6, 6), (188, 5.8), (185, 7.4), (8, 7.8)]
COLS = {
    'on': dict(base=(112, 50, 118), up=(166, 89, 184), up_pt=(196, 128, 214), lo_pt=(92, 40, 98), shine=(214, 170, 232)),
    'off': dict(base=(52, 46, 66), up=(71, 62, 88), up_pt=(88, 79, 107), lo_pt=(44, 39, 56), shine=(98, 90, 118)),
}

widths = []
for k, p in enumerate(pieces):
    x0 = min(x for x, _ in p)
    x1 = max(x for x, _ in p)
    w, h = round((x1 - x0) * SC + 2 * SM), round(30 * SC + 2 * SM)
    widths.append(w)

    def px(q):
        return ((SM + (q[0] - x0) * SC) * SS, (SM + q[1] * SC) * SS)

    for state, c in COLS.items():
        def paint(d, layer, c=c):
            d.rectangle([0, 0, layer.width, layer.height], fill=c['base'] + (255,))
            d.polygon([px(q) for q in upper], fill=c['up'] + (255,))
            d.polygon([px(q) for q in upper_point], fill=c['up_pt'] + (255,))
            d.polygon([px(q) for q in lower_point], fill=c['lo_pt'] + (255,))
            d.polygon([px(q) for q in shine], fill=c['shine'] + (255,))
            d.line([px(q) for q in ridge], fill=INK + (255,), width=round(0.55 * SC * SS), joint='curve')
            d.line([px(q) for q in point_line], fill=INK + (255,), width=round(0.55 * SC * SS), joint='curve')
        img = shrink(sticker((w * SS, h * SS), [px(q) for q in p], round(1.0 * SC * SS), round(2.4 * SC * SS), paint))
        noise(img, 3, 11 + k).save(f'{OUT}spk_{k + 1}_{state}.webp', quality=92)
print(f'sparks: height {h}, widths {widths}')
