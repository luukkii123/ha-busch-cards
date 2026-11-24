"""Quick-control identity and draft races with browser DOM; only mock services.

M14 (#1283): keyboard batch (one call for five arrows), sent value held until a 1500 ms echo, busy power button;
the waiting state is captured at 320/960 px light and dark as wartet-power-<width>-<theme>.png.
M14 rest findings (#1300): the busy button carries a ring and a progress mark (not only its text), and a select
holds the chosen option until its echo."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
# M26 (#1349): shared measuring module hacs/docs/render/regeln.py (/work in the runner container), as in mapcard.py.
for _kandidat in ('/work', str(pathlib.Path(__file__).resolve().parents[3] / 'docs' / 'render')):
    if pathlib.Path(_kandidat, 'regeln.py').is_file():
        sys.path.insert(0, _kandidat)
        break
# M45: the repo CI job `contracts` (.github/ci-contracts.txt) has no regeln.py. Without it contrast/touch are not
# measured (kein_urteil in report.json) and the behaviour asserts still run;
# where /work exists (runner container) regeln.py stays mandatory. Same pattern as smart-entities.py.
try:
    import regeln  # noqa: E402
except ImportError:
    if pathlib.Path('/work').is_symlink() or pathlib.Path('/work').exists():
        sys.exit('regeln.py nicht gefunden: der Container braucht -v "<hacs>/docs/render:/work" (hacs/docs/karten.md).')
    regeln = None
    print('Kontrast/Touch: NICHT gemessen - regeln.py fehlt (Repo-CI ohne /work)')
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
def kt_ok():
 return regeln is None or regeln.bewerte(kt)==0
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch()
 if regeln:regeln.ha_icon_attrappe(b)  # M79: real MDI glyphs instead of empty squares
 p=b.new_page();errors=[];p.on('pageerror',lambda e:errors.append(type(e).__name__))
 p.set_content('<style>body{font-family:Arial}ha-card{display:block}</style>')
 p.add_script_tag(content="""window.calls=[];window.loadCardHelpers=async()=>({createCardElement:()=>document.createElement('ha-card'),createRowElement:()=>document.createElement('div')});window.build=(domain,rows)=>{window.card?.remove();const states={},entities={};for(const [id,state,attributes]of rows){states[id]={entity_id:id,state,attributes};entities[id]={entity_id:id,device_id:'d',platform:'demo'};}window.h={states,entities,devices:{d:{id:'d',name:'Synthetic device'}},areas:{},connection:{},config:{unit_system:{temperature:'°C'}},locale:{language:'en'},callService:(...c)=>calls.push(c),callWS:async m=>m.type.includes('entity_registry')?Object.values(entities):m.type.includes('device_registry')?[{id:'d',name:'Synthetic device'}]:[]};window.card=document.createElement('busch-device-card');card.setConfig({device_id:'d',quick_controls:true});card.hass=h;document.body.append(card)};window.temp=t=>{const s=h.states['climate.test'];h={...h,states:{...h.states,'climate.test':{...s,attributes:{...s.attributes,temperature:t}}}};card.hass=h};""")
 p.add_script_tag(content=source)
 attrs={'supported_color_modes':['brightness'],'brightness':128}
 p.evaluate("args=>build('light',args)",[['light.a','on',attrs],['light.b','on',attrs]])
 p.wait_for_function("card._entityId==='light.a'&&!!card._quickNodes?.[1]")
 p.evaluate("()=>{window.old=card._quickNodes[1];old.focus();old.value='200';old.dispatchEvent(new Event('input',{bubbles:true}));h={...h,states:{...h.states,'light.a':{...h.states['light.a'],state:'unavailable'}}};card.hass=h}")
 p.wait_for_function("card._entityId==='light.b'")
 assert p.evaluate("!old.isConnected&&old!==card._quickNodes[1]&&Number(card._quickNodes[1].value)===128")
 p.evaluate("()=>{old.dispatchEvent(new Event('change',{bubbles:true}));old.dispatchEvent(new FocusEvent('blur'));}");assert p.evaluate('calls.length===0')
 p.evaluate("()=>{h={...h,states:{...h.states,'light.a':{...h.states['light.a'],state:'on'}}};card.hass=h}")
 p.wait_for_function("card._entityId==='light.a'");p.evaluate("old.dispatchEvent(new Event('change',{bubbles:true}))");assert p.evaluate('calls.length===0')
 p.evaluate("()=>build('climate',[['climate.test','heat',{supported_features:1,temperature:21,min_temp:7,max_temp:35,target_temp_step:.5}]])")
 p.wait_for_function("card._entityId==='climate.test'&&!!card._quickNodes?.[0]")
 p.locator('.dev-quick input').focus()
 p.evaluate("()=>{window.slider=card._quickNodes[0];h={...h,states:{...h.states,'climate.test':{...h.states['climate.test'],attributes:{...h.states['climate.test'].attributes,temperature:23}}}};card.hass=h}")
 assert p.evaluate("document.activeElement===slider&&Number(slider.value)===23&&card._quickOutputs[0].textContent==='23 °C'")
 p.locator('.dev-quick input').press('ArrowRight')
 p.wait_for_function('calls.length===1',timeout=2000)  # M14: keyboard steps go out after the 400 ms batch
 assert p.evaluate("calls.length===1&&calls[0][2].temperature===23.5&&calls[0][2].entity_id==='climate.test'&&!card._offen")
 p.evaluate("()=>{temp(23.5);slider.value='24';slider.dispatchEvent(new Event('input',{bubbles:true}));temp(25);}")
 assert p.evaluate("Number(slider.value)===24&&card._quickOutputs[0].textContent==='24 °C'&&document.activeElement===slider&&calls.length===1")
 p.evaluate("slider.dispatchEvent(new Event('change',{bubbles:true}))");assert p.evaluate("calls.at(-1)[2].temperature===24&&calls.length===2")
 p.evaluate("()=>temp(24.5)");assert p.evaluate("Number(slider.value)===24.5&&document.activeElement===slider")
 p.evaluate("()=>{slider.value='26';slider.dispatchEvent(new Event('input',{bubbles:true}));temp(27);slider.blur();}");assert p.evaluate("Number(slider.value)===27&&calls.length===2")
 p.locator('.dev-quick input').focus();p.evaluate("()=>{slider.value='28';slider.dispatchEvent(new Event('input',{bubbles:true}));}");p.locator('.dev-quick input').press('Escape');assert p.evaluate("Number(slider.value)===27&&calls.length===2&&!card._offen")
 p.evaluate("()=>{slider.value='28';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));}");assert p.evaluate("Number(slider.value)===27&&calls.length===2")
 # M14: five arrow keys in one burst send one call; the sent value holds through an own update until the 1500 ms echo.
 p.locator('.dev-quick input').focus();before=p.evaluate('calls.length')
 for _ in range(5):p.locator('.dev-quick input').press('ArrowRight')
 p.wait_for_timeout(600);keyboard_coalesced=p.evaluate('calls.length')-before;sent=p.evaluate('calls.at(-1)[2].temperature')
 assert keyboard_coalesced==1 and sent==29.5,(keyboard_coalesced,sent)
 held=[]
 for at in [0,500,1000,1400]:
  if at==500:p.evaluate("()=>{const s=h.states['climate.test'];h={...h,states:{...h.states,'climate.test':{...s,attributes:{...s.attributes,current_temperature:20}}}};card.hass=h}")
  p.wait_for_timeout(at-(held[-1][0] if held else 0));held.append([at,p.evaluate('Number(slider.value)')])
 p.wait_for_timeout(100);p.evaluate(f"()=>temp({sent})");pending_held=all(v==sent for _,v in held) and p.evaluate(f"Number(slider.value)==={sent}")
 assert pending_held,held
 # M14: power button busy in the same tick; waiting state captured while the echo is delayed.
 p.evaluate("()=>build('switch',[['switch.a','off',{}]])");p.wait_for_function("!!card._quickNodes?.[0]")
 busy_ms=p.evaluate("()=>{const t=performance.now();card.querySelector('.dev-quick button').click();return card.querySelector('[aria-busy=\"true\"]')?performance.now()-t:-1}")
 assert 0<=busy_ms<=17,busy_ms
 assert p.evaluate("calls.at(-1)[1]==='turn_on'&&card.querySelector('.dev-quick button').textContent==='Switching …'")
 p.evaluate("()=>{card.querySelector('.dev-quick button').click()}");assert p.evaluate("calls.filter(c=>c[1]==='turn_on').length===1"),'second click while busy'
 busy_marker=p.evaluate("()=>{const b=card.querySelector('.dev-quick button[aria-busy=\"true\"]'),mark=getComputedStyle(b,'::before');return {ring:getComputedStyle(b).boxShadow!=='none',mark:mark.content!=='none'&&mark.content!=='normal'&&parseFloat(mark.width)>0}}")
 assert busy_marker['ring'] and busy_marker['mark'],busy_marker
 p.evaluate("()=>{document.body.style.margin='0';document.body.style.background='var(--card-background-color)'}")
 for dark in [False,True]:
  p.evaluate("dark=>{for(const [k,v]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--secondary-background-color':dark?'#333':'#eee','--primary-color':'#03a9f4','--divider-color':dark?'#555':'#ddd'}))document.documentElement.style.setProperty(k,v)}",dark)
  for width in [320,960]:
   p.evaluate("width=>card.style.width=width+'px'",width);p.wait_for_timeout(20)
   assert p.evaluate("!!card.querySelector('.dev-quick button[aria-busy=\"true\"]')")
   kt_messen(p,'busch-device-card',zustand='wartet-power',breite=width,thema='dark' if dark else 'light')
   p.locator('busch-device-card').screenshot(path=str(out/f"wartet-power-{width}-{'dark' if dark else 'light'}.png"))
 p.evaluate("()=>{h={...h,states:{...h.states,'switch.a':{...h.states['switch.a'],state:'on'}}};card.hass=h}")
 assert p.evaluate("!card.querySelector('[aria-busy=\"true\"]')&&card.querySelector('.dev-quick button').textContent==='Turn off'")
 # M14 rest finding: a select holds the chosen option through an own update until the 1500 ms echo.
 p.evaluate("()=>build('climate',[['climate.test','heat',{supported_features:0,hvac_modes:['off','heat','cool']}]])");p.wait_for_function("!!card.querySelector('.dev-quick select')")
 p.evaluate("()=>{window.sel=card.querySelector('.dev-quick select');sel.value='cool';sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));}")
 select_held=[]
 for at in [0,500,1400]:
  if at==500:p.evaluate("()=>{const s=h.states['climate.test'];h={...h,states:{...h.states,'climate.test':{...s,attributes:{...s.attributes,current_temperature:20}}}};card.hass=h}")
  p.wait_for_timeout(at-(select_held[-1][0] if select_held else 0));select_held.append([at,p.evaluate('sel.value')])
 p.evaluate("()=>{h={...h,states:{...h.states,'climate.test':{...h.states['climate.test'],state:'cool'}}};card.hass=h}")
 select_held_until_echo=all(v=='cool' for _,v in select_held) and p.evaluate("sel.value==='cool'&&calls.at(-1)[1]==='set_hvac_mode'")
 assert select_held_until_echo,select_held
 result={'ha_icon':regeln.ha_icon_fehlend(p) if regeln else {'kein_urteil':KEIN_URTEIL},'entityIdentity':True,'staleChangeRejected':True,'returnGenerationRejected':True,'noDraftTransfer':True,'focusWithoutDraftSync':True,'keyboardNextValue':23.5,'activeDraftProtected':True,'commitEchoSync':True,'blurEscapePointerCancelSync':True,'pendingHeldUntilEcho':pending_held,'keyboardCoalesced':keyboard_coalesced,'heldSamples':held,'busyMs':round(busy_ms,2),'busyMarker':busy_marker,'selectHeldUntilEcho':select_held_until_echo,'selectSamples':select_held,'waitingShots':['wartet-power-320-light.png','wartet-power-960-light.png','wartet-power-320-dark.png','wartet-power-960-dark.png'],'mockServices':p.evaluate('calls.length'),'pageErrors':errors,**kt}
 # ui-regeln.md (Etappe H): report.json carries kontrast/touch; interactions-report.json keeps its old name.
 hi=result['ha_icon'];assert 'kein_urteil' in hi or (hi.get('aktiv') is True and not hi.get('fehlend')),('M79 ha-icon stand-in',hi)
 for name in ('interactions-report.json','report.json'):(out/name).write_text(json.dumps(result,indent=2))
 print(json.dumps({k:v for k,v in result.items() if k not in ('kontrast','touch')}|{'kontrast_touch':regeln.zaehle(kt) if regeln else KEIN_URTEIL}));assert not errors
 assert kt_ok(),('Kontrast/Touch (M26): report.json kontrast/touch',regeln.zaehle(kt));b.close()
