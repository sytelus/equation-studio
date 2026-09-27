"""Regression check between two versions of the engine: render the given scenes
with the renderer of a git revision and with the working tree, and compare the
final images (display bytes) and the raw values of every component.

Usage: python tools/compare_versions.py [revision] [scene ids…]
  revision   a git revision (default HEAD); its src/ is extracted to a temporary folder
  scenes     default: the twelve scenes of 1.x
Writes docs/REGRESSION_VALIDATION.json and exits with status 1 when any difference is found. Uses the software backend unless
EQUATION_STUDIO_HARDWARE_GPU=1 (see browser.py); compare on one backend only.
"""
import datetime
import importlib.util
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from browser import launch, describe_backend
SCENES = ['bipolar', 'water', 'lensing', 'aurora', 'tidal', 'peacock', 'fire', 'hedgehog', 'ring', 'marble', 'kaleidoscope', 'feather']
CAPTURE = r'''
window.capture = (id, t) => {
  const r = new testLibrary.Renderer(document.createElement('canvas')), p = testLibrary.getPreset(id);
  const out = { final: Array.from(r.snapshot(p, t, 200, 120).data) };
  for (const n of p.nodes) {
    out[n.id] = Array.from(r.snapshot(p, t, 40, 24, { target: n.id, raw: true }).data);
  }
  r.dispose();
  return out;
};
'''


def bundle_of(root):
    spec = importlib.util.spec_from_file_location(f'build_{abs(hash(str(root)))}', root / 'tools' / 'build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = root
    return module.bundle('test-entry.js')


def render(bundle, scenes):
    with sync_playwright() as pw:
        browser = launch(pw)
        page = browser.new_page()
        page.set_content('<canvas></canvas>')
        page.add_script_tag(content=bundle)
        page.add_script_tag(content=CAPTURE)
        result = {id: {t: page.evaluate('([i,t])=>capture(i,t)', [id, t]) for t in (0, 2.3)} for id in scenes}
        browser.close()
    return result


def main():
    revision = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
    scenes = sys.argv[2:] or SCENES
    with tempfile.TemporaryDirectory() as folder:
        archive = subprocess.run(['git', 'archive', revision, 'src', 'tools/build.py'], cwd=ROOT, check=True, capture_output=True).stdout
        tarfile.open(fileobj=io.BytesIO(archive)).extractall(folder)
        before = render(bundle_of(Path(folder)), scenes)
    after = render(bundle_of(ROOT), scenes)
    differences, rows = 0, []
    for id in scenes:
        for t in (0, 2.3):
            a, b = before[id][t], after[id][t]
            final = max(abs(x - y) for x, y in zip(a['final'], b['final']))
            raw = max((abs(x - y) / max(1, abs(x)) for key in a if key != 'final' and key in b for x, y in zip(a[key], b[key]) if x is not None and y is not None), default=0)
            differences += final > 0 or raw > 0
            rows.append({'scene': id, 'time': t, 'final_max_byte_difference': final, 'raw_max_relative_difference': raw, 'components': len(a) - 1})
            print(f'{id} t={t}: final image max byte difference {final}, raw values max relative difference {raw:.2e}', flush=True)
    print('identical' if not differences else f'{differences} renders differ')
    resolved = subprocess.run(['git', 'log', '-1', '--format=%h (%s)', revision], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    report = {'date': datetime.date.today().isoformat(), 'revision': resolved, 'backend': describe_backend(), 'identical': not differences, 'renders': rows}
    (ROOT / 'docs' / 'REGRESSION_VALIDATION.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    sys.exit(1 if differences else 0)


if __name__ == '__main__':
    main()
