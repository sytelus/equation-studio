"""Command-line entry point; run ``python -m nebula --help``."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import platform
import sys
from time import perf_counter

import numpy as np
import PIL

from . import __version__
from .atlas import make_atlas
from .config import config_as_dict
from .presets import PRESET_NAMES, preset
from .render import render, save_png
from .scene import evaluate_scene
from .stars import build_starfield


def positive_int(text: str) -> int:
    value = int(text)
    if value <= 0:
        raise argparse.ArgumentTypeError("value must be a positive integer")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconstruct and dissect the supplied Bipolar Nebula formula.")
    sub = parser.add_subparsers(dest="command", required=True)
    image = sub.add_parser("render", help="render an RGB PNG")
    image.add_argument("--output", type=Path, default=Path("output/nebula.png"))
    image.add_argument("--width", type=positive_int, default=2000)
    image.add_argument("--height", type=positive_int, help="defaults to 3/5 of width")
    image.add_argument("--tile-rows", type=positive_int, default=48)
    image.add_argument("--supersample", type=positive_int, default=1)
    image.add_argument("--preset", choices=PRESET_NAMES, default="original")
    image.add_argument("--quiet", action="store_true")
    atlas = sub.add_parser("atlas", help="export layers, diagnostic fields, and an offline HTML viewer")
    atlas.add_argument("--output-dir", type=Path, default=Path("output/atlas"))
    atlas.add_argument("--width", type=positive_int, default=800)
    atlas.add_argument("--height", type=positive_int)
    atlas.add_argument("--tile-rows", type=positive_int, default=48)
    atlas.add_argument("--save-fields", action="store_true", help="also write raw float64 fields.npz")
    args = parser.parse_args(argv)
    height = args.height if args.height is not None else max(1, round(args.width * 3 / 5))
    start = perf_counter()
    try:
        if args.command == "atlas":
            make_atlas(args.output_dir, width=args.width, height=height,
                       tile_rows=args.tile_rows, save_fields=args.save_fields)
            print(f"Gallery: {args.output_dir / 'index.html'} ({perf_counter() - start:.2f}s)")
            return 0
        config = preset(args.preset)
        if args.output.suffix.lower() != ".png":
            parser.error("--output must end in .png")

        # Bypass the unused nebula computation for this dedicated preset.
        shader = (lambda x, y: build_starfield(x, y, config.stars)) if args.preset == "stars-only" else (
            lambda x, y: evaluate_scene(x, y, config).composite()
        )
        def progress(done: int, total: int) -> None:
            if not args.quiet:
                print(f"\rRendering {done}/{total} rows", end="", file=sys.stderr, flush=True)

        pixels = render(shader, width=args.width, height=height, tile_rows=args.tile_rows,
                        supersample=args.supersample, progress=progress)
        save_png(args.output, pixels)
        elapsed = perf_counter() - start
        metadata = {
            "package_version": __version__, "width": args.width, "height": height,
            "supersample": args.supersample, "tile_rows": args.tile_rows, "preset": args.preset,
            "seconds_including_png_write": elapsed, "config": config_as_dict(config),
            "python": platform.python_version(), "numpy": np.__version__, "pillow": PIL.__version__,
            "source": "User-supplied Bipolar Nebula formula, credited to Hamid Naderi Yeganeh",
            "source_grid": "2000x1200, one sample/pixel; other sizes or supersampling change sampling",
        }
        args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        if not args.quiet:
            print(file=sys.stderr)
        print(f"Saved {args.output} ({args.width}x{height}, {elapsed:.2f}s)")
        return 0
    except (ValueError, OSError, MemoryError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
