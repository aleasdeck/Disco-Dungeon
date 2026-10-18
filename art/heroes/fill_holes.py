"""Fill see-through holes inside a cut-out figure with white.

The white-background cutout also removed white areas that sit inside the figure
(an apron, a shirt, card faces, teeth). This finds transparent regions that do
not touch the image border and puts them back over white, together with their
soft edge, so they look as in the original render. Real gaps (light between a
cable and an arm) are kept with --keep x,y (a point inside the gap, repeatable).

usage: python3 fill_holes.py in.png out.png [--keep 79,387] [--min 1]
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("dst")
p.add_argument("--keep", action="append", default=[], help="x,y inside a gap that must stay transparent")
p.add_argument("--min", type=int, default=1, help="ignore holes smaller than this many pixels")
a = p.parse_args()

im = np.asarray(Image.open(a.src).convert("RGBA")).astype(np.float32)
alpha = im[..., 3] / 255
lab, n = nd.label(alpha < 0.5)
outside = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}
for k in a.keep:
    x, y = (int(v) for v in k.split(","))
    outside.add(int(lab[y, x]))
sizes = nd.sum(np.ones_like(alpha), lab, range(n + 1))
holes = (lab > 0) & ~np.isin(lab, list(outside)) & (sizes[lab] >= a.min)
# the soft edge around a hole goes too, but not the soft edge of the outer silhouette or of a kept gap
edge = nd.binary_dilation(holes, iterations=3) & ~nd.binary_dilation(np.isin(lab, list(outside)) & (lab > 0), iterations=3)
fill = (holes | edge) & (alpha < 1)
rgb = im[..., :3] * alpha[..., None] + 255 * (1 - alpha[..., None])
out = im.copy()
out[fill, :3] = rgb[fill]
out[fill, 3] = 255
Image.fromarray(out.round().astype(np.uint8), "RGBA").save(a.dst, optimize=True)
print(f"{a.dst}: {int(holes.sum())} hole px in {len(np.unique(lab[holes]))} holes, {int(fill.sum())} px filled")
