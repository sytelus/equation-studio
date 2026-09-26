"""In-memory Chromium UI checks and the gallery screenshots used by the docs.
No navigation or browser policy changes. Run under xvfb-run on headless Linux if
the ANGLE driver needs X11.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from browser import launch
ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / 'gallery'
PREVIEWS_PAINTED = '[...document.querySelectorAll("canvas[data-preview]")].length>0 && [...document.querySelectorAll("canvas[data-preview]")].every(c=>c.classList.contains("painted"))'
with sync_playwright() as pw:
    b = launch(pw)
    page = b.new_page(viewport={'width': 1600, 'height': 1030}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content((ROOT / 'Equation Studio.html').read_text(encoding='utf-8'), wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current', timeout=300000)
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)
    print('INFO', page.evaluate('equationStudio.getRenderer().info'), flush=True)
    hide_toast = lambda: page.evaluate('document.getElementById("toast").hidden = true')
    # Hero: the final nebula with rulers and a crosshair reading, the live pipeline below.
    page.mouse.move(700, 330)
    page.wait_for_timeout(500)
    page.screenshot(path=str(GALLERY / 'studio-desktop.png'))
    print('errors', errors, flush=True)
    # One stage of the construction, with its false-color legend and typeset equation.
    page.locator('[data-stage="shell"]').click()
    page.mouse.move(5, 5)
    page.wait_for_timeout(400)
    print('stage', page.locator('#legend').text_content(), flush=True)
    page.screenshot(path=str(GALLERY / 'studio-stage.png'))
    # What the star field changes.
    page.locator('[data-stage="stars"]').click()
    page.locator('[data-view="effect"]').click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(GALLERY / 'studio-effect.png'))
    page.keyboard.press('Escape')
    # A parameter sweep, hovering one candidate.
    page.locator('[data-stage="shell"]').click()
    page.keyboard.press('Escape')
    page.locator('[data-sweep="pinch"]').click()
    page.wait_for_function('document.querySelectorAll(".explore-item").length===7')
    page.wait_for_timeout(1500)
    page.locator('.explore-item').nth(5).hover()
    page.wait_for_timeout(500)
    page.screenshot(path=str(GALLERY / 'studio-explore.png'))
    page.locator('#exploreClose').click()
    # Another scene and its components.
    page.locator('[data-preset="water"]').click()
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)
    page.locator('[data-stage="planet"]').click()
    page.keyboard.press('Escape')
    print('water inputs', page.locator('[data-param]').count(), flush=True)
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    page.screenshot(path=str(GALLERY / 'studio-water.png'))
    # Main component catalog + expression workflow.
    page.locator('[data-library="parts"]').click()
    page.locator('#librarySearch').fill('Custom scalar')
    page.locator('[data-add="expression"]').click()
    page.locator('#equationEditor').fill('0.5 + 0.5*cos(10.0*r - t)')
    page.locator('#applyEquation').click()
    page.wait_for_timeout(300)
    print('expr applied', page.evaluate('equationStudio.getProject().nodes.at(-1).params.expression'), flush=True)
    old = page.evaluate('equationStudio.getProject().nodes.at(-1).params.expression')
    page.locator('#equationEditor').fill('unknown_function(p)')
    page.locator('#applyEquation').click()
    page.wait_for_timeout(150)
    assert page.evaluate('equationStudio.getProject().nodes.at(-1).params.expression') == old
    print('bad expression preserves project', bool(page.locator('#equationError').text_content()), flush=True)
    hide_toast()
    page.locator('#helpButton').click()
    page.screenshot(path=str(GALLERY / 'studio-help.png'))
    page.locator('[data-close="helpDialog"]').click()
    page.locator('#researchButton').click()
    print('sources', page.locator('.source-entry').count(), flush=True)
    page.locator('[data-close="researchDialog"]').click()
    # The function graph, then a clean default view for the responsive screenshots.
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("bipolar"))')
    page.locator('[data-library="scenes"]').click()
    page.locator('[data-bottom="graph"]').click()
    page.wait_for_function(PREVIEWS_PAINTED, timeout=300000)
    hide_toast()
    page.screenshot(path=str(GALLERY / 'studio-graph.png'))
    page.locator('[data-bottom="pipeline"]').click()
    page.locator('[data-library="scenes"]').click()
    page.set_viewport_size({'width': 860, 'height': 1000})
    page.wait_for_timeout(600)
    page.screenshot(path=str(GALLERY / 'studio-tablet.png'))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(600)
    page.screenshot(path=str(GALLERY / 'studio-mobile.png'))
    print('all errors', errors, flush=True)
    assert not errors
    b.close()
