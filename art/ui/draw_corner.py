"""Draws the fight corner's pieces as die-cut cardboard (flat print on kraft board with its grain and flutes showing,
rubbed edges and a torn corner; no ink line and no rim: Vladislav had both taken off and the shading flattened), after his
sketch of 2026-10-18: next to the portrait a column for the stack of discs (drawn by style.css as chips), then a big
health bar like a bow tie (a dip on top, a waist below, its right end a point), the sparks as a crystal strip under it
split in two by a crack, and the ability gem standing the full height on the right with a notch the health bar's point
goes into and a foot under the bar's end: the gem is the third spark, so the strip's second crack is the gem's edge. Over
the bar's right half and the gem the turn button, its bottom following the bar's top.

All pieces share one plan: the block is 713 x 267 units (x right, y down; the column starts at x 0; the turn button stands
above it, at negative y). Pieces sit apart by a cut of 9..15 units; a rim, if one is asked for, only reaches halfway
across a cut, so two pieces never paint over each other. Run from the repo root:

    python3 art/ui/draw_corner.py [folder] [rim]

It writes hp_empty|hp_full|hp_shield, spk_1..2_on|off, gem, turn and the grain tile board (.webp) to public/assets/ui/
(or the folder; rim is a beige rim's width in pixels to try one, none by default) and prints the numbers style.css needs:
each picture's box in units, the red span of the health bar, and the outlines of the gem and the button as clip-path
polygons, for where a tap lands.
"""
import sys

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

OUT = (sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else 'public/assets/ui/'
U = 2.0  # pixels per unit
SS = 4  # supersampling
M = 14  # margin round each picture, units
RIM = float(sys.argv[2]) if len(sys.argv) > 2 else 0  # a beige rim round the print, pixels at 1x (he had it taken off)
RIM_COL, RIM_EDGE = (220, 207, 177), (176, 158, 118)
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

# the disc column has no picture (style.css stacks chips in it), but its cut still bounds the others' rims
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


# ---------- the board: kraft cardboard showing through the print ----------
KRAFT = np.array((200, 164, 116), float)


def smooth(rng, shape, scale):
    """noise with blobs about scale pixels across, wrapping round the edges, scaled to about -1..1"""
    h, w = shape
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * np.exp(-2 * (np.pi * scale / 4) ** 2 * (fx * fx + fy * fy))))
    return np.clip(a / (2.5 * a.std()), -1, 1)


def fibres(rng, shape, n):
    """short pale and dark strokes of the pulp, -1..1, wrapping round the edges"""
    h, w = shape
    im = Image.new('L', (w, h), 128)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y, ang, ln = rng.random() * w, rng.random() * h, rng.random() * np.pi, 8 + rng.random() * 18
        v = 128 + int(rng.choice((-1, 1)) * (30 + rng.random() * 50))
        dx, dy = np.cos(ang) * ln / 2, np.sin(ang) * ln / 2
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                d.line([(x + ox - dx, y + oy - dy), (x + ox + dx, y + oy + dy)], fill=v, width=2)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), float) / 128 - 1


def grain(rng, shape, flutes=True):
    """how much lighter or darker the board is at each pixel, around 1: blotches, fibres and (on corrugated board) the
    flutes under the liner showing through as faint stripes"""
    h, w = shape
    g = 1 + 0.05 * smooth(rng, shape, 70) + 0.03 * smooth(rng, shape, 14) + 0.07 * fibres(rng, shape, h * w // 500)
    if flutes:
        g += 0.045 * np.cos(2 * np.pi * np.arange(w) / 28)[None, :]
    return g + rng.uniform(-0.015, 0.015, shape)


def board(img, seed, corners):
    """prints the picture on cardboard: the ink a little soaked into the kraft, the board's grain through it, the print
    rubbed off to bare board in patches along the cut and round the corners (corners, pixels), a couple of scratches, the
    liner torn off at one corner, and a few small nicks in the cut itself"""
    rng = np.random.default_rng(seed)
    a = np.asarray(img).astype(float)
    shape = a.shape[:2]
    alpha = img.getchannel('A')

    def within(px):
        return np.asarray(alpha.filter(ImageFilter.MinFilter(2 * px + 1)), float) < 128

    yy, xx = np.mgrid[:shape[0], :shape[1]]
    fine, coarse = smooth(rng, shape, 18), smooth(rng, shape, 40)
    # round each corner a blob of bare board, its size and edge ragged
    corner = np.zeros(shape)
    for cx, cy in corners:
        corner = np.maximum(corner, 1 - np.hypot(xx - cx, yy - cy) / (24 + rng.random() * 24))
    worn = (within(3) & (fine > 0.1)) | (within(10) & (coarse > 0.5)) | (corner + 0.35 * fine > 0.5)
    # scratches: a few thin strokes of bare board across the print
    sc = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(sc)
    for _ in range(rng.integers(1, 4)):
        x, y, ang, ln = rng.random() * img.width, rng.random() * img.height, rng.uniform(-0.6, 0.6), 30 + rng.random() * 80
        d.line([(x, y), (x + np.cos(ang) * ln, y + np.sin(ang) * ln)], fill=120, width=2)
    wear = np.maximum(worn * 255.0, np.asarray(sc, float))
    wear = np.asarray(Image.fromarray(wear.astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1)), float)[..., None] / 255
    g = grain(rng, shape)[..., None]
    ink = a[..., :3] * 0.82 + KRAFT * 0.18
    rgb = (ink * (1 - wear) + KRAFT * wear) * g
    # at one corner the liner is torn off: the flutes under it bare, a pale ragged fringe of torn paper round them
    cx, cy = corners[rng.integers(len(corners))]
    r = 1 - np.hypot(xx - cx, yy - cy) / (100 + rng.random() * 50) + 0.18 * smooth(rng, shape, 22)
    torn, fringe = r > 0.5, r > 0.46
    ribs = KRAFT * (0.8 + 0.18 * np.cos(2 * np.pi * xx / 28))[..., None] * g
    rgb = np.where(fringe[..., None], np.array((236, 224, 198), float) * g, rgb)
    rgb = np.where(torn[..., None], ribs, rgb)
    a[..., :3] = np.clip(rgb, 0, 255)
    # nicks: the cut is a little ragged
    a[..., 3] *= ~(within(2) & (smooth(rng, shape, 6) < -0.7))
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def board_tile(seed, size=256):
    """the board's grain alone as a grey tile that wraps, for style.css to lay over its own shapes (the disc chips)"""
    g = grain(np.random.default_rng(seed), (size, size), flutes=False)
    return Image.fromarray(np.clip(128 + (g - 1) * 500, 0, 255).astype(np.uint8), 'L')


def box(name):
    p = PIECES[name]
    x0, y0 = min(x for x, _ in p) - M, min(y for _, y in p) - M
    x1, y1 = max(x for x, _ in p) + M, max(y for _, y in p) + M
    return x0, y0, x1 - x0, y1 - y0


def sticker(name, paint):
    """the piece's rim (only on its own side of each cut), then the print inside; paint(d, px) prints the inside with px
    mapping plan units to pixels"""
    x0, y0, w, h = box(name)
    W, H = round(w * U * SS), round(h * U * SS)

    def px(q):
        return ((q[0] - x0) * U * SS, (q[1] - y0) * U * SS)

    p = [px(q) for q in PIECES[name]]
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if RIM:
        rim = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(rim)
        outline(d, p, 2 * RIM * SS + 3 * SS, RIM_EDGE + (255,))
        outline(d, p, 2 * RIM * SS, RIM_COL + (255,))
        d.polygon(p, fill=RIM_COL + (255,))
        img.paste(rim, (0, 0), own_mask(list(PIECES).index(name), x0, y0, w, h))
    inside = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    paint(ImageDraw.Draw(inside), px)
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).polygon(p, fill=255)
    img.paste(inside, (0, 0), mask)
    return img.resize((W // SS, H // SS), Image.LANCZOS)


def lighter(col, n):
    return tuple(min(255, c + n) for c in col)


def sharp(p):
    """the polygon's outward corners sharper than 140 degrees"""
    turn = sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(p, p[1:] + p[:1]))
    out = []
    for i, (x, y) in enumerate(p):
        (ax, ay), (bx, by) = p[i - 1], p[(i + 1) % len(p)]
        u, v = (x - ax, y - ay), (bx - x, by - y)
        cross, dot = u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]
        if cross * turn > 0 and np.degrees(np.arctan2(abs(cross), dot)) > 40:
            out.append((x, y))
    return out


def save(img, key, seed, name):
    x0, y0, _, _ = box(name)
    board(img, seed, [((x - x0) * U, (y - y0) * U) for x, y in sharp(PIECES[name])]).save(OUT + key + '.webp', quality=92)


css = {}

# ---------- health: one shape in three prints ----------
band = [(x, y - 40) for x, y in HP[:4]] + [(x, y + 22) for x, y in HP[:4]][::-1]
for key, col in [('hp_empty', (46, 36, 28)), ('hp_full', (200, 45, 59)), ('hp_shield', (119, 172, 211))]:
    def paint(d, px, col=col):
        d.rectangle([px((-M, -M)), px((BW, BH + M))], fill=col + (255,))
        d.polygon([px(q) for q in band], fill=lighter(col, 9) + (255,))
    save(sticker('hp', paint), key, 7, 'hp')
css['hp'] = box('hp')
red = np.asarray(Image.open(OUT + 'hp_full.webp').convert('RGB')).astype(int)
xs = np.where(((red[..., 0] > 170) & (red[..., 1] < 90)).any(axis=0))[0]
r0, r1 = xs.min(), xs.max() + 1
HW = red.shape[1]

# ---------- sparks: one crystal in two pieces, its upper half a shade lighter ----------
ridge = [at(x, 0.45) for x in range(80, 530, 4)]
upper = [(80, 150)] + [(x, edge_y(SPK_T, x) - 20) for x, _ in SPK_T] + [(530, 150)] + ridge[::-1]
COLS = {
    'on': dict(base=(124, 58, 136), up=(142, 74, 156)),
    'off': dict(base=(54, 48, 68), up=(62, 55, 77)),
}
for k in range(2):
    for state, c in COLS.items():
        def paint(d, px, c=c):
            d.rectangle([px((-M, -M)), px((BW, BH + M))], fill=c['base'] + (255,))
            d.polygon([px(q) for q in upper], fill=c['up'] + (255,))
        save(sticker(f'spk_{k + 1}', paint), f'spk_{k + 1}_{state}', 11 + k, f'spk_{k + 1}')
    css[f'spk_{k + 1}'] = box(f'spk_{k + 1}')

# ---------- the gem: facets round a flat middle face of its body, a shade apart, lit from the top left; the foot one facet ----------
cx = sum(x for x, _ in BODY) / len(BODY) + 12
cy = BH / 2
inner = [(cx + (x - cx) * 0.5, cy + (y - cy) * 0.52) for x, y in BODY]
SHADES = [(154, 86, 170), (142, 74, 158), (112, 50, 126), (104, 46, 118), (120, 56, 134), (134, 66, 150)]


def paint_gem(d, px):
    d.rectangle([px((-M, -M)), px((BW + M, BH + M))], fill=(108, 48, 122, 255))
    for i in range(len(BODY)):
        j = (i + 1) % len(BODY)
        d.polygon([px(BODY[i]), px(BODY[j]), px(inner[j]), px(inner[i])], fill=SHADES[i] + (255,))
    d.polygon([px(q) for q in inner], fill=(130, 62, 146, 255))


save(sticker('gem', paint_gem), 'gem', 31, 'gem')
css['gem'] = box('gem')

# ---------- the turn button: mustard board with a lighter band along its top ----------
MUSTARD = (190, 152, 66)
turn_band = [(250, -120), (520, -150), (520, -112), (262, -78)]


def paint_turn(d, px):
    d.rectangle([px((150, -160)), px((700, 40))], fill=MUSTARD + (255,))
    d.polygon([px(q) for q in turn_band], fill=lighter(MUSTARD, 10) + (255,))


save(sticker('turn', paint_turn), 'turn', 41, 'turn')
css['turn'] = box('turn')

board_tile(51).save(OUT + 'board.webp', quality=90)

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
