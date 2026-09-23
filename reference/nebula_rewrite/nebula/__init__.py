"""A composable reconstruction of Hamid Naderi Yeganeh's Bipolar Nebula.

Start with evaluate_scene for the artwork, evaluate_nebula for reusable gas,
GeometryFields for a replacement structure, and build_starfield for stars.
"""
from .config import SceneConfig, ShellConfig, StarConfig, TextureConfig
from .geometry import GeometryFields, build_geometry, shell_residual
from .numeric import soft_cutoff, to_rgb8
from .render import Viewport, render, sample_coordinates, save_png
from .scene import evaluate_nebula, evaluate_scene
from .stars import build_starfield

__version__ = "1.0.0"
__all__ = ["SceneConfig", "ShellConfig", "StarConfig", "TextureConfig", "GeometryFields",
           "build_geometry", "shell_residual", "soft_cutoff", "to_rgb8", "Viewport",
           "render", "sample_coordinates", "save_png", "evaluate_nebula", "evaluate_scene", "build_starfield"]
