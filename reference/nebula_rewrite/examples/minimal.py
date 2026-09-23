"""Smallest complete reconstruction: python -m examples.minimal."""
from nebula import evaluate_scene, render, save_png


def shader(x, y):
    # These are unclipped floating-point RGB fields, not PNG images.
    scene = evaluate_scene(x, y)
    return scene.gas + scene.core + scene.stars


if __name__ == "__main__":
    pixels = render(shader, width=1000, height=600)
    save_png("output/minimal.png", pixels)
    print("Saved output/minimal.png")
