"""Replace the entire shell geometry while retaining the cloud shader.

Run: python -m examples.custom_ring --width 1000
The replacement supplies a coordinate warp and a rim envelope, not a mesh.
"""
from dataclasses import replace
import argparse
import numpy as np

from nebula import GeometryFields, SceneConfig, build_starfield, evaluate_nebula, render, save_png, soft_cutoff
from nebula.composition import add_emission

# The replacement rim is stronger than the original A, so lower the gain
# to show texture rather than clipping the whole ring to white.
CONFIG = replace(SceneConfig(), core_gain=0, gas_gain=0.16, gas_tint=(0.35, 1.1, 1.5))


def ring_geometry(x, y):
    radius = np.hypot(x / 1.45, y / 0.82)
    residual = radius - 1.0  # Negative inside an ellipse; not Euclidean distance.
    rim = 0.25 * np.exp(-(residual / 0.12) ** 2)
    return GeometryFields(
        warp=2.0 * residual,
        rim=rim,
        coverage=soft_cutoff(20.0 * residual),  # Optional diagnostic information.
    )


def shader(x, y):
    ring = evaluate_nebula(x, y, CONFIG, geometry=ring_geometry(x, y))
    return add_emission(ring.gas, 0.65 * build_starfield(x, y))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=int, default=1000)
    parser.add_argument("--output", default="output/custom_ring.png")
    args = parser.parse_args()
    save_png(args.output, render(shader, width=args.width, height=max(1, round(0.6 * args.width))))
    print(f"Saved {args.output}")
