"""Typed artistic controls. Defaults transcribe the supplied artwork.

Only useful editing controls are exposed here. The trigonometric phase recipes
remain beside their implementations, rather than becoming dozens of opaque
configuration entries. Dataclasses are immutable: use dataclasses.replace.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
import math

RGB = tuple[float, float, float]


def _finite_nonnegative(name: str, value: float, *, positive: bool = False) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number.")
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise ValueError(f"{name} must be finite and {'positive' if positive else 'nonnegative'}.")


def _count(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100:
        raise ValueError(f"{name} must be an integer from 1 to 100.")


def _color(name: str, value: RGB) -> None:
    if len(value) != 3:
        raise ValueError(f"{name} must have exactly three components.")
    for component in value:
        _finite_nonnegative(name, component)


@dataclass(frozen=True)
class ShellConfig:
    """Geometry controls: shape of the paired lobes and their glowing rims."""
    count: int = 27
    radius_step: float = 0.1
    radius_wobble: float = 0.06
    shear: float = 0.15
    shear_wobble: float = 0.2
    neck_offset: float = 1e-4
    pinch_power: float = 0.3
    cross_scale: float = 2.0
    edge_sharpness: float = 10.0
    fade_center: float = 23.0
    fade_rate: float = 0.15
    interior_falloff: float = 3.0

    def __post_init__(self) -> None:
        _count("shell count", self.count)
        for name in ("radius_step", "cross_scale", "edge_sharpness", "interior_falloff"):
            _finite_nonnegative(name, getattr(self, name), positive=True)
        for name in ("radius_wobble", "shear_wobble", "pinch_power", "fade_rate"):
            _finite_nonnegative(name, getattr(self, name))
        if self.radius_wobble >= self.radius_step:
            raise ValueError("radius_wobble must be less than radius_step, ensuring positive radii.")
        if not 0 <= self.pinch_power <= 1:
            raise ValueError("pinch_power must be between 0 and 1.")
        for name in ("shear", "neck_offset", "fade_center"):
            if not math.isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite.")


@dataclass(frozen=True)
class TextureConfig:
    """Multiscale detail. Reducing counts changes the artwork, not just speed."""
    turbulence_bands: int = 50
    turbulence_frequency_ratio: float = 1.25
    turbulence_decay: float = 0.95
    filament_bands: int = 50
    filament_frequency_ratio: float = 1.15
    filament_decay: float = 0.95

    def __post_init__(self) -> None:
        _count("turbulence_bands", self.turbulence_bands)
        _count("filament_bands", self.filament_bands)
        for name in ("turbulence_frequency_ratio", "filament_frequency_ratio"):
            if not 1 <= getattr(self, name) <= 2:
                raise ValueError(f"{name} must be between 1 and 2.")
        for name in ("turbulence_decay", "filament_decay"):
            if not 0 < getattr(self, name) <= 1:
                raise ValueError(f"{name} must be in (0, 1].")


@dataclass(frozen=True)
class StarConfig:
    """Thirty superposed folded lattices, not thirty individual stars."""
    bands: int = 30
    frequency_ratio: float = 1.2
    frequency_scale: float = 2.0

    def __post_init__(self) -> None:
        _count("star bands", self.bands)
        if not 1 <= self.frequency_ratio <= 2:
            raise ValueError("frequency_ratio must be between 1 and 2.")
        _finite_nonnegative("frequency_scale", self.frequency_scale, positive=True)


@dataclass(frozen=True)
class SceneConfig:
    """Independent emission layers, combined before the display conversion."""
    shells: ShellConfig = field(default_factory=ShellConfig)
    texture: TextureConfig = field(default_factory=TextureConfig)
    stars: StarConfig = field(default_factory=StarConfig)
    gas_gain: float = 1.1
    core_gain: float = 1.0
    star_gain: float = 1.0
    gas_tint: RGB = (1.0, 1.0, 1.0)
    core_color: RGB = (2.0, 2.0, 3.0)
    star_tint: RGB = (1.0, 1.0, 1.0)
    core_sharpness: float = 10.0
    core_bias: float = 1.0
    core_turbulence: float = 0.25

    def __post_init__(self) -> None:
        for name in ("gas_gain", "core_gain", "star_gain", "core_turbulence"):
            _finite_nonnegative(name, getattr(self, name))
        _finite_nonnegative("core_sharpness", self.core_sharpness, positive=True)
        if not math.isfinite(self.core_bias):
            raise ValueError("core_bias must be finite.")
        for name in ("gas_tint", "core_color", "star_tint"):
            _color(name, getattr(self, name))
        for name, kind in (("shells", ShellConfig), ("texture", TextureConfig), ("stars", StarConfig)):
            if not isinstance(getattr(self, name), kind):
                raise ValueError(f"{name} must be a {kind.__name__}.")


def config_as_dict(config: SceneConfig) -> dict:
    """JSON-compatible configuration for a render's provenance sidecar."""
    if not isinstance(config, SceneConfig):
        raise TypeError("Expected a SceneConfig.")
    return asdict(config)
