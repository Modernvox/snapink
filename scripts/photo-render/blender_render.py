"""Private SnapInk product photography worker. Run only with Blender 4.5 LTS+ Python."""
import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


# Match the local production generator's PROFILE["relief_mm"] value. This is
# rendering geometry only; production/CAD assets are never written.
PRODUCTION_ARTWORK_RELIEF_MM = 0.8
# Flat decal preview only. Raised artwork uses vector contours and no occupancy grid.
ARTWORK_MESH_CELL_MM = 0.05


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--cad-root", type=Path, required=True)
    parser.add_argument("--asset-catalog", type=Path, required=True)
    parser.add_argument("--artwork", type=Path, required=True)
    parser.add_argument("--vector-data", type=Path)
    parser.add_argument("--diagnostics-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.meshes, bpy.data.curves):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def make_area(name, location, target, power, size, color, cast_shadow=True):
    data = bpy.data.lights.new(name, "AREA")
    # Product is about 0.12 m long; scale studio wattage for this small scene.
    data.energy, data.shape, data.size, data.color = power * 0.003, "DISK", size, color
    data.use_shadow = cast_shadow
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)
    return obj


def make_floor(template, radius):
    bpy.ops.mesh.primitive_plane_add(size=radius * (8 if template == "marketplace" else 4), location=(0, 0, -0.0002))
    floor = bpy.context.object
    floor.name = "Studio background surface"
    mat = bpy.data.materials.new("Marketplace white" if template == "marketplace" else "Dark photo surface")
    mat.diffuse_color = (0.96, 0.96, 0.94, 1) if template == "marketplace" else (0.025, 0.022, 0.018, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if template == "marketplace":
        bsdf.inputs["Base Color"].default_value = (0.98, 0.98, 0.97, 1)
        bsdf.inputs["Roughness"].default_value = 0.78
        if "Emission Color" in bsdf.inputs:
            # Lift the matte listing sweep back to white while retaining
            # real area-light contact shading. The camera background stays
            # independent of the reduced product fill.
            bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
            bsdf.inputs["Emission Strength"].default_value = 0.9
    else:
        bsdf.inputs["Base Color"].default_value = (0.018, 0.015, 0.012, 1) if template == "cinematic" else (0.035, 0.038, 0.042, 1)
        bsdf.inputs["Metallic"].default_value = 0.24 if template == "cinematic" else 0.12
        bsdf.inputs["Roughness"].default_value = 0.38
        noise = mat.node_tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 240
        noise.inputs["Detail"].default_value = 2
        bump = mat.node_tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.12
        bump.inputs["Distance"].default_value = 0.0001
        mat.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        mat.node_tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    floor.data.materials.append(mat)
    return floor


def sleeve_material(color, *, template="studio"):
    mat = bpy.data.materials.new("SnapInk TPU Â· render material")
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    marketplace = template == "marketplace"
    # A matte TPU finish in listing shots avoids broad softbox reflections
    # lifting black sleeves into charcoal gray. Other presets keep their
    # established surface response.
    bsdf.inputs["Roughness"].default_value = 0.58 if marketplace else 0.36
    bsdf.inputs["Metallic"].default_value = 0.0 if marketplace else 0.025
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.04 if marketplace else 0.18
        bsdf.inputs["Coat Roughness"].default_value = 0.52 if marketplace else 0.28
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 360
    noise.inputs["Detail"].default_value = 2
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.075
    bump.inputs["Distance"].default_value = 0.000035
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def srgb_channel_to_linear(value):
    """Convert an 8-bit/CSS sRGB channel to Blender's linear shader space."""
    value = float(value) / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def artwork_material(image, *, raised, solid_color=None):
    mat = bpy.data.materials.new("Uploaded artwork TPU 95A render material")
    mat.use_nodes = True
    mat.surface_render_method = "DITHERED"
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.03
        bsdf.inputs["Coat Roughness"].default_value = 0.42
    if raised and solid_color is not None:
        bsdf.inputs["Base Color"].default_value = (*solid_color, 1)
    else:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    if not raised:
        links.new(texture.outputs["Alpha"], bsdf.inputs["Alpha"])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 360
    noise.inputs["Detail"].default_value = 2
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.035 if raised else 0.025
    bump.inputs["Distance"].default_value = 0.000018
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def flat_artwork(sleeve, image_path, box):
    x0, x1, y0, y1 = box
    step = ARTWORK_MESH_CELL_MM * 0.001
    cols = max(2, min(700, math.ceil((x1 - x0) / step) + 1))
    rows = max(2, min(400, math.ceil((y1 - y0) / step) + 1))
    image = bpy.data.images.load(str(image_path), check_existing=False)
    verts, faces, uvs = [], [], []
    surface_z = max(v.co.z for v in sleeve.data.vertices)
    for row in range(rows):
        v = row / (rows - 1)
        for col in range(cols):
            u = col / (cols - 1)
            x, y = x0 + u * (x1 - x0), y0 + v * (y1 - y0)
            verts.append((x, y, surface_z + 0.006))
    for row in range(rows - 1):
        for col in range(cols - 1):
            a = row * cols + col
            faces.append((a, a + 1, a + cols + 1, a + cols))
    mesh = bpy.data.meshes.new("Studio flat artwork projection")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Uploaded artwork Â· flat render surface", mesh)
    bpy.context.collection.objects.link(obj)
    uv_layer = mesh.uv_layers.new(name="Artwork UV")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            row, col = divmod(vertex_index, cols)
            uv_layer.data[loop_index].uv = (col / (cols - 1), row / (rows - 1))
    wrap = obj.modifiers.new("Conform to approved sleeve STL", "SHRINKWRAP")
    wrap.target = sleeve
    wrap.wrap_method = "NEAREST_SURFACEPOINT"
    wrap.offset = 0.00002
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=wrap.name)
    obj.data.materials.append(artwork_material(image, raised=False))
    obj.parent = sleeve
    return obj, {"reliefHeightMm": 0.0, "meshVertices": len(mesh.vertices), "meshFaces": len(mesh.polygons)}


def resolve_vector_data(args):
    """Run the local alpha-contour vectorizer once and cache its private output."""
    if args.vector_data:
        vector_path = args.vector_data
    else:
        source_hash = sha256(args.artwork)
        cache = args.output.parent / "vector-cache"
        vector_path = cache / f"{source_hash}.json"
    if vector_path.is_file():
        try:
            cached = json.loads(vector_path.read_text(encoding="utf-8"))
            if cached.get("schemaVersion") == 4 and cached.get("sourceSha256") == sha256(args.artwork):
                return vector_path
        except (OSError, json.JSONDecodeError):
            pass
        if args.vector_data:
            raise RuntimeError("Supplied artwork vector data is stale or has an unsupported schema.")
    vectorizer = Path(__file__).with_name("vectorize_artwork.py")
    vector_path.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        command = ["py", "-3.12", str(vectorizer), "--artwork", str(args.artwork), "--output", str(vector_path)]
    else:
        python = os.environ.get("SNAPINK_VECTOR_PYTHON", sys.executable)
        command = [python, str(vectorizer), "--artwork", str(args.artwork), "--output", str(vector_path)]
    try:
        proc = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Artwork vectorization requires Python 3.12 with Pillow, NumPy, and Shapely 2.1; install nothing automatically.") from exc
    if proc.returncode != 0 or not vector_path.is_file():
        detail = proc.stderr.strip() or proc.stdout.strip() or "vectorizer produced no contour file"
        raise RuntimeError(f"Artwork contour extraction failed (exit {proc.returncode}, output file exists: {vector_path.is_file()}, output path: {vector_path}): {detail}")
    return vector_path


def raised_artwork(sleeve, image_path, vector_path, box, solid_color):
    """Build one exact, closed mesh from source-alpha vector contours and a constrained triangulation."""
    x0, x1, y0, y1 = box
    image = bpy.data.images.load(str(image_path), check_existing=False)
    vectors = json.loads(vector_path.read_text(encoding="utf-8"))
    if vectors.get("sourceSha256") != sha256(image_path):
        raise RuntimeError("Vector contour cache does not match the exact uploaded artwork hash.")
    image_width, image_height = int(vectors["sourceWidth"]), int(vectors["sourceHeight"])
    bx0, by0, bx1, by1 = map(float, vectors["visibleBoundsPx"])
    bw, bh = bx1 - bx0, by1 - by0
    if bw <= 0 or bh <= 0 or len(vectors.get("polygons", [])) != int(vectors["componentCount"]):
        raise RuntimeError("Vectorized artwork bounds or component catalog is invalid.")

    # Fit the exact visible contour uniformly inside the existing CAD-computed
    # artwork box. Transparent raster margins must not stretch the logo.
    placed_width = min(x1 - x0, (y1 - y0) * bw / bh)
    placed_height = placed_width * bh / bw
    fit_cx, fit_cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
    px0, px1 = fit_cx - placed_width * 0.5, fit_cx + placed_width * 0.5
    py0, py1 = fit_cy - placed_height * 0.5, fit_cy + placed_height * 0.5

    # The approved branding patch is planar. Map the vector bounds onto the
    # existing CAD-computed artwork box without nearest-surface projection,
    # which previously made outlines jump across STL triangles.
    surface_z = max(v.co.z for v in sleeve.data.vertices)
    relief = PRODUCTION_ARTWORK_RELIEF_MM * 0.001
    vertices, faces, uv_by_vertex = [], [], []
    lookup = {}

    def vertex(layer, point):
        px, py = map(float, point)
        key = (layer, round(px, 8), round(py, 8))
        if key not in lookup:
            x = px0 + (px - bx0) / bw * placed_width
            y = py1 - (py - by0) / bh * placed_height
            z = surface_z + (relief if layer == "top" else 0.0)
            lookup[key] = len(vertices)
            vertices.append((x, y, z))
            uv_by_vertex.append((px / image_width, 1.0 - py / image_height))
        return lookup[key]

    top_face_indices = []
    for polygon in vectors["polygons"]:
        for triangle in polygon["triangles"]:
            top = tuple(vertex("top", p) for p in triangle)
            base = tuple(vertex("base", p) for p in triangle)
            top_face_indices.append(len(faces))
            faces.append(top)
            faces.append(tuple(reversed(base)))
        for ring in [polygon["exterior"], *polygon["holes"]]:
            for index, point in enumerate(ring):
                following = ring[(index + 1) % len(ring)]
                b0, b1 = vertex("base", point), vertex("base", following)
                t1, t0 = vertex("top", following), vertex("top", point)
                faces.append((b0, b1, t1, t0))

    mesh = bpy.data.meshes.new("Studio extruded raised artwork Â· 0.8 mm")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    # Recalculate solid normals for Eevee's direct and ambient-occlusion shading.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Correct orientation component by component. Disconnected logo glyphs are
    # intentional islands; the island count must match the vector source.
    remaining = set(bm.faces)
    shell_volumes = []
    while remaining:
        seed = remaining.pop()
        shell = {seed}
        stack = [seed]
        while stack:
            face = stack.pop()
            for edge in face.edges:
                for neighbor in edge.link_faces:
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        shell.add(neighbor)
                        stack.append(neighbor)
        volume = 0.0
        for face in shell:
            points = [v.co for v in face.verts]
            for index in range(1, len(points) - 1):
                volume += points[0].dot(points[index].cross(points[index + 1])) / 6.0
        if volume < 0:
            bmesh.ops.reverse_faces(bm, faces=list(shell))
            volume = -volume
        if volume <= 1e-15:
            bm.free()
            raise RuntimeError("Extruded artwork contains a zero-volume or inverted shell.")
        shell_volumes.append(volume)
    if len(shell_volumes) != int(vectors["componentCount"]):
        bm.free()
        raise RuntimeError(f"Extruded mesh shell count {len(shell_volumes)} does not match the {vectors['componentCount']} source contours.")

    boundary_edges = sum(edge.is_boundary for edge in bm.edges)
    nonmanifold_edges = sum(not edge.is_manifold for edge in bm.edges)
    nonmanifold_vertices = sum(not vertex.is_manifold for vertex in bm.verts)
    if boundary_edges or nonmanifold_edges or nonmanifold_vertices:
        bm.free()
        raise RuntimeError(f"Extruded artwork mesh failed manifold validation (boundary={boundary_edges}, nonmanifold edges={nonmanifold_edges}, vertices={nonmanifold_vertices}).")
    signed_volume = sum(shell_volumes)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="Artwork UV")
    for poly in mesh.polygons:
        poly.use_smooth = poly.normal.z > 0.7
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uv_by_vertex[vertex_index]
    obj = bpy.data.objects.new("Uploaded artwork Â· physically raised TPU geometry", mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = sleeve
    obj.matrix_parent_inverse = sleeve.matrix_world.inverted()
    obj.data.materials.append(artwork_material(image, raised=True, solid_color=solid_color))
    return obj, {"reliefHeightMm": PRODUCTION_ARTWORK_RELIEF_MM, "placedWidthMm": placed_width * 1000, "placedHeightMm": placed_height * 1000, "meshVertices": len(mesh.vertices), "meshFaces": len(mesh.polygons), "topFaces": len(top_face_indices), "componentCount": vectors["componentCount"], "holeCount": vectors["holeCount"], "boundaryEdges": boundary_edges, "nonmanifoldEdges": nonmanifold_edges, "nonmanifoldVertices": nonmanifold_vertices, "signedVolumeMm3": signed_volume * 1e9, "sourceSha256": vectors["sourceSha256"], "contourThreshold": vectors["alphaThreshold"], "contourSimplifyTolerancePx": vectors["simplifyTolerancePx"]}


def artwork_geometry_sha256(obj):
    h = hashlib.sha256()
    coordinates = [tuple(round(value, 9) for value in vertex.co) for vertex in obj.data.vertices]
    for coordinate in sorted(coordinates):
        h.update((",".join(f"{value:.9f}" for value in coordinate) + ";").encode("ascii"))
    oriented_faces = []
    for polygon in obj.data.polygons:
        points = [coordinates[index] for index in polygon.vertices]
        cycles = [tuple(points[i:] + points[:i]) for i in range(len(points))]
        oriented_faces.append(min(cycles))
    for face in sorted(oriented_faces):
        h.update(("|".join(";".join(f"{value:.9f}" for value in point) for point in face) + "\n").encode("ascii"))
    return h.hexdigest()


def render_mesh_diagnostic(artwork, output_path):
    """Render the actual raised mesh alone for source-to-solid diagnostics."""
    scene = bpy.context.scene
    world_matrix = artwork.matrix_world.copy()
    artwork.parent = None
    artwork.matrix_world = world_matrix
    world_vertices = [world_matrix @ vertex.co for vertex in artwork.data.vertices]
    min_x, max_x = min(v.x for v in world_vertices), max(v.x for v in world_vertices)
    min_y, max_y = min(v.y for v in world_vertices), max(v.y for v in world_vertices)
    min_z, max_z = min(v.z for v in world_vertices), max(v.z for v in world_vertices)
    center = Vector(((min_x + max_x) * 0.5, (min_y + max_y) * 0.5, (min_z + max_z) * 0.5))
    span = max(max_x - min_x, max_y - min_y)
    hidden = []
    for obj in scene.objects:
        if obj != artwork:
            hidden.append((obj, obj.hide_render))
            obj.hide_render = True

    floor_z = min_z - 0.00001
    bpy.ops.mesh.primitive_plane_add(size=span * 4.0, location=(center.x, center.y, floor_z))
    floor = bpy.context.object
    floor.name = "Diagnostic mesh preview ground"
    floor_mat = bpy.data.materials.new("Diagnostic charcoal ground")
    floor_mat.diffuse_color = (0.055, 0.06, 0.07, 1)
    floor_mat.use_nodes = True
    floor_bsdf = floor_mat.node_tree.nodes.get("Principled BSDF")
    floor_bsdf.inputs["Base Color"].default_value = (0.055, 0.06, 0.07, 1)
    floor_bsdf.inputs["Roughness"].default_value = 0.68
    floor.data.materials.append(floor_mat)
    floor.hide_render = False

    key = make_area("Diagnostic relief key", (center.x - span * 0.35, center.y - span * 0.7, center.z + span * 0.22), center, 48, span * 0.28, (1, 0.9, 0.75))
    fill = make_area("Diagnostic relief fill", (center.x + span * 0.45, center.y + span * 0.25, center.z + span * 0.48), center, 24, span * 0.45, (0.72, 0.82, 1), False)
    key.hide_render = fill.hide_render = False
    cam_data = bpy.data.cameras.new("Diagnostic raised mesh camera")
    cam = bpy.data.objects.new("Diagnostic raised mesh camera", cam_data)
    scene.collection.objects.link(cam)
    cam.location = center + Vector((0, -span * 1.2, span * 1.0))
    point_at(cam, center)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span * 1.18
    scene.camera = cam
    scene.world.color = (0.07, 0.075, 0.085)
    if scene.world.use_nodes:
        scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.07, 0.075, 0.085, 1)
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    old_x, old_y = scene.render.resolution_x, scene.render.resolution_y
    old_format, old_mode, old_path = scene.render.image_settings.file_format, scene.render.image_settings.color_mode, scene.render.filepath
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1800, 520, 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x, scene.render.resolution_y = old_x, old_y
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode, scene.render.filepath = old_format, old_mode, old_path
    for obj, was_hidden in hidden:
        obj.hide_render = was_hidden


def emit_visual_diagnostic(args, vector_path, mesh_preview, product_path, artwork_info):
    if not args.diagnostics_dir:
        return
    vectorizer = Path(__file__).with_name("make_artwork_diagnostic.py")
    out = args.diagnostics_dir / "artwork-pipeline-diagnostic.png"
    if os.name == "nt":
        command = ["py", "-3.12", str(vectorizer), "--artwork", str(args.artwork), "--vectors", str(vector_path), "--mesh", str(mesh_preview), "--product", str(product_path), "--output", str(out)]
    else:
        python = os.environ.get("SNAPINK_VECTOR_PYTHON", sys.executable)
        command = [python, str(vectorizer), "--artwork", str(args.artwork), "--vectors", str(vector_path), "--mesh", str(mesh_preview), "--product", str(product_path), "--output", str(out)]
    proc = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if proc.returncode != 0 or not out.is_file():
        raise RuntimeError("Artwork pipeline diagnostic generation failed: " + ((proc.stderr or "").strip() or (proc.stdout or "").strip()))
    print(json.dumps({"diagnosticImage": str(out), "diagnosticSummary": {k: artwork_info[k] for k in ("componentCount", "holeCount", "boundaryEdges", "nonmanifoldEdges", "nonmanifoldVertices")}}))


def run():
    args = parse_args()
    job = json.loads(args.job.read_text(encoding="utf-8-sig"))
    settings = job["settings"]
    variant, size = settings["variant"], int(settings["size"])
    catalog = json.loads(args.asset_catalog.read_text(encoding="utf-8-sig"))
    asset = next((entry for entry in catalog["configurations"] if entry["variant"] == variant and entry["size"] == size), None)
    if not asset or not asset.get("assetRelativePath") or not asset.get("renderEligible"):
        raise RuntimeError("The selected CAD catalog configuration is on hold or missing.")
    model_path = args.cad_root / Path(asset["assetRelativePath"])
    if not model_path.is_file() or sha256(model_path) != asset["sha256"]:
        raise RuntimeError("Read-only approved sleeve STL is missing or its pinned SHA-256 changed.")
    if bpy.app.version < (4, 5, 0) or bpy.app.version >= (5, 0, 0):
        raise RuntimeError("SnapInk renderer requires Blender 4.5 LTS.")
    clear_scene()
    bpy.ops.wm.stl_import(filepath=str(model_path), forward_axis="Y", up_axis="Z")
    sleeve = bpy.context.object
    sleeve.name = "Verified SnapInk sleeve Â· original approved STL"
    sleeve.data.name = f"{variant.title()} size {size} verified mesh"
    sleeve.scale = (0.001, 0.001, 0.001)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sleeve.data.materials.clear()
    rgb = tuple(srgb_channel_to_linear(int(settings["material"][i:i+2], 16)) for i in (1, 3, 5))
    sleeve.data.materials.append(sleeve_material(rgb, template=settings["template"]))
    ztop = max(v.co.z for v in sleeve.data.vertices)
    width = float(settings["artworkWidthMm"]) * 0.001
    height = float(settings["artworkHeightMm"]) * 0.001
    cx = float(settings["artworkCenterXmm"]) * 0.001
    cy = float(settings["artworkCenterYmm"]) * 0.001
    artwork_box=(cx-width/2,cx+width/2,cy-height/2,cy+height/2)
    is_raised=settings.get("relief", "raised") == "raised"
    if is_raised:
        vector_path = resolve_vector_data(args)
        art_color = settings.get("artColor", "#ffffff")
        art_rgb = None if art_color == "original" else tuple(
            srgb_channel_to_linear(int(art_color[i:i+2], 16)) for i in (1, 3, 5)
        )
        artwork,artwork_info=raised_artwork(sleeve,args.artwork,vector_path,artwork_box,art_rgb)
    else:
        artwork,artwork_info=flat_artwork(sleeve,args.artwork,artwork_box)

    template = settings["template"]
    sleeve.rotation_euler.z = math.radians(-18 if template == "cinematic" else -7)
    center = (float(settings["geometryCenterXmm"]) * 0.001, 0, 0.0017)
    radius = float(settings["geometryLengthMm"]) * 0.001
    make_floor(template,radius)
    scene=bpy.context.scene
    scene.world.color=(0.025,0.022,0.018) if template=="cinematic" else ((1,1,1) if template=="marketplace" else (0.08,0.08,0.08))
    if scene.world.use_nodes:
        world_nodes=scene.world.node_tree.nodes
        world_links=scene.world.node_tree.links
        world_bg=world_nodes["Background"]
        world_bg.inputs["Color"].default_value=(0.025,0.022,0.018,1) if template=="cinematic" else ((1,1,1,1) if template=="marketplace" else (0.08,0.08,0.08,1))
        world_bg.inputs["Strength"].default_value=0.08 if template=="cinematic" else (0.6 if template=="marketplace" else 0.25)
    target=center
    if template=="marketplace":
        make_area("Marketplace soft key",(radius*.18,-radius*.62,radius*.72),target,8,radius*.72,(1,1,1))
        make_area("Marketplace gentle fill",(-radius*.55,radius*.18,radius*.42),target,4,radius*.5,(0.92,0.95,1),False)
        make_area("Marketplace edge strip",(-radius*.88,-radius*.05,radius*.24),target,14,radius*.09,(1,1,1),False)
    elif template=="cinematic":
        make_area("Warm key",(radius*.22,-radius*.3,radius*.95),target,52,radius*.42,(1,.55,.22),False)
        make_area("Amber rim",(-radius*.72,radius*.2,radius*.58),target,62,radius*.14,(1,.42,.16),False)
        make_area("Logo grazing strip",(-radius*.28,-radius*.52,radius*.24),target,10,radius*.16,(1,.8,.62))
        make_area("Cool soft fill",(radius*.15,radius*.62,radius*.54),target,18,radius*.5,(.54,.62,.8),False)
    else:
        make_area("Studio key",(radius*.15,-radius*.55,radius*.9),target,45,radius*.62,(1,.92,.8))
        make_area("Studio strip",(-radius*.58,radius*.08,radius*.7),target,36,radius*.18,(.72,.81,1))
        make_area("Soft fill",(radius*.38,radius*.52,radius*.52),target,16,radius*.55,(1,1,1))
    cam_data=bpy.data.cameras.new("SnapInk product camera")
    cam=bpy.data.objects.new("SnapInk product camera",cam_data)
    bpy.context.collection.objects.link(cam)
    direction=Vector((1,-1.48,1.0)).normalized()
    cam.location=Vector(target)+direction*radius*2.45
    point_at(cam,target)
    # The measured 1600 px marketplace render occupied only 61.4% of the
    # canvas width. Use a tighter listing frame while preserving the camera
    # direction and studio-light setup; target 75–85% product width.
    cam_data.lens=76 if template=="marketplace" else 68
    scene.camera=cam
    render_mode=settings.get("renderMode", "fast")
    gpu_warning=None
    render_device="GPU"
    if render_mode=="fast":
        scene.render.engine="BLENDER_EEVEE_NEXT"
        scene.eevee.taa_render_samples=8
        scene.eevee.use_gtao=True
        scene.eevee.gtao_distance=0.002
        scene.eevee.gtao_quality=1.0
        scene.eevee.use_shadows=True
        # Keep Fast responsive with dense extruded lettering; direct Eevee
        # shadows and short-range GTAO still reveal the 0.8 mm relief.
        scene.eevee.use_raytracing=False
        scene.eevee.ray_tracing_method="SCREEN"
        scene.eevee.shadow_ray_count=2
        scene.eevee.shadow_step_count=6
        if hasattr(scene.eevee,"use_fast_gi"):
            scene.eevee.use_fast_gi=True
        render_engine="BLENDER_EEVEE_NEXT"
    elif render_mode=="premium":
        scene.render.engine="CYCLES"
        scene.cycles.samples=64 if settings["resolution"]<=1600 else (96 if settings["resolution"]<=2400 else 128)
        scene.cycles.use_denoising=True
        scene.cycles.device="GPU"
        try:
            prefs=bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type="OPTIX"
            prefs.get_devices()
            enabled=False
            for device in prefs.devices:
                device.use=(device.type=="OPTIX")
                enabled=enabled or device.use
            if not enabled: raise RuntimeError("No OptiX device discovered")
            render_device="OPTIX"
        except Exception as error:
            scene.cycles.device="CPU"
            render_device="CPU"
            gpu_warning="NVIDIA OptiX was unavailable; Premium mode rendered on CPU. "+str(error)[:240]
        render_engine="CYCLES"
    else:
        raise RuntimeError("Unknown render mode; expected fast or premium.")
    scene.render.resolution_x=int(settings["resolution"])
    scene.render.resolution_y=int(settings["resolution"])
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="JPEG"
    scene.render.image_settings.quality=94
    scene.render.filepath=str(args.output)
    scene.render.film_transparent=False
    scene.view_settings.view_transform="Standard" if template=="marketplace" else "AgX"
    # Keep the small product and all branding detail sharp at close range.
    scene.camera.data.dof.use_dof=False
    scene.camera.data.dof.focus_object=sleeve
    scene.camera.data.dof.aperture_fstop=8
    scene.render.threads_mode="FIXED"
    scene.render.threads=8
    started=time.perf_counter()
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as error:
        if render_mode != "premium" or render_device != "OPTIX":
            raise
        scene.cycles.device="CPU"
        render_device="CPU"
        gpu_warning="NVIDIA OptiX render failed; Premium mode retried on CPU. "+str(error)[:240]
        if args.output.exists():
            args.output.unlink()
        bpy.ops.render.render(write_still=True)
    render_duration_ms=round((time.perf_counter()-started)*1000)
    if not args.output.is_file() or args.output.stat().st_size < 1000:
        raise RuntimeError("Blender did not produce a valid photograph.")
    mesh_preview = None
    if args.diagnostics_dir and is_raised:
        mesh_preview = args.diagnostics_dir / f"extruded-mesh-{render_mode}.png"
        render_mesh_diagnostic(artwork, mesh_preview)
        emit_visual_diagnostic(args, vector_path, mesh_preview, args.output, artwork_info)
    print(json.dumps({"ok":True,"path":str(args.output),"sha256":sha256(args.output),"blenderVersion":bpy.app.version_string,"renderMode":render_mode,"renderEngine":render_engine,"renderDevice":render_device,"renderDurationMs":render_duration_ms,"gpuWarning":gpu_warning,"assetSha256":asset["sha256"],"validationStatus":asset["validationStatus"],"artworkGeometrySha256":artwork_geometry_sha256(artwork),"artworkReliefHeightMm":artwork_info["reliefHeightMm"],"artworkPlacedWidthMm":artwork_info.get("placedWidthMm"),"artworkPlacedHeightMm":artwork_info.get("placedHeightMm"),"artworkMeshVertices":artwork_info["meshVertices"],"artworkMeshFaces":artwork_info["meshFaces"],"artworkTopFaces":artwork_info.get("topFaces",0),"artworkComponents":artwork_info.get("componentCount"),"artworkHoles":artwork_info.get("holeCount"),"artworkBoundaryEdges":artwork_info.get("boundaryEdges"),"artworkNonmanifoldEdges":artwork_info.get("nonmanifoldEdges"),"artworkNonmanifoldVertices":artwork_info.get("nonmanifoldVertices"),"artworkSignedVolumeMm3":artwork_info.get("signedVolumeMm3"),"artworkSourceSha256":artwork_info.get("sourceSha256"),"artworkContourThreshold":artwork_info.get("contourThreshold"),"artworkContourSimplifyTolerancePx":artwork_info.get("contourSimplifyTolerancePx"),"artworkMeshPreview":str(mesh_preview) if mesh_preview else None}))


if __name__ == "__main__":
    run()
