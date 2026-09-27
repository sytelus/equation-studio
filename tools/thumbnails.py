#!/usr/bin/env python3
"""Embed small navigation thumbnails from the app's own rendered preset gallery.
Requires Pillow only for regeneration. These are never inputs to the renderer.
Run GPU validation to regenerate the corresponding gallery PNGs first.
"""
from pathlib import Path
from io import BytesIO
import base64
import json
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
import re
# The original constructions, then every work of src/works.js (its scene has the work's id).
IDS = ('bipolar','water','lensing','aurora','tidal','peacock','fire','hedgehog','ring','marble','kaleidoscope','feather') + tuple(re.findall(r"^        id: '([\w-]+)',", (ROOT/'src'/'works.js').read_text(encoding='utf-8'), re.M))
thumbs = {}
for name in IDS:
    with Image.open(ROOT/'gallery'/f'{name}.png') as image:
        # 240 pixels wide in the scene's own aspect ratio (cards crop to fit).
        image = image.convert('RGB')
        image = image.resize((240, round(240 * image.height / image.width)), Image.Resampling.LANCZOS)
        data = BytesIO(); image.save(data,format='JPEG',quality=82,optimize=True)
        thumbs[name] = 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode('ascii')
(ROOT/'src'/'thumbnails.js').write_text('/** Navigation previews only; the GPU artwork renderer never samples these. */\nexport const thumbnails = '+json.dumps(thumbs,separators=(',',':'))+';\n', encoding='utf-8', newline='\n')
