"""Exercise actual editor handlers, exports and context recovery in Chromium.

Uses an in-memory page: nothing is navigated or fetched and no browser policy is
changed. Requires Playwright and Pillow; see docs/VALIDATION.md. Writes
docs/WORKFLOW_VALIDATION.json and small artifacts under tests/artifacts/.
"""
from pathlib import Path
import io
import json
import sys
import zipfile
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from browser import launch, describe_backend
OUT = ROOT / 'tests' / 'artifacts'
OUT.mkdir(exist_ok=True)
report = {'scope': f'Chromium in-memory browser interaction; {describe_backend()}', 'checks': []}


def record(name, details=None):
    report['checks'].append({'name': name, 'passed': True, 'details': details})
    print('PASS', name, details, flush=True)


with sync_playwright() as pw:
    browser = launch(pw)
    report['browser_version'] = browser.version
    page = browser.new_page(viewport={'width': 1560, 'height': 1050}, accept_downloads=True)
    page.set_default_timeout(120000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content((ROOT / 'Equation Studio.html').read_text(encoding='utf-8'), wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current', timeout=300000)
    page.locator('#quality').select_option('480')
    project = lambda: page.evaluate('equationStudio.getProject()')
    view = lambda: page.evaluate('equationStudio.getView()')
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("water"))')
    page.locator('[data-node="planet"]').click()
    # Add first key, move playhead, then update a tracked numeric value.
    page.locator('[data-key="radius"]').click()
    page.evaluate('equationStudio.seek(2)')
    page.locator('#number-radius').fill('1.4')
    page.locator('#number-radius').dispatch_event('change')
    track = page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius")')
    assert len(track['keys']) == 2 and track['keys'][1]['value'] == 1.4, track
    page.evaluate('equationStudio.seek(1)')
    actual = float(page.locator('#number-radius').input_value())
    assert abs(actual - (track['keys'][0]['value'] + 1.4) / 2) < 1e-5, (track, actual)
    record('UI key creation, tracked control editing and interpolation', track)
    page.locator('#undo').click()
    assert len(page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius").keys')) == 1
    assert view()['selected'] == 'planet' and page.evaluate('equationStudio.getTime()') == 1
    page.locator('#redo').click()
    assert len(page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius").keys')) == 2
    record('Undo/redo preserves the animation model, selection and playhead')
    # Drag the second key along its lane; the value follows the key.
    key = page.locator('[data-track-time="2"]').bounding_box()
    lane = page.locator('[data-lane="planet"]').bounding_box()
    page.mouse.move(key['x'] + key['width'] / 2, key['y'] + key['height'] / 2)
    page.mouse.down()
    page.mouse.move(lane['x'] + lane['width'] * 0.5, key['y'] + key['height'] / 2, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    times = page.evaluate('equationStudio.getProject().tracks.find(t=>t.node==="planet"&&t.param==="radius").keys.map(k=>k.time)')
    assert times[0] == 0 and 3.5 < times[1] < 4.5, times
    record('Dragging a key in its lane retimes it', times)
    # Reset a parameter to its catalog default.
    page.locator('#number-twist').fill('9')
    page.locator('#number-twist').dispatch_event('change')
    page.locator('[data-reset="twist"]').click()
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="planet").params.twist') == 5
    record('Parameter reset restores the catalog default')
    # Same-type cycle attempt: a transform cannot depend on its descendant.
    page.evaluate('''()=>{const p=__modules['presets.js'].getPreset('water');const N=__modules['graph.js'].makeNode;p.nodes.push(N('transform','t1',{p:'space'}),N('transform','t2',{p:'t1'}));equationStudio.loadProject(p);}''')
    page.locator('[data-node="t1"]').click()
    page.locator('#in-p').select_option('t2')
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="t1").inputs.p') == 'space'
    assert page.locator('#in-p').input_value() == 'space'
    record('Cycle rejection restores model AND visible connection menu')
    page.locator('#sampleField').click()
    page.locator('#artCanvas').click(position={'x': 220, 'y': 140})
    page.wait_for_function('document.querySelector("#toast").textContent.includes("Raw")')
    assert 'x:' in page.locator('#toast').text_content()
    record('Raw floating-point field probe through editor', page.locator('#toast').text_content())
    # Rulers: continuous readout with raw values, then a pinned probe.
    page.keyboard.press('Escape')
    page.keyboard.press('r')
    box = page.locator('#artCanvas').bounding_box()
    page.mouse.move(box['x'] + box['width'] * 0.4, box['y'] + box['height'] * 0.5)
    page.wait_for_timeout(200)
    page.mouse.move(box['x'] + box['width'] * 0.41, box['y'] + box['height'] * 0.51)
    page.wait_for_function('document.querySelector("#probe").textContent.includes("px")')
    probe = page.locator('#probe').text_content()
    assert 'RGB' in probe and 'p(' in probe, probe
    page.mouse.click(box['x'] + box['width'] * 0.41, box['y'] + box['height'] * 0.51)
    page.wait_for_timeout(200)
    assert page.locator('#clearPin').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#clearPin').is_hidden()
    page.keyboard.press('r')
    record('Rulers readout with raw values, pin and unpin', probe)
    # Zoom about the cursor: the world point under the pointer does not move. A
    # synthetic wheel event at whole-pixel coordinates (Chromium truncates fractions).
    zoomed = page.evaluate('''()=>{const c=document.getElementById('artCanvas'),r=c.getBoundingClientRect(),vm=__modules['view-math.js'];const cx=Math.round(r.left+r.width*0.7),cy=Math.round(r.top+r.height*0.3);const fb=vm.clientToPixel(cx,cy,r,c.width,c.height);const world=v=>vm.pixelToWorld(fb.px,fb.py,c.width,c.height,v);const before=world(equationStudio.getProject().view);c.dispatchEvent(new WheelEvent('wheel',{clientX:cx,clientY:cy,deltaY:-300,bubbles:true,cancelable:true}));const view=equationStudio.getProject().view,after=world(view);return {zoom:view.zoom,dx:after.x-before.x,dy:after.y-before.y};}''')
    assert zoomed['zoom'] > 1 and abs(zoomed['dx']) < 1e-9 and abs(zoomed['dy']) < 1e-9, zoomed
    page.wait_for_timeout(400)
    record('Wheel zoom keeps the world point under the cursor fixed', zoomed['zoom'])
    page.locator('#resetView').click()
    # Previews: one atlas program paints every node card.
    page.evaluate('equationStudio.setPreviews(true)')
    page.wait_for_function('[...document.querySelectorAll("[data-preview]")].length>0 && [...document.querySelectorAll("[data-preview]")].every(c=>c.getContext("2d").getImageData(0,0,c.width,c.height).data.some(v=>v))', timeout=300000)
    record('Live per-node previews render for every component', page.locator('[data-preview]').count())
    page.evaluate('equationStudio.setPreviews(false)')
    # Contribution view through the inspector.
    page.locator('[data-node="limb"]').click()
    page.locator('#contributionNode').click()
    page.wait_for_timeout(300)
    assert view()['contribution'] == 'limb' and 'CONTRIBUTION' in page.locator('#viewLabel').text_content()
    page.locator('#contributionStyle').select_option('signed')
    assert view()['contributionStyle'] == 'signed'
    page.keyboard.press('Escape')
    assert view()['contribution'] is None
    record('Contribution view toggles and styles through the inspector')
    # Drag-and-drop a palette component onto an input socket wires it immediately.
    page.evaluate('document.getElementById("layout").style.setProperty("--graph-height","460px")')
    page.locator('[data-library="parts"]').click()
    page.locator('#librarySearch').fill('Soft disc')
    page.locator('[data-to="limb"][data-socket="p"]').scroll_into_view_if_needed()
    page.drag_and_drop('[data-add="disc"]', '[data-to="limb"][data-socket="p"]')
    page.wait_for_timeout(300)
    # A scalar cannot feed a coordinate socket: the drop is rejected and nothing is added.
    assert not any(n['type'] == 'disc' for n in project()['nodes'])
    page.locator('#librarySearch').fill('Localized vortex')
    page.drag_and_drop('[data-add="vortex"]', '[data-to="limb"][data-socket="p"]')
    page.wait_for_timeout(300)
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="limb").inputs.p') == 'vortex1'
    record('Drag-and-drop onto a socket adds and wires a compatible component; incompatible drops are rejected')
    # Drag a wire between dots, then drag it off an input to disconnect.
    page.locator('[data-from="space"]').scroll_into_view_if_needed()
    src = page.locator('[data-from="space"]').bounding_box()
    dst = page.locator('[data-to="limb"][data-socket="p"]').bounding_box()
    page.mouse.move(src['x'] + 6, src['y'] + 6)
    page.mouse.down()
    page.mouse.move(src['x'] + 40, src['y'] - 20, steps=4)
    page.mouse.move(dst['x'] + 6, dst['y'] + 6, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="limb").inputs.p') == 'space'
    dst = page.locator('[data-to="limb"][data-socket="p"]').bounding_box()
    page.mouse.move(dst['x'] + 6, dst['y'] + 6)
    page.mouse.down()
    page.mouse.move(dst['x'] - 80, dst['y'] - 40, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert page.evaluate('equationStudio.getProject().nodes.find(n=>n.id==="limb").inputs.p') is None
    record('Drag wiring between dots and drag-off disconnection')
    # Snapshots bookmark and restore a state.
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("marble"))')
    page.evaluate('equationStudio.seek(1.5)')
    page.keyboard.press('s')
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("fire"))')
    page.locator('[data-library="snapshots"]').click()
    page.locator('[data-snapshot]').first.click()
    page.wait_for_timeout(300)
    assert project()['id'] == 'marble' and abs(page.evaluate('equationStudio.getTime()') - 1.5) < 1e-9
    record('Snapshot save and restore', page.evaluate('equationStudio.getSnapshots().length'))
    # Save/open JSON uses actual browser file and download handlers.
    with page.expect_download() as dl:
        page.locator('#saveProject').click()
    path = OUT / 'workflow-project.json'
    dl.value.save_as(str(path))
    saved = json.loads(path.read_text(encoding='utf-8'))
    page.locator('#projectTitle').fill('Changed title')
    page.locator('#projectTitle').dispatch_event('change')
    page.locator('#projectFile').set_input_files(str(path))
    page.wait_for_function('(title)=>equationStudio.getProject().title===title', arg=saved['title'])
    record('Project JSON download and import round trip')
    # Use a quick procedural scene for export tests; source still tested separately.
    page.evaluate('''()=>{const p=__modules['presets.js'].getPreset('fire');p.duration=1;p.tracks=[];equationStudio.loadProject(p);equationStudio.seek(.25);}''')
    page.locator('#exportButton').click()
    page.locator('#exportWidth').fill('64')
    page.locator('#exportHeight').fill('40')
    with page.expect_download() as dl:
        page.locator('#startExport').click()
    png = OUT / 'workflow.png'
    dl.value.save_as(str(png))
    img = Image.open(png)
    img.load()
    assert img.size == (64, 40)
    metadata = json.loads(img.info['equation-studio'])
    assert metadata['time'] == .25 and metadata['project']['id'] == 'fire'
    record('PNG encoding + embedded UTF-8 project metadata', {'size': img.size, 'time': metadata['time']})
    page.locator('#exportFormat').select_option('sequence')
    page.locator('#exportFPS').fill('4')
    with page.expect_download() as dl:
        page.locator('#startExport').click()
    zp = OUT / 'workflow-frames.zip'
    dl.value.save_as(str(zp))
    with zipfile.ZipFile(zp) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['times'] == [0, .25, .5, .75]
        frames = [name for name in archive.namelist() if name.endswith('.png')]
        assert len(frames) == 4 and all(Image.open(io.BytesIO(archive.read(f))).size == (64, 40) for f in frames)
        assert archive.read(frames[0]) != archive.read(frames[2])
    record('Four-frame deterministic PNG ZIP, CRCs, timestamps and visual change', manifest['times'])
    page.locator('#exportFormat').select_option('video')
    page.locator('#exportFPS').fill('8')
    try:
        with page.expect_download(timeout=120000) as dl:
            page.locator('#startExport').click()
    except Exception:
        print('video export did not download; dialog says:', page.locator('#exportMessage').text_content(), 'errors:', errors, flush=True)
        raise
    video = OUT / 'workflow.webm'
    dl.value.save_as(str(video))
    data = video.read_bytes()
    assert data[:4] == bytes.fromhex('1a45dfa3') and len(data) > 100
    record('Actual MediaRecorder video download', {'bytes': len(data), 'format': 'WebM EBML container'})
    page.locator('[data-close="exportDialog"]').click()
    # Context loss and restoration use the standardized test extension.
    supported = page.evaluate('''()=>{window.loseTest=equationStudio.getRenderer().gl.getExtension('WEBGL_lose_context');return !!loseTest;}''')
    if supported:
        page.evaluate('loseTest.loseContext()')
        page.wait_for_function('equationStudio.getRenderer().lost')
        page.evaluate('loseTest.restoreContext()')
        page.wait_for_function('!equationStudio.getRenderer().lost && equationStudio.getRenderer().current')
        raw = page.evaluate('''()=>{const p=equationStudio.getProject();return equationStudio.getRenderer().samplePoint(p,0,'space',.2,-.1);}''')
        assert abs(raw[0] - .2) < 1e-5 and abs(raw[1] + .1) < 1e-5
        record('Context loss/recovery and float extension re-enablement', raw)
    assert not errors, errors
    record('No uncaught page errors', errors)
    browser.close()
(ROOT / 'docs/WORKFLOW_VALIDATION.json').write_text(json.dumps(report, indent=2), encoding='utf-8', newline='\n')
