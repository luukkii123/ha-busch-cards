"""Editor navigation and calendar containment in a fixed HA section cell."""
import json,pathlib,sys
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
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(args=['--no-sandbox'])
 if regeln:regeln.ha_icon_attrappe(b)  # M79
 p=b.new_page(viewport={'width':320,'height':900});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content('''<style>body{margin:0;font-family:Arial;background:var(--card-background-color);color:var(--primary-text-color)}#cell{height:360px}ha-card{display:block;border:1px solid var(--divider-color);border-radius:12px}ha-form label{display:block;margin:8px 0}input{max-width:100%;box-sizing:border-box}busch-smart-entities-editor{display:block}</style><div id="cell"></div>''')
 p.add_script_tag(content='''customElements.define('ha-card',class extends HTMLElement{});customElements.define('ha-form',class extends HTMLElement{set schema(v){this._schema=v;this.render()}get schema(){return this._schema}set data(v){this._data=v;this.render()}get data(){return this._data}render(){this.replaceChildren();for(const f of this._schema||[]){/* M31: like HA's ha-form: caption above the field, selects show option labels, booleans as a checkbox with the caption to the right. */const label=document.createElement('label'),caption=document.createElement('span'),value=this._data?.[f.name],options=f.selector?.select?.options;caption.textContent=this.computeLabel?.(f)||f.name;let control;if(f.selector?.boolean){control=document.createElement('input');control.type='checkbox';control.checked=!!value;label.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0;min-height:44px';label.append(control,caption);}else{if(options){control=document.createElement('select');for(const o of options){const option=document.createElement('option');option.value=typeof o==='string'?o:o.value;option.textContent=typeof o==='string'?o:(o.label??o.value);control.append(option);}control.value=String(value??'');}else{control=document.createElement('input');control.value=value??'';}control.style.cssText='width:100%;min-height:44px;box-sizing:border-box';label.style.cssText='display:grid;gap:4px;margin:8px 0';label.append(caption,control);}control.setAttribute('aria-label',f.name);this.append(label)}}});window.loadCardHelpers=async()=>({createCardElement:()=>document.createElement('div')});window.h={locale:{language:'de'},states:{'calendar.example':{state:'off',attributes:{},last_changed:'fixed'}},entities:{},devices:{},callApi:async()=>[]};''')
 p.add_script_tag(content=source)
 p.evaluate("()=>{window.cal=document.createElement('busch-calendar-card');cal.setConfig({entities:['calendar.example'],show_empty_days:true});cal.hass=h;document.querySelector('#cell').append(cal)}")
 p.wait_for_function('cal.querySelectorAll(".cal-tag").length>=28')
 initial=p.evaluate("()=>{const cell=document.querySelector('#cell').getBoundingClientRect(),card=cal.querySelector('ha-card').getBoundingClientRect();return {fixedCellOverflow:card.bottom>cell.bottom+1}}");p.evaluate("()=>{document.querySelector('#cell').style.height='auto';cal.preview=true}")
 p.screenshot(path=str(out/'calendar-preview-320.png'))
 kt_messen(p,'busch-calendar-card',karte='calendar-preview',breite=320,thema='light')
 initial['previewHeight']=p.evaluate('cal.getBoundingClientRect().height');initial['previewBounded']=initial['previewHeight']<=540
 p.evaluate("()=>{cal.remove();window.editor=document.createElement('busch-smart-entities-editor');editor.hass=h;editor.setConfig({card:{type:'entities'},filter:{include:[{integration:'sun',state:'< 20',attributes:{device_class:'battery'}}]},sort:{count:6}});document.body.append(editor);editor.addEventListener('config-changed',e=>window.saved=e.detail.config)}")
 p.evaluate("()=>{const tabs=editor.shadowRoot.querySelectorAll('[role=tab]');if(tabs.length){tabs[0].focus();tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));if(editor._activeGroup!=='card')throw Error('keyboard navigation');tabs[0].click()}}")
 nav=p.evaluate("editor.shadowRoot.querySelectorAll('[role=tab]').length");initial['tabs']=nav
 report=[]
 for dark in [False,True]:
  p.evaluate("dark=>{for(const [k,v] of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--secondary-background-color':dark?'#333':'#eee','--divider-color':dark?'#555':'#ddd','--primary-color':'#03a9f4'}))document.documentElement.style.setProperty(k,v)}",dark)
  for width in [320,360,390,480,960]:  # M76: phone widths 360/390
   p.set_viewport_size({'width':width,'height':900})
   p.screenshot(path=str(out/f'editor-{width}-{dark}.png'),full_page=True)
   overflow=p.evaluate("()=>[...editor.shadowRoot.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left< -1)}).length")
   layout=p.evaluate("""()=>{/* M31 measuring check: captions above fields in one column, checkbox caption beside its box, selects show texts, tabs on one line, no raw JSON line. */const issues=[],raw=['attribute','skip','null','true','false','rows','entity_id','device_id','none'];for(const form of editor.shadowRoot.querySelectorAll('ha-form')){if(!form.getBoundingClientRect().height)continue;let left=null;for(const label of form.querySelectorAll('label')){const caption=label.querySelector('span'),control=label.querySelector('input,select'),a=caption.getBoundingClientRect(),b=control.getBoundingClientRect(),l=label.getBoundingClientRect();if(!l.height)continue;if(left===null)left=l.left;if(Math.abs(l.left-left)>1)issues.push({column:caption.textContent});if(control.type==='checkbox'){if(a.left<b.right-1||Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)>6)issues.push({checkbox:caption.textContent});}else if(a.bottom>b.top+1)issues.push({captionNotAbove:caption.textContent});if(control.tagName==='SELECT'&&raw.includes(control.selectedOptions[0]?.textContent))issues.push({rawValue:caption.textContent+'='+control.selectedOptions[0].textContent});}}for(const tab of editor.shadowRoot.querySelectorAll('[role=tab]')){const r=tab.getBoundingClientRect();if(r.height>49||tab.scrollHeight>tab.clientHeight+1)issues.push({tabWraps:tab.textContent});}for(const button of editor.shadowRoot.querySelectorAll('button'))if(/·/.test(button.textContent))issues.push({fragment:button.textContent});for(const select of editor.shadowRoot.querySelectorAll('select'))if(select.value==='true'&&select.selectedOptions[0]?.textContent==='true')issues.push({rawBoolean:true});if(/^\s*\{/.test(document.body.innerText))issues.push({rawJson:document.body.innerText.slice(0,40)});return issues}""")
   kt_messen(p,'busch-smart-entities-editor',karte='editor',breite=width,thema='dark' if dark else 'light')
   report.append({'width':width,'dark':dark,'overflow':overflow,'layout':layout})
 if nav==3:
  p.evaluate("()=>editor.shadowRoot.querySelector('[data-group=card][role=tab]').click()")
  assert p.evaluate("editor.shadowRoot.querySelector('[role=tab][aria-selected=true]').dataset.group==='card'")
  p.evaluate("()=>editor.shadowRoot.querySelector('[data-group=filters][role=tab]').click()")
  p.evaluate("()=>{const input=editor.shadowRoot.querySelector('.rule-value input');input.value='zone';input.dispatchEvent(new Event('input',{bubbles:true}))}")
  assert p.evaluate("saved.filter.include[0].integration==='zone'")
  assert p.evaluate("editor.shadowRoot.querySelector('[role=tab][aria-selected=true]').dataset.group==='filters'")
 ha_icon=ha_icon_bericht(p)
 b.close()
result={'calendar':initial,'cases':report,'errors':errors,'ha_icon':ha_icon,**kt};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));assert not initial['fixedCellOverflow'] and initial['previewBounded'] and nav==3 and not errors and all(not x['overflow'] and not x['layout'] for x in report)
assert ha_icon_ok(ha_icon),('M79 ha-icon stand-in not active or icons without a path',ha_icon)
assert regeln is None or regeln.bewerte(kt)==0,('Kontrast/Touch (M26): report.json kontrast/touch',regeln.zaehle(kt))
