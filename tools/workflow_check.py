"""Exercise actual editor handlers, exports and context recovery in Chromium.

Uses an in-memory page: this environment blocks URL navigation by policy.
No browser policy is changed. Requires Playwright; see VALIDATION.md.
"""
from pathlib import Path
import json,io,zipfile,struct
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'artifacts';OUT.mkdir(exist_ok=True)
report={'scope':'Chromium in-memory browser interaction; ANGLE SwiftShader software driver','checks':[]}
def record(name,details=None):
    report['checks'].append({'name':name,'passed':True,'details':details})
    print('PASS',name,details,flush=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    report['browser_version']=browser.version
    page=browser.new_page(viewport={'width':1560,'height':1050},accept_downloads=True)
    page.set_default_timeout(60000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content((ROOT/'Equation Studio.html').read_text(),wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current',timeout=120000)
    page.locator('#quality').select_option('480')
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("water"))')
    page.locator('[data-node="planet"]').click()
    # Add first key, move playhead, then update a tracked numeric value.
    page.locator('[data-key="radius"]').click()
    page.evaluate('equationStudio.seek(2)')
    page.locator('#number-radius').fill('1.4');page.locator('#number-radius').dispatch_event('change')
    track=page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius")')
    assert len(track['keys'])==2 and track['keys'][1]['value']==1.4,track
    page.evaluate('equationStudio.seek(1)')
    actual=float(page.locator('#number-radius').input_value())
    assert abs(actual-(track['keys'][0]['value']+1.4)/2)<1e-5,(track,actual)
    record('UI key creation, tracked control editing and interpolation',track)
    page.locator('#undo').click()
    assert len(page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius").keys'))==1
    page.locator('#redo').click()
    assert len(page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius").keys'))==2
    record('Undo/redo preserves animation model')
    # Same-type cycle attempt: a transform cannot depend on its descendant.
    page.evaluate('''()=>{const p=__modules['presets.js'].getPreset('water');const N=__modules['graph.js'].makeNode;p.nodes.push(N('transform','t1',{p:'space'}),N('transform','t2',{p:'t1'}));equationStudio.loadProject(p);}''')
    page.locator('[data-node="t1"]').click();page.locator('#in-p').select_option('t2')
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="t1").inputs.p')=='space'
    assert page.locator('#in-p').input_value()=='space'
    record('Cycle rejection restores model AND visible connection menu')
    page.locator('#sampleField').click();page.locator('#artCanvas').click(position={'x':220,'y':140})
    page.wait_for_function('document.querySelector("#toast").textContent.includes("Raw")')
    assert 'x:' in page.locator('#toast').text_content()
    record('Raw floating-point field probe through editor',page.locator('#toast').text_content())
    # Save/open JSON uses actual browser file and download handlers.
    with page.expect_download() as dl:
        page.locator('#saveProject').click()
    path=OUT/'workflow-project.json';dl.value.save_as(str(path))
    saved=json.loads(path.read_text())
    page.locator('#projectTitle').fill('Changed title');page.locator('#projectTitle').dispatch_event('change')
    page.locator('#projectFile').set_input_files(str(path))
    page.wait_for_function('(title)=>equationStudio.getProject().title===title',arg=saved['title'])
    record('Project JSON download and import round trip')
    # Use a quick procedural scene for export tests; source still tested separately.
    page.evaluate('''()=>{const p=__modules['presets.js'].getPreset('fire');p.duration=1;p.tracks=[];equationStudio.loadProject(p);equationStudio.seek(.25);}''')
    page.locator('#exportButton').click();page.locator('#exportWidth').fill('64');page.locator('#exportHeight').fill('40')
    with page.expect_download() as dl:
        page.locator('#startExport').click()
    png=OUT/'workflow.png';dl.value.save_as(str(png))
    img=Image.open(png);img.load();assert img.size==(64,40)
    metadata=json.loads(img.info['equation-studio']);assert metadata['time']==.25 and metadata['project']['id']=='fire'
    record('PNG encoding + embedded UTF-8 project metadata',{'size':img.size,'time':metadata['time']})
    page.locator('#exportFormat').select_option('sequence');page.locator('#exportFPS').fill('4')
    with page.expect_download() as dl:
        page.locator('#startExport').click()
    zp=OUT/'workflow-frames.zip';dl.value.save_as(str(zp))
    with zipfile.ZipFile(zp) as archive:
        assert archive.testzip() is None
        manifest=json.loads(archive.read('manifest.json'))
        assert manifest['times']==[0,.25,.5,.75]
        frames=[name for name in archive.namelist() if name.endswith('.png')]
        assert len(frames)==4 and all(Image.open(io.BytesIO(archive.read(f))).size==(64,40) for f in frames)
        assert archive.read(frames[0])!=archive.read(frames[2])
    record('Four-frame deterministic PNG ZIP, CRCs, timestamps and visual change',manifest['times'])
    page.locator('#exportFormat').select_option('video');page.locator('#exportFPS').fill('8')
    with page.expect_download(timeout=60000) as dl:
        page.locator('#startExport').click()
    video=OUT/'workflow.webm';dl.value.save_as(str(video))
    data=video.read_bytes();assert data[:4]==bytes.fromhex('1a45dfa3') and len(data)>100
    record('Actual MediaRecorder video download',{'bytes':len(data),'format':'WebM EBML container'})
    page.locator('[data-close="exportDialog"]').click()
    # Context loss and restoration use the standardized test extension.
    supported=page.evaluate('''()=>{window.loseTest=equationStudio.getRenderer().gl.getExtension('WEBGL_lose_context');return !!loseTest;}''')
    if supported:
        page.evaluate('loseTest.loseContext()');page.wait_for_function('equationStudio.getRenderer().lost')
        page.evaluate('loseTest.restoreContext()');page.wait_for_function('!equationStudio.getRenderer().lost && equationStudio.getRenderer().current')
        raw=page.evaluate('''()=>{const p=equationStudio.getProject();return equationStudio.getRenderer().samplePoint(p,0,'space',.2,-.1);}''')
        assert abs(raw[0]-.2)<1e-5 and abs(raw[1]+.1)<1e-5
        record('Context loss/recovery and float extension re-enablement',raw)
    assert not errors,errors
    record('No uncaught page errors',errors)
    browser.close()
(ROOT/'docs/WORKFLOW_VALIDATION.json').write_text(json.dumps(report,indent=2))
