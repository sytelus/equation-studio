"""Export true layer sums and explicitly normalized diagnostic visualizations."""
from __future__ import annotations
from pathlib import Path
import json
import html

import numpy as np

from .config import SceneConfig
from .numeric import to_rgb8
from .render import sample_coordinates, save_png
from .scene import evaluate_scene


DESCRIPTIONS = {
    "rim": ("A: glowing shell envelope", "Shown as 4*A in grayscale. Dark interiors and bright rims shape the lobes. This is an envelope, not an RGB layer."),
    "warp": ("S: shell-following texture coordinate", "Signed field centered on middle gray. The texture reads this as a coordinate; it is not emitted light."),
    "turbulence": ("E: multiscale modulation", "Signed field centered on middle gray. This changes both filament thresholds and the central-glow boundary."),
    "cloud": ("K: unmasked cloud color", "Displayed at 0.05 times its raw intensity so its detail is visible. The final gas also multiplies K by 1.1*(1-W)*A."),
    "core_mask": ("W: central-glow mask", "Raw [0,1] values shown as grayscale. W adds the core; 1-W simultaneously removes gas from the same area."),
    "coverage": ("Diagnostic shell coverage", "1-product(1-J_s), shown in grayscale. Not used directly as a source emission mask; replacing A with it fills in the shells."),
}


def make_atlas(output_dir: str | Path, *, width: int = 800, height: int = 480,
               tile_rows: int = 48, save_fields: bool = False) -> dict:
    """Save eight exact layer combinations, diagnostics, and a local HTML viewer.

    Unlike render(), the atlas retains intermediate arrays for inspection;
    it is intended for moderate sizes. Optional .npz contains raw float64
    fields for Python reuse, not the normalized PNG diagnostic values.
    """
    if isinstance(tile_rows, bool) or not isinstance(tile_rows, int) or tile_rows <= 0:
        raise ValueError("tile_rows must be a positive integer.")
    # Validate dimensions before allocating output arrays.
    sample_coordinates(width, height, row_count=1)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    components = {name: np.empty((height, width, 3), dtype=np.float64) for name in ("gas", "core", "stars", "cloud")}
    components.update({name: np.empty((height, width), dtype=np.float64) for name in ("rim", "warp", "turbulence", "core_mask", "coverage")})
    for first in range(0, height, tile_rows):
        rows = min(tile_rows, height - first)
        x, y = sample_coordinates(width, height, start_row=first, row_count=rows)
        fields = evaluate_scene(x, y, SceneConfig())
        tile = {
            "gas": fields.gas, "core": fields.core, "stars": fields.stars,
            "cloud": fields.nebula.cloud_color,
            "rim": fields.nebula.geometry.rim, "warp": fields.nebula.geometry.warp,
            "turbulence": fields.nebula.turbulence, "core_mask": fields.nebula.core_mask,
            "coverage": fields.nebula.geometry.coverage,
        }
        for name, array in tile.items():
            components[name][first:first + rows] = array

    # Every combination is re-summed in float64 BEFORE F. Adding already
    # clipped PNG layers in the browser would not reconstruct the source.
    for gas_on in (0, 1):
        for core_on in (0, 1):
            for stars_on in (0, 1):
                rgb = gas_on * components["gas"] + core_on * components["core"] + stars_on * components["stars"]
                save_png(output_dir / f"composite_{gas_on}{core_on}{stars_on}.png", to_rgb8(rgb))

    normalizations = {}
    for name in DESCRIPTIONS:
        array = components[name]
        if name == "cloud":
            pixels = to_rgb8(0.05 * array)
            normalizations[name] = {"gain": 0.05, "transfer": "source F"}
        else:
            if name == "rim":
                display = 4 * array
                normalizations[name] = {"gain": 4, "offset": 0}
            elif name in ("warp", "turbulence"):
                bound = max(float(np.max(np.abs(array))), 1e-12)
                display = 0.5 + 0.5 * array / bound
                normalizations[name] = {"gain": 0.5 / bound, "offset": 0.5}
            else:
                display = array
                normalizations[name] = {"gain": 1, "offset": 0}
            gray = np.rint(255 * np.clip(display, 0, 1)).astype(np.uint8)
            pixels = np.repeat(gray[..., None], 3, axis=-1)
        save_png(output_dir / f"diagnostic_{name}.png", pixels)

    metadata = {"width": width, "height": height, "supersample": 1,
                "diagnostic_normalizations": normalizations,
                "stats": {name: {"min": float(a.min()), "max": float(a.max()), "mean": float(a.mean())}
                          for name, a in components.items()}}
    (output_dir / "atlas.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    if save_fields:
        np.savez_compressed(output_dir / "fields.npz", **components)
    cards = "\n".join(
        f'<article><h3>{html.escape(title)}</h3><img loading="lazy" src="diagnostic_{name}.png" alt="{html.escape(title)}"><p>{html.escape(description)}</p></article>'
        for name, (title, description) in DESCRIPTIONS.items()
    )
    page = HTML.replace("<!--CARDS-->", cards)
    (output_dir / "index.html").write_text(page, encoding="utf-8")
    return metadata


HTML = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bipolar Nebula — a field-by-field explanation</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0e1018;color:#ececf3;font:16px/1.65 system-ui,sans-serif}
main{max-width:1200px;margin:auto;padding:32px 24px 80px}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.12;margin:10px 0 20px}
.kicker{color:#d9acd7;letter-spacing:.14em;text-transform:uppercase;font-size:.8rem}p{max-width:85ch;color:#bfc5d5}
a{color:#e0b4df}code{background:#25293a;padding:.15em .35em;border-radius:4px}section{margin:40px 0}
.controls{display:flex;gap:24px;flex-wrap:wrap;background:#202433;padding:16px 20px;border-radius:10px;margin:20px 0}
label{cursor:pointer}input{accent-color:#d091c9}.frame{overflow:auto;border:1px solid #32394d;background:black;border-radius:10px}
#composite{display:block;width:100%;max-width:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}
article{padding:20px;background:#191d2a;border-radius:12px}article img{width:100%;display:block}article p{font-size:.92rem}h3{margin-top:0}
.small{font-size:.85rem}footer{border-top:1px solid #34384b;padding-top:20px;color:#bfc5d5}
</style></head><body><main>
<div class="kicker">From equations to reusable graphics</div>
<h1>Bipolar Nebula,<br>taken apart.</h1>
<p>A reconstruction of the mathematical artwork credited in the supplied image to <strong>Hamid Naderi Yeganeh</strong>.
Everything here was computed from the printed equations. No source-photo pixels, star catalog, random noise image, or 3-D scene are sampled.</p>
<p>Read the project’s <code>README.html</code> and <code>docs/WALKTHROUGH.html</code> (or their Markdown versions) for the code and full explanation.
The controls below use bundled PNGs and work offline, including through a <code>file:</code> URL.</p>
<section><h2>The three visible contributions</h2>
<div class="controls"><label><input id="gas" type="checkbox" checked> Gas and filaments</label>
<label><input id="core" type="checkbox" checked> Central glow</label>
<label><input id="stars" type="checkbox" checked> Stars</label>
<label>Zoom <input id="zoom" type="range" min="100" max="250" value="100"> <span id="zoomlabel">100%</span></label></div>
<div class="frame"><img id="composite" src="composite_111.png" alt="Selected nebula layers"></div>
<p id="caption">Gas + central glow + stars</p>
<p class="small">Each of the eight combinations was added in floating-point radiance before the original display conversion F.
These controls switch pre-rendered combinations; they do not re-run the shader in JavaScript or incorrectly add clipped images.
Turning off the core does not restore the gas suppressed by 1-W.</p></section>
<section><h2>The fields underneath</h2><p>These are explanatory visualizations, not additional independent emission layers.
Signed fields and unmasked cloud intensity need different display scales. Exact normalizations and numerical ranges are recorded in <a href="atlas.json">atlas.json</a>.</p>
<div class="grid"><!--CARDS--></div></section>
<section><h2>Try a new composition</h2><p>Run <code>python -m examples.twin_nebulae</code> to place two independently transformed gas structures over one shared star field.
Run <code>python -m examples.custom_ring</code> to replace the lobes with an elliptical ring while keeping the cloud shader.
The source code is the editable model; this gallery is its visual explanation.</p></section>
<footer>Original artistic formula: Hamid Naderi Yeganeh. Semantic labels are an interpretation of the formulas and their isolated renders, not quotations of the artist's intent.
See the project’s <code>ATTRIBUTION.md</code> for attribution and scope.</footer></main>
<script>
const ids=['gas','core','stars'];
function update(){const states=ids.map(id=>document.getElementById(id).checked);document.getElementById('composite').src='composite_'+states.map(Number).join('')+'.png';
const names=['Gas','central glow','stars'];document.getElementById('caption').textContent=names.filter((_,i)=>states[i]).join(' + ')||'No emission layers';}
ids.forEach(id=>document.getElementById(id).addEventListener('change',update));
document.getElementById('zoom').addEventListener('input',e=>{document.getElementById('composite').style.width=e.target.value+'%';document.getElementById('zoomlabel').textContent=e.target.value+'%';});
update();
</script></body></html>'''
