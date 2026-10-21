"""Editor navigation and calendar containment in a fixed HA section cell."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(args=['--no-sandbox']);p=b.new_page(viewport={'width':320,'height':900});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content('''<style>body{margin:0;font-family:Arial;background:var(--card-background-color);color:var(--primary-text-color)}#cell{height:360px}ha-card{display:block;border:1px solid var(--divider-color);border-radius:12px}ha-form label{display:block;margin:8px 0}input{max-width:100%;box-sizing:border-box}busch-smart-entities-editor{display:block}</style><div id="cell"></div>''')
 p.add_script_tag(content='''customElements.define('ha-card',class extends HTMLElement{});customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}set data(v){this._data=v;this.render()}render(){this.replaceChildren();for(const f of this._schema||[]){const label=document.createElement('label');label.textContent=this.computeLabel?.(f)||f.name;const input=document.createElement('input');input.value=this._data?.[f.name]??'';label.append(input);this.append(label)}}});window.loadCardHelpers=async()=>({createCardElement:()=>document.createElement('div')});window.h={locale:{language:'de'},states:{'calendar.example':{state:'off',attributes:{},last_changed:'fixed'}},entities:{},devices:{},callApi:async()=>[]};''')
 p.add_script_tag(content=source)
 p.evaluate("()=>{window.cal=document.createElement('busch-calendar-card');cal.setConfig({entities:['calendar.example'],show_empty_days:true});cal.hass=h;document.querySelector('#cell').append(cal)}")
 p.wait_for_function('cal.querySelectorAll(".cal-tag").length>=28')
 initial=p.evaluate("()=>{const cell=document.querySelector('#cell').getBoundingClientRect(),card=cal.querySelector('ha-card').getBoundingClientRect();return {fixedCellOverflow:card.bottom>cell.bottom+1}}");p.evaluate("()=>{document.querySelector('#cell').style.height='auto';cal.preview=true}")
 p.screenshot(path=str(out/'calendar-preview-320.png'))
 initial['previewHeight']=p.evaluate('cal.getBoundingClientRect().height');initial['previewBounded']=initial['previewHeight']<=540
 p.evaluate("()=>{cal.remove();window.editor=document.createElement('busch-smart-entities-editor');editor.hass=h;editor.setConfig({card:{type:'entities'},filter:{include:[{integration:'sun',state:'< 20',attributes:{device_class:'battery'}}]},sort:{count:6}});document.body.append(editor);editor.addEventListener('config-changed',e=>window.saved=e.detail.config)}")
 p.evaluate("()=>{const tabs=editor.shadowRoot.querySelectorAll('[role=tab]');if(tabs.length){tabs[0].focus();tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));if(editor._activeGroup!=='card')throw Error('keyboard navigation');tabs[0].click()}}")
 nav=p.evaluate("editor.shadowRoot.querySelectorAll('[role=tab]').length");initial['tabs']=nav
 report=[]
 for dark in [False,True]:
  p.evaluate("dark=>{for(const [k,v] of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(k,v)}",dark)
  for width in [320,480,960]:
   p.set_viewport_size({'width':width,'height':900})
   p.screenshot(path=str(out/f'editor-{width}-{dark}.png'),full_page=True)
   overflow=p.evaluate("()=>[...editor.shadowRoot.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left< -1)}).length")
   report.append({'width':width,'dark':dark,'overflow':overflow})
 if nav==3:
  p.evaluate("()=>editor.shadowRoot.querySelector('[data-group=card][role=tab]').click()")
  assert p.evaluate("editor.shadowRoot.querySelector('[role=tab][aria-selected=true]').dataset.group==='card'")
  p.evaluate("()=>editor.shadowRoot.querySelector('[data-group=filters][role=tab]').click()")
  p.evaluate("()=>{const input=editor.shadowRoot.querySelector('.rule-value input');input.value='sun';input.dispatchEvent(new Event('change'))}")
  assert p.evaluate("saved.filter.include[0].integration==='sun'")
  assert p.evaluate("editor.shadowRoot.querySelector('[role=tab][aria-selected=true]').dataset.group==='filters'")
 b.close()
result={'calendar':initial,'cases':report,'errors':errors};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not initial['fixedCellOverflow'] and initial['previewBounded'] and nav==3 and not errors and all(not x['overflow']for x in report)
