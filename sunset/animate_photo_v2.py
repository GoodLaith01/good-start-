"""Sunset cinemagraph v2.

Sea: the photo's own water flows toward the camera in perspective (two-phase flow loop with
variance-preserving blend), detail is re-lit by the original low-frequency light so the sun path
stays put, rolling swells displace and shade the water, and sun glints twinkle on the wavelets.
Boat bobs on the swell. The fisherman is redrawn as an articulated silhouette that casts, waits,
gets a bite, fights, lands a fish and resets. Gulls cross the sky. Everything loops in DUR seconds.

usage: python3 sunset_v2.py photo.jpg [first_frame last_frame] > raw_rgb_stream
"""
import math
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1]
FPS, DUR = 30, 20.0
NF = int(FPS * DUR)
W = 1080
TAU = 2 * math.pi
SS = 5  # supersampling for drawn elements

img = Image.open(SRC).convert("RGB")
S = W / img.width
H = int(round(img.height * S)) // 2 * 2
base = np.asarray(img.resize((W, H), Image.LANCZOS)).astype(np.float32)
lum = base.mean(2)


def sc(v):
    return v * S


HOR = int(round(sc(1588)))
SUN = (sc(794), sc(324))
rng = np.random.default_rng(11)


# ---------------------------------------------------------------- helpers
def blur1d(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, r, it=3):
    for _ in range(it):
        a = blur1d(blur1d(a, r, 0), r, 1)
    return a


def sample(src, fx, fy):
    h, w = src.shape[:2]
    fx = np.clip(fx, 0, w - 1.001)
    fy = np.clip(fy, 0, h - 1.001)
    x0 = fx.astype(np.int32)
    y0 = fy.astype(np.int32)
    ax = fx - x0
    ay = fy - y0
    if src.ndim == 3:
        ax = ax[..., None]
        ay = ay[..., None]
    a, b = src[y0, x0], src[y0, x0 + 1]
    c, d = src[y0 + 1, x0], src[y0 + 1, x0 + 1]
    return (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay


def sample_wrap(tex, fx, fy):
    h, w = tex.shape
    fx = np.mod(fx, w)
    fy = np.mod(fy, h)
    x0 = fx.astype(np.int32) % w
    y0 = fy.astype(np.int32) % h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    ax = fx - np.floor(fx)
    ay = fy - np.floor(fy)
    top = tex[y0, x0] * (1 - ax) + tex[y0, x1] * ax
    bot = tex[y1, x0] * (1 - ax) + tex[y1, x1] * ax
    return top * (1 - ay) + bot * ay


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def keyframes(t, keys):
    """keys: list of (time, value...) tuples; smoothstep between neighbours."""
    if t <= keys[0][0]:
        return keys[0][1:]
    for k0, k1 in zip(keys, keys[1:]):
        if t <= k1[0]:
            u = smooth((t - k0[0]) / (k1[0] - k0[0]))
            return tuple(a + (b - a) * u for a, b in zip(k0[1:], k1[1:]))
    return keys[-1][1:]


# ---------------------------------------------------------------- clean plate (boat + man removed)
bx0, by0, bx1, by1 = [int(round(sc(v))) for v in (674, 1678, 914, 1748)]
box = (slice(by0, by1), slice(bx0, bx1))
dark = (lum[box] < 120).astype(np.float32)
hole = np.clip(blur(dark, 2, 2) * 2.2, 0, 1)[..., None]
bh = by1 - by0
donor = base[by0 - bh - 3: by1 - bh - 3, bx0:bx1]
clean = base.copy()
clean[box] = base[box] * (1 - hole) + donor * hole

# boat layer: dark pixels of the hull only (the man is redrawn)
yy_b, xx_b = np.mgrid[by0:by1, bx0:bx1]
hull_zone = (yy_b >= sc(1697)) & (xx_b >= sc(684)) & (xx_b <= sc(906))
man_zone = (xx_b >= sc(855)) & (xx_b <= sc(877)) & (yy_b < sc(1715))
boat_a = ((lum[box] < 112) & hull_zone & ~man_zone).astype(np.float32)
boat_a = np.clip(blur(boat_a, 1, 1) * 1.35, 0, 1)
boat_rgb = base[box].copy()
SIL = np.median(base[box][lum[box] < 80], axis=0)  # silhouette colour of the hull
GUNWALE = sc(1716)
FEET = (sc(866), sc(1715))
HGT = sc(31)

# ---------------------------------------------------------------- sea maps
sea_h = H - HOR
d = np.arange(sea_h, dtype=np.float32)[:, None] + 0.6
xs = np.arange(W, dtype=np.float32)[None, :]
CX = W / 2
K = 600.0
z = K / d
F = 2900.0
Xw = (xs - CX) * z / F
clean_sea = clean[HOR:]
Lsea = blur(clean_sea, 16, 3)
R = clean_sea / np.maximum(Lsea, 6)
Lsea_l = Lsea.mean(2)
path = np.clip((Lsea_l - 120) / 95, 0, 1) ** 1.4  # where the sun path is lit
FLOW = 0.2       # depth units travelled per flow cycle
FLOW_T = DUR / 2  # two flow cycles per loop

# rolling swells in world space: (wavelength in depth units, angle, cycles per loop, amp)
SWELLS = [(0.16, 0.0, 5, 1.0), (0.10, 0.35, 7, 0.55), (0.12, -0.45, 6, 0.6), (0.06, 0.15, 11, 0.3)]
px_per_z = d * d / K

# glints: sparse twinkling points in a pseudo-perspective texture space
q = np.clip((d / sea_h) ** 0.85, 0.1, 1.0)
V = np.cumsum(1.0 / q[:, 0])[:, None].astype(np.float32)
U = (xs - CX) / q
gt = rng.random((256, 512)).astype(np.float32) ** 42
gt = blur(gt, 1, 1)
GTEX = np.clip(gt / np.percentile(gt, 99.9), 0, 1.6)
PHTEX = blur(rng.random((256, 512)).astype(np.float32), 6, 2)
PHTEX = (PHTEX - PHTEX.min()) / (PHTEX.max() - PHTEX.min())
glint_fade = np.clip((d - 12) / 70, 0, 1) * path
GLINT_COL = np.array([255, 240, 200], np.float32)

# sky: haze that morphs (no drift, so it loops) and a breathing sun
haze_a = blur(rng.random((HOR, W)).astype(np.float32), 40, 2)
haze_b = blur(rng.random((HOR, W)).astype(np.float32), 40, 2)
haze_a = (haze_a - haze_a.mean()) / haze_a.std()
haze_b = (haze_b - haze_b.mean()) / haze_b.std()
yy_s, xx_s = np.mgrid[0:HOR, 0:W].astype(np.float32)
sun_glow = np.exp(-(((xx_s - SUN[0]) ** 2 + (yy_s - SUN[1]) ** 2) / (2 * (W * 0.24) ** 2)))[..., None]

# ---------------------------------------------------------------- fishing story
P_LAND = (sc(1010), sc(1757))
P_NEAR = (sc(930), sc(1747))
T_CAST, T_LAND, T_NIBBLE, T_BITE, T_LEAP, T_HANG, T_STOW = 2.45, 3.35, 7.2, 10.5, 13.9, 14.5, 16.0

POSE = [  # time, rod angle (deg), lean, crouch
    (0.0, 58, 0.05, 0.0), (1.5, 58, 0.05, 0.0), (2.25, 145, -0.28, 0.0), (2.6, 22, 0.32, 0.12),
    (3.3, 30, 0.10, 0.0), (10.5, 32, 0.08, 0.0), (10.75, 82, -0.22, 0.05), (11.2, 64, -0.15, 0.0),
    (13.8, 64, -0.15, 0.0), (14.3, 88, -0.26, 0.0), (15.4, 96, -0.10, 0.0), (16.1, 62, 0.32, 0.55),
    (16.7, 60, 0.36, 0.65), (17.6, 58, 0.05, 0.0), (20.0, 58, 0.05, 0.0)]


def boat_bob(t):
    return 1.1 * math.sin(TAU * 5 * t / DUR + 0.7) + 0.45 * math.sin(TAU * 7 * t / DUR + 2.0)


def pose(t):
    ang, lean, crouch = keyframes(t, POSE)
    if 11.2 < t < 13.8:  # pumping and reeling
        u = (t - 11.2) / 2.6
        env = math.sin(math.pi * u)
        ang += 13 * env * math.sin(TAU * (t - 11.2) / 0.85)
        lean += 0.06 * env * math.sin(TAU * (t - 11.2) / 0.85)
    if 3.3 < t < 10.5:  # small idle movements while waiting
        ang += 1.5 * math.sin(TAU * t / 2.7)
    return math.radians(ang), lean, crouch


def rot(vx, vy, a):
    return vx * math.cos(a) - vy * math.sin(a), vx * math.sin(a) + vy * math.cos(a)


def skeleton(t):
    bob = boat_bob(t)
    fx, fy = FEET[0], FEET[1] + bob
    ang, lean, crouch = pose(t)
    hipx, hipy = fx + lean * 3, fy - 0.46 * HGT * (1 - 0.3 * crouch)
    tl = lean + 0.9 * crouch
    sx, sy = rot(0, -0.36 * HGT, tl)
    shx, shy = hipx + sx, hipy + sy
    hx, hy = rot(0, -0.14 * HGT, tl)
    head = (shx + hx, shy + hy)
    a_arm = ang * 0.55 - 0.35
    hand = (shx + 0.24 * HGT * math.cos(a_arm), shy - 0.24 * HGT * math.sin(a_arm) + 0.04 * HGT)
    elbow = ((shx + hand[0]) / 2 + 0.03 * HGT, (shy + hand[1]) / 2 + 0.07 * HGT)
    rod_len = 1.95 * HGT
    dx, dy = math.cos(ang), -math.sin(ang)
    butt = (hand[0] - dx * 0.18 * HGT, hand[1] - dy * 0.18 * HGT)
    tip = (hand[0] + dx * rod_len, hand[1] + dy * rod_len)
    return dict(feet=(fx, fy), hip=(hipx, hipy), sh=(shx, shy), head=head, hand=hand, elbow=elbow,
                butt=butt, tip=tip, bob=bob, crouch=crouch)


def line_end(t, sk):
    """Returns (point, state) where state names what hangs on the line."""
    tip = sk["tip"]
    hang = (tip[0] + 0.6 * math.sin(TAU * t / 1.7), tip[1] + 0.32 * HGT)
    if t < T_CAST or t >= 16.7:
        return hang, "lure"
    if t < T_LAND:
        u = (t - T_CAST) / (T_LAND - T_CAST)
        start = skeleton(T_CAST)["tip"]
        x = start[0] + (P_LAND[0] - start[0]) * u
        y = start[1] + (P_LAND[1] - start[1]) * u - 55 * 4 * u * (1 - u)
        return (x, y), "lure"
    if t < T_BITE:
        bob = 0.7 * math.sin(TAU * 5 * t / DUR + 1.4)
        if abs(t - T_NIBBLE) < 0.35:
            bob += 1.6 * math.sin(math.pi * (t - T_NIBBLE + 0.35) / 0.7)
        return (P_LAND[0], P_LAND[1] + bob), "bobber"
    if t < T_LEAP:
        u = smooth((t - T_BITE - 0.2) / (T_LEAP - T_BITE - 0.2))
        x = P_LAND[0] + (P_NEAR[0] - P_LAND[0]) * u + 7 * math.sin(TAU * u * 2.2) * (1 - u)
        y = P_LAND[1] + (P_NEAR[1] - P_LAND[1]) * u
        return (x, y), "under"
    if t < T_HANG:
        u = smooth((t - T_LEAP) / (T_HANG - T_LEAP))
        hx, hy = tip[0], tip[1] + 0.55 * HGT
        x = P_NEAR[0] + (hx - P_NEAR[0]) * u
        y = P_NEAR[1] + (hy - P_NEAR[1]) * u - 18 * math.sin(math.pi * u)
        return (x, y), "fish"
    swing = 5 * math.sin(TAU * 1.1 * (t - T_HANG)) * math.exp(-(t - T_HANG) * 0.6)
    hang_fish = (tip[0] + swing, tip[1] + 0.55 * HGT)
    if t >= T_STOW:  # he swings it in and drops it into the boat
        u = smooth((t - T_STOW) / 0.6)
        floor = (FEET[0] + 0.3 * HGT, GUNWALE + sk["bob"] + 0.2 * HGT)
        hang_fish = (hang_fish[0] + (floor[0] - hang_fish[0]) * u, hang_fish[1] + (floor[1] - hang_fish[1]) * u)
    return hang_fish, "fish"


def splash_particles(t):
    """(x, y, radius, brightness) for every live droplet."""
    out = []
    events = [(T_LAND, P_LAND, 7, 0.7), (T_BITE, P_LAND, 6, 0.6), (T_LEAP, P_NEAR, 16, 1.0)]
    for i, (te, (px, py), n, power) in enumerate(events):
        a = t - te
        if not 0 <= a < 1.2:
            continue
        r = np.random.default_rng(100 + i)
        for _ in range(n):
            vx = r.uniform(-14, 14) * power
            vy = -r.uniform(14, 34) * power
            rad = r.uniform(0.45, 0.9)
            x, y = px + vx * a, py + vy * a + 0.5 * 70 * a * a
            if y <= py + 1:
                out.append((x, y, rad, 1 - a / 1.2))
    # drips from the hanging fish
    if T_HANG <= t < 16.4:
        for k in range(10):
            te = T_HANG + k * 0.19
            a = t - te
            if 0 <= a < 0.6:
                sk = skeleton(te)
                (fx, fy), _ = line_end(te, sk)
                out.append((fx + 0.3 * (k % 3 - 1), fy + 0.25 * HGT + 0.5 * 90 * a * a, 0.45, 0.9 - a))
    return out


def ripple_events():
    ev = [(T_LAND, P_LAND, 1.0, 22), (T_NIBBLE, P_LAND, 0.45, 10), (T_BITE, P_LAND, 0.9, 18),
          (T_LEAP, P_NEAR, 1.0, 26), (T_HANG + 0.4, P_NEAR, 0.4, 12)]
    t = T_LAND + 1.6
    while t < T_BITE - 0.3:  # bobber lapping
        ev.append((t, P_LAND, 0.25, 7))
        t += 1.9
    t = T_BITE + 0.4
    while t < T_LEAP:  # fish fighting under water
        sk = skeleton(t)
        p, _ = line_end(t, sk)
        ev.append((t, p, 0.45, 9))
        t += 0.33
    return ev


RIPPLES = ripple_events()

GULLS = [  # start time, end time, y, span, flap hz, phase
    (1.5, 15.5, sc(820), 17, 1.6, 0.0), (3.2, 17.0, sc(905), 13, 1.9, 1.3), (7.5, 19.6, sc(700), 9, 2.2, 2.1)]


# ---------------------------------------------------------------- drawing
def stamp(frame, x0, y0, w, h, fn):
    x0, y0 = int(x0), int(y0)
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(W, x0 + w), min(H, y0 + h)
    if x1c <= x0c or y1c <= y0c:
        return None
    im = Image.new("L", (w * SS, h * SS), 0)
    dr = ImageDraw.Draw(im)
    fn(dr, lambda p: ((p[0] - x0) * SS, (p[1] - y0) * SS))
    a = np.asarray(im.resize((w, h), Image.BOX), np.float32) / 255
    return a[y0c - y0:y1c - y0, x0c - x0:x1c - x0], (slice(y0c, y1c), slice(x0c, x1c))


def over(frame, res, color, opacity=1.0):
    if res is None:
        return
    a, sl = res
    a = (a * opacity)[..., None]
    frame[sl] = frame[sl] * (1 - a) + np.asarray(color, np.float32) * a


def add(frame, res, color, gain=1.0):
    if res is None:
        return
    a, sl = res
    frame[sl] = frame[sl] + a[..., None] * np.asarray(color, np.float32) * gain


def quad(p0, c, p1, n=18):
    return [((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0],
             (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1]) for u in np.linspace(0, 1, n)]


def fish_shape(cx, cy, t, angle):
    """Fish outline points hanging head-down from (cx, cy), wiggling."""
    L = 0.42 * HGT
    pts = []
    for u in np.linspace(0, 1, 14):
        wv = math.sin(TAU * 3.2 * t + u * 3.0) * 0.18 * u
        width = 0.11 * HGT * math.sin(math.pi * min(1, u * 1.15)) + 0.01
        pts.append((u * L, width, wv))
    left = [(u, w + wv * L) for u, w, wv in pts]
    right = [(u, -w + wv * L) for u, w, wv in pts][::-1]
    tail_u = L
    tail = [(tail_u + 0.16 * HGT, 0.1 * HGT + pts[-1][2] * L), (tail_u + 0.16 * HGT, -0.1 * HGT + pts[-1][2] * L)]
    poly = left + tail + right
    out = []
    for u, v in poly:
        rx, ry = rot(v, u, angle)
        out.append((cx + rx, cy + ry))
    return out


def draw_fishing(frame, t):
    sk = skeleton(t)
    end, state = line_end(t, sk)
    region = (int(bx0 - 50), int(FEET[1] - 2.9 * HGT - 70), 420, 260)

    def dark(dr, P):
        lw = lambda px: max(1, int(round(px * SS)))
        fx, fy = sk["feet"]
        hip, sh, head, hand, elbow = sk["hip"], sk["sh"], sk["head"], sk["hand"], sk["elbow"]
        # legs and body
        dr.line([P((fx - 0.07 * HGT, fy)), P(hip), P((fx + 0.08 * HGT, fy))], width=lw(0.13 * HGT), joint="curve", fill=255)
        dr.line([P(hip), P(sh)], width=lw(0.2 * HGT), joint="curve", fill=255)
        # arms
        dr.line([P(sh), P(elbow), P(hand)], width=lw(0.085 * HGT), joint="curve", fill=255)
        back_hand = ((sh[0] + hand[0]) / 2 - 0.02 * HGT, (sh[1] + hand[1]) / 2 + 0.05 * HGT)
        dr.line([P(sh), P(back_hand), P(sk["butt"])], width=lw(0.08 * HGT), joint="curve", fill=255)
        hr = 0.09 * HGT
        hx, hy = P(head)
        dr.ellipse([hx - hr * SS, hy - hr * SS, hx + hr * SS, hy + hr * SS], fill=255)
        # hat brim
        dr.line([P((head[0] - 0.13 * HGT, head[1] - 0.05 * HGT)), P((head[0] + 0.13 * HGT, head[1] - 0.05 * HGT))],
                width=lw(0.04 * HGT), fill=255)
        # rod: bends toward the load
        butt, tip = sk["butt"], sk["tip"]
        load = {"lure": 0.0, "bobber": 0.12, "under": 0.75, "fish": 0.55}[state]
        if T_CAST - 0.3 < t < T_CAST + 0.25:
            load = 0.5  # flexing during the cast
        mx, my = (butt[0] + tip[0]) / 2, (butt[1] + tip[1]) / 2
        cx = mx + (end[0] - mx) * 0.18 * load
        cy = my + (end[1] - my) * 0.28 * load
        tip_b = (tip[0] + (end[0] - tip[0]) * 0.12 * load, tip[1] + (end[1] - tip[1]) * 0.12 * load)
        pts = quad(butt, (cx, cy), tip_b, 20)
        for i in range(len(pts) - 1):
            wpx = 0.06 * HGT * (1 - i / len(pts)) + 0.02 * HGT
            dr.line([P(pts[i]), P(pts[i + 1])], width=lw(wpx), fill=255)
        sk["tip_b"] = tip_b
        # line
        sag = {"lure": 0.0, "bobber": 7.0, "under": 1.0, "fish": 0.0}[state]
        if T_CAST <= t < T_LAND:
            sag = 4.0
        lx = (tip_b[0] + end[0]) / 2
        ly = (tip_b[1] + end[1]) / 2 + sag
        dr.line([P(p) for p in quad(tip_b, (lx, ly), end, 24)], width=max(1, int(0.35 * SS)), fill=255)
        # what's on the line
        if state == "lure":
            r = 0.035 * HGT
            ex, ey = P(end)
            dr.ellipse([ex - r * SS, ey - r * SS, ex + r * SS, ey + r * SS], fill=255)
        elif state == "bobber":
            r = 0.06 * HGT
            ex, ey = P((end[0], end[1] - r * 0.6))
            dr.ellipse([ex - r * SS, ey - 1.3 * r * SS, ex + r * SS, ey + 0.7 * r * SS], fill=255)
        elif state == "fish":
            ang = 0.5 * math.sin(TAU * 1.6 * t) + (0.25 if t < T_HANG else 0)
            if t < T_HANG:
                ang = -1.2 + 1.2 * smooth((t - T_LEAP) / (T_HANG - T_LEAP))
            fish_pts = fish_shape(end[0], end[1], t, ang)
            vis = [P((p[0], min(p[1], GUNWALE + sk["bob"] - 0.5))) for p in fish_pts]
            if len(vis) > 3:
                dr.polygon(vis, fill=255)
            sk["fish_pts"] = fish_pts

    res = stamp(frame, *region, dark)
    over(frame, res, SIL, 0.97)

    # bright: droplets, the fish's flank catching the sun, a glint along the line
    def light(dr, P):
        for x, y, r, b in splash_particles(t):
            px, py = P((x, y))
            rr = r * SS
            dr.ellipse([px - rr, py - rr, px + rr, py + rr], fill=int(255 * max(0, min(1, b))))
        if state == "fish" and "fish_pts" in sk and t < 16.0:
            flash = max(0.0, math.sin(TAU * 1.6 * t * 2 + 0.4)) ** 3
            fp = sk["fish_pts"]
            mid = fp[len(fp) // 4: len(fp) // 4 + 6]
            if flash > 0.05:
                dr.line([P(p) for p in mid], width=max(1, int(0.5 * SS)), fill=int(255 * flash))

    res = stamp(frame, *region, light)
    add(frame, res, GLINT_COL, 1.0)


def draw_ripples(frame, t):
    region = (int(bx0 - 50), int(sc(1700)), 420, 120)

    def rings(dr, P, lightness):
        for te, (px, py), power, rmax in RIPPLES:
            a = t - te
            if not 0 <= a < 2.6:
                continue
            for k, lag in enumerate((0.0, 0.35, 0.7)):
                aa = a - lag
                if aa <= 0:
                    continue
                r = 1.5 + rmax * math.sqrt(aa / 2.6)
                fade = power * (1 - a / 2.6) ** 1.6 * (1 - 0.3 * k)
                rx, ry = r, r * 0.26
                cx, cy = P((px, py))
                off = 0.0 if lightness else 0.5
                box = [cx - rx * SS, cy - (ry + off) * SS, cx + rx * SS, cy + (ry - off) * SS]
                dr.ellipse(box, outline=int(255 * min(1, fade)), width=max(1, int(0.55 * SS)))

    res = stamp(frame, *region, lambda dr, P: rings(dr, P, True))
    add(frame, res, (255, 235, 180), 0.55)
    res = stamp(frame, *region, lambda dr, P: rings(dr, P, False))
    over(frame, res, (90, 40, 15), 0.35)


def draw_gulls(frame, t):
    for t0, t1, gy, span, hz, ph in GULLS:
        if not t0 <= t < t1:
            continue
        u = (t - t0) / (t1 - t0)
        gx = W + 40 - (W + 80) * u
        y = gy + 14 * math.sin(TAU * u * 1.5 + ph)
        flap = math.sin(TAU * hz * t + ph)
        glide = 0.5 + 0.5 * math.sin(TAU * 0.25 * t + ph)  # alternate flapping and gliding
        f = flap * (1 - 0.7 * glide)
        s = span * S * 1.35

        def gull(dr, P):
            tipy = -0.28 * s * f
            elb = -0.18 * s - 0.1 * s * f
            left = quad((gx - s / 2, y + tipy), (gx - s * 0.22, y + elb), (gx, y), 10)
            right = quad((gx, y), (gx + s * 0.22, y + elb), (gx + s / 2, y + tipy), 10)
            dr.line([P(p) for p in left + right[1:]], width=max(1, int(0.13 * s * SS / 2.2)), joint="curve", fill=255)

        res = stamp(frame, gx - s, y - s, int(2 * s), int(2 * s), gull)
        alpha = 0.8 if span > 10 else 0.55
        over(frame, res, (70, 35, 18), alpha)


# ---------------------------------------------------------------- frame
def render(f):
    t = f * DUR / NF
    ph = TAU * t / DUR
    frame = clean.copy()

    # sky
    haze = 0.012 * (haze_a * math.cos(ph) + haze_b * math.sin(ph))
    sky = frame[:HOR] * (1 + haze[..., None])
    breath = 0.5 + 0.5 * math.sin(ph * 2)
    frame[:HOR] = sky * (1 + 0.035 * breath * sun_glow) + 6 * breath * sun_glow

    # swells (screen displacement + shading), anti-aliased by fading short waves
    disp = np.zeros((sea_h, W), np.float32)
    shade = np.zeros((sea_h, W), np.float32)
    for lam, ang, cyc, amp in SWELLS:
        k = TAU / lam
        phase = k * (math.cos(ang) * z + math.sin(ang) * Xw) + TAU * cyc * t / DUR
        fade = np.clip((lam * px_per_z - 5) / 10, 0, 1)
        disp += amp * fade * np.sin(phase)
        shade += amp * fade * np.cos(phase)
    disp *= 1.6 * np.clip(d / sea_h, 0, 1) ** 0.8

    # two-phase perspective flow of the photo's own water
    acc = 0.0
    wsum2 = 0.0
    for off in (0.0, 0.5):
        p = (t / FLOW_T + off) % 1.0
        w = 1 - abs(2 * p - 1)
        zs = z + FLOW * p
        ds = K / zs
        sy = ds - 0.6 + disp
        sx = CX + (xs - CX) * (ds / d)
        acc = acc + w * (sample(R, sx, sy) - 1)
        wsum2 += w * w
    detail = 1 + acc / math.sqrt(max(wsum2, 1e-6))
    sea = Lsea * detail
    sea *= (1 + 0.07 * shade * np.clip(d / sea_h * 3, 0, 1))[..., None]

    # sun glints riding toward the camera, each with its own twinkle
    vshift = 256 * t / DUR
    g = sample_wrap(GTEX, U, V - vshift)
    tw = sample_wrap(PHTEX, U, V - vshift)
    twinkle = 0.5 + 0.5 * np.sin(TAU * (tw * 4 + 40 * t / DUR))
    glint = g * twinkle ** 2 * glint_fade * (0.55 + 0.45 * np.clip(shade, -1, 1.5))
    bloom = blur(glint, 2, 1)
    sea += (glint * 1.25 + bloom * 0.9)[..., None] * GLINT_COL
    frame[HOR:] = sea

    draw_ripples(frame, t)

    # boat, bobbing with sub-pixel motion
    bob = boat_bob(t)
    iy = math.floor(bob)
    fy = bob - iy
    a0 = np.zeros_like(boat_a)
    c0 = np.zeros_like(boat_rgb)
    a0[1:] = boat_a[:-1] * fy + boat_a[1:] * (1 - fy)
    c0[1:] = boat_rgb[:-1] * fy + boat_rgb[1:] * (1 - fy)
    sl = (slice(by0 + iy, by1 + iy), box[1])
    frame[sl] = frame[sl] * (1 - a0[..., None]) + c0 * a0[..., None]

    draw_fishing(frame, t)
    draw_gulls(frame, t)
    return np.clip(frame, 0, 255).astype(np.uint8).tobytes()


if __name__ == "__main__":
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else NF
    out = sys.stdout.buffer
    with Pool(4) as pool:
        for i, buf in enumerate(pool.imap(render, range(lo, hi), chunksize=4)):
            out.write(buf)
            if i % 60 == 0:
                print(f"frame {lo + i}/{NF}", file=sys.stderr)
    print(f"{W}x{H}", file=sys.stderr)
