"""The readable top-level reconstruction of the printed H_v expression."""
from __future__ import annotations
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from .composition import add_emission, colorize, mask_emission, tint
from .config import SceneConfig
from .geometry import GeometryFields, build_geometry
from .numeric import FloatArray, coordinate_arrays, soft_cutoff
from .stars import build_starfield
from .textures import build_cloud_color, build_turbulence


@dataclass(frozen=True)
class NebulaFields:
    """Named intermediate fields, deliberately exposed for inspection/reuse."""
    geometry: GeometryFields
    turbulence: FloatArray
    cloud_color: FloatArray
    core_mask: FloatArray
    gas: FloatArray
    core: FloatArray


@dataclass(frozen=True)
class SceneFields:
    """Three composable emission layers and their generating intermediates."""
    nebula: NebulaFields
    stars: FloatArray

    @property
    def gas(self) -> FloatArray:
        return self.nebula.gas

    @property
    def core(self) -> FloatArray:
        return self.nebula.core

    def composite(self) -> FloatArray:
        """H = gas + core + stars, before F converts it to byte colors."""
        return add_emission(self.gas, self.core, self.stars)


def evaluate_nebula(x: ArrayLike, y: ArrayLike, config: SceneConfig = SceneConfig(), *,
                    geometry: GeometryFields | None = None) -> NebulaFields:
    """Build gas and central glow, optionally using a caller-supplied structure.

    A replacement GeometryFields must supply the same-shaped ``warp``, ``rim``,
    and diagnostic ``coverage`` arrays. The cloud and star algorithms do not
    require the original lobes. See examples/custom_ring.py for a replacement.
    """
    x, y = coordinate_arrays(x, y)
    if geometry is None:
        geometry = build_geometry(x, y, config.shells)
    for name in ("warp", "rim", "coverage"):
        value = np.asarray(getattr(geometry, name))
        if value.shape != x.shape or not np.isfinite(value).all():
            raise ValueError(f"Geometry {name} must be finite and have shape {x.shape}.")

    turbulence = build_turbulence(x, y, geometry.warp, config.texture)
    cloud_color = build_cloud_color(x, y, geometry, turbulence, config.texture)

    # W clears the gas near the origin and contributes a separate bright core.
    core_mask = soft_cutoff(
        config.core_sharpness * np.hypot(x, y)
        - config.core_bias + config.core_turbulence * turbulence
    )
    gas_envelope = config.gas_gain * (1.0 - core_mask) * geometry.rim
    gas = tint(mask_emission(cloud_color, gas_envelope), config.gas_tint)
    core = config.core_gain * colorize(core_mask, config.core_color)
    return NebulaFields(geometry, turbulence, cloud_color, core_mask, gas, core)


def evaluate_scene(x: ArrayLike, y: ArrayLike, config: SceneConfig = SceneConfig()) -> SceneFields:
    """Compute all source fields once and keep emission layers separate.

    Even a zero gas/core gain retains intermediate fields for diagnostics.
    Star evaluation is skipped when its gain is zero; no other layer uses T.
    """
    x, y = coordinate_arrays(x, y)
    nebula = evaluate_nebula(x, y, config)
    stars = np.zeros(x.shape + (3,), dtype=np.float64)
    if config.star_gain != 0:
        stars = config.star_gain * tint(build_starfield(x, y, config.stars), config.star_tint)
    return SceneFields(nebula, stars)
