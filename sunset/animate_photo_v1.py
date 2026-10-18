"""Animate the sunset photo: rippling water, glittering sun path, bobbing boat, pulsing sun.
Writes PNG frames to stdout as raw RGB for ffmpeg. The loop is seamless: every motion
term completes a whole number of cycles in LOOP seconds."""
import sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
FPS, LOOP = 30, 8.0
W = 1080
TAU = 2 * np.pi

img = Image.open(SRC).convert("RGB")
s = W / img.width
H = int(round(img.height * s)) // 2 * 2
img = img.resize((W, H), Image.LANCZOS)
base = np.asarray(img).astype(np.float32)

# landmarks measured on the 1456x2576 original
HOR = int(1588 * s)
bx0, bx1, by0, by1 = [int(v * s) for v in (680, 908, 1676, 1742)]
SUN = (794 * s, 324 * s)

lum = base.mean(2)

# --- cut the boat out: dark pixels in its box, softened
pad = 6
box = (slice(by0 - pad, by1 + pad), slice(bx0 - pad, bx1 + pad))
boat_rgb = base[box].copy()
m = (lum[box] < 105).astype(np.float32)
for _ in range(2):  # cheap blur to feather the edge
    m = (m + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)) / 5
boat_mask = np.clip(m * 1.6, 0, 1)[..., None]

# --- fill the hole with water from just above the boat, feathered
water = base.copy()
bh = by1 - by0 + 2 * pad
donor = base[by0 - pad - bh - 4: by1 + pad - bh - 4, bx0 - pad: bx1 + pad]
fill = np.clip(boat_mask * 1.8, 0, 1)
water[box] = water[box] * (1 - fill) + donor * fill

# --- precomputed grids for the sea
ys = np.arange(HOR, H, dtype=np.float32)[:, None]
xs = np.arange(W, dtype=np.float32)[None, :]
p = (ys - HOR) / (H - HOR)                   # 0 at horizon, 1 at bottom: perspective
sea = water[HOR:]
bright = np.clip((sea.mean(2) - 150) / 90, 0, 1)[..., None]   # glitter only on lit wavelets
fade = np.clip((ys - HOR) / 6, 0, 1)[..., None]               # keep the horizon line crisp

# sun path centre for extra glitter
path = np.exp(-((xs - SUN[0]) / (W * 0.22)) ** 2)[..., None]

rng = np.random.default_rng(3)
def soft_noise(h, w):
    n = rng.random((h, w)).astype(np.float32)
    for _ in range(2):
        n = (n + np.roll(n, 1, 0) + np.roll(n, 1, 1) + np.roll(n, -1, 1)) / 4
    return (n - n.min()) / (n.max() - n.min())
N1 = soft_noise(H - HOR, W)
N2 = soft_noise(H - HOR, W)
GOLD = np.array([255, 236, 170], np.float32) * 0.9

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
sun_glow = np.exp(-(((xx - SUN[0]) ** 2 + (yy - SUN[1]) ** 2) / (2 * (W * 0.28) ** 2)))[..., None]


def sample(src, fx, fy):
    """Bilinear sample src (h, w, 3) at float coords fx, fy (h, w)."""
    h, w = src.shape[:2]
    fx = np.clip(fx, 0, w - 1.001)
    fy = np.clip(fy, 0, h - 1.001)
    x0 = fx.astype(np.int32); y0 = fy.astype(np.int32)
    ax = (fx - x0)[..., None]; ay = (fy - y0)[..., None]
    a = src[y0, x0]; b = src[y0, x0 + 1]; c = src[y0 + 1, x0]; d = src[y0 + 1, x0 + 1]
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay


frames = int(FPS * LOOP)
out = sys.stdout.buffer
for f in range(frames):
    t = f / frames                      # 0..1 around the loop
    ph = TAU * t

    # water: waves roll toward the viewer; bigger and longer near the bottom
    k1 = TAU / (6 + 40 * p)             # vertical wavelength in px grows with distance
    dx = (0.4 + 2.6 * p) * np.sin(ys * k1 - 3 * ph + xs * 0.004)
    dy = (0.3 + 1.8 * p) * np.sin(xs * (TAU / (90 + 260 * p)) + ys * k1 * 0.5 - 2 * ph)
    dy = dy + (0.2 + 0.9 * p) * np.sin(xs * (TAU / (37 + 120 * p)) - ys * 0.05 + 4 * ph)
    wave = sample(sea, xs + dx * fade[..., 0], ys - HOR + dy * fade[..., 0])

    # glitter: two random fields sliding past each other; where both peak, a wavelet twinkles.
    # Each field wraps exactly once per loop, so the loop stays seamless.
    a = np.roll(N1, int(round(t * N1.shape[0])), axis=0)[: len(ys)]
    b = np.roll(N2, -int(round(t * N2.shape[1])), axis=1)[: len(ys)]
    spark = np.clip(a * b - 0.42, 0, None)[..., None] * 3.0
    wave = wave + bright * (0.35 + path) * spark * GOLD

    frame = water.copy()
    frame[HOR:] = wave

    # sun: slow breathing glow
    frame = frame * (1 + 0.06 * np.sin(ph) * sun_glow) + 10 * (0.5 + 0.5 * np.sin(ph)) * sun_glow

    # boat: bob and rock gently on the swell
    bob = 2.2 * np.sin(2 * ph)
    drift = 3.0 * np.sin(ph)
    oy, ox = int(round(bob)), int(round(drift))
    ys_b = slice(box[0].start + oy, box[0].stop + oy)
    xs_b = slice(box[1].start + ox, box[1].stop + ox)
    frame[ys_b, xs_b] = frame[ys_b, xs_b] * (1 - boat_mask) + boat_rgb * boat_mask

    out.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
    if f % 30 == 0:
        print(f"frame {f}/{frames}", file=sys.stderr)

print(f"{W}x{H}", file=sys.stderr)
