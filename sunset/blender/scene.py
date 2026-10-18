"""Golden-hour fisherman, built in Blender.

Run with the bpy venv:  python scene.py [--still FRAME OUT.png] [--res 0.5] [--samples N]
Without --still it saves sunset.blend for the frame renderer.
"""
import math
import sys

import bpy
import addon_utils
from mathutils import Vector, Euler

ARGS = sys.argv[1:]


def arg(name, default, cast=float):
    return cast(ARGS[ARGS.index(name) + 1]) if name in ARGS else default


FPS = 24
DUR = 20.0
NFR = int(FPS * DUR)

bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("cycles", default_set=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, NFR
sc.render.resolution_x, sc.render.resolution_y = 1080, 1920
sc.render.resolution_percentage = int(arg("--res", 1.0) * 100)
sc.cycles.samples = int(arg("--samples", 48))
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.02
sc.cycles.use_denoising = True
if "--threads" in ARGS:
    sc.render.threads_mode = "FIXED"
    sc.render.threads = int(arg("--threads", 4, int))
sc.render.use_persistent_data = True
sc.cycles.max_bounces = 4
sc.cycles.glossy_bounces = 2
sc.cycles.diffuse_bounces = 1
sc.cycles.transmission_bounces = 2
sc.cycles.transparent_max_bounces = 4
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.cycles.blur_glossy = 1.0
sc.cycles.sample_clamp_indirect = 8.0
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.view_settings.exposure = float(arg("--exposure", 0.0))

# sun direction: azimuth straight ahead (+Y), elevation chosen to sit high in the frame like the photo
SUN_EL = math.radians(10.5)
SUN_AZ = math.radians(0.6)
SUN_DIR = Vector((math.sin(SUN_AZ) * math.cos(SUN_EL), math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL)))  # direction TO the sun


def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def math_node(nt, op, a=None, b=None, loc=(0, 0), clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    n.location = loc
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


# ------------------------------------------------------------------ world: hazy golden sky + sun
world = bpy.data.worlds.new("Sky")
sc.world = world
world.use_nodes = True
wn = world.node_tree
wn.nodes.clear()
tc = node(wn, "ShaderNodeTexCoord")
dirv = tc.outputs["Generated"]
sep = node(wn, "ShaderNodeSeparateXYZ")
link(wn, dirv, sep.inputs[0])
elev = sep.outputs["Z"]
REFL_GLOW = float(arg('--reflglow', 0.3))
# sky colours measured from the photo (linear): near-uniform amber, darker near the top
ramp = node(wn, "ShaderNodeValToRGB")
link(wn, math_node(wn, "MAXIMUM", elev, 0.0), ramp.inputs[0])
cr = ramp.color_ramp
cr.elements[0].position = 0.0
cr.elements[0].color = (0.54, 0.235, 0.040, 1)
cr.elements[1].position = 0.27
cr.elements[1].color = (0.36, 0.075, 0.013, 1)
e = cr.elements.new(0.09)
e.color = (0.585, 0.222, 0.028, 1)
e = cr.elements.new(0.2)
e.color = (0.5, 0.15, 0.02, 1)
sky_rgb = ramp.outputs["Color"]


def gauss_dot(cosang, sigma_deg):
    """dot^n approximates exp(-theta^2 / (2 sigma^2)) for small angles."""
    n = 1.0 / math.radians(sigma_deg) ** 2
    return math_node(wn, "POWER", cosang, n)


def rgb_scale(col_socket_or_val, rgb, gain):
    """Return a colour socket = value * rgb * gain."""
    cmb = node(wn, "ShaderNodeCombineXYZ")
    for i, c in enumerate(rgb):
        link(wn, math_node(wn, "MULTIPLY", col_socket_or_val, c * gain), cmb.inputs[i])
    return cmb.outputs[0]


def add_rgb(a, b):
    n = node(wn, "ShaderNodeVectorMath")
    n.operation = "ADD"
    link(wn, a, n.inputs[0])
    link(wn, b, n.inputs[1])
    return n.outputs[0]


dotn = node(wn, "ShaderNodeVectorMath")
dotn.operation = "DOT_PRODUCT"
link(wn, dirv, dotn.inputs[0])
dotn.inputs[1].default_value = SUN_DIR
cosang = math_node(wn, "MAXIMUM", dotn.outputs["Value"], 0.0)
# soft-edged disk (radius ~1.25 deg like the hazy photo sun) and nested glows
theta = math_node(wn, "ARCCOSINE", math_node(wn, "MINIMUM", cosang, 1.0))
disk = math_node(wn, "SUBTRACT", 1.0, math_node(wn, "DIVIDE",
                 math_node(wn, "SUBTRACT", theta, math.radians(1.05)), math.radians(0.35)), clamp=True)
# the camera sees the full glow; reflections in the water see a dimmer one, so the sun's own disk
# makes the glitter instead of a broad mirror of the halo
lp = node(wn, "ShaderNodeLightPath")
glow_k = math_node(wn, "ADD", math_node(wn, "MULTIPLY", lp.outputs["Is Camera Ray"], 1.0 - REFL_GLOW), REFL_GLOW)
g1 = math_node(wn, "MULTIPLY", gauss_dot(cosang, 1.9), glow_k)
g2 = math_node(wn, "MULTIPLY", gauss_dot(cosang, 4.2), glow_k)
col = add_rgb(sky_rgb, rgb_scale(g1, (1.0, 0.86, 0.45), 1.6))
col = add_rgb(col, rgb_scale(g2, (1.0, 0.62, 0.16), 0.55))
col = add_rgb(col, rgb_scale(gauss_dot(cosang, 10.0), (1.0, 0.5, 0.1), 0.18))
col = add_rgb(col, rgb_scale(disk, (1.0, 0.97, 0.9), 6.0))
bg = node(wn, "ShaderNodeBackground", Strength=1.0)
link(wn, col, bg.inputs["Color"])
wout = node(wn, "ShaderNodeOutputWorld")
link(wn, bg.outputs[0], wout.inputs[0])
world.cycles.sampling_method = "MANUAL"
world.cycles.sample_map_resolution = 1024

# sun lamp for the glitter path on the waves
sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = float(arg('--sun', 3.4))
sun.color = (1.0, 0.84, 0.58)
sun.angle = math.radians(1.3)
sun_ob = bpy.data.objects.new("Sun", sun)
sc.collection.objects.link(sun_ob)
sun_ob.rotation_euler = (-SUN_DIR).to_track_quat("-Z", "Y").to_euler()

# ------------------------------------------------------------------ haze helper for materials
HAZE = (0.56, 0.235, 0.04)


def add_haze(nt, shader_out, out_node, dist_scale):
    cam = node(nt, "ShaderNodeCameraData")
    f = math_node(nt, "DIVIDE", cam.outputs["View Distance"], dist_scale)
    f = math_node(nt, "MULTIPLY", f, -1.0)
    f = math_node(nt, "EXPONENT", f)
    f = math_node(nt, "SUBTRACT", 1.0, f)
    em = node(nt, "ShaderNodeEmission", Strength=1.0)
    em.inputs["Color"].default_value = (*HAZE, 1)
    mix = node(nt, "ShaderNodeMixShader")
    link(nt, f, mix.inputs[0])
    link(nt, shader_out, mix.inputs[1])
    link(nt, em.outputs[0], mix.inputs[2])
    link(nt, mix.outputs[0], out_node.inputs["Surface"])


# ------------------------------------------------------------------ ocean
water = bpy.data.materials.new("Water")
water.use_nodes = True
nt = water.node_tree
nt.nodes.clear()
bsdf = node(nt, "ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.012, 0.007, 0.004, 1)
bsdf.inputs["Roughness"].default_value = float(arg('--rough', 0.045))
bsdf.inputs["IOR"].default_value = 1.333
bsdf.inputs["Specular Tint"].default_value = (1.0, 0.55, 0.42, 1)
# fine capillary ripples on top of the simulated waves
tcw = node(nt, "ShaderNodeTexCoord")
noise = node(nt, "ShaderNodeTexNoise", Scale=float(arg("--nscale", 9.0)), Detail=10.0, Roughness=0.62, Distortion=0.5)
noise.noise_dimensions = "4D"
link(nt, tcw.outputs["Object"], noise.inputs["Vector"])
drv = noise.inputs["W"].driver_add("default_value").driver
drv.expression = "frame/48"
bump = node(nt, "ShaderNodeBump", Strength=1.0, Distance=float(arg("--bump", 0.12)))
link(nt, noise.outputs["Fac"], bump.inputs["Height"])
link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
wout2 = node(nt, "ShaderNodeOutputMaterial")
add_haze(nt, bsdf.outputs[0], wout2, 2600.0)

import numpy as np


OCEAN_ROT = math.radians(23.0)


def wedge_mesh(name, rows, cols, r0, r1, half):
    """A fan of vertices in front of the camera: rows spaced geometrically with distance,
    so every row covers roughly the same number of pixels."""
    r = r0 * (r1 / r0) ** (np.arange(rows) / (rows - 1))
    a = np.linspace(-half, half, cols)
    R, A = np.meshgrid(r, a, indexing="ij")
    A = A + OCEAN_ROT  # mesh is built rotated back so the object's rotation lines it up with the view
    co = np.stack([R * np.sin(A), R * np.cos(A), np.zeros_like(R)], -1).reshape(-1, 3)
    i = np.arange(rows - 1)[:, None] * cols + np.arange(cols - 1)[None, :]
    quads = np.stack([i, i + 1, i + cols + 1, i + cols], -1).reshape(-1, 4)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.astype(np.int32).ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
    me.update(calc_edges=True)
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


OCEAN_R1 = 7000
ocean = wedge_mesh("Ocean", int(arg("--rows", 3000, int)), int(arg("--cols", 640, int)), 28.0, OCEAN_R1,
                   math.radians(8.5))
ocean.rotation_euler = (0, 0, OCEAN_ROT)
om = ocean.modifiers.new("Ocean", "OCEAN")
om.geometry_mode = "DISPLACE"
om.spatial_size = int(arg('--spatial', 50, int))
om.resolution = int(arg('--ores', 20, int))
om.viewport_resolution = 4
om.frame_start, om.frame_end = 1, NFR
om.wave_scale = float(arg('--wave', 0.5))
om.choppiness = 1.35
om.wind_velocity = float(arg('--wind', 5.5))
om.wave_alignment = 0.55
om.wave_direction = math.radians(-90)  # rolling toward the camera
om.spectrum = "JONSWAP"
om.random_seed = 7
om.use_normals = True
om.depth = 200
fc = om.driver_add("time").driver
fc.expression = "frame/24"
ocean.data.materials.append(water)

# far sea to the horizon (flat, bump only, mostly haze)
bpy.ops.mesh.primitive_plane_add(size=1)
far = bpy.context.object
far.name = "FarSea"
far.scale = (40000, 40000, 1)
far.location = (0, 20000 + OCEAN_R1 - 30, -0.05)
far.data.materials.append(water)

# ------------------------------------------------------------------ camera
cam = bpy.data.cameras.new("Cam")
cam.sensor_fit = "VERTICAL"
cam.sensor_height = 36
cam.lens = 85
cam.clip_start = 1.0
cam.clip_end = 100000
cam_ob = bpy.data.objects.new("Cam", cam)
sc.collection.objects.link(cam_ob)
sc.camera = cam_ob
CAM_H = float(arg('--camh', 6.0))
cam_ob.location = (0, 0, CAM_H)
cam_ob.rotation_euler = Euler((math.radians(90 + 2.6) + math.atan(CAM_H / 9000), 0, 0))

exec(open(__file__.replace("scene.py", "actors.py")).read())

if "--border" in ARGS:
    i = ARGS.index("--border")
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = map(float, ARGS[i + 1:i + 5])

if "--anim" in ARGS:
    import os, time
    i = ARGS.index("--anim")
    sc.frame_start, sc.frame_end = int(ARGS[i + 1]), int(ARGS[i + 2])
    sc.frame_step = int(arg("--step", 1, int))
    sc.render.filepath = os.path.abspath(ARGS[i + 3])
    sc.render.image_settings.file_format = "PNG"
    sc.render.use_overwrite = False
    sc.render.use_placeholder = True
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    n = (sc.frame_end - sc.frame_start) // sc.frame_step + 1
    print(f"rendered {n} frames in {time.time() - t0:.1f}s ({(time.time() - t0) / n:.1f}s/frame)")
    sys.exit(0)

if "--still" in ARGS:
    frame = int(arg("--still", 1, int))
    import os
    out = os.path.abspath(ARGS[ARGS.index("--still") + 2])
    sc.frame_set(frame)
    sc.render.filepath = out
    import time
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"rendered frame {frame} in {time.time() - t0:.1f}s -> {out}")
else:
    bpy.ops.wm.save_as_mainfile(filepath="sunset.blend")
