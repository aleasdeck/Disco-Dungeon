"""Draws the interface's plates in the fight corner's cardboard (cardboard.py: a flat print on kraft, no ink outline, no
rim, rubbed edges and a torn corner): the windows' boards (panel, panel_tall), the big mustard button (btn_main), the dark
button (btn_dark) and its light twin for the windows' small buttons (btn_sub), the square tile of the top strip's buttons
(btn_tile), the light slab under each choice in the event, camp, trophy and blacksmith windows (opt), a plate of its own
shape for each button of the main menu and the pause (mb_*), the board of the trophies' sockets beside the health
(tray), and the board behind the hero's portrait in the corner (pf_board, with its print apart as pf_ink, which
style.css colours in the hero's colour). Each old one keeps the size of the picture it replaces, so style.css cuts and
stretches it as before. Run from the repo root:

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
# white paper, so the choices stand out of the dark board (Vladislav: dark slabs melted into it; of kraft, paper and
# mustard he picked paper)
PALE = (240, 229, 204)
# the windows' small buttons on light kraft (Vladislav picked it over paper and teal: the dark ones melted into the board)
SUB = (222, 190, 140)


def lighter(col, n):
    return tuple(min(255, c + n) for c in col)


def plate(key, size, poly, col, seed, band=None, small=False, tear=1.0, parts=False):
    """one plate: poly (pixels) printed flat in col, band (pixels) a shade lighter, then put on the board; a small one
    (a dark button, a tile, a choice's slab) is only a little rubbed and keeps its liner, so a row of them stays calm;
    tear scales the torn corner; parts saves the bare board and the print apart (key_board, key_ink)"""
    W, H = size
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    inside = Image.new('RGBA', img.size, col + (255,))
    if band:
        ImageDraw.Draw(inside).polygon([(x * SS, y * SS) for x, y in band], fill=lighter(col, 10) + (255,))
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).polygon([(x * SS, y * SS) for x, y in poly], fill=255)
    img.paste(inside, (0, 0), mask)
    img = img.resize(size, Image.LANCZOS)
    out = board(img, seed, sharp(poly), torn=not small, rub=0.55 if small else 0.1, parts=parts, tear=tear)
    if parts:
        out[0].save(OUT + key + '_board.webp', quality=90)
        out[1].save(OUT + key + '_ink.webp', quality=90)
    else:
        out.save(OUT + key + '.webp', quality=90)


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

# the small buttons in the windows («Назад», «Закрыть», «Скопировать ссылку», the tabs): the dark one's slab printed
# light, so they stand out of the dark board
plate('btn_sub', (W, H), [(70, 22), (740, 14), (756, 120), (744, 228), (12, 232), (36, 120)], SUB, 67, small=True)

# the top strip's square tile
W, H = 768, 713
plate('btn_tile', (W, H), [(90, 24), (736, 46), (748, 590), (650, 694), (22, 684), (34, 130)], DARK, 65, small=True)

# the slab under a choice: long and low, its right end cut on a slant
W, H = 1024, 200
plate('opt', (W, H), [(18, 22), (W - 70, 12), (W - 14, 100), (W - 50, H - 16), (30, H - 12), (10, 104)], PALE, 66,
      small=True)

# the menu's buttons, each its own shape (Vladislav asked): Продолжить a chevron, Кампания an arrow, Сетевая игра a
# ticket, Коллекция and Как играть a bookmark, Статистика steps like a bar chart, Настройки a slanted label, Главное
# меню an arrow back. Long and low like the buttons, the torn corner small
W, H = 1024, 128
BAND = [(0, 0), (W, 0), (W, 34), (0, 42)]


def bites(cx, cy, r, a0, a1, n=9):
    """points along a half circle bitten out of a ticket's end"""
    return [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in np.linspace(a0, a1, n)]


MENU = {
    'mb_go': [(12, 12), (942, 10), (1012, 64), (944, 118), (14, 120), (76, 66)],
    'mb_arrow': [(16, 14), (936, 8), (1012, 66), (940, 122), (12, 118), (22, 64)],
    'mb_ticket': [(40, 12), (984, 10), (1012, 26)] + bites(1012, 64, 30, -np.pi / 2, -3 * np.pi / 2) + [(1010, 104), (982, 120),
                  (42, 118), (12, 102)] + bites(12, 64, 30, np.pi / 2, -np.pi / 2) + [(14, 28)],
    'mb_mark': [(14, 12), (1012, 10), (952, 64), (1014, 120), (12, 118), (20, 66)],
    'mb_slant': [(64, 10), (1014, 16), (962, 120), (10, 114)],
    'mb_back': [(84, 10), (1010, 14), (1000, 64), (1006, 118), (88, 122), (10, 64)],
    'mb_steps': [(14, 12), (904, 10), (906, 42), (958, 44), (960, 78), (1012, 80), (1010, 120), (12, 118), (20, 64)],
}
for i, (key, poly) in enumerate(MENU.items()):
    plate(key, (W, H), poly, MUSTARD, 70 + i, band=BAND, tear=0.45)

# the board behind the hero's portrait, cut like --cut-face; the print apart, for style.css to colour per hero
W, H = 420, 512
plate('pf', (W, H), [(4 + x * (W - 8), 4 + y * (H - 8)) for x, y in ((0.09, 0.03), (0.88, 0), (1, 0.16), (0.96, 0.92),
                                                                         (0.78, 1), (0.04, 0.96), (0, 0.18))],
      (128, 128, 128), 80, tear=0.6, parts=True)

# the board of the trophies' sockets in the fight corner, left of the health and the sparks (Vladislav: brighter, and
# cardboard); 88 x 267 of the corner's units at 3 pixels a unit, its side by the health straight
W, H = 264, 801
plate('tray', (W, H), [(10, 16), (W - 3, 4), (W - 3, H - 3), (3, H - 12)], (176, 110, 56), 90, tear=1.2)
