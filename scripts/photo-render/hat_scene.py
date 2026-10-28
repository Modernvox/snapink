"""Render-only adjustable SnapInk hat prototype around the hash-pinned CAD sleeve.

This is additive to the existing sleeve renderer. It does not run from the
private queue until the owner approves the assembled-hat prototype and the
strap measurements are calibrated. Hat proportions and strap detail are
reference-derived visual parameters, not manufacturing dimensions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


MM = 0.001
HAT_PARAMETERS_MM = {
    "crownHalfWidth": 95.0,
    "crownHalfDepth": 91.0,
    "crownHeight": 105.0,
    "crownBaseZ": 10.0,
    "rearOpeningHalfWidth": 65.0,
    "rearOpeningArchRise": 35.0,
    # Render-only refinement from the supplied installed-hat references. These
    # are not measured snapback dimensions or a physical-fit specification.
    "strapWidth": 16.5,
    "strapThickness": 0.8,
    "strapLength": 155.0,
    "snapPegDiameter": 2.4,
    "snapPegHeight": 3.0,
    "snapPegPitch": 8.69,
    "strapThicknessStatus": "visual proxy estimate; physical measurement required",
    "strapWidthStatus": "reference-proportioned render proxy only; not a measured strap or fit specification",
    "crownDimensionsStatus": "proportions estimated from supplied rear-view images; not measured",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.cameras, bpy.data.lights,
                       bpy.data.meshes, bpy.data.curves, bpy.data.cameras):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def fabric_material(name, base=(0.012, 0.014, 0.017, 1), mesh=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = base
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = 0.90 if mesh else 0.86
    bsdf.inputs["Sheen Weight"].default_value = 0.08 if not mesh else 0.025
    bsdf.inputs["Sheen Roughness"].default_value = 0.72
    tex = nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 380
    tex.inputs["Detail"].default_value = 2
    tex.inputs["Roughness"].default_value = 0.72
    wave_x = nodes.new("ShaderNodeTexWave")
    wave_x.wave_type = "BANDS"
    wave_x.bands_direction = "X"
    wave_x.inputs["Scale"].default_value = 270
    wave_y = nodes.new("ShaderNodeTexWave")
    wave_y.wave_type = "BANDS"
    wave_y.bands_direction = "Y"
    wave_y.inputs["Scale"].default_value = 270
    add = nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY"
    add.inputs[1].default_value = 0.0
    links.new(wave_x.outputs["Color"], add.inputs[0])
    links.new(wave_y.outputs["Color"], add.inputs[1])
    if mesh:
        # Irregular Voronoi openings break up the smooth rear mesh without
        # producing long repeated bands across the curved crown.
        mat.surface_render_method = "DITHERED"
        coords = nodes.new("ShaderNodeTexCoord")
        cells = nodes.new("ShaderNodeTexVoronoi")
        cells.feature = "F1"
        cells.inputs["Scale"].default_value = 48
        cells.inputs["Randomness"].default_value = 0.34
        threads = nodes.new("ShaderNodeMath")
        threads.operation = "GREATER_THAN"
        threads.inputs[1].default_value = 0.20
        links.new(coords.outputs["Generated"], cells.inputs["Vector"])
        links.new(cells.outputs["Distance"], threads.inputs[0])
        links.new(threads.outputs[0], bsdf.inputs["Alpha"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12 if mesh else 0.09
    bump.inputs["Distance"].default_value = 0.000035 if mesh else 0.00004
    links.new(tex.outputs["Fac"], bump.inputs["Height"])
    if mesh:
        # Fine cross-weave contrast and bump read as black mesh fabric in a
        # photographic close-up without substituting a flat cap image.
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.015
        ramp.color_ramp.elements[0].color = (0.00045, 0.0005, 0.00058, 1)
        ramp.color_ramp.elements[1].position = 0.22
        # Keep grazing faces black; a much brighter upper ramp previously
        # made one side of the curved mesh crown read as a gray structural band.
        ramp.color_ramp.elements[1].color = (0.0018, 0.0019, 0.0021, 1)
        links.new(cells.outputs["Distance"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(cells.outputs["Distance"], bump.inputs["Height"])
    else:
        links.new(tex.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def curve_lines(name, paths, material, radius_m, resolution=2):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = radius_m
    data.bevel_resolution = resolution
    for pts in paths:
        if len(pts) < 2:
            continue
        spline = data.splines.new("POLY")
        spline.points.add(len(pts) - 1)
        for p, co in zip(spline.points, pts):
            p.co = (*co, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def crown_point(theta, phi):
    p = HAT_PARAMETERS_MM
    rx, ry = p["crownHalfWidth"] * MM, p["crownHalfDepth"] * MM
    base, rise = p["crownBaseZ"] * MM, p["crownHeight"] * MM
    st = math.sin(theta)
    x = rx * st * math.cos(phi)
    y = ry * st * math.sin(phi)
    z = base + rise * math.cos(theta)
    # The supplied cap references have a relatively flat rear mesh panel.
    # Flatten only the lower rear region so the rigid, unmodified sleeve CAD
    # can sit on a planar adjustment strap without being bent.
    rear_weight = max(0.0, min(1.0, (-math.sin(phi)) / 0.10))
    x_weight = max(0.0, min(1.0, (0.100 * MM - abs(x)) / (0.005 * MM)))
    z_weight = max(0.0, min(1.0, (0.082 * MM - z) / (0.035 * MM)))
    y = (1.0 - rear_weight * x_weight * z_weight) * y + (rear_weight * x_weight * z_weight) * (-ry * st)
    return (x, y, z)


def crown_surface_normal(pt):
    rx = HAT_PARAMETERS_MM["crownHalfWidth"] * MM
    ry = HAT_PARAMETERS_MM["crownHalfDepth"] * MM
    rise = HAT_PARAMETERS_MM["crownHeight"] * MM
    z0 = HAT_PARAMETERS_MM["crownBaseZ"] * MM
    n = Vector((pt[0] / (rx * rx), pt[1] / (ry * ry), (pt[2] - z0) / (rise * rise)))
    return n.normalized() if n.length else Vector((0, -1, 0))


def arch_height(x):
    p = HAT_PARAMETERS_MM
    a = p["rearOpeningHalfWidth"] * MM
    if abs(x) >= a:
        return p["crownBaseZ"] * MM
    return p["crownBaseZ"] * MM + p["rearOpeningArchRise"] * MM * math.sqrt(max(0, 1 - (x / a) ** 2))


def rear_opening_contains(pt):
    x, y, z = pt
    return y < -0.038 and abs(x) < HAT_PARAMETERS_MM["rearOpeningHalfWidth"] * MM and z < arch_height(x)


def make_crown(mesh_mat, fabric_mat, seam_mat, stitch_mat):
    n_theta, n_phi = 90, 300
    vertices = []
    for i in range(n_theta + 1):
        theta = 0.035 + (math.pi / 2 - 0.035) * i / n_theta
        for j in range(n_phi + 1):
            phi = -math.pi + 2 * math.pi * j / n_phi
            vertices.append(crown_point(theta, phi))
    faces = []
    stride = n_phi + 1
    for i in range(n_theta):
        for j in range(n_phi):
            a = i * stride + j
            quad = (a, a + 1, a + stride + 1, a + stride)
            center = tuple(sum(vertices[k][axis] for k in quad) / 4 for axis in range(3))
            if not rear_opening_contains(center):
                faces.append(quad)
    mesh = bpy.data.meshes.new("SnapInk reference-fit six-panel crown shell")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    crown = bpy.data.objects.new("SnapInk adjustable hat · rear mesh crown", mesh)
    bpy.context.collection.objects.link(crown)
    crown.data.materials.append(mesh_mat)
    crown.data.materials.append(fabric_mat)
    for poly in crown.data.polygons:
        poly.use_smooth = True
        # A trucker-style snapback uses open mesh on the rear half and
        # structured fabric on its front crown panels.
        # Carry black mesh onto the visible side panels; keep front-center
        # panels in structured twill. This avoids a broad pale side band in 3/4.
        poly.material_index = 0 if poly.center.y < 0.030 else 1
    solidify = crown.modifiers.new("Render-only fabric backing thickness", "SOLIDIFY")
    solidify.thickness = 0.0011
    solidify.offset = -0.5
    crown["dimension_status"] = "reference-derived visual proxy; not a measured SnapInk hat master"

    seam_paths = []
    stitch_paths = []
    phi_values = [0, math.pi / 3, 2 * math.pi / 3, math.pi,
                  4 * math.pi / 3, 5 * math.pi / 3]
    for phi in phi_values:
        path = []
        for k in range(260):
            theta = 0.055 + (math.pi / 2 - 0.065) * k / 259
            pt = crown_point(theta, phi)
            if rear_opening_contains(pt):
                if len(path) > 1:
                    seam_paths.append(path)
                path = []
                continue
            normal = crown_surface_normal(pt)
            on_surface = Vector(pt) + normal * 0.00012
            path.append(tuple(on_surface))
            if k % 15 == 0 and not rear_opening_contains(pt):
                stitch_paths.append([
                    tuple(on_surface),
                    tuple(on_surface + normal * 0.00018 + Vector((0.00028, 0, -0.00016)))
                ])
        if len(path) > 1:
            seam_paths.append(path)
    curve_lines("Crown panel stitching seams", seam_paths, seam_mat, 0.00016, 1)
    curve_lines("Crown seam stitch marks", stitch_paths, stitch_mat, 0.00007, 1)

    # Visible arched rear-opening binding, generated on the crown surface.
    arch = []
    a = HAT_PARAMETERS_MM["rearOpeningHalfWidth"] * MM
    rx, ry = HAT_PARAMETERS_MM["crownHalfWidth"] * MM, HAT_PARAMETERS_MM["crownHalfDepth"] * MM
    for k in range(321):
        x = -a + 2 * a * k / 320
        z = arch_height(x)
        sin_theta = math.sqrt(max(1e-6, 1 - ((z - HAT_PARAMETERS_MM["crownBaseZ"] * MM) / (HAT_PARAMETERS_MM["crownHeight"] * MM)) ** 2))
        cos_phi = max(-1.0, min(1.0, x / (rx * sin_theta)))
        # Solve the rear half of the ellipsoid at this exact x/z. The prior
        # path assumed x=0 for every point, pulling the binding off the shell.
        sin_phi = -math.sqrt(max(0.0, 1.0 - cos_phi * cos_phi))
        y = ry * sin_theta * sin_phi - 0.00012
        arch.append((x, y, z))
    curve_lines("Rear opening bound edge", [arch], seam_mat, 0.00034, 2)
    return crown


def make_brim(twill_mat, stitch_mat):
    nx, nt = 100, 42
    half = HAT_PARAMETERS_MM["crownHalfWidth"] * MM
    verts = []
    for j in range(nt + 1):
        t = j / nt
        for i in range(nx + 1):
            u = -1 + 2 * i / nx
            x = half * u
            depth = math.sqrt(max(0.0, 1 - u * u))
            y0 = 0.030
            y = y0 + 0.100 * depth * t
            z = 0.010 - 0.008 * t * t + 0.005 * u * u
            verts.append((x, y, z))
    faces = []
    stride = nx + 1
    for j in range(nt):
        for i in range(nx):
            a = j * stride + i
            faces.append((a, a + stride, a + stride + 1, a + 1))
    mesh = bpy.data.meshes.new("Reference-derived curved brim mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    brim = bpy.data.objects.new("SnapInk adjustable hat · curved brim", mesh)
    bpy.context.collection.objects.link(brim)
    brim.data.materials.append(twill_mat)
    for poly in brim.data.polygons:
        poly.use_smooth = True
    solidify = brim.modifiers.new("Brim core thickness", "SOLIDIFY")
    solidify.thickness = 0.003
    solidify.offset = -0.5
    bevel = brim.modifiers.new("Brim soft edge", "BEVEL")
    bevel.width = 0.0012
    bevel.segments = 3
    stitch_paths = []
    for row in (0.72, 0.82, 0.91):
        pts = []
        for i in range(nx + 1):
            u = -1 + 2 * i / nx
            x = half * u
            y = 0.030 + 0.100 * math.sqrt(max(0, 1 - u * u)) * row
            z = 0.010 - 0.008 * row * row + 0.005 * u * u + 0.00025
            pts.append((x, y, z))
        stitch_paths.append(pts)
    curve_lines("Brim stitch rows", stitch_paths, stitch_mat, 0.00016, 1)
    return brim


def rear_surface_y_mm(abs_x_mm: float, z_mm: float) -> float:
    rx = HAT_PARAMETERS_MM["crownHalfWidth"]
    ry = HAT_PARAMETERS_MM["crownHalfDepth"]
    base = HAT_PARAMETERS_MM["crownBaseZ"]
    rise = HAT_PARAMETERS_MM["crownHeight"]
    ctheta = max(-0.999, min(0.999, (z_mm - base) / rise))
    stheta = math.sqrt(max(1e-6, 1.0 - ctheta * ctheta))
    cphi = max(-0.999, min(0.999, abs_x_mm / (rx * stheta)))
    sphi = -math.sqrt(max(1e-6, 1.0 - cphi * cphi))
    return ry * stheta * sphi


def strap_z_center_mm(abs_x_mm: float, z_center_mm: float) -> float:
    outer = max(0.0, min(1.0, (abs_x_mm - 59.5) / 34.5))
    outer = outer * outer * (3 - 2 * outer)
    return z_center_mm - 8.5 * outer


def rear_band_y(abs_x_mm: float, z_center_mm: float, layer_mm: float = 0.0,
                z_surface_mm: float | None = None) -> float:
    """Reference-derived rear strap path; dimensions are visual estimates only."""
    # Keep the part passing through the rigid sleeve nearly flat. Beyond its
    # ends, turn the band toward the lower sides of the cap. This is a visual
    # construction proxy, not a measured cap/strap fit.
    x0, x1 = 59.5, 65.0
    t = max(0.0, min(1.0, (abs_x_mm - x0) / (x1 - x0)))
    t = t * t * (3.0 - 2.0 * t)
    y0_mm = -91.5
    z_surface_mm = z_center_mm if z_surface_mm is None else z_surface_mm
    # Outside the opening, the adjustable band passes beneath the shell and
    # is covered by the rear mesh/panel, rather than riding over the cap.
    edge_y_mm = rear_surface_y_mm(x1, z_surface_mm) + 1.05
    if abs_x_mm <= x1:
        y_mm = y0_mm + (edge_y_mm - y0_mm) * t
    else:
        y_mm = rear_surface_y_mm(abs_x_mm, z_surface_mm) + 1.05
    return (y_mm + layer_mm) * MM


def make_curved_strap(name, x0_mm, x1_mm, direction, z_center_mm, y_layer_mm, material):
    """Create a swept, subtly curved band instead of a full-width box bar."""
    steps, across = 80, 8
    verts, faces = [], []
    for ix in range(steps + 1):
        t = ix / steps
        x_mm = x0_mm + (x1_mm - x0_mm) * t
        zc_mm = strap_z_center_mm(abs(x_mm), z_center_mm)
        zc = zc_mm * MM
        # Render-only necked insertion transition: the strap narrows as it
        # enters the sleeve channel, then returns to its reference-proportioned
        # width beyond the sleeve edge. This is not a measured strap profile.
        ax = abs(x_mm)
        entry_t = max(0.0, min(1.0, (ax - 47.0) / (59.5 - 47.0)))
        entry_t = entry_t * entry_t * (3.0 - 2.0 * entry_t)
        exit_t = max(0.0, min(1.0, (ax - 59.5) / (65.0 - 59.5)))
        exit_t = exit_t * exit_t * (3.0 - 2.0 * exit_t)
        width_mm = HAT_PARAMETERS_MM["strapWidth"] * (1.0 - 0.24 * entry_t * (1.0 - exit_t))
        for iz in range(across + 1):
            z = zc + (iz / across - 0.5) * width_mm * MM
            y = rear_band_y(abs(x_mm), z_center_mm, y_layer_mm, z / MM)
            verts.append((x_mm * MM, y, z))
    for ix in range(steps):
        for iz in range(across):
            a = ix * (across + 1) + iz
            faces.append((a, a + across + 1, a + across + 2, a + 1))
    mesh = bpy.data.meshes.new(name + " swept mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    solidify = obj.modifiers.new("Estimated strap stock thickness · uncalibrated", "SOLIDIFY")
    solidify.thickness = HAT_PARAMETERS_MM["strapThickness"] * MM
    solidify.offset = 0.0
    bevel = obj.modifiers.new("Soft molded strap edges", "BEVEL")
    bevel.width = 0.00025
    bevel.segments = 3
    obj["physical_dimensions_status"] = "visual path estimate; strap thickness and fit are not measured"
    obj["path_status"] = "curved to rear opening from supplied photographs; physical fit not verified"
    return obj


def make_hat(size, sleeve_length_mm, strap_material, post_material, mesh_mat, twill_mat, seam_mat, stitch_mat):
    crown = make_crown(mesh_mat, twill_mat, seam_mat, stitch_mat)
    brim = make_brim(twill_mat, stitch_mat)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16,
        radius=0.0055, location=(0, 0, (HAT_PARAMETERS_MM["crownBaseZ"] + HAT_PARAMETERS_MM["crownHeight"]) * MM))
    button = bpy.context.object
    button.name = "Crown top button"
    button.scale.z = 0.65
    button.data.materials.append(twill_mat)
    for face in button.data.polygons:
        face.use_smooth = True

    # Two separate strap tongues follow a rearward-curving path from the
    # opening to the side panels. They meet with a thin lap behind the rigid
    # sleeve; neither is a full-width floating rectangular bar.
    female = make_curved_strap(
        "Female snapback strap · curved left tongue", -94.0, 0.004,
        -1, 28.0, -0.2, strap_material)
    male = make_curved_strap(
        "Male snapback strap · curved right tongue", -0.004, 94.0,
        1, 28.0, -0.1, strap_material)
    female["selected_photo_size"] = int(size)
    female["exposed_peg_count"] = int(size)
    male["selected_photo_size"] = int(size)
    male["exposed_peg_count"] = int(size)
    male["positioning_status"] = "peg count follows Studio convention; strap engagement needs physical calibration"

    # Four visible peg heads use the known 8.69 mm CAD pitch and sit directly
    # on the curved male band. Peg diameter/height remain visual estimates.
    peg_d = HAT_PARAMETERS_MM["snapPegDiameter"] * MM
    peg_h = HAT_PARAMETERS_MM["snapPegHeight"] * MM
    peg_objects = []
    sleeve_right_mm = sleeve_length_mm / 2
    for i in range(int(size)):
        x_mm = sleeve_right_mm + 0.0025 / MM + i * HAT_PARAMETERS_MM["snapPegPitch"]
        z_mm = strap_z_center_mm(abs(x_mm), 28.0)
        y = rear_band_y(abs(x_mm), 28.0, -0.1, z_mm)
        z = z_mm * MM
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=peg_d / 2, depth=peg_h,
                                            location=(x_mm * MM, y, z))
        peg = bpy.context.object
        peg.name = f"Exposed male snap peg {i+1} · curved-band proxy"
        x0, x1 = max(59.5, abs(x_mm) - 0.2), min(94.0, abs(x_mm) + 0.2)
        if x1 <= x0:
            x0, x1 = abs(x_mm) - 0.2, abs(x_mm) + 0.2
        y0 = rear_band_y(x0, 28.0, -0.1, strap_z_center_mm(x0, 28.0)) / MM
        y1 = rear_band_y(x1, 28.0, -0.1, strap_z_center_mm(x1, 28.0)) / MM
        z0 = strap_z_center_mm(x0, 28.0)
        z1 = strap_z_center_mm(x1, 28.0)
        outward = Vector(((y1 - y0) / (x1 - x0), -1.0, (z1 - z0) / (x1 - x0))).normalized()
        peg.location += outward * (peg_h * 0.40)
        peg.rotation_mode = "QUATERNION"
        peg.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(outward)
        peg.data.materials.append(post_material)
        bevel = peg.modifiers.new("Snap peg edge radius", "BEVEL")
        bevel.width = min(0.00025, peg_d * 0.10)
        bevel.segments = 3
        for face in peg.data.polygons:
            face.use_smooth = True
        peg["dimensions_status"] = "visual proxy; physical dimensions not measured"
        peg_objects.append(peg)

    return crown, brim, female, male, peg_objects


def make_floor_and_lights(scene, target, radius):
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, -0.001))
    floor = bpy.context.object
    floor.name = "Cinematic dark studio floor"
    mat = bpy.data.materials.new("Dark neutral studio sweep")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.012, 0.014, 0.017, 1)
    bsdf.inputs["Roughness"].default_value = 0.31
    bsdf.inputs["Metallic"].default_value = 0.08
    floor.data.materials.append(mat)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.014, 0.019, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.035
    # Broad, controlled softboxes lift the crown and sleeve edges from the dark
    # sweep. Keep the textile base colors near-black; avoid a global exposure lift.
    defs = [
        ("Large neutral key softbox", (-0.28, -0.34, 0.30), (0, 0, 0.06), 1.65, 0.46, (0.90, 0.94, 1.0)),
        ("Warm rear rim softbox", (0.20, 0.08, 0.23), (0, 0, 0.07), 0.32, 0.32, (1.0, 0.76, 0.55)),
        ("Cool front fill softbox", (0.30, -0.26, 0.15), (0, 0, 0.045), 0.78, 0.38, (0.82, 0.88, 1.0)),
        ("Overhead mesh softbox", (-0.02, -0.03, 0.36), (0, 0, 0.055), 0.92, 0.44, (0.88, 0.93, 1.0)),
        ("Right edge softbox", (0.24, -0.02, 0.12), (0.015, -0.04, 0.055), 0.46, 0.30, (0.78, 0.86, 1.0)),
    ]
    for name, location, aim, power, size, color in defs:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        point_at(obj, aim)


def make_camera(name, location, target, lens=70):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = 36
    data.dof.use_dof = False
    cam = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(cam)
    cam.location = location
    point_at(cam, target)
    return cam


def configure_fast(scene, output):
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 72
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 0.015
    scene.eevee.gtao_quality = 1.0
    scene.eevee.use_shadows = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1067
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 95
    scene.render.film_transparent = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.2
    scene.render.filepath = str(output)


def args_parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--cad-root", type=Path, required=True)
    p.add_argument("--asset-catalog", type=Path, required=True)
    p.add_argument("--artwork", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--variant", choices=("standard", "billboard"), default="billboard")
    p.add_argument("--size", type=int, default=4)
    p.add_argument("--artwork-width-mm", type=float, default=93.859)
    p.add_argument("--artwork-height-mm", type=float, default=22.299)
    p.add_argument("--artwork-center-x-mm", type=float, default=51.54)
    p.add_argument("--artwork-center-y-mm", type=float, default=0.0)
    p.add_argument("--artwork-color", default="#ffffff")
    p.add_argument("--inspect-only", action="store_true",
                   help="Build and inspect the scene without rendering product images.")
    return p.parse_args(argv)


def object_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return [[round(min(v[i] for v in corners) * 1000, 3),
             round(max(v[i] for v in corners) * 1000, 3)] for i in range(3)]


def pair_geometry_check(a, b, depsgraph):
    try:
        ea, eb = a.evaluated_get(depsgraph), b.evaluated_get(depsgraph)
        ma, mb = ea.to_mesh(), eb.to_mesh()
        va = [ea.matrix_world @ vertex.co for vertex in ma.vertices]
        vb = [eb.matrix_world @ vertex.co for vertex in mb.vertices]
        fa = [tuple(poly.vertices) for poly in ma.polygons]
        fb = [tuple(poly.vertices) for poly in mb.polygons]
        ta = BVHTree.FromPolygons(va, fa, epsilon=0.00005)
        tb = BVHTree.FromPolygons(vb, fb, epsilon=0.00005)
        overlaps = ta.overlap(tb)
        def min_distance(tree, vertices):
            distances = []
            for vertex in vertices:
                result = tree.find_nearest(vertex)
                if result:
                    distances.append(result[3])
            return min(distances, default=None)
        near_a_to_b = min_distance(tb, va)
        near_b_to_a = min_distance(ta, vb)
        overlap_samples = []
        for ia, ib in overlaps[:12]:
            ca = sum((va[index] for index in fa[ia]), Vector()) / len(fa[ia])
            cb = sum((vb[index] for index in fb[ib]), Vector()) / len(fb[ib])
            overlap_samples.append([round(v * 1000, 3) for v in (ca + cb) * 0.5])
        ea.to_mesh_clear()
        eb.to_mesh_clear()
        return {
            "triangleOverlapCount": len(overlaps),
            "sampleOverlapLocationsMm": overlap_samples,
            "minimumVertexToSurfaceMm": round(min(near_a_to_b, near_b_to_a) * 1000, 3)
                if near_a_to_b is not None and near_b_to_a is not None else None,
        }
    except Exception as exc:
        return {"inspectionError": str(exc)}


def inspect_built_scene(sleeve, artwork_obj, crown, female, male, pegs):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    inventory = []
    for obj in bpy.context.scene.objects:
        if obj.type not in {"MESH", "CURVE"}:
            continue
        inventory.append({
            "name": obj.name,
            "type": obj.type,
            "boundsMm": object_bounds(obj),
            "parent": obj.parent.name if obj.parent else None,
        })
    checks = {
        "sleeveVsCrown": pair_geometry_check(sleeve, crown, depsgraph),
        "femaleTongueVsSleeveChannel": pair_geometry_check(female, sleeve, depsgraph),
        "maleTongueVsSleeveChannel": pair_geometry_check(male, sleeve, depsgraph),
        "femaleVsMaleLap": pair_geometry_check(female, male, depsgraph),
        "leftTongueVsCrown": pair_geometry_check(female, crown, depsgraph),
        "rightTongueVsCrown": pair_geometry_check(male, crown, depsgraph),
    }
    for peg in pegs:
        checks[peg.name + "VsMaleTongue"] = pair_geometry_check(peg, male, depsgraph)
    return {
        "method": "evaluated Blender mesh BVH triangle overlap plus world bounds; intended channel/lap contact is called out separately",
        "sleeve": {
            "worldDimensionsMm": [round(v * 1000, 4) for v in sleeve.dimensions],
            "worldLocationMm": [round(v * 1000, 4) for v in sleeve.location],
            "rotationRadians": [round(v, 8) for v in sleeve.rotation_euler],
            "scale": list(sleeve.scale),
            "meshVertexCount": len(sleeve.data.vertices),
            "artworkParent": artwork_obj.parent.name,
        },
        "objectInventory": inventory,
        "pairChecks": checks,
        "curveObjectMap": {
            "Rear opening bound edge": "fabric binding along the rear opening; actual construction detail, now sampled on the crown surface",
            "Crown panel stitching seams": "panel seams retained at a thread-scale profile",
            "Crown seam stitch marks": "stitches retained at a thread-scale profile",
            "Brim stitch rows": "brim construction stitch rows retained",
        },
        "physicalFitStatus": "not verified; hat and strap dimensions are reference-derived estimates",
    }


def main():
    args = args_parse()
    if (args.variant, args.size) != ("billboard", 4):
        raise RuntimeError(
            "This owner-review prototype is calibrated only for Billboard Size 4 artwork placement. "
            "Other sizes remain blocked pending physical strap fit calibration."
        )
    if bpy.app.version < (4, 5, 0) or bpy.app.version >= (5, 0, 0):
        raise RuntimeError("SnapInk photo scenes require Blender 4.5 LTS.")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(args.asset_catalog.read_text(encoding="utf-8-sig"))
    asset = next((item for item in catalog["configurations"]
                  if item["variant"] == args.variant and int(item["size"]) == args.size), None)
    if not asset or not asset.get("renderEligible"):
        raise RuntimeError("The selected CAD configuration is marked hold in the pinned catalog.")
    cad_path = (args.cad_root / Path(asset["assetRelativePath"])).resolve()
    if not cad_path.is_file() or sha256(cad_path) != asset["sha256"]:
        raise RuntimeError("Hash-pinned CAD asset is missing or changed; source remains read-only.")
    artwork = args.artwork.resolve()
    if not artwork.is_file():
        raise RuntimeError("Prototype artwork file is missing.")

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import blender_render as sleeve_pipeline

    clear_scene()
    bpy.ops.wm.stl_import(filepath=str(cad_path), forward_axis="Y", up_axis="Z")
    sleeve = bpy.context.object
    sleeve.name = f"Hash-verified SnapInk {args.variant.title()} Size {args.size} sleeve · source STL"
    sleeve.data.name = f"Immutable source mesh · {asset['sha256'][:12]}"
    sleeve.scale = (MM, MM, MM)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sleeve.data.materials.clear()
    black = sleeve_pipeline.srgb_channel_to_linear(17)
    sleeve.data.materials.append(sleeve_pipeline.sleeve_material((black, black, black), template="cinematic"))

    center_x = float(args.artwork_center_x_mm) * MM
    art_w, art_h = float(args.artwork_width_mm) * MM, float(args.artwork_height_mm) * MM
    art_box = (center_x - art_w / 2, center_x + art_w / 2,
               float(args.artwork_center_y_mm) * MM - art_h / 2,
               float(args.artwork_center_y_mm) * MM + art_h / 2)
    vector_args = SimpleNamespace(vector_data=None, output=output_dir / "scene-job.jpg", artwork=artwork)
    vector_path = sleeve_pipeline.resolve_vector_data(vector_args)
    rgb = tuple(sleeve_pipeline.srgb_channel_to_linear(int(args.artwork_color[i:i+2], 16)) for i in (1, 3, 5))
    artwork_obj, art_info = sleeve_pipeline.raised_artwork(sleeve, artwork, vector_path, art_box, rgb)

    # Exact imported CAD mesh stays rigid. Only transform it rigidly from its
    # source coordinates onto the rear strap; no scaling or geometry edit.
    sleeve_x = [float(v.co.x) for v in sleeve.data.vertices]
    sleeve_center_m = (min(sleeve_x) + max(sleeve_x)) / 2
    sleeve.rotation_euler.x = math.pi / 2
    sleeve.location = (-sleeve_center_m, -0.090, 0.028)
    sleeve["source_file"] = asset["assetRelativePath"]
    sleeve["source_sha256"] = asset["sha256"]
    sleeve["source_validation_status"] = asset["validationStatus"]
    sleeve["transform_scale"] = "1.0; CAD mesh dimensions preserved"
    artwork_obj["source_artwork_sha256"] = sha256(artwork)
    artwork_obj["relief_mm"] = sleeve_pipeline.PRODUCTION_ARTWORK_RELIEF_MM

    crown_mesh = fabric_material("Black polyester rear mesh", (0.00045, 0.0005, 0.0006, 1), mesh=True)
    twill = fabric_material("Black structured twill and brim", (0.00008, 0.00009, 0.0001, 1), mesh=False)
    seam_mat = fabric_material("Dark seam binding", (0.002, 0.0022, 0.0025, 1))
    stitch_mat = fabric_material("Charcoal thread", (0.004, 0.0044, 0.0048, 1))
    strap = fabric_material("Black snapback polymer straps", (0.00025, 0.0003, 0.00035, 1))
    posts = fabric_material("Black retaining pegs", (0.0012, 0.0013, 0.0015, 1))
    crown, brim, female, male, pegs = make_hat(args.size,
        float(asset.get("size", args.size)) and (float(asset["size"]) * 8.69 + 84.245) or 84.245,
        strap, posts, crown_mesh, twill, seam_mat, stitch_mat)
    # Use the real CAD mesh's overall length to set the exposed adjustment
    # sequence. That increments peg positions by the measured CAD pitch.
    cad_length_mm = float(args.size * 8.69 + 84.245)
    right_edge_x = (cad_length_mm / 2) * MM
    for index, peg in enumerate(pegs):
        peg.location.x = right_edge_x + 0.0025 + index * HAT_PARAMETERS_MM["snapPegPitch"] * MM

    make_floor_and_lights(bpy.context.scene, (0, 0, 0.05), 0.22)
    scene = bpy.context.scene
    rear = make_camera("Camera A · straight rear hero", (0, -0.56, 0.156), (0, 0, 0.060), 71)
    threeq = make_camera("Camera B · rear three-quarter 35 degrees", (0.34, -0.49, 0.148), (0, 0, 0.060), 71)
    scene.camera = rear
    scene.render.image_settings.color_mode = "RGB"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1067
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 72
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 0.015
    scene.eevee.gtao_quality = 1.0
    scene.eevee.use_shadows = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 95
    scene.render.film_transparent = False
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1067

    validation = {
        "blenderVersion": bpy.app.version_string,
        "renderEngine": "BLENDER_EEVEE_NEXT",
        "photoType": "installed-on-hat prototype",
        "variant": args.variant,
        "size": args.size,
        "exposedPegCount": args.size,
        "CADPath": asset["assetRelativePath"],
        "CADSha256": asset["sha256"],
        "CADValidationStatus": asset["validationStatus"],
        "CADDimensionsMm": [round(float(v) * 1000, 4) for v in sleeve.dimensions],
        "CADScale": list(sleeve.scale),
        "CADModified": False,
        "artworkSha256": sha256(artwork),
        "artworkWidthMm": args.artwork_width_mm,
        "artworkHeightMm": args.artwork_height_mm,
        "artworkReliefMm": art_info["reliefHeightMm"],
        "artworkComponents": art_info.get("componentCount"),
        "artworkManifoldBoundaryEdges": art_info.get("boundaryEdges"),
        "artworkNonmanifoldEdges": art_info.get("nonmanifoldEdges"),
        "hatGeometryStatus": "prototype; visual parameters estimated from supplied references",
        "fitCalibrationStatus": "NOT VERIFIED; female strap thickness, snap-post geometry, hat circumference and absolute adjustment datum need physical measurements",
        "sizeMappingBasis": "existing owner-facing Studio UI: size equals visible unused peg count; CAD sleeve hole count equals size; each adjacent CAD position uses 8.69 mm pitch",
        "strapThicknessMm": HAT_PARAMETERS_MM["strapThickness"],
        "strapWidthRenderProxyMm": HAT_PARAMETERS_MM["strapWidth"],
        "strapWidthStatus": HAT_PARAMETERS_MM["strapWidthStatus"],
        "cameraViews": [
            {"name": "Rear hero", "degreesFromRear": 0},
            {"name": "Rear three-quarter", "degreesFromRear": 35},
        ],
        "artworkPlacement": "existing validated Studio placement values from the owner-uploaded Size 4 LIFT job",
    }
    scene["snapink_hat_prototype_metadata"] = json.dumps(validation)
    diagnostics = inspect_built_scene(sleeve, artwork_obj, crown, female, male, pegs)
    validation["geometryInspection"] = diagnostics
    scene["snapink_geometry_inspection"] = json.dumps(diagnostics)
    if args.inspect_only:
        scene.camera = rear
        bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / "snapink-adjustable-hat-prototype.blend"))
        (output_dir / "geometry-inspection.json").write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
        print(json.dumps(diagnostics))
        return
    for cam, name in ((rear, "rear-hero"), (threeq, "rear-three-quarter")):
        output = output_dir / f"installed-hat-{args.variant}-size-{args.size}-{name}.jpg"
        scene.camera = cam
        scene.render.filepath = str(output)
        started = __import__("time").perf_counter()
        bpy.ops.render.render(write_still=True)
        validation.setdefault("renders", []).append({
            "file": output.name,
            "bytes": output.stat().st_size,
            "durationMs": round((__import__("time").perf_counter() - started) * 1000),
            "camera": cam.name,
        })
    scene.camera = rear
    bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / "snapink-adjustable-hat-prototype.blend"))
    (output_dir / "prototype-validation.json").write_text(json.dumps(validation, indent=2), encoding="utf-8")
    print(json.dumps(validation))


if __name__ == "__main__":
    main()
