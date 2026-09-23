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
IDS = ('bipolar','water','lensing','aurora','tidal','peacock','fire','hedgehog','ring','marble','kaleidoscope','feather')
thumbs = {}
for name in IDS:
    with Image.open(ROOT/'gallery'/f'{name}.png') as image:
        image = image.convert('RGB').resize((240,144),Image.Resampling.LANCZOS)
        data = BytesIO(); image.save(data,format='JPEG',quality=82,optimize=True)
        thumbs[name] = 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode('ascii')
(ROOT/'src'/'thumbnails.js').write_text('/** Navigation previews only; the GPU artwork renderer never samples these. */\nexport const thumbnails = '+json.dumps(thumbs,separators=(',',':'))+';\n')
