"""Exercise WebGL in an about:blank in-memory test harness.
No navigation, network, or browser-policy modifications. This is NOT a localhost
navigation test. Chromium's managed policy blocks all URLs in this environment.
"""
import sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).parent))
from build import ROOT,bundle
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--use-gl=angle','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1200,'height':800})
    page.set_content('<canvas id="canvas" width="400" height="240"></canvas>')
    page.add_script_tag(content=bundle('test-entry.js'))
    page.evaluate('window.renderer=new testLibrary.Renderer(document.getElementById("canvas"))')
    print(page.evaluate('renderer.info'))
    for id in page.evaluate('testLibrary.presets.map(p=>p.id)'):
        try:
            data=page.evaluate('''(id)=>{const p=testLibrary.getPreset(id);const t=performance.now();renderer.draw(p,0,400,240);const pixels=renderer.pixels();let sum=0,magenta=0;for(let i=0;i<pixels.length;i+=4){sum+=pixels[i]+pixels[i+1]+pixels[i+2];if(pixels[i]===255&&pixels[i+1]===0&&pixels[i+2]===255)magenta++;}return {id,ms:performance.now()-t,sum,magenta};}''',id)
            print(json.dumps(data),flush=True)
            page.locator('#canvas').screenshot(path=str(ROOT/'gallery'/f'{id}.png'))
        except Exception as e:
            print(id, str(e)[:6000]); raise
    browser.close()
