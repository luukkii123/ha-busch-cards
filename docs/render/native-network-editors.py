"""Read-only native HA matrix. No dashboard save, service or real data writes."""
import json,re,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
credentials=Path(sys.argv[1]);bundles=[Path(sys.argv[2])];out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
private=json.loads(credentials.read_text());base=private['base_url'].rstrip('/')
auth={'hassUrl':base,'clientId':base+'/','expires':4102444800000,'expires_in':315360000,'refresh_token':'','access_token':private['token']}
tags=['busch-network-card','busch-fritz-device-card']
with sync_playwright() as pw:
 browser=pw.chromium.launch();context=browser.new_context(ignore_https_errors=True,viewport={'width':1000,'height':1200});context.add_init_script('localStorage.setItem("hassTokens",JSON.stringify(%s))'%json.dumps(auth));context.add_init_script("window.__rejections=[];addEventListener('unhandledrejection',e=>__rejections.push({code:e.reason?.code,keys:Object.keys(e.reason||{})}));")
 page=context.new_page();errors=[];ws_errors=[];
 def track_ws(ws):
  pending={}
  def sent(frame):
   try:
    data=json.loads(frame)
    for item in data if isinstance(data,list)else [data]:
     if isinstance(item,dict):pending[item.get('id')]=item.get('type')
   except (ValueError,TypeError):pass
  def received(frame):
   try:
    data=json.loads(frame)
    for item in data if isinstance(data,list)else [data]:
     if isinstance(item,dict)and item.get('type')=='result' and item.get('success')is False:ws_errors.append({'type':pending.get(item.get('id')),'code':item.get('error',{}).get('code')})
   except (ValueError,TypeError):pass
  ws.on('framesent',sent);ws.on('framereceived',received)
 page.on('websocket',track_ws); page.on('pageerror',lambda e:errors.append({'type':type(e).__name__,'stack':e.stack,'message':str(e),'asset':re.findall(r'/([A-Za-z0-9_.-]+\.js):(\d+):(\d+)',e.stack or '')}))
 page.goto(base+'/lovelace/0',wait_until='domcontentloaded');page.wait_for_function("!!document.querySelector('home-assistant')?.hass && !!customElements.get('ha-form')")
 page.evaluate("""()=>{window.__loadedBundles=0;window.earlyWS=[];window.preHass=document.querySelector('home-assistant').hass;const original=preHass.callWS.bind(preHass);preHass.callWS=msg=>original(msg).catch(error=>{earlyWS.push({type:msg.type,code:error.code});throw error;});}""")
 for prefix,bundle in zip(['busch-'],bundles):
  # Real module scope verifies independently loadable files and avoids collisions.
  page.add_script_tag(type='module',content=bundle.read_text().replace(prefix,'task5-'+prefix)+'\nwindow.__loadedBundles++;')
 page.wait_for_function('window.__loadedBundles===1')
 page.evaluate("""()=>{window.nativeHass=document.querySelector('home-assistant').hass;window.failedWS=[];for(const method of ['sendMessagePromise','subscribeMessage']){const original=nativeHass.connection[method].bind(nativeHass.connection);nativeHass.connection[method]=(...args)=>{const msg=args.find(v=>v&&typeof v==='object'&&v.type);const result=original(...args);return result?.catch?result.catch(error=>{failedWS.push({method,type:msg?.type,code:error?.code});throw error}):result;};}window.host=document.createElement('main');host.style.cssText='position:fixed;left:0;top:0;width:320px;background:var(--primary-background-color);z-index:10000;padding:0;box-sizing:border-box;';document.querySelector('home-assistant').shadowRoot.querySelector('home-assistant-main').shadowRoot.append(host);window.deepFind=(root,predicate)=>{if(root.shadowRoot){const found=deepFind(root.shadowRoot,predicate);if(found)return found;}for(const e of root.querySelectorAll('*')){if(predicate(e))return e;if(e.shadowRoot){const found=deepFind(e.shadowRoot,predicate);if(found)return found;}}};window.keyLeaks=[];document.addEventListener('keydown',e=>keyLeaks.push(e.key));window.freezeDeep=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freezeDeep);Object.freeze(v);}return v;};}""")
 rows=[]
 for tag in tags:
  print("native editor:",tag,flush=True)
  page.evaluate("""tag=>{host.replaceChildren();window.editor=document.createElement('task5-'+tag+'-editor');editor.style.cssText='display:block;width:100%;box-sizing:border-box';window.incoming={type:'custom:task5-'+tag,title:'Task5 original',task5_zero:0,task5_flag:false,task5_nested:{readonly:true}};if(tag==='busch-smart-entities')incoming.card_param='Task5 original';if(tag==='busch-map-card'){incoming.tile_api_key='Task5 original';incoming.entities=[];}if(tag==='localtrack-timeline-card'||tag==='localtrack-zone-time-card')incoming.entity='person.synthetic';if(tag==='localtrack-zone-time-card')incoming.zone='zone.synthetic';window.originalJSON=JSON.stringify(incoming);freezeDeep(incoming);window.events=[];editor.addEventListener('config-changed',e=>{events.push(JSON.parse(JSON.stringify(e.detail.config)));editor.setConfig(JSON.parse(JSON.stringify(e.detail.config)))});editor.hass=nativeHass;editor.setConfig(incoming);host.append(editor);if(tag==='busch-smart-entities')editor._showGroup('card');}""",tag)
  page.wait_for_function("!!deepFind(editor,e=>e.tagName==='INPUT'&&e.type==='text'&&e.value==='Task5 original')",timeout=15000)
  page.evaluate("""()=>{window.nativeInput=deepFind(editor,e=>e.tagName==='INPUT'&&e.type==='text'&&e.value==='Task5 original');window.nativeForm=deepFind(editor,e=>e.localName==='ha-form'&&(e.data?.title==='Task5 original'||e.data?.tile_api_key==='Task5 original'||e.data?.card_param==='Task5 original'));nativeInput.focus();nativeInput.select();}""")
  page.keyboard.type('aecdkAECDK',delay=10);page.wait_for_timeout(200)
  row=page.evaluate("""tag=>{const title=tag==='busch-map-card'?events.at(-1)?.tile_api_key:tag==='busch-smart-entities'?events.at(-1)?.card_param:events.at(-1)?.title;const focus=()=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;return e};const typingFocus=focus()===nativeInput;editor.hass={...nativeHass};editor.setConfig(JSON.parse(JSON.stringify(events.at(-1))));const stable=nativeInput.isConnected&&focus()===nativeInput&&nativeInput.value==='aecdkAECDK';for(const modifier of ['ctrlKey','metaKey'])nativeInput.dispatchEvent(new KeyboardEvent('keydown',{key:'k',[modifier]:true,bubbles:true,composed:true,cancelable:true}));nativeForm.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...nativeForm.data,...(tag==='busch-map-card'?{tile_api_key:'aecdkAECDK'}:tag==='busch-smart-entities'?{card_param:'aecdkAECDK'}:{title:'aecdkAECDK'}),task5_flag:false,task5_zero:0}},bubbles:true,composed:true}));const saved=events.at(-1);return {tag,nativeForm:!!nativeForm.shadowRoot,typed:title==='aecdkAECDK',typingFocus,focusStable:stable,falseSaved:saved.task5_flag===false,zeroSaved:saved.task5_zero===0,readonly:JSON.stringify(incoming)===originalJSON,fullPayload:saved.task5_nested?.readonly===true&&saved.type===incoming.type,shortcutLeaks:keyLeaks.length,events:events.length,sourceVersion:'0.3.0',widths:[]};}""",tag)
  page.locator('task5-'+tag+'-editor').locator('details[data-section=display]').evaluate('(e)=>e.open=true')
  page.wait_for_timeout(200)
  page.locator('task5-'+tag+'-editor').locator('ha-picker-field[aria-label="Media mode"]').click()
  page.get_by_role('menuitem',name='Icon',exact=True).click()
  page.wait_for_function("events.at(-1).display_mode==='icon'")
  page.locator('task5-'+tag+'-editor').locator('details[data-section=display]').evaluate('(e)=>e.open=false')
  page.locator('task5-'+tag+'-editor').locator('details[data-section=filters]').evaluate('(e)=>e.open=true')
  page.locator('task5-'+tag+'-editor').locator('ha-picker-field[aria-label="Sort by"]').click()
  page.get_by_role('menuitem',name='IP address',exact=True).click()
  page.wait_for_function("events.at(-1).sort.method==='ip'")
  row['physicalMediaSelect']=True;row['physicalSortSelect']=True
  page.evaluate("host.style.maxHeight='100vh';host.style.overflow='auto';editor._change({filter:{include:[{hostname:'example'}],exclude:[]}},true)")
  field=page.get_by_role('textbox',name='Hostname · Value',exact=True);field.click();field.press('ControlOrMeta+A');page.keyboard.type('example-*',delay=15)
  page.wait_for_function("events.at(-1).filter.include[0].hostname==='example-*'")
  row['physicalFilter']=page.evaluate("""()=>{const input=deepFind(editor,e=>e.tagName==='INPUT'&&e.value==='example-*');const before=events.length;editor.hass={...nativeHass};editor._change({show_status:false});editor.setConfig(JSON.parse(JSON.stringify(events.at(-1))));return {saved:events.at(-1).filter.include[0].hostname==='example-*',connected:input.isConnected,value:input.value==='example-*',fullPayload:events.at(-1).task5_nested?.readonly===true,events:events.length-before};}""")
  assert all(row['physicalFilter'][k]for k in ['saved','connected','value','fullPayload']),row['physicalFilter']
  page.evaluate("editor._sectionOpen.set('filters',false);editor.shadowRoot.querySelector('[data-section=filters]').open=false;host.style.maxHeight='';host.style.overflow=''")
  for width in (320,480,960):
   for theme in ('light','dark'):
    page.emulate_media(color_scheme=theme);page.wait_for_timeout(150)
    page.evaluate("width=>host.style.width=width+'px'",width)
    overflow=page.evaluate('editor.scrollWidth>editor.clientWidth+1');row['widths'].append({'width':width,'theme':theme,'overflow':overflow})
    page.locator('task5-'+tag+'-editor').screenshot(path=str(out/(tag+f'-{width}-{theme}.png')))
  if tag=='busch-smart-entities':
   row['primitives']=page.evaluate("""()=>{editor._showGroup('more');const section=[...editor.shadowRoot.querySelectorAll('.editor-section')].find(e=>e.dataset.section===editor._t.import);section.open=true;const input=section.querySelector('textarea'),button=section.querySelector('button'),error=section.querySelector('[role=alert]');const before=events.length;input.value='{';button.click();const rejected=events.length===before&&input.getAttribute('aria-invalid')==='true'&&!!error.textContent;input.value=JSON.stringify({entities:[],filter:{include:[]},unknown_optional:{flag:false,zero:0}});button.click();const accepted=events.at(-1)?.unknown_optional?.flag===false&&events.at(-1)?.unknown_optional?.zero===0;const summaries=[...editor.shadowRoot.querySelectorAll('.busch-ui-section>summary')].filter(e=>e.getBoundingClientRect().width);const actions=[...editor.shadowRoot.querySelectorAll('.busch-ui-action')].filter(e=>e.getBoundingClientRect().width);return {invalidNoEvent:rejected,validFullSnapshot:accepted,sectionTouch:summaries.every(e=>e.getBoundingClientRect().height>=44),actionTouch:actions.every(e=>e.getBoundingClientRect().height>=44&&e.getBoundingClientRect().width>=44),namedActions:actions.every(e=>!!e.getAttribute('aria-label'))};}""")
   assert all(row['primitives'].values()),row['primitives']
  row['newFields']=page.evaluate('''()=>{const forms=[...editor.shadowRoot.querySelectorAll('ha-form')],media=forms.find(f=>f.schema.some(s=>s.name==='display_mode')),sort=forms.find(f=>f.schema.some(s=>s.name==='method'));const before=events.length;media.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...media.data,display_mode:'icon',count:0,show_status:false}},bubbles:true,composed:true}));sort.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...sort.data,method:'ip',reverse:true}},bubbles:true,composed:true}));const saved=events.at(-1);return {mediaNative:!!media.shadowRoot,sortNative:!!sort.shadowRoot,mediaSaved:saved.display_mode==='icon',zeroSaved:saved.count===0,falseSaved:saved.show_status===false,sortSaved:saved.sort.method==='ip'&&saved.sort.reverse===true,fullPayload:saved.task5_nested?.readonly===true,events:events.length-before};}''')
  assert all(row['newFields'][k]for k in ['mediaNative','sortNative','mediaSaved','zeroSaved','falseSaved','sortSaved','fullPayload']),row['newFields']
  rows.append(row)
  assert all(row[k] for k in ['nativeForm','typed','typingFocus','focusStable','falseSaved','zeroSaved','readonly','fullPayload']),row
  assert not row['shortcutLeaks'] and not any(v['overflow'] for v in row['widths']),row
 result={'version':page.evaluate('nativeHass.config.version'),'editors':rows,'pageErrors':errors,'rejections':page.evaluate('__rejections'),'failedWS':page.evaluate('failedWS'),'earlyWS':page.evaluate('earlyWS'),'wsErrors':ws_errors};(out/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'version':result['version'],'editors':len(rows),'cases':sum(len(r['widths']) for r in rows),'pageErrors':len(errors),'rejections':len(result['rejections'])}));assert not errors and not result['rejections'];browser.close()
