"""Measure the performance work of 2.0 on this machine and write docs/PERFORMANCE.json.

  compile       compile + link + first draw of every scene's program, with the
                libraries linked (dead code removed, shader-link.js) and with every
                library included as before; a unique comment defeats program caches
                (driver caches of compiled machine code may still apply)
  numbers       dragging a number of shader code: one redraw with numbers as
                uniforms, against a recompile per change with numbers as constants
  points        20000 points of a p5.js sketch: the studio's GPU point pass against
                the same sketch drawn by Canvas 2D (the p5.js stand-in)
  frames        GPU time of one frame of every work at 1024 pixels wide

Usage: python tools/perf_report.py  (EQUATION_STUDIO_HARDWARE_GPU=1 for the GPU)
"""
import datetime
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from browser import launch, describe_backend
from build import bundle

HARNESS = r'''
const finish = gl => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
window.compileTime = (id, full, nonce) => {
  const p = testLibrary.getPreset(id), c = testLibrary.compileProgram(p);
  let fragment = c.fragment;
  if (full) {
    const marker = 'const vec2 FRAME_OFFSET=vec2(0.5/420.0);', start = fragment.indexOf(marker) + marker.length, end = fragment.indexOf('\nuniform int u_type;');
    fragment = fragment.slice(0, start) + '\n' + __modules['compiler.js'].LIBRARIES.join('\n') + fragment.slice(end);
  }
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2'), t0 = performance.now();
  const sh = (k, s) => { const x = gl.createShader(k); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, c.vertex)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `${fragment}\n// ${nonce}`)); gl.linkProgram(prog);
  gl.getProgramParameter(prog, gl.LINK_STATUS);
  gl.useProgram(prog); gl.viewport(0, 0, 1, 1); gl.bindVertexArray(gl.createVertexArray()); gl.drawArrays(gl.TRIANGLES, 0, 3); finish(gl);
  const ms = performance.now() - t0;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { ms, chars: fragment.length };
};
// Change one number of the code 10 times and draw each change, as a drag does.
window.numberDrag = (id, inline) => {
  const canvas = document.createElement('canvas'), r = new testLibrary.Renderer(canvas, { inlineNumbers: inline }), p = testLibrary.getPreset(id);
  const node = p.nodes.find(n => n.type === 'code'), { analyzeCode, withNumber } = __modules['glsl.js'], n = analyzeCode(node.params.code).numbers.find(x => x.float);
  r.draw(p, 1, 400, 400);
  const t0 = performance.now();
  for (let k = 1; k <= 10; k++) {
    node.params.code = withNumber(node.params.code, n.index, `${(n.value * (1 + k / 100)).toFixed(4)}`);
    r.draw(p, 1, 400, 400);
    finish(r.gl);
  }
  const ms = (performance.now() - t0) / 10;
  r.dispose();
  return ms;
};
window.pointPass = (id, frames) => {
  const canvas = document.createElement('canvas'), r = new testLibrary.Renderer(canvas), p = testLibrary.getPreset(id);
  r.draw(p, 0, 800, 800); finish(r.gl);
  const t0 = performance.now();
  for (let k = 0; k < frames; k++) { r.draw(p, k / 60, 800, 800); }
  finish(r.gl);
  const ms = (performance.now() - t0) / frames;
  r.dispose();
  return ms;
};
window.canvasSketch = (source, frames) => {
  const canvas = document.createElement('canvas');
  let ctx = null, style = '';
  const scope = { PI: Math.PI, sin: Math.sin, cos: Math.cos, mag: (a, b) => Math.sqrt(a * a + b * b),
    createCanvas: (w, h) => { canvas.width = w * 2; canvas.height = h * 2; ctx = canvas.getContext('2d'); ctx.scale(2, 2); },
    background: g => { ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(0, 0, 400, 400); return scope; },
    stroke: (g, a) => { style = `rgba(255,255,255,${a / 255})`; return scope; },
    point: (x, y) => { ctx.fillStyle = style; ctx.beginPath(); ctx.arc(x, y, 0.5, 0, 2 * Math.PI); ctx.fill(); } };
  const run = new Function('scope', `with (scope) { var t, i, w, draw, a, q, c; ${source.replace(/\/\/.*$/gm, '')}; return draw; }`);
  const draw = run(scope);
  draw();
  ctx.getImageData(0, 0, 1, 1);
  const t0 = performance.now();
  for (let k = 0; k < frames; k++) { draw(); }
  ctx.getImageData(0, 0, 1, 1);
  return (performance.now() - t0) / frames;
};
window.frameTime = id => {
  const canvas = document.createElement('canvas'), r = new testLibrary.Renderer(canvas), p = testLibrary.getPreset(id), h = Math.round(1024 / (p.aspect ?? 5 / 3));
  const ms = r.measure(p, 1.3, 1024, h, {}, 5);
  r.dispose();
  return ms;
};
'''


def main():
    report = {'date': datetime.date.today().isoformat()}
    with sync_playwright() as pw:
        browser = launch(pw)
        report['backend'] = f'Chromium {browser.version} / {describe_backend()}'
        page = browser.new_page()
        page.set_content('<canvas id="canvas"></canvas>')
        page.add_script_tag(content=bundle('test-entry.js'))
        page.add_script_tag(content=HARNESS)
        report['gpu'] = page.evaluate('new testLibrary.Renderer(document.getElementById("canvas")).info.renderer')
        print(report['gpu'], flush=True)
        ids = page.evaluate('testLibrary.presets.map(p=>p.id)')
        compile_rows = {}
        for k, id in enumerate(ids):
            linked = page.evaluate('([id,n])=>compileTime(id,false,n)', [id, f'l{k}'])
            full = page.evaluate('([id,n])=>compileTime(id,true,n)', [id, f'f{k}'])
            compile_rows[id] = {'linked_ms': round(linked['ms']), 'all_libraries_ms': round(full['ms']), 'linked_chars': linked['chars'], 'all_libraries_chars': full['chars']}
            print('compile', id, compile_rows[id], flush=True)
        report['compile'] = compile_rows
        report['numbers'] = {id: {'uniform_ms_per_change': round(page.evaluate('id=>numberDrag(id,false)', id), 2), 'constant_ms_per_change': round(page.evaluate('id=>numberDrag(id,true)', id), 1)} for id in ('vortex', 'jellyfish-lattice', 'cloud-cave')}
        print('numbers', report['numbers'], flush=True)
        works = page.evaluate('__modules["works.js"].works.filter(w=>w.platform==="p5").map(w=>({id:w.id,original:w.original}))')
        report['points'] = {w['id']: {'gpu_frame_ms': round(page.evaluate('id=>pointPass(id,30)', w['id']), 2), 'canvas2d_frame_ms': round(page.evaluate('([s,f])=>canvasSketch(s,f)', [w['original'], 10]), 1)} for w in works}
        print('points', report['points'], flush=True)
        report['frames_1024'] = {id: round(page.evaluate('id=>frameTime(id)', id), 2) for id in page.evaluate('testLibrary.presets.filter(p=>p.work).map(p=>p.id)')}
        print('frames', report['frames_1024'], flush=True)
        browser.close()
    (ROOT / 'docs' / 'PERFORMANCE.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
