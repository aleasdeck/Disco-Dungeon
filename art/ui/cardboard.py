"""Cardboard for the UI pictures drawn by code (draw_corner.py, draw_plates.py): a flat print on kraft board with the
board's grain and flutes showing through it, the print rubbed off along the cut and round the corners, a scratch or two,
the liner torn off at one corner down to the corrugation, and small nicks in the cut. Vladislav picked this look for the
fight corner on 2026-10-18 (no ink outline, no rim, little shading)."""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

KRAFT = np.array((200, 164, 116), float)


def smooth(rng, shape, scale):
    """noise with blobs about scale pixels across, wrapping round the edges, scaled to about -1..1"""
    h, w = shape
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * np.exp(-2 * (np.pi * scale / 4) ** 2 * (fx * fx + fy * fy))))
    return np.clip(a / (2.5 * a.std()), -1, 1)


def fibres(rng, shape, n):
    """short pale and dark strokes of the pulp, -1..1, wrapping round the edges"""
    h, w = shape
    im = Image.new('L', (w, h), 128)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y, ang, ln = rng.random() * w, rng.random() * h, rng.random() * np.pi, 8 + rng.random() * 18
        v = 128 + int(rng.choice((-1, 1)) * (30 + rng.random() * 50))
        dx, dy = np.cos(ang) * ln / 2, np.sin(ang) * ln / 2
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                d.line([(x + ox - dx, y + oy - dy), (x + ox + dx, y + oy + dy)], fill=v, width=2)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), float) / 128 - 1


def grain(rng, shape, flutes=True):
    """how much lighter or darker the board is at each pixel, around 1: blotches, fibres and (on corrugated board) the
    flutes under the liner showing through as faint stripes"""
    h, w = shape
    g = 1 + 0.05 * smooth(rng, shape, 70) + 0.03 * smooth(rng, shape, 14) + 0.07 * fibres(rng, shape, h * w // 500)
    if flutes:
        g += 0.045 * np.cos(2 * np.pi * np.arange(w) / 28)[None, :]
    return g + rng.uniform(-0.015, 0.015, shape)


def board(img, seed, corners, torn=True, rub=0.1, parts=False, tear=1.0):
    """prints the picture on cardboard: the ink a little soaked into the kraft, the board's grain through it, the print
    rubbed off to bare board in patches along the cut and round the corners (corners, pixels; rub from -1, the whole
    edge, to 1, none of it), a couple of scratches, the liner torn off at one corner (unless torn is false; tear scales
    the bite), and a few small nicks in the cut itself. With parts it gives the bare board and the print apart, for
    style.css to colour the print itself: the print as a grey grain picture to lay over the colour with overlay (128
    is no change) whose alpha says where the ink stays"""
    rng = np.random.default_rng(seed)
    a = np.asarray(img).astype(float)
    shape = a.shape[:2]
    alpha = img.getchannel('A')

    def within(px):
        return np.asarray(alpha.filter(ImageFilter.MinFilter(2 * px + 1)), float) < 128

    yy, xx = np.mgrid[:shape[0], :shape[1]]
    fine, coarse = smooth(rng, shape, 18), smooth(rng, shape, 40)
    # round each corner a blob of bare board, its size and edge ragged
    corner = np.zeros(shape)
    for cx, cy in corners:
        corner = np.maximum(corner, 1 - np.hypot(xx - cx, yy - cy) / (24 + rng.random() * 24))
    worn = (within(3) & (fine > rub)) | (within(10) & (coarse > 0.5)) | (corner + 0.35 * fine > 0.5)
    # scratches: a few thin strokes of bare board across the print
    sc = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(sc)
    for _ in range(rng.integers(1, 4)):
        x, y, ang, ln = rng.random() * img.width, rng.random() * img.height, rng.uniform(-0.6, 0.6), 30 + rng.random() * 80
        d.line([(x, y), (x + np.cos(ang) * ln, y + np.sin(ang) * ln)], fill=120, width=2)
    wear = np.maximum(worn * 255.0, np.asarray(sc, float))
    wear = np.asarray(Image.fromarray(wear.astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1)), float)[..., None] / 255
    g = grain(rng, shape)[..., None]
    ink = a[..., :3] * 0.82 + KRAFT * 0.18
    rgb = (ink * (1 - wear) + KRAFT * wear) * g
    # at one corner the liner is torn off: the flutes under it bare, a pale ragged fringe of torn paper round them
    cx, cy = corners[rng.integers(len(corners))]
    r = 1 - np.hypot(xx - cx, yy - cy) / ((100 + rng.random() * 50) * tear) + 0.18 * smooth(rng, shape, 22)
    bare, stays = KRAFT * g, 1 - wear[..., 0]
    if torn:
        torn, fringe = r > 0.5, r > 0.46
        ribs = KRAFT * (0.8 + 0.18 * np.cos(2 * np.pi * xx / 28))[..., None] * g
        rgb = np.where(fringe[..., None], np.array((236, 224, 198), float) * g, rgb)
        rgb = np.where(torn[..., None], ribs, rgb)
        bare = np.where(fringe[..., None], np.array((236, 224, 198), float) * g, bare)
        bare = np.where(torn[..., None], ribs, bare)
        stays = stays * ~fringe
    a[..., :3] = np.clip(rgb, 0, 255)
    # nicks: the cut is a little ragged
    a[..., 3] *= ~(within(2) & (smooth(rng, shape, 6) < -0.7))
    if parts:
        b = a.copy()
        b[..., :3] = np.clip(bare, 0, 255)
        ink = np.zeros_like(a)
        ink[..., :3] = np.clip(128 + (g - 1) * 128, 0, 255)
        ink[..., 3] = a[..., 3] * stays
        return Image.fromarray(b.astype(np.uint8), 'RGBA'), Image.fromarray(ink.astype(np.uint8), 'RGBA')
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def board_tile(seed, size=256):
    """the board's grain alone as a grey tile that wraps, for style.css to lay over its own shapes (the disc chips)"""
    g = grain(np.random.default_rng(seed), (size, size), flutes=False)
    return Image.fromarray(np.clip(128 + (g - 1) * 500, 0, 255).astype(np.uint8), 'L')


def sharp(p):
    """the polygon's outward corners sharper than 140 degrees"""
    turn = sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(p, p[1:] + p[:1]))
    out = []
    for i, (x, y) in enumerate(p):
        (ax, ay), (bx, by) = p[i - 1], p[(i + 1) % len(p)]
        u, v = (x - ax, y - ay), (bx - x, by - y)
        cross, dot = u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]
        if cross * turn > 0 and np.degrees(np.arctan2(abs(cross), dot)) > 40:
            out.append((x, y))
    return out
