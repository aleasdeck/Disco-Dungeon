"""Turns the FLUX renders of the mouse cursors into the pictures src/cursor.ts draws: paper stickers in the look
Vladislav picked on 2026-10-29 («Бумага», arrow and hand А2). Run from the repo root:

    python3 art/ui/cut_cursors.py SRC [folder]

SRC holds the renders as the PC makes them (CartoonGen/prompts/cursors/, output\\cursors*): cur_arrow_paper_00002_.png,
cur_hand2_paper_00003_.png, cur_palm_paper_00002_.png, cur_fist_paper_00002_.png, cur_puck_paper_00002_.png. The
magnifying glasses are the camera buttons' ico_zin/ico_zout given the same beige edge, the I-beam is drawn here, the
«занят» arrow is the arrow with a red question sticker. Each picture: the white background cut away, a thin dark line
round the beige edge, a soft shadow, sized so the arrow's long side is 192 px (src/cursor.ts shows them at its size()
for that). Writes cur_<key>.webp to public/assets/ui/ or the folder and prints each hotspot for KINDS in src/cursor.ts.
Needs numpy, scipy and Pillow.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'public/assets/ui'
INK, EDGE, CREAM, RED = (26, 18, 16), (236, 224, 196), (252, 249, 236), (158, 31, 18)
ART = 192


def cut(rgb):
    """the sticker's mask: near-white touching the border is background; the biggest piece left, its holes filled
    (a sparkle that floats free goes, white inside the sticker stays)"""
    h, w, _ = rgb.shape
    mn, mx = rgb.min(2), rgb.max(2)
    m = Image.fromarray((((mn >= 225) & ((mx - mn) <= 18)) * 255).astype(np.uint8)).copy()
    for x, y in [(x, 0) for x in range(0, w, 7)] + [(x, h - 1) for x in range(0, w, 7)] + [(0, y) for y in range(0, h, 7)] + [(w - 1, y) for y in range(0, h, 7)]:
        if m.getpixel((x, y)) == 255:
            ImageDraw.floodfill(m, (x, y), 128)
    fg = np.asarray(m) != 128
    lab, n = ndimage.label(fg)
    if n > 1:
        fg = lab == (1 + int(np.argmax(ndimage.sum(fg, lab, range(1, n + 1)))))
    return ndimage.binary_fill_holes(fg)


def grown(mask, px):
    """the mask grown by px (fractional) pixels, with a soft edge"""
    d = ndimage.distance_transform_edt(np.asarray(mask) < 128)
    return Image.fromarray((np.clip(px + 0.5 - d, 0, 1) * 255).astype(np.uint8))


def sticker(img, hot, long_side, line=0.024):
    """img: a render on white; hot: 'arrow' (the point furthest up-left), 'hand' (the top of the finger), 'centre' or
    (x, y) in the render. Gives the picture and its hotspot in its own pixels."""
    rgb = np.asarray(img.convert('RGB')).astype(np.float32)
    fg = cut(rgb)
    ys, xs = np.nonzero(fg)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb, fg = rgb[y0:y1, x0:x1], fg[y0:y1, x0:x1]
    H, W = fg.shape
    if hot == 'arrow':
        yy, xx = np.nonzero(fg)
        i = np.argmin(xx + yy)
        hx, hy = float(xx[i]), float(yy[i])
    elif hot == 'hand':
        yy, xx = np.nonzero(fg[: max(3, H // 60)])
        hx, hy = float(xx.mean()), 0.0
    elif hot == 'centre':
        hx, hy = W / 2, H / 2
    else:
        hx, hy = hot[0] - x0, hot[1] - y0
    pad = line * long_side
    sh_off, sh_blur = 0.03 * long_side, 0.025 * long_side
    k = (long_side - 2 * pad - sh_off - sh_blur) / max(H, W)
    S = 4
    cw, ch = round((W * k + 2 * pad + sh_off + sh_blur * 1.5) * S), round((H * k + 2 * pad + sh_off + sh_blur * 1.5) * S)
    pos = (round(pad * S), round(pad * S))
    fm = Image.fromarray((fg * 255).astype(np.uint8)).resize((round(W * k * S), round(H * k * S)), Image.LANCZOS)
    col = Image.fromarray(rgb.astype(np.uint8)).resize(fm.size, Image.LANCZOS)
    mask = Image.new('L', (cw, ch), 0)
    mask.paste(fm, pos)
    fig = Image.new('RGB', (cw, ch), INK)
    fig.paste(col, pos)
    outer = grown(mask, pad * S)
    out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    sh = outer.filter(ImageFilter.GaussianBlur(sh_blur * S * 0.5))
    shade = Image.new('RGBA', (cw, ch), (8, 4, 2, 0))
    shade.putalpha(sh.point(lambda v: int(v * 0.42)))
    out.alpha_composite(shade, (round(sh_off * 0.7 * S), round(sh_off * S)))
    out.paste(Image.new('RGBA', (cw, ch), INK + (255,)), (0, 0), outer)
    fig = fig.convert('RGBA')
    fig.putalpha(mask)
    out.alpha_composite(fig)
    pic = out.resize((round(cw / S), round(ch / S)), Image.LANCZOS)
    hx, hy = pad + hx * k, pad + hy * k
    if hot in ('arrow', 'hand'):
        # the dark line round the tip is what the eye reads as the point
        hx, hy = hx - pad * 0.4, hy - pad * 0.4
    return pic, (round(float(hx), 1), round(float(hy), 1))


def on_white(mask):
    """a code-drawn shape as FLUX draws the paper ones: cream, a black outline, a beige edge, on white"""
    m = np.asarray(mask) > 127
    d = ndimage.distance_transform_edt(~m)
    a = np.full(m.shape + (3,), 255, np.uint8)
    a[d <= 40] = EDGE
    a[d <= 18] = INK
    a[m] = CREAM
    return Image.fromarray(a)


def ibeam():
    m = Image.new('L', (1024, 1024), 0)
    d = ImageDraw.Draw(m)
    cx, top, bot, half, sw, th = 512, 170, 854, 150, 40, 52
    d.rounded_rectangle([cx - sw, top + 20, cx + sw, bot - 20], 18, fill=255)
    for y in (top, bot - th):
        d.rounded_rectangle([cx - half, y, cx + half, y + th], 26, fill=255)
    return on_white(m)


def glass(key):
    """the camera button's magnifier on white with a beige edge round its outline; its lens centre"""
    ic = Image.open(ROOT / f'public/assets/ui/ico_{key}.webp').convert('RGBA').resize((768, 768), Image.LANCZOS)
    bg = Image.new('RGBA', (1024, 1024), (255, 255, 255, 255))
    bg.alpha_composite(ic, (128, 128))
    full = np.zeros((1024, 1024), bool)
    full[128:896, 128:896] = np.asarray(ic.getchannel('A')) > 100
    d = ndimage.distance_transform_edt(~full)
    a = np.asarray(bg.convert('RGB')).copy()
    a[(d > 0) & (d <= 22)] = EDGE
    # draw_cam.py puts the lens at 0.404 of the icon's side
    return Image.fromarray(a), (128 + 0.404 * 768, 128 + 0.404 * 768)


def puck_centre(img):
    """the middle of the biggest dark blob: the puck in the hand"""
    dark = np.asarray(img.convert('RGB')).max(2) < 60
    lab, n = ndimage.label(dark)
    i = 1 + int(np.argmax(ndimage.sum(dark, lab, range(1, n + 1))))
    cy, cx = ndimage.center_of_mass(lab == i)
    return cx, cy


def question(arrow):
    """the arrow with a red sticker with a question mark at its top right"""
    S = 4
    W, H = arrow.size
    can = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(can)
    cx, cy, r = 148 * S, 52 * S, 34 * S
    sh = Image.new('L', can.size, 0)
    ImageDraw.Draw(sh).ellipse([cx - r - 2 * S, cy - r, cx + r + 10 * S, cy + r + 12 * S], fill=110)
    can.paste(Image.new('RGBA', can.size, (8, 4, 2, 255)), (0, 0), sh.filter(ImageFilter.GaussianBlur(3 * S)))
    d.ellipse([cx - r - 7 * S, cy - r - 7 * S, cx + r + 7 * S, cy + r + 7 * S], fill=INK + (255,))
    d.ellipse([cx - r - 5 * S, cy - r - 5 * S, cx + r + 5 * S, cy + r + 5 * S], fill=EDGE + (255,))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED + (255,))
    font = ImageFont.truetype(str(ROOT / 'src/fonts/oswald-latin.woff2'), 300)
    font.set_variation_by_axes([700])
    tb = d.textbbox((0, 0), '?', font=font, anchor='mm')
    font = ImageFont.truetype(str(ROOT / 'src/fonts/oswald-latin.woff2'), int(300 * r * 1.35 / (tb[3] - tb[1])))
    font.set_variation_by_axes([700])
    d.text((cx + S, cy + 2 * S), '?', font=font, fill=(250, 244, 228, 255), anchor='mm')
    out = arrow.copy()
    out.alpha_composite(can.resize((W, H), Image.LANCZOS))
    return out


made = {}
render = lambda name: Image.open(SRC / name)
made['arrow'] = sticker(render('cur_arrow_paper_00002_.png'), 'arrow', ART)
made['hand'] = sticker(render('cur_hand2_paper_00003_.png'), 'hand', ART)
made['palm'] = sticker(render('cur_palm_paper_00002_.png'), 'centre', 176)
made['fist'] = sticker(render('cur_fist_paper_00002_.png'), 'centre', 156)
puck = render('cur_puck_paper_00002_.png')
made['aim'] = sticker(puck, puck_centre(puck), 168)
for key in ('zin', 'zout'):
    img, lens = glass(key)
    made[key] = sticker(img, lens, 168)
made['text'] = sticker(ibeam(), 'centre', 130)
made['help'] = (question(made['arrow'][0]), made['arrow'][1])
for key, (pic, hot) in made.items():
    pic.save(OUT / f'cur_{key}.webp', quality=92, method=6)
    print(f'cur_{key}', pic.size, 'hotspot', hot)
