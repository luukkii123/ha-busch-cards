#!/usr/bin/env python3
"""Prueft `busch-map-card` in echtem Chromium.

Aufruf:  python3 mapcard.py <pfad/busch-cards.js> <ausgabeordner>

Die Karte baut die Landkarte nicht nach, sondern umhuellt Home Assistants
eingebaute `map`-Karte und tauscht nur die Kachelebene an deren
`ha-map.leafletMap`. Genau dieser Eingriff wird hier geprueft.

LEAFLET IST ECHT, nicht nachgebaut: `busch-cards.js` bringt keines mit, also
laedt der Lauf Leaflet 1.9.4 herunter und liefert es lokal aus. Ohne Netz
bricht er mit einer klaren Meldung ab — ein Test, der bei fehlender
Abhaengigkeit still durchlaeuft, ist keiner.

NACHGEBAUT sind dagegen `loadCardHelpers` und die innere Karte: das echte
`hui-map-card` gibt es ausserhalb von Home Assistant nicht. Der Lauf belegt
deshalb den Eingriff und den Rueckfall — NICHT, dass HAs echte Karte ihr
`ha-map` an derselben Stelle traegt. Das entscheidet der Live-Test.

Auf diesem Server laeuft Playwright nur im Container:

    docker run --rm -v "$PWD:/repo" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/mapcard.py /repo/dist/busch-cards.js \
                  /repo/docs/render/mapcard-ergebnis'
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "busch-cards.js")
PORT = 8095

LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
ziel = SERVE / "leaflet.js"
if not ziel.exists():
    try:
        with urllib.request.urlopen(LEAFLET, timeout=30) as antwort:
            ziel.write_bytes(antwort.read())
    except Exception as fehler:  # noqa: BLE001 - ohne Leaflet ist der Lauf sinnlos
        sys.exit(f"Leaflet liess sich nicht laden ({fehler}). Ohne echtes Leaflet "
                 "prueft der Lauf nichts — Abbruch statt stillem Durchlauf.")

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>busch-map-card</title>
<style>
  :root { --primary-text-color:#212121; --divider-color:#e0e0e0;
          --card-background-color:#fff; --error-color:#db4437; }
  body { margin:0; padding:16px; background:#f2f4f7; font-family:Roboto,sans-serif; }
  #wrap { max-width: 560px; }
  ha-card { display:block; background:#fff; border-radius:12px; padding:8px; }
</style>
<div id="wrap"></div>
<script src="/leaflet.js"></script>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {}
  customElements.define('ha-icon', HaIcon);
  class HaForm extends HTMLElement {
    set schema(v){ this._s=v; window.__mapSchema=v; }
    set data(v){ this._d=v; window.__mapData=v; }
    set computeLabel(f){ window.__mapLabel=f; }
    fire(patch){ this.dispatchEvent(new CustomEvent('value-changed',
      {detail:{value:{...this._d, ...patch}}})); }
  }
  customElements.define('ha-form', HaForm);

  /* Nachbau der eingebauten map-Karte: ein `ha-map` mit einer ECHTEN
     Leaflet-Instanz und einer echten Rasterebene — genau das, woran der
     Eingriff ansetzt.  __modus steuert die drei geprueften Lagen. */
  window.__modus = 'raster';   // 'raster' | 'ohneLeaflet' | 'ohneRaster'
  window.__innerConfigs = [];
  class FakeMapCard extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}); }
    setConfig(c){
      /* Wie HAs echte map-Karte: ohne Entitaeten wird abgelehnt. Genau daran
         scheiterte das Einbetten des eingebauten Editors. */
      if (!c || !Array.isArray(c.entities) || c.entities.length === 0) {
        throw new Error('Entities must be specified');
      }
      this._config=c; window.__innerConfigs.push(JSON.parse(JSON.stringify(c)));
    }
    static getConfigElement(){
      const e = document.createElement('div');
      e.id = 'echter-map-editor';
      e.setConfig = () => {}; 
      Object.defineProperty(e, 'hass', { set(){}, configurable: true });
      return e;
    }
    set hass(h){ this._hass = h; }
    getCardSize(){ return 7; }
    connectedCallback(){
      if (this._gebaut) return;
      this._gebaut = true;
      this.shadowRoot.innerHTML = '<ha-map style="display:block;width:520px;height:300px"></ha-map>';
      const haMap = this.shadowRoot.querySelector('ha-map');
      if (window.__modus === 'ohneLeaflet') return;
      if (window.__modus === 'stubKarte') {
        /* Kein echtes Leaflet: nur die Methoden, die die Karte anfasst.
           `addTo` eines echten TileLayer ruft `map.addLayer(this)` — mehr
           braucht es nicht, um den Einbau zu belegen. */
        const panes = {};
        haMap.leafletMap = {
          _hinzugefuegt: [],
          eachLayer(f) { /* keine Ebenen */ },
          getPane(n) { return panes[n]; },
          createPane(n) { panes[n] = { style: {} }; return panes[n]; },
          addLayer(l) { this._hinzugefuegt.push(l); return this; },
          removeLayer() { return this; },
        };
        window.__stubMap = haMap.leafletMap;
        return;
      }
      const div = document.createElement('div');
      div.style.cssText = 'width:520px;height:300px';
      haMap.appendChild(div);
      const map = window.L.map(div).setView([48.2, 16.35], 13);
      if (window.__modus === 'raster') {
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: 'HA-Standardangabe', maxZoom: 19,
        }).addTo(map);
      } else {
        /* 'ohneRaster' bildet den Vektorfall nach: eine Ebene ohne setUrl. */
        window.L.marker([48.2, 16.35]).addTo(map);
      }
      haMap.leafletMap = map;
    }
  }
  customElements.define('ha-map', class extends HTMLElement {});
  customElements.define('fake-map-card', FakeMapCard);

  window.loadCardHelpers = async () => ({
    createCardElement: async (config) => {
      const el = document.createElement('fake-map-card');
      el.setConfig(config);          /* wirft bei leeren Entitaeten */
      return el;
    },
  });

  window.__hass = {
    themes: { darkMode: false },
    states: {
      'person.lukas': { entity_id:'person.lukas', state:'home',
        attributes:{ friendly_name:'Lukas', latitude:48.2, longitude:16.35 } },
      'input_text.carto_api_key': { entity_id:'input_text.carto_api_key',
        state:'HELFERSCHLUESSEL', attributes:{ friendly_name:'CARTO-Schlüssel' } },
      'zone.home': { entity_id:'zone.home', state:'1',
        attributes:{ friendly_name:'Home', latitude:48.2, longitude:16.35, radius:200 } },
    },
    callWS(){ return Promise.resolve({}); },
  };
</script>
<script src="/busch-cards.js"></script>
<script>
  window.__mk = async (config) => {
    const card = document.createElement('busch-map-card');
    card.setConfig(config);
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    return card;
  };
</script>
"""
(SERVE / "page.html").write_text(PAGE, encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

LESEN = """() => {
    const card = window.__card;
    const inner = card.shadowRoot.querySelector('fake-map-card');
    const haMap = inner && inner.shadowRoot.querySelector('ha-map');
    const map = haMap && haMap.leafletMap;
    let url = null, attribution = null, subdomains = null, anzahl = 0;
    if (map) {
      map.eachLayer((l) => {
        if (typeof l.setUrl === 'function') {
          anzahl += 1;
          if (!url) { url = l._url; attribution = l.options.attribution;
                      subdomains = String(l.options.subdomains); }
        }
      });
    }
    return {
      url, attribution, subdomains, kachelEbenen: anzahl,
      mapFilter: inner ? inner.style.getPropertyValue('--map-filter') : null,
      innerVorhanden: !!inner,
      kartenGroesse: card.getCardSize(),
      quellenText: haMap && haMap.querySelector('.leaflet-control-attribution')
        ? haMap.querySelector('.leaflet-control-attribution').textContent : '',
    };
}"""

checks = {}
console, errors = [], []

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 640, "height": 900}, locale="de-DE")
    page.on("console", lambda m: console.append((m.type, m.text)) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
    leafletDa = page.evaluate("() => !!(window.L && window.L.version)")
    leafletVersion = page.evaluate("() => window.L && window.L.version")

    page.evaluate("async () => { window.__card = await window.__mk("
                  "{type:'custom:busch-map-card', entities:['person.lukas'],"
                  " theme_mode:'auto', hours_to_show:2}); }")
    page.wait_for_function("window.__card && window.__card._layer", timeout=15000)
    hell = page.evaluate(LESEN)
    innen = page.evaluate("() => window.__innerConfigs[0]")

    page.evaluate("""() => {
        window.__hass = {...window.__hass, themes:{darkMode:true}};
        window.__card.hass = window.__hass;
    }""")
    page.wait_for_timeout(400)
    dunkel = page.evaluate(LESEN)
    page.screenshot(path=str(OUT / "dunkel.png"))

    eigen = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'custom',
          tile_url:'https://beispiel.test/{z}/{x}/{y}.png',
          tile_attribution:'Meine Quelle'});
        window.__card = c;
        await new Promise(r => setTimeout(r, 900));
        const map = c.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        let url=null, att=null;
        map.eachLayer(l => { if (typeof l.setUrl === 'function' && !url) {
          url = l._url; att = l.options.attribution; } });
        return { url, att };
    }""")

    unberuehrt = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'ha'});
        await new Promise(r => setTimeout(r, 900));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        const map = inner.shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url, mapFilter: inner.style.getPropertyValue('--map-filter') };
    }""")

    # Vektorfall: keine Rasterebene da. Seit dem Umzug nach busch-cards gibt es
    # kein eingebettetes Leaflet mehr, also wird NICHTS ersetzt.
    ohneRaster = page.evaluate("""async () => {
        window.__modus = 'ohneRaster';
        const c = await window.__mk({type:'custom:busch-map-card', entities:['person.lukas']});
        await new Promise(r => setTimeout(r, 900));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        const map = inner.shadowRoot.querySelector('ha-map').leafletMap;
        let kachel = 0; map.eachLayer(l => { if (typeof l.setUrl === 'function') kachel += 1; });
        return { kachel, mapFilter: inner.style.getPropertyValue('--map-filter'),
                 layer: !!c._layer, innerVorhanden: !!inner };
    }""")

    # Vektorfall: keine Rasterebene -> eigene Ebene anlegen (neu seit v0.8.0).
    vektor = page.evaluate("""async () => {
        window.__modus = 'ohneRaster';
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'osm'});
        await new Promise(r => setTimeout(r, 1200));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        const map = inner.shadowRoot.querySelector('ha-map').leafletMap;
        let url = null, pane = null, kachel = 0, marker = 0;
        map.eachLayer(l => {
          if (typeof l.setUrl === 'function') { kachel += 1; url = l._url; pane = l.options.pane; }
          if (l.getLatLng) marker += 1;
        });
        const p = map.getPane('busch-map-tiles');
        return { url, pane, kachel, marker, paneZ: p ? p.style.zIndex : null,
                 mapFilter: inner.style.getPropertyValue('--map-filter') };
    }""")

    # Eingebettetes Leaflet: window.L entfernen, dann muss die Karte ihr
    # eigenes laden. Das ist der Grund fuer die 147 kB im Buendel.
    eingebettet = page.evaluate("""async () => {
        const vorher = window.L && window.L.version;
        delete window.L;
        window.__modus = 'stubKarte';
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'osm'});
        await new Promise(r => setTimeout(r, 1500));
        const m = window.__stubMap;
        const l = m && m._hinzugefuegt[0];
        return {
          vorher,
          nachher: window.L && window.L.version,
          ebeneAngelegt: !!l,
          url: l ? l._url : null,
          istTileLayer: !!(l && typeof l.getTileUrl === 'function'),
          pane: l ? l.options.pane : null,
        };
    }""")

    rueckfall = page.evaluate("""async () => {
        window.__modus = 'ohneLeaflet';
        const c = await window.__mk({type:'custom:busch-map-card', entities:['person.lukas']});
        await new Promise(r => setTimeout(r, 1200));
        const inner = c.shadowRoot.querySelector('fake-map-card');
        return {
          innerVorhanden: !!inner,
          haMapVorhanden: !!(inner && inner.shadowRoot.querySelector('ha-map')),
          mapFilter: inner ? inner.style.getPropertyValue('--map-filter') : null,
          layer: !!c._layer,
        };
    }""")

    # Schluessel: mit und ohne.
    schluessel = page.evaluate("""async () => {
        window.__modus = 'raster';
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'carto',
          tile_api_key:'TESTSCHLUESSEL'});
        window.__card = c;
        await new Promise(r => setTimeout(r, 900));
        const map = c.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url };
    }""")
    ohneSchluessel = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'carto'});
        await new Promise(r => setTimeout(r, 900));
        const map = c.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url };
    }""")

    # Schluessel aus dem Helfer, ohne Eintrag in der Karte.
    ausHelfer = page.evaluate("""async () => {
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'carto'});
        window.__card = c;
        await new Promise(r => setTimeout(r, 900));
        const map = c.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url };
    }""")

    # Aenderung des Helfers muss nachgezogen werden, ohne Neuladen.
    nachAenderung = page.evaluate("""async () => {
        const s = {...window.__hass.states};
        s['input_text.carto_api_key'] = {...s['input_text.carto_api_key'], state:'NEUERSCHLUESSEL'};
        window.__hass = {...window.__hass, states:s};
        window.__card.hass = window.__hass;
        await new Promise(r => setTimeout(r, 500));
        const map = window.__card.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        let url=null; map.eachLayer(l => { if (typeof l.setUrl==='function' && !url) url = l._url; });
        return { url };
    }""")

    editor = page.evaluate("""async () => {
        const el = window.__card.constructor.getConfigElement();
        document.body.appendChild(el);
        el.setConfig({type:'custom:busch-map-card', entities:['person.lukas']});
        el.hass = window.__hass;
        /* Der eingebaute Editor wird asynchron nachgeladen und eingehaengt. */
        for (let i = 0; i < 40 && !el.querySelector('#echter-map-editor'); i++) {
          await new Promise(r => setTimeout(r, 50));
        }
        const form = el.querySelector('ha-form');
        let geliefert = null;
        el.addEventListener('config-changed', e => { geliefert = e.detail.config; });
        form.fire({ map_style: 'topo' });
        return {
          tag: el.tagName.toLowerCase(),
          felder: (window.__mapSchema||[]).map(s => s.name),
          vorlagen: ((window.__mapSchema||[])[0]?.selector?.select?.options||[]).map(o => o.value),
          beschriftung: window.__mapLabel ? window.__mapLabel({name:'map_style'}) : null,
          nachAenderung: geliefert,
          eingebauterEditorDa: !!el.querySelector('#echter-map-editor'),
          hinweisText: (el.textContent || ''),
        };
    }""")
    browser.close()

server.terminate()

CARTO_HELL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
CARTO_DUNKEL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"

checks["echtes Leaflet geladen"] = leafletDa is True
checks["Leaflet 1.9.4"] = leafletVersion == "1.9.4"
# `startswith`, nicht `==`: seit dem Helfer haengt hinten `?key=...` dran.
checks["hell: CARTO-Positron-Kacheln gesetzt"] = (hell["url"] or "").startswith(CARTO_HELL)
checks["dunkel: CARTO-Dark-Kacheln gesetzt"] = (dunkel["url"] or "").startswith(CARTO_DUNKEL)
checks["Umschalten legt keine zweite Ebene an"] = (
    hell["kachelEbenen"] == 1 and dunkel["kachelEbenen"] == 1
)
checks["Subdomains uebernommen"] = hell["subdomains"] == "abcd"
checks["Quellenangabe ist die von CARTO"] = "CARTO" in (hell["attribution"] or "")
checks["Quellenangabe steht auch im Bedienelement"] = "CARTO" in (hell["quellenText"] or "")
checks["HA-Dunkelfilter abgeschaltet"] = hell["mapFilter"] == "none"
checks["innere Karte bekommt type: map"] = innen.get("type") == "map"
checks["eigene Schluessel gelangen NICHT nach innen"] = not any(
    k in innen for k in ("map_style", "tile_url", "tile_url_dark", "tile_attribution")
)
checks["Fremdoptionen werden durchgereicht"] = (
    innen.get("hours_to_show") == 2 and innen.get("entities") == ["person.lukas"]
)
checks["getCardSize kommt von der inneren Karte"] = hell["kartenGroesse"] == 7
checks["eigene URL wird verwendet"] = (
    eigen["url"] or "").startswith("https://beispiel.test/{z}/{x}/{y}.png")
checks["eigene Quellenangabe wird verwendet"] = eigen["att"] == "Meine Quelle"
checks["Vorlage 'ha' laesst die Kacheln unberuehrt"] = (
    unberuehrt["url"] == "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
)
# osm hat kein keyParam — der Helfer darf dort NICHT angehaengt werden.
checks["Vorlage ohne keyParam bekommt keinen Schluessel"] = "key=" not in (
    unberuehrt["url"] or "")
checks["Vorlage 'ha' schaltet den Dunkelfilter nicht ab"] = unberuehrt["mapFilter"] in ("", None)
checks["Vektorfall: eigene Rasterebene angelegt"] = vektor["kachel"] == 1
checks["Vektorfall: richtige URL"] = (vektor["url"] or "") == (
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
checks["Vektorfall: eigene Ebene, nicht tilePane"] = vektor["pane"] == "busch-map-tiles"
checks["Vektorfall: Ebene unter Markern und Routen"] = vektor["paneZ"] == "250"
checks["Vektorfall: Marker bleibt erhalten"] = vektor["marker"] == 1
checks["Vektorfall: Dunkelfilter abgeschaltet"] = vektor["mapFilter"] == "none"
checks["eingebettetes Leaflet springt ein"] = (
    eingebettet["vorher"] == "1.9.4" and eingebettet["nachher"] == "1.9.4")
checks["eingebettet: Ebene angelegt"] = eingebettet["ebeneAngelegt"] is True
checks["eingebettet: echte TileLayer-Klasse"] = eingebettet["istTileLayer"] is True
checks["eingebettet: richtige URL"] = (eingebettet["url"] or "") == (
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
checks["Rueckfall: innere Karte bleibt stehen"] = rueckfall["innerVorhanden"] is True
checks["Rueckfall: ha-map bleibt stehen"] = rueckfall["haMapVorhanden"] is True
checks["Rueckfall: kein erzwungener Filter"] = rueckfall["mapFilter"] in ("", None)
checks["Rueckfall: keine Ebene uebernommen"] = not rueckfall["layer"]
checks["Editor-Element"] = editor["tag"] == "busch-map-card-editor"
checks["Editor: sechs eigene Felder"] = editor["felder"] == [
    "map_style", "tile_url", "tile_url_dark", "tile_attribution",
    "tile_api_key", "tile_api_key_entity"
]
checks["Editor: sieben Vorlagen plus eigene URL"] = editor["vorlagen"] == [
    "ha", "osm", "carto", "voyager", "satellite", "topo", "custom"
]
checks["Editor beschriftet deutsch"] = editor["beschriftung"] == "Kartenvorlage"
checks["Editor gibt die Vorlage weiter"] = editor["nachAenderung"].get("map_style") == "topo"
checks["Editor behaelt die Fremdoptionen"] = (
    editor["nachAenderung"].get("entities") == ["person.lukas"]
)

# Fehlgeschlagene KACHEL-Abrufe zaehlen nicht als Kartenfehler: eine der
# geprueften URLs zeigt absichtlich auf einen erfundenen Host. Ihre Zahl steht
# im Bericht, damit die Ausnahme sichtbar bleibt statt still zu wirken.
echte_fehler = [c for c in console if "Failed to load resource" not in c[1]]
checks["Schluessel wird als ?key= angehaengt"] = (
    schluessel["url"] or "").endswith("?key=TESTSCHLUESSEL")
_u = schluessel["url"] or ""
checks["Schluessel steht hinter der Kachel-URL, nicht davor"] = (
    "cartocdn.com" in _u and "?key=" in _u and _u.index("?key=") > _u.index("cartocdn.com")
)
# `ohneSchluessel` traegt keinen Karteneintrag, ABER der Helfer existiert —
# also muss dessen Wert greifen. Das ist der Kern des Wunsches: einmal
# eintragen, ueberall wirksam.
checks["Helfer greift ohne Karteneintrag"] = (
    ohneSchluessel["url"] or "").endswith("?key=HELFERSCHLUESSEL")
checks["Helfer greift auch bei frischer Karte"] = (
    ausHelfer["url"] or "").endswith("?key=HELFERSCHLUESSEL")
checks["Karteneintrag schlaegt den Helfer"] = (
    schluessel["url"] or "").endswith("?key=TESTSCHLUESSEL")
checks["Aenderung des Helfers wird nachgezogen"] = (
    nachAenderung["url"] or "").endswith("?key=NEUERSCHLUESSEL")
checks["eingebauter Map-Editor wird eingebettet"] = editor["eingebauterEditorDa"] is True
checks["kein Rueckfalltext im Editor"] = "liess sich nicht laden" not in editor["hinweisText"]

checks["keine Konsolenfehler ausser Kachelabrufen"] = echte_fehler == []
checks["keine Seitenfehler"] = errors == []

report = {
    "leaflet": leafletVersion,
    "hell": hell, "dunkel": dunkel, "innerConfig": innen, "eigen": eigen,
    "unberuehrt": unberuehrt, "ohneRaster": ohneRaster, "vektor": vektor,
    "eingebettet": eingebettet, "rueckfall": rueckfall,
    "schluessel": schluessel, "ohneSchluessel": ohneSchluessel,
    "ausHelfer": ausHelfer, "nachAenderung": nachAenderung,
    "editor": editor,
    "console_errors": echte_fehler,
    "kachel_abrufe_fehlgeschlagen": len(console) - len(echte_fehler),
    "page_errors": errors,
    "pruefungen": checks,
    "bestanden": all(checks.values()),
    "gescheitert": [k for k, v in checks.items() if not v],
}
(OUT / "report.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps({"bestanden": report["bestanden"], "anzahl": len(checks),
                  "gescheitert": report["gescheitert"]}, indent=2, ensure_ascii=False))
if not report["bestanden"]:
    print(json.dumps(report, indent=2, ensure_ascii=False)[:7000])
sys.exit(0 if report["bestanden"] else 1)
