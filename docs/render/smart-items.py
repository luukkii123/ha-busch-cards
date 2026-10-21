"""Generic result mapping, editor round trip and responsive browser regression."""
import pathlib,sys,json
from playwright.sync_api import sync_playwright
code=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(args=['--no-sandbox']);p=b.new_page(viewport={'width':320,'height':1000});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content('<style>body{margin:0;font-family:Arial;color:var(--primary-text-color);background:var(--card-background-color)}ha-form label{display:grid;margin-block:8px}input{min-width:0;max-width:100%;box-sizing:border-box}test-target{display:block;overflow-wrap:anywhere}</style>')
 p.add_script_tag(content='''customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}get schema(){return this._schema}set data(v){this._data=v;this.render()}get data(){return this._data}render(){this.replaceChildren();for(const f of this._schema||[]){const label=document.createElement('label');label.textContent=this.computeLabel?.(f)||f.name;const input=document.createElement('input');input.value=this._data?.[f.name]??'';label.append(input);this.append(label)}}});
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
    cases.append({'language':lang,'width':width,'dark':dark,'overflow':overflow})
 # Disabling mapping restores raw-value configuration without erasing value projection.
 p.evaluate("()=>{const f=[...editor.shadowRoot.querySelectorAll('ha-form')].find(f=>f.schema.some(x=>x.name==='item_enabled'));f.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{item_enabled:false}}}))}")
 assert p.evaluate("!Object.hasOwn(saved,'item')&&!Object.hasOwn(saved,'item_param')&&saved.value.type==='device_id'")
 result={'cases':cases,'errors':errors,'mapping':True,'debug':True,'editorRoundTrip':True};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not errors and all(x['overflow']==0 for x in cases)
 b.close()
