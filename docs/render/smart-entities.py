"""Synthetic Smart Entities browser behavior and six viewport/theme cases."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
fixture="""
customElements.define('ha-card',class extends HTMLElement{});
customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}get schema(){return this._schema}set data(v){this._data=v;this.render()}get data(){return this._data}render(){this.replaceChildren();for(const f of this._schema||[]){/* M31: like HA's ha-form: caption above the field, selects show option labels, booleans as a checkbox with the caption to the right. */const label=document.createElement('label'),caption=document.createElement('span'),value=this._data?.[f.name],options=f.selector?.select?.options;caption.textContent=this.computeLabel?.(f)||f.name;let control;if(f.selector?.boolean){control=document.createElement('input');control.type='checkbox';control.checked=!!value;label.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0;min-height:44px';label.append(control,caption);}else{if(options){control=document.createElement('select');for(const o of options){const option=document.createElement('option');option.value=typeof o==='string'?o:o.value;option.textContent=typeof o==='string'?o:(o.label??o.value);control.append(option);}control.value=String(value??'');}else{control=document.createElement('input');control.value=value??'';}control.style.cssText='width:100%;min-height:44px;box-sizing:border-box';label.style.cssText='display:grid;gap:4px;margin:8px 0';label.append(caption,control);}control.setAttribute('aria-label',f.name);this.append(label)}}});
// M31: the stand-in target card shows a neutral caption; its JSON was the raw line at the top of the editor images (harness artefact).
class Target extends HTMLElement{setConfig(c){this.config=c;this.calls=(this.calls||0)+1;this.textContent='Zielkarte'}set hass(h){this._hass=h}getCardSize(){return 1}}
customElements.define('test-target',Target);
window.loadCardHelpers=async()=>({createCardElement:c=>{const e=document.createElement('test-target');e.setConfig(c);return e;}});
const states={'sensor.a':{entity_id:'sensor.a',state:'10',attributes:{friendly_name:'Battery A',device_class:'battery'}},'sensor.b':{entity_id:'sensor.b',state:'80',attributes:{friendly_name:'Battery B',device_class:'battery'}},'light.other':{entity_id:'light.other',state:'on',attributes:{}}};
const entities=Object.fromEntries(Object.keys(states).map(entity_id=>[entity_id,{entity_id,platform:'demo',device_id:'device',labels:[]}]))
window.__h={connection:{},locale:{language:'de'},states,entities,devices:{device:{id:'device',name:'Device',labels:[]}},areas:{},formatEntityState:s=>s.state,requests:[],callWS:async msg=>{window.__h.requests.push(msg.type);return msg.type.includes('entity_registry')?Object.values(entities):msg.type.includes('device_registry')?Object.values(window.__h.devices):[]}};
window.__config={filter:{include:[{domain:'sensor',attributes:{device_class:'battery'},state:'< 20'}]},card:{type:'entities'}};
"""
FORM_CHECK="""()=>{/* M31 measuring check: captions above fields in one column, checkbox caption beside its box, selects show texts, tabs on one line, no raw JSON line. */const issues=[],raw=['attribute','skip','null','true','false','rows','entity_id','device_id','none'];for(const form of editor.shadowRoot.querySelectorAll('ha-form')){if(!form.getBoundingClientRect().height)continue;let left=null;for(const label of form.querySelectorAll('label')){const caption=label.querySelector('span'),control=label.querySelector('input,select'),a=caption.getBoundingClientRect(),b=control.getBoundingClientRect(),l=label.getBoundingClientRect();if(!l.height)continue;if(left===null)left=l.left;if(Math.abs(l.left-left)>1)issues.push({column:caption.textContent});if(control.type==='checkbox'){if(a.left<b.right-1||Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)>6)issues.push({checkbox:caption.textContent});}else if(a.bottom>b.top+1)issues.push({captionNotAbove:caption.textContent});if(control.tagName==='SELECT'&&raw.includes(control.selectedOptions[0]?.textContent))issues.push({rawValue:caption.textContent+'='+control.selectedOptions[0].textContent});}}for(const tab of editor.shadowRoot.querySelectorAll('[role=tab]')){const r=tab.getBoundingClientRect();if(r.height>49||tab.scrollHeight>tab.clientHeight+1)issues.push({tabWraps:tab.textContent});}for(const button of editor.shadowRoot.querySelectorAll('button'))if(/·/.test(button.textContent))issues.push({fragment:button.textContent});for(const select of editor.shadowRoot.querySelectorAll('select'))if(select.value==='true'&&select.selectedOptions[0]?.textContent==='true')issues.push({rawBoolean:true});if(/^\s*\{/.test(document.body.innerText))issues.push({rawJson:document.body.innerText.slice(0,40)});return issues}"""
with sync_playwright() as pw:
 browser=pw.chromium.launch(args=['--no-sandbox','--enable-precise-memory-info']);page=browser.new_page(viewport={'width':960,'height':1200});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<style>body{margin:0;font-family:Arial}ha-card{display:block;padding:16px}test-target{display:block;overflow-wrap:anywhere}ha-form label{display:grid;margin:8px}input{max-width:100%;min-width:0}html{--primary-color:#03a9f4;--primary-text-color:#222;--secondary-text-color:#555;--card-background-color:#fff;--divider-color:#bbb}</style>')
 page.add_script_tag(content=fixture);page.add_script_tag(content=source)
 page.evaluate("()=>{window.card=document.createElement('busch-smart-entities');card.setConfig(__config);card.hass=__h;document.body.append(card)}")
 page.wait_for_function("card.shadowRoot?.querySelector('test-target')?.config.entities?.length===1")
 page.evaluate("()=>{window.initial=card._renders;window.child=card._child;__h={...__h,states:{...__h.states,'light.other':{...__h.states['light.other'],state:'off'}}};card.hass=__h}")
 page.wait_for_timeout(50);assert page.evaluate('card._renders===initial&&card._child===child')
 page.evaluate("()=>{__h={...__h,states:{...__h.states,'sensor.b':{...__h.states['sensor.b'],state:'5'}}};card.hass=__h}")
 page.wait_for_function('card._child.config.entities.length===2')
 page.evaluate("()=>{card.setConfig({...__config,sort:{method:'state',numeric:true}})}")
 page.wait_for_function("card._child.config.entities[0].entity==='sensor.b'")
 page.evaluate("()=>{card.setConfig({...__config,filter:{include:[{domain:'weather'}]},show_empty:false})}")
 page.wait_for_function('card.hidden===true')
 page.evaluate("()=>{card.setConfig({...__config,filter:{include:[{domain:'weather'}]},show_empty:false,else:{type:'markdown',content:'Empty'}})}")
 page.wait_for_function("card.hidden===false&&card._child.config.content==='Empty'")
 page.evaluate("()=>{card.setConfig({...__config,value:{type:'device_id'},unique_values:true,card_param:'devices',card:{type:'custom:example'}})}")
 page.wait_for_function("card._child.config.devices?.[0]==='device'&&card._child.config.devices.length===1")
 page.evaluate("()=>{window.editor=document.createElement('busch-smart-entities-editor');editor.hass=__h;editor.setConfig({...__config,value:{type:'attribute',attribute:'device_class'},unique_values:true});document.body.append(editor);editor.addEventListener('config-changed',e=>window.saved=e.detail.config)}")
 page.wait_for_function('editor.shadowRoot.querySelectorAll("details").length>5')
 # Every field is accessible without YAML; builder adds a rule through its real button.
 page.evaluate("()=>{const details=[...editor.shadowRoot.querySelectorAll('details')].find(d=>d.firstChild.textContent==='Include-Filter');details.open=true;details.querySelector('button').click()}")
 assert page.evaluate('!!saved')
 report=[]
 for dark in [False,True]:
  page.evaluate("dark=>{document.documentElement.style.setProperty('--primary-text-color',dark?'#eee':'#222');document.documentElement.style.setProperty('--secondary-text-color',dark?'#ccc':'#555');document.documentElement.style.setProperty('--card-background-color',dark?'#222':'#fff');document.body.style.background=dark?'#222':'#fff'}",dark)
  for width in [320,480,960]:
   page.set_viewport_size({'width':width,'height':1200})
   page.evaluate("()=>{editor._showGroup('more');editor.shadowRoot.querySelectorAll('details').forEach(d=>d.open=false);const output=[...editor.shadowRoot.querySelectorAll('details')].find(d=>d.firstChild.textContent==='Ergebnisausgabe');output.open=true}")
   failures=page.evaluate("""()=>[card,editor].flatMap(host=>[...host.shadowRoot.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).display!=='none').filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1}).map(e=>e.tagName))""")
   failures+=page.evaluate(FORM_CHECK)
   # Bildprüfung 19.11.: the same caption-above check on the target card tab (Kartentyp, Zielparameter, item fields),
   # which the images of this script do not show; the image stays on the options tab.
   page.evaluate("()=>{editor._showGroup('card');editor.shadowRoot.querySelectorAll('details').forEach(d=>d.open=d.dataset.group==='card')}")
   failures+=[{'tab':'card',**f} for f in page.evaluate(FORM_CHECK)]
   page.evaluate("()=>{editor._showGroup('more');editor.shadowRoot.querySelectorAll('details').forEach(d=>d.open=false);const output=[...editor.shadowRoot.querySelectorAll('details')].find(d=>d.firstChild.textContent==='Ergebnisausgabe');output.open=true}")
   page.screenshot(path=str(out/('smart-'+str(width)+'-'+('dark' if dark else 'light')+'.png')))
   report.append({'width':width,'dark':dark,'failures':failures})
 page.evaluate("()=>{card.remove();editor.remove();window.__h.requests.length=0;window.cards=Array.from({length:25},()=>{const c=document.createElement('busch-smart-entities');c.setConfig(__config);c.hass=__h;document.body.append(c);return c})}")
 page.wait_for_function('cards.every(c=>c._child)')
 stats=page.evaluate("""async()=>{const core=globalThis[Symbol.for('busch.cards.core')],q=cards[0]._query,before=q.metrics.calculations,configs=cards.reduce((n,c)=>n+c._renders,0);let mutations=0;const observer=new MutationObserver(events=>mutations+=events.length);observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});const start=performance.now();__h={...__h,states:{...__h.states,'light.other':{...__h.states['light.other'],state:'unrelated'}}};for(const c of cards)c.hass=__h;await Promise.resolve();await Promise.resolve();const ms=performance.now()-start;observer.disconnect();return {cards:cards.length,shared:cards.every(c=>c._query===q),unrelatedRecalculations:q.metrics.calculations-before,targetConfigurations:cards.reduce((n,c)=>n+c._renders,0)-configs,domMutations:mutations,updateMs:ms,registryRequests:__h.requests,heap:performance.memory?.usedJSHeapSize??null}}""")
 assert stats['shared'] and stats['unrelatedRecalculations']==0 and stats['targetConfigurations']==0 and stats['domMutations']==0
 # Since 0.22.1 (#641/C2) the shared core keeps its registry cache for 30 s after the last release;
 # the 25 new cards arrive inside that grace period and must not fetch again (old: 5 fresh lists).
 # Never duplicated either way.
 assert len(stats['registryRequests'])==len(set(stats['registryRequests'])) and len(stats['registryRequests']) in (0,5)
 assert stats['registryRequests']==[], 'grace period expected: no registry refetch within 30 s'
 browser.close()
(out/'report.json').write_text(json.dumps({'cases':report,'errors':errors,'performance':stats,'behavior':'include/change/sort/empty/else/device-value/unique/unrelated-no-target-update/editor-change'},indent=2))
print(json.dumps({'cases':len(report),'failures':sum(len(r['failures'])for r in report),'errors':errors}));assert not errors and not any(r['failures']for r in report)
