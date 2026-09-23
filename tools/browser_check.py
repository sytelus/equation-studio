"""In-memory Chromium UI checks and gallery screenshots. No navigation or browser
policy changes. Run under xvfb-run on headless Linux if the ANGLE driver needs X11.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from browser import launch
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    b = launch(pw)
    page = b.new_page(viewport={'width': 1600, 'height': 1030}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content((ROOT / 'Equation Studio.html').read_text(encoding='utf-8'), wait_until='load')
    page.wait_for_function('window.equationStudio?.getRenderer()?.current', timeout=300000)
    page.wait_for_timeout(600)
    print('INFO', page.evaluate('equationStudio.getRenderer().info'), flush=True)
    # The hero screenshot shows live previews and rulers on the source scene.
    page.evaluate('equationStudio.setPreviews(true)')
    page.keyboard.press('r')
    page.wait_for_function('[...document.querySelectorAll("[data-preview]")].every(c=>c.getContext("2d").getImageData(0,0,4,4).data.some(v=>v))', timeout=300000)
    page.mouse.move(760, 330)
    page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT / 'gallery/studio-desktop.png'))
    page.mouse.move(5, 5)
    page.keyboard.press('r')
    page.evaluate('equationStudio.setPreviews(false)')
    print('errors', errors, flush=True)
    print('title', page.locator('#projectTitle').input_value(), flush=True)
    # Inspect original shell channel, then resume output.
    page.locator('#isolateNode').click()
    page.wait_for_timeout(300)
    print('isolation', page.locator('#viewLabel').text_content(), flush=True)
    page.locator('#clearPreview').click()
    # Contribution of the star field to the composite.
    page.locator('[data-node="stars"]').click()
    page.locator('#contributionNode').click()
    page.wait_for_timeout(300)
    print('contribution', page.locator('#viewLabel').text_content(), flush=True)
    page.keyboard.press('Escape')
    # New recipe, edit a number, undo/redo.
    page.locator('[data-preset="water"]').click()
    page.wait_for_timeout(400)
    page.locator('[data-node="planet"]').click()
    print('water inputs', page.locator('[data-param]').count(), flush=True)
    page.screenshot(path=str(ROOT / 'gallery/studio-water.png'))
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
    page.locator('#helpButton').click()
    page.screenshot(path=str(ROOT / 'gallery/studio-help.png'))
    page.locator('[data-close="helpDialog"]').click()
    page.locator('#researchButton').click()
    print('sources', page.locator('.source-entry').count(), flush=True)
    page.locator('[data-close="researchDialog"]').click()
    # Restore a clean default view for the responsive screenshots.
    page.evaluate('equationStudio.loadProject(__modules["presets.js"].getPreset("bipolar"))')
    page.locator('[data-library="scenes"]').click()
    page.evaluate('document.getElementById("toast").hidden = true')
    page.set_viewport_size({'width': 860, 'height': 1000})
    page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT / 'gallery/studio-tablet.png'))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(500)
    page.screenshot(path=str(ROOT / 'gallery/studio-mobile.png'))
    print('all errors', errors, flush=True)
    assert not errors
    b.close()
