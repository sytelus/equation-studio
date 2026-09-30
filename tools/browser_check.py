"""In-memory Chromium UI checks and the gallery screenshots used by the docs.
No navigation or browser policy changes. Run under xvfb-run on headless Linux if
the ANGLE driver needs X11. Set EQUATION_STUDIO_HARDWARE_GPU=1 to render with the
hardware GPU (much faster).
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from browser import launch
ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / 'gallery'
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
PREVIEWS_PAINTED = '[...document.querySelectorAll("canvas[data-preview]")].length>0 && [...document.querySelectorAll("canvas[data-preview]")].every(c=>c.classList.contains("painted"))'
# The canvas is idle: no program compiling and no frame pending.
SETTLED = 'document.getElementById("compileStatus").hidden'


def open_studio(page):
    page.set_content(HTML, wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current', timeout=300000)
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)


def settle(page, ms=400):
    page.wait_for_function(SETTLED, timeout=300000)
    page.wait_for_timeout(ms)


def hide_toast(page):
    page.evaluate('document.getElementById("toast").hidden = true')


def open_scene(page, preset):
    """Open a scene the way a user does (the gallery, then the scene card), then stop
    it at its gallery moment so that the screenshot is repeatable."""
    if not page.locator('#library').is_visible():
        page.locator('#libraryButton').click()
    page.locator('[data-library="scenes"]').click()
    page.locator(f'[data-preset="{preset}"]').click()
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)
    if page.evaluate('document.getElementById("play").getAttribute("aria-label")') == 'Pause animation':
        page.locator('#play').click()
    page.evaluate('equationStudio.seek(equationStudio.getProject().thumbTime ?? 1.3)')


with sync_playwright() as pw:
    b = launch(pw)
    page = b.new_page(viewport={'width': 1600, 'height': 1030}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    open_studio(page)
    info = page.evaluate('equationStudio.getRenderer().info')
    print('INFO', {k: info[k] for k in ('renderer', 'gpu', 'rawFields', 'parallelCompile', 'gpuTimer', 'maxSize')}, flush=True)

    # First visit: the gallery opens by itself, easy scenes first.
    page.mouse.move(5, 300)
    settle(page, 600)
    assert page.locator('#library').is_visible()
    page.screenshot(path=str(GALLERY / 'studio-welcome.png'))

    # Hero: an animation opened from the gallery, its story in the panel.
    open_scene(page, 'vortex')
    page.mouse.move(5, 5)
    settle(page, 800)
    assert page.evaluate('equationStudio.getView().panel') == 'scene'
    page.screenshot(path=str(GALLERY / 'studio-desktop.png'))

    # The scene panel further down: Try this, and a step of How it works open.
    open_scene(page, 'point-jellyfish')
    page.locator('#sceneView [data-sv-tour="1"]').click()
    page.locator('#inspectorContent').evaluate('e => e.scrollTop = e.querySelector(".try-list").offsetTop - 60')
    page.mouse.move(5, 5)
    settle(page, 800)
    page.screenshot(path=str(GALLERY / 'studio-scene.png'))
    page.locator('#sceneView [data-sv-tour-end]').click()

    # The nebula, its star lattices opened from the parts strip and explained step by step.
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("bipolar"))')
    page.locator('[data-stage="stars"]').click()
    assert page.evaluate('equationStudio.getView().mode') == 'final', 'opening a part keeps the whole picture'
    settle(page, 600)
    steps = page.locator('#inspectorContent .steps .step').count()
    print('stars steps', steps, flush=True)
    assert steps >= 3
    page.screenshot(path=str(GALLERY / 'studio-part.png'))

    # The library drawer: the parts to build with.
    page.locator('#libraryButton').click()
    page.locator('[data-library="parts"]').click()
    page.mouse.move(5, 300)
    settle(page, 300)
    page.screenshot(path=str(GALLERY / 'studio-library.png'))
    page.keyboard.press('Escape')
    assert page.locator('#library').is_hidden()

    # One step of the construction with automatic colors and its legend.
    page.locator('[data-stage="shell"]').click()
    page.locator('[data-view="stage"]').click()
    page.mouse.move(5, 5)
    settle(page)
    legend = page.locator('#legend').text_content()
    print('stage legend', legend, flush=True)
    assert page.locator('#legend .legend-bar').count() == 1, 'a colormap legend for the rim channel'
    assert 'JUST THIS PART' in page.locator('#canvasMode').text_content()
    page.screenshot(path=str(GALLERY / 'studio-stage.png'))

    # What the star field changes.
    page.locator('[data-stage="stars"]').click()
    page.locator('[data-view="effect"]').click()
    page.mouse.move(5, 5)
    settle(page)
    page.screenshot(path=str(GALLERY / 'studio-effect.png'))
    page.keyboard.press('Escape')

    # The Equation Playground on the star lattices, with a pinned reading and its
    # profile, on a wide screen where the panel gets two columns.
    page.set_viewport_size({'width': 1920, 'height': 1080})
    page.evaluate('equationStudio.openPlayground("stars")')
    page.wait_for_function('equationStudio.isPlaygroundOpen()')
    page.wait_for_timeout(300)
    box = page.locator('#artCanvas').bounding_box()
    page.mouse.click(box['x'] + box['width'] * 0.62, box['y'] + box['height'] * 0.42)
    page.wait_for_function('document.querySelector("#scopePlot svg")', timeout=120000)
    page.mouse.move(5, 5)
    settle(page, 800)
    assert page.evaluate('getComputedStyle(document.querySelector("#inspectorContent .cv-cols")).display') == 'grid', 'two columns in the Playground'
    page.screenshot(path=str(GALLERY / 'studio-playground.png'))

    # A pop-out window with the same explanation.
    with page.expect_popup() as popup_info:
        page.locator('#inspectorContent [data-action="popout"]').click()
    popup = popup_info.value
    popup.set_viewport_size({'width': 760, 'height': 980})
    popup.wait_for_function('document.querySelectorAll(".steps .step").length >= 3')
    popup.wait_for_timeout(600)
    popup.screenshot(path=str(GALLERY / 'studio-popout.png'))
    popup.close()
    page.keyboard.press('Escape')  # unpin the reading
    page.keyboard.press('Escape')  # back to the final image
    page.keyboard.press('Escape')  # close the Playground
    page.wait_for_function('!equationStudio.isPlaygroundOpen()')
    page.set_viewport_size({'width': 1600, 'height': 1030})

    # A parameter sweep, hovering one candidate.
    page.locator('[data-stage="shell"]').click()
    page.locator('[data-sweep="pinch"]').click()
    page.wait_for_function('document.querySelectorAll(".explore-item").length===7')
    page.wait_for_timeout(1500)
    page.locator('.explore-item').nth(5).hover()
    settle(page, 500)
    page.screenshot(path=str(GALLERY / 'studio-explore.png'))
    page.locator('#exploreClose').click()

    # The whole construction as a formula sheet.
    page.locator('[data-bottom="formulas"]').click()
    page.wait_for_function('document.querySelectorAll("#formulaView .formula-block").length > 3')
    page.mouse.move(5, 5)
    settle(page)
    page.screenshot(path=str(GALLERY / 'studio-formulas.png'))
    page.locator('[data-bottom="pipeline"]').click()

    # Another scene and its components.
    open_scene(page, 'water')
    page.locator('[data-stage="planet"]').click()
    print('water inputs', page.locator('[data-param]').count(), flush=True)
    page.mouse.move(5, 5)
    settle(page)
    page.screenshot(path=str(GALLERY / 'studio-water.png'))

    # ✎ Edit on a built-in component: the turbulent warp of Living mineral written
    # out as an equation, changed, and previewed on the canvas as a draft.
    open_scene(page, 'marble')
    page.locator('[data-stage="warp"]').click()
    page.locator('#editEquation').click()
    editor = page.locator('#equationEditor')
    source = editor.input_value()
    assert 'p + A*d' in source, source
    editor.fill(source.replace('p + A*d', 'p + A*d*(1 + 0.8*sin(3*theta))'))
    editor.dispatch_event('input')
    page.wait_for_function('document.getElementById("canvasMode").textContent.includes("DRAFT")')
    page.mouse.move(5, 5)
    settle(page, 1200)
    page.screenshot(path=str(GALLERY / 'studio-equation.png'))
    page.locator('#cancelEquation').click()

    # Component catalog + custom equation workflow.
    page.locator('#addComponent').click()
    page.locator('#librarySearch').fill('Custom scalar')
    page.locator('[data-add="expression"]').click()
    page.locator('#editEquation').click()
    page.locator('#equationEditor').fill('0.5 + 0.5*cos(10*r - t)')
    page.locator('#equationEditor').dispatch_event('input')
    page.locator('#applyEquation').click()
    page.wait_for_timeout(300)
    added = page.evaluate('equationStudio.getProject().nodes.at(-1).params.expression')
    print('expr applied', added, flush=True)
    assert added == '0.5 + 0.5*cos(10*r - t)'
    page.locator('#editEquation').click()
    page.locator('#equationEditor').fill('unknown_function(p)')
    page.locator('#equationEditor').dispatch_event('input')
    page.locator('#applyEquation').click()
    page.wait_for_timeout(150)
    assert page.evaluate('equationStudio.getProject().nodes.at(-1).params.expression') == added
    print('bad expression preserves project', page.locator('#equationError').text_content(), flush=True)
    page.locator('#cancelEquation').click()
    hide_toast(page)
    page.locator('#helpButton').click()
    page.screenshot(path=str(GALLERY / 'studio-help.png'))
    page.locator('[data-close="helpDialog"]').click()
    page.locator('#sceneStatus').click()
    print('sources', page.locator('.source-entry').count(), flush=True)
    page.locator('[data-close="researchDialog"]').click()

    # The function graph.
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("bipolar"))')
    page.locator('[data-bottom="graph"]').click()
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)
    hide_toast(page)
    page.mouse.move(5, 5)
    settle(page)
    page.screenshot(path=str(GALLERY / 'studio-graph.png'))
    page.locator('[data-bottom="pipeline"]').click()

    # ---- 2.0: animations ----
    # The gallery of scenes, with a card coming alive.
    page.locator('#libraryButton').click()
    page.locator('[data-library="scenes"]').click()
    page.locator('[data-preset="jellyfish-lattice"]').scroll_into_view_if_needed()
    page.locator('[data-preset="jellyfish-lattice"]').hover()
    page.wait_for_function('!document.querySelector("[data-preset=jellyfish-lattice] .gallery-live").hidden', timeout=300000)
    page.wait_for_timeout(800)
    page.screenshot(path=str(GALLERY / 'studio-gallery.png'))
    page.keyboard.press('Escape')
    # A work: a step of How it works opened in the scene panel, then its lines
    # highlighted in the code, in the wide panel.
    open_scene(page, 'jellyfish-lattice')
    page.set_viewport_size({'width': 1920, 'height': 1080})
    step = page.evaluate('equationStudio.getWorks().find(w=>w.id==="jellyfish-lattice").tour.findIndex(s=>s.at && s.at.length>1)')
    page.locator(f'#sceneView [data-sv-tour="{max(step, 0)}"]').click()
    page.locator('#sceneView [data-sv-code]').click()
    page.evaluate('equationStudio.openPlayground("shader")')
    page.wait_for_function('equationStudio.isPlaygroundOpen()')
    page.mouse.move(5, 5)
    settle(page, 1200)
    assert page.locator('#codeView .c-line.hl').count() >= 1
    page.screenshot(path=str(GALLERY / 'studio-code.png'))
    page.locator('#inspectorContent .tour-banner [data-action="tour-end"]').click()
    # A variable on the canvas: the depth the raymarcher reached, with its legend.
    page.locator('#inspectorContent [data-tab="inside"]').click()
    page.locator('#inspectorContent .inside-row:has(.inside-name:text-is("depth"))').click()
    page.mouse.move(5, 5)
    settle(page, 1200)
    assert 'VALUE' in page.locator('#canvasMode').text_content()
    page.screenshot(path=str(GALLERY / 'studio-variable.png'))
    # Stats: values, histogram and the loop.
    page.locator('#inspectorContent [data-tab="stats"]').click()
    page.wait_for_function('document.querySelector("#inspectorContent .stats-table")', timeout=120000)
    page.locator('#inspectorContent [data-action="measure-loop"]').click()
    page.wait_for_function('document.querySelector("#inspectorContent .stats-verdict")', timeout=300000)
    page.keyboard.press('Escape')
    page.mouse.move(5, 5)
    settle(page, 800)
    page.screenshot(path=str(GALLERY / 'studio-stats.png'))
    page.evaluate('equationStudio.setView("final")')
    page.evaluate('equationStudio.closePlayground()')
    page.wait_for_function('!equationStudio.isPlaygroundOpen()')
    page.set_viewport_size({'width': 1600, 'height': 1030})
    # A point cloud and its credited equation.
    open_scene(page, 'point-jellyfish')
    page.mouse.move(5, 5)
    settle(page, 1200)
    page.screenshot(path=str(GALLERY / 'studio-points.png'))
    # Trails of the swimming creature.
    open_scene(page, 'point-creature')
    page.evaluate('equationStudio.setView("motion")')
    page.locator('#motionStyle').select_option('trails')
    page.mouse.move(5, 5)
    settle(page, 1000)
    page.screenshot(path=str(GALLERY / 'studio-motion.png'))
    page.evaluate('equationStudio.setView("final")')
    # Reuse: the Vortex added to Living mineral with Add light.
    open_scene(page, 'marble')
    page.locator('#addComponent').click()
    page.locator('[data-add-work="vortex"]').click()
    page.evaluate('''()=>{const p=equationStudio.getProject();p.nodes.push({id:'mix',type:'add',label:'Mineral + vortex',inputs:{a:'final',b:'code1'},params:{gain:0.6},enabled:true});p.output='mix';equationStudio.loadProject(p);}''')
    page.mouse.move(5, 5)
    settle(page, 1500)
    page.screenshot(path=str(GALLERY / 'studio-reuse.png'))
    # High contrast.
    open_scene(page, 'vortex')
    page.evaluate('equationStudio.cycleContrast()')
    page.mouse.move(5, 5)
    settle(page, 800)
    assert page.evaluate('document.documentElement.dataset.contrast') == 'more'
    page.screenshot(path=str(GALLERY / 'studio-contrast.png'))
    page.evaluate('equationStudio.cycleContrast()')
    page.evaluate('equationStudio.cycleContrast()')
    hide_toast(page)
    print('desktop errors', errors, flush=True)
    assert not errors
    page.close()

    # Touch devices: a tablet held upright and a phone.
    for name, size in (('studio-tablet.png', {'width': 820, 'height': 1180}), ('studio-mobile.png', {'width': 390, 'height': 844})):
        context = b.new_context(viewport=size, device_scale_factor=1, is_mobile=True, has_touch=True)
        touch = context.new_page()
        touch_errors = []
        touch.on('pageerror', lambda e: touch_errors.append(str(e)))
        open_studio(touch)
        settle(touch, 600)
        touch.locator('#libraryClose').tap()  # the first visit opens the gallery; close it for the layout checks
        settle(touch, 300)
        scroll = touch.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        print(name, 'coarse pointer', touch.evaluate('matchMedia("(pointer: coarse)").matches'), 'horizontal overflow', scroll, flush=True)
        assert scroll <= 0, f'{name}: the page scrolls sideways'
        # The last bar (the footer, or the transport on a phone) ends at the bottom of the screen.
        bottom = touch.evaluate('[...document.querySelectorAll("footer, .timeline")].filter(e => e.offsetParent).at(-1).getBoundingClientRect().bottom')
        assert abs(bottom - size['height']) < 2, f'{name}: the bottom bar ends at {bottom}, not at the bottom of the screen'
        touch.screenshot(path=str(GALLERY / name))
        if name == 'studio-mobile.png':
            # A part explained, one tap away in the Parts tab.
            touch.locator('[data-mobile="pipeline"]').tap()
            touch.locator('[data-stage="stars"]').tap()
            touch.locator('[data-mobile="inspector"]').tap()
            touch.wait_for_function('document.querySelectorAll("#inspectorContent .steps .step").length >= 1')
            touch.evaluate('window.scrollTo(0, 0)')
            settle(touch, 500)
            touch.screenshot(path=str(GALLERY / 'studio-mobile-inspect.png'))
        assert not touch_errors, touch_errors
        context.close()
    b.close()
