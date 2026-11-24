"""Generic result mapping, editor round trip and responsive browser regression."""
import pathlib,sys,json
from playwright.sync_api import sync_playwright
# M26 (Abschlusstor 20.11.): shared measuring module hacs/docs/render/regeln.py (/work in the runner container), as in mapcard.py.
for _kandidat in ('/work', str(pathlib.Path(__file__).resolve().parents[3] / 'docs' / 'render')):
    if pathlib.Path(_kandidat, 'regeln.py').is_file():
        sys.path.insert(0, _kandidat)
        break
# M45: the repo CI job `contracts` (.github/ci-contracts.txt) has no regeln.py. Without it contrast/touch is not
# measured (kein_urteil in report.json) and the behaviour asserts still run; where /work exists (runner container)
# regeln.py stays mandatory. Same pattern as ha-unraid-cards/docs/render/unraid-cards.py.
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
KEIN_URTEIL='regeln.py nicht gefunden - Kontrast/Touch nicht gemessen (Repo-CI ohne /work)'
kt=({'kontrast':{'laeufe':[]},'touch':{'mindest_px':44,'laeufe':[]}} if regeln else
    {'kontrast':{'kein_urteil':KEIN_URTEIL},'touch':{'kein_urteil':KEIN_URTEIL}})
def kt_messen(page,selektor,**fall):
 if regeln is None:return
 m=regeln.messe_kontrast_touch_hier(page,selektor,ausnahmen=AUSNAHMEN)
 for bereich in kt:kt[bereich]['laeufe'].append({**fall,**m[bereich]})
# M79 (#1349): shared ha-icon stand-in with real MDI glyphs; report.json ha_icon {aktiv, fehlend} (kein_urteil without regeln.py).
def ha_icon_bericht(page):
 return regeln.ha_icon_fehlend(page) if regeln else {'kein_urteil':KEIN_URTEIL}
def ha_icon_ok(bericht):
 return 'kein_urteil' in bericht or (bericht.get('aktiv') is True and not bericht.get('fehlend'))
code=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(args=['--no-sandbox'])
 if regeln:regeln.ha_icon_attrappe(b)  # M79
 p=b.new_page(viewport={'width':320,'height':1000});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content('<style>body{margin:0;font-family:Arial;color:var(--primary-text-color);background:var(--card-background-color)}ha-form label{display:grid;margin-block:8px}input{min-width:0;max-width:100%;box-sizing:border-box}test-target{display:block;overflow-wrap:anywhere}</style>')
 p.add_script_tag(content='''/* Bildprüfung 19.11. (items-de-320-True: "Kartentyp" beside its field): the old stand-in put caption and input inline in the editor's shadow root, where the page style does not reach. Same stand-in as smart-entities.py (M31, like HA's ha-form): caption above the field. */
 customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}get schema(){return this._schema}set data(v){this._data=v;this.render()}get data(){return this._data}render(){this.replaceChildren();for(const f of this._schema||[]){/* M31: like HA's ha-form: caption above the field, selects show option labels, booleans as a checkbox with the caption to the right. */const label=document.createElement('label'),caption=document.createElement('span'),value=this._data?.[f.name],options=f.selector?.select?.options;caption.textContent=this.computeLabel?.(f)||f.name;let control;if(f.selector?.boolean){control=document.createElement('input');control.type='checkbox';control.checked=!!value;label.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0;min-height:44px';label.append(control,caption);}else{if(options){control=document.createElement('select');for(const o of options){const option=document.createElement('option');option.value=typeof o==='string'?o:o.value;option.textContent=typeof o==='string'?o:(o.label??o.value);control.append(option);}control.value=String(value??'');}else{control=document.createElement('input');control.value=value??'';}control.style.cssText='width:100%;min-height:44px;box-sizing:border-box';label.style.cssText='display:grid;gap:4px;margin:8px 0';label.append(caption,control);}control.setAttribute('aria-label',f.name);this.append(label)}}});
 class Target extends HTMLElement{setConfig(c){this.config=c;this.textContent=JSON.stringify(c)}set hass(h){}}customElements.define('test-target',Target);window.loadCardHelpers=async()=>({createCardElement:c=>{const el=document.createElement('test-target');el.setConfig(c);return el}});
 const states={},entities={},devices={};for(let i=0;i<9;i++){devices['d'+i]={id:'d'+i,name:'Device '+i};for(let j=0;j<3;j++){const id='sensor.e'+i+'_'+j;states[id]={entity_id:id,state:'unavailable',attributes:{friendly_name:id}};entities[id]={entity_id:id,device_id:'d'+i,platform:'demo'}}}states['sensor.orphan']={entity_id:'sensor.orphan',state:'unavailable',attributes:{}};
 window.h={states,entities,devices,areas:{},connection:{},locale:{language:'de'},formatEntityState:s=>s.state,callWS:async m=>m.type.includes('entity_registry')?Object.values(entities):m.type.includes('device_registry')?Object.values(devices):[]};window.cfg={filter:{include:[{state:'unavailable'}]},value:{type:'device_id',missing:'skip'},unique_values:true,sort:{method:'name',count:6},card:{type:'vertical-stack'},card_param:'cards',item:{type:'custom:busch-device-card',start_expanded:false,groups_open:[]},item_param:'device_id',debug:true};''')
 p.add_script_tag(content=code)
 p.evaluate("()=>{window.card=document.createElement('busch-smart-entities');card.setConfig(cfg);card.hass=h;document.body.append(card)}")
 p.wait_for_function("card._child?.config.cards?.length===6")
 assert p.evaluate("card._child.config.cards.every(c=>c.type==='custom:busch-device-card'&&c.device_id&&c.start_expanded===false)")
 debug=p.evaluate("JSON.parse(card.shadowRoot.querySelector('[data-debug]').textContent)")
 assert debug['projection']['duplicates']==18 and debug['projection']['missing']==1 and len(debug['generated']['cards'])==6
 p.evaluate("()=>{window.renders=card._renders;card._core.updateState('sensor.e0_1',{...h.states['sensor.e0_1'],attributes:{friendly_name:'Changed'}})}")
 p.wait_for_timeout(30);assert p.evaluate('card._renders===renders')
 p.evaluate("()=>card.setConfig({...cfg,filter:{include:[{domain:'weather'}]},show_empty:false})")
 p.wait_for_function('card.hidden')
 p.evaluate("()=>card.setConfig({...cfg,filter:{include:[{domain:'weather'}]},else:{type:'markdown',content:'Empty'}})")
 p.wait_for_function("card._child?.config.content==='Empty'")
 p.evaluate("()=>{card.remove();window.editor=document.createElement('busch-smart-entities-editor');editor.hass=h;editor.setConfig(cfg);document.body.append(editor);editor._showGroup('card');editor.addEventListener('config-changed',e=>window.saved=e.detail.config)}")
 # Changing binding does not discard static nested options or change active section.
 p.evaluate("()=>{const form=[...editor.shadowRoot.querySelectorAll('ha-form')].find(f=>f.schema.some(x=>x.name==='item_param'));form.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...form.data,item_param:'config.target'}}}))}")
 assert p.evaluate("saved.item_param==='config.target'&&saved.item.start_expanded===false&&Array.isArray(saved.item.groups_open)&&editor._activeGroup==='card'")
 cases=[]
 for lang in ['de','en']:
  p.evaluate("lang=>editor.hass={...h,locale:{language:lang}}",lang)
  for dark in [False,True]:
   p.evaluate("dark=>{for(const [key,value]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--secondary-background-color':dark?'#333':'#eee','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(key,value)}",dark)
   for width in [320,480,960]:
    p.set_viewport_size({'width':width,'height':1000});p.screenshot(path=str(out/f'items-{lang}-{width}-{dark}.png'),full_page=True)
    overflow=p.evaluate("()=>[...editor.shadowRoot.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left< -1)}).length")
    # M31 measuring check: every caption sits above its field (checkbox: caption to the right), all in one column.
    captions=p.evaluate("""()=>{const issues=[];for(const form of editor.shadowRoot.querySelectorAll('ha-form')){if(!form.getBoundingClientRect().height)continue;let left=null;for(const label of form.querySelectorAll('label')){const caption=label.querySelector('span'),control=label.querySelector('input,select'),a=caption.getBoundingClientRect(),b=control.getBoundingClientRect(),l=label.getBoundingClientRect();if(!l.height)continue;if(left===null)left=l.left;if(Math.abs(l.left-left)>1)issues.push({column:caption.textContent});if(control.type==='checkbox'){if(a.left<b.right-1)issues.push({checkbox:caption.textContent});}else if(a.bottom>b.top+1)issues.push({captionNotAbove:caption.textContent});}}return issues}""")
    kt_messen(p,'busch-smart-entities-editor',karte='editor',sprache=lang,breite=width,thema='dark' if dark else 'light')
    cases.append({'language':lang,'width':width,'dark':dark,'overflow':overflow,'captions':captions})
 # Disabling mapping restores raw-value configuration without erasing value projection.
 p.evaluate("()=>{const f=[...editor.shadowRoot.querySelectorAll('ha-form')].find(f=>f.schema.some(x=>x.name==='item_enabled'));f.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{item_enabled:false}}}))}")
 assert p.evaluate("!Object.hasOwn(saved,'item')&&!Object.hasOwn(saved,'item_param')&&saved.value.type==='device_id'")
 result={'cases':cases,'errors':errors,'mapping':True,'debug':True,'editorRoundTrip':True,'ha_icon':ha_icon_bericht(p),**kt};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not errors and all(x['overflow']==0 and not x['captions'] for x in cases)
 assert ha_icon_ok(result['ha_icon']),('M79 ha-icon stand-in not active or icons without a path',result['ha_icon'])
 assert regeln is None or regeln.bewerte(kt)==0,('Kontrast/Touch (M26): report.json kontrast/touch',regeln.zaehle(kt))
 b.close()
