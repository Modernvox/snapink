"""CAD regression checks for the production artwork modes.

Run with the CadQuery command documented in the repository AGENTS.md; the
wrapper exits explicitly to avoid a native CadQuery interpreter-teardown hang.

These tests use a small sleeve fixture to exercise the same boolean path as the
corrected NY contour project, without rewriting any approved or NY project.
"""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import cadquery as cq
from shapely.affinity import scale as shape_scale, translate as shape_translate
from shapely.geometry import Polygon, box, shape as geojson_shape
from shapely.ops import unary_union

SCRIPT = Path(__file__).resolve().parents[1] / "production" / "generate_vector_relief.py"
SPEC = importlib.util.spec_from_file_location("generate_vector_relief", SCRIPT)
GEN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GEN)
CORE = GEN.CORE
PROD = GEN.PROD


class ArtworkModeRegression(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="snapink-artwork-mode-")
        self.work = Path(self.temp.name)
        self.sleeve_step = self.work / "sleeve.step"
        self.support_step = self.work / "support.step"
        # A closed branding panel gives the test the same wall/face relationship
        # used by the NY support repair while keeping the fixture deterministic.
        self.sleeve = cq.Solid.makeBox(18, 18, 2, cq.Vector(-9, -9, 0))
        self.support = cq.Solid.makeBox(2, 2, 1.5, cq.Vector(20, 20, 0))
        cq.exporters.export(self.sleeve, str(self.sleeve_step))
        cq.exporters.export(self.support, str(self.support_step))
        self.svg = self.work / "fixture-logo.svg"
        self.svg.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill-rule="evenodd">'
            '<path fill="#ffffff" fill-rule="evenodd" d="M10 10 H90 V90 H10 Z"/></svg>',
            encoding="utf-8",
        )
        face = box(-9, -9, 9, 9)
        GEN.PROFILE = {
            "usable_face": face.buffer(-1.05),
            "branding_face": face,
            "base_z_mm": 2.0,
            "sleeve_shape": self.sleeve,
            "sleeve_step": self.sleeve_step,
            "support_step": self.support_step,
            "relief_mm": 0.8,
            "branding_wall_height_mm": 0.85,
            "groove_valley_x_mm": -20.4,
            "groove_right_x_mm": -20.0,
            "groove_source": "test fixture",
            "face_bounds_mm": [-9, 9, -9, 9],
            "usable_bounds_mm": list(face.buffer(-1.05).bounds),
        }

    def tearDown(self):
        self.temp.cleanup()

    def generate(self, mode: str, width: float | None = None):
        return GEN.build_relief(
            self.svg, self.work / f"{mode}.stl", None, 50, 50, 100,
            self.sleeve_step, self.support_step, None, None, mode, width,
            self.work, "#000000" if mode == "contour" else None, "#000000",
        )

    def baseline_3mf(self):
        """Create a minimal two-part Orca-style assembly for package regression."""
        package = self.work / "baseline.3mf"
        ET.register_namespace("", CORE)
        ET.register_namespace("p", PROD)
        model = ET.Element(f"{{{CORE}}}model")
        resources = ET.SubElement(model, f"{{{CORE}}}resources")
        assembly = ET.SubElement(resources, f"{{{CORE}}}object", {"id": "3", "type": "model"})
        components = ET.SubElement(assembly, f"{{{CORE}}}components")
        for oid, path in (("1", "/3D/Objects/base.model"), ("2", "/3D/Objects/base.model")):
            ET.SubElement(components, f"{{{CORE}}}component", {"objectid": oid, "transform": "1 0 0 0 1 0 0 0 1 0 0 0", f"{{{PROD}}}path": path})
        build = ET.SubElement(model, f"{{{CORE}}}build")
        ET.SubElement(build, f"{{{CORE}}}item", {"objectid": "3"})
        ET.SubElement(model, f"{{{CORE}}}metadata", {"name": "Title"}).text = "Baseline"
        child = ET.Element(f"{{{CORE}}}model")
        child_resources = ET.SubElement(child, f"{{{CORE}}}resources")
        for oid in ("1", "2"):
            obj = ET.SubElement(child_resources, f"{{{CORE}}}object", {"id": oid, "type": "model"})
            mesh = ET.SubElement(obj, f"{{{CORE}}}mesh")
            vertices = ET.SubElement(mesh, f"{{{CORE}}}vertices")
            for x, y, z in ((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)):
                ET.SubElement(vertices, f"{{{CORE}}}vertex", {"x": str(x), "y": str(y), "z": str(z)})
            triangles = ET.SubElement(mesh, f"{{{CORE}}}triangles")
            for a, b, c in ((0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)):
                ET.SubElement(triangles, f"{{{CORE}}}triangle", {"v1": str(a), "v2": str(b), "v3": str(c)})
        settings = ET.Element("config")
        obj_settings = ET.SubElement(settings, "object", {"id": "3"})
        for oid, name, tool in (("1", "approved sleeve", "0"), ("2", "approved cavity support", "3")):
            part = ET.SubElement(obj_settings, "part", {"id": oid, "subtype": "normal_part"})
            for key, value in (("name", name), ("extruder", tool)):
                ET.SubElement(part, "metadata", {"key": key, "value": value})
        project_settings = {"printer_settings_id": "Snapmaker U1 (0.4 nozzle)",
            "filament_settings_id": ["SnapInk - EONO3D TPU 95A", "SnapInk - EONO3D TPU 95A", "Snapmaker PLA Basic @U1"],
            "filament_type": ["TPU", "TPU", "PLA"], "filament_colour": ["#000000", "#FFFFFF", "#AAAAAA"]}
        rels = ET.Element("{http://schemas.openxmlformats.org/package/2006/relationships}Relationships")
        ET.SubElement(rels, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship", {
            "Id": "r1", "Type": "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel", "Target": "/3D/3dmodel.model"})
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("3D/3dmodel.model", ET.tostring(model, encoding="utf-8", xml_declaration=True))
            archive.writestr("3D/Objects/base.model", ET.tostring(child, encoding="utf-8", xml_declaration=True))
            archive.writestr("Metadata/model_settings.config", ET.tostring(settings, encoding="utf-8", xml_declaration=True))
            archive.writestr("Metadata/project_settings.config", json.dumps(project_settings))
            archive.writestr("_rels/.rels", ET.tostring(rels, encoding="utf-8", xml_declaration=True))
        return package

    def test_standard_artwork_keeps_approved_sleeve_and_support_geometry(self):
        result = self.generate("standard")
        self.assertEqual(result["artworkMode"], "standard")
        self.assertFalse(result["studioContourSettings"]["enabled"])
        self.assertIsNone(result["contourFiles"])
        self.assertTrue(result["assemblyValidation"]["snapFitSourceUnchanged"])
        self.assertAlmostEqual(result["assemblyValidation"]["approvedSleeveRemovedVolumeMm3"], 0, places=6)
        vertices, faces = GEN.read_binary_stl(self.work / "standard.stl")
        GEN.PROFILE.update({"artwork_extruder": 2, "support_extruder": 3})
        info = GEN.package(self.baseline_3mf(), self.work / "standard-output.3mf", vertices, faces,
                           "Standard regression", "#000000", result["artworkColor"])
        self.assertTrue(info["sleeveAndSupportUnchanged"])
        with zipfile.ZipFile(self.work / "standard-output.3mf") as archive:
            self.assertIn("3D/Objects/base.model", archive.namelist())

    def test_independent_studio_width_and_height_are_preserved_in_relief_geometry(self):
        result = GEN.build_relief(
            self.svg, self.work / "independent-scale.stl", 6.0, 50, 50, 100,
            self.sleeve_step, self.support_step, None, None, "standard", None,
            self.work, None, "#000000", 3.0,
        )
        self.assertAlmostEqual(result["widthMm"], 6.0, places=6)
        self.assertAlmostEqual(result["heightMm"], 3.0, places=6)
        self.assertAlmostEqual(result["centerXMm"], 0.0, places=6)
        self.assertAlmostEqual(result["centerYMm"], 0.0, places=6)
        self.assertIsNone(result["uniformScale"])
        self.assertNotEqual(result["horizontalScale"], result["verticalScale"])

    def test_corrected_ny_contour_path_integrates_wall_and_trims_removable_support(self):
        result = self.generate("contour", 4.0)
        validation = result["assemblyValidation"]
        self.assertEqual(result["artworkMode"], "contour")
        self.assertTrue(result["studioContourSettings"]["enabled"])
        self.assertEqual(result["studioContourSettings"]["outwardDilationRadiusMm"], 4.0)
        self.assertTrue(validation["contourIntegratedIntoSleeve"])
        self.assertTrue(validation["cavityFillRetained"])
        self.assertTrue(validation["contourSupportSeparatedFromPermanentBody"])
        self.assertAlmostEqual(validation["supportSleeveIntersectionMm3"], 0, places=6)
        self.assertAlmostEqual(validation["contourZBoundsMm"][0], 2.0)
        self.assertAlmostEqual(validation["contourZBoundsMm"][1], 2.85)
        self.assertTrue(Path(result["contourFiles"]["body"]).is_file())
        self.assertTrue(Path(result["contourFiles"]["support"]).is_file())
        vertices, faces = GEN.read_binary_stl(self.work / "contour.stl")
        GEN.PROFILE.update({"artwork_extruder": 2, "support_extruder": 3})
        info = GEN.package(self.baseline_3mf(), self.work / "contour-output.3mf", vertices, faces,
                           "NY contour regression", "#000000", result["artworkColor"],
                           Path(result["contourFiles"]["body"]), Path(result["contourFiles"]["support"]))
        self.assertFalse(info["sleeveAndSupportUnchanged"])
        self.assertTrue(info["approvedSleeveGeometryPreserved"])
        self.assertTrue(info["contourGeometryIntegrated"])
        with zipfile.ZipFile(self.work / "contour-output.3mf") as archive:
            root = ET.fromstring(archive.read("3D/3dmodel.model"))
            assembly = root.find(f".//{{{CORE}}}object[@id='3']/{{{CORE}}}components")
            self.assertEqual(len(assembly), 3, "baseline sleeve/support plus raised artwork remain separate 3MF parts")

    def test_real_ny_cavity_variant_keeps_functional_body_and_support_clear(self):
        """Exercise the generic contour booleans against the actual NY source CAD."""
        cad_root = Path(__file__).resolve().parents[4]
        fixture = cad_root / "SnapInk_Production/EXPERIMENTAL/Size_1_Billboard_Dual_Cavity_Test"
        body_path = fixture / "SnapInk_Billboard_Size_1_Cavity_1.70mm_TEST.step"
        support_path = fixture / "SnapInk_Billboard_Size_1_Cavity_1.70mm_PLA_Support_TEST.step"
        ny_dir = cad_root / "SnapInk_Production/EXPERIMENTAL/NY_Sleeve_Size1_CavityReduction_0.20mm"
        outline_path = ny_dir / "ny_logo_outline.geojson"
        report_path = ny_dir / "geometry_validation.json"
        if not all(path.is_file() for path in (body_path, support_path, outline_path, report_path)):
            self.skipTest("Local corrected NY sleeve source CAD fixture is not installed.")

        body = cq.importers.importStep(str(body_path)).val()
        cavity_fill = cq.importers.importStep(str(support_path)).val()
        report = json.loads(report_path.read_text(encoding="utf-8"))
        features = json.loads(outline_path.read_text(encoding="utf-8"))["features"]
        logo = unary_union([geojson_shape(feature["geometry"]) for feature in features])
        min_x, min_y, max_x, max_y = logo.bounds
        target_height = float(report["logo_size_mm"][1])
        factor = target_height / (max_y - min_y)
        logo = shape_scale(logo, xfact=factor, yfact=factor, origin=(0, 0))
        target_center_x = float(report["logo_center_x_mm"])
        target_center_y = 0.0
        logo = shape_translate(logo, xoff=target_center_x - (min_x + max_x) * factor / 2,
                              yoff=target_center_y - (min_y + max_y) * factor / 2)

        top_z = body.BoundingBox().zmax
        top_faces = [face for face in body.Faces()
                     if abs(face.BoundingBox().zmin - top_z) < 1e-4 and abs(face.BoundingBox().zmax - top_z) < 1e-4]
        self.assertTrue(top_faces, "NY source sleeve must expose a top branding face")
        top_face = max(top_faces, key=lambda face: face.Area())
        points = []
        for edge in top_face.outerWire().Edges():
            points.extend((edge.positionAt(i / 80).x, edge.positionAt(i / 80).y) for i in range(80))
        branding_face = Polygon(points).buffer(0)
        self.assertTrue(branding_face.is_valid and not branding_face.is_empty)

        integrated, _ring, overhang, _expanded = GEN.integrate_contour_into_branding_wall(
            body, logo, branding_face, top_z, 3.175, 0.85, -2.8)
        combined_support, _raw, trimmed = GEN.generate_contour_cavity_fill(
            cavity_fill, overhang, integrated, top_z, branding_face)
        self.assertLessEqual(body.cut(integrated).Volume(), 0.001,
                             "NY's original 1.70 mm sleeve and calibrated snap geometry remain present")
        self.assertLessEqual(GEN.geometry_intersection_volume(integrated, combined_support), 0.001)
        self.assertTrue(combined_support.isValid())
        self.assertGreater(trimmed.Volume(), 0, "NY contour has exposed overhang requiring removable support")


if __name__ == "__main__":
    unittest.main()
