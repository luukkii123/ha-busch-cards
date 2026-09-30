"""Synthetic quick-control contracts and theme/width gallery; no real services."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch();p=b.new_page(viewport={'width':1000,'height':1000});errors=[];p.on('pageerror',lambda e:errors.append(type(e).__name__))
 p.set_content('<style>body{margin:0;font-family:Arial;background:var(--card-background-color)}ha-card{display:block}ha-icon{display:block;width:24px;height:24px}ha-icon:after{content:"◇"}</style>')
 p.add_script_tag(content="""window.calls=[];window.leaks=[];window.loadCardHelpers=async()=>({createCardElement:()=>document.createElement('ha-card'),createRowElement:()=>document.createElement('div')});window.make=(domain,state,attrs={})=>{const id=domain+'.synthetic';return {locale:{language:'de'},config:{unit_system:{temperature:'°C'}},states:{[id]:{entity_id:id,state,attributes:attrs}},entities:{[id]:{entity_id:id,device_id:'d',platform:'demo'}},devices:{d:{id:'d',name:'Badezimmer mit sehr langem Gerätenamen',manufacturer:'Hersteller',model:'Modell'}},areas:{},connection:{},callWS:async m=>m.type.includes('device_registry')?[{id:'d',name:'Badezimmer mit sehr langem Gerätenamen',manufacturer:'Hersteller',model:'Modell'}]:m.type.includes('entity_registry')?[{entity_id:id,device_id:'d',platform:'demo'}]:[],callService:(...args)=>calls.push(args)}};""")
 p.add_script_tag(content=source)
 scenarios=[('light','on',{'brightness':128,'supported_color_modes':['brightness']}),('switch','off',{}),('fan','on',{'supported_features':57,'percentage':50,'preset_modes':['auto','quiet'],'preset_mode':'auto'}),('cover','open',{'supported_features':15,'current_position':0}),('lock','locked',{}),('climate','heat',{'supported_features':1,'temperature':21,'min_temp':7,'max_temp':35,'hvac_modes':['off','heat'],'target_temp_step':.5}),('media_player','playing',{'supported_features':261,'volume_level':0}),('button','unknown',{})]
 results=[]
 for domain,state,attrs in scenarios:
  p.evaluate("args=>{window.card?.remove();window.h=make(...args);window.card=document.createElement('busch-device-card');card.setConfig({device_id:'d',entity:args[0]+'.synthetic',quick_controls:true});card.hass=h;document.body.append(card);card.addEventListener('hass-more-info',()=>leaks.push('info'));card.addEventListener('keydown',()=>leaks.push('key'));card.addEventListener('click',()=>leaks.push('click'));}",[domain,state,attrs])
  p.wait_for_function("!!card._quickNodes?.length")
  if domain=='climate':
   assert p.evaluate("card._quick.textContent.includes('21 °C')")
   p.evaluate("()=>{const el=card._quick.querySelector('input');window.oldCalls=calls.length;el.value='22';el.dispatchEvent(new Event('input',{bubbles:true}));}")
   assert p.evaluate("card._quick.textContent.includes('22 °C')&&calls.length===oldCalls")
  for dark in [False,True]:
   p.evaluate("dark=>{for(const [k,v]of Object.entries({'--primary-text-color':dark?'#eee':'#222','--secondary-text-color':dark?'#bbb':'#555','--card-background-color':dark?'#222':'#fff','--secondary-background-color':dark?'#333':'#eee','--primary-color':'#03a9f4','--divider-color':dark?'#555':'#ddd'}))document.documentElement.style.setProperty(k,v)}",dark)
   for width in [320,480,960]:
    p.evaluate("width=>card.style.width=width+'px'",width);p.wait_for_timeout(20)
    geometry=p.evaluate("""()=>{const r=card.getBoundingClientRect();return {overflow:card.scrollWidth>card.clientWidth+1||[...card._quick.querySelectorAll('*')].some(e=>e.getBoundingClientRect().right>r.right+1),sizes:[...card._quick.querySelectorAll('button,input,select')].map(e=>({tag:e.tagName,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),touch:[...card._quick.querySelectorAll('button,input,select')].every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44})}}""")
    p.locator('busch-device-card').screenshot(path=str(out/f'{domain}-{width}-{dark}.png'));results.append({'domain':domain,'width':width,'dark':dark,**geometry});assert not geometry['overflow'] and geometry['touch'],results[-1]
  # Physical keyboard and pointer actions must remain in controls.
  el=p.locator('.dev-quick button').first
  if el.count():
   el.press('Enter');assert not p.evaluate('card._offen');el.click();assert not p.evaluate('card._offen')
  p.evaluate("()=>{const input=card._quick.querySelector('input');if(input){input.focus();window.focused=input;h={...h,states:{...h.states}};card.hass=h;if(document.activeElement!==input||!input.isConnected)throw Error('focus lost');input.value=input.min;input.dispatchEvent(new Event('change',{bubbles:true}));}const select=card._quick.querySelector('select');if(select){select.value=select.options[0].value;select.dispatchEvent(new Event('change',{bubbles:true}));}}")
  assert not p.evaluate('card._offen||leaks.length'),domain
  p.evaluate("()=>{h.states[card._entityId]={...h.states[card._entityId],state:'unavailable'};card.hass=h}")
  assert p.evaluate("[...card._quick.querySelectorAll('button,input,select')].every(e=>e.disabled)")
 # Filtering must suppress quick controls as well as Tile.
 p.evaluate("()=>{card.setConfig({device_id:'d',quick_controls:true,filter:{exclude:[{entity_id:'*'}]}});card.hass=h}");assert p.evaluate('card._quick.hidden')
 # Native media error fallback, explicit custom icon.
 p.evaluate("()=>{card.setConfig({device_id:'d',display_mode:'image',image:'data:image/png;base64,broken',icon:'mdi:star'});card.hass=h}");p.wait_for_function("!!card._icon.querySelector('ha-icon[icon=\"mdi:star\"]')")
 p.evaluate("()=>{card.remove();window.editor=document.createElement('busch-device-card-editor');editor.hass=h;editor.setConfig(Object.freeze({device_id:'d',quick_controls:true,title:'Original',extra:0}));document.body.append(editor);window.saved=[];editor.addEventListener('config-changed',e=>{saved.push(e.detail.config);editor.setConfig(JSON.parse(JSON.stringify(e.detail.config)))});editor._form.dispatchEvent(new CustomEvent('value-changed',{detail:{value:{...editor._form.data,quick_controls:false,image:'',icon:'mdi:star'}},bubbles:true}));}")
 assert p.evaluate("saved.length===1&&saved[0].quick_controls===false&&saved[0].extra===0&&saved[0].title==='Original'&&editor._form.data.quick_controls===false")
 result={'cases':results,'pageErrors':errors,'eventLeaks':p.evaluate('leaks'),'mockServices':p.evaluate('calls.length'),'focusStable':True,'editorRoundTrip':True};(out/'browser-report.json').write_text(json.dumps(result,indent=2));print(json.dumps({'cases':len(results),'pageErrors':errors,'mockServices':result['mockServices']}));assert not errors;b.close()
