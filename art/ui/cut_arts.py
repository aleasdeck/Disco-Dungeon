"""Turns the FLUX renders of the boss trophies into game pictures.

    python3 art/ui/cut_arts.py SRC OUT                    # cut every variant to OUT, plus OUT/contact.png to pick from
    python3 art/ui/cut_arts.py SRC OUT --pick xray=2 ...  # also install the picked variants (1-based, default 1)

SRC holds a folder per prompt as the PC renders them (art_<key>/, loot_king/, loot_lich/: <name>_00001_.png ...).
Icons: only the white background that touches the picture's edge is cut away (white inside the object stays), with a
soft 2px edge, cropped and scaled to 256 on the long side -> public/assets/ui/art_<key>.webp.
Scenes: scaled to 768x768 -> public/assets/events/loot_<boss>.webp.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('src')
p.add_argument('out')
p.add_argument('--pick', nargs='*', default=[], help='key=n: install variant n of art_<key> or loot_<boss>')
a = p.parse_args()
src, out = Path(a.src), Path(a.out)
out.mkdir(parents=True, exist_ok=True)


def cut(path):
    """The icon on a transparent background: only edge-connected near-white counts as background."""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    mn, mx = rgb.min(2), rgb.max(2)
    bgl = (mn >= 232) & ((mx - mn) <= 14)
    m = Image.fromarray((bgl * 255).astype(np.uint8)).copy()  # a picture of its own: floodfill can't write into the array
    for x, y in [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]:
        if m.getpixel((x, y)) == 255:
            ImageDraw.floodfill(m, (x, y), 128)
    bg = np.asarray(m) == 128
    fg = ~bg
    alpha = fg.astype(np.float32)
    near = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    band = fg & near
    alpha[band] = np.clip((255 - mn) / 170.0, 0, 1)[band]
    col = rgb.copy()
    col_b = np.clip((rgb - (1 - alpha[..., None]) * 255) / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    col[band] = col_b[band]
    res = Image.fromarray(np.dstack([col, alpha * 255]).round().astype(np.uint8), 'RGBA')
    # small specks the background left behind (stray sparkles cut off from the object) go too
    res = res.crop(res.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    s = 256 / max(res.size)
    return res.resize((max(1, round(res.width * s)), max(1, round(res.height * s))), Image.LANCZOS)


def scene(path):
    return Image.open(path).convert('RGB').resize((768, 768), Image.LANCZOS)


made = {}
for d in sorted(x for x in src.iterdir() if x.is_dir()):
    files = sorted(d.glob('*.png'))
    for n, f in enumerate(files, 1):
        img = scene(f) if d.name.startswith('loot_') else cut(f)
        dst = out / f'{d.name}_{n}.webp'
        img.save(dst, quality=90 if img.mode == 'RGBA' else 86, method=6)
        made.setdefault(d.name, []).append(dst)

# contact sheet: every variant of every prompt on the game's dark brown, numbered
font = ImageFont.load_default(size=18)
cell, names = 200, sorted(made)
cols = max(len(v) for v in made.values())
sheet = Image.new('RGB', (cols * cell + 150, len(names) * cell), (52, 42, 36))
dr = ImageDraw.Draw(sheet)
for r, name in enumerate(names):
    dr.text((8, r * cell + cell // 2 - 10), name.replace('art_', ''), fill=(240, 228, 200), font=font)
    for c, f in enumerate(made[name]):
        im = Image.open(f).convert('RGBA')
        im.thumbnail((cell - 20, cell - 20))
        x, y = 150 + c * cell + (cell - im.width) // 2, r * cell + (cell - im.height) // 2
        sheet.paste(im, (x, y), im)
        dr.text((150 + c * cell + 6, r * cell + 4), str(c + 1), fill=(255, 210, 90), font=font)
sheet.save(out / 'contact.png')
print('cut', sum(len(v) for v in made.values()), 'variants of', len(made), 'prompts ->', out / 'contact.png')

picks = dict(kv.split('=') for kv in a.pick)
for name, files in made.items():
    key = name[4:] if name.startswith('art_') else name
    n = int(picks.get(key, picks.get(name, 1)))
    if not a.pick:
        break
    dst = ROOT / 'public/assets' / ('events' if name.startswith('loot_') else 'ui') / f'{name}.webp'
    dst.write_bytes(files[n - 1].read_bytes())
    print('installed', dst.relative_to(ROOT), 'from variant', n)
