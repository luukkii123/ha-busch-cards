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

SEIT 09.09.2026 bringt die Attrappe HAs Stilregel `.leaflet-pane { z-index: 0
!important }` mit (`ha-map.ts`), zeichnet je Entitaet eine Nadel und misst als
PAAR — eigene Vorlage gegen Standardvorlage —, ob die eigene Kachelebene ueber
dem markerPane liegt. Ohne diese drei Dinge blieb der Lauf gruen, waehrend die
Karte am echten System die Entitaeten verdeckte.

Seit 09.09.2026 misst der Lauf ausserdem Regel 1 und 4 aus
`hacs/docs/ui-regeln.md` — dafuer braucht er das Messmodul `regeln.py`, das
eine Ebene ueber dem Repo liegt. Der Container mountet deshalb ZWEI Ordner:
`/repo` (dieses Repo) und `/work` (`hacs/docs/render`).

Auf diesem Server laeuft Playwright nur im Container:

    docker run --rm -v "$PWD:/repo" \
      -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
      --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
      -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
          python3 /repo/docs/render/mapcard.py /repo/dist/busch-cards.js \
                  /repo/docs/render/mapcard-ergebnis'
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

# Das Messmodul liegt NICHT in diesem Repo, sondern eine Ebene darueber in
# `hacs/docs/render`. Im Container ist das `/work`; ausserhalb wird der Pfad
# aus dem Ort dieser Datei hergeleitet. Fehlt es, bricht der Lauf ab statt
# still die halbe Messung wegzulassen.
for _kandidat in ("/work",
                  os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "..", "..", "docs", "render")):
    if os.path.exists(os.path.join(_kandidat, "regeln.py")):
        sys.path.insert(0, os.path.abspath(_kandidat))
        break
else:
    sys.exit("regeln.py nicht gefunden. Der Container braucht den zweiten "
             "Mount: -v \"<hacs>/docs/render:/work\" (siehe Kopf dieser Datei).")
import regeln  # noqa: E402

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "busch-cards.js")
PORT = 8095

# BEIDES wird gebraucht, nicht nur das Skript. Ohne `leaflet.css` sind die
# Bedienelemente und die Quellenangabe NICHT absolut positioniert: sie fliessen
# unter die Karte und stehen dann meterweit ausserhalb — gemessen 1797 px unter
# der Kartenkante. Das waere ein Fehler der ATTRAPPE, der als Regel-1-Verstoss
# der Karte im Bericht gestanden haette. Home Assistant laedt das Stilblatt mit
# seiner eigenen Map-Karte; die Attrappe muss es genauso tun.
LEAFLET_DATEIEN = {
    "leaflet.js": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "leaflet.css": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
}
for _name, _url in LEAFLET_DATEIEN.items():
    ziel = SERVE / _name
    if ziel.exists():
        continue
    try:
        with urllib.request.urlopen(_url, timeout=30) as antwort:
            ziel.write_bytes(antwort.read())
    except Exception as fehler:  # noqa: BLE001 - ohne Leaflet ist der Lauf sinnlos
        sys.exit(f"{_name} liess sich nicht laden ({fehler}). Ohne echtes Leaflet "
                 "prueft der Lauf nichts — Abbruch statt stillem Durchlauf.")

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>busch-map-card</title>
<style>
  :root { --primary-text-color:#212121; --divider-color:#e0e0e0;
          --card-background-color:#fff; --error-color:#db4437; }
  body { margin:0; padding:16px; background:#f2f4f7; font-family:Roboto,sans-serif; }
  #wrap { max-width: 560px; }
  busch-map-card { display:block; margin-bottom:16px; }
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
    set computeHelper(f){ window.__mapHelper=f; }
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
      /* Das Stilblatt gehoert IN den Schatten, nicht in den Dokumentkopf:
         Dokumentstile ueberschreiten die Schattengrenze nicht, und `ha-map`
         liegt hier im Schatten der Attrappe. Ohne es fliessen Leaflets
         Bedienelemente und die Quellenangabe unter die Karte — gemessen
         1797 px unter deren Kante. Home Assistants eigene Map-Karte bindet
         das Stilblatt genauso in ihren eigenen Schatten ein. */
      /* DIE ZWEI ZEILEN AUS HOME ASSISTANT, die den Ausschlag geben:
         `src/components/map/ha-map.ts`, Zeilen 958-964 im Stand 20260826.6
         (das ist das Frontend von HA 2026.9.1). Sie flachen ALLE
         Leaflet-Ebenen auf `z-index: 0` ein — mit `!important`, also staerker
         als jede Zeile im `style`-Attribut. Danach stapeln sich die Ebenen
         einzig nach Dokumentreihenfolge. Ohne diese Regel war die Attrappe
         zu freundlich: sie liess die 250 aus `busch-map-card` gelten und
         konnte den gemeldeten Fehler gar nicht finden. */
      this.shadowRoot.innerHTML =
        '<link rel="stylesheet" href="/leaflet.css">'
        + '<style>.leaflet-pane { z-index: 0 !important; }'
        + '.leaflet-control,.leaflet-top,.leaflet-bottom { z-index: 1 !important; }'
        + '.ent-marker { width:36px; height:36px; border-radius:18px;'
        + ' background:#c62828; color:#fff; font-size:11px; line-height:36px;'
        + ' text-align:center; }</style>'
        + '<ha-map style="display:block;width:100%;max-width:100%;height:300px"></ha-map>';
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
      div.style.cssText = 'width:100%;height:300px';
      haMap.appendChild(div);
      const map = window.L.map(div).setView([48.2, 16.35], 13);
      if (window.__modus === 'raster') {
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: 'HA-Standardangabe', maxZoom: 19,
        }).addTo(map);
      } else {
        /* 'ohneRaster' bildet den Vektorfall nach: die Grundkarte ist eine
           MapLibre-Ebene ohne `setUrl`. Sie gibt sich ueber `getMaplibreMap`
           zu erkennen — genau daran sucht `busch-map-card` sie, um sie
           abzuraeumen (HA: `src/common/map/base-layer.ts`, `createVectorLayer`
           haengt eine `@maplibre/maplibre-gl-leaflet`-Ebene in den tilePane). */
        const Vektor = window.L.Layer.extend({
          options: { pane: 'tilePane' },
          getMaplibreMap() { return this._glMap; },
          onAdd(m) {
            this._glMap = {};
            this._el = window.L.DomUtil.create('div', 'maplibregl-map', m.getPane('tilePane'));
            this._el.style.cssText = 'position:absolute;inset:0;background:#dfe6ee';
          },
          onRemove() { if (this._el) this._el.remove(); this._glMap = null; },
        });
        new Vektor().addTo(map);
      }
      /* Entitaetsmarker wie HAs `_drawEntities`: je konfigurierter Entitaet
         ein `divIcon`-Marker im markerPane (HA: `src/components/map/ha-map.ts`,
         `_drawEntities`, `new DecoratedMarker(..., { icon: Leaflet.divIcon(...) })`).
         Ohne sie war an der Attrappe gar nicht zu messen, ob die Entitaeten
         nach dem Kacheltausch noch zu sehen sind. */
      for (const eintrag of (this._config.entities || [])) {
        const id = typeof eintrag === 'string' ? eintrag : eintrag.entity;
        const st = (window.__hass && window.__hass.states || {})[id];
        if (!st || st.attributes.latitude === undefined) continue;
        const el = document.createElement('div');
        el.className = 'ent-marker';
        el.dataset.entity = id;
        el.textContent = id.split('.')[1].slice(0, 3);
        window.L.marker([st.attributes.latitude, st.attributes.longitude], {
          icon: window.L.divIcon({ html: el, iconSize: [36, 36], className: '' }),
          title: id,
        }).addTo(map);
      }
      haMap.leafletMap = map;
    }
  }
  customElements.define('ha-map', class extends HTMLElement {});
  customElements.define('fake-map-card', FakeMapCard);

  window.loadCardHelpers = async () => {
    /* `wirft` ist der FEHLERFALL: HAs Kartenhelfer sind nicht zu haben. Dann
       zeichnet busch-map-card ihren eigenen Fehlerkasten — der einzige Text,
       den diese Karte ueberhaupt selbst schreibt, und damit das Einzige, was
       an ihr nach Regel 1 zu messen ist. */
    if (window.__modus === 'wirft') {
      throw new Error('loadCardHelpers steht in dieser Pruefung absichtlich '
        + 'nicht zur Verfuegung, damit der Fehlerkasten der Karte mit einem '
        + 'ausreichend langen Text gemessen werden kann');
    }
    return {
      createCardElement: async (config) => {
        const el = document.createElement('fake-map-card');
        el.setConfig(config);          /* wirft bei leeren Entitaeten */
        return el;
      },
    };
  };

  window.__hass = {
    themes: { darkMode: false },
    states: {
      'person.lukas': { entity_id:'person.lukas', state:'home',
        attributes:{ friendly_name:'Lukas', latitude:48.2, longitude:16.35 } },
      'person.marie': { entity_id:'person.marie', state:'not_home',
        attributes:{ friendly_name:'Marie', latitude:48.21, longitude:16.37 } },
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

  /* Wer liegt oben? Nicht `elementFromPoint` — die eigene Kachelebene traegt
     `pointer-events:none`, ein Treffertest liefe glatt durch sie hindurch und
     meldete den verdeckten Marker als sichtbar. Gemessen wird deshalb die
     Malreihenfolge selbst: erst der WIRKSAME z-index (`getComputedStyle`,
     also nach HAs `!important`), bei Gleichstand die Dokumentreihenfolge. */
  window.__stapel = (card) => {
    const inner = card.shadowRoot.querySelector('fake-map-card');
    const haMap = inner && inner.shadowRoot.querySelector('ha-map');
    const map = haMap && haMap.leafletMap;
    if (!map) return null;
    const info = (name) => {
      const p = map.getPane(name);
      if (!p) return null;
      const wirksam = getComputedStyle(p).zIndex;
      return {
        z: wirksam === 'auto' ? 0 : Number(wirksam),
        wirksamerZ: wirksam,
        inlineZ: p.style.zIndex || null,
        reihe: Array.prototype.indexOf.call(p.parentNode.children, p),
      };
    };
    const kachel = info('busch-map-tiles');
    const marker = info('markerPane');
    const liegtUeber = (a, b) =>
      (!a || !b) ? false : (a.z !== b.z ? a.z > b.z : a.reihe > b.reihe);
    const nadeln = Array.from(haMap.querySelectorAll('.ent-marker'));
    return {
      kachelPane: kachel,
      markerPane: marker,
      kachelnUeberMarkern: liegtUeber(kachel, marker),
      markerImDom: nadeln.length,
      markerEntitaeten: nadeln.map((e) => e.dataset.entity).sort(),
    };
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

    # ── Der gemeldete Fehler vom 09.09.2026, als PAAR ───────────────────
    # „Entitaeten fehlen bei jeder Vorlage ausser Home-Assistant-Standard."
    # Zwei Karten mit denselben ZWEI Entitaeten, einziger Unterschied die
    # Vorlage. Gemessen wird beides: dass beide Nadeln im DOM stehen UND dass
    # die eigene Kachelebene nicht ueber dem markerPane liegt. Die Nadeln
    # allein genuegen nicht — verdeckt stehen sie ebenfalls im DOM.
    paar = page.evaluate("""async () => {
        window.__modus = 'ohneRaster';
        const zwei = ['person.lukas', 'person.marie'];
        const eigen = await window.__mk({type:'custom:busch-map-card',
          entities: zwei, map_style:'osm'});
        const standard = await window.__mk({type:'custom:busch-map-card',
          entities: zwei, map_style:'ha'});
        await new Promise(r => setTimeout(r, 1400));
        return { eigen: window.__stapel(eigen), standard: window.__stapel(standard) };
    }""")
    page.screenshot(path=str(OUT / "paar-vorlage-vs-standard.png"))

    # Gegenprobe am WERKZEUG: die Ebene wieder ans Ende haengen — das ist
    # genau der Stand v0.9.0, den `createPane` von sich aus herstellt. Meldet
    # die Messung das nicht als Verdeckung, ist sie blind und ihr Gruen oben
    # wertlos.
    gegenprobe = page.evaluate("""async () => {
        window.__modus = 'ohneRaster';
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas', 'person.marie'], map_style:'osm'});
        await new Promise(r => setTimeout(r, 1400));
        const vorher = window.__stapel(c);
        const map = c.shadowRoot.querySelector('fake-map-card')
                     .shadowRoot.querySelector('ha-map').leafletMap;
        const p = map.getPane('busch-map-tiles');
        p.parentNode.appendChild(p);
        return { vorher, nachher: window.__stapel(c) };
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
          helfer: window.__mapHelper
            ? Object.fromEntries((window.__mapSchema||[]).map(
                s => [s.name, window.__mapHelper({name: s.name})]))
            : null,
          nachAenderung: geliefert,
          eingebauterEditorDa: !!el.querySelector('#echter-map-editor'),
          hinweisText: (el.textContent || ''),
        };
    }""")
    # ── Regel 1 und 4: drei Breiten, zwei Themen ─────────────────────────
    # Erst aufraeumen: die vielen Probekarten der Messungen oben stehen alle
    # noch im Dokument und wuerden sich gegenseitig ueberdecken. Danach genau
    # ZWEI Karten, jede mit eigener Kennung:
    #
    #   #karte-map    — der Regelfall. Eigenen Text hat die Karte hier nicht;
    #                   gemessen wird, dass die Umhuellung nichts aus dem
    #                   Rahmen schiebt. Die Quellenangabe stammt von Leaflet.
    #   #karte-fehler — der Fehlerkasten. Das ist der EINZIGE Text, den diese
    #                   Karte selbst schreibt, und damit die eigentliche
    #                   Regel-1-Messung an ihr.
    page.evaluate("""async () => {
        document.getElementById('wrap').innerHTML = '';
        for (const e of document.querySelectorAll('busch-map-card-editor')) e.remove();
        const w = document.getElementById('wrap');
        w.style.maxWidth = 'none'; w.style.width = 'auto';
        window.__modus = 'raster';
        const c = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'carto'});
        c.id = 'karte-map';
        await new Promise(r => setTimeout(r, 1200));
        window.__modus = 'wirft';
        const f = await window.__mk({type:'custom:busch-map-card',
          entities:['person.lukas'], map_style:'carto'});
        f.id = 'karte-fehler';
        await new Promise(r => setTimeout(r, 600));
        window.__modus = 'raster';
    }""")
    page.wait_for_selector("#karte-fehler", timeout=15000)
    fehlerkasten = page.evaluate(
        "() => { const k = document.getElementById('karte-fehler');"
        "        const d = k.shadowRoot.querySelector('.fehler');"
        "        return { da: Boolean(d), inHaCard: Boolean(d && d.closest('ha-card')),"
        "                 text: d ? d.textContent : null }; }")

    ui = {}
    for kennung in ("#karte-map", "#karte-fehler"):
        ui[kennung] = regeln.lauf_breiten(
            page, messung=lambda p, k=kennung: regeln.messe_text(p, k))
        for lauf in ui[kennung]["laeufe"]:
            page.set_viewport_size({"width": lauf["breite"], "height": 900})
            page.evaluate("(t) => { document.documentElement.dataset.theme = t; }",
                          lauf["thema"])
            page.wait_for_timeout(250)
            page.locator(kennung).screenshot(
                path=str(OUT / ("map-%s-%d-%s.png"
                                % (kennung[1:], lauf["breite"], lauf["thema"]))))

    # Gegenprobe am WERKZEUG, in beide Richtungen: die fehlerhafte Sonde muss
    # gemeldet werden, die gewollte Kuerzung darf es nicht.
    page.set_viewport_size({"width": 640, "height": 900})
    page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
    page.wait_for_timeout(300)
    selbsttest = regeln.selbsttest(page, "#karte-fehler")

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
checks["Vektorfall: Marker bleibt erhalten"] = vektor["marker"] == 1
checks["Vektorfall: Dunkelfilter abgeschaltet"] = vektor["mapFilter"] == "none"

# ── Paar zum gemeldeten Fehler ───────────────────────────────────────────
# Die alte Pruefung an dieser Stelle las `pane.style.zIndex == "250"` — den
# WUNSCH, nicht die Wirkung. HAs `.leaflet-pane { z-index: 0 !important }`
# ueberschreibt ihn, und die Pruefung blieb gruen, waehrend die Kacheln die
# Entitaeten verdeckten. Gemessen wird jetzt der wirksame Wert.
_pe, _ps = paar["eigen"], paar["standard"]
checks["Paar: eigene Vorlage zeigt beide Entitaeten"] = (
    _pe["markerImDom"] == 2
    and _pe["markerEntitaeten"] == ["person.lukas", "person.marie"]
    and _pe["kachelnUeberMarkern"] is False
)
checks["Paar: Standardvorlage zeigt beide Entitaeten"] = (
    _ps["markerImDom"] == 2
    and _ps["markerEntitaeten"] == ["person.lukas", "person.marie"]
    and _ps["kachelnUeberMarkern"] is False
)
# Ohne das waere das Paar wertlos: beide gruen, weil gar nichts passiert ist.
checks["Paar: die beiden Faelle sind wirklich verschieden"] = (
    _pe["kachelPane"] is not None and _ps["kachelPane"] is None
)
# HAs Regel greift in der Attrappe wirklich — sonst misst sie die alte,
# zu freundliche Lage.
checks["Paar: HAs z-index-Regel greift in der Attrappe"] = (
    _pe["kachelPane"]["wirksamerZ"] == "0" and _pe["kachelPane"]["inlineZ"] == "250"
)
checks["Gegenprobe: Ebene am Ende verdeckt die Entitaeten"] = (
    gegenprobe["vorher"]["kachelnUeberMarkern"] is False
    and gegenprobe["nachher"]["kachelnUeberMarkern"] is True
    and gegenprobe["nachher"]["markerImDom"] == 2
)
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
checks["Editor: sieben eigene Felder"] = editor["felder"] == [
    "map_style", "tile_url", "tile_url_dark", "tile_attribution",
    "tile_max_zoom", "tile_api_key", "tile_api_key_entity"
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
# Der Wortlaut steht seit 09.09.2026 im Woerterbuch der Karte
# (`TEXTE_BUSCH_MAP_CARD.de.texte.editorFehlt`). Gesucht wird ein Stueck
# daraus, das dort woertlich vorkommt — ein veralteter Suchtext waere eine
# Pruefung, die IMMER besteht.
checks["kein Rueckfalltext im Editor"] = (
    "in YAML bearbeiten" not in editor["hinweisText"]
)
checks["jedes Editorfeld hat einen Helper"] = bool(editor["helfer"]) and all(
    isinstance(h, str) and h.endswith(".") for h in editor["helfer"].values()
)
checks["Fehlerkasten steht in einer ha-card"] = fehlerkasten["inHaCard"] is True
checks["Regel 1: kein Verstoss bei 320/480/960 in hell und dunkel"] = (
    regeln.bewerte(ui) == 0
)
checks["Gegenprobe schlaegt an (Werkzeug nicht blind)"] = (
    selbsttest["ueberlauf_erkannt"] and selbsttest["ausserhalb_erkannt"]
)
checks["Gegenprobe meldet gewollte Kuerzung NICHT"] = (
    selbsttest["ellipsis_nicht_gemeldet"]
    and selbsttest["ellipsis_als_gekuerzt_gezaehlt"]
)

checks["keine Konsolenfehler ausser Kachelabrufen"] = echte_fehler == []
checks["keine Seitenfehler"] = errors == []

report = {
    "leaflet": leafletVersion,
    "hell": hell, "dunkel": dunkel, "innerConfig": innen, "eigen": eigen,
    "unberuehrt": unberuehrt, "ohneRaster": ohneRaster, "vektor": vektor,
    "paar": paar, "gegenprobe_stapel": gegenprobe,
    "eingebettet": eingebettet, "rueckfall": rueckfall,
    "schluessel": schluessel, "ohneSchluessel": ohneSchluessel,
    "ausHelfer": ausHelfer, "nachAenderung": nachAenderung,
    "editor": editor,
    "fehlerkasten": fehlerkasten,
    "ui_regeln": ui,
    "ui_regeln_zaehlung": {k: regeln.zaehle(v) for k, v in ui.items()},
    "ui_selbsttest": {k: v for k, v in selbsttest.items() if k != "befund"},
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
