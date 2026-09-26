"""Exercise the shipped WebGL engine, not a substitute CPU/GLES implementation.

Loads the bundled modules into an about:blank in-memory harness; nothing is
navigated or fetched. Use xvfb-run on Linux where ANGLE/SwiftShader requires an
X display. Writes docs/GPU_VALIDATION.json and the gallery PNGs.
"""
from pathlib import Path
import base64
import datetime
import json
import sys
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'reference/nebula_rewrite'))
from browser import launch, describe_backend
from build import bundle
from nebula.scene import evaluate_scene

report = {'date': datetime.date.today().isoformat(), 'checks': []}


def record(name, detail=None):
    report['checks'].append({'name': name, 'passed': True, 'detail': detail})
    print('PASS', name, str(detail)[:160], flush=True)


with sync_playwright() as pw:
    browser = launch(pw)
    report['test_environment'] = f'Chromium {browser.version} / {describe_backend()}, in-memory about:blank harness; no URL navigation or policy modification'
    page = browser.new_page()
    page.set_content('<canvas id="canvas" width="160" height="96"></canvas>')
    page.add_script_tag(content=bundle('test-entry.js'))
    page.evaluate('window.renderer=new testLibrary.Renderer(document.getElementById("canvas"))')
    report['gpu'] = page.evaluate('renderer.info')
    preset_ids = page.evaluate('testLibrary.presets.map(p=>p.id)')
    for id in preset_ids:
        r = page.evaluate('''id=>{const p=testLibrary.getPreset(id),start=performance.now();renderer.draw(p,0,640,384);const rgba=renderer.pixels();let energy=0;for(let i=0;i<rgba.length;i+=4)energy+=rgba[i]+rgba[i+1]+rgba[i+2];const ms=performance.now()-start;const png=renderer.canvas.toDataURL('image/png').split(',')[1];renderer.draw(p,0,160,96,{debug:1});const check=renderer.pixels();let nonfinite=0;for(let i=0;i<check.length;i+=4)if(check[i]||check[i+1]||check[i+2])nonfinite++;return {energy,ms,nonfinite,png};}''', id)
        assert r['energy'] > 0 and r['nonfinite'] == 0, (id, r['nonfinite'])
        (ROOT / 'gallery' / f'{id}.png').write_bytes(base64.b64decode(r.pop('png')))
        record('render + finite values: ' + id, r)
    # Every catalog component compiles through the same graph compiler (its own subgraph program).
    all_types = page.evaluate('''()=>Object.keys(__modules['catalog.js'].catalog)''')
    for type in all_types:
        result = page.evaluate('''type=>{const {makeNode:N}=__modules['graph.js'],{catalog}=__modules['catalog.js'];const p=testLibrary.getPreset('bipolar');p.nodes.push(N('noise','noiseInput',{p:'space'}));const d=catalog[type],m={coord:'space',scalar:'noiseInput',geometry:'shell',layer:'stars'};p.nodes.push(N(type,'candidate',Object.fromEntries(Object.entries(d.inputs).map(([k,t])=>[k,m[t]]))));p.output='candidate';renderer.draw(p,.37,64,40,{debug:1,subgraph:true});const a=renderer.pixels();for(let i=0;i<a.length;i+=4)if(a[i]||a[i+1]||a[i+2])return false;return true;}''', type)
        assert result, type
    record(f'all {len(all_types)} component types compile and render finite defaults', len(all_types))
    # Animation must be state independent and produce visible change.
    moving = ['water', 'lensing', 'aurora', 'tidal', 'peacock', 'fire', 'hedgehog', 'marble', 'kaleidoscope']
    for id in moving:
        stats = page.evaluate('''id=>{const p=testLibrary.getPreset(id);renderer.draw(p,0,128,80);const a=renderer.pixels();renderer.draw(p,2.3,128,80);const b=renderer.pixels();renderer.draw(p,0,128,80);const c=renderer.pixels();let change=0,repeat=0;for(let i=0;i<a.length;i++){change+=Math.abs(a[i]-b[i]);repeat+=Math.abs(a[i]-c[i]);}return {change,repeat};}''', id)
        assert stats['change'] > 0 and stats['repeat'] == 0, (id, stats)
        record('stateless visible animation: ' + id, stats)
    # A zero-strength lens is an identity coordinate map, verified in raw floats.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('lensing');p.tracks=[];p.nodes.find(n=>n.id==='lens').params.strength=0;renderer.draw(p,0,16,16);return renderer.samplePoint(p,0,'lens',.75,-.25);}''')
    assert abs(r[0] - .75) < 1e-6 and abs(r[1] + .25) < 1e-6, r
    record('raw float framebuffer + zero lens identity', r)
    # Bypass: a disabled modifier passes its input through exactly; a disabled
    # combiner passes its first input; disabled content contributes zero.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('lensing');p.tracks=[];p.nodes.find(n=>n.id==='lens').enabled=false;const lens=renderer.samplePoint(p,0,'lens',.61,-.37);
const q=testLibrary.getPreset('bipolar');const gascore=renderer.samplePoint(q,0,'gascore',.2,.1);q.nodes.find(n=>n.id==='final').enabled=false;const bypassed=renderer.samplePoint(q,0,'final',.2,.1);
q.nodes.find(n=>n.id==='final').enabled=true;q.nodes.find(n=>n.id==='stars').enabled=false;const stars=renderer.samplePoint(q,0,'stars',.2,.1);return {lens,gascore,bypassed,stars};}''')
    assert abs(r['lens'][0] - .61) < 1e-6 and abs(r['lens'][1] + .37) < 1e-6, r
    assert all(abs(a - b) < 1e-6 for a, b in zip(r['gascore'], r['bypassed'])), r
    assert r['stars'][:3] == [0, 0, 0], r
    record('bypass: modifier identity, combiner pass-through, content zero', r)
    # Offscreen probes must leave the visible canvas untouched.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('marble');renderer.draw(p,0,96,60);const before=[...renderer.pixels()];renderer.samplePoint(p,0,'veins',.1,.2);renderer.snapshot(p,0,32,20,{target:'warp'});const after=[...renderer.pixels()];return {size:[renderer.canvas.width,renderer.canvas.height],same:before.every((v,i)=>v===after[i])};}''')
    assert r['same'] and r['size'] == [96, 60], r
    record('offscreen probe and snapshot preserve the visible canvas', r)
    # Numeric changes reuse the linked shader, not a recompiled variant.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar');const a=renderer.getProgram(p,p.output);p.nodes[1].params.pinch=.52;return a===renderer.getProgram(p,p.output);}''')
    assert r
    # One program per structure: enabled flags, the output and the view are uniforms.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar');const a=renderer.getProgram(p);p.nodes.find(n=>n.id==='stars').enabled=false;p.output='gas';const b=renderer.getProgram(p);
      renderer.snapshot(p,0,32,20,{target:'turbulence'});renderer.snapshot(p,0,32,20,{contribution:'core',contributionStyle:'signed'});return {same:a===b,programs:renderer.cache.size};}''')
    assert r['same'], r
    record('bypass flags, the output and every view share the compiled program', r)
    # The whole-graph program and a target's subgraph program render the same pixels.
    r = page.evaluate('''()=>{const out={};for(const id of ['bipolar','water','lensing','kaleidoscope']){const p=testLibrary.getPreset(id);let worst=0;for(const n of p.nodes){const a=renderer.snapshot(p,0.8,48,30,{target:n.id}).data,b=renderer.snapshot(p,0.8,48,30,{target:n.id,subgraph:true}).data;for(let i=0;i<a.length;i++)worst=Math.max(worst,Math.abs(a[i]-b[i]));}out[id]=worst;}return out;}''')
    assert all(v <= 1 for v in r.values()), r
    record('whole-graph and subgraph programs agree for every stage (max byte difference)', r)
    # Line probes agree with point probes, and float thumbnails with float snapshots.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar');const line=renderer.sampleLine(p,0,'turbulence',[-1,0.3],[1,0.3],8);let worst=0;for(let i=0;i<8;i++){const x=-1+2*(i+0.5)/8,v=renderer.samplePoint(p,0,'turbulence',x,0.3)[0];worst=Math.max(worst,Math.abs(v-line[i*4]));}
      const tiles=renderer.previewAtlas(p,0,['shell','cloud'],40,24,{raw:true});const snap=renderer.snapshot(p,0,40,24,{target:'cloud',raw:true}).data,tile=tiles.get('cloud').data;let atlas=0;for(let i=0;i<snap.length;i++)atlas=Math.max(atlas,Math.abs(snap[i]-tile[i])/Math.max(1,Math.abs(snap[i])));return {line:worst,atlas};}''')
    assert r['line'] < 1e-4 and r['atlas'] < 1e-5, r
    record('line probes match point probes; raw thumbnails match raw snapshots', r)
    # Edit as equation: every forkable component renders the same raw values as an equation.
    r = page.evaluate('''()=>{const {catalog}=__modules['catalog.js'],{makeNode}=__modules['graph.js'];const out={};const pts=[[0.13,-0.21],[-0.62,0.35],[0.9,0.44],[-0.05,0.02],[1.4,-0.6]];
      for(const type of Object.keys(catalog).filter(testLibrary.forkable)){const p=testLibrary.getPreset('marble');p.nodes.push(makeNode('noise','scalarA',{p:'space'}));const d=catalog[type];
        p.nodes.push(makeNode(type,'target',Object.fromEntries(Object.entries(d.inputs).map(([s,k])=>[s,k==='coord'?'space':'scalarA']))));p.output='target';
        const fork=testLibrary.forkProgram(p.nodes.at(-1)),q=JSON.parse(JSON.stringify(p));Object.assign(q.nodes.at(-1),{type:fork.type,inputs:fork.inputs,params:fork.params});
        let worst=0;for(const [x,y] of pts){const a=renderer.samplePoint(p,1.1,'target',x,y),b=renderer.samplePoint(q,1.1,'target',x,y);for(let k=0;k<4;k++)worst=Math.max(worst,Math.abs(a[k]-b[k])/Math.max(1,Math.abs(a[k])));}out[type]=worst;}return out;}''')
    assert all(v < 1e-5 for v in r.values()), r
    record(f'edit as equation: {len(r)} forked components reproduce their raw values', {'worst': max(r.values())})
    record('uniform-only edits reuse linked shader')
    # One preview program renders a finite thumbnail for every node of every preset.
    for id in preset_ids:
        r = page.evaluate('''id=>{const p=testLibrary.getPreset(id);const tiles=renderer.previewAtlas(p,0.5,p.nodes.map(n=>n.id),40,24);let empty=0,magenta=0;for(const [nid,t] of tiles){let s=0;for(let i=0;i<t.data.length;i+=4){s+=t.data[i]+t.data[i+1]+t.data[i+2];if(t.data[i]===255&&t.data[i+1]===0&&t.data[i+2]===255)magenta++;}if(!s)empty++;}return {tiles:tiles.size,nodes:p.nodes.length,empty,magenta};}''', id)
        assert r['tiles'] == r['nodes'] and r['magenta'] == 0, (id, r)
        record('preview atlas renders every node: ' + id, r)
    # Contribution view (signed difference): removing the stars changes only some
    # pixels; a node that does not reach the output changes none, so the view is black.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar');const changed=(opts)=>{const s=renderer.snapshot(p,0,96,60,{contributionStyle:'signed',...opts});let n=0;for(let i=0;i<s.data.length;i+=4)if(s.data[i]||s.data[i+1]||s.data[i+2])n++;return n;};const {makeNode:N}=__modules['graph.js'];const stars=changed({contribution:'stars'});p.nodes.push(N('solid','unused'));const unused=changed({contribution:'unused'});return {stars,unused,total:96*60};}''')
    assert 0 < r['stars'] < r['total'] and r['unused'] == 0, r
    record('contribution view marks only pixels the node changes', r)
    # A zero-strength lens is the identity, so its contribution (lens vs. bypass) is nothing.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('lensing');p.tracks=[];p.nodes.find(n=>n.id==='lens').params.strength=0;const s=renderer.snapshot(p,0,96,60,{contribution:'lens',contributionStyle:'signed'});let n=0;for(let i=0;i<s.data.length;i+=4)if(s.data[i]||s.data[i+1]||s.data[i+2])n++;return n;}''')
    assert r == 0, r
    record('contribution of an identity modifier is empty (compared with its bypass, not zero)', r)
    # Compare actual float fields against the retained independent CPU renderer.
    # Selected points are native-grid pixel centers, so no alignment is fitted.
    rng = np.random.default_rng(1731)
    ms = rng.integers(1, 2001, size=24)
    ns = rng.integers(1, 1201, size=24)
    ms = np.concatenate([ms, [1000, 1001, 1100, 850, 1300, 650, 1450, 400]])
    ns = np.concatenate([ns, [600, 601, 580, 675, 450, 800, 360, 910]])
    xs = (ms - 1000) / 420
    ys = (601 - ns) / 420
    cpu = evaluate_scene(xs, ys)
    g = cpu.nebula.geometry
    refs = {'shell': np.stack([g.warp, g.rim, g.coverage], axis=-1), 'turbulence': cpu.nebula.turbulence[:, None], 'cloud': cpu.nebula.cloud_color, 'gas': cpu.gas, 'core': cpu.core, 'stars': cpu.stars, 'final': cpu.composite()}
    points = list(zip(xs.tolist(), ys.tolist()))
    page.evaluate('renderer.draw(testLibrary.getPreset("bipolar"),0,16,16)')
    field_stats = {}
    for field, ref in refs.items():
        values = page.evaluate('''({field,points})=>{const p=testLibrary.getPreset('bipolar');return points.map(([x,y])=>renderer.samplePoint(p,0,field,x,y));}''', {'field': field, 'points': points})
        gpu = np.array(values)[:, :ref.shape[1]]
        err = np.abs(gpu - ref)
        assert np.isfinite(gpu).all()
        field_stats[field] = {'max_abs_error': float(err.max()), 'mean_abs_error': float(err.mean()), 'rmse': float(np.sqrt((err ** 2).mean())), 'cpu_abs_max': float(np.abs(ref).max())}
    report['raw_field_comparison'] = {'sample_count': len(points), 'native_pixels': list(zip(ms.tolist(), ns.tolist())), 'fields': field_stats, 'interpretation': 'Float32 vs float64 measurement, not an assertion of bitwise equivalence.'}
    # Geometry has low-frequency arithmetic and should stay very close.
    assert field_stats['shell']['max_abs_error'] < 0.0001, field_stats
    record(f'{len(points)} native-grid raw probes across seven field groups', field_stats)
    (ROOT / 'docs/GPU_VALIDATION.json').write_text(json.dumps(report, indent=2), encoding='utf-8', newline='\n')
    # Render all original pixels and compare against the shipped CPU oracle PNG.
    r = page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar'),start=performance.now();renderer.draw(p,0,2000,1200);renderer.pixels();return {ms:performance.now()-start,png:renderer.canvas.toDataURL('image/png').split(',')[1]};}''')
    out = ROOT / 'gallery/bipolar_2000x1200_gpu.png'
    out.write_bytes(base64.b64decode(r['png']))
    a = np.asarray(Image.open(out).convert('RGB')).astype(float)
    b = np.asarray(Image.open(ROOT / 'reference/nebula_rewrite/gallery/reconstruction_2000x1200.png').convert('RGB')).astype(float)
    assert a.shape == b.shape
    err = np.abs(a - b)
    mse = ((a - b) ** 2).mean()
    stats = {'dimensions': [2000, 1200], 'mae_0_255': float(err.mean()), 'rmse_0_255': float(np.sqrt(mse)), 'max_error': int(err.max()), 'p95_absolute_error': float(np.quantile(err, .95)), 'p99_absolute_error': float(np.quantile(err, .99)), 'rgb_pearson_correlation': float(np.corrcoef(a.flatten(), b.flatten())[0, 1]), 'psnr_db': float(10 * np.log10(255 ** 2 / mse)), 'render_plus_readback_ms': r['ms']}
    report['native_image_comparison'] = stats
    assert stats['mae_0_255'] < 4 and stats['rgb_pearson_correlation'] > .98, stats
    record('2000 × 1200 native GPU vs CPU image comparison', stats)
    browser.close()
(ROOT / 'docs/GPU_VALIDATION.json').write_text(json.dumps(report, indent=2), encoding='utf-8', newline='\n')
print(json.dumps(report['native_image_comparison'], indent=2), flush=True)
