"""Draws the camera buttons' icons in the spirit of the top strip's painted ones (ico_map, ico_log, ico_menu): a light
paper cut-out with a dark ink outline, the paper's grain showing. ico_rotl turns the room one way (an arrow bent round a
floor tile), ico_rotr the other (the same, mirrored), ico_zin and ico_zout bring it nearer and further (a magnifying
glass with a plus or a minus). Run from the repo root:

    python3 art/ui/draw_cam.py [folder]

It writes the pictures (.webp) to public/assets/ui/ or the folder.
"""
import math
import sys

from PIL import Image, ImageDraw
import numpy as np

from cardboard import smooth

OUT = (sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else 'public/assets/ui/'
S = 1024
SIZE = 256
INK = (26, 18, 16)
PAPER = (219, 204, 168)
FLOOR = (164, 146, 116)
GLASS = (196, 214, 210)
WOOD = (132, 92, 58)
# the outline, in pixels at the drawing's size
LINE = 30


def grow(mask, px):
    """the mask grown by px pixels all round (a square step and a cross step in turn, so the corners come out round)"""
    m = np.asarray(mask) > 127
    for k in range(px):
        p = np.pad(m, 1)
        n = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
        if k % 2:
            n |= p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        m = n
    return Image.fromarray((m * 255).astype(np.uint8))


def arc(cx, cy, r, a0, a1, n=120):
    return [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def mask(draw):
    m = Image.new('L', (S, S), 0)
    draw(ImageDraw.Draw(m))
    return m


def turn_icon():
    """an arrow bent most of the way round a floor tile, seen at an angle like the room, its head going anticlockwise
    (the way the room turns); the arrow starts at the top right and goes over the top, down the left and along the bottom"""
    cx, cy, r, band = 512, 530, 340, 128
    a0, a1 = math.radians(-35), math.radians(-35 - 250)
    body = arc(cx, cy, r + band / 2, a0, a1) + arc(cx, cy, r - band / 2, a1, a0)
    end = (cx + r * math.cos(a1), cy + r * math.sin(a1))
    # the head: wider than the band, pointing on along the circle (anticlockwise is the way the angle falls)
    tx, ty = math.sin(a1), -math.cos(a1)
    nx, ny = math.cos(a1), math.sin(a1)
    hw, hl = band * 1.15, band * 1.45
    head = [(end[0] + nx * hw, end[1] + ny * hw), (end[0] + tx * hl, end[1] + ty * hl), (end[0] - nx * hw, end[1] - ny * hw)]
    tw, th = 400, 220
    pts = [(cx, cy - th / 2), (cx + tw / 2, cy), (cx, cy + th / 2), (cx - tw / 2, cy)]

    def tile(d):
        d.polygon(pts, fill=255)

    def seams(d):
        # the tile's seams: one line each way through its middle
        d.line([((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2), ((pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2)], fill=255, width=26)
        d.line([((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2), ((pts[3][0] + pts[2][0]) / 2, (pts[3][1] + pts[2][1]) / 2)], fill=255, width=26)

    return [(mask(tile), FLOOR, mask(seams)), (mask(lambda d: (d.polygon(body, fill=255), d.polygon(head, fill=255))), PAPER, None)]


def glass_icon(plus):
    """a magnifying glass, its handle down to the right, a plus or a minus in the lens"""
    cx, cy, r, ring = 430, 430, 300, 70
    hx, hy = math.cos(math.radians(45)), math.sin(math.radians(45))
    h0 = (cx + hx * (r + ring / 2 - 10), cy + hy * (r + ring / 2 - 10))
    h1 = (cx + hx * (r + 330), cy + hy * (r + 330))

    def handle(d):
        d.line([h0, h1], fill=255, width=128)
        d.ellipse([h1[0] - 64, h1[1] - 64, h1[0] + 64, h1[1] + 64], fill=255)

    def lens(d):
        d.ellipse([cx - r + ring / 2, cy - r + ring / 2, cx + r - ring / 2, cy + r - ring / 2], fill=255)

    def rim(d):
        d.ellipse([cx - r - ring / 2, cy - r - ring / 2, cx + r + ring / 2, cy + r + ring / 2], fill=255)
        d.ellipse([cx - r + ring / 2, cy - r + ring / 2, cx + r - ring / 2, cy + r - ring / 2], fill=0)

    def sign(d):
        a, w = 150, 70
        d.rectangle([cx - a, cy - w / 2, cx + a, cy + w / 2], fill=255)
        if plus:
            d.rectangle([cx - w / 2, cy - a, cx + w / 2, cy + a], fill=255)

    def shine(d):
        # a light glint on the glass, up to the left
        d.arc([cx - r + 70, cy - r + 70, cx + r - 70, cy + r - 70], 195, 245, fill=255, width=34)

    return [(mask(handle), WOOD, None), (mask(lens), GLASS, mask(shine)), (mask(rim), PAPER, None), (mask(sign), INK, None)]


def render(parts, seed):
    """parts: (mask, colour, light marks or None) in order, the first ones under; each gets the ink outline round it, its
    light marks (a seam, a glint) are drawn in ink or white over it, the paper's grain over the lot; the picture cut to
    its outline and made SIZE pixels at its longer side"""
    rng = np.random.default_rng(seed)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    for m, col, marks in parts:
        if col != INK:
            img.paste(Image.new('RGBA', (S, S), INK + (255,)), (0, 0), grow(m, LINE))
        img.paste(Image.new('RGBA', (S, S), col + (255,)), (0, 0), m)
        if marks is not None:
            # seams on the floor in ink, a glint on the glass in white
            tint = INK if col == FLOOR else (250, 250, 244)
            img.paste(Image.new('RGBA', (S, S), tint + (255,)), (0, 0), Image.fromarray((np.asarray(marks) * (np.asarray(m) > 127)).astype(np.uint8)))
    a = np.asarray(img).astype(float)
    g = 1 + 0.06 * smooth(rng, (S, S), 90) + 0.035 * smooth(rng, (S, S), 16) + rng.uniform(-0.02, 0.02, (S, S))
    a[..., :3] = np.clip(a[..., :3] * g[..., None], 0, 255)
    img = Image.fromarray(a.astype(np.uint8))
    img = img.crop(img.getbbox())
    w, h = img.size
    k = SIZE / max(w, h)
    return img.resize((round(w * k), round(h * k)), Image.LANCZOS)


rot = render(turn_icon(), 71)
rot.save(OUT + 'ico_rotl.webp', quality=90)
rot.transpose(Image.FLIP_LEFT_RIGHT).save(OUT + 'ico_rotr.webp', quality=90)
render(glass_icon(True), 72).save(OUT + 'ico_zin.webp', quality=90)
render(glass_icon(False), 73).save(OUT + 'ico_zout.webp', quality=90)
