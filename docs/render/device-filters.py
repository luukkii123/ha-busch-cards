"""Device-local predicate filtering, hidden filter metadata and visual editor."""
import pathlib,sys,json
from playwright.sync_api import sync_playwright
code=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(args=['--no-sandbox']);p=b.new_page(viewport={'width':320,'height':1000});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content('<style>body{margin:0;font-family:Arial;color:var(--primary-text-color);background:var(--card-background-color)}ha-card,ha-form{display:block}ha-form label{display:grid;margin-block:8px}input{min-width:0;max-width:100%;box-sizing:border-box}</style>')
 p.add_script_tag(content='''customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}get schema(){return this._schema}set data(v){this._data=v;this.render()}get data(){return this._data}render(){this.replaceChildren();for(const f of this._schema||[]){const label=document.createElement('label');label.textContent=this.computeLabel?.(f)||f.name;const input=document.createElement('input');input.value=this._data?.[f.name]??'';label.append(input);this.append(label)}}});
 customElements.define('ha-card',class extends HTMLElement{});customElements.define('test-row',class extends HTMLElement{set hass(h){}});customElements.define('test-tile',class extends HTMLElement{set hass(h){}});window.loadCardHelpers=async()=>({createCardElement:c=>{const el=document.createElement('test-tile');el.textContent=c.entity;return el},createRowElement:c=>{const el=document.createElement('test-row');el.textContent=c.entity;return el}});
 const states={},entities={},devices={d1:{id:'d1',name:'Device A'},d2:{id:'d2',name:'Device B'}};for(const [id,state,device,labels]of [['light.main','on','d1',[]],['sensor.a','unavailable','d1',[]],['sensor.b','on','d1',['ignore']],['sensor.c','off','d1',[]],['sensor.foreign','unavailable','d2',[]]]){states[id]={entity_id:id,state,attributes:{friendly_name:id}};entities[id]={entity_id:id,device_id:device,platform:'demo',labels}}
 window.h={states,entities,devices,areas:{},connection:{},locale:{language:'de'},formatEntityState:s=>s.state,callWS:async m=>m.type.includes('entity_registry')?Object.values(entities):m.type.includes('device_registry')?Object.values(devices):m.type.includes('label_registry')?[{label_id:'ignore',name:'ignore'}]:[]};window.cfg={device_id:'d1',entity:'light.main',start_expanded:true,groups_open:['control','sensor'],labels_hide:['ignore'],filter:{include:[{state:'unavailable'}]}};''')
 p.add_script_tag(content=code)
 p.evaluate("()=>{window.card=document.createElement('busch-device-card');card.setConfig(cfg);card.hass=h;document.body.append(card)}")
 p.wait_for_function("card.querySelectorAll('.dev-zeile').length===1")
 assert p.evaluate("card.querySelector('.dev-zeile').dataset.entity==='sensor.a'&&card.querySelector('.dev-tile').hidden&&!card.querySelector('.dev-chips').textContent&&!card.textContent.includes('ignore')")
 p.evaluate("()=>{window.before=card._core.metrics.structuralBuilds;card._core.updateState('sensor.foreign',{...h.states['sensor.foreign'],state:'on'})}")
 p.wait_for_timeout(50);assert p.evaluate('card._core.metrics.structuralBuilds===before')
 p.evaluate("()=>{h={...h,states:{...h.states,'sensor.c':{...h.states['sensor.c'],state:'unavailable'}}};card.hass=h}")
 p.wait_for_function("card.querySelectorAll('.dev-zeile').length===2")
 p.evaluate("()=>card.setConfig({...cfg,filter:{exclude:[{state:'unavailable'}]}})")
 p.wait_for_function("card.querySelectorAll('.dev-zeile').length===0&&!!card.querySelector('test-tile')")
 p.evaluate("()=>card.setConfig({...cfg,filter:{exclude:[{entity_id:'*'}]}})")
 p.wait_for_function("card.querySelector('.dev-tile').hidden&&card.querySelector('.dev-liste').textContent.includes('Keine passenden')")
 p.evaluate("()=>card.setConfig({...cfg,filter:undefined,title:'Testgerät mit einem absichtlich sehr langen Namen für mobile Karten'})")
 p.wait_for_function("card.querySelector('test-tile')&&card.querySelectorAll('.dev-zeile').length>=2")
 card_cases=[]
 for dark in [False,True]:
  p.evaluate("dark=>{for(const [k,v]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(k,v)}",dark)
  for width in [320,480,960]:
   p.set_viewport_size({'width':width,'height':1000})
   p.locator('busch-device-card').screenshot(path=str(out/f'device-card-{width}-{dark}.png'))
   overflow=p.evaluate("""()=>{const card=document.querySelector('busch-device-card'),bounds=card.getBoundingClientRect();return [...card.querySelectorAll('*')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).flatMap(e=>{const rect=e.getBoundingClientRect(),style=getComputedStyle(e);if(!rect.width||style.display==='none')return [];const clipped=style.overflow==='hidden'&&style.textOverflow==='ellipsis';return rect.left<bounds.left-1||rect.right>bounds.right+1||(!clipped&&e.scrollWidth>e.clientWidth+1)?[e.className||e.tagName]:[]})}""")
   card_cases.append({'width':width,'dark':dark,'overflow':overflow})
 assert not any(case['overflow'] for case in card_cases),card_cases
 # Ein zusammengeklappter Gerätekopf soll auf dem Handy die Höhe einer
 # HA-Kartenzeile behalten. Der Pfeil bleibt unabhängig davon gut treffbar.
 collapsed_cases=[]
 for width in [320,374,390,480]:
  p.set_viewport_size({'width':max(width,390),'height':1000})
  p.evaluate("width=>{card.style.width=width+'px';card._offen=false;card._zeigeListe()}",width)
  geometry=p.evaluate("""()=>{const head=card.querySelector('.dev-kopf').getBoundingClientRect(),arrow=card.querySelector('.dev-pfeil').getBoundingClientRect();return {headHeight:head.height,arrowWidth:arrow.width,arrowHeight:arrow.height,cardWidth:card.getBoundingClientRect().width}}""")
  p.locator('busch-device-card').screenshot(path=str(out/f'device-collapsed-{width}.png'))
  collapsed_cases.append({'width':width,**geometry})
 assert all(c['headHeight']<=76 and c['arrowWidth']>=44 and c['arrowHeight']>=44 for c in collapsed_cases),collapsed_cases
 old_open=p.evaluate("card._offen")
 p.locator("busch-device-card .dev-pfeil").press("Enter")
 assert p.evaluate("card._offen") != old_open
 assert p.evaluate("card._pfeil.getAttribute('aria-expanded')") == str(not old_open).lower()
 # M60: readable name at 320 px, measured. The finding's name "Wohnzimmer Deckenlampe" shows in
 # full in at most two lines (not cut), the subtitle sits below it, group heads are in sentence
 # case with a 24 px arrow in a >= 44 px head, and the keyboard folds a group (Enter, Space).
 p.evaluate("()=>{card.style.width='';card.setConfig({...cfg,filter:undefined,title:'Wohnzimmer Deckenlampe',start_expanded:true});card._offen=true;card._zeigeListe()}")
 p.wait_for_function("card.querySelectorAll('.dev-gruppe-kopf').length>=1")
 m60=[]
 for dark in [False,True]:
  p.evaluate("dark=>{for(const [k,v]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(k,v)}",dark)
  p.set_viewport_size({'width':320,'height':1000});p.wait_for_timeout(100)
  geo=p.evaluate("""()=>{const name=card.querySelector('.dev-name'),st=getComputedStyle(name),r=name.getBoundingClientRect(),lh=parseFloat(st.lineHeight);const unter=card.querySelector('.dev-unter');const heads=[...card.querySelectorAll('.dev-gruppe-kopf')].map(k=>{const a=k.querySelector('.dev-gruppe-pfeil').getBoundingClientRect(),s=getComputedStyle(k);return {h:k.getBoundingClientRect().height,arrow:[a.width,a.height],transform:s.textTransform,spacing:s.letterSpacing,expanded:k.getAttribute('aria-expanded')}});return {text:name.textContent,title:name.title,lines:Math.round(r.height/lh),cut:name.scrollHeight>name.clientHeight+1,below:unter.hidden||unter.getBoundingClientRect().top>=r.bottom-1,heads}}""")
  m60.append({'dark':dark,**geo})
  assert geo['text']=='Wohnzimmer Deckenlampe' and geo['title']==geo['text'] and geo['lines']<=2 and not geo['cut'] and geo['below'],geo
  assert all(h['h']>=44 and h['arrow']==[24,24] and h['transform']=='none' and h['spacing'] in ('normal','0px') for h in geo['heads']),geo
  p.locator('busch-device-card').screenshot(path=str(out/f'device-titel-320-{"dark" if dark else "light"}.png'))
 head=p.locator('busch-device-card .dev-gruppe-kopf').first
 before=head.get_attribute('aria-expanded')
 head.focus();p.keyboard.press('Enter')
 after_enter=head.get_attribute('aria-expanded')
 p.keyboard.press(' ')
 after_space=head.get_attribute('aria-expanded')
 keyboard={'before':before,'enter':after_enter,'space':after_space,'focused':p.evaluate("document.activeElement?.classList.contains('dev-gruppe-kopf')")}
 assert before!=after_enter and after_space==before and keyboard['focused'],keyboard
 p.evaluate("()=>{card.remove();window.editor=document.createElement('busch-device-card-editor');editor.setConfig({...cfg,tap_action:{action:'expand'}});editor.hass=h;document.body.append(editor);editor._filterDetails.open=true;editor.addEventListener('config-changed',e=>window.saved=e.detail.config)}")
 assert p.evaluate("!editor._form.schema.some(f=>['labels','labels_hide','filter'].includes(f.name))&&editor.firstElementChild===editor._filterHost")
 p.evaluate("()=>{const input=editor._filterRoot.querySelector('.rule-value input');input.value='off';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}))}")
 assert p.evaluate("saved.filter.include[0].state==='off'&&saved.labels_hide[0]==='ignore'&&saved.tap_action.action==='expand'&&editor._filterDetails.open")
 cases=[]
 for lang in ['de','en']:
  p.evaluate("lang=>editor.hass={...h,locale:{language:lang}}",lang)
  for dark in [False,True]:
   p.evaluate("dark=>{for(const [k,v]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(k,v)}",dark)
   for width in [320,480,960]:
    p.set_viewport_size({'width':width,'height':1000});p.screenshot(path=str(out/f'filters-{lang}-{width}-{dark}.png'),full_page=True)
    overflow=p.evaluate("()=>[...editor._filterRoot.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left< -1)}).length")
    cases.append({'width':width,'language':lang,'dark':dark,'overflow':overflow})
 result={'cases':cases,'card_cases':card_cases,'collapsed_cases':collapsed_cases,'m60':m60,'m60Keyboard':keyboard,'errors':errors,'stateUpdates':True,'deviceScope':True,'noChips':True,'editorRoundTrip':True};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not errors and all(c['overflow']==0 for c in cases);b.close()
