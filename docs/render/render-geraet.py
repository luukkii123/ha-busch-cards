#!/usr/bin/env python3
"""Rendert busch-device-card aus busch-cards.js in echtem Chromium.

Aufruf:  python3 render-geraet.py <pfad/busch-cards.js> <ausgabeordner> [breite]

`window.loadCardHelpers` ist hier eine ATTRAPPE: Tile und Zeilen sind feste
Kaesten mit Text. Gemessen wird die EIGENE Oberflaeche der Karte (Kopfzeile,
Chips, Gruppenkoepfe, Hinweise) — HAs Bausteine misst HA. Aufbau wie
render-kalender.py.

Was der Lauf belegt (Spec Abschnitt 12, Schritt 3):
  1. Regel 1 bei 320/480/960 px, hell/dunkel, an vier Karten: A (Shelly,
     zugeklappt), B (Shelly, aufgeklappt, Label-Filter, langer Titel),
     C (Aqara-Sensor, generic, langer Geraete- und Bereichsname),
     D (Fehler: Entitaet ohne Geraet).
  2. DOM-Auslese: Tile-Stub traegt die Vorlagen-Features; Gruppenkoepfe mit
     Zaehlern; Chips mit Label-Namen aus der WS-Attrappe; Kurznamen ohne
     Geraetepraefix.
  3. Verhalten: Zustandswechsel baut das DOM NICHT um (dieselben Zeilenknoten);
     eine neue Entitaet baut um; Tipp klappt auf; Halten feuert hass-more-info;
     device-page aendert location.pathname; Diagnose-Gruppe klappt.

Das Brand-Icon (brands.home-assistant.io) ist im Container ohne Netz ein
erwarteter Fehlversuch — er wird getrennt gezaehlt und ist kein Befund.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

# The shared measuring module `regeln.py` stays in `hacs/docs/render` (used by every card repo). In the
# container that folder is `/work` (scripts/karten-alle.sh); outside it is derived from this file's place in
# hacs/busch-cards. Missing means abort, never a silently halved measurement.
for _kandidat in ("/work", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "docs", "render")):
    if os.path.exists(os.path.join(_kandidat, "regeln.py")):
        sys.path.insert(0, os.path.abspath(_kandidat))
        break
else:
    sys.exit("regeln.py nicht gefunden: der Container braucht -v \"<hacs>/docs/render:/work\" (hacs/docs/karten.md).")
import regeln  # noqa: E402

JS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 620
OUT.mkdir(parents=True, exist_ok=True)
SERVE = OUT / "serve"
SERVE.mkdir(exist_ok=True)
shutil.copy(JS, SERVE / "busch-cards.js")
PORT = 8101

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>busch-device-card render</title>
<style>
  :root {
    --primary-color: #03a9f4; --rgb-primary-color: 3,169,244; --accent-color: #ff9800;
    --primary-text-color: #212121; --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd; --divider-color: #e0e0e0; --error-color: #db4437;
    --card-background-color: #fff; --ha-card-background: #fff;
    --secondary-background-color: #e5e5e5; --text-primary-color: #fff;
    --red-color: #f44336; --green-color: #4caf50;
  }
  body { margin: 0; padding: 16px; background: #f2f4f7; font-family: Roboto, sans-serif;
         color: var(--primary-text-color); }
  #wrap { max-width: __MAXW__px; margin: 0 auto; }
  ha-card { display: block; background: var(--ha-card-background); border-radius: 12px;
            box-shadow: 0 2px 6px rgba(0,0,0,.15); overflow: hidden; color: var(--primary-text-color); }
  busch-device-card { display: block; margin-bottom: 20px; }
  ha-icon, ha-state-icon { display: inline-block; width: 24px; height: 24px; text-align: center; }
  .stub-tile { height: 56px; display:flex; align-items:center; padding: 0 12px;
               border: 1px dashed var(--divider-color); border-radius: 12px; font-size: 12px;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  /* HAs echte Entitaetenzeile kuerzt ihren Text selbst. Ohne diese Regeln
     waere die Attrappe STRENGER als die Wirklichkeit und meldete einen
     Ueberstand, den es im Frontend nicht gibt. */
  .stub-row { height: 32px; display:flex; align-items:center; gap:8px;
              font-size: 13px; min-width: 0; }
  .stub-name { flex:1 1 auto; min-width:0;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stub-toggle { flex:0 0 auto; }
</style>
<div id="wrap"></div>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  /* Kein Inline-Stil an den Attrappen: HAs ha-icon traegt auch keinen. Ein
     Inline-`display` schluege jede `[hidden]`-Regel der Karte — gemessen am
     ersten Lauf: der Pfeil der Fehlerkarte blieb sichtbar. */
  class HaIcon extends HTMLElement {
    connectedCallback() { this.textContent = '\\u25BE'; }
  }
  customElements.define('ha-icon', HaIcon);
  class HaStateIcon extends HTMLElement {
    connectedCallback() { this.textContent = '\\u25C6'; }
  }
  customElements.define('ha-state-icon', HaStateIcon);
  class HaForm extends HTMLElement {
    set schema(v) { this._schema = v; } get schema() { return this._schema; }
    set data(v) { this._data = v; } get data() { return this._data; }
    set hass(v) { this._hass = v; } get hass() { return this._hass; }
  }
  customElements.define('ha-form', HaForm);

  /* Attrappe der Helfer: feste Kaesten, die `hass` annehmen und zaehlen. */
  class StubTile extends HTMLElement {
    set hass(v) { this._hass = v; this.dataset.hassGesetzt = String((Number(this.dataset.hassGesetzt) || 0) + 1); }
  }
  customElements.define('stub-tile', StubTile);
  class StubRow extends HTMLElement {
    set hass(v) { this._hass = v; this.dataset.hassGesetzt = String((Number(this.dataset.hassGesetzt) || 0) + 1); }
    connectedCallback() {
      if (this._auf) return;
      this._auf = true;
      const name = document.createElement('span');
      name.className = 'stub-name';
      name.textContent = this.dataset.text;
      /* So macht es HAs Zeile: ein aufsteigendes, komponiertes Ereignis. */
      name.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info',
        { detail: { entityId: this.dataset.entity }, bubbles: true, composed: true })));
      this.appendChild(name);
      if (this.dataset.entity.indexOf('switch.') === 0) {
        const knopf = document.createElement('button');
        knopf.className = 'stub-toggle';
        knopf.textContent = 'AN/AUS';
        /* Ein Schalter feuert KEIN more-info — er ruft direkt den Dienst. */
        knopf.addEventListener('click', () => window.__hass.callService(
          'homeassistant', 'toggle', { entity_id: this.dataset.entity }));
        this.appendChild(knopf);
      }
    }
  }
  customElements.define('stub-row', StubRow);
  window.__helferAufrufe = [];
  window.loadCardHelpers = async () => ({
    createCardElement(cfg) {
      window.__helferAufrufe.push('card:' + JSON.stringify(cfg));
      const t = document.createElement('stub-tile');
      t.className = 'stub-tile';
      t.textContent = 'TILE ' + cfg.entity + ' [' + (cfg.features || []).map(f => f.type).join(',') + ']';
      return t;
    },
    createRowElement(cfg) {
      window.__helferAufrufe.push('row:' + JSON.stringify(cfg));
      const r = document.createElement('stub-row');
      r.className = 'stub-row';
      r.dataset.entity = cfg.entity;
      r.dataset.text = cfg.name || cfg.entity;  /* HA-Zeile zeigt nur den Namen (M60-Befund kam aus der Attrappe) */
      return r;
    },
  });

  /* ── erfundener hass mit echten Registerformen ─────────────────────── */
  const e = (id, x) => Object.assign({ entity_id: id, device_id: 'd1', area_id: null, labels: [], platform: 'shelly' }, x || {});
  const z = (n, s) => ({ state: s, attributes: { friendly_name: n } });
  window.__wsAufrufe = [];
  window.__dienste = [];
  const hass = {
    connection: {},
    locale: { language: 'de-DE' },
    states: {
      'light.decke': z('Wohnzimmer Deckenlampe', 'on'),
      'sensor.decke_leistung': z('Wohnzimmer Deckenlampe Leistung', '12.4'),
      'sensor.decke_energie': z('Wohnzimmer Deckenlampe Energie', '3.21'),
      'sensor.decke_rssi': z('Wohnzimmer Deckenlampe RSSI', '-61'),
      /* Ohne eigenen Namen ist der friendly_name der GERAETENAME — so am
         10.09.2026 an einem echten SONOFF-Zigbee-Schalter vorgefunden. Die
         Zeile muss trotzdem 'Firmware' heissen, nicht 'Wohnzimmer Deckenlampe'. */
      'update.decke_firmware': z('Wohnzimmer Deckenlampe', 'off'),
      'switch.decke_kindersicherung': z('Wohnzimmer Deckenlampe Kindersicherung', 'off'),
      'binary_sensor.decke_ueberhitzt': z('Wohnzimmer Deckenlampe \\u00dcberhitzt', 'off'),
      'event.decke_taster': z('Wohnzimmer Deckenlampe Taster', '2026-09-09T10:00:00+00:00'),
      'sensor.aqara_temp': z('Aqara Temperatur', '21.3'),
      'sensor.aqara_feuchte': z('Aqara Luftfeuchte', '48'),
      'sensor.aqara_batterie': z('Aqara Batterie', '87'),
      'sensor.ohne_geraet': z('Ohne Ger\\u00e4t', '7'),
    },
    entities: {
      'light.decke': e('light.decke', { labels: ['l_wichtig'] }),
      'sensor.decke_leistung': e('sensor.decke_leistung', { labels: ['l_energie'] }),
      'sensor.decke_energie': e('sensor.decke_energie', { labels: ['l_energie', 'l_wichtig'] }),
      'sensor.decke_rssi': e('sensor.decke_rssi', { entity_category: 'diagnostic' }),
      'update.decke_firmware': e('update.decke_firmware', { entity_category: 'config' }),
      'switch.decke_kindersicherung': e('switch.decke_kindersicherung', { entity_category: 'config' }),
      'binary_sensor.decke_ueberhitzt': e('binary_sensor.decke_ueberhitzt'),
      'event.decke_taster': e('event.decke_taster'),
      'sensor.aqara_temp': e('sensor.aqara_temp', { device_id: 'd2', platform: 'zha' }),
      'sensor.aqara_feuchte': e('sensor.aqara_feuchte', { device_id: 'd2', platform: 'zha' }),
      'sensor.aqara_batterie': e('sensor.aqara_batterie', { device_id: 'd2', platform: 'zha', entity_category: 'diagnostic' }),
      'sensor.ohne_geraet': e('sensor.ohne_geraet', { device_id: undefined }),
    },
    devices: {
      empty: { id: 'empty', name: 'Geraet ohne Entitaeten' },
      d1: { id: 'd1', name: 'shellyplus1pm-abc123', name_by_user: 'Wohnzimmer Deckenlampe',
            manufacturer: 'Shelly', model: 'Plus 1PM', area_id: 'wohnzimmer', labels: [] },
      d2: { id: 'd2', name: 'Aqara Temperatur- und Luftfeuchtesensor mit sehr langem Namen f\\u00fcr den Umbruchtest',
            name_by_user: null, manufacturer: 'LUMI', model: 'lumi.weather', area_id: 'bad', labels: [] },
    },
    areas: { wohnzimmer: { area_id: 'wohnzimmer', name: 'Wohnzimmer' },
             bad: { area_id: 'bad', name: 'Badezimmer im Obergeschoss mit sehr langem Namen' } },
    async callWS(m) {
      window.__wsAufrufe.push(m.type);
      if (m.type === 'config/label_registry/list') return [
        { label_id: 'l_wichtig', name: 'Wichtig', icon: 'mdi:star', color: 'red', description: null },
        { label_id: 'l_energie', name: 'Energie', icon: null, color: 'green', description: null },
      ];
      if (m.type === 'config/entity_registry/list') return Object.values(this.entities);
      if (m.type === 'config/device_registry/list') return Object.values(this.devices);
      if (m.type === 'config/area_registry/list') return Object.values(this.areas);
      return [];
    },
    async callService(d, s, daten, ziel) {
      window.__dienste.push({ dienst: d + '.' + s, daten: daten, ziel: ziel });
    },
  };
  window.__hass = hass;
  window.__moreInfo = [];
  document.addEventListener('hass-more-info', (ev) => window.__moreInfo.push(ev.detail.entityId));
</script>
<script src="/busch-cards.js"></script>
<script>
  const mk = (id, cfg) => {
    const k = document.createElement('busch-device-card');
    k.id = id; k.setConfig(cfg); k.hass = window.__hass;
    document.getElementById('wrap').appendChild(k);
    return k;
  };
  window.__a = mk('karte-a', { entity: 'light.decke' });
  window.__b = mk('karte-b', { entity: 'light.decke', start_expanded: true,
    labels: ['l_energie', 'l_wichtig'], labels_hide: ['l_wichtig'],
    groups_open: ['control', 'sensor'],
    title: 'Eine absichtlich viel zu lange \\u00dcberschrift, die gek\\u00fcrzt werden muss, damit Regel 1 h\\u00e4lt',
    tap_action: { action: 'perform-action', perform_action: 'label.add',
                  data: { label_id: 'geprueft', geraet: '{{ device }}' } },
    row_tap_action: { action: 'perform-action', perform_action: 'label.add',
                      data: { label_id: 'zeile' } } });
  window.__c = mk('karte-c', { entity: 'sensor.aqara_temp', start_expanded: true,
    groups_open: ['sensor'], hold_action: { action: 'device-page' } });
  window.__d = mk('karte-d', { entity: 'sensor.ohne_geraet' });
  window.__f = mk('karte-f', { device_id: 'd1', start_expanded: true });
  window.__g = mk('karte-g', { device_id: 'missing' });
  window.__h = mk('karte-h', { device_id: 'empty', entity: 'light.decke', start_expanded: true });
  window.__i = mk('karte-i', { device_id: 'd2', start_expanded: true });
  /* Zeigt ALLES: nur hier kommt die Schalterzeile ungefiltert vor. */
  window.__e = mk('karte-e', { entity: 'light.decke', start_expanded: true,
    groups_open: ['control', 'sensor', 'config', 'diagnostic'],
    row_hold_action: { action: 'perform-action', perform_action: 'label.remove' } });
</script>
"""

(SERVE / "page.html").write_text(PAGE.replace("__MAXW__", str(WIDTH - 60)), encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

AUSLESEN = """() => [...document.querySelectorAll('busch-device-card')].map((k) => ({
    id: k.id,
    name: k.querySelector('.dev-name') && k.querySelector('.dev-name').textContent,
    untertitel: k.querySelector('.dev-unter-text') && k.querySelector('.dev-unter-text').textContent,
    untertitelSichtbar: k.querySelector('.dev-unter') ? !k.querySelector('.dev-unter').hidden : null,
    brand: k.querySelector('.dev-brand') ? k.querySelector('.dev-brand').getAttribute('src') : null,
    chips: [...k.querySelectorAll('.dev-chip-text')].map(c => c.textContent),
    tile: k.querySelector('.stub-tile') ? k.querySelector('.stub-tile').textContent : null,
    gruppen: [...k.querySelectorAll('.dev-gruppe')].map(g => ({
      gruppe: g.dataset.gruppe, kopf: g.querySelector('.dev-gruppe-text').textContent,
      zu: g.classList.contains('dev-zu'),
      zeilen: [...g.querySelectorAll('.stub-row')].map(r => r.textContent),
    })),
    listeSichtbar: k.querySelector('.dev-liste') ? !k.querySelector('.dev-liste').hidden : null,
    tileSichtbar: k.querySelector('.dev-tile') ? !k.querySelector('.dev-tile').hidden : null,
    chipsAus: [...k.querySelectorAll('.dev-chip-aus .dev-chip-text')].map(c => c.textContent),
    pfeilSichtbar: k.querySelector('.dev-pfeil') ? !k.querySelector('.dev-pfeil').hidden : null,
    hinweis: k.querySelector('.dev-hinweis:not([hidden])') ? k.querySelector('.dev-hinweis:not([hidden])').textContent : null,
    offen: k.querySelector('ha-card').classList.contains('dev-offen'),
}))"""

UMGEBUNG = """() => ({
    registriert: ['busch-device-card','busch-device-card-editor','busch-schedule-card',
                  'busch-map-card','busch-calendar-card'].map(t => t + '=' + Boolean(customElements.get(t))),
    customCards: (window.customCards || []).map(c => c.type),
    wsAufrufe: window.__wsAufrufe,
    helferAufrufe: window.__helferAufrufe,
})"""

VERHALTEN = """async () => {
    const a = window.__a;
    const aus = {};
    // 0. ZUERST, vor jedem Tipp: zugeklappt ist kein Bedienelement sichtbar.
    //    Nach Schritt 3 waere karte-a aufgeklappt und die Messung wertlos.
    aus.aTileSichtbarZu = !a.querySelector('.dev-tile').hidden;
    aus.aListeSichtbarZu = !a.querySelector('.dev-liste').hidden;
    // 1. Zustandswechsel baut das DOM nicht um: dieselben Zeilenknoten.
    const b = window.__b;
    const vorher = [...b.querySelectorAll('.stub-row')];
    const hass2 = { ...window.__hass, states: { ...window.__hass.states,
      'light.decke': { state: 'off', attributes: { friendly_name: 'Wohnzimmer Deckenlampe' } } } };
    b.hass = hass2;
    await new Promise(r => setTimeout(r, 100));
    const nachher = [...b.querySelectorAll('.stub-row')];
    aus.zeilenIdentischNachHass = vorher.length === nachher.length && vorher.every((n, i) => n === nachher[i]);
    aus.hassAnZeilenDurchgereicht = nachher.every(n => Number(n.dataset.hassGesetzt) >= 2);
    // 2. Eine neue Entitaet am Geraet baut um.
    const hass3 = { ...hass2, entities: { ...hass2.entities,
      'sensor.decke_neu': { entity_id: 'sensor.decke_neu', device_id: 'd1', labels: ['l_energie'], platform: 'shelly' } },
      states: { ...hass2.states, 'sensor.decke_neu': { state: '1', attributes: { friendly_name: 'Wohnzimmer Deckenlampe Neu' } } } };
    b.hass = hass3;
    await new Promise(r => setTimeout(r, 200));
    aus.zeilenNachNeuerEntitaet = b.querySelectorAll('.stub-row').length;
    // 3. Klick auf den Kopf klappt A auf.
    const kopf = a.querySelector('.dev-kopf');
    const ev = (t) => kopf.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: 10, clientY: 10 }));
    ev('pointerdown'); ev('pointerup');
    aus.aOffenNachTipp = !a.querySelector('.dev-liste').hidden;
    // 4. Halten feuert hass-more-info.
    ev('pointerdown');
    await new Promise(r => setTimeout(r, 600));
    ev('pointerup');
    aus.moreInfoNachHalten = window.__moreInfo.slice();
    aus.aOffenNachHalten = !a.querySelector('.dev-liste').hidden;
    // 5. device-page an C aendert den Pfad.
    const pfadVorher = location.pathname;
    const kc = window.__c.querySelector('.dev-kopf');
    const evc = (t) => kc.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: 10, clientY: 10 }));
    evc('pointerdown');
    await new Promise(r => setTimeout(r, 600));
    evc('pointerup');
    aus.pfadNachDevicePage = location.pathname;
    history.replaceState(null, '', pfadVorher);
    // 6. Diagnose-Gruppe an C aufklappen.
    const diag = window.__c.querySelector('.dev-gruppe[data-gruppe=diagnostic]');
    aus.diagnoseZuVorher = diag ? diag.classList.contains('dev-zu') : null;
    if (diag) diag.querySelector('.dev-gruppe-kopf').click();
    aus.diagnoseZuNachher = diag ? diag.classList.contains('dev-zu') : null;
    // 8. Kopfzeile antippen ruft den Dienst mit ersetzten Daten.
    window.__dienste.length = 0;
    const kb = window.__b.querySelector('.dev-kopf');
    const evb = (t) => kb.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: 10, clientY: 10 }));
    evb('pointerdown'); evb('pointerup');
    await new Promise(r => setTimeout(r, 60));
    aus.dienstNachKopfTipp = JSON.parse(JSON.stringify(window.__dienste));
    // 9. Eine Zeile antippen ruft ihn mit IHRER Entitaet.
    window.__dienste.length = 0;
    const zeile = window.__b.querySelector('.dev-zeilen .stub-name');
    aus.zeileText = zeile ? zeile.textContent : null;
    if (zeile) zeile.click();
    await new Promise(r => setTimeout(r, 60));
    aus.dienstNachZeilenTipp = JSON.parse(JSON.stringify(window.__dienste));
    // 10. Der Schalter einer Schalterzeile bleibt bedienbar und loest KEINEN
    //     eigenen Dienst der Karte aus.
    window.__dienste.length = 0;
    const schalter = document.querySelector('#karte-e .stub-toggle');
    aus.schalterGefunden = Boolean(schalter);
    if (schalter) { schalter.click(); await new Promise(r => setTimeout(r, 60)); }
    aus.dienstNachSchalter = JSON.parse(JSON.stringify(window.__dienste));
    // 11. Jede Gruppe klappt, auch Sensoren.
    const sens = window.__b.querySelector('.dev-gruppe[data-gruppe=sensor]');
    aus.sensorZuVorher = sens ? sens.classList.contains('dev-zu') : null;
    if (sens) sens.querySelector('.dev-gruppe-kopf').click();
    aus.sensorZuNachher = sens ? sens.classList.contains('dev-zu') : null;
    return aus;
}"""

requests, responses, failures, console, errors = [], [], [], [], []


def horchen(page):
    page.on("request", lambda r: requests.append(r.url))
    page.on("response", lambda r: responses.append((r.status, r.url)))
    page.on("requestfailed", lambda r: failures.append((r.url, r.failure)))
    page.on("console", lambda m: console.append((m.type, m.text)))
    page.on("pageerror", lambda e: errors.append(str(e)))


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        regeln.ha_icon_attrappe(browser)  # M79: shared ha-icon with the real MDI glyphs (hacs/docs/render/mdi-pfade.json)
        page = browser.new_page(viewport={"width": WIDTH, "height": 1400},
                                device_scale_factor=2, locale="de-DE")
        horchen(page)
        page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        page.wait_for_selector("#karte-b .stub-row", timeout=20000)
        page.wait_for_timeout(800)

        bericht = page.evaluate(AUSLESEN)
        umgebung = page.evaluate(UMGEBUNG)
        assert page.locator('#karte-f .dev-name').inner_text() == 'Wohnzimmer Deckenlampe'
        assert page.locator('#karte-f .stub-tile').count() == 1
        assert 'nicht' in page.locator('#karte-g .dev-hinweis').inner_text()
        # Restfund H (#1321): one clear state, no "Kein Geraet gewaehlt" header beside the cause.
        assert page.locator('#karte-g .dev-kopf').is_hidden()
        assert 'Kein Gerät gewählt' not in page.locator('#karte-g').inner_text()
        assert page.locator('#karte-h .stub-tile').count() == 0
        assert page.locator('#karte-h .dev-hinweis:not([hidden])').count() >= 1
        assert page.locator('#karte-h .dev-name').inner_text() == 'Geraet ohne Entitaeten'
        for kind in ('entity', 'device', 'area', 'floor', 'label'):
            assert umgebung['wsAufrufe'].count('config/' + kind + '_registry/list') == 1


        page.screenshot(path=str(OUT / "geraet-page.png"), full_page=True)
        for kennung in ("a", "b", "c", "d", "e", "f", "g", "h", "i"):
            page.locator(f"#karte-{kennung}").screenshot(path=str(OUT / f"geraet-{kennung}.png"))

        page.evaluate("""() => { const w = document.getElementById('wrap');
                              w.style.maxWidth = 'none'; w.style.width = 'auto'; }""")
        ui = {}
        for kennung in ("#karte-a", "#karte-b", "#karte-c", "#karte-d", "#karte-e", "#karte-f", "#karte-g", "#karte-h", "#karte-i"):
            ui[kennung] = regeln.lauf_breiten(
                page, messung=lambda p, k=kennung: regeln.messe_text(p, k))
            ui[kennung].update(regeln.messe_kontrast_touch(page, kennung, ausnahmen=pathlib.Path(__file__).resolve().parent / "kontrast-ausnahmen.json"))  # M26
            for lauf in ui[kennung]["laeufe"]:
                page.set_viewport_size({"width": lauf["breite"], "height": 1400})
                page.evaluate("(t) => { document.documentElement.dataset.theme = t; }", lauf["thema"])
                page.wait_for_timeout(250)
                page.locator(kennung).screenshot(
                    path=str(OUT / ("geraet-%s-%d-%s.png" % (kennung[1:], lauf["breite"], lauf["thema"]))))

        page.set_viewport_size({"width": WIDTH, "height": 1400})
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
        page.wait_for_timeout(300)
        selbsttest = regeln.selbsttest(page, "#karte-b")

        verhalten = page.evaluate(VERHALTEN)
        page.wait_for_timeout(300)
        page.locator("#karte-a").screenshot(path=str(OUT / "geraet-a-offen.png"))
        nachher = page.evaluate(AUSLESEN)
        ha_icon = regeln.ha_icon_fehlend(page)  # M79: stand-in active, names without a path
        page.close()
        browser.close()
finally:
    server.terminate()

report = {
    "requests": requests,
    "brand_requests": [u for u in requests if "brands.home-assistant.io" in u],
    "bad_responses": [r for r in responses if r[0] >= 400 and "brands.home-assistant.io" not in r[1]],
    "request_failures": [f for f in failures if "brands.home-assistant.io" not in f[0]],
    "brand_failures": [f for f in failures if "brands.home-assistant.io" in f[0]],
    "console_errors": [c for c in console if c[0] == "error"],
    "console_all": console,
    "page_errors": errors,
    "ha_icon": ha_icon,
    "umgebung": umgebung,
    "karten": bericht,
    "verhalten": verhalten,
    "karten_nach_verhalten": nachher,
    "ui_regeln": ui,
    "ui_regeln_zaehlung": {k: regeln.zaehle(v) for k, v in ui.items()},
    "ui_selbsttest": selbsttest,
}
regeln.schreibe(OUT / "report.json", report, zeige=0)
sys.exit(regeln.bewerte(report))
