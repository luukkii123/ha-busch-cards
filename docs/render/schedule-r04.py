"""Real keyboard/back/scrim/focus/dirty checks. Synthetic data, optional HA host."""
import json,pathlib,sys,re
from playwright.sync_api import sync_playwright
from readonly_guard import install_readonly_guard
source=pathlib.Path(sys.argv[1]).read_text();out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
native=len(sys.argv)>3;prefix='r04-candidate-busch-' if native else 'busch-'
if native:source=source.replace('busch-',prefix)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(ignore_https_errors=True,locale='de-DE',viewport={'width':960,'height':1000});page=context.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append({'type':type(e).__name__,'locations':re.findall(r'/([A-Za-z0-9_.-]+\.js):(\d+):(\d+)',e.stack or '')}))
 if native:
  guard_counts=install_readonly_guard(context)
  private=json.loads(pathlib.Path(sys.argv[3]).read_text());base=private['base_url'].rstrip('/')
  auth={'hassUrl':base,'clientId':base+'/','expires':4102444800000,'expires_in':315360000,'refresh_token':'','access_token':private['token']}
  context.add_init_script('localStorage.setItem("hassTokens",JSON.stringify(%s))'%json.dumps(auth));page.goto(base+'/lovelace/0',wait_until='domcontentloaded',timeout=45000)
  page.wait_for_function("!!document.querySelector('home-assistant')?.hass && !!customElements.get('ha-card')",timeout=45000)
  page.wait_for_timeout(2000)
 else:
  page.set_content('''<style>body{margin:0;font-family:Arial}html{--primary-color:#0879d0;--error-color:#db4437;--primary-text-color:#212121;--secondary-text-color:#555;--card-background-color:#fff;--secondary-background-color:#eef5fb;--divider-color:#dbe4ed;--disabled-text-color:#777}</style>''');page.add_script_tag(content="customElements.define('ha-icon',class extends HTMLElement{})")
 page.add_script_tag(content='(function(){'+source+'})();' if native else source)
 page.evaluate('''({prefix,native})=>{window.host=document.createElement('main');host.id='schedule-r04-probe';host.style.cssText='position:fixed;top:0;left:0;width:100%;z-index:2147483647;background:var(--card-background-color);font-family:Arial';(native?document.querySelector('home-assistant').shadowRoot.querySelector('home-assistant-main').shadowRoot:document.body).append(host);const c=document.createElement(prefix+'schedule-card');window.card=c;c._load=async()=>{};c.setConfig({entity:'schedule.synthetic',title:'Synthetischer Zeitplan'});c.hass={locale:{language:'de'},states:{'schedule.synthetic':{state:'on',attributes:{friendly_name:'Synthetischer Zeitplan'}}},callWS:async()=>{throw Error('No host requests allowed')},callService:async()=>{throw Error('No services allowed')}};c._model=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>[day,[{start:420,end:600,data:{kept:'fixture'}}]]));c._readonly=false;c._save=()=>window.saves++;window.saves=0;c._renderAll();host.append(c)}''',{'prefix':prefix,'native':native})
 # Jede Zeile braucht eine direkte Touchaktion; Ziehen ist auf schmalen
 # Zeitspuren weder präzise noch für Tastaturbedienung verfügbar.
 add_controls=page.locator('#schedule-r04-probe .day .add-block')
 assert add_controls.count()==7, f'expected one visible add-block action per weekday, found {add_controls.count()}'
 for control in add_controls.all():
  assert control.get_attribute('aria-label')
  assert control.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44}')
 opened=lambda:page.evaluate('card._els.blockDialog.open')
 def open_dialog():
  page.evaluate("window.probeOpener=card.shadowRoot.querySelector('.block');probeOpener.focus()")
  page.keyboard.press('Enter');assert opened()
 def focus_trap():
  for _ in range(14):
   page.keyboard.press('Tab');assert page.evaluate('card._els.blockDialog.contains(card.shadowRoot.activeElement)')
  for _ in range(14):
   page.keyboard.press('Shift+Tab');assert page.evaluate('card._els.blockDialog.contains(card.shadowRoot.activeElement)')
 report=[]
 for dark in [False,True]:
  page.evaluate("dark=>{for(const [key,light,night] of [['--primary-text-color','#212121','#eee'],['--secondary-text-color','#555','#ccc'],['--card-background-color','#fff','#222'],['--secondary-background-color','#eef5fb','#303b47'],['--divider-color','#dbe4ed','#46505b']])host.style.setProperty(key,dark?night:light)}",dark)
  for width in [320,360,390,480,768,960]:
   page.set_viewport_size({'width':width,'height':1000});original_url=page.url
   open_dialog();focus_trap()
   box=page.evaluate('''()=>{const r=card._els.blockDialog.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}''')
   scrim='not-applicable-fullscreen'
   if box['x']>5:
    page.mouse.click(2,2);assert opened();scrim='protected'
   page.keyboard.press('Escape');page.wait_for_timeout(350);assert not opened();assert page.evaluate('card.shadowRoot.activeElement===probeOpener')
   open_dialog();page.evaluate('history.back()');page.wait_for_timeout(350);assert not opened() and page.url==original_url
   open_dialog();page.evaluate("card._els.blockDialog.querySelector('.f-from').value='07:45'")
   page.keyboard.press('Escape');assert opened();assert page.evaluate("card._els.blockDialog.querySelector('.f-from').value==='07:45'")
   page.evaluate('history.back()');page.wait_for_timeout(350);assert opened() and page.url==original_url
   if box['x']>5:page.mouse.click(2,2);assert opened()
   page.once('dialog',lambda d:d.dismiss());page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="cancel"]').click();assert opened()
   page.once('dialog',lambda d:d.accept());page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="cancel"]').click();page.wait_for_timeout(350);assert not opened()
   open_dialog();page.evaluate("card._els.blockDialog.querySelector('.f-from').value='07:45'");page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="ok"]').click();page.wait_for_timeout(350);assert not opened()
   assert page.evaluate("card._model.monday[0].start===465&&card._model.monday[0].data.kept==='fixture'")
   # Stable keyed rendering preserves focus on the existing block; a track is
   # also an acceptable fallback when the edited block itself vanished.
   assert page.evaluate("card.shadowRoot.activeElement?.classList.contains('block') || card.shadowRoot.activeElement?.classList.contains('track')")
   page.evaluate('card._model.monday[0].start=420;card._renderDays()')
   open_dialog()
   if width in [390,960]:page.locator('#schedule-r04-probe').locator('.block-dialog').screenshot(path=str(out/f'editor-{width}-{dark}.png'))
   page.keyboard.press('Escape');page.wait_for_timeout(350)
   report.append({'width':width,'dark':dark,'cleanScrim':scrim,'dirtyBack':'protected','dirtyEscape':'protected','focusTrap':True,'focusReturn':True,'saveDataKept':True,'urlKept':page.url==original_url})
 # A delayed close fallback for the previous modal session must not close a
 # newly reopened editor on the same native <dialog> element.
 page.evaluate("card._openBlockDialog('monday',0);card._resolveBlockDialog('cancel')")
 page.wait_for_function("!card._els.blockDialog.open")
 page.evaluate("card._openBlockDialog('monday',0)")
 assert opened()
 page.wait_for_timeout(350)
 assert opened(), 'stale close timeout closed the newly reopened block editor'
 page.evaluate("window.reopenedHistory=history.state;const input=card._els.blockDialog.querySelector('.f-from');input.value='07:30';input.focus();card._acceptScheduleItem({id:'synthetic',name:'updated',monday:[{from:'07:00',to:'10:00',data:{kept:'fixture'}}]});card._renderDays()")
 page.wait_for_timeout(350)
 assert page.evaluate("card._els.blockDialog.open && card._els.blockDialog.querySelector('.f-from').value==='07:30'")
 assert page.evaluate("card.shadowRoot.activeElement===card._els.blockDialog.querySelector('.f-from')")
 assert page.evaluate("history.state.busch_schedule_dialog?.endsWith('schedule-card:block') && card._els.blockDialog._buschPop!==null && !card._els.blockDialog._buschClosing")
 page.evaluate("window.__scheduleTestConfirm=window.confirm;window.confirm=()=>true;card._resolveBlockDialog('cancel');window.confirm=window.__scheduleTestConfirm;delete window.__scheduleTestConfirm")
 # Adding a draft never exposes delete semantics that could remove the last
 # saved block. Every cancellation path leaves the model and save count intact.
 page.evaluate("window.saves=0;window.savedBefore=JSON.stringify(card._model.monday);card._openNewBlockDialog('monday')")
 assert page.evaluate("card._els.blockDialog.querySelector('.dlg-del').hidden")
 page.evaluate("card._resolveBlockDialog('delete')")
 assert page.evaluate("JSON.stringify(card._model.monday)===savedBefore && window.saves===0")
 page.evaluate("card._openNewBlockDialog('monday');card._resolveBlockDialog('cancel')")
 assert page.evaluate("JSON.stringify(card._model.monday)===savedBefore && window.saves===0")
 page.evaluate("card._openNewBlockDialog('monday');card._els.blockDialog.querySelector('.f-from').value='05:00';card._resolveBlockDialog('escape')")
 assert page.evaluate("card._els.blockDialog.open && JSON.stringify(card._model.monday)===savedBefore && window.saves===0")
 page.evaluate("window.__scheduleTestConfirm=window.confirm;window.confirm=()=>true;card._resolveBlockDialog('cancel');window.confirm=window.__scheduleTestConfirm;delete window.__scheduleTestConfirm")
 assert page.evaluate("!card._els.blockDialog.open && JSON.stringify(card._model.monday)===savedBefore && window.saves===0")
 # Deleting a persisted block asks for specific confirmation. Dismiss leaves
 # every block and the save count untouched; acceptance removes only target.
 page.evaluate("card._model.monday=[{start:420,end:480,data:{kept:'first'}},{start:600,end:660,data:{kept:'target'}}];card._renderDays();window.saves=0;window.allBefore=JSON.stringify(card._model);card._openBlockDialog('monday',1)")
 dismissed_messages=[]
 page.once('dialog',lambda dialog:(dismissed_messages.append(dialog.message),dialog.dismiss()))
 page.evaluate("card._resolveBlockDialog('delete')")
 assert page.evaluate("card._els.blockDialog.open && JSON.stringify(card._model)===allBefore && window.saves===0")
 assert dismissed_messages and 'Montag' in dismissed_messages[0] and '10:00' in dismissed_messages[0] and '11:00' in dismissed_messages[0],dismissed_messages
 accepted_messages=[]
 page.once('dialog',lambda dialog:(accepted_messages.append(dialog.message),dialog.accept()))
 page.evaluate("card._resolveBlockDialog('delete')")
 assert page.evaluate("!card._els.blockDialog.open && card._model.monday.length===1 && card._model.monday[0].data.kept==='first' && window.saves===1")
 assert accepted_messages==dismissed_messages,accepted_messages
 # A 15-minute remaining gap can still be edited as a 15-minute block; a full
 # day has no available action.
 page.evaluate("card._model.monday=[{start:0,end:1425,data:{kept:'fixture'}}];card._model.tuesday=[{start:0,end:1440}];card._renderDays();window.saves=0")
 monday_add=page.locator('#schedule-r04-probe .day[data-day="monday"] .add-block')
 tuesday_add=page.locator('#schedule-r04-probe .day[data-day="tuesday"] .add-block')
 assert not monday_add.is_disabled()
 assert tuesday_add.is_disabled()
 monday_add.click()
 assert page.evaluate("card._els.blockDialog.open && card._els.blockDialog.querySelector('.f-from').value==='23:45' && card._els.blockDialog.querySelector('.f-to').value==='00:00'")
 page.evaluate("card._resolveBlockDialog('ok')")
 assert page.evaluate("card._model.monday.length===2 && card._model.monday[1].start===1425 && card._model.monday[1].end===1440 && window.saves===1")
 page.evaluate("card._model.monday=[{start:420,end:600,data:{kept:'fixture'}}];card._model.tuesday=[{start:420,end:600,data:{kept:'fixture'}}];card._renderDays();window.saves=0")
 # HA schedules declared in YAML are readonly. Keyboard entry is blocked.
 page.evaluate("card._hass.states['schedule.synthetic'].attributes.editable=false;card.shadowRoot.querySelector('.block').focus();card.shadowRoot.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))")
 assert not page.evaluate("card._els.blockDialog.open")
 page.evaluate("card._hass.states['schedule.synthetic'].attributes.editable=true")
 # Refresh/reorder/conflict and config echoes preserve the active editor after
 # the existing R04 keyboard/back matrix has run against the untouched fixture.
 page.evaluate("card._acceptScheduleItem({id:'synthetic',name:'focus-test',monday:[{from:'06:00',to:'06:30'},{from:'07:00',to:'10:00',data:{kept:'fixture'}}]});card._renderDays();window.focusStable=card.shadowRoot.querySelector('.day[data-day=\"monday\"] .block[data-index=\"1\"]');focusStable.focus();window.focusStableKey=focusStable.dataset.key;card._acceptScheduleItem({id:'synthetic',name:'focus-test',monday:[{from:'07:00',to:'10:00',data:{kept:'fixture'}},{from:'11:00',to:'12:00'}]});card._renderDays()")
 assert page.evaluate("card.shadowRoot.activeElement===focusStable && card.shadowRoot.querySelector('.block[data-key=\"'+focusStableKey+'\"]')===focusStable")
 page.evaluate("window.backendItem={id:'synthetic',name:'updated',monday:[{from:'06:00',to:'06:30'},{from:'07:00',to:'10:00',data:{kept:'fixture'}},{from:'11:00',to:'12:00'}]};window.stableAdd=card.shadowRoot.querySelector('.add-block');window.stableRow=stableAdd.parentElement;window.stableBlock=card.shadowRoot.querySelector('.block');window.stableTrack=card.shadowRoot.querySelector('.track');window.stableDays=card.shadowRoot.querySelector('.days');stableDays.style.cssText='max-height:40px;overflow:auto';stableDays.scrollTop=17;delete card._load;card._scheduleId='synthetic';card._hass.callWS=async()=>[window.backendItem];card._openBlockDialog('monday',0);card._els.blockDialog.querySelector('.f-from').value='08:15';const old=card._hass;card.hass={...old,states:{...old.states,'schedule.synthetic':{...old.states['schedule.synthetic'],attributes:{...old.states['schedule.synthetic'].attributes,next_event:'2030-01-01T00:00:00'}}}}")
 page.wait_for_function("!card._loading && card._item?.name==='updated'")
 assert page.evaluate("card.shadowRoot.querySelector('.days')===stableDays && stableDays.scrollTop===17 && card.shadowRoot.querySelector('.add-block')===stableAdd && stableAdd.parentElement===stableRow && card.shadowRoot.querySelector('.block[data-key=\"'+stableBlock.dataset.key+'\"]')===stableBlock && card.shadowRoot.querySelector('.track')===stableTrack")
 assert page.evaluate("card._els.blockDialog.open && card._els.blockDialog.querySelector('.f-from').value==='08:15'"), page.evaluate("({open:card._els.blockDialog.open,value:card._els.blockDialog.querySelector('.f-from').value,target:card._dialogTarget,readonly:card._readonly,loading:card._loading,item:card._item?.name})")
 page.evaluate("card._els.blockDialog.querySelector('.f-to').value='09:00';card._resolveBlockDialog('ok')")
 assert page.evaluate("card._model.monday[0].start===360 && card._model.monday[1].start===495 && card._model.monday[1].end===540 && card._model.monday.length===3")
 page.evaluate("card._openBlockDialog('monday',1);card._acceptScheduleItem({id:'synthetic',name:'updated',monday:[{from:'11:00',to:'12:00'},{from:'08:15',to:'09:00',data:{kept:'fixture'}},{from:'06:00',to:'06:30'}]})")
 assert page.evaluate("card._els.blockDialog.open && !card._dialogTarget.conflict")
 page.evaluate("card._resolveBlockDialog('cancel')");page.wait_for_timeout(350)
 page.evaluate("card._openBlockDialog('monday',1);card._els.blockDialog.querySelector('.f-from').value='08:30';card._acceptScheduleItem({id:'synthetic',name:'updated',monday:[{from:'11:00',to:'12:00'},{from:'06:00',to:'06:30'}]});card._resolveBlockDialog('ok')")
 assert page.evaluate("card._model.monday.length===2 && card._model.monday[0].start===360 && card._model.monday[1].start===660 && card._els.blockDialog.open && card._els.blockDialog.querySelector('.msg').textContent.length>0")
 page.evaluate("card._els.blockDialog.querySelector('.f-from').value='08:30';card.setConfig({title:'Synthetischer Zeitplan',entity:'schedule.synthetic'})")
 assert page.evaluate("card._els.blockDialog.open && card._els.blockDialog.querySelector('.f-from').value==='08:30'"), page.evaluate("({open:card._els.blockDialog.open,value:card._els.blockDialog.querySelector('.f-from').value,target:card._dialogTarget,config:card._config})")
 page.evaluate("card.setConfig({entity:'schedule.synthetic',title:'Kandidatstitel'});card._els.blockDialog.querySelector('.f-from').value='08:45';card.setConfig({title:'Kandidatstitel',entity:'schedule.synthetic'})")
 assert page.evaluate("card._els.blockDialog.open && card._els.blockDialog.querySelector('.f-from').value==='08:45' && card._config.title==='Kandidatstitel'")
 # The newest load wins if an older websocket response arrives last.
 page.evaluate("""async()=>{window.pendingLoads=[];card._hass.callWS=()=>new Promise(resolve=>pendingLoads.push(resolve));const old=card._load(false);while(pendingLoads.length<1)await new Promise(r=>setTimeout(r,0));const latest=card._load(false);while(pendingLoads.length<2)await new Promise(r=>setTimeout(r,0));pendingLoads[1]([{id:'synthetic',name:'latest',monday:[{from:'06:00',to:'06:30'}]}]);await latest;pendingLoads[0]([{id:'synthetic',name:'stale',monday:[{from:'05:00',to:'05:30'}]}]);await old;}""")
 assert page.evaluate("card._item.name==='latest' && card._model.monday[0].start===360")
 # A genuinely missing resource closes the editor and emits a visible notice.
 page.evaluate("window.notices=[];card.addEventListener('hass-notification',e=>notices.push(e.detail.message));card._hass.callWS=async()=>[];card._load(false)")
 page.wait_for_function("!card._loading")
 page.wait_for_timeout(350)
 assert page.evaluate("!card._els.blockDialog.open && notices.length===1 && notices[0].includes('schedule.synthetic') && !notices[0].includes('{entity}')")
 # A flaky day menu remains allowed to dismiss outside and is unchanged.
 page.evaluate("card._openDayDialog('monday')");page.keyboard.press('Escape');page.wait_for_timeout(350);assert not page.evaluate('card._els.dayDialog.open')
 page.emulate_media(reduced_motion='reduce');open_dialog();page.evaluate("card._els.blockDialog.querySelector('.f-from').value='07:45'");page.keyboard.press('Escape');assert opened();assert page.evaluate("getComputedStyle(card._els.blockDialog).animationName==='none'");page.once('dialog',lambda d:d.accept());page.locator('#schedule-r04-probe').locator('.block-dialog .actions button[data-act="cancel"]').click();page.wait_for_timeout(350)
 guard_report={**guard_counts,'websocketWritesBlocked':page.evaluate("(window.__blocked||[]).reduce((counts,type)=>{counts[type]=(counts[type]||0)+1;return counts},{})")} if native else {}
 browser.close()
summary={'guard':guard_report,'native':native,'cases':report,'pageErrors':errors,'serviceCalls':0};(out/'report.json').write_text(json.dumps(summary,indent=2));print(json.dumps({'native':native,'cases':len(report),'pageErrors':errors,'serviceCalls':0}));assert not errors
