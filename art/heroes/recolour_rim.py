"""Repaint the coloured rim of a hero's disc art to a new hero colour, keeping its shading and the rest of the picture.

  python art/heroes/recolour_rim.py in.webp out.webp '#a8d04a' --hue 305-342

Pixels whose hue is inside --hue (degrees) and that are saturated take the new colour's hue and saturation, scaled by
how saturated and bright they were, so the rim's light edge and its ink-dark fringe stay as drawn.
"""
import argparse
import colorsys

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('col')
ap.add_argument('--hue', default='305-342', help='hue range of the old rim, degrees')
ap.add_argument('--sat', type=float, default=0.35, help='least saturation of an old rim pixel')
a = ap.parse_args()

lo, hi = (float(x) / 360 for x in a.hue.split('-'))
c = a.col.lstrip('#')
th, ts, tv = colorsys.rgb_to_hsv(*(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)))
im = Image.open(a.src).convert('RGBA')
px = im.load()
for y in range(im.height):
    for x in range(im.width):
        r, g, b, al = px[x, y]
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if al and lo <= h <= hi and s >= a.sat:
            nr, ng, nb = colorsys.hsv_to_rgb(th, ts * s, tv * v)
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), al)
im.save(a.dst, quality=92, method=6) if a.dst.endswith('.webp') else im.save(a.dst)
