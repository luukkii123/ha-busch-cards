"""Targeted actual DOM regressions for network review; synthetic data, no live calls."""
import ast,json,pathlib,sys
from playwright.sync_api import sync_playwright
# M26/M79 (#1349): shared measuring module hacs/docs/render/regeln.py (/work in the runner container), as in mapcard.py.
for _kandidat in ('/work', str(pathlib.Path(__file__).resolve().parents[3] / 'docs' / 'render')):
    if pathlib.Path(_kandidat, 'regeln.py').is_file():
        sys.path.insert(0, _kandidat)
        break
# M45: the repo CI job `contracts` (.github/ci-contracts.txt) has no regeln.py. Without it contrast/touch and the shared
# ha-icon stand-in are not measured (kein_urteil in report.json), the page keeps its own stand-in and the behaviour asserts
# still run; where /work exists (runner container) regeln.py stays mandatory. Same pattern as smart-entities.py.
try:
    import regeln  # noqa: E402
except ImportError:
    if pathlib.Path('/work').is_symlink() or pathlib.Path('/work').exists():
        sys.exit('regeln.py nicht gefunden: der Container braucht -v "<hacs>/docs/render:/work" (hacs/docs/karten.md).')
    regeln = None
    print('Kontrast/Touch und ha-icon: NICHT gemessen - regeln.py fehlt (Repo-CI ohne /work)')
# M26: contrast (WCAG 1.4.3/1.4.11) and touch targets (>= 44 px) in every case of this script's own width/theme loop
# (regeln.messe_kontrast_touch_hier); exceptions only with a reason in kontrast-ausnahmen.json.
AUSNAHMEN=pathlib.Path(__file__).resolve().parent/'kontrast-ausnahmen.json'
KEIN_URTEIL='regeln.py nicht gefunden - nicht gemessen (Repo-CI ohne /work)'
kt=({'kontrast':{'laeufe':[]},'touch':{'mindest_px':44,'laeufe':[]}} if regeln else
    {'kontrast':{'kein_urteil':KEIN_URTEIL},'touch':{'kein_urteil':KEIN_URTEIL}})
def kt_messen(page,selektor,**fall):
 if regeln is None:return
 m=regeln.messe_kontrast_touch_hier(page,selektor,ausnahmen=AUSNAHMEN)
 for bereich in kt:kt[bereich]['laeufe'].append({**fall,**m[bereich]})
# M79: report.json ha_icon {aktiv, fehlend}: the shared stand-in drew every named icon with a real MDI path.
def ha_icon_bericht(page):
 return regeln.ha_icon_fehlend(page) if regeln else {'kein_urteil':KEIN_URTEIL}
def ha_icon_ok(bericht):
 return 'kein_urteil' in bericht or (bericht.get('aktiv') is True and not bericht.get('fehlend'))
def kt_ok():
 return regeln is None or regeln.bewerte(kt)==0
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
module=ast.parse(pathlib.Path(__file__).with_name('network-cards.py').read_text())
fixture=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in n.targets))
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 if regeln:regeln.ha_icon_attrappe(browser)  # M79: the fixture's own ha-icon (a diamond) is then ignored
 page=browser.new_page(viewport={'width':480,'height':1600});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<style>body{margin:0;font-family:Arial;background:var(--card-background-color);color:var(--primary-text-color)}html{--primary-color:#0879d0;--primary-text-color:#eee;--secondary-text-color:#bbb;--card-background-color:#222;--secondary-background-color:#303b47;--divider-color:#46505b;--success-color:#71cf94;--error-color:#db4437}</style>')
 page.add_script_tag(type='module',content=source+'\n'+fixture+'\nwindow.fixtureReady=true');page.wait_for_function('window.fixtureReady');core_setup='''()=>{core.seed(hass);window.events=0;document.addEventListener('hass-more-info',()=>events++);}''';page.evaluate(core_setup);results=[]
 for mode in ['details','tap','hold','double']:
  page.evaluate('''mode=>{document.querySelectorAll('[data-probe]').forEach(n=>n.remove());window.events=0;const action={action:'more-info'};window.config={count:1,...(mode==='details'?{}:{actions:[{name:'Custom',tap_action:action,...(mode==='hold'?{hold_action:action}:{}),...(mode==='double'?{double_tap_action:action}:{})}]})};window.c=document.createElement('busch-network-card');c.dataset.probe='true';c.style.width='320px';c.setConfig(config);c.hass=hass;document.body.append(c);window.button=[...c.shadowRoot.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===(mode==='details'?'Details':'Custom'));}''',mode)
  button=page.get_by_role('button',name='Details' if mode=='details' else 'Custom',exact=True).first
  def trigger():
   if mode=='hold':button.dispatch_event('pointerdown');page.wait_for_timeout(550);button.dispatch_event('pointerup')
   elif mode=='double':button.dblclick();page.wait_for_timeout(300)
   else:button.click();page.wait_for_timeout(10)
  if mode in ('details','tap'):kt_messen(page,'busch-network-card[data-probe]',karte='network',mode=mode,breite=320,thema='dark')
  trigger();before=page.evaluate('events');page.evaluate("mode=>{window.button=[...c.shadowRoot.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===(mode==='details'?'Details':'Custom'))}",mode);retained=page.evaluate('''()=>{c.setConfig(structuredClone(config));c.setConfig(structuredClone(config));return button.isConnected&&[...c.shadowRoot.querySelectorAll('button')].includes(button)}''');trigger();after=page.evaluate('events');results.append({'mode':mode,'retained':retained,'before':before,'after':after,'pass':retained and before==1 and after==2})
 page.evaluate('''()=>{c.remove();events=0;config={count:1,double_tap_action:{action:'more-info'}};c=document.createElement('busch-network-card');c.dataset.probe='true';c.setConfig(config);c.hass=hass;document.body.append(c)}''');page.get_by_role('button',name='Details',exact=True).first.click();page.evaluate("c.setConfig({...config,title:'Changed'})");page.wait_for_timeout(300);results.append({'mode':'pending-change','events':page.evaluate('events'),'pass':page.evaluate('events===0')})
 page.evaluate('''()=>{c.remove();events=0;c=document.createElement('busch-fritz-device-card');c.dataset.probe='true';c.setConfig({device_id:'router',show_clients:false,show_metrics:false,actions:[{name:'Custom',tap_action:{action:'more-info'}}]});c.hass=hass;document.body.append(c)}''');page.get_by_role('button',name='Custom',exact=True).click();page.evaluate('c.remove();document.body.append(c)');page.get_by_role('button',name='Custom',exact=True).click();results.append({'mode':'reattach-shell','events':page.evaluate('events'),'pass':page.evaluate('events===2')})
 for scenario in ['normal','more','empty']:
  result=page.evaluate('''async scenario=>{c.remove();const n=document.createElement('busch-network-card');n.setConfig({count:scenario==='more'?2:0,...(scenario==='empty'?{filter:{include:[{state:'no_match'}]}}:{})});n.hass=hass;document.body.append(n);let mutations=0;const observer=new MutationObserver(rs=>mutations+=rs.length);observer.observe(n.shadowRoot,{subtree:true,attributes:true,childList:true,characterData:true});n.hass={...hass};await new Promise(r=>setTimeout(r,0));observer.disconnect();n.remove();return {mode:'unrelated-'+scenario,mutations,pass:mutations===0}}''',scenario);results.append(result)
 page.evaluate('''()=>{add('binary_sensor.link','router','router-key-is_linked','off');core.seed(hass);c=document.createElement('busch-fritz-device-card');c.dataset.probe='true';c.style.width='320px';c.setConfig({device_id:'router',show_clients:false,show_metrics:false});c.hass=hass;document.body.append(c)}''');text=page.locator('[data-probe]').last.inner_text();text=page.evaluate("c.shadowRoot.querySelector('ha-card').innerText");results.append({'mode':'wan-separation','pass':'Verbunden' in text and 'WAN-Link' in text and 'Kein Link' in text})
 kt_messen(page,'busch-fritz-device-card[data-probe]',karte='fritz-device',mode='wan-separation',breite=320,thema='dark');page.locator('[data-probe]').last.screenshot(path=str(out/'wan-status-320-dark.png'))
 report={'cases':results,'errors':errors,'calls':page.evaluate('calls.length'),'ha_icon':ha_icon_bericht(page),**kt};(out/'report.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({k:v for k,v in report.items() if k not in ('kontrast','touch')}|{'kontrast_touch':regeln.zaehle(kt) if regeln else KEIN_URTEIL}));browser.close();assert not errors and not report['calls'] and all(r['pass']for r in results)
 assert ha_icon_ok(report['ha_icon']),('M79 ha-icon stand-in not active or icons without a path',report['ha_icon'])
 assert kt_ok(),('Kontrast/Touch (M26): report.json kontrast/touch',regeln.zaehle(kt))
