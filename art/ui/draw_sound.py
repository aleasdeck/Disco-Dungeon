"""Draws the top bar's sound button icons as die-cut cardboard stickers, like the painted HUD icons (beige rim, black ink).

ico_sound: a gold speaker with two cream sound waves; ico_mute: the same speaker gone grey, with a red cross where the
waves were. Run from the repo root:

    python3 art/ui/draw_sound.py

It writes public/assets/ui/ico_sound.webp and ico_mute.webp.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

OUT = 'public/assets/ui/'
SS = 4  # supersampling
W = H = 256
RIM, RIM_EDGE, INK = (220, 207, 177), (176, 158, 118), (10, 4, 2)
INK_W, RIM_W = 9, 12  # pixels at the final size


def grow(mask, r):
    """the mask grown by about r pixels (SS scale), with rounded corners"""
    if r <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(r / 2)).point(lambda v: 255 if v > 8 else 0)


def noise(img, amount, seed):
    """a faint print grain on the opaque part"""
    a = np.asarray(img).astype(np.int16)
    n = np.random.default_rng(seed).integers(-amount, amount + 1, a.shape[:2])[..., None]
    a[..., :3] = np.clip(a[..., :3] + n, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def P(*pts):
    return [(x * SS, y * SS) for x, y in pts]


# the speaker: a box and the cone opening to the right, leaning a little like the other hand-cut icons
BOX = P((34, 100), (78, 96), (80, 160), (36, 158))
CONE = P((76, 98), (132, 50), (140, 54), (142, 204), (134, 208), (78, 158))
CONE_SHADE = P((106, 74), (132, 52), (140, 56), (142, 202), (134, 206), (106, 182))
# sound waves: arcs around a point right of the cone, [radius, half angle in degrees]
CX, CY = 128 * SS, 128 * SS
WAVES = [(52, 38), (86, 42)]
WAVE_W = 15
# the cross where the waves were
CROSS = [P((166, 96), (226, 160)), P((226, 96), (166, 160))]
CROSS_W = 20


def layer():
    return Image.new('L', (W * SS, H * SS), 0)


def arc(d, r, a, width, fill):
    d.arc([CX - r * SS, CY - r * SS, CX + r * SS, CY + r * SS], -a, a, fill=fill, width=width * SS)


def draw(muted):
    speaker = layer()
    ImageDraw.Draw(speaker).polygon(BOX, fill=255)
    ImageDraw.Draw(speaker).polygon(CONE, fill=255)
    extra = layer()
    de = ImageDraw.Draw(extra)
    if muted:
        for line in CROSS:
            de.line(line, fill=255, width=CROSS_W * SS)
            for x, y in line:
                de.ellipse([x - CROSS_W * SS / 2, y - CROSS_W * SS / 2, x + CROSS_W * SS / 2, y + CROSS_W * SS / 2], fill=255)
    else:
        for r, a in WAVES:
            arc(de, r, a, WAVE_W, 255)
    shape = Image.fromarray(np.maximum(np.asarray(speaker), np.asarray(extra)))
    ink = grow(shape, INK_W * SS)
    rim = grow(ink, RIM_W * SS)
    edge = grow(rim, 3 * SS)

    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    img.paste(RIM_EDGE + (255,), (0, 0), edge)
    img.paste(RIM + (255,), (0, 0), rim)
    img.paste(INK + (255,), (0, 0), ink)
    # the print inside the ink
    body, shade = ((148, 138, 116), (118, 110, 94)) if muted else ((217, 178, 74), (178, 136, 44))
    inner = layer()
    ImageDraw.Draw(inner).polygon(BOX, fill=255)
    img.paste(body + (255,), (0, 0), inner)
    inner = layer()
    ImageDraw.Draw(inner).polygon(CONE, fill=255)
    img.paste(body + (255,), (0, 0), inner)
    inner = layer()
    ImageDraw.Draw(inner).polygon(CONE_SHADE, fill=255)
    img.paste(shade + (255,), (0, 0), Image.fromarray(np.minimum(np.asarray(inner), np.asarray(speaker))))
    # the seam between box and cone, inked
    ImageDraw.Draw(img).line(P((78, 97), (80, 159)), fill=INK + (255,), width=5 * SS)
    img.paste(((200, 45, 59) if muted else (240, 229, 205)) + (255,), (0, 0), extra)
    return noise(img.resize((W, H), Image.LANCZOS), 3, 5 if muted else 4)


for key, muted in [('ico_sound', False), ('ico_mute', True)]:
    im = draw(muted)
    # trimmed to the sticker with a little air, like the painted icons
    box = im.getbbox()
    im = im.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(W, box[2] + 2), min(H, box[3] + 2)))
    im.save(OUT + key + '.webp', quality=92)
    print(key, im.size)
