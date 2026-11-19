"""Calendar hass/config refresh retention smoke test; synthetic API only.

M25: compact month list measured against the finding (card height at 480 px at least 30 %
below 1411 px, date and time on one baseline, Today button) in kalender-kompakt-<w>-<theme>.png.

M23: HA's card helpers never answer here, so a tapped row stays in its waiting state
(aria-busy, dimmed) for the calendar-waiting-<width>-<theme>.png variants."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
sys.path.insert(0,"/work")
from regeln import bewerte, lauf_breiten, messe_text, _thema_setzen
source=pathlib.Path(sys.argv[1]).read_text()
out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={"width":480,"height":800})
 errors=[]
 page.on("pageerror",lambda error:errors.append(str(error)))
 page.set_content("<style>body{margin:0}ha-card{display:block}</style>")
 page.add_script_tag(content="window.customCards=[];customElements.define('ha-card',class extends HTMLElement{});customElements.define('ha-icon',class extends HTMLElement{});window.loadCardHelpers=()=>new Promise(()=>{});")
 page.add_script_tag(content=source)
 page.evaluate("""()=>{window.calls=0;window.hass={locale:{language:'en'},states:{'calendar.synthetic':{last_changed:'one'}},callApi:async(method,path)=>{calls++;const start=new Date(new URLSearchParams(path.split('?')[1]).get('start'));const events=[];for(let day=5;day<17;day++){const begins=new Date(start.getFullYear(),start.getMonth(),day,9),ends=new Date(start.getFullYear(),start.getMonth(),day,10);events.push({uid:`retention-${start.getFullYear()}-${start.getMonth()}-${day}`,summary:`Calendar appointment with a deliberately long title for responsive layout review ${day}`,location:'A long meeting-room label for measuring calendar text at narrow card widths',start:{dateTime:begins.toISOString()},end:{dateTime:ends.toISOString()}})}return events}};window.card=document.createElement('busch-calendar-card');card.setConfig({entities:['calendar.synthetic'],month_offset:0,show_empty_days:true,title:'Calendar refresh and responsive layout fixture'});card.hass=hass;document.body.append(card)}""")
 page.wait_for_selector(".cal-pfeil[data-schritt='1']")
 page.wait_for_function("calls>=1")
 page.wait_for_selector(".cal-liste .cal-termin[data-uid]")
 page.evaluate("card._versatzLaufend=1;card._render();window.next=card.querySelector('.cal-pfeil[data-schritt=\"1\"]');next.focus();window.list=card.querySelector('.cal-liste');list.style.cssText='height:60px!important;flex:none!important;overflow:auto!important';list.scrollTop=30;window.callCount=calls;card.setConfig({...card._config})")
 assert page.evaluate("card._versatzLaufend===1 && calls===callCount")
 page.evaluate("const old=hass;hass={...old,states:{...old.states,'calendar.synthetic':{last_changed:'two'}}};card.hass=hass")
 page.wait_for_function("calls>callCount")
 page.wait_for_timeout(50)
 result=page.evaluate("({focus:document.activeElement===card.querySelector('.cal-pfeil[data-schritt=\"1\"]'),scrollTop:card.querySelector('.cal-liste')?.scrollTop,monthOffset:card._versatzLaufend,calls})")
 assert result['focus'] and result['scrollTop']==30 and result['monthOffset']==1,result
 page.evaluate("list.style.cssText='';list.scrollTop=0")
 matrix=lauf_breiten(page,breiten=(320,390,480,960),themen=('light','dark'),messung=lambda current:messe_text(current,'busch-calendar-card'),hoehe=1900)
 totals={key:sum(len(case['messung'].get(key,[])) for case in matrix['laeufe']) for key in ('ueberlauf','ausserhalb','ueberlappung')}
 for theme in ('light','dark'):
  page.set_viewport_size({'width':390,'height':1900})
  _thema_setzen(page,theme)
  page.wait_for_timeout(400)
  page.locator('busch-calendar-card').screenshot(path=str(out/f'calendar-390-{theme}.png'))
 # M23 variant: tap a row; the waiting state is set in the same task and holds while HA's dialog bundle loads.
 page.set_viewport_size({'width':960,'height':1900})
 waiting=page.evaluate("()=>{const row=card.querySelector('.cal-liste .cal-termin[data-uid]');row.scrollIntoView({block:'center'});const t0=performance.now();row.click();return {busy:row.getAttribute('aria-busy'),dimmed:row.classList.contains('cal-termin-wartet'),sameTaskMs:performance.now()-t0}}")
 page.wait_for_timeout(300)
 waiting['heldAfter300ms']=page.evaluate("()=>card.querySelector('.cal-termin-wartet')?.getAttribute('aria-busy')==='true'")
 assert waiting['busy']=='true' and waiting['dimmed'] and waiting['heldAfter300ms'],waiting
 for width in (320,960):
  for theme in ('light','dark'):
   page.set_viewport_size({'width':width,'height':1900})
   _thema_setzen(page,theme)
   page.wait_for_timeout(400)
   assert page.evaluate("()=>!!card.querySelector('.cal-termin-wartet[aria-busy=\"true\"]')")
   page.locator('busch-calendar-card').screenshot(path=str(out/f'calendar-waiting-{width}-{theme}.png'))
 # M25: compact month, measured. Same fixture and page frame as render-kalender.py card A
 # (four events in August 2026, title, footer, body padding 16 px, Europe/Berlin). The month is
 # pinned to August 2026 through month_offset, so the run date does not matter.
 # Before: 1411 px card height at 480 px, read from the finding image kalender-karte-a-480-light.png
 # (2822 px high at device scale 2, run karten-20261118-101306-256e5c). Goal: at least 30 % less.
 VORHER_480=1411
 GRENZE_480=round(VORHER_480*0.7)
 kp=browser.new_page(viewport={'width':480,'height':1600},device_scale_factor=2,locale='de-DE',timezone_id='Europe/Berlin')
 kp.on('pageerror',lambda error:errors.append(str(error)))
 kp.set_content("<style>:root{--primary-color:#03a9f4;--primary-text-color:#212121;--secondary-text-color:#727272;--divider-color:#e0e0e0;--card-background-color:#fff;--secondary-background-color:#e5e5e5}body{margin:0;padding:16px;background:#f2f4f7;font-family:Roboto,sans-serif;color:var(--primary-text-color)}ha-card{display:block;background:var(--card-background-color);border-radius:12px;overflow:hidden}busch-calendar-card{display:block}</style><div id='wrap'></div>")
 kp.add_script_tag(content="window.customCards=[];customElements.define('ha-card',class extends HTMLElement{});customElements.define('ha-icon',class extends HTMLElement{});window.loadCardHelpers=()=>new Promise(()=>{});")
 kp.add_script_tag(content=source)
 kp.evaluate("""()=>{const now=new Date();const offset=(2026*12+7)-(now.getFullYear()*12+now.getMonth());const TERMINE=[{start:{dateTime:'2026-08-03T08:49:13+02:00'},end:{dateTime:'2026-08-03T16:15:08+02:00'},summary:'DZ',uid:'e1'},{start:{dateTime:'2026-08-04T06:30:00+02:00'},end:{dateTime:'2026-08-04T16:00:00+02:00'},summary:'TA',uid:'e2'},{start:{dateTime:'2026-08-05T09:00:07+02:00'},end:{dateTime:'2026-08-05T17:44:54+02:00'},summary:'DZ',uid:'e3'},{start:{date:'2026-08-10'},end:{date:'2026-08-13'},summary:'Urlaub',uid:'e4'}];window.kcard=document.createElement('busch-calendar-card');kcard.id='karte-a';kcard.setConfig({entities:['calendar.arbeitszeiten'],month_offset:offset,show_total:true,title:'Arbeitszeit'});kcard.hass={locale:{language:'de-DE'},states:{'calendar.arbeitszeiten':{state:'off',last_changed:'x',attributes:{friendly_name:'Arbeitszeiten'}}},callApi:async()=>JSON.parse(JSON.stringify(TERMINE))};document.getElementById('wrap').append(kcard)}""")
 kp.wait_for_selector('#karte-a .cal-termin[data-uid]')
 kompakt={'vorher480':VORHER_480,'grenze480':GRENZE_480,'faelle':[]}
 for width in (320,480):
  for theme in ('light','dark'):
   kp.set_viewport_size({'width':width,'height':1600})
   _thema_setzen(kp,theme)
   kp.wait_for_timeout(300)
   geo=kp.evaluate("""()=>{const k=document.getElementById('karte-a');const row=k.querySelector('.cal-tag:not(.cal-leer)');const nr=row.querySelector('.cal-nr').getBoundingClientRect(),zeit=row.querySelector('.cal-zeit').getBoundingClientRect();return {hoehe:Math.round(k.getBoundingClientRect().height),zeilen:k.querySelectorAll('.cal-tag').length,laeufe:k.querySelectorAll('.cal-lauf').length,datumZeitUnten:Math.round((zeit.bottom-nr.bottom)*10)/10,datumZeitOben:Math.round((zeit.top-nr.top)*10)/10,zeileHoehe:Math.round(row.getBoundingClientRect().height),termine:[...k.querySelectorAll('.cal-termin[data-uid]')].map(e=>Math.round(e.getBoundingClientRect().height)),knopf:[...k.querySelectorAll('.cal-kopf .cal-pfeil')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]})}}""")
   kompakt['faelle'].append({'breite':width,'thema':theme,**geo})
   # Date and the event time on one line: same baseline (bottoms within 3 px), one row.
   assert abs(geo['datumZeitUnten'])<=3 and geo['zeileHoehe']<=60,geo
   assert geo['zeilen']==31 and min(geo['termine'])>=44 and all(w>=44 and h>=44 for w,h in geo['knopf']),geo
   if width==480: assert geo['hoehe']<=GRENZE_480,geo
   kp.locator('#karte-a').screenshot(path=str(out/f'kalender-kompakt-{width}-{theme}.png'))
 # Today button: page back with the keyboard, then Today; the month returns and focus stays on it.
 kp.evaluate("()=>{kcard.querySelector('.cal-pfeil[data-schritt=\"-1\"]').focus()}")
 kp.keyboard.press('Enter')
 kp.wait_for_timeout(200)
 kp.evaluate("()=>{kcard.querySelector('.cal-heute-knopf').focus()}")
 kp.keyboard.press('Enter')
 kp.wait_for_timeout(300)
 heute=kp.evaluate("()=>({versatz:kcard._versatzLaufend,fokus:document.activeElement===kcard.querySelector('.cal-heute-knopf'),text:kcard.querySelector('.cal-heute-knopf').textContent})")
 kompakt['heuteKnopf']=heute
 assert heute['versatz']==0 and heute['fokus'] and heute['text']=='Heute',heute
 kp.close()
 report={'retention':result,'waiting':waiting,'kompakt':kompakt,'responsive':matrix,'violation_totals':totals,'pageErrors':errors,'responsive_cases':len(matrix['laeufe'])}
 (out/'report.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({'retention':result,'waiting':waiting,'kompakt':{k:v for k,v in kompakt.items() if k!='faelle'},'kompaktHoehen':[(c['breite'],c['thema'],c['hoehe']) for c in kompakt['faelle']],'responsive_cases':len(matrix['laeufe']),'violations':totals,'pageErrors':errors}))
 assert not bewerte(matrix) and not errors,report
 browser.close()
