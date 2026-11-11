"""Shared geometry rule for straight Billboard flap extensions."""
from __future__ import annotations


def make_straight_flap_strip(cq, vector, *, x0: float, groove_x: float,
                             base_half: float, edge_half: float, side: str,
                             z: float, height: float):
    """Return a straight flap strip whose width meets the bowed face at groove_x."""
    if side not in {"upper", "lower"}:
        raise ValueError(f"Unknown Billboard side: {side}")
    if groove_x <= x0 or edge_half < base_half or height <= 0:
        raise ValueError("Invalid straight Billboard flap dimensions")
    base = base_half if side == "upper" else -base_half
    edge = edge_half if side == "upper" else -edge_half
    ymin, ymax = (base, edge) if side == "upper" else (edge, base)
    shape = cq.Solid.makeBox(groove_x - x0, ymax - ymin, height,
                             vector(x0, ymin, z))
    if not shape.isValid() or len(shape.Solids()) != 1:
        raise RuntimeError(f"Invalid straight {side} flap strip")
    return shape
