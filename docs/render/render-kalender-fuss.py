#!/usr/bin/env python3
"""Zusatzmessung NUR fuer die Fusszeile der Kalenderkarte.

Aufruf:  python3 render-kalender-fuss.py <pfad/busch-cards.js> <ausgabeordner>

Warum eigens: `render-kalender.py` zeigt den Fuss immer mit DREI Werten, weil
seine Termindaten einen ganztaegigen Urlaub enthalten. "1 ganztaegig" erscheint
aber nur dann — ein reiner Dienstplan-Monat zeigt dauerhaft ZWEI Werte, und das
ist der Regelfall. Mit `justify-content: space-between` sassen die beiden dort
in den gegenueberliegenden Ecken (46-94 und 530-574 in einem 560 px breiten
Fuss, 436 px Leerraum). Diese Probe misst genau diesen Fall.

Aufbau von render-kalender.py uebernommen, auf das Noetige gekuerzt.
"""
import json, pathlib, shutil, subprocess, sys, time
from datetime import datetime
from playwright.sync_api import sync_playwright
# M26 (#1349): shared measuring module hacs/docs/render/regeln.py (/work in the runner container), as in mapcard.py.
# This script is a runner step only (not in .github/ci-contracts.txt), so regeln.py is mandatory here.
for _kandidat in ('/work', str(pathlib.Path(__file__).resolve().parents[3] / 'docs' / 'render')):
    if pathlib.Path(_kandidat, 'regeln.py').is_file():
        sys.path.insert(0, _kandidat)
        break
else:
    sys.exit('regeln.py nicht gefunden: der Container braucht -v "<hacs>/docs/render:/work" (hacs/docs/karten.md).')
import regeln  # noqa: E402
AUSNAHMEN = pathlib.Path(__file__).resolve().parent / "kontrast-ausnahmen.json"

JS = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"; SERVE.mkdir(exist_ok=True); shutil.copy(JS, SERVE / "busch-cards.js")

PAGE = """<!doctype html><meta charset="utf-8"><title>fuss</title>
<style>:root{--primary-color:#03a9f4;--primary-text-color:#212121;--secondary-text-color:#727272;
--divider-color:#e0e0e0;--error-color:#db4437;--ha-card-background:#fff;--secondary-background-color:#e5e5e5;}
body{margin:0;padding:16px;background:var(--primary-background-color,#f2f4f7);color:var(--primary-text-color);font-family:Roboto,sans-serif;}
#wrap{max-width:560px;margin:0 auto}
ha-card{display:block;background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}
busch-calendar-card{display:block;margin-bottom:20px}</style>
<div id="wrap"></div>
<script>
class HaCard extends HTMLElement{}
customElements.define('ha-card',HaCard);
class HaForm extends HTMLElement{}
customElements.define('ha-form',HaForm);
</script>
<script src="/busch-cards.js"></script>
<script>
/* Dieselben drei Zeittermine wie in render-kalender.py, ohne den Urlaub. */
const DREI=[{start:{dateTime:"2026-08-03T08:49:13+02:00"},end:{dateTime:"2026-08-03T16:15:08+02:00"},summary:"DZ",uid:"e1"},
 {start:{dateTime:"2026-08-04T06:30:00+02:00"},end:{dateTime:"2026-08-04T16:00:00+02:00"},summary:"TA",uid:"e2"},
 {start:{dateTime:"2026-08-05T09:00:07+02:00"},end:{dateTime:"2026-08-05T17:44:54+02:00"},summary:"DZ",uid:"e3"}];
const MIT=DREI.concat([{start:{date:"2026-08-10"},end:{date:"2026-08-13"},summary:"Urlaub",uid:"e4"}]);
const bau=(t)=>({locale:{language:"de-DE"},states:{"calendar.a":{last_changed:"1",attributes:{friendly_name:"A"}}},
  callApi:async()=>t});
const zwei=document.createElement("busch-calendar-card");
zwei.setConfig({entities:["calendar.a"],show_empty_days:false,show_total:true,title:"Zwei Werte (kein ganztaegiger Termin)"});
zwei.hass=bau(DREI);
const drei=document.createElement("busch-calendar-card");
drei.setConfig({entities:["calendar.a"],show_empty_days:false,show_total:true,title:"Drei Werte (mit Urlaub)"});
drei.hass=bau(MIT);
document.getElementById("wrap").append(zwei,drei);
</script>"""
(SERVE/"fuss.html").write_text(PAGE, encoding="utf-8")

srv = subprocess.Popen([sys.executable,"-m","http.server","8098","--directory",str(SERVE)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.5)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox"])
        p = b.new_page(viewport={"width":620,"height":900}, device_scale_factor=2,
                       locale="de-DE", timezone_id="Europe/Berlin")
        p.on("pageerror", lambda e: print("SEITENFEHLER:", e))
        p.clock.install(time=datetime(2026,8,15,12,0))
        p.goto("http://127.0.0.1:8098/fuss.html", wait_until="load")
        p.wait_for_selector(".cal-fuss", timeout=20000); p.wait_for_timeout(600)
        print(p.evaluate("()=>[...document.querySelectorAll('busch-calendar-card')].map(k=>({"
              "teile:[...k.querySelectorAll('.cal-fuss span')].map(s=>s.textContent),"
              "kaesten:[...k.querySelectorAll('.cal-fuss span')].map(s=>Math.round(s.getBoundingClientRect().left)+'-'+Math.round(s.getBoundingClientRect().right)),"
              "fussBreite:Math.round(k.querySelector('.cal-fuss').getBoundingClientRect().width),"
              "fussHoehe:Math.round(k.querySelector('.cal-fuss').getBoundingClientRect().height)}))"))
        for i,name in enumerate(("fuss-zwei-werte","fuss-drei-werte")):
            p.locator("busch-calendar-card").nth(i).screenshot(path=str(OUT/f"{name}.png"))
        # M26: contrast (WCAG 1.4.3/1.4.11) and touch targets (>= 44 px) of both footers' cards, light and dark,
        # at phone, middle and this page's width; after the images, so they stay as before. Violation = exit 1.
        kt = regeln.messe_kontrast_touch(
            p, {"zwei-werte": "busch-calendar-card:nth-of-type(1)", "drei-werte": "busch-calendar-card:nth-of-type(2)"},
            ausnahmen=AUSNAHMEN, breiten=(320, 480, 620), hoehe=900)
        (OUT / "report.json").write_text(json.dumps(kt, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"kontrast_touch": regeln.zaehle(kt)}))
        b.close()
        assert regeln.bewerte(kt) == 0, ("Kontrast/Touch (M26): report.json kontrast/touch", regeln.zaehle(kt))
finally:
    srv.terminate()
