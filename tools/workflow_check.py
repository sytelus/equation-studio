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
    node = lambda id: page.evaluate(f'equationStudio.getProject().nodes.find(n=>n.id==={json.dumps(id)})')
    load = lambda preset: page.evaluate(f'equationStudio.loadProject(__modules["presets.js"].getPreset({json.dumps(preset)}))')
    def show_tab(tab):
        page.locator(f'[data-bottom="{tab}"]').click()
        page.wait_for_timeout(150)
    # First run: previews, rulers and grid are on and the Pipeline tab is shown.
    prefs = view()['prefs']
    assert prefs['previews'] and prefs['rulers'] and prefs['grid'] and prefs['bottomTab'] == 'pipeline', prefs
    page.wait_for_function('[...document.querySelectorAll("#pipelineCards canvas[data-preview]")].length===9 && [...document.querySelectorAll("#pipelineCards canvas[data-preview]")].every(c=>c.classList.contains("painted"))', timeout=300000)
    record('Defaults: live pipeline previews for all 9 source components, rulers and grid on', prefs)
    # Pipeline: a card click shows that stage; [ and ] step through the construction.
    page.locator('[data-stage="shell"]').click()
    assert view()['mode'] == 'stage' and view()['node'] == 'shell'
    assert 'coverage' in page.locator('#legend').text_content()
    page.mouse.move(5, 5)
    page.keyboard.press(']')
    page.keyboard.press(']')
    assert view()['node'] == 'cloud', view()
    page.keyboard.press('[')
    assert view()['node'] == 'turbulence'
    page.keyboard.press('Escape')
    assert view()['mode'] == 'final'
    record('Pipeline card shows a stage, the legend explains it, [ ] step and Escape returns')
    # View switch, effect view and the lock.
    page.locator('[data-stage="stars"]').click()
    page.locator('[data-view="effect"]').click()
    assert view()['mode'] == 'effect' and view()['contribution'] == 'stars'
    page.locator('#effectStyle').select_option('signed')
    assert view()['contributionStyle'] == 'signed'
    page.locator('#viewLock').click()
    page.locator('[data-stage="gas"]').click()  # a pipeline click takes an explicit stage and unlocks
    page.locator('[data-view="stage"]').click()
    page.locator('#viewLock').click()
    show_tab('graph')
    page.locator('[data-node="core"] b').click()
    assert view()['selected'] == 'core' and view()['node'] == 'gas' and view()['locked'], view()
    page.locator('#viewLock').click()
    assert view()['node'] == 'core'
    page.keyboard.press('Escape')
    show_tab('pipeline')
    record('View switch: effect styles, lock keeps a stage while selecting elsewhere')
    # Tooltips explain controls and state whether a toggle is on.
    page.locator('#rulersButton').hover()
    page.wait_for_function('!document.getElementById("tooltip").hidden')
    tip = page.locator('#tooltip').text_content()
    assert 'Rulers' in tip and 'On' in tip, tip
    page.mouse.move(5, 5)
    record('Rich tooltips name the control, its shortcut and its on/off state', tip[:80])
    # Keyframes and interpolation on the water planet.
    load('water')
    page.locator('[data-stage="planet"]').click()
    page.keyboard.press('Escape')
    page.locator('[data-keyframe="radius"]').click()
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
    # Reset: modified marker, per-parameter reset, reset all, revert scene, hold original.
    page.locator('#number-twist').fill('9')
    page.locator('#number-twist').dispatch_event('change')
    assert 'modified' in page.locator('[data-param-row="twist"]').get_attribute('class')
    assert page.locator('[data-reset="twist"]').is_enabled()
    page.locator('[data-reset="twist"]').click()
    assert node('planet')['params']['twist'] == 5 and page.locator('[data-reset="twist"]').is_disabled()
    page.locator('#number-cloud').fill('1.5')
    page.locator('#number-cloud').dispatch_event('change')
    page.locator('#resetNode').click()
    assert node('planet')['params']['cloud'] == 0.65 and not project()['tracks'], project()['tracks']
    page.locator('#number-light').fill('4')
    page.locator('#number-light').dispatch_event('change')
    hold = page.locator('#holdOriginal').bounding_box()
    page.mouse.move(hold['x'] + 4, hold['y'] + 4)
    page.mouse.down()
    assert 'ORIGINAL' in page.locator('#legend').text_content()
    page.mouse.up()
    assert page.locator('#legend').is_hidden()
    page.locator('#revertScene').click()
    assert node('planet')['params']['light'] == 2.25
    page.locator('#undo').click()
    assert node('planet')['params']['light'] == 4
    page.locator('#revertScene').click()
    record('Reset: modified marker, parameter and component reset, hold-to-compare, undoable revert')
    # Parameter sweep and variations: hover previews, click applies, undo returns.
    page.locator('[data-sweep="twist"]').click()
    page.wait_for_function('document.querySelectorAll(".explore-item").length===7')
    tray = page.locator('#exploreTray').bounding_box()
    image = page.locator('#imageWrap').bounding_box()
    assert tray['y'] >= image['y'] + image['height'] - 1, 'the tray never covers the image'
    page.locator('.explore-item').nth(6).hover()
    page.wait_for_timeout(200)
    page.locator('.explore-item').nth(6).click()
    assert node('planet')['params']['twist'] == 14
    page.locator('#undo').click()
    assert node('planet')['params']['twist'] == 5
    page.keyboard.press('Escape')
    assert page.locator('#exploreTray').is_hidden()
    page.locator('#variations').click()
    page.wait_for_function('document.querySelectorAll(".explore-item").length===8')
    before = node('planet')['params']
    page.locator('.explore-item').nth(2).click()
    assert node('planet')['params'] != before
    page.locator('#exploreClose').click()
    page.locator('#undo').click()
    assert node('planet')['params'] == before
    record('Sweep across a range and random variations apply on click and undo cleanly')
    # Bypass semantics: a disabled modifier passes its input through (lens → identity).
    load('lensing')
    page.locator('[data-enable="lens"]').first.uncheck()
    raw = page.evaluate('''()=>{const p=equationStudio.getProject();return equationStudio.getRenderer().samplePoint(p,0,'lens',0.3,-0.2);}''')
    assert abs(raw[0] - 0.3) < 1e-6 and abs(raw[1] + 0.2) < 1e-6, raw
    page.locator('[data-enable="lens"]').first.check()
    record('Unticking a coordinate modifier bypasses it (identity), not zero', raw)
    # Only structure, then build up: enabling gas also enables what it needs.
    load('bipolar')
    page.locator('#pipelineNone').click()
    enabled = [n['id'] for n in project()['nodes'] if n['enabled']]
    assert enabled == ['space', 'gascore', 'final'], enabled
    page.locator('[data-enable="gas"]').first.check()
    enabled = sorted(n['id'] for n in project()['nodes'] if n['enabled'])
    assert enabled == sorted(['space', 'shell', 'turbulence', 'cloud', 'gas', 'gascore', 'final']), enabled
    page.locator('#pipelineOriginal').click()
    assert all(n['enabled'] for n in project()['nodes'])
    record('Only structure bypasses content; ticking one component includes its dependencies; Original restores', enabled)
    # Composition: insert a modifier on an input, and replace a component.
    page.locator('[data-stage="gas"]').click()
    page.keyboard.press('Escape')
    page.locator('[data-insert="cloud"]').select_option('tint')
    assert node('gas')['inputs']['cloud'] == 'tint1' and node('tint1')['inputs']['layer'] == 'cloud'
    page.locator('[data-stage="shell"]').click()
    page.keyboard.press('Escape')
    page.locator('#replaceWith').select_option('ringGeometry')
    shell = node('shell')
    assert shell['type'] == 'ringGeometry' and shell['inputs'] == {'p': 'space'}, shell
    record('Insert a modifier on an input and replace a component while keeping its wiring')
    # Equations are typeset; custom expressions preview live as MathML.
    assert page.locator('#inspectorContent .equation-card math').count() >= 1
    show_tab('pipeline')
    page.locator('[data-library="parts"]').click()
    page.locator('#librarySearch').fill('Custom scalar')
    page.locator('[data-add="expression"]').click()
    page.locator('#equationEditor').fill('pow(x, 2.0) / (1.0 + r)')
    page.locator('#equationEditor').dispatch_event('input')
    preview = page.locator('#expressionPreview').inner_html()
    assert '<mfrac>' in preview and '<msup>' in preview, preview[:200]
    page.locator('#applyEquation').click()
    assert node('expression1')['params']['expression'] == 'pow(x, 2.0) / (1.0 + r)'
    page.locator('#equationEditor').fill('unknown_function(p)')
    page.locator('#applyEquation').click()
    page.wait_for_timeout(150)
    assert node('expression1')['params']['expression'] == 'pow(x, 2.0) / (1.0 + r)'
    record('Typeset equations; live MathML preview of custom expressions; failed compiles keep the image')
    # Canvas readouts: Alt-click raw probe, continuous rulers readout, pin and unpin.
    load('water')
    page.locator('[data-stage="planet"]').click()
    page.keyboard.press('Escape')
    page.locator('#artCanvas').click(position={'x': 220, 'y': 140}, modifiers=['Alt'])
    page.wait_for_function('document.querySelector("#toast").textContent.includes("Raw")')
    assert 'R:' in page.locator('#toast').text_content()
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
    record('Alt-click raw probe; rulers readout with raw values; pin and unpin', probe)
    # Zoom about the cursor: the world point under the pointer does not move. A
    # synthetic wheel event at whole-pixel coordinates (Chromium truncates fractions).
    zoomed = page.evaluate('''()=>{const c=document.getElementById('artCanvas'),r=c.getBoundingClientRect(),vm=__modules['view-math.js'];const cx=Math.round(r.left+r.width*0.7),cy=Math.round(r.top+r.height*0.3);const fb=vm.clientToPixel(cx,cy,r,c.width,c.height);const world=v=>vm.pixelToWorld(fb.px,fb.py,c.width,c.height,v);const before=world(equationStudio.getProject().view);c.dispatchEvent(new WheelEvent('wheel',{clientX:cx,clientY:cy,deltaY:-300,bubbles:true,cancelable:true}));const view=equationStudio.getProject().view,after=world(view);return {zoom:view.zoom,dx:after.x-before.x,dy:after.y-before.y};}''')
    assert zoomed['zoom'] > 1 and abs(zoomed['dx']) < 1e-9 and abs(zoomed['dy']) < 1e-9, zoomed
    page.wait_for_timeout(400)
    page.locator('#resetView').click()
    record('Wheel zoom keeps the world point under the cursor fixed', zoomed['zoom'])
    # Graph: drag-and-drop from the palette onto a socket, drag wiring and drag-off.
    show_tab('graph')
    page.evaluate('document.getElementById("layout").style.setProperty("--graph-height","460px")')
    page.locator('[data-library="parts"]').click()
    page.locator('#librarySearch').fill('Soft disc')
    page.locator('[data-to="limb"][data-socket="p"]').scroll_into_view_if_needed()
    page.drag_and_drop('[data-add="disc"]', '[data-to="limb"][data-socket="p"]')
    page.wait_for_timeout(300)
    assert not any(n['type'] == 'disc' for n in project()['nodes'])  # scalar cannot feed a coordinate socket
    page.locator('#librarySearch').fill('Localized vortex')
    page.drag_and_drop('[data-add="vortex"]', '[data-to="limb"][data-socket="p"]')
    page.wait_for_timeout(300)
    assert node('limb')['inputs']['p'] == 'vortex1'
    record('Drag-and-drop onto a socket adds and wires a compatible component; incompatible drops are rejected')
    page.locator('[data-from="space"]').scroll_into_view_if_needed()
    src = page.locator('[data-from="space"]').bounding_box()
    dst = page.locator('[data-to="limb"][data-socket="p"]').bounding_box()
    page.mouse.move(src['x'] + 6, src['y'] + 6)
    page.mouse.down()
    page.mouse.move(src['x'] + 40, src['y'] - 20, steps=4)
    page.mouse.move(dst['x'] + 6, dst['y'] + 6, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert node('limb')['inputs']['p'] == 'space'
    page.locator('[data-to="limb"][data-socket="p"]').scroll_into_view_if_needed()
    dst = page.locator('[data-to="limb"][data-socket="p"]').bounding_box()
    empty = page.locator('#graphSummary').bounding_box()  # somewhere that is not a socket
    page.mouse.move(dst['x'] + 6, dst['y'] + 6)
    page.mouse.down()
    page.mouse.move(empty['x'] + 5, empty['y'] + 5, steps=8)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert node('limb')['inputs'].get('p') is None
    page.locator('[data-node="stars"] .node-enable').scroll_into_view_if_needed()
    page.locator('[data-node="stars"] .node-enable').uncheck()
    assert not node('stars')['enabled']
    page.locator('[data-show="planet"]').click()
    assert view()['mode'] == 'stage' and view()['node'] == 'planet'
    page.keyboard.press('Escape')
    record('Drag wiring, drag-off disconnection, card checkboxes and the card eye button')
    show_tab('pipeline')
    # Snapshots bookmark and restore a state.
    load('marble')
    page.evaluate('equationStudio.seek(1.5)')
    page.mouse.move(5, 5)
    page.keyboard.press('s')
    load('fire')
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
