"""Real keyboard/back/scrim/focus/dirty checks. Synthetic data, optional HA host."""
import json,pathlib,sys,re
from playwright.sync_api import sync_playwright
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
native=len(sys.argv)>3;prefix='r04-candidate-busch-' if native else 'busch-'
if native:source=source.replace('busch-',prefix)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(ignore_https_errors=True,locale='de-DE',viewport={'width':960,'height':1000});page=context.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append({'type':type(e).__name__,'locations':re.findall(r'/([A-Za-z0-9_.-]+\.js):(\d+):(\d+)',e.stack or '')}))
 if native:
  private=json.loads(pathlib.Path(sys.argv[3]).read_text());base=private['base_url'].rstrip('/')
  auth={'hassUrl':base,'clientId':base+'/','expires':4102444800000,'expires_in':315360000,'refresh_token':'','access_token':private['token']}
  context.add_init_script('localStorage.setItem("hassTokens",JSON.stringify(%s))'%json.dumps(auth));page.goto(base+'/lovelace/0',wait_until='domcontentloaded',timeout=30000)
  page.wait_for_function("!!document.querySelector('home-assistant')?.hass && !!customElements.get('ha-card')",timeout=30000)
  page.wait_for_timeout(2000)
 else:
  page.set_content('''<style>body{margin:0;font-family:Arial}html{--primary-color:#0879d0;--error-color:#db4437;--primary-text-color:#212121;--secondary-text-color:#555;--card-background-color:#fff;--secondary-background-color:#eef5fb;--divider-color:#dbe4ed;--disabled-text-color:#777}</style>''');page.add_script_tag(content="customElements.define('ha-icon',class extends HTMLElement{})")
 page.add_script_tag(content='(function(){'+source+'})();' if native else source)
 page.evaluate('''({prefix,native})=>{window.host=document.createElement('main');host.id='schedule-r04-probe';host.style.cssText='position:fixed;top:0;left:0;width:100%;z-index:2147483647;background:var(--card-background-color);font-family:Arial';(native?document.querySelector('home-assistant').shadowRoot.querySelector('home-assistant-main').shadowRoot:document.body).append(host);const c=document.createElement(prefix+'schedule-card');window.card=c;c._load=async()=>{};c.setConfig({entity:'schedule.synthetic',title:'Synthetischer Zeitplan'});c.hass={locale:{language:'de'},states:{'schedule.synthetic':{state:'on',attributes:{friendly_name:'Synthetischer Zeitplan'}}},callWS:async()=>{throw Error('No host requests allowed')},callService:async()=>{throw Error('No services allowed')}};c._model=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>[day,[{start:420,end:600,data:{kept:'fixture'}}]]));c._readonly=false;c._save=()=>window.saves++;window.saves=0;c._renderAll();host.append(c)}''',{'prefix':prefix,'native':native})
 opened=lambda:page.evaluate('card._els.blockDialog.open')
 def open_dialog():
  page.evaluate("window.probeOpener=card.shadowRoot.querySelector('.block');probeOpener.focus()")
  page.keyboard.press('Enter');assert opened()
 def focus_trap():
  for _ in range(14):
   page.keyboard.press('Tab');assert page.evaluate('card._els.blockDialog.contains(card.shadowRoot.activeElement)')
 report=[]
 for dark in [False,True]:
  page.evaluate("dark=>{for(const [key,light,night] of [['--primary-text-color','#212121','#eee'],['--secondary-text-color','#555','#ccc'],['--card-background-color','#fff','#222'],['--secondary-background-color','#eef5fb','#303b47'],['--divider-color','#dbe4ed','#46505b']])host.style.setProperty(key,dark?night:light)}",dark)
  for width in [320,360,390,480,768,960]:
   page.set_viewport_size({'width':width,'height':1000});original_url=page.url
   open_dialog();focus_trap()
   box=page.evaluate('''()=>{const r=card._els.blockDialog.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}''')
   scrim='not-applicable-fullscreen'
   if box['x']>5:
    page.mouse.click(2,2);assert opened();scrim='protected'
   page.keyboard.press('Escape');page.wait_for_timeout(350);assert not opened();assert page.evaluate('card.shadowRoot.activeElement===probeOpener')
   open_dialog();page.evaluate('history.back()');page.wait_for_timeout(350);assert not opened() and page.url==original_url
   open_dialog();page.evaluate("card._els.blockDialog.querySelector('.f-from').value='07:45'")
   page.keyboard.press('Escape');assert opened();assert page.evaluate("card._els.blockDialog.querySelector('.f-from').value==='07:45'")
   page.evaluate('history.back()');page.wait_for_timeout(350);assert opened() and page.url==original_url
   if box['x']>5:page.mouse.click(2,2);assert opened()
   page.once('dialog',lambda d:d.dismiss());page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="cancel"]').click();assert opened()
   page.once('dialog',lambda d:d.accept());page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="cancel"]').click();page.wait_for_timeout(350);assert not opened()
   open_dialog();page.evaluate("card._els.blockDialog.querySelector('.f-from').value='07:45'");page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="ok"]').click();page.wait_for_timeout(350);assert not opened()
   assert page.evaluate("card._model.monday[0].start===465&&card._model.monday[0].data.kept==='fixture'")
   # Save renders new blocks; focus returns to the corresponding day's track.
   assert page.evaluate("card.shadowRoot.activeElement?.classList.contains('track')")
   page.evaluate('card._model.monday[0].start=420;card._renderDays()')
   open_dialog()
   if width in [390,960]:page.locator('#schedule-r04-probe').locator('.block-dialog').screenshot(path=str(out/f'editor-{width}-{dark}.png'))
   page.keyboard.press('Escape');page.wait_for_timeout(350)
   report.append({'width':width,'dark':dark,'cleanScrim':scrim,'dirtyBack':'protected','dirtyEscape':'protected','focusTrap':True,'focusReturn':True,'saveDataKept':True,'urlKept':page.url==original_url})
 # A flaky day menu remains allowed to dismiss outside and is unchanged.
 page.evaluate("card._openDayDialog('monday')");page.keyboard.press('Escape');page.wait_for_timeout(350);assert not page.evaluate('card._els.dayDialog.open')
 page.emulate_media(reduced_motion='reduce');open_dialog();assert page.evaluate("getComputedStyle(card._els.blockDialog).animationName==='none'");page.keyboard.press('Escape');page.wait_for_timeout(350)
 browser.close()
summary={'native':native,'cases':report,'pageErrors':errors,'serviceCalls':0};(out/'report.json').write_text(json.dumps(summary,indent=2));print(json.dumps({'native':native,'cases':len(report),'pageErrors':errors,'serviceCalls':0}));assert not errors
