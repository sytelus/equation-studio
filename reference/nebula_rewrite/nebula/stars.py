"""Reusable star field: folded coordinate lattices, bright centers, soft halos.

This component is independent of the nebula geometry. Reuse it behind any
other scene, or transform its coordinates separately from the gas.
"""
from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike

from .config import StarConfig
from .numeric import FloatArray, coordinate_arrays, folded_angle, rotated_coordinates, soft_cutoff


def star_lattice(x: FloatArray, y: FloatArray, index: int,
                 config: StarConfig = StarConfig()) -> tuple[FloatArray, FloatArray]:
    """M_s,N_s: nonnegative distances in a periodically folded coordinate grid.

    Each band is a whole lattice of stars. Increasing frequency makes that
    band's stars smaller and more numerous. Offsets and rotations differ
    per band, making their superposition look irregular without randomness.
    """
    q, p = rotated_coordinates(x, y, 15 * index * index)
    u, v = rotated_coordinates(p, q, 19 * index * index)
    frequency = config.frequency_scale * config.frequency_ratio ** index
    m = folded_angle(frequency * u + 2 * np.cos(27 * index * index))
    n = folded_angle(frequency * v + 2 * np.cos(28 * index * index))
    return m, n


def star_kernel(m: FloatArray, n: FloatArray, index: int) -> tuple[FloatArray, FloatArray]:
    """Return bright-center and halo intensity for one lattice.

    B_s angularly perturbs the center's size, adding fine pointed/rayed
    structure. Since M,N >= 0, atan2(M,N) equals atan(M/N) wherever defined.
    atan2 also supplies pi/2 when N=0<M and our explicit zero-angle convention
    when M=N=0; the source ratio is undefined at the latter point.
    """
    angle = np.arctan2(m, n)  # Order is intentional: M/N, NOT N/M.
    angular_phase = 20 * angle + 2 * np.cos(9 * angle + index * index)
    ray_modulation = soft_cutoff(5 * np.cos(angular_phase) + 15 / 4)
    radius_squared = m * m + n * n
    center = 4 * soft_cutoff(200 * (radius_squared - 1 / 800 - ray_modulation / 200))
    halo = soft_cutoff(20 * radius_squared - 7 / 50)
    return center, halo


def star_color(index: int) -> FloatArray:
    """Alternating warm/cool RGB weights in T_v (not a physical spectrum)."""
    channel = np.arange(3, dtype=np.float64)
    return (channel * channel - 2 * channel + 4 + (channel - 1) * (-1) ** index) / 4


def build_starfield(x: ArrayLike, y: ArrayLike,
                    config: StarConfig = StarConfig()) -> FloatArray:
    """T_v: sum all colored lattices into an unclipped RGB emission field."""
    x, y = coordinate_arrays(x, y)
    rgb = np.zeros(x.shape + (3,), dtype=np.float64)
    for index in range(1, config.bands + 1):
        m, n = star_lattice(x, y, index, config)
        center, halo = star_kernel(m, n, index)
        rgb += (center + halo)[..., None] * star_color(index)
    return rgb
