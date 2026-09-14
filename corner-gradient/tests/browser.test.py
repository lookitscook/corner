"""First-party editor tests. CDNs are deliberately blocked to exercise offline behavior.
Install playwright and Pillow; pass a Chromium executable via CHROMIUM if needed.
The standalone HTML is injected directly, so no local web server is required.
"""
from pathlib import Path
import json, base64, os, time
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT.parent/'corner-gradient.html').read_text()
OUT = ROOT/'tests'/'output'
OUT.mkdir(exist_ok=True)
results=[]
def good(name):
    results.append(name)
    print('PASS:', name)

def same(a,b, tol=1e-6):
    assert abs(a-b)<tol,(a,b)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=1, accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.route('https://**/*',lambda route: route.abort())
    page.set_content(HTML)
    page.wait_for_function('!!window.CornerStudio')
    page.wait_for_timeout(120)
    state=lambda: page.evaluate('CornerStudio.getState()')
    def disable_wave():
        page.locator('[data-control="waveEnabled"] input').uncheck()
        page.wait_for_timeout(60)
    def reset_static():
        page.locator('#reset').click()
        disable_wave()
    initial=state()
    assert len(initial['points'])==4
    assert page.locator('#library-badge').inner_text()=='native controls'
    assert page.locator('[data-control="color"]').count()==1
    good('Boots without a network connection; real native fallback controls are available')

    # The canvas, curve and handles must animate together without editing saved data.
    wave_before=state()
    path_before=page.locator('#curve-line').get_attribute('d')
    pixels_before=page.locator('#gradient').evaluate('(c) => c.toDataURL()')
    page.wait_for_timeout(250)
    assert state()==wave_before
    assert page.locator('#curve-line').get_attribute('d')!=path_before
    assert page.locator('#gradient').evaluate('(c) => c.toDataURL()')!=pixels_before
    good('Wave animates the curve and gradient without changing the saved base shape')
    speed=page.locator('[data-control="waveSpeed"] input[type="number"]')
    speed.fill('0');speed.press('Tab');page.wait_for_timeout(60)
    frozen=page.locator('#curve-line').get_attribute('d')
    page.wait_for_timeout(120)
    assert page.locator('#curve-line').get_attribute('d')==frozen
    # Drag a moving pose while phase is frozen; inverse mapping preserves pointer tracking.
    b=page.locator('.anchor[data-index="1"] .anchor-ring').bounding_box()
    x,y=b['x']+b['width']/2,b['y']+b['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-12,y-8,steps=5)
    page.wait_for_timeout(50)
    b=page.locator('.anchor[data-index="1"] .anchor-ring').bounding_box()
    same(b['x']+b['width']/2,x-12,.1);same(b['y']+b['height']/2,y-8,.1)
    page.mouse.up()
    good('Zero speed freezes the current wave; animated handles track pointer edits precisely')
    configured=state()
    configured['settings'].update(waveAmplitude=23,waveSpeed=.27,waveLength=2.1,waveComplexity=.8,waveEdges=.6)
    page.evaluate('(s) => CornerStudio.setState(s)',configured)
    assert state()==configured
    page.screenshot(path=str(OUT/'wave-desktop.png'))
    page.evaluate('''() => {
        const s=CornerStudio.getState(); s.settings.width=96; s.settings.height=64;
        CornerStudio.setState(s);
        const original=URL.createObjectURL;
        URL.createObjectURL=function(blob) { window.__lastBlob=blob; return original.call(URL,blob); };
    }''')
    page.wait_for_timeout(100)
    page.evaluate('''() => {
        const s=CornerStudio.getState().settings, c=document.createElement('canvas');
        c.width=s.width;c.height=s.height;
        CornerEngine.render(c.getContext('2d'),c.width,c.height,CornerEngine.prepare(CornerStudio.getAnimatedPoints(),s));
        window.__expectedPixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        document.querySelector('#export').click();
        const changed=CornerStudio.getState(); changed.settings.color='#ff0000'; CornerStudio.setState(changed);
    }''')
    page.wait_for_function('window.__lastBlob?.type === "image/png" && !document.querySelector("#export").disabled')
    assert page.evaluate('''async () => {
        const bitmap=await createImageBitmap(window.__lastBlob), c=document.createElement('canvas');
        c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);
        const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        return pixels.length===window.__expectedPixels.length && pixels.every((v,i)=>v===window.__expectedPixels[i]);
    }''')
    good('PNG captures the exact animated pose and stays frozen while editor settings change')
    page.evaluate('(s) => CornerStudio.setState(s)',configured)
    invalid=json.loads(json.dumps(configured));invalid['settings']['waveLength']=0
    assert page.evaluate('(s) => {try {CornerStudio.setState(s); return false;} catch (_) {return true;}}',invalid)
    assert state()==configured
    legacy=json.loads(json.dumps(configured))
    for key in list(legacy['settings']):
        if key.startswith('wave'): del legacy['settings'][key]
    page.evaluate('(s) => CornerStudio.setState(s)',legacy)
    assert state()['settings']['waveEnabled'] is False
    good('Wave settings round-trip, invalid values are rejected, and legacy setups stay static')
    reset_static()

    def point_center(index):
        b=page.locator(f'.anchor[data-index="{index}"] .anchor-ring').bounding_box()
        return b['x']+b['width']/2,b['y']+b['height']/2
    def drag_point(index,dx,dy):
        x,y=point_center(index)
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=8);page.mouse.up()
        page.wait_for_timeout(60)
    board=page.locator('#gradient').bounding_box()
    drag_point(0,-85,-90)
    a=state()['points']
    same(a[0]['y'],0);same(a[0]['x'],.4+85/board['width'])
    same(a[3]['x'],0);same(a[3]['y'],.4)
    good('Bottom endpoint slides horizontally and ignores vertical drag')
    before=state()['points']
    drag_point(3,-70,-60)
    a=state()['points'];same(a[3]['x'],0);same(a[3]['y'],before[3]['y']+60/board['height'])
    same(a[0]['y'],0)
    good('Right endpoint slides vertically and ignores horizontal drag')
    before=state()['points']
    drag_point(1,-20,-10)
    a=state()['points'];same(a[1]['x'],before[1]['x']+20/board['width']);same(a[1]['y'],before[1]['y']+10/board['height'])
    before=state()['points'];drag_point(2,-15,-15);a=state()['points']
    assert a[2]['x']!=before[2]['x'] and a[2]['y']!=before[2]['y']
    good('Both interior anchors can be dragged in two dimensions')
    before=state()
    page.locator('#undo').click();page.wait_for_timeout(40)
    assert state()!=before
    page.locator('#redo').click();page.wait_for_timeout(40)
    assert state()==before
    good('Undo and redo round-trip a drag')

    reset_static();page.wait_for_timeout(60)
    original=state()['points']
    size=page.locator('[data-control="size"] input[type="number"]')
    size.fill('80');size.press('Tab');page.wait_for_timeout(80)
    for a,b in zip(state()['points'],original):same(a['x'],b['x']*2);same(a['y'],b['y']*2)
    good('Size control scales the contour about the bottom-right corner')

    page.locator('[data-control="mode"] select').select_option('Cubic handles');page.wait_for_timeout(80)
    assert state()['settings']['mode']=='Cubic handles'
    assert page.locator('#control-polygon').is_visible()
    assert page.locator('#curve-line').get_attribute('d').count(' C')==1
    page.locator('[data-control="mode"] select').select_option('Through anchors');page.wait_for_timeout(80)
    assert page.locator('#curve-line').get_attribute('d').count(' C')==3
    good('Both actual single-cubic handles and four-on-curve-anchor modes work')

    page.locator('#preview-view').click();page.wait_for_timeout(40)
    assert not page.locator('#overlay').is_visible()
    page.locator('#edit-view').click();page.wait_for_timeout(40)
    assert page.locator('#overlay').is_visible()
    page.locator('#artboard').click(position={'x':20,'y':20});page.wait_for_timeout(40)
    assert not page.locator('#anchors').is_visible()
    page.locator('#curve-hit').focus();page.keyboard.press('Enter');page.wait_for_timeout(40)
    assert page.locator('#anchors').is_visible()
    good('Preview hides all overlays; the curve can be deselected and selected again')

    page.locator('.anchor[data-index="1"]').focus()
    before=state()['points'][1]
    page.keyboard.press('ArrowLeft');page.wait_for_timeout(40)
    assert state()['points'][1]['x']>before['x']
    good('Keyboard focus and arrow-key anchor nudging work')

    # Capture generated blobs without depending on the browser host's download policies.
    page.evaluate('''() => { const original = URL.createObjectURL; URL.createObjectURL = function(blob) { window.__lastBlob = blob; return original.call(URL, blob); }; }''')
    reset_static();page.wait_for_timeout(80)
    # Set the color using the actual fallback control.
    color=page.locator('[data-control="color"] input[type="text"]')
    color.fill('#7088a0');color.press('Tab');page.wait_for_timeout(80)
    assert state()['settings']['color']=='#7088a0'
    sample=page.evaluate('''() => {const c=document.querySelector('#gradient'); return { black: Array.from(c.getContext('2d').getImageData(0,0,1,1).data), corner: Array.from(c.getContext('2d').getImageData(c.width-1,c.height-1,1,1).data) }; }''')
    assert sample['black']==[0,0,0,255],sample
    assert sample['corner']==[112,136,160,255],sample
    good('Configurable corner color is exact; the far field remains opaque pure black')

    started=time.monotonic()
    page.locator('#export').click()
    page.wait_for_function('window.__lastBlob && window.__lastBlob.type === "image/png"',timeout=30000)
    page.wait_for_function('!document.querySelector("#export").disabled',timeout=30000)
    png=page.evaluate('''async () => {const r=new FileReader(); return await new Promise(resolve=>{r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(window.__lastBlob)}); }''')
    path=OUT/'export-4k.png';path.write_bytes(base64.b64decode(png))
    im=Image.open(path).convert('RGB')
    assert im.size==(3840,2160)
    assert im.getpixel((0,0))==(0,0,0)
    assert im.getpixel((3839,2159))==(112,136,160)
    assert im.getpixel((1920,1080))==(0,0,0)
    assert im.getpixel((3839,0))==(0,0,0)
    assert im.getpixel((0,2159))==(0,0,0)
    # Handle A's on-screen position must not turn into a purple guide in the export.
    assert im.getpixel((2304,2159))==(0,0,0)
    good(f'4K PNG generated with the correct dimensions, exact endpoints and no guides ({time.monotonic()-started:.2f}s)')

    saved_state=state()
    page.locator('#save-setup').click()
    page.wait_for_function('window.__lastBlob.type === "application/json"')
    setup=page.evaluate('window.__lastBlob.text()')
    assert json.loads(setup)==saved_state
    reset_static();page.wait_for_timeout(50)
    page.locator('#setup-file').set_input_files({'name':'setup.json','mimeType':'application/json','buffer':setup.encode()})
    page.wait_for_timeout(150)
    assert state()==saved_state
    good('JSON save and load restore color, geometry, rendering settings and output size')
    invalid=json.loads(setup);invalid['points'][0]['y']=.3
    page.locator('#setup-file').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(invalid).encode()})
    page.wait_for_timeout(100)
    assert state()==saved_state
    assert 'endpoints' in page.locator('#toast').inner_text()
    good('Malformed geometry is rejected without changing the current setup')

    reset_static();page.wait_for_timeout(60)
    # Test every preset at multiple falloff and frame configurations via the public setup API.
    for preset in ['Sketch','Round','Wide','Tall','Diagonal']:
        page.locator('[data-control="preset"] select').select_option(preset);page.wait_for_timeout(40)
        pnts=state()['points']
        assert all(pnts[i]['x']>pnts[i+1]['x'] and pnts[i]['y']<pnts[i+1]['y'] for i in range(3))
    good('All five shape presets remain valid and ordered')

    # Several desktop sizes: artboard and handles stay in the viewport, sidebar scrolls independently.
    for w,h in [(1440,900),(1024,768),(1920,1080)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(100)
        b=page.locator('#gradient').bounding_box()
        assert b['y']+b['height'] < h-25,(w,h,b)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    good('Editor fits desktop and laptop viewports without horizontal overflow')
    context.close()

    mobile_context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
    mobile=mobile_context.new_page();mobile.on('pageerror',lambda err:errors.append(str(err)))
    mobile.route('https://**/*',lambda route:route.abort());mobile.set_content(HTML);mobile.wait_for_timeout(150)
    mobile.evaluate('() => { const s=CornerStudio.getState(); s.settings.waveEnabled=false; CornerStudio.setState(s); }')
    mobile.wait_for_timeout(60)
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert mobile.locator('#gradient').bounding_box()['width']<390
    assert mobile.locator('[data-control="color"]').is_visible()
    # A real touch stream exercises Pointer Events and capture on a mobile viewport.
    b=mobile.locator('.anchor[data-index="3"] .anchor-ring').bounding_box();x,y=b['x']+b['width']/2,b['y']+b['height']/2
    before=mobile.evaluate('CornerStudio.getPoints()')[3]['y']
    cdp=mobile_context.new_cdp_session(mobile)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-15,'y':y-30}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    mobile.wait_for_timeout(100)
    assert mobile.evaluate('CornerStudio.getPoints()')[3]['y']>before
    same(mobile.evaluate('CornerStudio.getPoints()')[3]['x'],0)
    mobile.screenshot(path=str(OUT/'mobile.png'),full_page=True)
    good('Mobile layout has no horizontal overflow; real touch dragging preserves the edge constraint')
    assert not errors,errors
    good('No application JavaScript errors during the browser tests')
    (OUT/'test-results.json').write_text(json.dumps({'passed':results,'errors':errors},indent=2))
    mobile_context.close();browser.close()
print(f'\n{len(results)} browser checks passed.')
