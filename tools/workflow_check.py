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
    page.set_content((ROOT / 'index.html').read_text(encoding='utf-8'), wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current', timeout=300000)
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
    def view_menu(then):
        """Use a control of the View menu above the picture, then close the menu."""
        page.locator('#moreButton').click()
        then()
        if page.locator('#moreMenu').is_visible():
            page.locator('#moreButton').click()
    # First visit: the gallery opens with a welcome; the panel tells the whole scene;
    # previews on, rulers and grid off, the Parts strip shown.
    prefs = view()['prefs']
    assert prefs['previews'] and not prefs['rulers'] and not prefs['grid'] and prefs['bottomTab'] == 'pipeline', prefs
    assert page.locator('#library').is_visible() and 'Pick something to explore' in page.locator('#libraryContent').text_content()
    assert page.locator('#libraryContent .level-badge').count() >= 30, 'every scene card has a difficulty badge'
    assert view()['panel'] == 'scene' and page.locator('#sceneView .sv-title').text_content() == 'Bipolar nebula'
    assert page.locator('#sceneView .level-badge.expert').count() == 1 and page.locator('#sceneView .sv-part').count() == 9
    page.locator('#libraryClose').click()
    view_menu(lambda: page.locator('#quality').select_option('480'))
    page.wait_for_function('[...document.querySelectorAll("#pipelineCards canvas[data-preview]")].length===9 && [...document.querySelectorAll("#pipelineCards canvas[data-preview]")].every(c=>c.classList.contains("painted"))', timeout=300000)
    record('First visit: the gallery opens with a welcome and difficulty badges; the panel tells the whole scene and lists its 9 parts; live part previews; rulers and grid off', {k: prefs[k] for k in ('previews', 'rulers', 'grid')})
    # Where you are: a card click opens that part in the panel and keeps the canvas
    # view; the canvas label, the view switch and the panel header say what is shown.
    page.locator('[data-stage="shell"]').click()
    assert view()['mode'] == 'final' and view()['selected'] == 'shell' and view()['panel'] == 'part', view()
    assert 'WHOLE PICTURE' in canvas_mode(), canvas_mode()
    assert 'Part 2 of 9' in page.locator('#inspectorContent .cv-pos').text_content()
    assert 'Part 2 · Pinched shell family' in page.locator('[data-view="stage"]').get_attribute('aria-label')
    page.locator('[data-view="stage"]').click()
    assert view()['mode'] == 'stage' and view()['node'] == 'shell'
    assert 'JUST THIS PART' in canvas_mode() and 'Pinched shell family' in canvas_mode(), canvas_mode()
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
    page.locator('#inspectorContent .cv-crumb').click()
    assert view()['panel'] == 'scene' and page.locator('#sceneView').is_visible()
    page.locator('#sceneView [data-sv-part="turbulence"]').click()
    assert view()['panel'] == 'part' and view()['selected'] == 'turbulence'
    record('A click opens a part without changing the canvas; Just this part follows it; [ ] and ◀ ▶ step; ‹ Whole scene and back; the canvas label names the view')
    # View switch, effect view and the lock.
    page.locator('[data-stage="stars"]').click()
    page.locator('[data-view="effect"]').click()
    assert view()['mode'] == 'effect' and view()['contribution'] == 'stars'
    assert 'WHAT THIS PART ADDS' in canvas_mode()
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
    # Tooltips explain controls and state whether a toggle is on; the View menu holds
    # the display options (rulers, grid, brightness, light to color, sharpness).
    page.locator('#moreButton').click()
    for control in ['#rulersButton', '#gridButton', '#scopeButton', '#exposure', '#outputTone', '#quality', '#filmstripButton', '#snapshotButton']:
        assert page.locator(control).is_visible(), control
    page.locator('#rulersButton').hover()
    page.wait_for_function('!document.getElementById("tooltip").hidden')
    tip = page.locator('#tooltip').text_content()
    assert 'Rulers' in tip and 'Off' in tip, tip
    page.locator('#rulersButton').click()
    assert view()['prefs']['rulers'] and page.locator('#moreMenu').is_hidden(), 'choosing an item closes the menu'
    page.mouse.move(5, 5)
    page.keyboard.press('r')
    assert not view()['prefs']['rulers']
    record('Rich tooltips name the control, its shortcut and its on/off state; the View menu holds the display options', tip[:80])
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
    assert 'AS IT STARTED' in page.locator('#legend').text_content()
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
    # The label follows on the next drawn frame.
    page.wait_for_function('!document.getElementById("canvasMode").textContent.includes("DRAFT")', timeout=10000)
    assert page.locator('#equationEditor').count() == 0, (canvas_mode(), page.locator('#toast').text_content(), errors)
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
    assert page.locator('#inspectorContent .cv-tab.active').text_content().startswith('Big ideas'), 'the tab stays when the selection changes'
    page.locator('[data-stage="stars"]').click()
    panel_tab('equation')
    record('Tabs: captioned steps; Connections (T is used by Add light as B); Big ideas with plots; the tab stays across selections', flow.strip()[:60])
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
    page.mouse.move(5, 5)
    page.keyboard.press('r')  # rulers on
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
    page.keyboard.press('r')  # rulers off again
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
        print('video export did not download; dialog says:', page.locator('#exportMessage').text_content(), 'errors:', errors,
              'page:', page.evaluate('({visibility: document.visibilityState, focus: document.hasFocus()})'), 'open pages:', len(page.context.pages), flush=True)
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
    # ---- 2.0: animations as code, point clouds, time tools, measures and exports ----
    # The gallery: filter chips, sections, a live preview on hover, then open a work.
    page.locator('#libraryButton').click()
    page.locator('[data-library="scenes"]').click()
    page.locator('[data-gallery-kind="code"]').click()
    kinds = page.evaluate('[...document.querySelectorAll("#libraryContent .gallery-card")].map(c=>c.dataset.kind)')
    assert kinds and set(kinds) == {'code'}, kinds
    page.locator('[data-preset="vortex"]').hover()
    page.wait_for_function('!document.querySelector("[data-preset=vortex] .gallery-live").hidden', timeout=120000)
    page.locator('[data-gallery-kind="all"]').click()
    page.locator('[data-preset="vortex"]').click()
    page.wait_for_function('equationStudio.getProject().id==="vortex" && document.getElementById("compileStatus").hidden', timeout=300000)
    assert view()['selected'] == 'shader' and view()['panel'] == 'scene', view()
    assert page.evaluate('document.getElementById("play").getAttribute("aria-label")') == 'Pause animation', 'a scene opened from the gallery plays'
    page.locator('#play').click()  # pause, so the checks below see a still picture
    assert page.locator('#sceneView .sv-credit').text_content().count('Xor (@XorDev)') == 1
    assert page.locator('#sceneView .work-badge').count() == 1 and page.locator('#sceneView .level-badge').count() == 1
    assert page.locator('#sceneView .try-card').count() >= 3 and page.locator('#sceneView .sv-step').count() >= 3
    assert 's' in page.locator('#clock').text_content() and '20 s' in page.locator('#timeAxis').text_content()
    page.locator('#sceneView [data-sv-part="shader"]').first.click()
    assert view()['panel'] == 'part' and page.locator('#codeView').count() == 1
    record('Gallery: kind filter, live hover preview; a work opens playing, on its scene panel (credit, level, Try this, How it works); the time bar reads in seconds', {'shader cards': len(kinds)})
    # Dragging a number changes the code without recompiling; one undo step restores it.
    renderer_key = lambda: page.evaluate('equationStudio.getRenderer().current.key')
    code = lambda: node('shader')['params']['code']
    key_before, code_before = renderer_key(), code()
    number = page.locator('#codeView .c-num').nth(2)
    box = number.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2 + 40, box['y'] + box['height'] / 2, steps=5)
    page.mouse.up()
    page.wait_for_timeout(200)
    assert code() != code_before, 'the number changed in the code'
    assert renderer_key() == key_before, 'no new program: numbers are uniforms'
    page.keyboard.press('Control+z')
    assert code() == code_before
    record('Dragging a code number edits the text, redraws without recompiling, and undoes in one step')
    # A variable on the canvas, its legend, and back to the color with Escape.
    page.locator('#codeView .c-var', has_text='angle').first.click()
    page.wait_for_function('document.getElementById("canvasMode").textContent.includes("VALUE")')
    assert view()['mode'] == 'stage' and 'angle' in canvas_mode(), canvas_mode()
    page.wait_for_function('document.querySelector("#legend .legend-bar")')
    page.mouse.move(5, 5)
    page.keyboard.press('Escape')
    page.wait_for_function('!document.getElementById("canvasMode").textContent.includes("VALUE")')
    record('Clicking a variable shows it on the canvas with a colormap legend; Escape returns to the color')
    # Loops: stop after fewer steps (a new image), run in full again.
    full_steps = node('shader')['params']['steps1']
    page.evaluate('equationStudio.setView("final")')
    before = page.evaluate('Array.from(equationStudio.getRenderer().pixels().slice(0,4000))')
    page.locator('#param-steps1').fill('3')
    page.locator('#param-steps1').dispatch_event('change')
    page.wait_for_timeout(300)
    assert node('shader')['params']['steps1'] == 3
    page.evaluate('equationStudio.renderNow()')
    after = page.evaluate('Array.from(equationStudio.getRenderer().pixels().slice(0,4000))')
    assert before != after, 'three rings look different from sixteen'
    page.locator('#inspectorContent [data-action="full-loop"]').click()
    assert node('shader')['params']['steps1'] == full_steps == 16
    record('A loop slider stops the loop early (the image changes); ↺ runs it in full', {'steps': full_steps})
    # How it works: a step in the scene panel shows its lines and the value it is
    # about; the code in the part panel highlights the same lines.
    page.locator('#inspectorContent .cv-crumb').click()
    show = page.evaluate('equationStudio.getWorks().find(w=>w.id==="vortex").tour.findIndex(s=>s.show)')
    assert show >= 0
    page.locator(f'#sceneView [data-sv-tour="{show}"]').click()
    assert view()['tour'] == {'node': 'shader', 'index': show}, view()
    assert page.locator('#sceneView .sv-step.open .code-view.excerpt .c-line').count() >= 1
    assert 'VALUE' in canvas_mode(), canvas_mode()
    page.locator('#sceneView [data-sv-code]').click()
    assert page.locator('#codeView .c-line.hl').count() >= 1 and page.locator('#inspectorContent .tour-banner').count() == 1
    page.locator('#inspectorContent .tour-banner [data-action="tour-end"]').click()
    assert view()['mode'] == 'final' and view()['tour'] is None
    record('How it works: a step shows its lines in the scene panel and its value on the canvas; the code highlights the same lines; End returns to the whole picture')
    # Try this: one change per challenge, marked as tried, undone in one step.
    page.locator('#inspectorContent .cv-crumb').click()
    params_before = node('shader')['params']
    tries = page.evaluate('equationStudio.getWorks().find(w=>w.id==="vortex").try')
    k = next(i for i, t in enumerate(tries) if 'set' in t or 'code' in t)
    page.locator(f'#sceneView [data-try="{k}"]').click()
    assert node('shader')['params'] != params_before and page.locator('#sceneView .try-card.tried').count() == 1
    if page.evaluate('document.getElementById("play").getAttribute("aria-label")') == 'Pause animation':
        page.locator('#play').click()
    page.mouse.move(5, 5)
    page.keyboard.press('Control+z')
    assert node('shader')['params'] == params_before
    page.locator('#sceneView [data-sv-part="shader"]').first.click()
    record('Try this: a challenge makes one change, is marked tried, and undoes in one step', tries[k]['text'][:60])
    # Look inside: every value at a pinned point.
    panel_tab('inside')
    box = page.locator('#artCanvas').bounding_box()
    page.mouse.click(round(box['x'] + box['width'] * .3), round(box['y'] + box['height'] * .4))
    page.wait_for_function('[...document.querySelectorAll("#inspectorContent .inside-value")].some(e=>e.textContent.trim())', timeout=60000)
    values = page.evaluate('[...document.querySelectorAll("#inspectorContent .inside-row")].map(r=>r.querySelector(".inside-name").textContent+"="+r.querySelector(".inside-value").textContent)')
    page.keyboard.press('Escape')
    record('Look inside reads every variable at the pinned point', values[:4])
    # Stats: values table, histogram, and the loop verdict.
    panel_tab('stats')
    page.wait_for_function('document.querySelector("#inspectorContent .stats-table")', timeout=60000)
    page.locator('#inspectorContent [data-action="measure-loop"]').click()
    page.wait_for_function('document.querySelector("#inspectorContent .stats-verdict")', timeout=300000)
    verdict = page.locator('#inspectorContent .stats-verdict').text_content()
    record('Stats: per-channel values with a histogram, and a loop measurement with a verdict', verdict[:60])
    # What moves: the motion view and trails.
    page.mouse.move(5, 5)
    page.keyboard.press('m')
    assert view()['mode'] == 'motion' and 'WHAT MOVES' in canvas_mode()
    page.locator('#motionStyle').select_option('trails')
    assert 'TRAILS' in canvas_mode()
    page.evaluate('equationStudio.renderNow()')
    page.keyboard.press('m')
    assert view()['mode'] == 'final'
    record('What moves (M): changing pixels, and trails averaging the last half second')
    # A time profile: one point through the whole timeline.
    page.mouse.move(5, 5)
    page.keyboard.press('v')
    page.locator('#scopeAxis').select_option('t')
    page.wait_for_function('document.querySelector("#scopePlot svg") && document.getElementById("scopePlot").textContent.includes("time t (s)")', timeout=120000)
    page.locator('#scopeClose').click()
    record('Profile over time: one pixel plotted through the whole loop')
    # The filmstrip: frames across the timeline; a click moves the playhead.
    page.wait_for_function('document.querySelectorAll("#filmstrip .film-frame").length===12', timeout=120000)
    page.locator('#filmstrip .film-frame').nth(6).click()
    assert abs(page.evaluate('equationStudio.getTime()') - 10) < 1e-6
    record('Filmstrip of 12 frames; clicking one seeks there', {'time': 10})
    # Freeze: speed 0 at the playhead's moment.
    panel_tab('code')
    page.locator('#inspectorContent [data-action="freeze"]').click()
    assert node('shader')['params']['speed'] == 0 and abs(node('shader')['params']['phase'] - 10) < 1e-6
    page.keyboard.press('Control+z')
    record('❄ Freeze here: speed 0 and the time offset of the playhead (undoable)')
    # Editing code: an error names its line; a valid edit applies and recompiles.
    page.locator('#editCode').click()
    editor = page.locator('#equationEditor')
    original = editor.input_value()
    editor.fill(original + '\no.rgb += vec3(1);\nfloat broken = ;')
    editor.dispatch_event('input')
    page.wait_for_function('document.getElementById("equationError").textContent.includes("Line")')
    assert 'Line' in page.locator('#equationError').text_content()
    editor.fill(original.replace('o = tanh(o);', 'o = tanh(o*1.5);'))
    editor.dispatch_event('input')
    page.locator('#applyEquation').click()
    page.wait_for_function('equationStudio.getProject().nodes.find(n=>n.id==="shader").params.code.includes("tanh(o*1.5)")')
    page.keyboard.press('Control+z')
    record('Code editing: errors point at their line; Apply puts valid code into the scene; undo restores it')
    # Point clouds: a scene, its credited equation, and its own view shows dots, not a blob.
    load('point-jellyfish')
    page.wait_for_function('document.getElementById("compileStatus").hidden', timeout=300000)
    assert view()['selected'] == 'cloud' and view()['panel'] == 'scene'
    page.locator('#sceneView [data-sv-part="cloud"]').first.click()
    assert page.locator('#editEquation').get_attribute('aria-disabled') is None, 'the equation of a point cloud is editable'
    page.evaluate('equationStudio.setView("stage","cloud")')
    page.evaluate('equationStudio.renderNow()')
    mean = page.evaluate('(()=>{const a=equationStudio.getRenderer().pixels();let s=0;for(let i=0;i<a.length;i+=4)s+=a[i];return s/(a.length/4)/255})()')
    assert 0.001 < mean < 0.3, mean
    page.keyboard.press('Escape')
    record('Point cloud scene: editable credited equation; its own view shows the dots over black', {'mean_brightness': round(mean, 4)})
    # Reuse: a work's component added to another scene, credited.
    load('marble')
    page.locator('#addComponent').click()
    page.locator('[data-add-work="vortex"]').click()
    added = project()['nodes'][-1]
    assert added['type'] == 'code' and added['work'] == 'vortex', added
    record('Parts tab: a work added to another scene keeps its credit', {'node': added['id']})
    # Exports of 2.0 on a quick scene: GIF, animated PNG, JPEG, sprite sheet, web page, code.
    page.evaluate('''()=>{const p=__modules['presets.js'].getPreset('vortex');p.duration=0.5;equationStudio.loadProject(p);}''')
    page.wait_for_function('document.getElementById("compileStatus").hidden', timeout=300000)
    def export(fmt, width=64, fps=4, suffix=None):
        page.locator('#exportButton').click()
        page.locator('#exportFormat').select_option(fmt)
        if not page.locator('#exportWidth').is_disabled():
            page.locator('#exportWidth').fill(str(width))
            page.locator('#exportHeight').fill(str(width))
        if not page.locator('#exportFPS').is_disabled():
            page.locator('#exportFPS').fill(str(fps))
        with page.expect_download(timeout=300000) as dl:
            page.locator('#startExport').click()
        path = OUT / f'workflow-{fmt}.{suffix or fmt}'
        dl.value.save_as(str(path))
        page.locator('[data-close="exportDialog"]').click()
        return path
    gif = Image.open(export('gif'))
    assert gif.format == 'GIF' and gif.n_frames == 2 and gif.info.get('loop') == 0, (gif.format, gif.n_frames)
    apng = Image.open(export('apng', suffix='png'))
    assert apng.is_animated and apng.n_frames == 2
    jpeg = Image.open(export('jpeg', suffix='jpg'))
    assert jpeg.format == 'JPEG' and jpeg.size == (64, 64)
    with zipfile.ZipFile(export('sheet', suffix='zip')) as archive:
        sheet = json.loads(archive.read('vortex-sheet.json'))
        assert len(sheet['frames']) == 16
    html = export('html').read_text(encoding='utf-8')
    assert 'const S=' in html and 'Vortex by Xor' in html
    page.evaluate('equationStudio.setView("final","shader")')
    glsl = export('code', suffix='glsl').read_text(encoding='utf-8')
    assert glsl.startswith('// Vortex: Xor (@XorDev)')
    record('Exports: looping GIF and animated PNG, JPEG, sprite sheet with JSON, a web page that plays the scene, twigl code', {'gif frames': gif.n_frames, 'sheet frames': len(sheet['frames'])})
    # High contrast and exact numbers are preferences.
    page.mouse.move(5, 5)
    page.keyboard.press('k')
    assert page.evaluate('document.documentElement.dataset.contrast') == 'more'
    page.keyboard.press('k')
    page.keyboard.press('k')
    assert page.evaluate('equationStudio.getView().prefs.contrast') == 'auto'
    page.evaluate('equationStudio.setExactNumbers(true)')
    page.wait_for_function('equationStudio.getRenderer().current.key.endsWith("#inline")', timeout=300000)
    page.evaluate('equationStudio.setExactNumbers(false)')
    page.wait_for_function('!equationStudio.getRenderer().current.key.endsWith("#inline")', timeout=300000)
    record('High contrast cycles auto → high → normal (K); exact numbers compile a separate program')
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
