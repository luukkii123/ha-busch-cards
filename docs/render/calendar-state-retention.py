"""Calendar hass/config refresh retention smoke test; synthetic API only."""
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
 page.add_script_tag(content="window.customCards=[];customElements.define('ha-card',class extends HTMLElement{});customElements.define('ha-icon',class extends HTMLElement{});")
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
 report={'retention':result,'responsive':matrix,'violation_totals':totals,'pageErrors':errors,'responsive_cases':len(matrix['laeufe'])}
 (out/'report.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({'retention':result,'responsive_cases':len(matrix['laeufe']),'violations':totals,'pageErrors':errors}))
 assert not bewerte(matrix) and not errors,report
 browser.close()
