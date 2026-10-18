#!/usr/bin/env python3
"""
Stages of the resource pictures: a mushroom patch, a spark crystal and an ore vein lose a piece for every charge taken.
They are cut from the full pictures in public/assets/env, so no new art is needed:

  mushrooms_1, mushrooms_2   one mushroom is one heal: the right small one goes first, then the left, the big one is the last
  crystal_1, crystal_2       one crystal is one spark: the right one goes first, then the left, the tall middle one is the last;
                             the rock's top edge is drawn on where a crystal stood
  ore_1 .. ore_6             as many gold nuggets as are left of the 7: each is painted over with the stone around it

Every stage has the full picture's size, so it stands where the full one stood. Where a piece is taken away, what stays
gets an outline as thick as the picture's own. The mushroom picture had white left between the stems: the full one is
written again with those gaps cut out, and this works from the picture as it was (mushrooms_src.webp next to this script).

  python3 art/env/res_stages.py [env dir]       (default public/assets/env; writes the stages next to the full pictures)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
ENV = Path(sys.argv[1] if len(sys.argv) > 1 else HERE.parents[1] / 'public/assets/env')
# work at 4 × the size, so new edges come out smooth when it is scaled back
S = 4
# ink lines are about this many pixels thick in the pictures
T = 4


def load(path):
    return np.array(Image.open(path).convert('RGBA')).astype(np.float64)


def save(a, name):
    Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8)).save(ENV / f'{name}.webp', 'WEBP', quality=90, method=6)
    print('wrote', ENV / f'{name}.webp')


def premul(a):
    p = a.copy()
    p[..., :3] *= p[..., 3:] / 255
    return p


def unpremul(p):
    rgb = np.where(p[..., 3:] > 0, p[..., :3] * 255 / np.maximum(p[..., 3:], 1e-6), 0)
    return np.concatenate([np.clip(rgb, 0, 255), np.clip(p[..., 3:], 0, 255)], -1)


def up(a):
    """The picture S times bigger, colours premultiplied so transparent pixels don't darken the edges."""
    h, w = a.shape[:2]
    p = premul(a)
    return unpremul(np.stack([np.array(Image.fromarray(p[..., k].astype(np.float32), 'F').resize((w * S, h * S), Image.LANCZOS)) for k in range(4)], -1))


def down(a):
    """Back to the full picture's size: each pixel the average of its S × S block."""
    h, w = a.shape[0] // S, a.shape[1] // S
    return unpremul(premul(a).reshape(h, S, w, S, 4).mean((1, 3)))


def regions(a):
    """Ink (the black outlines), and the patches of colour between them, labelled."""
    rgb, al = a[..., :3], a[..., 3]
    ink = (al > 128) & (rgb.max(-1) < 80)
    lab, _ = ndi.label((al > 128) & ~ink)
    return ink, lab


def parts(lab, seeds, optional=()):
    """Which part every patch of colour belongs to: `seeds` maps a part to points (at the picture's own size) inside its
    patches; crumbs no seed lands in go to the nearest seeded patch. A seed of an `optional` part may land on nothing."""
    own = np.zeros(lab.shape, np.int32)
    names = list(seeds)
    for k, name in enumerate(names, 1):
        for x, y in seeds[name]:
            l = lab[y * S + S // 2, x * S + S // 2]
            if not l and name in optional: continue
            assert l, f'{name} seed {(x, y)} lands on ink or air'
            own[lab == l] = k
    _, (iy, ix) = ndi.distance_transform_edt(own == 0, return_indices=True)
    own = np.where(lab > 0, own[iy, ix], 0)
    return {name: own == k for k, name in enumerate(names, 1)}


def near(mask, r):
    return ndi.distance_transform_edt(~mask) <= r


def ink_colour(a, ink):
    return np.median(a[ink & (a[..., 3] > 250)][:, :3], 0)


def finish(full, big, name):
    """Scale the worked picture back, keeping the original's own pixels wherever nothing changed, and without the specks
    a lost piece's outline may leave in the air."""
    small = down(big)
    changed = ndi.binary_dilation(np.abs(small - full).max(-1) > 3, iterations=1)
    out = np.where(changed[..., None], small, full)
    lab, n = ndi.label(out[..., 3] >= 1)
    sizes = ndi.sum(np.ones(lab.shape), lab, range(1, n + 1))
    out[np.isin(lab, [i + 1 for i in range(n) if sizes[i] < 60])] = 0
    save(out, name)


def without(a, ink, keep, drop, behind=None):
    """
    The picture with the pieces in `drop` gone. Around them what stays in `keep` is outlined again: its colour, the half
    of each line on its side, and a stroke out from there, so the outline is as thick as elsewhere and no stub of a lost
    piece's outline sticks out of it. Whatever is left around a lost piece is air, or drawn by `behind(out, mask)`.
    """
    zone = near(drop, (T + 3) * S) & ~keep
    dk, dd = ndi.distance_transform_edt(~keep), ndi.distance_transform_edt(~drop)
    core = keep | (ink & (dk <= T * S / 2) & (dk <= dd))
    line = zone & near(core, T * S / 2)
    out = a.copy()
    rest = zone & ~line
    if behind: behind(out, rest)
    else: out[rest] = 0
    out[line] = [*ink_colour(a, ink), 255]
    return out


def mushrooms():
    src = HERE / 'mushrooms_src.webp'
    full = load(src)
    a = up(full)
    ink, lab = regions(a)
    p = parts(lab, {
        'big': [(90, 40), (100, 150), (130, 82), (60, 88)],
        'left': [(30, 110), (64, 125), (22, 135), (50, 160)],
        'right': [(165, 105), (138, 120), (180, 130), (150, 155)],
        'gap': [(125, 120), (74, 104), (69, 135)],
    })
    big, left, right, gap = p['big'], p['left'], p['right'], p['gap']
    finish(full, without(a, ink, big | left | right, gap), 'mushrooms')
    finish(full, without(a, ink, big | left, gap | right), 'mushrooms_2')
    finish(full, without(a, ink, big, gap | right | left), 'mushrooms_1')


def crystal():
    full = load(ENV / 'crystal.webp')
    a = up(full)
    ink, lab = regions(a)
    p = parts(lab, {
        'mid': [(74, 32), (56, 34), (53, 45), (86, 46), (69, 55)],
        'left': [(15, 70), (26, 64), (35, 81), (19, 83)],
        'right': [(111, 61), (118, 67), (128, 70), (104, 70), (112, 79), (99, 139)],
        'rock': [(43, 181)],
    })
    rock = p['rock']
    tone, inkc = np.median(a[rock][:, :3], 0), ink_colour(a, ink)
    # the rock's top edge where it shows, column by column at the picture's own size: the top of the grey
    top = {}
    for x in range(full.shape[1]):
        ys = np.nonzero(rock[:, x * S + S // 2])[0]
        if len(ys): top[x] = ys.min() / S
    # under the crystals it is a low dome: on each side the edge carries on as a parabola peaking under the middle
    # crystal, fitted to the last stretch of edge showing next to the side crystal
    peak = 72
    fit = {}
    for side, xs in ((-1, range(18, 34)), (1, range(108, 124))):
        fit[side] = np.polyfit([(x - peak) ** 2 for x in xs], [top[x] for x in xs], 1)
    H, W = a.shape[:2]
    X, Y = np.meshgrid((np.arange(W) + 0.5) / S, (np.arange(H) + 0.5) / S)
    k = np.where(X < peak, fit[-1][0], fit[1][0])
    b = np.where(X < peak, fit[-1][1], fit[1][1])
    edge = b + k * (X - peak) ** 2

    def dome(out, m):
        # under the edge the rock's grey, on it a line as thick as the rest, above it air
        out[m] = 0
        out[m & (Y >= edge - T)] = [*inkc, 255]
        out[m & (Y >= edge)] = [*tone, 255]

    finish(full, without(a, ink, p['mid'] | p['left'], p['right'], dome), 'crystal_2')
    finish(full, without(a, ink, p['mid'], p['right'] | p['left'], dome), 'crystal_1')


def ore():
    full = load(ENV / 'ore.webp')
    a = up(full)
    rgb, al = a[..., :3], a[..., 3]
    solid = al > 128
    gold = solid & (rgb[..., 0] > 150) & (rgb[..., 1] > 110) & (rgb[..., 2] < 140) & (rgb[..., 0] - rgb[..., 2] > 60)
    lab, n = ndi.label(gold)
    sizes = ndi.sum(gold, lab, range(1, n + 1))
    nug = [i + 1 for i in np.argsort(-sizes)[:7]]
    at = {l: np.array(ndi.center_of_mass(lab == l)) / S for l in nug}
    # the order they stay in: the last ones left sit across the stone from each other
    order = [(192, 110), (24, 115), (155, 23), (70, 161), (48, 43), (175, 160), (198, 67)]
    keep = [min(nug, key=lambda l: (at[l][1] - x) ** 2 + (at[l][0] - y) ** 2) for x, y in order]
    assert len(set(keep)) == 7
    ink = solid & (rgb.max(-1) < 80)
    stone = solid & ~ink & ~gold
    inkc = ink_colour(a, ink)
    for k in range(1, 7):
        lost = np.zeros(gold.shape, bool)
        for l in keep[k:]:
            lost |= lab == l
        # the nugget with its outline and the shade it throws; a nugget on the stone's edge leaves a bump in it
        hole = near(lost, 6 * S) & solid
        known = stone & ~near(ink, 2 * S) & ~hole
        # each pixel of it takes the stone's colour nearest to it, so the stone's light and shade carry on, then the
        # seams are softened a little
        _, (iy, ix) = ndi.distance_transform_edt(~known, return_indices=True)
        out = a.copy()
        out[hole, :3] = rgb[iy, ix][hole]
        out[hole, 3] = 255
        soft = out[..., :3].copy()
        for _ in range(2):
            soft = np.stack([ndi.uniform_filter(soft[..., c], 3 * S) for c in range(3)], -1)
            soft[~hole] = out[~hole, :3]
        out[hole, :3] = soft[hole]
        # and the stone's outline runs on round it
        out[hole & near(~solid, T * S)] = [*inkc, 255]
        finish(full, out, f'ore_{k}')


if __name__ == '__main__':
    mushrooms()
    crystal()
    ore()
