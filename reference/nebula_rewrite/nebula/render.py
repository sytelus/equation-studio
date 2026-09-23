"""Tiled CPU rendering, independent of the scene being sampled."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable
import math

import numpy as np
from PIL import Image
from numpy.typing import NDArray

from .numeric import FloatArray, to_rgb8

Shader = Callable[[FloatArray, FloatArray], FloatArray]
Progress = Callable[[int, int], None]


@dataclass(frozen=True)
class Viewport:
    """World-space rectangle sampled at pixel centers.

    The tiny center offset is intentional: the source numbers pixels from 1
    and uses (m-1000)/420, (601-n)/420. At 2000x1200 these settings reproduce
    that grid, including the upward-positive y direction.
    """
    center_x: float = 0.5 / 420
    center_y: float = 0.5 / 420
    span_x: float = 2000 / 420
    span_y: float = 1200 / 420

    def __post_init__(self) -> None:
        if not all(math.isfinite(v) for v in (self.center_x, self.center_y, self.span_x, self.span_y)):
            raise ValueError("Viewport values must be finite.")
        if self.span_x <= 0 or self.span_y <= 0:
            raise ValueError("Viewport spans must be positive.")


def _positive_int(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer.")


def sample_coordinates(width: int, height: int, *, start_row: int = 0,
                       row_count: int | None = None,
                       viewport: Viewport = Viewport()) -> tuple[FloatArray, FloatArray]:
    """Sample a tile without allocating the full image's coordinate arrays."""
    _positive_int("width", width)
    _positive_int("height", height)
    if isinstance(start_row, bool) or not isinstance(start_row, int) or not 0 <= start_row < height:
        raise ValueError("start_row must be an integer within the image.")
    if row_count is None:
        row_count = height - start_row
    _positive_int("row_count", row_count)
    if start_row + row_count > height:
        raise ValueError("Tile extends past the bottom of the image.")
    # Keep the source's arithmetic order at native resolution. This reduces
    # last-bit phase changes in the highest-frequency texture terms.
    source_m = (np.arange(width, dtype=np.float64) + 0.5) * (2000.0 / width) + 0.5
    source_n = (np.arange(start_row, start_row + row_count, dtype=np.float64) + 0.5) * (1200.0 / height) + 0.5
    if viewport == Viewport():
        x = (source_m - 1000.0) / 420.0
        y = (601.0 - source_n) / 420.0
    else:
        x = viewport.center_x + ((source_m - 0.5) / 2000.0 - 0.5) * viewport.span_x
        y = viewport.center_y - ((source_n - 0.5) / 1200.0 - 0.5) * viewport.span_y
    return np.meshgrid(x, y)


def render(shader: Shader, *, width: int = 2000, height: int = 1200, tile_rows: int = 48,
           supersample: int = 1, viewport: Viewport = Viewport(),
           progress: Progress | None = None) -> NDArray[np.uint8]:
    """Render an arbitrary callable returning unclipped RGB radiance.

    Main working memory is proportional to width*tile_rows*supersample**2,
    rather than width*height times every intermediate field. The returned
    8-bit image still requires width*height*3 bytes.

    Supersampling averages radiance BEFORE the printed display transfer F.
    It reduces aliasing but changes the source sampling; use supersample=1
    at 2000x1200 for the default reconstruction.
    """
    for name, value in (("width", width), ("height", height), ("tile_rows", tile_rows), ("supersample", supersample)):
        _positive_int(name, value)
    pixels = np.empty((height, width, 3), dtype=np.uint8)
    for first_row in range(0, height, tile_rows):
        rows = min(tile_rows, height - first_row)
        x, y = sample_coordinates(
            width * supersample, height * supersample,
            start_row=first_row * supersample, row_count=rows * supersample, viewport=viewport,
        )
        rgb = np.asarray(shader(x, y), dtype=np.float64)
        expected = (rows * supersample, width * supersample, 3)
        if rgb.shape != expected:
            raise ValueError(f"Shader returned {rgb.shape}; expected {expected}.")
        if not np.isfinite(rgb).all():
            raise ValueError("Shader returned non-finite radiance.")
        if supersample > 1:
            samples = rgb.reshape(rows, supersample, width, supersample, 3)
            baseline = samples[:, :1, :, :1, :]
            # A shifted mean preserves a constant field exactly, avoiding a
            # one-byte change when rounding error meets F's floor boundary.
            rgb = baseline[:, 0, :, 0, :] + (samples - baseline).mean(axis=(1, 3))
        pixels[first_row:first_row + rows] = to_rgb8(rgb)
        if progress:
            progress(first_row + rows, height)
    return pixels


def save_png(path: str | Path, pixels: NDArray[np.uint8]) -> None:
    """Write an RGB PNG, creating parent directories and rejecting bad arrays."""
    path = Path(path)
    if path.suffix.lower() != ".png":
        raise ValueError("Use a .png output path; lossy JPEG is not used for validation.")
    if pixels.ndim != 3 or pixels.shape[-1] != 3 or pixels.dtype != np.uint8:
        raise ValueError("Expected a uint8 array of shape (height, width, 3).")
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(path)
