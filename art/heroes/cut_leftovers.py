"""Cut the background the first cutout left on a figure: white gaps it encloses, a grey floor shadow under the feet.

The old cutout removed only the white connected to the image border, so background enclosed by the figure stayed
white (between Зажигалка's cigarette holder and shoulder, inside Рикошет's rings), and the render's grey floor
shadow stayed under the feet (the king). White clothing looks the same as a white gap, so the gaps are named by
hand: a point inside each (--at x,y, repeatable). The near-white area round the point goes, and its soft edge is
matted against white as in the cutout. --shadow F clears light neutral grey from the bottom F of the picture, the
ink lines it touched keeping their soft edge.

usage: python3 cut_leftovers.py in.png out.png [--at 122,278 ...] [--shadow 0.08]
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("dst")
p.add_argument("--at", action="append", default=[], help="x,y inside a white gap that must become transparent")
p.add_argument("--shadow", type=float, default=0, help="bottom fraction of the picture where a grey floor shadow is cleared")
a = p.parse_args()

im = np.asarray(Image.open(a.src).convert("RGBA")).astype(np.float32)
rgb, alpha = im[..., :3], im[..., 3] / 255
mn, mx = rgb.min(2), rgb.max(2)
out = im.copy()
na = alpha.copy()

# white gaps: the gap goes, the 2px band round it is matted against white
lab, _ = nd.label((alpha > 0.5) & (mn >= 232) & (mx - mn <= 14))
gap = np.zeros(alpha.shape, bool)
for k in a.at:
    x, y = (int(v) for v in k.split(","))
    if not lab[y, x]:
        raise SystemExit(f"{x},{y} is not on white")
    gap |= lab == lab[y, x]
band = nd.binary_dilation(gap, iterations=2) & ~gap
ab = np.clip((255 - mn) / 170, 0, 1)
out[band, :3] = np.clip((rgb - (1 - ab[..., None]) * 255) / np.maximum(ab, 1e-3)[..., None], 0, 255)[band]
na[band] = np.minimum(alpha, ab)[band]
na[gap] = 0

# floor shadow: light grey in the bottom rows goes; the grey blended into the ink next to it becomes see-through ink
shadow = np.zeros(alpha.shape, bool)
if a.shadow:
    h = alpha.shape[0]
    zone = np.zeros(alpha.shape, bool)
    zone[int(h * (1 - a.shadow)):] = True
    grey = zone & (mx - mn <= 20) & (alpha > 0)
    shadow = grey & (((alpha >= 0.8) & (mn >= 150)) | ((alpha < 0.8) & (mn >= 60)))
    level = np.median(mn[shadow & (alpha >= 0.8)]) if (shadow & (alpha >= 0.8)).any() else 184
    edge = nd.binary_dilation(shadow, iterations=2) & ~shadow & grey
    out[edge, :3] = 0
    na[edge] = (alpha * np.clip(1 - mn / level, 0, 1))[edge]
    na[shadow] = 0
    # specks of the shadow's rim that touch no solid part of the figure go too
    loose = zone & ~nd.binary_dilation(na >= 0.8, iterations=2) & (na > 0)
    shadow |= loose
    na[loose] = 0

out[..., 3] = na * 255
out[na == 0, :3] = 0
Image.fromarray(out.round().astype(np.uint8), "RGBA").save(a.dst, optimize=True)
print(f"{a.dst}: {int(gap.sum())} px cut in {len(a.at)} gaps, {int(shadow.sum())} px of floor shadow")
