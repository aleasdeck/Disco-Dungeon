"""Draws the interface's plates in the fight corner's cardboard (cardboard.py: a flat print on kraft, no ink outline, no
rim, rubbed edges and a torn corner): the windows' boards (panel, panel_tall), the big mustard button (btn_main), the dark
button (btn_dark), the square tile of the top strip's buttons (btn_tile) and the slab under each choice in the event, camp,
trophy and blacksmith windows (opt). Each keeps the size of the picture it replaces, so style.css cuts and stretches it as
before. Run from the repo root:

    python3 art/ui/draw_plates.py [folder]

It writes the pictures (.webp) to public/assets/ui/ or the folder.
"""
import sys

from PIL import Image, ImageDraw
import numpy as np

from cardboard import board, sharp

OUT = (sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else 'public/assets/ui/'
SS = 4

DARK = (58, 44, 34)
MUSTARD = (190, 152, 66)


def lighter(col, n):
    return tuple(min(255, c + n) for c in col)


def plate(key, size, poly, col, seed, band=None, small=False):
    """one plate: poly (pixels) printed flat in col, band (pixels) a shade lighter, then put on the board; a small one
    (a dark button, a tile, a choice's slab) is only a little rubbed and keeps its liner, so a row of them stays calm"""
    W, H = size
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    inside = Image.new('RGBA', img.size, col + (255,))
    if band:
        ImageDraw.Draw(inside).polygon([(x * SS, y * SS) for x, y in band], fill=lighter(col, 10) + (255,))
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).polygon([(x * SS, y * SS) for x, y in poly], fill=255)
    img.paste(inside, (0, 0), mask)
    img = img.resize(size, Image.LANCZOS)
    board(img, seed, sharp(poly), torn=not small, rub=0.55 if small else 0.1).save(OUT + key + '.webp', quality=90)


# the windows: a dark board, each corner cut off unevenly. border-image keeps 190 px at the top and bottom and 130 at the
# sides whole, so every cut and the torn corner stay inside those
W, H = 1024, 664
plate('panel', (W, H), [(56, 18), (W - 92, 22), (W - 16, 74), (W - 20, H - 58), (W - 70, H - 16), (40, H - 22),
                        (16, H - 96), (20, 60)], DARK, 61)
W, H = 673, 1024
plate('panel_tall', (W, H), [(50, 16), (W - 80, 20), (W - 16, 70), (W - 18, H - 60), (W - 64, H - 16), (36, H - 20),
                             (16, H - 84), (18, 56)], DARK, 62)

# the big button: mustard, its right end a point, a lighter band along its top
W, H = 768, 280
plate('btn_main', (W, H), [(20, 40), (640, 22), (754, 136), (684, 258), (26, 250), (10, 148)], MUSTARD, 63,
      band=[(0, 0), (W, 0), (W, 70), (0, 92)])

# the dark button: a slanting slab
W, H = 768, 244
plate('btn_dark', (W, H), [(70, 22), (740, 14), (756, 120), (744, 228), (12, 232), (36, 120)], DARK, 64, small=True)

# the top strip's square tile
W, H = 768, 713
plate('btn_tile', (W, H), [(90, 24), (736, 46), (748, 590), (650, 694), (22, 684), (34, 130)], DARK, 65, small=True)

# the slab under a choice: long and low, its right end cut on a slant
W, H = 1024, 200
plate('opt', (W, H), [(18, 22), (W - 70, 12), (W - 14, 100), (W - 50, H - 16), (30, H - 12), (10, 104)], DARK, 66,
      small=True)
