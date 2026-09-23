"""Small, readable examples of config changes, not alternative formula paths."""
from dataclasses import replace
from .config import SceneConfig

PRESET_NAMES = ("original", "gas-only", "stars-only", "blue", "wide")


def preset(name: str) -> SceneConfig:
    source = SceneConfig()
    if name == "original":
        return source
    if name == "gas-only":
        return replace(source, core_gain=0, star_gain=0)
    if name == "stars-only":
        return replace(source, gas_gain=0, core_gain=0)
    if name == "blue":
        return replace(source, gas_tint=(0.35, 1.05, 1.7), core_color=(1.3, 2.1, 3.5))
    if name == "wide":
        shells = replace(source.shells, pinch_power=0.18, cross_scale=1.4)
        return replace(source, shells=shells)
    raise ValueError(f"Unknown preset {name!r}; choose from {', '.join(PRESET_NAMES)}.")
