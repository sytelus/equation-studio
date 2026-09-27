"""Check every work (src/works.js) on the GPU, through the shipped engine.

For twigl works, three renders of the same frame are compared pixel by pixel:

  raw        the original code in a twigl-style shader (twigl's geekest template:
             uniforms r, t, m, f, s, output o, #define FC gl_FragCoord, twigl's
             helper library), drawn by a separate WebGL program
  original   the original code in a Shader code component of the studio
  readable   the readable version (the one the scene opens with)

For p5.js works, the original sketch runs in a tiny p5.js stand-in (point() as a
Canvas 2D disc, background(), stroke()) at pixel density 2, and is compared with
the studio's Point cloud scene. The Anemone study has no original to compare.

Usage: python tools/works_check.py [--size N] [--time T] [--exact] [--only id] [--out dir]
  --exact  compile the numbers of shader code as constants (bit-identical to twigl
           on a deterministic backend such as SwiftShader; see compileProgram)
Writes docs/WORKS_VALIDATION.json (unless --only) and side-by-side PNGs to --out.
Set EQUATION_STUDIO_HARDWARE_GPU=1 to use the graphics processor (see browser.py).
"""
import argparse
import base64
import datetime
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from browser import launch, describe_backend
from build import bundle

HARNESS = r'''
const rgbBase64 = rgba => {
  let s = '';
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  for (let i = 0; i < rgb.length; i += 8192) s += String.fromCharCode(...rgb.subarray(i, i + 8192));
  return btoa(s);
};
// The original code in twigl's geekest (300 es) template, drawn on its own canvas.
window.rawTwigl = (code, width, height, time) => {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const vs = '#version 300 es\nin vec3 position;void main(){gl_Position=vec4(position,1.0);}';
  const helpers = __modules['twigl-glsl.js'].twiglGLSL.split('// FC.xy of a point')[0];
  const fs = `#version 300 es\nprecision highp float;\nuniform vec2 r;\nuniform vec2 m;\nuniform float t;\nuniform float f;\nuniform float s;\nuniform sampler2D b;\nout vec4 o;\n#define FC gl_FragCoord\nconst float PI = 3.141592653589793;\n${helpers}\nvoid main(){${code}}`;
  const sh = (k, src) => { const x = gl.createShader(k); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gl.getUniformLocation(p, 'r'), width, height);
  gl.uniform2f(gl.getUniformLocation(p, 'm'), 0.5, 0.5);
  gl.uniform1f(gl.getUniformLocation(p, 't'), time);
  gl.uniform1f(gl.getUniformLocation(p, 'f'), Math.floor(time * 60));
  gl.uniform1f(gl.getUniformLocation(p, 's'), 0);
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const rows = new Uint8Array(px.length);
  for (let y = 0; y < height; y++) rows.set(px.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return rgbBase64(rows);
};
// The work's scene, with the given code in its Shader code component.
window.studioWork = (id, code, width, height, time) => {
  const p = testLibrary.getPreset(id);
  if (code != null) p.nodes.find(n => n.type === 'code').params.code = code;
  renderer.snapshot(p, time, 4, 4);
  const start = performance.now();
  const img = renderer.snapshot(p, time, width, height);
  return { data: rgbBase64(img.data), ms: performance.now() - start };
};
// A p5.js sketch in a small stand-in: createCanvas, background, stroke, point (a
// filled disc of the stroke weight, as in p5's 2D renderer), mag, sin, cos, PI.
window.p5Sketch = (source, frames, density) => {
  const canvas = document.createElement('canvas');
  let ctx = null, style = 'rgba(255,255,255,1)';
  const scope = {
    PI: Math.PI, sin: Math.sin, cos: Math.cos, mag: (a, b) => Math.sqrt(a * a + b * b),
    createCanvas: (w, h) => { canvas.width = w * density; canvas.height = h * density; ctx = canvas.getContext('2d'); ctx.scale(density, density); },
    background: g => { ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(0, 0, canvas.width, canvas.height); return scope; },
    stroke: (g, a) => { const v = Math.min(255, g); style = `rgba(${v},${v},${v},${a / 255})`; return scope; },
    point: (x, y) => { ctx.fillStyle = style; ctx.beginPath(); ctx.arc(x, y, 0.5, 0, 2 * Math.PI); ctx.fill(); }
  };
  const body = source.replace(/\/\/.*$/gm, '');
  const run = new Function('scope', `with (scope) { var t, i, w, draw, a, q, c; ${body}; for (let k = 0; k < ${frames}; k++) draw(); return t; }`);
  const t = run(scope);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { data: rgbBase64(img), t };
};
'''


def decode(data, width, height):
    return np.frombuffer(base64.b64decode(data), np.uint8).reshape(height, width, 3).astype(int)


def compare(a, b):
    d = np.abs(a - b)
    return {'max': int(d.max()), 'mean': round(float(d.mean()), 5), 'pixels_over_2': round(float((d.max(2) > 2).mean()), 6)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=360)
    ap.add_argument('--time', type=float, default=1.3)
    ap.add_argument('--exact', action='store_true')
    ap.add_argument('--only')
    ap.add_argument('--out', default=str(ROOT / 'tests' / 'artifacts' / 'works'))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {'date': datetime.date.today().isoformat(), 'size': args.size, 'time': args.time, 'exact_numbers': args.exact, 'works': {}}
    with sync_playwright() as pw:
        browser = launch(pw)
        report['backend'] = f'Chromium {browser.version} / {describe_backend()}'
        page = browser.new_page()
        page.set_content('<canvas id="canvas" width="160" height="96"></canvas>')
        page.add_script_tag(content=bundle('test-entry.js'))
        page.add_script_tag(content=HARNESS)
        page.evaluate('exact=>window.renderer=new testLibrary.Renderer(document.getElementById("canvas"),{inlineNumbers:exact})', args.exact)
        report['gpu'] = page.evaluate('renderer.info.renderer')
        print(report['gpu'], flush=True)
        works = page.evaluate('__modules["works.js"].works.map(w=>({id:w.id,platform:w.platform,original:w.original,readable:w.readable,video:w.video,points:w.points||null}))')
        for w in works:
            if args.only and w['id'] != args.only:
                continue
            aspect = w['video']['width'] / w['video']['height']
            width, height = args.size, round(args.size / aspect)
            entry = {'platform': w['platform'], 'size': [width, height]}
            if w['platform'] == 'twigl':
                raw = decode(page.evaluate('([c,w,h,t])=>rawTwigl(c,w,h,t)', [w['original'], width, height, args.time]), width, height)
                original = page.evaluate('([id,c,w,h,t])=>studioWork(id,c,w,h,t)', [w['id'], w['original'], width, height, args.time])
                readable = page.evaluate('([id,w,h,t])=>studioWork(id,null,w,h,t)', [w['id'], width, height, args.time])
                o, r = decode(original['data'], width, height), decode(readable['data'], width, height)
                entry.update(original_vs_raw=compare(o, raw), readable_vs_original=compare(r, o), readable_vs_raw=compare(r, raw), render_ms=round(readable['ms'], 1), mean_level=round(float(raw.mean()), 2))
                Image.fromarray(np.concatenate([raw, r, np.clip(np.abs(r - raw) * 8, 0, 255)], 1).astype(np.uint8)).save(out / f'{w["id"]}.png')
            elif w['platform'] == 'p5':
                # Frame k of the sketch has t = k·Δ; the scene's time for it is (t − phase)/speed.
                frames = 90
                sketch = page.evaluate('([s,f])=>p5Sketch(s,f,2)', [w['original'], frames])
                size = 800
                ref = decode(sketch['data'], size, size)
                time = (sketch['t'] - w['points']['phase']) / w['points']['speed']
                ours = decode(page.evaluate('([id,w,h,t])=>studioWork(id,undefined,w,h,t)', [w['id'], size, size, time])['data'], size, size)
                blur = lambda img: np.asarray(Image.fromarray(img.astype(np.uint8)).resize((100, 100), Image.BILINEAR)).astype(int)
                entry.update(size=[size, size], sketch_time=round(sketch['t'], 4), studio_time=round(time, 4), per_pixel=compare(ours, ref), blurred_8x=compare(blur(ours), blur(ref)), mean_level=[round(float(ref.mean()), 2), round(float(ours.mean()), 2)])
                Image.fromarray(np.concatenate([ref, ours, np.clip(np.abs(ours - ref) * 4, 0, 255)], 1).astype(np.uint8)).save(out / f'{w["id"]}.png')
            else:
                img = decode(page.evaluate('([id,w,h,t])=>studioWork(id,null,w,h,t)', [w['id'], width, height, args.time])['data'], width, height)
                entry.update(mean_level=round(float(img.mean()), 2))
                Image.fromarray(img.astype(np.uint8)).save(out / f'{w["id"]}.png')
            report['works'][w['id']] = entry
            print(w['id'], json.dumps({k: v for k, v in entry.items() if k != 'platform'}), flush=True)
        browser.close()
    if not args.only:
        (ROOT / 'docs' / 'WORKS_VALIDATION.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
