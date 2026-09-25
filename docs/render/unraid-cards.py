import json,pathlib,sys
from playwright.sync_api import sync_playwright
out=pathlib.Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/unraid-browser');out.mkdir(exist_ok=True)
source=pathlib.Path(sys.argv[1]).read_text()
fixture="""
window.buschTexte=(t,h)=>t[h?.locale?.language?.startsWith('de')?'de':'en'];window.buschSchemaMitTexten=s=>s;
customElements.define('ha-icon',class extends HTMLElement{connectedCallback(){this.textContent=this.getAttribute('icon')==='mdi:docker'?'⬡':'◇';}});
const core={devices:new Map(),entities:new Map(),getDeviceEntities(id){return [...this.entities.values()].filter(e=>e.device_id===id)},retain(){return()=>{}},watch(){return()=>{}},attach(){}};
window.ensureBuschCore=()=>core;
core.devices.set('stack',{id:'stack',name:'Ein sehr langer Compose-Stackname für die Prüfung schmaler Karten',model:'Compose stack',config_entries:['demo']});
for(let i=0;i<3;i++)for(const [domain,role,state] of [['switch','control',i%2?'off':'on'],['button','restart','unknown'],['update','update','on']]){const id=domain+'.renamed_'+i;core.entities.set(id,{entity_id:id,device_id:'stack',platform:'unraid_ssh',config_entry_id:'demo',domain,state,attributes:{kind:'container',role,container_key:'key'+i,container_name:'Anwendungscontainer mit einem sehr langen Namen '+i,stack_key:'stack',stack_name:'Composeprojekt',image:'example/container-image:2026.09'},registry:{}});}
for(const [domain,role] of [['switch','control'],['button','restart']]){const id=domain+'.stack';core.entities.set(id,{entity_id:id,device_id:'stack',platform:'unraid_ssh',config_entry_id:'demo',domain,state:'on',attributes:{kind:'stack',role,stack_key:'stack'},registry:{}});}
"""
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1000,'height':1200})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content('<style>body{margin:0;font-family:Arial}ha-card{display:block;border:1px solid var(--divider-color);border-radius:16px}ha-icon{font-size:24px;line-height:1}html{--primary-color:#0879d0;--error-color:#db4437;--primary-text-color:#212121;--secondary-text-color:#555;--card-background-color:#fff;--secondary-background-color:#eef5fb;--divider-color:#dbe4ed;--success-color:#16864b;--warning-color:#a76900;--disabled-text-color:#777}</style>')
 page.add_script_tag(content=fixture);page.add_script_tag(content=source);page.evaluate('window.ensureBuschCore=()=>core')
 report=[]
 page.evaluate('window.unraidModernRows=JSON.parse(JSON.stringify([...core.entities]))')
 for backend in ['metadata','legacy']:
  page.evaluate("""backend=>{core.entities=new Map(JSON.parse(JSON.stringify(window.unraidModernRows)));if(backend==='legacy')for(const [id,e] of core.entities){if(e.domain==='button'){core.entities.delete(id);continue;}const a=e.attributes;e.registry.unique_id='demo_'+(a.kind==='stack'?'stack_'+a.stack_key:(e.domain==='update'?'update_':'container_')+a.container_name);e.attributes={friendly_name:a.container_name||'Compose stack'};}}""",backend)
  for dark in [False,True]:
   page.evaluate("dark=>{for(const [key,light,night] of [['--primary-text-color','#212121','#eee'],['--secondary-text-color','#555','#ccc'],['--card-background-color','#fff','#222'],['--secondary-background-color','#eef5fb','#303b47'],['--divider-color','#dbe4ed','#46505b'],['--success-color','#16864b','#56c689'],['--warning-color','#a76900','#e2aa50']])document.documentElement.style.setProperty(key,dark?night:light)}",dark)
   for width in [320,360,393,480,960]:
    for kind in ['stack','container']:
     page.evaluate("({width,kind,backend})=>{document.querySelectorAll('busch-unraid-stack-card,busch-unraid-container-card').forEach(n=>n.remove());window.unraidCalls=[];const c=document.createElement('busch-unraid-'+kind+'-card');c.style.width=width+'px';c.setConfig({device_id:'stack',container_key:backend==='legacy'?'legacy:Anwendungscontainer mit einem sehr langen Namen 0':'key0',...(width===393&&kind==='stack'?{start_expanded:false}:{})});c.hass={locale:{language:'de'},callService:async(...args)=>window.unraidCalls.push(args)};document.body.append(c)}",{'width':width,'kind':kind,'backend':backend})
     failures=page.evaluate("""()=>{const card=document.body.lastElementChild,root=card.shadowRoot,bounds=card.getBoundingClientRect();return [...root.querySelectorAll('*')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).flatMap(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);if(!b.width||s.display==='none')return [];const cut=s.overflow==='hidden'&&s.textOverflow==='ellipsis';return b.right>bounds.right+.5||b.left<bounds.left-.5||(!cut&&e.scrollWidth>e.clientWidth+1)||e.scrollHeight>e.clientHeight+1?[{tag:e.tagName,text:e.textContent,client:e.clientWidth,scroll:e.scrollWidth}]:[]})}""")
     failures+=page.evaluate("""()=>{const root=document.body.lastElementChild.shadowRoot,nodes=[...root.querySelectorAll('*')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.getBoundingClientRect().width),issues=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.contains(b)||b.contains(a))continue;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)issues.push({overlap:[a.textContent,b.textContent]});}return issues}""")
     failures+=page.evaluate("""()=>[...document.body.lastElementChild.shadowRoot.querySelectorAll('button')].flatMap(button=>{const rect=button.getBoundingClientRect();return rect.width<44||rect.height<44?[{control:button.textContent,width:rect.width,height:rect.height}]:[]})""")
     if backend=='metadata' and not dark and width==393 and kind=='stack':
      mobile=page.evaluate("""()=>{const root=document.body.lastElementChild.shadowRoot,buttons=[...root.querySelectorAll('.header > .actions button')],disclosure=root.querySelector('.disclosure'),card=root.querySelector('ha-card'),rects=buttons.map(button=>button.getBoundingClientRect()),toggle=disclosure.getBoundingClientRect();return {buttonCount:buttons.length,actionRows:new Set(rects.map(rect=>Math.round(rect.top))).size,disclosureGap:Math.round(toggle.top-Math.max(...rects.map(rect=>rect.bottom))),cardHeight:Math.round(card.getBoundingClientRect().height)}}""")
      if mobile['buttonCount']!=3 or mobile['actionRows']!=1:failures.append({'mobile_stack_actions':mobile})
      if mobile['disclosureGap']>16:failures.append({'mobile_stack_spacing':mobile})
     file=f'{backend}-{kind}-{width}-'+('dark' if dark else 'light')+'.png';page.locator('busch-unraid-'+kind+'-card').screenshot(path=str(out/file))
     report.append({'backend':backend,'kind':kind,'width':width,'dark':dark,'failures':failures,**({'mobile':mobile} if backend=='metadata' and not dark and width==393 and kind=='stack' else {})})
     if backend=='metadata' and not dark and width==320 and kind=='stack':
      page.once('dialog',lambda dialog:dialog.dismiss())
      page.get_by_role('button',name='Stoppen',exact=True).first.click()
      assert page.evaluate('window.unraidCalls.length')==0
      page.once('dialog',lambda dialog:dialog.accept())
      page.get_by_role('button',name='Neu starten',exact=True).first.click()
      assert page.evaluate('window.unraidCalls[0][0]')=='button'
      assert page.evaluate('window.unraidCalls[0][1]')=='press'
 page.evaluate("""()=>{for(const [key,value] of [['--primary-text-color','#212121'],['--secondary-text-color','#555'],['--card-background-color','#fff'],['--secondary-background-color','#eef5fb'],['--divider-color','#dbe4ed'],['--success-color','#16864b'],['--warning-color','#a76900']])document.documentElement.style.setProperty(key,value);core.entities=new Map(JSON.parse(JSON.stringify(window.unraidModernRows)));for(let i=3;i<16;i++)for(const domain of ['switch','button','update']){const entry=structuredClone(core.entities.get(domain+'.renamed_0'));entry.entity_id=domain+'.renamed_'+i;entry.attributes.container_key='key'+i;entry.attributes.container_name='Anwendungscontainer mit einem sehr langen Namen '+i;core.entities.set(entry.entity_id,entry);}document.querySelectorAll('busch-unraid-stack-card,busch-unraid-container-card').forEach(node=>node.remove());const card=document.createElement('busch-unraid-stack-card');card.style.width='360px';card.setConfig({device_id:'stack',start_expanded:true});card.hass={locale:{language:'de'}};document.body.append(card)}""")
 page.locator('busch-unraid-stack-card').screenshot(path=str(out/'metadata-stack-360-expanded-16-light.png'))
 large=page.evaluate("""()=>{const card=document.body.lastElementChild,root=card.shadowRoot;const expanded={containers:root.querySelectorAll('.row').length,height:Math.round(card.getBoundingClientRect().height),hasFixedRows:Object.hasOwn(card.getGridOptions(),'rows'),horizontalOverflow:root.querySelector('ha-card').scrollWidth>root.querySelector('ha-card').clientWidth+1};root.querySelector('.disclosure').click();return {...expanded,collapsedHeight:Math.round(card.getBoundingClientRect().height),collapsedContainers:root.querySelectorAll('.row').length,collapsedHasFixedRows:Object.hasOwn(card.getGridOptions(),'rows')}}""")
 large_failures=[]
 if large['containers']!=16 or large['collapsedContainers']!=0:large_failures.append({'container_count':large})
 if large['hasFixedRows'] or large['collapsedHasFixedRows']:large_failures.append({'fixed_grid_rows':large})
 if large['horizontalOverflow'] or large['height']<=large['collapsedHeight']:large_failures.append({'expanded_layout':large})
 report.append({'backend':'metadata','kind':'stack','width':360,'dark':False,'expanded_containers':16,'metrics':large,'failures':large_failures})
 browser.close()
(out/'report.json').write_text(json.dumps({'cases':report,'errors':errors},indent=2))
print(json.dumps({'cases':len(report),'failures':sum(len(r['failures']) for r in report),'errors':errors}))
assert not errors and not any(r['failures'] for r in report)
