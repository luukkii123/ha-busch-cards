"""Synthetic UPDATED family gate; no HA access or real service calls."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
source=pathlib.Path(sys.argv[1]).read_text()
out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
fixture='''
customElements.define('ha-icon',class extends HTMLElement{connectedCallback(){this.textContent='◇';}});
window.core={devices:new Map(),entities:new Map(),getDeviceEntities(id){return [...this.entities.values()].filter(e=>e.device_id===id)},retain(){return()=>{}},watch(){return()=>{}},attach(){}};
const long='Eine virtuelle Maschine mit besonders langem Gerätenamen zur Prüfung';
for(const [id,model] of [['vm','Virtual machine'],['stack','Compose stack']])core.devices.set(id,{id,name:long,model,config_entries:['demo']});
window.put=(device,kind,key,role,state,extra={})=>{const domain=role==='control'?'switch':role==='restart'?'button':role==='update'?'update':'sensor',id=domain+'.'+device+'_'+key+'_'+role;core.entities.set(id,{entity_id:id,device_id:device,domain,platform:'unraid_ssh',config_entry_id:'demo',state,registry:{},attributes:{kind,role,config_entry_id:'demo',[kind==='vm'?'vm_key':kind==='stack'?'stack_key':'container_key']:key,vm_name:long,vm_state:'running',container_name:'Container mit einem besonders langen Namen '+key,image:'example/long-container:2026.09',stack_name:'Medienstack',...extra}});return id;};
put('vm','vm','Guest','control','on');put('vm','vm','Guest','restart','unknown');put('vm','vm','Guest','state','running');put('vm','vm','Guest','cpu','220.5');put('vm','vm','Guest','ram_used',String(2*1024**3));put('vm','vm','Guest','ram_allocated',String(8*1024**3));put('vm','vm','Guest','ram_max',String(16*1024**3));
put('stack','stack','media','control','on');put('stack','stack','media','restart','unknown');
for(const key of ['web','db']){put('stack','container',key,'control','on');put('stack','container',key,'restart','unknown');put('stack','container',key,'cpu','120');put('stack','container',key,'ram_used',String(600*1024**2));put('stack','container',key,'ram_limit',String(2*1024**3));}
window.baseline=JSON.stringify([...core.entities]);
'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1000,'height':1800});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('''<style>body{margin:0;font-family:Arial}ha-card{display:block;border:1px solid var(--divider-color);border-radius:16px}ha-icon{font-size:24px}html{--primary-color:#0879d0;--error-color:#db4437;--primary-text-color:#212121;--secondary-text-color:#555;--card-background-color:#fff;--secondary-background-color:#eef5fb;--divider-color:#dbe4ed;--success-color:#16864b;--warning-color:#a76900;--disabled-text-color:#777}</style>''')
 page.add_script_tag(content=source);page.add_script_tag(content=fixture);page.evaluate('window.ensureBuschCore=()=>core')
 report=[]
 for dark in [False,True]:
  page.evaluate("dark=>{for(const [key,light,night] of [['--primary-text-color','#212121','#eee'],['--secondary-text-color','#555','#ccc'],['--card-background-color','#fff','#222'],['--secondary-background-color','#eef5fb','#303b47'],['--divider-color','#dbe4ed','#46505b']])document.documentElement.style.setProperty(key,dark?night:light)}",dark)
  for width in [320,480,960]:
   for kind in ['stack','container','vm']:
    for scenario in ['normal','missing','unavailable','image-error','image-good','icon','compact']:
     page.evaluate('''({width,kind,scenario})=>{document.querySelectorAll('[data-test-card]').forEach(n=>n.remove());core.entities=new Map(JSON.parse(baseline));if(scenario==='missing')for(const e of core.entities.values())if(e.domain==='sensor'&&e.attributes.role!=='state')e.state='unavailable';if(scenario==='unavailable')for(const e of core.entities.values())e.state='unavailable';const c=document.createElement('busch-unraid-'+kind+'-card');c.dataset.testCard='true';c.style.width=width+'px';c.setConfig({device_id:kind==='vm'?'vm':'stack',container_key:'web',layout:scenario==='compact'?'compact':'detailed',...(scenario==='image-error'?{image:'data:image/png;base64,broken'}:scenario==='image-good'?{image:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Crect x=%228%22 y=%228%22 width=%2224%22 height=%2224%22 rx=%224%22 fill=%22%23808080%22/%3E%3C/svg%3E'}:scenario==='icon'?{display_mode:'icon',image:'data:image/png;base64,broken',icon:'mdi:server'}:{})});c.hass={locale:{language:'de'},callService:async(...args)=>{window.calls.push(args)}};window.calls=[];document.body.append(c)}''',{'width':width,'kind':kind,'scenario':scenario})
     if scenario=='image-error':page.wait_for_function("![...document.querySelector('[data-test-card]').shadowRoot.querySelectorAll('.busch-media')].some(n=>n.querySelector('img'))")
     if scenario=='image-good':page.wait_for_function("[...document.querySelector('[data-test-card]').shadowRoot.querySelectorAll('.busch-media img')].every(img=>img.complete&&img.naturalWidth>0)")
     if scenario=='icon':assert page.evaluate("document.querySelector('[data-test-card]').shadowRoot.querySelectorAll('.busch-media img').length")==0
     findings=page.evaluate('''()=>{const card=document.querySelector('[data-test-card]'),root=card.shadowRoot,bounds=card.getBoundingClientRect(),issues=[];for(const e of root.querySelectorAll('*')){const b=e.getBoundingClientRect(),s=getComputedStyle(e);if(!b.width||!b.height||s.display==='none')continue;if(b.right>bounds.right+1||b.left<bounds.left-1)issues.push({overflow:e.className});if(e.tagName==='BUTTON'&&(b.width<44||b.height<44))issues.push({touch:e.textContent});if([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!(s.overflow==='hidden'&&s.textOverflow==='ellipsis')&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1))issues.push({text:e.textContent});}return issues}''')
     text=page.evaluate("document.querySelector('[data-test-card]').shadowRoot.querySelector('ha-card').innerText")
     if kind=='vm' and scenario=='normal':assert '220,5 %' in text and 'RAM (Gastverbrauch)' in text and '2 GiB / 8 GiB' in text
     if scenario=='missing':assert 'Nicht verfügbar' in text
     if scenario=='unavailable':assert page.locator('[data-test-card]').get_by_role('button',name='Neu starten',exact=True).first.is_disabled()
     if scenario=='normal' and width==320 and not dark:
      page.once('dialog',lambda d:d.dismiss());page.get_by_role('button',name='Stoppen',exact=True).first.click();assert page.evaluate('calls.length')==0
      page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='Neu starten',exact=True).first.click();assert page.evaluate('calls[0][0]')=='button'
      detail=[];page.evaluate("document.querySelector('[data-test-card]').addEventListener('hass-more-info',e=>window.detail=e.detail)");page.get_by_role('button',name='Details',exact=True).first.click();assert page.evaluate('detail.entityId').startswith('switch.')
     file=f'{kind}-{scenario}-{width}-'+('dark' if dark else 'light')+'.png';page.locator('[data-test-card]').screenshot(path=str(out/file));report.append({'kind':kind,'scenario':scenario,'width':width,'dark':dark,'failures':findings,'screenshot':file})
 browser.close()
(out/'report.json').write_text(json.dumps({'cases':report,'errors':errors},indent=2))
print(json.dumps({'cases':len(report),'failures':sum(len(r['failures']) for r in report),'errors':errors}))
assert not errors and not any(r['failures'] for r in report)
