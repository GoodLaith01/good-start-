# ------------------------------------------------------------------ actors and animation
# (exec'd inside scene.py after the world, ocean and camera exist)
import bmesh

TAU = 2 * math.pi
BOAT_C = Vector((3.0, 280.0, 0.0))
BOAT_L = 9.4


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def keyed(t, keys):
    if t <= keys[0][0]:
        return keys[0][1:]
    for k0, k1 in zip(keys, keys[1:]):
        if t <= k1[0]:
            u = smooth((t - k0[0]) / (k1[0] - k0[0]))
            return tuple(a + (b - a) * u for a, b in zip(k0[1:], k1[1:]))
    return keys[-1][1:]


def material(name, color, rough=0.6, metal=0.0, emit=None, haze=True, spec_tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial")
    if emit is not None:
        sh = node(nt, "ShaderNodeEmission", Strength=emit)
        sh.inputs["Color"].default_value = (*color, 1)
    else:
        sh = node(nt, "ShaderNodeBsdfPrincipled")
        sh.inputs["Base Color"].default_value = (*color, 1)
        sh.inputs["Roughness"].default_value = rough
        sh.inputs["Metallic"].default_value = metal
    if haze:
        add_haze(nt, sh.outputs[0], out, 2600.0)
    else:
        link(nt, sh.outputs[0], out.inputs["Surface"])
    return m


M_WOOD = material("Wood", (0.030, 0.014, 0.008), rough=0.55)
M_CLOTH = material("Cloth", (0.022, 0.012, 0.008), rough=0.8)
M_ROD = material("Rod", (0.02, 0.012, 0.008), rough=0.35)
M_LINE = material("Line", (1.0, 0.8, 0.5), emit=0.9, haze=False)
M_FISH = material("Fish", (0.16, 0.14, 0.12), rough=0.18, metal=0.9)
M_DROP = material("Drop", (1.0, 0.86, 0.6), emit=4.0, haze=False)
M_GULL = material("Gull", (0.03, 0.02, 0.015), rough=0.7)


def mesh_object(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def prim(kind, name, mat, **kw):
    getattr(bpy.ops.mesh, f"primitive_{kind}_add")(**kw)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


# ---------------- boat: lofted wooden skiff, raised stern post on the right like the photo
def build_boat():
    st, k = 36, 14
    verts, faces = [], []
    for i in range(st):
        u = -1 + 2 * i / (st - 1)
        x = u * BOAT_L / 2
        beam = 1.05 * max(0.0, 1 - abs(u) ** 2.2) ** 0.55 + 0.02
        zg = 0.55 + 0.25 * u ** 4 + (0.55 * max(0, u - 0.82) / 0.18 if u > 0.82 else 0)  # sheer + raised end
        zk = -0.45 + 0.35 * abs(u) ** 5
        for j in range(k):
            ph = -math.pi / 2 + math.pi * j / (k - 1)
            y = beam * math.sin(ph)
            zz = zk + (zg - zk) * (1 - math.cos(ph)) ** 0.8
            verts.append((x, y, zz))
    for i in range(st - 1):
        for j in range(k - 1):
            a = i * k + j
            faces.append((a, a + 1, a + k + 1, a + k))
    hull = mesh_object("Hull", verts, faces, M_WOOD)
    sol = hull.modifiers.new("Thick", "SOLIDIFY")
    sol.thickness = 0.05
    for p in hull.data.polygons:
        p.use_smooth = True
    # thwarts and a little cuddy box for a believable silhouette
    parts = [hull]
    for xb in (-2.4, -0.6, 1.2):
        t = prim("cube", "Thwart", M_WOOD, size=1)
        t.scale = (0.25, 1.6, 0.05)
        t.location = (xb, 0, 0.3)
        parts.append(t)
    box = prim("cube", "Box", M_WOOD, size=1)
    box.scale = (0.9, 0.9, 0.35)
    box.location = (-3.2, 0, 0.35)
    parts.append(box)
    pole = prim("cylinder", "Pole", M_WOOD, radius=0.03, depth=1.6, vertices=8)
    pole.location = (-4.1, 0, 0.9)
    pole.rotation_euler = (0, math.radians(-12), 0)
    parts.append(pole)
    root = bpy.data.objects.new("Boat", None)
    sc.collection.objects.link(root)
    for p in parts:
        p.parent = root
    return root


boat = build_boat()

# ---------------- ocean probe: tiny mesh with the same ocean modifier, read every frame
PROBE_LOCAL = [(-4.2, 0, 0), (-2.1, 0, 0), (0, 0, 0), (2.1, 0, 0), (4.2, 0, 0), (0, 0.9, 0), (0, -0.9, 0)]
P_LAND = BOAT_C + Vector((8.0, -6.5, 0))
P_NEAR = BOAT_C + Vector((5.2, -2.2, 0))
PATH_N = 12
probe_pts = [BOAT_C + Vector(p) for p in PROBE_LOCAL]
probe_pts += [P_LAND.lerp(P_NEAR, i / (PATH_N - 1)) for i in range(PATH_N)]
from mathutils import Matrix as _M
_unrot = _M.Rotation(-OCEAN_ROT, 3, "Z")
probe = mesh_object("Probe", [tuple(_unrot @ p) for p in probe_pts], [], M_WOOD)
probe.rotation_euler = (0, 0, OCEAN_ROT)
pm = probe.modifiers.new("Ocean", "OCEAN")
for attr in ("geometry_mode", "spatial_size", "resolution", "wave_scale", "choppiness", "wind_velocity",
             "wave_alignment", "wave_direction", "spectrum", "random_seed", "depth"):
    setattr(pm, attr, getattr(om, attr))
pm.viewport_resolution = om.resolution
pm.driver_add("time").driver.expression = "frame/24"
probe.hide_render = True

heights = []
for f in range(1, NFR + 1):
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = probe.evaluated_get(dg)
    heights.append([v.co.z for v in ev.data.vertices])
heights = np.array(heights)
print("probe heights range", heights.min().round(2), heights.max().round(2))
# rigid boat: heave from the mean, pitch/roll from fits, low-passed for inertia


def lowpass(x, a=0.18):
    y = np.copy(x)
    for i in range(1, len(x)):
        y[i] = y[i - 1] + a * (x[i] - y[i - 1])
    for i in range(len(x) - 2, -1, -1):
        y[i] = y[i + 1] + a * (y[i] - y[i + 1])
    return y


keel_x = np.array([p[0] for p in PROBE_LOCAL[:5]])
heave = lowpass(heights[:, :7].mean(1))
pitch = lowpass(np.array([np.polyfit(keel_x, h[:5], 1)[0] for h in heights]))
roll = lowpass((heights[:, 5] - heights[:, 6]) / 1.8)
path_h = heights[:, 7:]


def water_at(f, u):
    """water height at fraction u (0 = P_LAND, 1 = P_NEAR) on frame index f."""
    x = u * (PATH_N - 1)
    i = min(PATH_N - 2, int(x))
    a = x - i
    return path_h[f, i] * (1 - a) + path_h[f, i + 1] * a


def boat_matrix(fi):
    from mathutils import Matrix
    rot = Euler((math.atan(roll[fi]) * 0.8, -math.atan(pitch[fi]) * 0.8, math.radians(0))).to_matrix().to_4x4()
    return Matrix.Translation(BOAT_C + Vector((0, 0, heave[fi]))) @ rot


# ---------------- the fisherman (world-space rig evaluated every frame)
MS = 1.15
MAN_LOCAL = Vector((2.7, 0.15, 0.05))  # feet on the boat floor near the raised end
FACE_YAW = math.atan2((P_LAND - (BOAT_C + MAN_LOCAL)).y, (P_LAND - (BOAT_C + MAN_LOCAL)).x)


def seg_object(name, radius, mat, verts=10):
    ob = prim("cylinder", name, mat, radius=radius, depth=1.0, vertices=verts)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return ob


parts = {
    "thighL": seg_object("ThighL", 0.085, M_CLOTH), "thighR": seg_object("ThighR", 0.085, M_CLOTH),
    "shinL": seg_object("ShinL", 0.07, M_CLOTH), "shinR": seg_object("ShinR", 0.07, M_CLOTH),
    "torso": seg_object("Torso", 0.17, M_CLOTH, 14), "neck": seg_object("Neck", 0.055, M_CLOTH),
    "uarmL": seg_object("UArmL", 0.055, M_CLOTH), "uarmR": seg_object("UArmR", 0.055, M_CLOTH),
    "farmL": seg_object("FArmL", 0.045, M_CLOTH), "farmR": seg_object("FArmR", 0.045, M_CLOTH),
}
head = prim("uv_sphere", "Head", M_CLOTH, radius=0.13, segments=16, ring_count=10)
hat = prim("cone", "Hat", M_CLOTH, radius1=0.27, radius2=0.0, depth=0.13, vertices=24)
handL = prim("uv_sphere", "HandL", M_CLOTH, radius=0.05, segments=8, ring_count=6)
handR = prim("uv_sphere", "HandR", M_CLOTH, radius=0.05, segments=8, ring_count=6)


def place_seg(ob, p, q, f):
    d = q - p
    ob.location = (p + q) / 2
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    ob.scale = (1, 1, max(d.length, 1e-4))
    ob.keyframe_insert("location", frame=f)
    ob.keyframe_insert("rotation_quaternion", frame=f)
    ob.keyframe_insert("scale", frame=f)


def place(ob, p, f, rot=None):
    ob.location = p
    ob.keyframe_insert("location", frame=f)
    if rot is not None:
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = rot
        ob.keyframe_insert("rotation_quaternion", frame=f)


def two_bone(a, target, l1, l2, pole):
    d = target - a
    dist = min(d.length, l1 + l2 - 1e-3)
    d.normalize()
    target = a + d * dist
    cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    ang = math.acos(max(-1, min(1, cosA)))
    side = (pole - d * pole.dot(d)).normalized()
    elbow = a + (d * math.cos(ang) + side * math.sin(ang)) * l1
    return elbow, target


def curve_object(name, n, bevel, mat, taper=None):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = bevel
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    sp.points.add(n - 1)
    for i, p in enumerate(sp.points):
        p.radius = 1.0 if taper is None else taper(i / (n - 1))
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


rod = curve_object("Rod", 16, 0.032, M_ROD, taper=lambda u: 1.0 - 0.65 * u)
line = curve_object("Line", 32, 0.006, M_LINE)
floater = prim("uv_sphere", "Float", M_ROD, radius=0.07, segments=10, ring_count=8)


def set_curve(ob, pts, f):
    for p, c in zip(ob.data.splines[0].points, pts):
        p.co = (c.x, c.y, c.z, 1.0)
        p.keyframe_insert("co", frame=f)


def bez(p0, c, p1, n):
    return [p0 * (1 - u) ** 2 + c * 2 * (1 - u) * u + p1 * u * u for u in np.linspace(0, 1, n)]


# fish: body + tail, silver
fish = prim("uv_sphere", "Fish", M_FISH, radius=1.0, segments=16, ring_count=10)
fish.scale = (0.07, 0.15, 0.32)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
tail = prim("cone", "Tail", M_FISH, radius1=0.13, radius2=0.0, depth=0.18, vertices=6)
tail.scale = (0.25, 1, 1)
tail.location = (0, 0, -0.36)
tail.rotation_euler = (math.pi, 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tail.parent = fish

# timeline (seconds)
T_WIND, T_CAST, T_LAND = 9.3, 10.05, 11.0
T_NIBBLE, T_BITE = 12.6, 13.9
T_LEAP, T_HANG, T_STOW, T_DONE = 16.4, 17.0, 18.3, 19.1
POSE = [  # t, rod elevation deg (>90 = over the shoulder), torso lean, crouch, yaw offset deg
    (0.0, 55, 0.04, 0.0, 0), (4.0, 55, 0.04, 0.0, 0), (5.5, 60, 0.02, 0.0, 18), (7.5, 58, 0.03, 0.0, 10),
    (8.8, 55, 0.04, 0.0, 0), (T_WIND, 52, 0.06, 0.05, 0), (T_CAST - 0.25, 150, -0.22, 0.0, -6),
    (T_CAST + 0.15, 18, 0.3, 0.12, 4), (T_LAND + 0.4, 28, 0.08, 0.0, 0), (T_BITE, 30, 0.06, 0.0, 0),
    (T_BITE + 0.3, 84, -0.25, 0.05, -4), (T_BITE + 0.8, 66, -0.15, 0.08, 0), (T_LEAP - 0.3, 66, -0.15, 0.08, 0),
    (T_LEAP + 0.2, 84, -0.25, 0.0, -8), (T_HANG + 0.9, 64, -0.05, 0.0, -25), (T_STOW + 0.3, 70, 0.35, 0.6, -60),
    (T_DONE, 66, 0.3, 0.55, -60), (DUR, 58, 0.05, 0.0, -10)]


def pose(t):
    ang, lean, crouch, yaw = keyed(t, POSE)
    if T_BITE + 0.8 < t < T_LEAP - 0.3:
        env = math.sin(math.pi * (t - T_BITE - 0.8) / (T_LEAP - T_BITE - 1.1))
        ang += 12 * env * math.sin(TAU * (t - T_BITE) / 0.8)
        lean += 0.07 * env * math.sin(TAU * (t - T_BITE) / 0.8)
    if T_LAND < t < T_BITE:
        ang += 1.2 * math.sin(TAU * t / 2.6)
    return math.radians(ang), lean, crouch, math.radians(yaw)


def rig(t, fi):
    M = boat_matrix(fi)
    ang, lean, crouch, yaw = pose(t)
    bz = Vector((0, 0, 1))
    fwd = Vector((math.cos(FACE_YAW + yaw), math.sin(FACE_YAW + yaw), 0))
    side = fwd.cross(bz)
    feet = M @ MAN_LOCAL
    up = (M.to_3x3() @ bz).normalized()
    hip = feet + up * MS * (0.92 - 0.35 * crouch) + fwd * (0.1 * crouch)
    tilt = lean + 0.9 * crouch
    tdir = (up * math.cos(tilt) + fwd * math.sin(tilt)).normalized()
    sh = hip + tdir * 0.55 * MS
    head_c = sh + tdir * 0.26 * MS
    # rod direction and grip
    rdir = (fwd * math.cos(ang) + bz * math.sin(ang)).normalized()
    grip = sh + fwd * 0.3 + side * 0.08 - bz * 0.12 + rdir * 0.1
    butt = grip - rdir * 0.5
    tip = grip + rdir * 3.0
    return dict(M=M, feet=feet, hip=hip, sh=sh, head=head_c, tdir=tdir, fwd=fwd, side=side, rdir=rdir,
                grip=grip, butt=butt, tip=tip, crouch=crouch)


def line_target(t, fi, R):
    """End point of the line and what is on it."""
    hang = R["tip"] - Vector((0, 0, 0.55))
    if t < T_CAST or t >= T_DONE:
        return hang, "lure"
    if t < T_LAND:
        u = (t - T_CAST) / (T_LAND - T_CAST)
        start = rig(T_CAST, int(T_CAST * FPS))["tip"]
        end = P_LAND + Vector((0, 0, water_at(fi, 0.0)))
        p = start.lerp(end, u)
        p.z += 9.0 * 4 * u * (1 - u)
        return p, "lure"
    if t < T_BITE:
        p = P_LAND + Vector((0, 0, water_at(fi, 0.0) + 0.03))
        if abs(t - T_NIBBLE) < 0.3:
            p.z -= 0.08 * math.sin(math.pi * (t - T_NIBBLE + 0.3) / 0.6)
        return p, "float"
    if t < T_LEAP:
        u = smooth((t - T_BITE - 0.25) / (T_LEAP - T_BITE - 0.25))
        p = P_LAND.lerp(P_NEAR, u)
        p += Vector((0.0, 1.0, 0)) * (1.6 * math.sin(TAU * u * 2.0) * (1 - u))
        p.z = water_at(fi, u) - 0.25
        return p, "under"
    hang_f = R["tip"] - Vector((0, 0, 0.75))
    if t < T_HANG:
        u = smooth((t - T_LEAP) / (T_HANG - T_LEAP))
        p = P_NEAR.lerp(hang_f, u)
        p.z = (water_at(fi, 1.0)) * (1 - u) + hang_f.z * u + 1.6 * math.sin(math.pi * u)
        return p, "fish"
    if t < T_STOW:
        sw = 0.35 * math.sin(TAU * 0.9 * (t - T_HANG)) * math.exp(-(t - T_HANG) * 0.8)
        return hang_f + R["side"] * sw, "fish"
    u = smooth((t - T_STOW) / (T_DONE - T_STOW))
    deck = R["M"] @ (MAN_LOCAL + Vector((-0.6, 0.0, 0.3)))
    return hang_f.lerp(deck, u), "fish"


# drawn every frame
HIDE = Vector((0, -50, -50))
for fi in range(NFR):
    f = fi + 1
    t = fi / FPS
    R = rig(t, fi)
    # legs
    for s, key in ((-1, "L"), (1, "R")):
        foot = R["feet"] + R["side"] * (0.13 * s)
        hipj = R["hip"] + R["side"] * (0.1 * s)
        knee, _ = two_bone(hipj, foot, 0.46 * MS, 0.46 * MS, R["fwd"])
        place_seg(parts["thigh" + key], hipj, knee, f)
        place_seg(parts["shin" + key], knee, foot, f)
    place_seg(parts["torso"], R["hip"], R["sh"], f)
    place_seg(parts["neck"], R["sh"], R["head"], f)
    place(head, R["head"], f)
    hq = R["tdir"].to_track_quat("Z", "Y")
    place(hat, R["head"] + R["tdir"] * 0.09, f, hq)
    # arms reach the rod: right hand on the grip, left hand on the butt
    for key, hand_ob, target, s in (("R", handR, R["grip"], 1), ("L", handL, R["butt"] + R["rdir"] * 0.08, -1)):
        shp = R["sh"] - R["tdir"] * 0.06 + R["side"] * (0.2 * s)
        elbow, h = two_bone(shp, target, 0.31 * MS, 0.29 * MS, -R["tdir"] + R["side"] * (0.6 * s))
        place_seg(parts["uarm" + key], shp, elbow, f)
        place_seg(parts["farm" + key], elbow, h, f)
        place(hand_ob, h, f)
    end, state = line_target(t, fi, R)
    load = {"lure": 0.0, "float": 0.15, "under": 0.9, "fish": 0.6}[state]
    if T_CAST - 0.35 < t < T_CAST + 0.2:
        load = 0.55
    tipb = R["tip"].lerp(end, 0.13 * load)
    mid = (R["butt"] + R["tip"]) / 2
    ctrl = mid.lerp(end, 0.22 * load)
    set_curve(rod, bez(R["butt"], ctrl, tipb, 16), f)
    sag = {"lure": 0.0, "float": 1.2, "under": 0.15, "fish": 0.0}[state]
    if T_CAST <= t < T_LAND:
        sag = 0.6
    lmid = (tipb + end) / 2 - Vector((0, 0, sag))
    set_curve(line, bez(tipb, lmid, end, 32), f)
    place(floater, end if state in ("lure", "float") else HIDE, f)
    if state == "fish":
        wig = 0.6 * math.sin(TAU * 2.4 * t)
        if t < T_HANG:
            dirn = (R["tip"] - end).normalized() if (R["tip"] - end).length > 0.01 else Vector((0, 0, 1))
        else:
            dirn = Vector((0, 0, 1))
        q = (-dirn).to_track_quat("Z", "Y")
        q.rotate(Euler((0, 0, 0)))
        from mathutils import Quaternion
        q = q @ Quaternion((1, 0, 0), wig)
        place(fish, end - dirn * 0.25, f, q)
        fish.scale = (1, 1, 1) if t < T_DONE - 0.2 else (0.001, 0.001, 0.001)
    else:
        place(fish, HIDE, f, Euler((0, 0, 0)).to_quaternion())
        fish.scale = (0.001, 0.001, 0.001)
    fish.keyframe_insert("scale", frame=f)

# ---------------- splashes: droplets that catch the sun
SPLASHES = [(T_LAND, 0.0, 14, 0.8), (T_BITE, 0.0, 12, 0.7), (T_LEAP, 1.0, 34, 1.35)]
drops = []
rngd = np.random.default_rng(5)
for te, u_at, n, power in SPLASHES:
    for k in range(n):
        d = prim("ico_sphere", "Drop", M_DROP, radius=rngd.uniform(0.025, 0.055), subdivisions=1)
        v = Vector((rngd.uniform(-1.4, 1.4), rngd.uniform(-1.4, 1.4), rngd.uniform(2.5, 5.0))) * power
        drops.append((d, te, u_at, v))
for d, te, u_at, v in drops:
    base = P_LAND.lerp(P_NEAR, u_at)
    for fi in range(NFR):
        t = fi / FPS
        a = t - te
        f = fi + 1
        p = base + v * a + Vector((0, 0, -0.5 * 9.81 * a * a + water_at(fi, u_at)))
        alive = 0 <= a and p.z > water_at(fi, u_at) - 0.05
        d.location = p if alive else HIDE
        d.keyframe_insert("location", frame=f)

# fish drips while it hangs
for k in range(12):
    d = prim("ico_sphere", "Drip", M_DROP, radius=0.025, subdivisions=1)
    te = T_HANG + 0.1 * k
    for fi in range(NFR):
        t = fi / FPS
        a = (t - te) % 1.2
        if T_HANG <= t < T_STOW and t >= te:
            R = rig(t - a, max(0, int((t - a) * FPS)))
            src, _ = line_target(t - a, max(0, int((t - a) * FPS)), R)
            p = src + Vector((0, 0, -0.5 - 0.5 * 9.81 * a * a))
            d.location = p if p.z > water_at(fi, 1.0) else HIDE
        else:
            d.location = HIDE
        d.keyframe_insert("location", frame=fi + 1)

# ---------------- ripple rings
rings = []
RING_EVENTS = [(T_LAND, 0.0, 1.0), (T_NIBBLE, 0.0, 0.5), (T_BITE, 0.0, 1.0), (T_LEAP, 1.0, 1.4),
               (T_LAND + 1.4, 0.0, 0.4), (T_LAND + 2.8, 0.0, 0.4)]
M_RING = material("Ring", (0.9, 0.6, 0.3), rough=0.05)
for te, u_at, power in RING_EVENTS:
    for lag in (0.0, 0.35):
        r = prim("torus", "Ring", M_RING, major_radius=1.0, minor_radius=0.025, major_segments=48, minor_segments=6)
        for fi in range(NFR):
            a = fi / FPS - te - lag
            if 0 <= a < 2.5:
                rad = (0.2 + 2.6 * math.sqrt(a / 2.5)) * power
                th = max(0.001, (1 - a / 2.5) * 1.0)
                r.location = P_LAND.lerp(P_NEAR, u_at) + Vector((0, 0, water_at(fi, u_at) - 0.01))
                r.scale = (rad, rad, th)
            else:
                r.location = HIDE
                r.scale = (0.001, 0.001, 0.001)
            r.keyframe_insert("location", frame=fi + 1)
            r.keyframe_insert("scale", frame=fi + 1)

# ---------------- gulls
GULLS = [  # t0, t1, start, end, flap hz, span
    (0.5, 7.0, Vector((-30, 190, 26)), Vector((26, 140, 20)), 2.2, 1.5),
    (2.0, 9.5, Vector((40, 210, 34)), Vector((-30, 260, 38)), 1.9, 1.7),
    (11.5, 16.5, Vector((-16, 340, 10)), Vector((20, 268, 6)), 2.4, 1.6)]
for gi, (t0, t1, a, b, hz, span) in enumerate(GULLS):
    body = prim("uv_sphere", f"Gull{gi}", M_GULL, radius=1.0, segments=10, ring_count=6)
    body.scale = (0.26, 0.06, 0.06)
    wings = []
    for s in (-1, 1):
        w = mesh_object(f"Wing{gi}{s}", [(0, 0, 0), (0.0, s * span / 4, 0.06), (0.13, s * span / 2, 0),
                                         (-0.12, s * span / 4, 0.0), (0.16, 0, 0)],
                        [(0, 1, 2, 3), (0, 4, 1)], M_GULL)
        w.parent = body
        w.matrix_parent_inverse = body.matrix_world.inverted()
        wings.append((w, s))
    heading = math.atan2((b - a).y, (b - a).x)
    for fi in range(NFR):
        t = fi / FPS
        f = fi + 1
        u = (t - t0) / (t1 - t0)
        if 0 <= u <= 1:
            p = a.lerp(b, u)
            p.z += 0.8 * math.sin(TAU * u * 1.3 + gi)
            body.location = p
        else:
            body.location = HIDE
        body.rotation_euler = (0, 0, heading)
        body.keyframe_insert("location", frame=f)
        body.keyframe_insert("rotation_euler", frame=f)
        glide = 0.5 + 0.5 * math.sin(TAU * 0.22 * t + gi)
        flap = math.sin(TAU * hz * t + gi) * (1 - 0.75 * glide)
        for w, s in wings:
            w.rotation_euler = (s * (0.55 * flap + 0.12), 0, 0)
            w.keyframe_insert("rotation_euler", frame=f)

# ---------------- camera: wide like the photo, then a slow push-in on the boat; subtle hand-held sway
cam_ob.rotation_mode = "XYZ"
wide_pitch = math.radians(90 + 2.6) + math.atan(CAM_H / 9000)
aim_boat = (BOAT_C + Vector((3.6, 0, 1.2)))
boat_pitch = math.radians(90) - math.atan2(CAM_H - aim_boat.z, aim_boat.y) + math.radians(-0.15)
boat_yaw = -math.atan2(aim_boat.x, aim_boat.y)
for fi in range(NFR):
    t = fi / FPS
    f = fi + 1
    u = smooth((t - 3.0) / 6.0)
    cam.lens = 85 * (1 - u) + 300 * u
    cam.keyframe_insert("lens", frame=f)
    sc.view_settings.exposure = float(arg('--zoomexp', -0.6)) * u
    sc.view_settings.keyframe_insert("exposure", frame=f)
    sway_p = math.radians(0.006) * (math.sin(TAU * 0.31 * t) + 0.6 * math.sin(TAU * 0.73 * t + 1))
    sway_y = math.radians(0.006) * (math.sin(TAU * 0.23 * t + 2) + 0.5 * math.sin(TAU * 0.61 * t))
    cam_ob.rotation_euler = (wide_pitch * (1 - u) + boat_pitch * u + sway_p, 0, boat_yaw * u + sway_y)
    cam_ob.keyframe_insert("rotation_euler", frame=f)

# boat transform keys
for fi in range(NFR):
    M = boat_matrix(fi)
    boat.matrix_world = M
    boat.keyframe_insert("location", frame=fi + 1)
    boat.keyframe_insert("rotation_euler", frame=fi + 1)
print("actors ready")
