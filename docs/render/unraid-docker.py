#!/usr/bin/env python3
"""busch-unraid-docker-card im Playwright-Container: Darstellung, Menü, E2E.

Aufruf (Mounts wie in hacs/docs/karten.md, „Die Landkarte“):

    docker run --rm --name test-hacs-t0-docker-render \
      -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/repo" \
      -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/unraid-docker.py /repo/dist/busch-cards.js /tmp/docker-out'

Die Seite kommt über eine eigene Ursprungsadresse (page.route), damit jede
Netzanfrage protokolliert wird und die Containerbilder echte PNG-Antworten
sind (drei Seitenverhältnisse), keine data:-Abkürzung. Erfundene Daten, keine
Live-Installation, keine Service-Aufrufe nach außen.
"""
import json
import pathlib
import struct
import sys
import zlib

sys.path.insert(0, "/work")
from playwright.sync_api import sync_playwright  # noqa: E402
from regeln import bewerte, lauf_breiten, messe_popup, messe_text, schreibe, selbsttest, zaehle  # noqa: E402

BUNDLE = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/docker-out")
OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = "http://karten.test"
BREITEN = (320, 375, 414, 480, 600, 960, 1280)
SPALTEN_SOLL = {320: 1, 375: 1, 414: 1, 480: 1, 600: 2, 960: 3, 1280: 4}


def png(w, h, rgb):
    """Kleines echtes PNG: farbige Fläche mit transparentem Rand."""
    rows = b""
    for y in range(h):
        row = b"\x00"
        for x in range(w):
            inside = 4 <= x < w - 4 and 4 <= y < h - 4
            row += bytes(rgb) + (b"\xff" if inside else b"\x00")
        rows += row
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


BILDER = {"quadrat": png(64, 64, (229, 160, 13)), "breit": png(96, 48, (0, 130, 202)), "hoch": png(48, 96, (64, 170, 90))}

SEITE = """<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:Roboto,Arial,sans-serif;background:var(--primary-background-color)}
#wrap{padding:8px}ha-card{display:block;border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);background:var(--ha-card-background,var(--card-background-color))}
ha-icon{display:inline-grid;place-items:center;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);font-size:calc(var(--mdc-icon-size,24px) * .8);line-height:1}</style>
</head><body><div id="wrap"></div>
<script>
const GLYPH={'mdi:play':'▶','mdi:stop':'■','mdi:pause':'❚❚','mdi:docker':'🐳','mdi:cube-outline':'▣','mdi:alert-circle-outline':'!','mdi:help-circle-outline':'?','mdi:progress-download':'⇩','mdi:chevron-down':'⌄','mdi:chevron-up':'⌃','mdi:restart':'↻','mdi:package-up':'⇧','mdi:information-outline':'i','mdi:close':'✕'};
customElements.define('ha-icon',class extends HTMLElement{static get observedAttributes(){return ['icon']}attributeChangedCallback(){this.textContent=GLYPH[this.getAttribute('icon')]||'◇'}});
customElements.define('ha-card',class extends HTMLElement{});
</script>
<script src="/busch-cards.js"></script>
<script>
const core={devices:new Map(),entities:new Map(),getDeviceEntities(id){return [...this.entities.values()].filter(e=>e.device_id===id)},retain(){return()=>{}},watch(){return()=>{}},watchDevice(){return()=>{}},attach(){}};
window.ensureBuschCore=()=>core;window.calls=[];
const dev=(id,name,model)=>core.devices.set(id,{id,name,model,config_entries:['entry']});
const ent=(id,device,state,a)=>core.entities.set(id,{entity_id:id,device_id:device,platform:'unraid_ssh',config_entry_id:'entry',domain:id.split('.')[0],state,attributes:{config_entry_id:'entry',...a},registry:{}});
dev('server','Tower','Unraid');ent('sensor.tower_cpu','server','12',{kind:'server',role:'cpu'});
const bild=n=>'/api/unraid_ssh/icons/'+n+'.png';
const container=(key,device,state,o={})=>{const a={kind:'container',container_key:key,container_name:key,stack_name:o.stack||null,container_state:o.paused?'paused':state==='on'?'running':'exited',image:'example/'+key+':latest',...(o.bild?{entity_picture:bild(o.bild)}:{})};
 ent('switch.'+key,device,state,{...a,role:'control'});if(o.restart!==false)ent('button.'+key+'_restart',device,'unknown',{...a,role:'restart'});if(o.update)ent('update.'+key,device,o.update,{...a,role:'update'});};
const stack=(key,list,o={})=>{dev(key,'Tower Stack '+key,'Compose stack');let run=0;for(const [name,state,opts] of list){container(name,key,state,{stack:key,...opts});if(state==='on')run++;}
 ent('switch.stack_'+key,key,run?'on':'off',{kind:'stack',role:'control',stack_key:key,stack_name:key,running_containers:run,total_containers:list.length});ent('button.stack_'+key+'_restart',key,'unknown',{kind:'stack',role:'restart',stack_key:key});if(o.update_all)ent('button.stack_'+key+'_update_all',key,'unknown',{kind:'stack',role:'update_all',stack_key:key});};
stack('media',[['media','on',{bild:'quadrat',update:'on'}],['media-db','on',{bild:'breit'}],['media-worker','on',{bild:'hoch'}]],{update_all:true});
stack('monitoring',[['grafana','on',{bild:'breit'}],['prometheus','on',{bild:'quadrat'}],['alertmanager','off',{}],['node-exporter','off',{bild:'hoch'}]]);
stack('backup',[['backup','off',{bild:'quadrat'}],['backup-db','off',{}]]);
stack('test-projekt-t123-szenarien-mit-einem-sehr-langen-stacknamen',[['test-projekt-t123-szenarien-mit-einem-sehr-langen-containernamen','on',{bild:'hoch'}]]);
const solo=(key,state,o)=>{dev('solo-'+key,'Tower '+key,'Docker container');container(key,'solo-'+key,state,o);};
solo('nginx-proxy-manager','on',{bild:'breit',update:'on'});solo('homeassistant-db','on',{bild:'quadrat',paused:true,restart:false});solo('kaputt','unavailable',{});solo('ohne-bild','on',{});
window.place=(config)=>{const wrap=document.getElementById('wrap');wrap.replaceChildren();const c=document.createElement('busch-unraid-docker-card');c.setConfig({type:'custom:busch-unraid-docker-card',device_id:'server',...config});c.hass={locale:{language:'de'},callService:async(...args)=>window.calls.push(args)};wrap.append(c);return c;};
window.addEventListener('hass-more-info',e=>window.calls.push(['more-info',e.detail.entityId]));
</script></body></html>"""

JS_SPALTEN = """()=>{const r=document.querySelector('busch-unraid-docker-card').shadowRoot;return new Set([...r.querySelectorAll('.tile')].map(t=>Math.round(t.getBoundingClientRect().left))).size}"""
JS_ZIELE = """()=>{const r=document.querySelector('busch-unraid-docker-card').shadowRoot;return [...r.querySelectorAll('button')].map(b=>{const x=b.getBoundingClientRect();return {label:b.getAttribute('aria-label'),w:Math.round(x.width),h:Math.round(x.height)}}).filter(x=>x.w<44||x.h<44)}"""
JS_BILDER = """async()=>{const r=document.querySelector('busch-unraid-docker-card').shadowRoot,imgs=[...r.querySelectorAll('.tile-icon img')];await Promise.all(imgs.map(i=>i.complete?0:new Promise(ok=>{i.onload=i.onerror=ok})));
 const holders=[...r.querySelectorAll('.tile-icon')],radii=new Set(holders.map(h=>getComputedStyle(h).borderRadius)),sizes=new Set(holders.map(h=>{const b=h.getBoundingClientRect();return Math.round(b.width)+'x'+Math.round(b.height)}));
 return {bilder:imgs.length,geladen:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,fit:[...new Set(imgs.map(i=>getComputedStyle(i).objectFit))],ausserhalb:imgs.filter(i=>{const a=i.getBoundingClientRect(),b=i.parentElement.getBoundingClientRect();return a.left<b.left-.5||a.right>b.right+.5||a.top<b.top-.5||a.bottom>b.bottom+.5}).map(i=>{const a=i.getBoundingClientRect(),b=i.parentElement.getBoundingClientRect();return [i.closest('.tile').dataset.key,Math.round(a.left),Math.round(a.top),Math.round(a.width),Math.round(a.height),Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]}),ersatzIcons:holders.filter(h=>h.querySelector('ha-icon')).map(h=>h.closest('.tile').dataset.key),radien:[...radii],groessen:[...sizes]}}"""
JS_HSCROLL = "()=>document.scrollingElement.scrollWidth>window.innerWidth"
JS_MENU = """()=>{const m=document.querySelector('busch-unraid-docker-menu');if(!m)return null;const p=m.shadowRoot.querySelector('.menu-panel').getBoundingClientRect();return {sheet:m.hasAttribute('sheet'),left:Math.round(p.left),right:Math.round(p.right),top:Math.round(p.top),bottom:Math.round(p.bottom),vw:innerWidth,vh:innerHeight,innen:p.left>=0&&p.top>=0&&p.right<=innerWidth+.5&&p.bottom<=innerHeight+.5,eintraege:[...m.shadowRoot.querySelectorAll('.item')].map(b=>b.querySelector('.label').textContent),fokus:m.shadowRoot.activeElement?.querySelector?.('.label')?.textContent||null,kleineZiele:[...m.shadowRoot.querySelectorAll('button')].filter(b=>{const x=b.getBoundingClientRect();return x.width<44||x.height<44}).length}}"""


def kachel(page, key):
    return page.locator("busch-unraid-docker-card .tile-main[data-key='%s']" % key)


def main():
    report = {"breiten": None, "spalten": [], "ziele": [], "bilder": [], "hscroll": [], "menue": [], "popup": {}, "e2e": {}, "netz": []}
    fehler = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 900}, locale="de-DE")
        page.on("pageerror", lambda e: fehler.append("pageerror: " + str(e)))
        page.on("console", lambda m: m.type == "error" and fehler.append("console: " + m.text))

        def route(r):
            url = r.request.url
            report["netz"].append(url.replace(ORIGIN, ""))
            if url.endswith("/busch-cards.js"):
                return r.fulfill(body=BUNDLE.read_text(encoding="utf-8"), content_type="text/javascript")
            if "/api/unraid_ssh/icons/" in url:
                name = url.rsplit("/", 1)[1].removesuffix(".png")
                return r.fulfill(body=BILDER[name], content_type="image/png") if name in BILDER else r.fulfill(status=404)
            return r.fulfill(body=SEITE, content_type="text/html")
        page.route(ORIGIN + "/**", route)
        page.goto(ORIGIN + "/")
        page.wait_for_function("()=>!!customElements.get('busch-unraid-docker-card')")
        page.evaluate("place({})")
        report["selbsttest"] = selbsttest(page, "busch-unraid-docker-card")

        def messung(pg):
            pg.evaluate("place({})")
            pg.wait_for_timeout(150)
            breite = pg.viewport_size["width"]
            thema = pg.evaluate("document.documentElement.dataset.theme")
            sp = pg.evaluate(JS_SPALTEN)
            report["spalten"].append({"breite": breite, "thema": thema, "ist": sp, "soll": SPALTEN_SOLL[breite]})
            report["ziele"].extend({"breite": breite, **z} for z in pg.evaluate(JS_ZIELE))
            b = pg.evaluate(JS_BILDER)
            report["bilder"].append({"breite": breite, "thema": thema, **b})
            if pg.evaluate(JS_HSCROLL):
                report["hscroll"].append(breite)
            pg.locator("busch-unraid-docker-card").screenshot(path=str(OUT / f"karte-{breite}-{thema}.png"))
            text = messe_text(pg, "busch-unraid-docker-card")
            # Aufgeklappt: Container direkt hinter der Stack-Kachel
            pg.evaluate("place({start_expanded:true})")
            pg.wait_for_timeout(150)
            pg.locator("busch-unraid-docker-card").screenshot(path=str(OUT / f"karte-{breite}-{thema}-ausgeklappt.png"))
            return {"zu": text, "ausgeklappt": messe_text(pg, "busch-unraid-docker-card")}

        report["breiten"] = lauf_breiten(page, breiten=BREITEN, messung=messung, hoehe=1400)

        # ── Menü: Lage, Screenshots, Regel 2 ────────────────────────────────
        for breite, thema, key in [(375, "light", "stack:media"), (375, "dark", "stack:media"), (960, "light", "stack:media"),
                                   (960, "dark", "container:nginx-proxy-manager"), (1280, "light", "container:ohne-bild"), (414, "light", "container:kaputt")]:
            page.set_viewport_size({"width": breite, "height": 800})
            page.evaluate("t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}", thema)
            page.evaluate("place({})")
            page.wait_for_timeout(150)
            kachel(page, key).click()
            page.wait_for_timeout(200)
            lage = page.evaluate(JS_MENU)
            report["menue"].append({"breite": breite, "thema": thema, "kachel": key, **(lage or {"fehlt": True})})
            page.screenshot(path=str(OUT / f"menue-{breite}-{thema}-{key.replace(':', '_')}.png"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
        # Menü am rechten Rand (letzte Spalte) und unten: nicht abgeschnitten
        # 1280 px, vier Spalten: „media" steht in der rechten Spalte, das
        # Fenster ist niedrig — das Menü muss nach links und oben ausweichen.
        page.set_viewport_size({"width": 1280, "height": 330})
        page.evaluate("t=>{document.documentElement.dataset.theme=t}", "light")
        page.evaluate("place({})")
        last = "stack:media"
        kachel(page, last).scroll_into_view_if_needed()
        kachel(page, last).click()
        page.wait_for_timeout(200)
        report["menue"].append({"breite": 1280, "thema": "light", "kachel": last, "rand": True, **page.evaluate(JS_MENU)})
        page.screenshot(path=str(OUT / "menue-1280-rand-rechts-niedrig.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        for breite in (960, 375):
            page.set_viewport_size({"width": breite, "height": 800})
            page.evaluate("place({})")
            page.wait_for_timeout(150)
            report["popup"][str(breite)] = messe_popup(page, lambda: kachel(page, "stack:media").click(), ".menu-panel",
                                                       schliessen_knopf_selektor=".menu-close", dialog_typ="ansicht")

        # ── E2E: Tastatur, Aktionen, Bestätigung, Ausklappen ───────────────
        page.set_viewport_size({"width": 960, "height": 900})
        page.evaluate("place({})")
        page.wait_for_timeout(150)
        e2e = report["e2e"]
        kachel(page, "stack:media").focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        e2e["tastatur_fokus_erster"] = page.evaluate(JS_MENU)["fokus"]
        page.keyboard.press("ArrowDown")
        e2e["tastatur_pfeil"] = page.evaluate(JS_MENU)["fokus"]
        page.keyboard.press("End")
        e2e["tastatur_ende"] = page.evaluate(JS_MENU)["fokus"]
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        e2e["fokus_zurueck"] = page.evaluate("()=>document.querySelector('busch-unraid-docker-card').shadowRoot.activeElement?.dataset.key")
        # Stoppen mit Abbrechen → kein Aufruf; mit Bestätigen → switch.turn_off
        for antwort in ("dismiss", "accept"):
            dialoge = []
            page.once("dialog", lambda d, a=antwort: (dialoge.append(d.message), getattr(d, a)()))
            kachel(page, "stack:media").click()
            page.wait_for_timeout(150)
            page.locator("busch-unraid-docker-menu .item[data-action='stop']").click()
            page.wait_for_timeout(500)
            e2e["stop_" + antwort] = {"frage": dialoge, "aufrufe": page.evaluate("JSON.parse(JSON.stringify(window.calls))")}
        page.evaluate("window.calls=[]")
        kachel(page, "container:nginx-proxy-manager").click()
        page.wait_for_timeout(150)
        page.locator("busch-unraid-docker-menu .item[data-action='update']").click()
        page.wait_for_timeout(500)
        kachel(page, "stack:backup").click()
        page.wait_for_timeout(150)
        page.locator("busch-unraid-docker-menu .item[data-action='start']").click()
        page.wait_for_timeout(500)
        e2e["update_und_start"] = page.evaluate("JSON.parse(JSON.stringify(window.calls))")
        # Ausklappen über Kachelknopf und über Menü
        page.locator("busch-unraid-docker-card .tile-toggle[data-key='stack:monitoring']").click()
        e2e["ausgeklappt_reihenfolge"] = page.evaluate("()=>[...document.querySelector('busch-unraid-docker-card').shadowRoot.querySelectorAll('.tile')].map(t=>t.dataset.key)")
        kachel(page, "stack:monitoring").click()
        page.wait_for_timeout(150)
        page.locator("busch-unraid-docker-menu .item[data-action='toggle']").click()
        page.wait_for_timeout(500)
        e2e["eingeklappt"] = not page.evaluate("()=>!!document.querySelector('busch-unraid-docker-card').shadowRoot.querySelector('.tile[data-key=\"container:grafana\"]')")
        e2e["history_state_am_ende"] = page.evaluate("history.state")
        browser.close()

    # ── Urteile, die regeln.py nicht kennt ──────────────────────────────────
    eigene = []
    eigene += [f"spalten {s['breite']}/{s['thema']}: {s['ist']} statt {s['soll']}" for s in report["spalten"] if s["ist"] != s["soll"]]
    eigene += [f"touchziel {z}" for z in report["ziele"]]
    eigene += [f"bilder {b['breite']}: {b}" for b in report["bilder"] if b["geladen"] != b["bilder"] or b["ausserhalb"] or b["fit"] != ["contain"] or len(b["radien"]) != 1 or len(b["groessen"]) != 1]
    eigene += [f"ersatzicon falsch {b['ersatzIcons']}" for b in report["bilder"] if sorted(b["ersatzIcons"]) not in (["container:alertmanager", "container:backup-db", "container:kaputt", "container:ohne-bild"], ["container:kaputt", "container:ohne-bild"])]
    eigene += [f"horizontaler scroll bei {w}" for w in report["hscroll"]]
    for m in report["menue"]:
        if m.get("fehlt") or not m["innen"] or m["kleineZiele"] or m["sheet"] != (m["breite"] < 450):
            eigene.append(f"menue {m}")
    e = report["e2e"]
    if e["tastatur_fokus_erster"] != "Ausklappen" or e["tastatur_pfeil"] != "Stoppen" or e["tastatur_ende"] != "Details" or e["fokus_zurueck"] != "stack:media":
        eigene.append(f"tastatur {e}")
    if e["stop_dismiss"]["aufrufe"] or e["stop_dismiss"]["frage"] != ["„media“ stoppen?"]:
        eigene.append(f"stop abbrechen {e['stop_dismiss']}")
    if e["stop_accept"]["aufrufe"] != [["switch", "turn_off", {"entity_id": "switch.stack_media"}]]:
        eigene.append(f"stop bestaetigen {e['stop_accept']}")
    if e["update_und_start"] != [["more-info", "update.nginx-proxy-manager"], ["switch", "turn_on", {"entity_id": "switch.stack_backup"}]]:
        eigene.append(f"update/start {e['update_und_start']}")
    i = e["ausgeklappt_reihenfolge"].index("stack:monitoring")
    if e["ausgeklappt_reihenfolge"][i + 1:i + 5] != ["container:alertmanager", "container:grafana", "container:node-exporter", "container:prometheus"] or not e["eingeklappt"]:
        eigene.append(f"ausklappen {e['ausgeklappt_reihenfolge']}")
    if e["history_state_am_ende"] and "buschUnraidDockerMenu" in json.dumps(e["history_state_am_ende"]):
        eigene.append("verwaister Verlaufseintrag")
    fremd = [u for u in report["netz"] if not (u in ("/", "/busch-cards.js") or u.startswith("/api/unraid_ssh/icons/"))]
    if fremd:
        eigene.append(f"fremde anfragen {fremd}")
    report["eigene_verstoesse"] = eigene
    report["seitenfehler"] = fehler
    schreibe(OUT / "report.json", report, zeige=0)
    code = max(bewerte(report), 1 if eigene or fehler else 0)
    print(json.dumps({"zaehlung": zaehle(report), "eigene": eigene, "fehler": fehler, "exit": code}, ensure_ascii=False, indent=1))
    sys.exit(code)


if __name__ == "__main__":
    main()
