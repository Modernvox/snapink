"""Render artwork passes for the locked On-Hat Rear View master scene.

This is a scene-specific entry point for the existing Windows Photo Renderer;
it reuses the existing CAD catalog, vectorizer, manifold mesh builder, and GPU
queue. The reference photo is composited by composite_on_hat_rear.py.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


MM = 0.001
ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "scripts/photo-render/on-hat-rear-reference.json"


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--cad-root", type=Path, required=True)
    parser.add_argument("--asset-catalog", type=Path, required=True)
    parser.add_argument("--artwork", type=Path, required=True)
    parser.add_argument("--vector-data", type=Path)
    parser.add_argument("--passes-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def project(scene, camera, points):
    result = []
    for point in points:
        ndc = world_to_camera_view(scene, camera, Vector(point))
        result.append([ndc.x * scene.render.resolution_x,
                       (1.0 - ndc.y) * scene.render.resolution_y])
    return result


def main():
    args = parse_args()
    sys.path.insert(0, str(ROOT / "scripts/photo-render"))
    import blender_render as pipeline

    reference = json.loads(REFERENCE.read_text(encoding="utf-8-sig"))
    if reference.get("schemaVersion") != 2 or not reference.get("masterImageId") or not reference.get("calibrationVersion"):
        raise RuntimeError("Locked master calibration manifest is missing or unsupported.")
    if file_hash(ROOT / reference["masterImage"]) != reference["masterImageSha256"]:
        raise RuntimeError("Locked On-Hat master image hash changed; refusing to render.")
    if bpy.app.version < (4, 5, 0) or bpy.app.version >= (5, 0, 0):
        raise RuntimeError("On-Hat Rear View requires Blender 4.5 LTS.")
    job = json.loads(args.job.read_text(encoding="utf-8-sig"))
    settings = job["settings"]
    if settings.get("scene") != "on-hat-rear" or settings.get("relief") != "raised":
        raise RuntimeError("On-Hat Rear View requires the raised fixed-reference scene.")
    catalog = json.loads(args.asset_catalog.read_text(encoding="utf-8-sig"))
    master_cad = reference["referenceCad"]
    master_cad_path = args.cad_root / Path(master_cad["assetRelativePath"])
    if not master_cad_path.is_file() or file_hash(master_cad_path) != master_cad["sha256"]:
        raise RuntimeError("Locked-master CAD calibration asset is missing or its pinned hash changed.")
    variant, size = settings["variant"], int(settings["size"])
    asset = next((item for item in catalog["configurations"]
                  if item["variant"] == variant and int(item["size"]) == size), None)
    if not asset or not asset.get("renderEligible") or not asset.get("sourceIsReadOnly"):
        raise RuntimeError("The selected CAD asset is missing or not rendering-eligible.")
    cad = args.cad_root / Path(asset["assetRelativePath"])
    if not cad.is_file() or file_hash(cad) != asset["sha256"]:
        raise RuntimeError("Read-only CAD asset hash does not match the pinned catalog.")
    cad_reference = settings.get("cadBrandingReference")
    if (not cad_reference or cad_reference.get("variant") != variant
            or int(cad_reference.get("size", -1)) != size
            or cad_reference.get("geometryVersion") != "blank-flap-candidate-v1"
            or cad_reference.get("positioningVersion") != "cad-flap-valley-to-right-edge-v1"):
        raise RuntimeError("Queued artwork placement does not match the server-derived CAD geometry version.")
    if cad_reference.get("overallMinXmm") is None or cad_reference.get("overallMaxXmm") is None:
        raise RuntimeError("Queued artwork placement is missing CAD-derived sleeve bounds.")
    if file_hash(args.artwork) != job.get("sourceSha256", file_hash(args.artwork)):
        raise RuntimeError("Downloaded artwork hash does not match the private job record.")
    if args.passes_dir.exists():
        for child in args.passes_dir.iterdir():
            if child.is_file():
                child.unlink()
    args.passes_dir.mkdir(parents=True, exist_ok=True)

    pipeline.clear_scene()
    bpy.ops.wm.stl_import(filepath=str(cad), forward_axis="Y", up_axis="Z")
    sleeve = bpy.context.object
    sleeve.name = "Hash-verified SnapInk sleeve for locked master compositing"
    sleeve.scale = (MM, MM, MM)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sleeve.data.materials.clear()
    black = pipeline.srgb_channel_to_linear(17)
    sleeve.data.materials.append(pipeline.sleeve_material((black, black, black), template="marketplace"))

    width_mm = float(settings["artworkWidthMm"])
    height_mm = float(settings["artworkHeightMm"])
    center_x_mm = float(settings["artworkCenterXmm"])
    center_y_mm = float(settings["artworkCenterYmm"])
    box = ((center_x_mm - width_mm / 2) * MM, (center_x_mm + width_mm / 2) * MM,
           (center_y_mm - height_mm / 2) * MM, (center_y_mm + height_mm / 2) * MM)
    vector_path = pipeline.resolve_vector_data(SimpleNamespace(
        vector_data=args.vector_data, output=args.passes_dir / "scene.jpg", artwork=args.artwork))
    artwork, artwork_info = pipeline.raised_artwork(sleeve, args.artwork, vector_path, box)
    edge_bevel = artwork.modifiers.new("Subtle on-hat TPU edge catch", "BEVEL")
    # Relief remains 0.8 mm and the base contour remains the source artwork
    # silhouette. A slightly broader micro-bevel resolves as a visible edge
    # transition in the final master without changing the artwork placement.
    edge_bevel.width = 0.00018
    edge_bevel.segments = 3
    edge_bevel.limit_method = "ANGLE"
    edge_bevel.angle_limit = math.radians(30)
    edge_bevel.harden_normals = True
    # The raised top is triangulated for exact contour coverage. Reweight its
    # smooth vertex normals after beveling so triangulation edges do not shade
    # across the letter face as soft diagonal bands.
    face_normals = artwork.modifiers.new("Stable embossed face normals", "WEIGHTED_NORMAL")
    face_normals.keep_sharp = True
    face_normals.weight = 50
    face_normals.use_face_influence = True
    bsdf = artwork.data.materials[0].node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.46
    coat = bsdf.inputs.get("Coat Weight")
    if coat:
        coat.default_value = reference["artworkMaterial"]["coatWeight"]

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    # Preserve narrow bevel transitions directly; the previous denoising pass
    # softened those details at the small final artwork footprint.
    scene.cycles.samples = 128
    scene.cycles.use_denoising = False
    scene.cycles.device = "CPU"
    render_device, gpu_warning = "CPU", None
    render_mode = settings["renderMode"]
    render_engine = "CYCLES"
    if render_mode == "fast":
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        # Eight temporal samples leave visible edge breakup on small, high
        # contrast letters. This scene renders only the artwork passes, so a
        # modest sample increase improves bevel and shadow stability without
        # increasing the exported product image dimensions.
        scene.eevee.taa_render_samples = 32
        scene.eevee.use_gtao = True
        scene.eevee.gtao_distance = 0.002
        scene.eevee.gtao_quality = 1.0
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = False
        scene.eevee.ray_tracing_method = "SCREEN"
        scene.eevee.shadow_ray_count = 2
        scene.eevee.shadow_step_count = 6
        render_engine, render_device = "BLENDER_EEVEE_NEXT", "GPU"
    elif render_mode == "premium":
        scene.cycles.device = "GPU"
        render_device = "OPTIX"
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            enabled = False
            for device in prefs.devices:
                device.use = device.type == "OPTIX"
                enabled = enabled or device.use
            if not enabled:
                raise RuntimeError("No OptiX device discovered")
        except Exception as error:
            scene.cycles.device = "CPU"
            render_device = "CPU"
            gpu_warning = "NVIDIA OptiX was unavailable; Premium mode rendered on CPU. " + str(error)[:240]
    else:
        raise RuntimeError("Unknown render mode.")

    scene.render.resolution_x, scene.render.resolution_y = reference["passResolutionPx"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.004, 0.004, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.08

    surface_z = max(vertex.co.z for vertex in sleeve.data.vertices)
    target = Vector((float(settings["geometryCenterXmm"]) * MM, 0.0, surface_z))
    lights = reference["lighting"]
    key_size = 0.032
    pipeline.make_area("On-Hat directional key", target + Vector(lights["key"]["relativePositionM"]), target,
                       lights["key"]["power"], key_size, tuple(lights["key"]["color"]))
    # A restrained, shadow-free upper-left source puts a soft catch on the
    # opposite contour edges without creating a second drop shadow.
    upper_left_fill = Vector((-0.046, -0.018, 0.014))
    pipeline.make_area("On-Hat upper-left edge fill", target + upper_left_fill, target,
                       6.5, 0.014, (1.0, 0.97, 0.92), False)
    # Low-angle, small-source light catches the vertical TPU sidewalls while
    # adding little illumination to the horizontal letter faces. The final
    # difference composite cancels its contribution to the unchanged sleeve.
    sidewall_key = Vector((-0.052, -0.024, 0.008))
    pipeline.make_area("On-Hat restrained sidewall key", target + sidewall_key, target,
                       3.0, 0.006, (1.0, 0.98, 0.94), False)
    pipeline.make_area("Locked cool fill", target + Vector(lights["fill"]["relativePositionM"]), target,
                       lights["fill"]["power"], lights["fill"]["sizeM"], tuple(lights["fill"]["color"]), False)
    pipeline.make_area("Locked grazing edge", target + Vector(lights["grazing"]["relativePositionM"]), target,
                       lights["grazing"]["power"], lights["grazing"]["sizeM"], tuple(lights["grazing"]["color"]), False)

    camera_data = bpy.data.cameras.new("Locked On-Hat artwork camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = reference["camera"]["orthoScaleM"]
    camera = bpy.data.objects.new("Locked On-Hat artwork camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (target.x, -0.030, surface_z + 0.25)
    camera.rotation_euler = (Vector(target) - Vector(camera.location)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    x0, x1, y0, y1 = box
    margin_x, margin_y = 0.005, 0.003
    frame = [(x0 - margin_x, y1 + margin_y, surface_z),
             (x1 + margin_x, y1 + margin_y, surface_z),
             (x1 + margin_x, y0 - margin_y, surface_z),
             (x0 - margin_x, y0 - margin_y, surface_z)]

    render_ms = 0
    artwork.hide_render = True
    scene.render.filepath = str(args.passes_dir / "without-art.png")
    started = time.perf_counter(); bpy.ops.render.render(write_still=True)
    render_ms += round((time.perf_counter() - started) * 1000)
    artwork.hide_render = False
    scene.render.filepath = str(args.passes_dir / "with-art.png")
    started = time.perf_counter(); bpy.ops.render.render(write_still=True)
    render_ms += round((time.perf_counter() - started) * 1000)

    sleeve.hide_render = True
    mask_material = bpy.data.materials.new("Unlit mesh-projection alpha")
    mask_material.use_nodes = True
    mask_nodes = mask_material.node_tree.nodes
    mask_nodes.clear()
    emission = mask_nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    output = mask_nodes.new("ShaderNodeOutputMaterial")
    mask_material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    artwork.data.materials.clear(); artwork.data.materials.append(mask_material)
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(args.passes_dir / "geometry-mask.png")
    started = time.perf_counter(); bpy.ops.render.render(write_still=True)
    render_ms += round((time.perf_counter() - started) * 1000)

    metadata = {
        "ok": True,
        "scene": "on-hat-rear",
        "masterImageId": reference["masterImageId"],
        "referenceManifest": str(REFERENCE),
        "masterImage": reference["masterImage"],
        "masterImageSha256": reference["masterImageSha256"],
        "calibrationVersion": reference["calibrationVersion"],
        "masterSleeveQuadPx": reference["sleevePolygonPx"],
        "masterCanvasPx": reference["masterCanvasPx"],
        "masterCadLengthMm": reference["referenceCad"]["lengthMm"],
        "masterCadCenterXmm": reference["referenceCad"]["centerXmm"],
        "catalogCadSha256": asset["sha256"],
        "cadRelativePath": asset["assetRelativePath"],
        "cadSha256": asset["sha256"],
        "cadBrandingReference": cad_reference,
        "cadValidationStatus": asset["validationStatus"],
        "artworkPath": str(args.artwork),
        "artworkSha256": file_hash(args.artwork),
        "vectorDataPath": str(vector_path),
        "artworkPlacementMm": {"centerX": center_x_mm, "centerY": center_y_mm,
                                "width": artwork_info["placedWidthMm"],
                                "height": artwork_info["placedHeightMm"]},
        "artworkReliefMm": artwork_info["reliefHeightMm"],
        "artworkBoundaryEdges": artwork_info["boundaryEdges"],
        "artworkNonmanifoldEdges": artwork_info["nonmanifoldEdges"],
        "artworkNonmanifoldVertices": artwork_info["nonmanifoldVertices"],
        "artworkGeometrySha256": pipeline.artwork_geometry_sha256(artwork),
        "framePhysicalMm": [[point[0] / MM, point[1] / MM] for point in frame],
        "frameProjectedCornersPx": project(scene, camera, frame),
        "renderResolutionPx": reference["passResolutionPx"],
        "renderMode": render_mode,
        "renderEngine": render_engine,
        "renderDevice": render_device,
        "renderDurationMs": render_ms,
        "gpuWarning": gpu_warning,
    }
    args.passes_dir.mkdir(parents=True, exist_ok=True)
    (args.passes_dir / "render-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
