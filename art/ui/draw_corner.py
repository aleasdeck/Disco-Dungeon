"""Draws the fight corner's pieces as die-cut cardboard stickers (beige rim, black ink, flat print), after Vladislav's sketch
of 2026-10-18: next to the portrait a column of disc cells (split by how many discs the hero throws), then a big health
bar like a bow tie (a dip on top, a waist below, its right end a point), the sparks as a crystal strip under it split in
two by a crack, and the ability gem standing the full height on the right with a notch the health bar's point goes into
and a foot under the bar's end: the gem is the third spark, so the strip's second crack is the gem's edge. Over the bar's
right half and the gem the turn button, its bottom following the bar's top.

All pieces share one plan: the block is 713 x 267 units (x right, y down; the column starts at x 0; the turn button stands
above it, at negative y). Pieces sit apart by a
cut of 9..15 units; each sticker's rim only reaches halfway across a cut, so two pieces never paint over each other's ink.
Run from the repo root:

    python3 art/ui/draw_corner.py

It writes public/assets/ui/discs_1..4, hp_empty|hp_full|hp_shield, spk_1..2_on|off, gem and turn (.webp) and prints the
numbers style.css needs: each picture's box in units, the red span of the health bar, and the outlines of the gem and the
button as clip-path polygons, for where a tap lands.
"""
from PIL import Image, ImageDraw
import numpy as np

OUT = 'public/assets/ui/'
U = 2.0  # pixels per unit
SS = 4  # supersampling
M = 14  # margin round each picture, units
INK, RIM = 8, 12  # pixels at 1x: ink line half outside the outline, rim past it
RIM_COL, RIM_EDGE, INK_COL = (220, 207, 177), (176, 158, 118), (10, 4, 2)
BW, BH = 713, 267

DISC = [(0, 0), (78, 0), (78, 267), (0, 267)]
HP = [(93, 0), (230, 4), (390, 24), (485, 0), (523, 132), (510, 192), (345, 157), (225, 190), (93, 202)]
# the gem's body: a pentagon pointing right, its left side notched for the bar's point
BODY = [(497, 0), (675, 0), (713, 134), (645, 267), (506, 267), (535, 132)]
# the strip under the health bar: its top follows the bar's bottom
SPK_T = [(93, 211), (225, 199), (345, 166), (509, 200)]
# the two cracks as (x, t): t is the share of the way down from the strip's top to its bottom; a crack is a cut 10 wide.
# The first splits the two sparks, the second parts the second spark from the gem's foot
CRACKS = [[(268, 0), (258, 0.4), (273, 0.7), (264, 1)], [(436, 0), (445, 0.35), (430, 0.65), (439, 1)]]
CUT = 5
# the turn button: its top rising to the right, its bottom 10 over the bar's top and the gem
TURN = [(265, -93), (510, -128), (640, -10), (485, -10), (390, 14), (222, -6)]


def edge_y(e, x):
    if x <= e[0][0]:
        return e[0][1]
    for (ax, ay), (bx, by) in zip(e, e[1:]):
        if x <= bx:
            return ay + (by - ay) * (x - ax) / (bx - ax)
    return e[-1][1]


def at(x, t):
    top = edge_y(SPK_T, x)
    return (x, top + t * (BH - top))


def crack(cr, dx):
    return [at(x + dx, t) for x, t in cr]


SPK = []
for k in range(2):
    a = [SPK_T[0], (93, BH)] if k == 0 else crack(CRACKS[k - 1], CUT)
    b = crack(CRACKS[k], -CUT)
    tops = [q for q in SPK_T if a[0][0] < q[0] < b[0][0]]
    SPK.append([a[0]] + tops + b + a[::-1][:-1])
# the gem: its body, then its foot under the bar's end, from the second crack up to the strip's top, along it to round the
# bar's corner and up into the notch
foot = crack(CRACKS[1], CUT)
GEM = BODY[:4] + foot[::-1] + [q for q in SPK_T if q[0] > foot[0][0]][:-1] + [(511, 202), (523, 196)] + BODY[5:]

PIECES = {'discs': DISC, 'hp': HP, 'spk_1': SPK[0], 'spk_2': SPK[1], 'gem': GEM, 'turn': TURN}


# ---------- who owns each pixel of the cuts: the nearest piece ----------
def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def poly_dist(px, py, p):
    d = np.full(px.shape, np.inf)
    for a, b in zip(p, p[1:] + p[:1]):
        d = np.minimum(d, seg_dist(px, py, a, b))
    return d


G = 0.5  # units per cell of the ownership grid
G0, GY0 = -M - 2, -150  # where the grid starts, across and down
gy, gx = np.mgrid[GY0:BH + M + 2:G, G0:BW + M + 2:G]
dist = np.stack([poly_dist(gx, gy, p) for p in PIECES.values()])
owner = np.argmin(dist, axis=0)


def own_mask(i, x0, y0, w, h):
    """the cells piece i owns, as a mask over its picture (SS pixels)"""
    m = Image.fromarray(((owner == i) * 255).astype(np.uint8), 'L')
    # the grid starts at (G0, GY0) with G units a cell; crop the piece's box out of it, then scale to pixels
    c0, r0 = round((x0 - G0) / G), round((y0 - GY0) / G)
    m = m.crop((c0, r0, c0 + round(w / G), r0 + round(h / G)))
    return m.resize((round(w * U * SS), round(h * U * SS)), Image.NEAREST)


# ---------- the sticker ----------
def outline(d, p, width, fill):
    d.line(p + [p[0]], fill=fill, width=round(width), joint='curve')
    r = width / 2
    for x, y in p:
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def noise(img, amount, seed):
    a = np.asarray(img).astype(np.int16)
    n = np.random.default_rng(seed).integers(-amount, amount + 1, a.shape[:2])[..., None]
    a[..., :3] = np.clip(a[..., :3] + n, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def box(name):
    p = PIECES[name]
    x0, y0 = min(x for x, _ in p) - M, min(y for _, y in p) - M
    x1, y1 = max(x for x, _ in p) + M, max(y for _, y in p) + M
    return x0, y0, x1 - x0, y1 - y0


def sticker(name, paint, lines=()):
    """the piece's rim (only on its own side of each cut), the print inside, then the ink; paint(d, px) prints the inside
    with px mapping plan units to pixels; lines are ink strokes inside it (plan units, width in pixels at 1x)"""
    x0, y0, w, h = box(name)
    W, H = round(w * U * SS), round(h * U * SS)

    def px(q):
        return ((q[0] - x0) * U * SS, (q[1] - y0) * U * SS)

    p = [px(q) for q in PIECES[name]]
    rim = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(rim)
    outline(d, p, 2 * (INK + RIM) * SS + 3 * SS, RIM_EDGE + (255,))
    outline(d, p, 2 * (INK + RIM) * SS, RIM_COL + (255,))
    d.polygon(p, fill=RIM_COL + (255,))
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.paste(rim, (0, 0), own_mask(list(PIECES).index(name), x0, y0, w, h))
    inside = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(inside)
    paint(d, px)
    for ln, width in lines:
        d.line([px(q) for q in ln], fill=INK_COL + (255,), width=round(width * SS), joint='curve')
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).polygon(p, fill=255)
    img.paste(inside, (0, 0), mask)
    outline(ImageDraw.Draw(img), p, 2 * INK * SS, INK_COL + (255,))
    return img.resize((W // SS, H // SS), Image.LANCZOS)


def lighter(col, n):
    return tuple(min(255, c + n) for c in col)


def save(img, key, seed):
    noise(img, 3, seed).save(OUT + key + '.webp', quality=92)


css = {}

# ---------- the disc column: one cell per disc, cut by ink lines ----------
for n in range(1, 5):
    def paint(d, px):
        d.rectangle([px((-M, -M)), px((BW, BH + M))], fill=(46, 36, 28, 255))
    cuts = [([(0, BH * k / n), (78, BH * k / n)], 1.6 * INK) for k in range(1, n)]
    save(sticker('discs', paint, cuts), f'discs_{n}', 20 + n)
css['discs'] = box('discs')

# ---------- health: one shape in three prints ----------
band = [(x, y - 40) for x, y in HP[:4]] + [(x, y + 26) for x, y in HP[:4]][::-1]
for key, col in [('hp_empty', (46, 36, 28)), ('hp_full', (200, 45, 59)), ('hp_shield', (119, 172, 211))]:
    def paint(d, px, col=col):
        d.rectangle([px((-M, -M)), px((BW, BH + M))], fill=col + (255,))
        d.polygon([px(q) for q in band], fill=lighter(col, 14) + (255,))
    save(sticker('hp', paint), key, 7)
css['hp'] = box('hp')
red = np.asarray(Image.open(OUT + 'hp_full.webp').convert('RGB')).astype(int)
xs = np.where(((red[..., 0] > 170) & (red[..., 1] < 90)).any(axis=0))[0]
r0, r1 = xs.min(), xs.max() + 1
HW = red.shape[1]

# ---------- sparks: one crystal in two pieces, its ridge a bit above the middle, a shine along the top ----------
ridge = [at(x, 0.45) for x in range(80, 530, 4)]
upper = [(80, 150)] + [(x, edge_y(SPK_T, x) - 20) for x, _ in SPK_T] + [(530, 150)] + ridge[::-1]
shine = [at(x, 0.1) for x in range(96, 500, 4)] + [at(x, 0.2) for x in range(96, 500, 4)][::-1]
COLS = {
    'on': dict(base=(112, 50, 118), up=(166, 89, 184), shine=(214, 170, 232)),
    'off': dict(base=(52, 46, 66), up=(71, 62, 88), shine=(98, 90, 118)),
}
for k in range(2):
    for state, c in COLS.items():
        def paint(d, px, c=c):
            d.rectangle([px((-M, -M)), px((BW, BH + M))], fill=c['base'] + (255,))
            d.polygon([px(q) for q in upper], fill=c['up'] + (255,))
            d.polygon([px(q) for q in shine], fill=c['shine'] + (255,))
        save(sticker(f'spk_{k + 1}', paint, [(ridge, 0.9 * INK)]), f'spk_{k + 1}_{state}', 11 + k)
    css[f'spk_{k + 1}'] = box(f'spk_{k + 1}')

# ---------- the gem: facets round a flat middle face of its body, lit from the top left; the foot one dark facet ----------
cx = sum(x for x, _ in BODY) / len(BODY) + 12
cy = BH / 2
inner = [(cx + (x - cx) * 0.5, cy + (y - cy) * 0.52) for x, y in BODY]
SHADES = [(196, 128, 214), (166, 89, 184), (92, 40, 98), (70, 30, 76), (112, 50, 118), (140, 70, 150)]


def paint_gem(d, px):
    d.rectangle([px((-M, -M)), px((BW + M, BH + M))], fill=(86, 36, 92, 255))
    for i in range(len(BODY)):
        j = (i + 1) % len(BODY)
        d.polygon([px(BODY[i]), px(BODY[j]), px(inner[j]), px(inner[i])], fill=SHADES[i] + (255,))
    d.polygon([px(q) for q in inner], fill=(132, 64, 146, 255))
    d.polygon([px(q) for q in [inner[0], inner[1], (inner[1][0] - 20, inner[1][1] + 26), (inner[0][0] + 6, inner[0][1] + 26)]],
              fill=(160, 96, 176, 255))
    # a lighter band along the foot's top, like the shine on the sparks
    d.polygon([px(q) for q in [(foot[0][0] - 10, edge_y(SPK_T, foot[0][0]) - 10), (523, 190), (514, 230), (foot[0][0], 222)]],
              fill=(120, 56, 128, 255))


facets = [([BODY[i], inner[i]], 0.6 * INK) for i in range(len(BODY))] + [(inner + inner[:1], 0.6 * INK), ([BODY[4], BODY[5]], 0.6 * INK)]
save(sticker('gem', paint_gem, facets), 'gem', 31)
css['gem'] = box('gem')

# ---------- the turn button: mustard board with a lighter band along its top ----------
MUSTARD = (190, 152, 66)
turn_band = [(250, -120), (520, -150), (520, -112), (262, -78)]


def paint_turn(d, px):
    d.rectangle([px((150, -160)), px((700, 40))], fill=MUSTARD + (255,))
    d.polygon([px(q) for q in turn_band], fill=lighter(MUSTARD, 18) + (255,))


save(sticker('turn', paint_turn), 'turn', 41)
css['turn'] = box('turn')

# ---------- the numbers for style.css ----------
print(f'block {BW} x {BH} units')
for k, (x, y, w, h) in css.items():
    print(f'  .{k}: --bx: {x:g}; --by: {y:g}; --bw: {w:g}; --bh: {h:g};')
print(f'hp picture {HW} px wide: red runs x {r0}..{r1}')
print(f'  .track inset: 0 {100 * (HW - r1) / HW:.3f}% 0 {100 * r0 / HW:.3f}%;'
      f' fill background: calc(-{100 * r0 / (r1 - r0):.3f}cqw - var(--x, 0) * 1cqw) 0 / {100 * HW / (r1 - r0):.2f}cqw 100cqh')
for k in ('gem', 'turn'):
    bx, by, bw, bh = css[k]
    print(f'  {k} outline: polygon(' + ', '.join(f'{100 * (x - bx) / bw:.1f}% {100 * (y - by) / bh:.1f}%' for x, y in PIECES[k]) + ')')
gx0, gy0, gw, gh = css['gem']
ix = [x for x, _ in inner]
iy = [y for _, y in inner]
print(f'gem middle face: left {100 * (min(ix) - gx0) / gw:.1f}% top {100 * (min(iy) - gy0) / gh:.1f}%'
      f' width {100 * (max(ix) - min(ix)) / gw:.1f}% height {100 * (max(iy) - min(iy)) / gh:.1f}%')
