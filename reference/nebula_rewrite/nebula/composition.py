"""Small, renderer-independent operations for assembling new structures."""
from __future__ import annotations

import math
import numpy as np
from numpy.typing import ArrayLike

from .numeric import FloatArray, coordinate_arrays, rotated_coordinates


def transform_coordinates(x: ArrayLike, y: ArrayLike, *, center: tuple[float, float] = (0, 0),
                          angle: float = 0, scale: float = 1) -> tuple[FloatArray, FloatArray]:
    """Inverse-transform the sampling coordinates to place a procedural object.

    center moves the object in world coordinates; positive angle rotates the
    object counterclockwise; scale>1 enlarges it. This transforms WHERE a
    field is evaluated, so detail is regenerated rather than bitmap-stretched.
    """
    if len(center) != 2 or not all(math.isfinite(c) for c in center):
        raise ValueError("center must be a pair of finite coordinates.")
    if not math.isfinite(angle) or not math.isfinite(scale) or scale <= 0:
        raise ValueError("angle must be finite and scale must be finite and positive.")
    x, y = coordinate_arrays(x, y)
    return rotated_coordinates((x - center[0]) / scale, (y - center[1]) / scale, angle)


def colorize(intensity: ArrayLike, color: tuple[float, float, float]) -> FloatArray:
    """Turn a scalar field into RGB radiance; values may exceed 1."""
    color = np.asarray(color, dtype=np.float64)
    if color.shape != (3,) or not np.isfinite(color).all():
        raise ValueError("color must contain three finite components.")
    return np.asarray(intensity, dtype=np.float64)[..., None] * color


def tint(rgb: ArrayLike, color: tuple[float, float, float]) -> FloatArray:
    """Multiply RGB channel gains without clipping or applying gamma."""
    gains = np.asarray(color, dtype=np.float64)
    if gains.shape != (3,) or not np.isfinite(gains).all():
        raise ValueError("tint must contain three finite components.")
    return np.asarray(rgb, dtype=np.float64) * gains


def mask_emission(rgb: ArrayLike, mask: ArrayLike) -> FloatArray:
    """Multiply RGB emission by a scalar envelope (not alpha-over compositing)."""
    return np.asarray(rgb, dtype=np.float64) * np.asarray(mask, dtype=np.float64)[..., None]


def add_emission(*layers: ArrayLike) -> FloatArray:
    """Sum same-shaped RGB layers; tone-map the result only after composition."""
    if not layers:
        raise ValueError("At least one layer is required.")
    result = np.array(layers[0], dtype=np.float64, copy=True)
    if result.ndim < 1 or result.shape[-1] != 3:
        raise ValueError("Each layer must end in an RGB axis of length three.")
    for layer in layers[1:]:
        layer = np.asarray(layer, dtype=np.float64)
        if layer.shape != result.shape:
            raise ValueError("Emission layers must have identical shapes.")
        result += layer
    return result
