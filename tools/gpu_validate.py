"""Exercise the shipped WebGL engine, not a substitute CPU/GLES implementation.

In this environment URL navigation is blocked by managed browser policy. Loading
HTML/code into an about:blank in-memory harness does not change that policy.
Use xvfb-run on Linux where ANGLE/SwiftShader requires an X display.
"""
from pathlib import Path
import json,sys,base64,time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
sys.path.insert(0,str(ROOT/'reference/nebula_rewrite'))
from build import bundle
from nebula.scene import evaluate_scene

report={'test_environment':'Chromium 144 / ANGLE SwiftShader software Vulkan, in-memory about:blank harness; no URL navigation or policy modification','checks':[]}
def record(name,detail=None):
 report['checks'].append({'name':name,'passed':True,'detail':detail})
 print('PASS',name,str(detail)[:160],flush=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page();page.set_content('<canvas id="canvas" width="160" height="96"></canvas>')
 page.add_script_tag(content=bundle('test-entry.js'))
 page.evaluate('window.renderer=new testLibrary.Renderer(document.getElementById("canvas"))')
 report['gpu']=page.evaluate('renderer.info')
 for id in page.evaluate('testLibrary.presets.map(p=>p.id)'):
  r=page.evaluate('''id=>{const p=testLibrary.getPreset(id),start=performance.now();renderer.draw(p,0,640,384);const rgba=renderer.pixels();let energy=0;for(let i=0;i<rgba.length;i+=4)energy+=rgba[i]+rgba[i+1]+rgba[i+2];const ms=performance.now()-start;const png=renderer.canvas.toDataURL('image/png').split(',')[1];renderer.draw(p,0,160,96,p.output,1);const check=renderer.pixels();let nonfinite=0;for(let i=0;i<check.length;i+=4)if(check[i]||check[i+1]||check[i+2])nonfinite++;return {energy,ms,nonfinite,png};}''',id)
  assert r['energy']>0 and r['nonfinite']==0,(id,r['nonfinite'])
  (ROOT/'gallery'/f'{id}.png').write_bytes(base64.b64decode(r.pop('png')))
  record('render + finite values: '+id,r)
 # Every catalog component compiles through the same graph compiler.
 all_types=page.evaluate('''()=>Object.keys(__modules['catalog.js'].catalog)''')
 for type in all_types:
  result=page.evaluate('''type=>{const {makeNode:N}=__modules['graph.js'],{catalog}=__modules['catalog.js'];const p=testLibrary.getPreset('bipolar');p.nodes.push(N('noise','noiseInput',{p:'space'}));const d=catalog[type],m={coord:'space',scalar:'noiseInput',geometry:'shell',layer:'stars'};p.nodes.push(N(type,'candidate',Object.fromEntries(Object.entries(d.inputs).map(([k,t])=>[k,m[t]]))));p.output='candidate';renderer.draw(p,.37,64,40,p.output,1);const a=renderer.pixels();for(let i=0;i<a.length;i+=4)if(a[i]||a[i+1]||a[i+2])return false;return true;}''',type)
  assert result,type
 record('all 43 component types compile and render finite defaults',len(all_types))
 # Animation must be state independent and produce visible change.
 for id in ['water','lensing','aurora','tidal','peacock','fire','hedgehog','marble','kaleidoscope']:
  stats=page.evaluate('''id=>{const p=testLibrary.getPreset(id);renderer.draw(p,0,128,80);const a=renderer.pixels();renderer.draw(p,2.3,128,80);const b=renderer.pixels();renderer.draw(p,0,128,80);const c=renderer.pixels();let change=0,repeat=0;for(let i=0;i<a.length;i++){change+=Math.abs(a[i]-b[i]);repeat+=Math.abs(a[i]-c[i]);}return {change,repeat};}''',id)
  assert stats['change']>0 and stats['repeat']==0,(id,stats)
  record('stateless visible animation: '+id,stats)
 # A zero-strength lens is an identity coordinate map, verified in raw floats.
 r=page.evaluate('''()=>{const p=testLibrary.getPreset('lensing');p.tracks=[];p.nodes.find(n=>n.id==='lens').params.strength=0;renderer.draw(p,0,16,16);return renderer.samplePoint(p,0,'lens',.75,-.25);}''')
 assert abs(r[0]-.75)<1e-6 and abs(r[1]+.25)<1e-6,r
 record('raw float framebuffer + zero lens identity',r)
 # Numeric changes reuse the linked shader, not a recompiled variant.
 r=page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar');const a=renderer.getProgram(p,p.output);p.nodes[1].params.pinch=.52;return a===renderer.getProgram(p,p.output);}''')
 assert r;record('uniform-only edits reuse linked shader')
 # Compare actual float fields against the retained independent CPU renderer.
 # Selected points are native-grid pixel centers, so no alignment is fitted.
 rng=np.random.default_rng(1731)
 ms=rng.integers(1,2001,size=24);ns=rng.integers(1,1201,size=24)
 ms=np.concatenate([ms,[1000,1001,1100,850,1300,650,1450,400]])
 ns=np.concatenate([ns,[600,601,580,675,450,800,360,910]])
 xs=(ms-1000)/420;ys=(601-ns)/420
 cpu=evaluate_scene(xs,ys);g=cpu.nebula.geometry
 refs={'shell':np.stack([g.warp,g.rim,g.coverage],axis=-1),'turbulence':cpu.nebula.turbulence[:,None],'cloud':cpu.nebula.cloud_color,'gas':cpu.gas,'core':cpu.core,'stars':cpu.stars,'final':cpu.composite()}
 points=list(zip(xs.tolist(),ys.tolist()))
 page.evaluate('renderer.draw(testLibrary.getPreset("bipolar"),0,16,16)')
 field_stats={}
 for field,ref in refs.items():
  values=page.evaluate('''({field,points})=>{const p=testLibrary.getPreset('bipolar');return points.map(([x,y])=>renderer.samplePoint(p,0,field,x,y));}''',{'field':field,'points':points})
  gpu=np.array(values)[:,:ref.shape[1]];err=np.abs(gpu-ref)
  assert np.isfinite(gpu).all()
  field_stats[field]={'max_abs_error':float(err.max()),'mean_abs_error':float(err.mean()),'rmse':float(np.sqrt((err**2).mean())),'cpu_abs_max':float(np.abs(ref).max())}
 report['raw_field_comparison']={'sample_count':len(points),'native_pixels':list(zip(ms.tolist(),ns.tolist())),'fields':field_stats,'interpretation':'Float32 vs float64 measurement, not an assertion of bitwise equivalence.'}
 # Geometry has low-frequency arithmetic and should stay very close.
 assert field_stats['shell']['max_abs_error']<0.0001,field_stats
 record('32 native-grid raw probes across seven field groups',field_stats)
 (ROOT/'docs/GPU_VALIDATION.json').write_text(json.dumps(report,indent=2))
 # Render all original pixels and compare against the shipped CPU oracle PNG.
 r=page.evaluate('''()=>{const p=testLibrary.getPreset('bipolar'),start=performance.now();renderer.draw(p,0,2000,1200);renderer.pixels();return {ms:performance.now()-start,png:renderer.canvas.toDataURL('image/png').split(',')[1]};}''')
 out=ROOT/'gallery/bipolar_2000x1200_gpu.png';out.write_bytes(base64.b64decode(r['png']))
 a=np.asarray(Image.open(out).convert('RGB')).astype(float)
 b=np.asarray(Image.open(ROOT/'reference/nebula_rewrite/gallery/reconstruction_2000x1200.png').convert('RGB')).astype(float)
 assert a.shape==b.shape
 err=np.abs(a-b);mse=((a-b)**2).mean()
 stats={'dimensions':[2000,1200],'mae_0_255':float(err.mean()),'rmse_0_255':float(np.sqrt(mse)),'max_error':int(err.max()),'p95_absolute_error':float(np.quantile(err,.95)),'p99_absolute_error':float(np.quantile(err,.99)),'rgb_pearson_correlation':float(np.corrcoef(a.flatten(),b.flatten())[0,1]),'psnr_db':float(10*np.log10(255**2/mse)),'software_backend_render_plus_readback_ms':r['ms']}
 report['native_image_comparison']=stats
 assert stats['mae_0_255']<4 and stats['rgb_pearson_correlation']>.98,stats
 record('2000 × 1200 native GPU vs CPU image comparison',stats)
 browser.close()
(ROOT/'docs/GPU_VALIDATION.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report['native_image_comparison'],indent=2),flush=True)
