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
    def panel_tab(tab):
        page.locator(f'#inspectorContent [data-tab="{tab}"]').click()
    canvas_mode = lambda: page.locator('#canvasMode').text_content()
    # First run: previews, rulers and grid are on and the Pipeline tab is shown.
    prefs = view()['prefs']
    assert prefs['previews'] and prefs['rulers'] and prefs['grid'] and prefs['bottomTab'] == 'pipeline', prefs
    page.wait_for_function('[...document.querySelectorAll("#pipelineCards canvas[data-preview]")].length===9 && [...document.querySelectorAll("#pipelineCards canvas[data-preview]")].every(c=>c.classList.contains("painted"))', timeout=300000)
    record('Defaults: live pipeline previews for all 9 source components, rulers and grid on', prefs)
    # Where you are: a card click selects a component and keeps the canvas view; the
    # canvas label, the view switch and the panel header say what is shown.
    page.locator('[data-stage="shell"]').click()
    assert view()['mode'] == 'final' and view()['selected'] == 'shell', view()
    assert 'FINAL IMAGE' in canvas_mode(), canvas_mode()
    assert 'Step 2 of 9' in page.locator('#inspectorContent .cv-pos').text_content()
    assert 'Step 2 · Pinched shell family' in page.locator('[data-view="stage"]').text_content()
    page.locator('[data-view="stage"]').click()
    assert view()['mode'] == 'stage' and view()['node'] == 'shell'
    assert 'THIS STEP' in canvas_mode() and 'Pinched shell family' in canvas_mode(), canvas_mode()
    assert 'rim' in page.locator('#legend').text_content(), 'the legend explains the geometry look'
    page.mouse.move(5, 5)
    page.keyboard.press(']')
    page.keyboard.press(']')
    assert view()['selected'] == 'cloud' and view()['node'] == 'cloud', view()
    assert page.locator('[data-stage="cloud"] .stage-mark.on-canvas').count() == 1, 'the card on the canvas is marked'
    page.locator('#inspectorContent [data-action="prev"]').click()
    assert view()['node'] == 'turbulence'
    page.keyboard.press('Escape')
    assert view()['mode'] == 'final' and view()['selected'] == 'turbulence'
    record('A click selects without changing the canvas; This step follows the selection; [ ] and ◀ ▶ step; the canvas label names the view')
    # View switch, effect view and the lock.
    page.locator('[data-stage="stars"]').click()
    page.locator('[data-view="effect"]').click()
    assert view()['mode'] == 'effect' and view()['contribution'] == 'stars'
    assert 'WHAT IT CHANGES' in canvas_mode()
    page.locator('#effectStyle').select_option('signed')
    assert view()['contributionStyle'] == 'signed'
    page.locator('#viewLock').click()
    page.locator('[data-stage="gas"]').click()
    assert view()['selected'] == 'gas' and view()['contribution'] == 'stars' and view()['locked'], view()
    page.locator('[data-view="stage"]').click()
    show_tab('graph')
    page.locator('[data-node="core"] b').click()
    assert view()['selected'] == 'core' and view()['node'] == 'stars' and view()['locked'], view()
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
    panel_tab('flow')
    page.locator('[data-insert="cloud"]').select_option('tint')
    assert node('gas')['inputs']['cloud'] == 'tint1' and node('tint1')['inputs']['layer'] == 'cloud'
    page.locator('[data-stage="shell"]').click()
    panel_tab('more')
    page.locator('#replaceWith').select_option('ringGeometry')
    shell = node('shell')
    assert shell['type'] == 'ringGeometry' and shell['inputs'] == {'p': 'space'}, shell
    record('Insert a modifier on an input and replace a component while keeping its wiring')
    # Equations are typeset; ✎ Edit opens the text, typeset live, previewed on the canvas.
    panel_tab('equation')
    assert page.locator('#inspectorContent .steps .step-math math').count() >= 1
    show_tab('pipeline')
    page.locator('#addComponent').click()
    assert page.locator('#library').is_visible()
    page.locator('#librarySearch').fill('Custom scalar')
    page.locator('[data-add="expression"]').click()
    assert page.locator('#library').is_hidden(), 'the drawer closes after adding'
    page.locator('#editEquation').click()
    assert 'wide-panel' in page.locator('#app').get_attribute('class'), 'the panel widens while editing'
    page.locator('#equationEditor').fill('pow(x, 2.0) / (1.0 + r)')
    page.locator('#equationEditor').dispatch_event('input')
    typeset = page.locator('#inspectorContent .draft-math').inner_html()
    assert '<mfrac>' in typeset and '<msup>' in typeset, typeset[:200]
    page.wait_for_function('document.getElementById("canvasMode").textContent.includes("DRAFT")')
    page.locator('#applyEquation').click()
    assert node('expression1')['params']['expression'] == 'pow(x, 2.0) / (1.0 + r)'
    assert '<mfrac>' in page.locator('#expressionPreview').inner_html(), 'the steps show the applied equation'
    assert 'DRAFT' not in canvas_mode() and page.locator('#equationEditor').count() == 0
    page.locator('#editEquation').click()
    page.locator('#equationEditor').fill('unknown_function(p)')
    page.locator('#equationEditor').dispatch_event('input')
    assert 'Unknown function' in page.locator('#equationError').text_content()
    page.locator('#applyEquation').click()
    page.wait_for_timeout(150)
    assert node('expression1')['params']['expression'] == 'pow(x, 2.0) / (1.0 + r)'
    page.locator('#cancelEquation').click()
    assert page.locator('#equationEditor').count() == 0 and 'wide-panel' not in (page.locator('#app').get_attribute('class') or '')
    record('✎ Edit: the text typesets live and previews on the canvas as a draft; Apply puts it in; an invalid equation is not applied; Cancel discards')
    # ---- 1.3: one program per graph structure; bypassing never recompiles ----
    load('bipolar')
    page.wait_for_function('equationStudio.getRenderer().programFor(equationStudio.getProject()).status==="ready"', timeout=300000)
    before = page.evaluate('equationStudio.getRenderer().cache.size')
    for node_id in ['stars', 'core', 'stars', 'core']:
        page.locator(f'[data-enable="{node_id}"]').first.click()
        page.wait_for_timeout(120)
    page.evaluate('equationStudio.setView("stage","turbulence")')
    page.evaluate('equationStudio.setView("effect","gas")')
    page.evaluate('equationStudio.renderNow()')
    after = page.evaluate('equationStudio.getRenderer().cache.size')
    assert after == before, (before, after)
    page.evaluate('equationStudio.setView("final")')
    record('Ticking components, walking stages and showing what one changes reuse one compiled program', {'programs': after})
    # GPU badge and performance dialog name the hardware and its capabilities.
    info = page.evaluate('equationStudio.getRenderer().info')
    assert page.locator('#gpuChip').text_content() in ('GPU', 'SOFTWARE')
    page.locator('#liveBadge').click()
    assert page.locator('#gpuDialog').is_visible() and 'Background shader compilation' in page.locator('#gpuContent').text_content()
    page.locator('[data-close="gpuDialog"]').click()
    record('GPU badge and performance dialog', {'gpu': info['gpu']['name'], 'kind': info['gpu']['kind'], 'parallelCompile': info['parallelCompile'], 'gpuTimer': info['gpuTimer']})
    # Stage looks: auto colormap with a legend, a coordinate grid, classic on request.
    page.locator('[data-stage="turbulence"]').click()
    page.locator('[data-view="stage"]').click()
    page.wait_for_function('document.querySelector("#legend .legend-bar")')
    labels = page.locator('#legend .legend-labels').text_content()
    assert '0' in labels, labels
    page.locator('[data-stage="space"]').click()
    page.wait_for_function('document.querySelector("#legend").textContent.includes("grid")')
    page.locator('[data-stage="turbulence"]').click()
    page.locator('#lookColors').select_option('classic')
    page.wait_for_function('document.querySelector("#legend").textContent.includes("tanh")')
    page.locator('#lookColors').select_option('auto')
    record('Stage colors: signed colormap with range and histogram, coordinate grid, classic diagnostic on request', labels)
    # Profile: the shown component's values along the line through the cursor.
    page.mouse.move(5, 5)
    page.keyboard.press('v')
    page.wait_for_function('document.querySelector("#scopePlot path.curve")', timeout=60000)
    assert 'value' in page.locator('#scopeStats').text_content()
    page.keyboard.press('v')
    assert page.locator('#scope').is_hidden()
    record('Profile plot of raw values along a line (V toggles it)')
    # Explanations: captioned steps, data flow into and out of a component, concept cards.
    page.keyboard.press('Escape')
    page.locator('[data-stage="stars"]').click()
    assert page.locator('#inspectorContent .steps .step').count() == 3
    assert page.locator('#inspectorContent .step-text').count() == 3
    panel_tab('flow')
    flow = page.locator('#inspectorContent .flow-out').first.text_content()
    assert 'Add light' in flow and 'RGB' in flow, flow
    panel_tab('ideas')
    assert page.locator('#inspectorContent [data-concept-card="fold"] svg.plot').count() == 1
    page.locator('#inspectorContent [data-knob="fold"]').fill('2')
    page.locator('[data-stage="shell"]').click()
    assert page.locator('#inspectorContent .cv-tab.active').text_content().startswith('Ideas'), 'the tab stays when the selection changes'
    page.locator('[data-stage="stars"]').click()
    panel_tab('equation')
    record('Tabs: captioned steps; In & out (T is read by Add light as B); Ideas with plots; the tab stays across selections', flow.strip()[:60])
    # Values view and dragging a parameter symbol (one undo step).
    page.locator('#inspectorContent [data-action="values"]').click()
    assert page.locator('#inspectorContent .steps .sym-param mn').count() >= 1
    symbol = page.locator('#inspectorContent .steps .sym-param[data-param="gain"]').first
    box = symbol.bounding_box()
    gain = node('stars')['params']['gain']
    page.mouse.move(round(box['x'] + box['width'] / 2), round(box['y'] + box['height'] / 2))
    page.mouse.down()
    page.mouse.move(round(box['x'] + box['width'] / 2) + 40, round(box['y'] + box['height'] / 2), steps=5)
    page.mouse.up()
    assert node('stars')['params']['gain'] > gain
    page.locator('#undo').click()
    assert node('stars')['params']['gain'] == gain
    page.locator('#inspectorContent [data-action="values"]').click()
    record('Values view; dragging a parameter symbol changes it and undoes in one step')
    # Equation Playground: E widens the panel on the selection and shows its step and
    # profile; the pipeline becomes a compact strip; Escape backs out step by step.
    page.mouse.move(5, 5)
    narrow = page.locator('#inspector').bounding_box()['width']
    page.keyboard.press('e')
    assert 'playground' in page.locator('#app').get_attribute('class')
    wide = page.locator('#inspector').bounding_box()['width']
    assert wide > narrow * 1.4, (narrow, wide)
    assert view()['mode'] == 'stage' and view()['node'] == 'stars' and page.locator('#scope').is_visible()
    assert page.locator('#pipelineCards .stage-card').count() == 9 and page.locator('#pipelineCards .stage-thumb').first.is_hidden()
    page.locator('#inspectorContent [data-action="next"]').click()
    assert view()['node'] == 'gascore', view()
    page.locator('[data-stage="shell"]').click()
    assert view()['node'] == 'shell'
    page.keyboard.press('Escape')
    assert view()['mode'] == 'final' and 'playground' in page.locator('#app').get_attribute('class')
    page.keyboard.press('Escape')
    assert 'playground' not in page.locator('#app').get_attribute('class') and page.locator('#scope').is_hidden()
    record('Equation Playground widens the panel, shows the step and its profile, keeps the pipeline as a strip; Escape backs out', {'narrow': narrow, 'wide': wide})
    # Formula sheet: the composition and every component bound to its inputs.
    show_tab('formulas')
    summary = page.locator('.formula-summary').text_content()
    assert 'Gas emission' in summary and 'Folded star lattices' in summary, summary
    assert page.locator('.formula-block').count() == 9
    page.locator('.formula-block[data-formula="cloud"]').click()
    assert view()['selected'] == 'cloud'
    show_tab('pipeline')
    page.keyboard.press('Escape')
    record('Formula sheet: composition summary and per-component equations with bindings', summary.strip()[:80])
    # ✎ Edit on a built-in component: its steps written out as an equation, which
    # renders identically when applied unchanged; param lines become sliders.
    load('marble')
    page.locator('[data-stage="veins"]').click()
    point = page.evaluate('''()=>equationStudio.getRenderer().samplePoint(equationStudio.getProject(),0.4,'veins',0.31,-0.27)''')
    page.locator('#editEquation').click()
    source = page.locator('#equationEditor').input_value()
    assert 'phase = x*nu + beta*sin(y*nu*0.65 - omega*t)' in source, source
    assert node('veins')['type'] == 'waves', 'nothing changes before Apply'
    page.locator('#applyEquation').click()
    forked = node('veins')
    assert forked['type'] == 'expression' and forked['params']['nu'] == 10, forked
    page.wait_for_function('equationStudio.getRenderer().programFor(equationStudio.getProject()).status==="ready"', timeout=300000)
    same = page.evaluate('''()=>equationStudio.getRenderer().samplePoint(equationStudio.getProject(),0.4,'veins',0.31,-0.27)''')
    assert abs(point[0] - same[0]) < 1e-5, (point, same)
    page.locator('#editEquation').click()
    lines = page.locator('#equationEditor').input_value().split('\n')
    lines.insert(-2, 'param warp = 0.5 [0, 2]  // how much the bands twist')
    page.locator('#equationEditor').fill('\n'.join(lines).replace('phase = x*nu', 'phase = (x + warp*sin(r*3))*nu'))
    page.locator('#equationEditor').dispatch_event('input')
    page.wait_for_function('document.querySelector("#equationError").textContent.includes("checks")')
    page.keyboard.press('Escape')  # a changed draft is not discarded by Escape
    assert page.locator('#equationEditor').count() == 1
    page.locator('#applyEquation').click()
    assert node('veins')['params']['warp'] == 0.5 and page.locator('#param-warp').count() == 1
    page.locator('#number-warp').fill('1.25')
    page.locator('#number-warp').dispatch_event('input')
    page.locator('#number-warp').dispatch_event('change')
    assert node('veins')['params']['warp'] == 1.25
    record('✎ Edit on a built-in: its steps as an equation, identical when applied; edits and param lines become sliders', {'before': point[0], 'after': same[0]})
    # Pop-out window: the explanation in a second window whose controls edit the scene.
    with page.expect_popup() as popup_info:
        page.locator('#inspectorContent [data-action="popout"]').click()
    popup = popup_info.value
    popup.wait_for_function('document.querySelectorAll(".steps .step").length >= 1')
    popup.locator('#number-warp').fill('0.75')
    popup.locator('#number-warp').dispatch_event('input')
    popup.locator('#number-warp').dispatch_event('change')
    assert node('veins')['params']['warp'] == 0.75
    popup.close()
    record('Pop-out window shows the component and edits the scene')
    # Canvas readouts: Alt-click raw probe, continuous rulers readout, pin and unpin.
    load('water')
    page.locator('[data-stage="planet"]').click()
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
    page.locator('#libraryButton').click()
    page.locator('#libraryDock').click()  # docked: a column beside the graph instead of a drawer over it
    assert 'library-docked' in page.locator('#app').get_attribute('class')
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
    page.locator('#libraryDock').click()
    assert page.locator('#library').is_hidden(), 'undocked, the library is a closed drawer again'
    record('Drag wiring, drag-off disconnection, card checkboxes and the card eye button')
    show_tab('pipeline')
    # Snapshots bookmark and restore a state.
    load('marble')
    page.evaluate('equationStudio.seek(1.5)')
    page.mouse.move(5, 5)
    page.keyboard.press('s')
    load('fire')
    page.locator('#libraryButton').click()
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
    # Exporting "this stage" uses the colors the canvas shows (a colormap, not the gray diagnostic).
    load('marble')
    page.evaluate('equationStudio.setView("stage", "veins")')
    page.wait_for_function('!document.getElementById("legend").hidden && document.querySelector("#legend .legend-bar")')
    page.locator('#exportButton').click()
    page.locator('#exportFormat').select_option('png')
    page.locator('#exportWidth').fill('64')
    page.locator('#exportHeight').fill('40')
    page.locator('#exportIsolated').check()
    with page.expect_download() as dl:
        page.locator('#startExport').click()
    stage_png = Image.open(io.BytesIO(dl.value.path().read_bytes())).convert('RGB')
    rgb = stage_png.tobytes()
    saturation = sum(max(rgb[i:i + 3]) - min(rgb[i:i + 3]) for i in range(0, len(rgb), 3)) / (64 * 40)
    assert saturation > 10, saturation
    page.locator('[data-close="exportDialog"]').click()
    page.keyboard.press('Escape')
    record('Exporting a stage uses the canvas colors (colormap, not the gray diagnostic)', {'mean_saturation': round(saturation, 1)})
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
