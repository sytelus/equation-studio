"""Measure, without promising pixel identity, a render against the supplied JPEG.

Example (the source JPEG is not bundled):
python -m tools.compare_reference --reference path/to/supplied.jpg \
    --render gallery/reconstruction_2000x1200.png --crop-height 922 \
    --output docs/IMAGE_COMPARISON.json

The default crop applies to the 1536x1536 source uploaded in this conversation:
rows 0..921 hold the artwork, and the white caption starts at row 922.
Resampling methods are all reported; the script does not optimize alignment,
color transforms, cropping offsets, or a metric to make the result look better.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def compare(reference: Path, rendered: Path, crop_height: int) -> dict:
    with Image.open(reference) as source:
        if not 1 <= crop_height <= source.height:
            raise ValueError("Crop height must lie within the source image.")
        source_size = source.size
        crop = source.convert("RGB").crop((0, 0, source.width, crop_height))
    target = np.asarray(crop, dtype=np.float64)
    results = {}
    with Image.open(rendered) as image:
        render_size = image.size
        for name in ("NEAREST", "BILINEAR", "BICUBIC", "LANCZOS"):
            candidate = np.asarray(image.convert("RGB").resize(crop.size, getattr(Image.Resampling, name)), dtype=np.float64)
            error = candidate - target
            mse = float(np.mean(error ** 2))
            results[name.lower()] = {
                "mean_absolute_error_0_to_255": float(np.mean(np.abs(error))),
                "root_mean_square_error_0_to_255": float(np.sqrt(mse)),
                "flattened_RGB_Pearson_correlation": float(np.corrcoef(candidate.ravel(), target.ravel())[0, 1]),
                "PSNR_dB": None if mse == 0 else float(10 * np.log10(255 ** 2 / mse)),
            }
    return {
        "reference_sha256": hashlib.sha256(reference.read_bytes()).hexdigest(),
        "render_sha256": hashlib.sha256(rendered.read_bytes()).hexdigest(),
        "source_size": source_size, "render_size": render_size,
        "crop_box_left_top_right_bottom_exclusive": [0, 0, source_size[0], crop_height],
        "resampling_results": results,
        "interpretation": "Similarity measurements only. The supplied image is resized/JPEG-compressed; its original conversion pipeline is unknown. No pixel-identity claim.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--render", type=Path, required=True)
    parser.add_argument("--crop-height", type=int, default=922)
    parser.add_argument("--output", type=Path, default=Path("output/comparison.json"))
    args = parser.parse_args()
    report = compare(args.reference, args.render, args.crop_height)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
