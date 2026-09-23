"""Shape construction: a family of pinched, sheared shell contours.

This module contains no colors, stars, or file I/O. Its two principal outputs
can be supplied by another geometry implementation to reuse the cloud shader.
"""
from __future__ import annotations
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from .config import ShellConfig
from .numeric import FloatArray, coordinate_arrays, soft_cutoff


@dataclass(frozen=True)
class GeometryFields:
    """Scalar fields used to texture a structure.

    warp: original S; changes coordinates supplied to the texture.
    rim: original A; emission envelope, normally in [0, 1/4].
    coverage: diagnostic only; 1 - product(1-J_s), normally in [0, 1].

    ``coverage`` is not substituted for ``rim``: doing so fills the lobes
    instead of emphasizing their shells. All fields must match x/y's shape.
    """
    warp: FloatArray
    rim: FloatArray
    coverage: FloatArray


def shell_radius(index: int, config: ShellConfig = ShellConfig()) -> float:
    """R(s): increasing size plus deterministic shell-to-shell variation."""
    return config.radius_step * index + config.radius_wobble * np.cos(5 * index * index)


def shell_residual(
    x: ArrayLike, y: ArrayLike, index: int, config: ShellConfig = ShellConfig()
) -> FloatArray:
    """L_s: negative inside a warped shell, zero on it, positive outside.

    This is NOT Euclidean signed distance in the image plane. The transverse
    coordinate is divided by |u|**pinch_power, narrowing the shape near u=0.
    Different shears for u and v tip and deform successive shells.

    The printed expression is singular on u=0. We use +infinity there when
    v!=0 (the fixed-v limit). At the isolated u=v=0 point there is no unique
    2-D limit; we explicitly choose the centerline value L=-R. Native source
    pixels do not encounter this exceptional point. No blanket epsilon is
    added to the denominator, because that would alter neighboring pixels.
    """
    if isinstance(index, bool) or not isinstance(index, int) or index < 1:
        raise ValueError("shell index must be a positive integer.")
    x, y = coordinate_arrays(x, y)
    radius = shell_radius(index, config)
    phase = index * index
    u = x + (config.shear + config.shear_wobble * np.cos(3 * phase)) * y + config.neck_offset
    v = y - (config.shear + config.shear_wobble * np.cos(4 * phase)) * x

    denominator = np.abs(u) ** config.pinch_power
    numerator = config.cross_scale * radius ** config.pinch_power * v
    transverse = np.full_like(u, np.inf)
    np.divide(numerator, denominator, out=transverse, where=denominator != 0)
    transverse = np.where((denominator == 0) & (v == 0), 0.0, transverse)
    return np.hypot(u, transverse) - radius


def build_geometry(
    x: ArrayLike, y: ArrayLike, config: ShellConfig = ShellConfig()
) -> GeometryFields:
    """Compute S and A with ordered, soft first-hit shell selection.

    weight_s = J_s * product_{u=0..s-1}(1-J_u).

    A running ``remaining`` weight computes all prefix products in O(N),
    avoiding recomputing each product from scratch. J_0 is exactly zero at
    float64 precision: its exponent includes -exp(25). Thus remaining starts
    at 1. This is an algebraic layer-selection mechanism, not ray tracing.
    """
    x, y = coordinate_arrays(x, y)
    remaining = np.ones_like(x)
    warp = np.zeros_like(x)
    rim = np.zeros_like(x)

    for index in range(1, config.count + 1):
        residual = shell_residual(x, y, index, config)
        membership = soft_cutoff(25 - 50 * index) * soft_cutoff(config.edge_sharpness * residual)
        weight = remaining * membership

        # Outside singular contours residual can be +inf, but its weight is 0.
        # Avoid 0*inf, without changing any finite, nonzero contribution.
        weighted_residual = np.zeros_like(x)
        np.multiply(weight, residual, out=weighted_residual, where=weight != 0)
        warp += 2.0 * weighted_residual

        outer_shell_fade = soft_cutoff(config.fade_rate * (index - config.fade_center))
        hollow_interior = soft_cutoff(-config.interior_falloff * residual)
        rim += 0.25 * weight * outer_shell_fade * hollow_interior
        remaining *= 1.0 - membership

    return GeometryFields(warp=warp, rim=rim, coverage=1.0 - remaining)
