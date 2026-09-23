"""Reuse two transformed nebulae over one star field.

Run: python -m examples.twin_nebulae --width 1000
This is a NEW composition, not an attempted reconstruction of the source.
"""
from dataclasses import replace
import argparse

from nebula import SceneConfig, build_starfield, evaluate_nebula, render, save_png
from nebula.composition import add_emission, transform_coordinates

WARM = replace(SceneConfig(), gas_tint=(1.3, 0.65, 0.7), core_color=(3.0, 2.0, 1.5))
COOL = replace(SceneConfig(), gas_tint=(0.35, 1.1, 1.7), core_color=(1.4, 2.0, 3.0))


def shader(x, y):
    left_x, left_y = transform_coordinates(x, y, center=(-1.0, 0.3), angle=0.35, scale=0.52)
    right_x, right_y = transform_coordinates(x, y, center=(1.0, -0.35), angle=-0.45, scale=0.52)
    left = evaluate_nebula(left_x, left_y, WARM)
    right = evaluate_nebula(right_x, right_y, COOL)

    # Stars belong to the overall scene; do not stamp a duplicate star field
    # inside each object. Nothing is tone-mapped until render() finishes.
    stars = 0.7 * build_starfield(x, y)
    return add_emission(0.8 * left.gas, 0.8 * left.core, 0.8 * right.gas, 0.8 * right.core, stars)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=int, default=1000)
    parser.add_argument("--output", default="output/twin_nebulae.png")
    args = parser.parse_args()
    save_png(args.output, render(shader, width=args.width, height=max(1, round(0.6 * args.width))))
    print(f"Saved {args.output}")
