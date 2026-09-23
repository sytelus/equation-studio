"""Deterministic, multiscale cloud texture built only from trigonometry.

'Band' means one term in a finite sum, not an iteration of a simulation.
The source has no random generator, noise image, or physical gas solver.
"""
from __future__ import annotations

import numpy as np

from .config import TextureConfig
from .geometry import GeometryFields
from .numeric import FloatArray, rotated_coordinates, soft_cutoff


def turbulence_band(x: FloatArray, y: FloatArray, warp: FloatArray, index: int,
                    config: TextureConfig = TextureConfig()) -> FloatArray:
    """D_s: product of two cosines with nested, wavy phase distortions.

    Use the shell warp S as one texture coordinate and Q_s as the other.
    Inner cosines bend otherwise regular outer cosine bands. Different
    index-dependent orientations break obvious grid alignment.
    """
    q, _ = rotated_coordinates(x, y, 15 * index * index)
    frequency = config.turbulence_frequency_ratio ** index

    # Parentheses matter: 2*cos(17*s) and 2*cos(15*s) are INSIDE
    # the frequency scaling; 2*cos(5*s) and 2*cos(7*s) are OUTSIDE
    # the bending cosines. Moving them creates a noticeably different nebula.
    bend_u = 4 * np.cos(
        frequency * (np.cos(4 * index) * warp + np.sin(4 * index) * q)
    )
    bend_v = 4 * np.cos(
        frequency * (np.cos(8 * index) * warp + np.sin(8 * index) * q)
    )
    phase_u = (
        frequency * (np.cos(7 * index) * warp + np.sin(7 * index) * q + 2 * np.cos(17 * index))
        + bend_u + 2 * np.cos(5 * index)
    )
    phase_v = (
        frequency * (np.cos(7 * index) * q - np.sin(7 * index) * warp + 2 * np.cos(15 * index))
        + bend_v + 2 * np.cos(7 * index)
    )
    return np.cos(phase_u) * np.cos(phase_v)


def build_turbulence(x: FloatArray, y: FloatArray, warp: FloatArray,
                     config: TextureConfig = TextureConfig()) -> FloatArray:
    """E: weighted sum of D_s, with increasing frequency and fading weight.

    E is a signed scalar modulation, not a displayable emission layer.
    It subsequently perturbs the filament threshold AND the core's boundary.
    """
    result = np.zeros_like(x)
    for index in range(1, config.turbulence_bands + 1):
        result += config.turbulence_decay ** index * turbulence_band(x, y, warp, index, config)
    return result


def filament_intensity(x: FloatArray, y: FloatArray, geometry: GeometryFields,
                       turbulence: FloatArray, index: int,
                       config: TextureConfig = TextureConfig()) -> FloatArray:
    """I_s = 45*C_(1,s) + 6*C_(0,s): sharp filaments plus softer haze.

    C's first index selects threshold sharpness, NOT an RGB channel. Both
    versions share the same cosine cell pattern. Geometry and turbulence
    displace its threshold so luminous material follows the shell contours.
    """
    angle = 15 * index * index
    q, _ = rotated_coordinates(x, y, angle)
    u, v = rotated_coordinates(geometry.warp, q, angle)
    frequency = 0.2 * config.filament_frequency_ratio ** index
    cells = (
        np.cos(frequency * u + 2 * np.cos(27 * index * index))
        * np.cos(frequency * v + 2 * np.cos(28 * index * index))
    )
    threshold = cells - 1.25 + 2 * geometry.rim + turbulence / 7
    sharp_filaments = soft_cutoff(-4.0 * threshold)
    soft_haze = soft_cutoff(-0.25 * threshold)
    return 45.0 * sharp_filaments + 6.0 * soft_haze


def filament_color(index: int) -> FloatArray:
    """The original three K_v coefficients for one texture band.

    v=0,1,2 means red, green, blue. Coefficients are intentionally NOT clamped:
    a few blue coefficients are slightly negative in the printed recipe.
    Their contribution is preserved until the final display conversion.
    """
    channel = np.arange(3, dtype=np.float64)
    phase = index * index
    return (
        12 - 4 * channel + channel * channel
        + (channel - 1) * np.cos(2 * phase)
        + 8 * np.cos((7 + channel) * phase)
    ) / 50.0


def build_cloud_color(x: FloatArray, y: FloatArray, geometry: GeometryFields,
                      turbulence: FloatArray,
                      config: TextureConfig = TextureConfig()) -> FloatArray:
    """K_v: colored detail before the rim envelope and core cutout are applied."""
    rgb = np.zeros(x.shape + (3,), dtype=np.float64)
    for index in range(1, config.filament_bands + 1):
        intensity = filament_intensity(x, y, geometry, turbulence, index, config)
        color = config.filament_decay ** index * filament_color(index)
        rgb += intensity[..., None] * color
    return rgb
