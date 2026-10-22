"""Turns the FLUX renders of the second batch of map events into game pictures.

    python3 art/ui/cut_events2.py SRC [--pick slot=fix/ev_slot_00006 ...]

SRC is output/events2 as the PC renders it: ev_<key>/ and fix/ev_<key>/ hold the scenes, ui/<piece>/ and fix/<piece>/
the props and stickers. SCENES and PIECES say which variant goes into the game (his picks on the variant page, 2026-10-22); --pick overrides one (path under SRC,
without _.png). Scenes are scaled to 768x768 -> public/assets/events/<key>.webp. Props and stickers lose the white
background that touches the edge (plus the white hole of the beer ring), with a soft edge, cropped and scaled to 256
on the long side -> public/assets/ui/<key>.webp; the cup is turned mouth down for the thimble game.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SCENES = {
    'slot': 'fix/ev_slot/ev_slot_00005', 'sphinx': 'ev_sphinx/ev_sphinx_00003', 'gnome': 'fix2/ev_gnome_d/ev_gnome_d_00003',
    'bookie': 'ev_bookie/ev_bookie_00001', 'pawn': 'ev_pawn/ev_pawn_00003', 'mapper': 'ev_mapper/ev_mapper_00001',
    'foam': 'fix/ev_foam/ev_foam_00006', 'bottle': 'fix/ev_bottle/ev_bottle_00004', 'thimble': 'ev_thimble/ev_thimble_00002',
    'tattoo': 'ev_tattoo/ev_tattoo_00001', 'gopnik': 'ev_gopnik/ev_gopnik_00002', 'husband': 'ev_husband/ev_husband_00002',
}
PIECES = {
    'ev_bottle': 'ui/bottle/bottle_00002', 'ev_cup': 'ui/cup/cup_00001',
    'wheel_toad': 'ui/wheel_toad/wheel_toad_00001', 'wheel_nerd': 'fix/wheel_nerd/wheel_nerd_00004',
    'wheel_jock': 'ui/wheel_jock/wheel_jock_00002', 'wheel_drink': 'ui/wheel_drink/wheel_drink_00001',
    'reel_cherry': 'ui/reel_cherry/reel_cherry_00001', 'reel_skull': 'ui/reel_skull/reel_skull_00003',
    'reel_lips': 'ui/reel_lips/reel_lips_00002', 'ico_bet': 'fix/ico_bet/ico_bet_00004',
    'ico_soap': 'ui/ico_soap/ico_soap_00002', 'ico_sticky': 'ui/ico_sticky/ico_sticky_00001',
    'ico_slick': 'fix/ico_slick/ico_slick_00004', 'map_beer': 'fix/map_beer/map_beer_00004',
}
FLIP = {'ev_cup'}
HOLES = {'map_beer'}

p = argparse.ArgumentParser()
p.add_argument('src')
p.add_argument('--pick', nargs='*', default=[], help='key=path under SRC without _.png')
a = p.parse_args()
src = Path(a.src)
for kv in a.pick:
    k, v = kv.split('=', 1)
    (SCENES if k in SCENES else PIECES)[k] = v


def cut(path, holes=False):
    """The piece on a transparent background: near-white touching the edge counts as background (and, with holes,
    big enclosed near-white too)."""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    mn, mx = rgb.min(2), rgb.max(2)
    bgl = (mn >= 232) & ((mx - mn) <= 14)
    m = Image.fromarray((bgl * 255).astype(np.uint8)).copy()
    for x, y in [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]:
        if m.getpixel((x, y)) == 255:
            ImageDraw.floodfill(m, (x, y), 128)
    if holes:
        # the ring's hole: the enclosed white blob at the middle
        if m.getpixel((w // 2, h // 2)) == 255:
            ImageDraw.floodfill(m, (w // 2, h // 2), 128)
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
    res = res.crop(res.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    s = 256 / max(res.size)
    return res.resize((max(1, round(res.width * s)), max(1, round(res.height * s))), Image.LANCZOS)


man_path = ROOT / 'public/assets/manifest.json'
man, add = json.loads(man_path.read_text()), {'events': {}, 'ui': {}}
for key, rel in SCENES.items():
    Image.open(src / f'{rel}_.png').convert('RGB').resize((768, 768), Image.LANCZOS).save(ROOT / f'public/assets/events/{key}.webp', quality=86, method=6)
    add['events'][key] = f'events/{key}.webp'
for key, rel in PIECES.items():
    img = cut(src / f'{rel}_.png', key in HOLES)
    if key in FLIP:
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    img.save(ROOT / f'public/assets/ui/{key}.webp', quality=90, method=6)
    add['ui'][key] = f'ui/{key}.webp'
# new keys go at the end of their section, the file's own layout kept (one entry per line)
text = man_path.read_text()
for sec, keys in add.items():
    new = [k for k in keys if k not in man[sec]]
    if not new:
        continue
    start = text.index(f'  "{sec}": {{')
    end = text.index('\n  }', start)
    lines = ''.join(f',\n    "{k}": "{keys[k]}"' for k in new)
    text = text[:end] + lines + text[end:]
json.loads(text)
man_path.write_text(text)
print('scenes', len(SCENES), 'pieces', len(PIECES))
