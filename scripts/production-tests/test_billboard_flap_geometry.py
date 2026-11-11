"""Regression tests for the permanent straight Billboard flap boundary."""
from __future__ import annotations

import unittest

import cadquery as cq

from scripts.production.billboard_flap_geometry import make_straight_flap_strip


class BillboardFlapGeometryTests(unittest.TestCase):
    def test_straight_flap_meets_bow_edge_on_both_sides(self):
        x0, groove, base_half, edge_half = -12.725, -3.2, 12.155, 13.879040298438012
        for side in ("upper", "lower"):
            with self.subTest(side=side):
                shape = make_straight_flap_strip(
                    cq, cq.Vector, x0=x0, groove_x=groove,
                    base_half=base_half, edge_half=edge_half,
                    side=side, z=2.36, height=.9,
                )
                self.assertTrue(shape.isValid())
                self.assertEqual(len(shape.Solids()), 1)
                bounds = shape.BoundingBox()
                self.assertAlmostEqual(bounds.xmin, x0, places=6)
                self.assertAlmostEqual(bounds.xmax, groove, places=6)
                expected = edge_half if side == "upper" else -edge_half
                for fraction in (.05, .25, .5, .75, .95):
                    x = x0 + (groove - x0) * fraction
                    slab = cq.Solid.makeBox(.001, 100, 2, cq.Vector(x, -50, 1))
                    section = shape.intersect(slab).BoundingBox()
                    actual = section.ymax if side == "upper" else section.ymin
                    self.assertAlmostEqual(actual, expected, delta=.001)

    def test_rejects_noncontinuous_or_invalid_inputs(self):
        for side in ("upper", "lower"):
            with self.subTest(side=side), self.assertRaises(ValueError):
                make_straight_flap_strip(
                    cq, cq.Vector, x0=0, groove_x=0,
                    base_half=12.155, edge_half=13.8,
                    side=side, z=0, height=1,
                )


if __name__ == "__main__":
    unittest.main()
