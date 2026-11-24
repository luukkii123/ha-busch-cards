#!/usr/bin/env python3
"""Rendert die Kalenderkarte aus busch-cards.js in echtem Chromium.

Aufruf:  python3 render-kalender.py <pfad/busch-cards.js> <ausgabeordner> [breite]

Zweck ueber die Screenshots hinaus: **die Zahl der gezeichneten Tageszeilen aus
dem DOM auslesen**. `tageZeilen = 31` ist der Nachweis, dass die Karte auf
Kalendergrenzen rechnet und nicht auf einem gleitenden Fenster ab heute — ein
Blick aufs Bild belegt das nicht.

ZWEI DURCHGAENGE, weil `page.clock` an der SEITE haengt und nicht an der Karte:

  1. `page.html`          — Uhr 15.08.2026, Karten A und B auf `month_offset: 0`
  2. `page-vormonat.html` — Uhr 15.09.2026, Karte C auf `month_offset: -1`

Der zweite Durchgang ist der Fall des Nutzers: „voriger Monat" muss den GANZEN
August zeigen, waehrend die Uhr im September steht — und dabei darf KEIN Tag
als „heute" markiert sein. Beide Seiten laufen im selben Browser, ueber
denselben HTTP-Server, und schreiben in dieselben Netz- und Fehlerlisten.

Aufbau uebernommen von `render-zeitplan.py`.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
from datetime import datetime

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
PORT = 8099

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>busch-calendar-card render</title>
<style>
  /* Die Karte nutzt ausschliesslich HA-eigene CSS-Variablen. Ohne sie bliebe
     alles farblos — das waere ein Fehler der Attrappe, nicht der Karte.
     Werte aus dem hellen Standardtheme von Home Assistant. */
  :root {
    --primary-color: #03a9f4;
    --accent-color: #ff9800;
    --primary-text-color: #212121;
    --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd;
    --divider-color: #e0e0e0;
    --error-color: #db4437;
    --card-background-color: #fff;
    --ha-card-background: #fff;
    --secondary-background-color: #e5e5e5;
    --text-primary-color: #fff;
  }
  body { margin: 0; padding: 16px; background: #f2f4f7; font-family: Roboto, sans-serif;
         color: var(--primary-text-color); }
  #wrap { max-width: __MAXW__px; margin: 0 auto; }
  ha-card { display: block; background: #fff; border-radius: 12px;
            box-shadow: 0 2px 6px rgba(0,0,0,.15); overflow: hidden; }
  busch-calendar-card { display: block; margin-bottom: 20px; }
</style>
<div id="wrap"></div>
<div id="editorwrap" style="max-width:__MAXW__px;margin:0 auto"></div>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    connectedCallback() { this.style.display = 'inline-block';
      this.style.width = '24px'; this.style.height = '24px'; this.textContent = '\\u25C6'; }
  }
  customElements.define('ha-icon', HaIcon);
  /* ha-form ist hier eine ATTRAPPE. Sie haelt nur den Vertrag ein, auf den der
     Editor sich stuetzt (hass/schema/data/computeLabel hinein, value-changed
     heraus). Sie zeichnet NICHTS, was Home Assistants echtem ha-form aehnlich
     saehe — deshalb entsteht von ihr auch kein Bild. */
  class HaForm extends HTMLElement {
    set schema(v) { this._schema = v; }
    get schema() { return this._schema; }
    set data(v) { this._data = v; }
    get data() { return this._data; }
    set hass(v) { this._hass = v; }
    get hass() { return this._hass; }
  }
  customElements.define('ha-form', HaForm);

  /* ── erfundener hass ───────────────────────────────────────────────────── */
  const TERMINE = [
    {start:{dateTime:"2026-08-03T08:49:13+02:00"}, end:{dateTime:"2026-08-03T16:15:08+02:00"},
     summary:"DZ", description:"", location:null, uid:"e1"},
    {start:{dateTime:"2026-08-04T06:30:00+02:00"}, end:{dateTime:"2026-08-04T16:00:00+02:00"},
     summary:"TA", description:"", location:null, uid:"e2"},
    {start:{dateTime:"2026-08-05T09:00:07+02:00"}, end:{dateTime:"2026-08-05T17:44:54+02:00"},
     summary:"DZ", description:"", location:null, uid:"e3"},
    {start:{date:"2026-08-10"}, end:{date:"2026-08-13"},
     summary:"Urlaub", description:"drei Tage", location:"zu Hause", uid:"e4"},
  ];

  window.__apiCalls = [];
  window.__abos = [];
  const hass = {
    locale: { language: "de-DE" },
    states: {
      "calendar.arbeitszeiten": {
        state: "off",
        last_changed: "2026-08-01T00:00:00+02:00",
        attributes: { friendly_name: "Arbeitszeiten" },
      },
      "calendar.privat": {
        state: "off",
        last_changed: "2026-08-01T00:00:00+02:00",
        attributes: { friendly_name: "Privat" },
      },
    },
    callApi: async (methode, pfad) => {
      window.__apiCalls.push(methode + " " + pfad);
      if (!pfad.startsWith("calendars/")) return [];
      return TERMINE;
    },
    // #1326 (M39): HA's `calendar/event/subscribe`. The first event goes to
    // the new subscriber at once, in `CalendarEvent.as_dict()` form (plain
    // start/end strings, `all_day`); REST above is only the fallback.
    connection: {
      subscribeMessage(callback, msg) {
        window.__abos.push(msg.type + " " + msg.entity_id);
        if (msg.type !== "calendar/event/subscribe") return Promise.reject({ code: "unknown_command" });
        const events = TERMINE.map((t) => ({
          summary: t.summary, uid: t.uid,
          ...(t.description ? { description: t.description } : {}),
          ...(t.location ? { location: t.location } : {}),
          start: t.start.dateTime || t.start.date, end: t.end.dateTime || t.end.date,
          all_day: !t.start.dateTime,
        }));
        Promise.resolve().then(() => callback({ events }));
        return Promise.resolve(() => Promise.resolve());
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  window.__hass = hass;
  window.__termine = TERMINE;
</script>
<script src="/busch-cards.js"></script>
<script>
  window.__ready = (async () => {
__KARTEN__
    return true;
  })();
</script>
"""

KARTEN_LAUFEND = """
    const a = document.createElement("busch-calendar-card");
    a.setConfig({ entities: ["calendar.arbeitszeiten"], month_offset: 0,
                  show_total: true, title: "Arbeitszeit" });
    a.hass = hass;

    const b = document.createElement("busch-calendar-card");
    b.setConfig({ entities: ["calendar.arbeitszeiten"], month_offset: 0,
                  show_empty_days: false, show_total: true });
    b.hass = hass;

    // Ohne dieses Einhaengen rendert die Karte ins Nichts und der Auslesecode
    // findet keine einzige Zeile.
    a.id = "karte-a"; b.id = "karte-b";
    document.getElementById("wrap").append(a, b);
    window.__a = a; window.__b = b;

    // Der Editor: NUR als Datenprobe. Sein ha-form ist eine Attrappe, das
    // Farbfeld darunter dagegen eigenes HTML der Karte.
    const ed = document.createElement("busch-calendar-card-editor");
    ed.setConfig({ entities: ["calendar.arbeitszeiten", "calendar.privat"],
                   month_offset: 0, show_total: true, title: "Arbeitszeit" });
    ed.hass = hass;
    document.getElementById("editorwrap").appendChild(ed);
    window.__ed = ed;
"""

# Der Fall des Nutzers: Uhr im September, Karte zeigt den ganzen August.
# Die alte Fremdkarte zeigt hier ein gleitendes 31-Tage-Fenster und schneidet
# den Monat an BEIDEN Enden ab.
KARTEN_VORMONAT = """
    const c = document.createElement("busch-calendar-card");
    c.setConfig({ entities: ["calendar.arbeitszeiten"], month_offset: -1,
                  show_total: true, show_empty_days: true, title: "Voriger Monat" });
    c.hass = hass;
    c.id = "karte-c";
    document.getElementById("wrap").append(c);
    window.__c = c;
"""

VORLAGE = PAGE.replace("__MAXW__", str(WIDTH - 60))
(SERVE / "page.html").write_text(
    VORLAGE.replace("__KARTEN__", KARTEN_LAUFEND), encoding="utf-8")
(SERVE / "page-vormonat.html").write_text(
    VORLAGE.replace("__KARTEN__", KARTEN_VORMONAT), encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

# Auslesecode als einzeiliger Ausdruck, damit er in page.evaluate passt.
# `heuteMarkierungen` ist der Gegenbeweis zur Monatsrechnung: im laufenden
# Monat genau 1, im Vormonat 0. Eine der beiden Zahlen allein belegt nichts.
AUSLESEN = (
    "() => [...document.querySelectorAll('busch-calendar-card')].map((k) => ({"
    "  monat: k.querySelector('.cal-monat') && k.querySelector('.cal-monat').textContent,"
    "  tageZeilen: k.querySelectorAll('.cal-tag').length,"
    "  ersteZeile: k.querySelector('.cal-tag .cal-datum')"
    "    && k.querySelector('.cal-tag .cal-datum').textContent.trim(),"
    "  letzteZeile: (() => { const a = [...k.querySelectorAll('.cal-tag .cal-datum')];"
    "    return a.length ? a[a.length - 1].textContent.trim() : null; })(),"
    "  termine: k.querySelectorAll('.cal-termin[data-uid]').length,"
    "  heuteMarkierungen: k.querySelectorAll('.cal-tag.cal-heute').length,"
    "  fuss: k.querySelector('.cal-fuss') && k.querySelector('.cal-fuss').textContent.trim(),"
    "}))"
)

# Umgebung mitschreiben: eine falsch stehende Uhr sieht sonst aus wie ein
# Fehler der Karte.
UMGEBUNG = """() => ({
    uhr: new Date().toString(),
    uhrIso: new Date().toISOString(),
    zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    apiCalls: window.__apiCalls,
    abos: window.__abos,
    registriert: ['busch-calendar-card','busch-calendar-card-editor',
                  'busch-schedule-card','busch-map-card']
                  .map(t => t + '=' + Boolean(customElements.get(t))),
    customCards: (window.customCards || []).map(c => c.type),
    heuteMarkiert: [...document.querySelectorAll('busch-calendar-card')]
        .map(k => [...k.querySelectorAll('.cal-heute .cal-nr')]
                    .map(e => e.textContent.trim())),
    wochenenden: [...document.querySelectorAll('busch-calendar-card')]
        .map(k => k.querySelectorAll('.cal-wochenende').length),
    hinweis: [...document.querySelectorAll('busch-calendar-card')]
        .map(k => k.querySelector('.cal-hinweis')
                  ? k.querySelector('.cal-hinweis').textContent.trim() : null),
    zeilenTexte: [...document.querySelectorAll('busch-calendar-card')]
        .map(k => [...k.querySelectorAll('.cal-tag')]
                    .filter(z => z.querySelector('.cal-termin[data-uid]'))
                    .map(z => z.textContent.trim())),
})"""

# Geometrie: fluchten die Datumsspalten, bricht nichts waagrecht aus?
GEOMETRIE = """() => {
    const karten = [...document.querySelectorAll('busch-calendar-card')];
    return karten.map(k => {
      const datums = [...k.querySelectorAll('.cal-tag .cal-datum')];
      const links = datums.map(d => Math.round(d.getBoundingClientRect().left));
      const inhalte = [...k.querySelectorAll('.cal-tag .cal-inhalt')]
                        .map(d => Math.round(d.getBoundingClientRect().left));
      const karte = k.querySelector('ha-card');
      const kb = karte.getBoundingClientRect();
      const ueberstand = [...k.querySelectorAll('*')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > kb.right + 1 || r.left < kb.left - 1);
      }).map(e => e.className || e.tagName);
      return {
        datumSpaltenLinks: [...new Set(links)],
        inhaltSpaltenLinks: [...new Set(inhalte)],
        karteBreite: Math.round(kb.width),
        karteHoehe: Math.round(kb.height),
        ueberstehendeElemente: ueberstand,
        dokumentScrollBreite: document.documentElement.scrollWidth,
        dokumentClientBreite: document.documentElement.clientWidth,
        fussOben: k.querySelector('.cal-fuss')
          ? Math.round(k.querySelector('.cal-fuss').getBoundingClientRect().top - kb.top)
          : null,
      };
    });
}"""

EDITOR = """() => {
    const ed = window.__ed;
    const form = ed.querySelector('ha-form');
    const flach = (s) => s.flatMap(e => e.type === 'grid'
                            ? e.schema.map(x => x.name) : [e.name]);
    return {
      hinweis: 'ha-form ist hier eine Attrappe — sie belegt Verdrahtung '
               + 'und Schema, NICHT die Darstellung im echten Frontend.',
      formVorhanden: Boolean(form),
      schemaNamen: form ? flach(form.schema) : null,
      beschriftungen: form
        ? flach(form.schema).map(n => form.computeLabel({name: n})) : null,
      // Seit 09.09.2026 verlangt Regel 3 zu JEDEM Feld auch einen Helper.
      // Gemessen wird, was `ha-form` bekaeme — nicht, was im Woerterbuch steht.
      helfer: form && form.computeHelper
        ? Object.fromEntries(flach(form.schema)
            .map(n => [n, form.computeHelper({name: n})])) : null,
      helferOhneVorgabe: form && form.computeHelper
        ? flach(form.schema).filter(n => !/Vorgabe|Default/.test(
            form.computeHelper({name: n}) || '')) : null,
      daten: form ? form.data : null,
      farbfeldFarben: [...ed.querySelectorAll('input[type=color]')]
                        .map(i => i.dataset.entity + '=' + i.value),
      farbfeldNamen: [...ed.querySelectorAll('label span')]
                       .map(s => s.textContent),
    };
}"""

# ── Durchgang 3: MARKIERUNG ──────────────────────────────────────────────────
# Beschwerde des Nutzers: "wieso wird der betreff dann immer markiert lass das".
# Ein Doppelklick auf einen Termintitel markierte ihn blau wie Fliesstext,
# obwohl die Zeile klickbar ist.
#
# GEMESSEN WIRD DIE WIRKUNG, nicht der Stiltext: erst `getComputedStyle`, dann
# ein echter Doppelklick von Playwright und danach `getSelection().toString()`.
# Der Stiltext allein wuerde nur belegen, dass eine Zeile in der Datei steht.
#
# Eine EIGENE Seite mit EIGENEN Horchlisten, damit der Doppelklick (er oeffnet
# ueber `_oeffneTermin` den Rueckfall auf den Entitaets-Dialog) die Konsolen-
# und Netzlisten der beiden Sollwert-Durchgaenge nicht verunreinigt.
STILWERTE = """() => {
    const k = document.querySelectorAll('busch-calendar-card')[0];
    const w = (sel) => {
      const e = k.querySelector(sel);
      return e ? getComputedStyle(e).userSelect : null;
    };
    return {
      terminZeile: w('.cal-termin[data-uid]'),
      terminTitel: w('.cal-termin[data-uid] .cal-titel'),
      terminZeit:  w('.cal-termin[data-uid] .cal-zeit'),
      leereZeile:  w('.cal-leer .cal-termin'),
      pfeil:       w('.cal-pfeil'),
      monatsName:  w('.cal-monat'),
      fussWert:    w('.cal-fuss span'),
      datumSpalte: w('.cal-tag .cal-datum'),
      kartenTitel: w('.cal-titel-zeile'),
    };
}"""


def markierung_messen(seite):
    """Doppelklick auf Titel, Monatsname, Pfeil — je mit gelesener Markierung."""
    ergebnis = {"stilwerte": seite.evaluate(STILWERTE)}

    def leeren():
        seite.evaluate("() => window.getSelection().removeAllRanges()")

    karte = seite.locator("busch-calendar-card").nth(0)

    # 1. Der Fall des Nutzers: Doppelklick auf den Termintitel.
    titel = karte.locator(".cal-termin[data-uid] .cal-titel").first
    ergebnis["titelText"] = titel.text_content()
    leeren()
    titel.dblclick()
    seite.wait_for_timeout(150)
    ergebnis["markierungNachDoppelklickTitel"] = seite.evaluate(
        "() => window.getSelection().toString()")

    # 2. Gegenprobe: Der Monatsname im Kopf MUSS markierbar bleiben. Ohne ihn
    #    belegt ein leeres Ergebnis oben nichts — es koennte auch heissen, dass
    #    der Doppelklick gar nicht ankommt.
    monat = karte.locator(".cal-monat").first
    ergebnis["monatText"] = monat.text_content()
    leeren()
    monat.dblclick()
    seite.wait_for_timeout(150)
    ergebnis["markierungNachDoppelklickMonat"] = seite.evaluate(
        "() => window.getSelection().toString()")
    # M25 (19.11.2026): the month name is a button that opens the month picker over the header; close it before the arrow test.
    offen = "() => { const w = document.querySelector('busch-calendar-card .cal-wahl'); return !!w && !w.hidden; }"
    ergebnis["monatswahlNachDoppelklickMonat"] = seite.evaluate(offen)
    # Escape only acts with focus inside the picker; after the double click focus sits on the header, so use the X button.
    if seite.evaluate(offen): karte.locator(".cal-wahl-x").first.click()
    seite.wait_for_function("() => { const w = document.querySelector('busch-calendar-card .cal-wahl'); return !w || w.hidden; }", timeout=5000)

    # 3. Der Blaetterpfeil. `_blaettern` wird VORHER stillgelegt, weil es
    #    synchron `_render()` aufruft und dabei `innerHTML` neu setzt — das
    #    loescht jede Markierung, bevor sie gelesen werden kann. Ohne diese
    #    Stilllegung liefert die Messung an JEDEM Stand einen leeren String
    #    und belegt damit nichts. Am `user-select` aendert die Stilllegung
    #    nichts: das ist CSS und haengt nicht an der Klickbehandlung.
    seite.evaluate("() => { window.__a._blaettern = () => {}; }")
    pfeil = karte.locator(".cal-pfeil").first
    ergebnis["pfeilText"] = pfeil.text_content()
    leeren()
    pfeil.dblclick()
    seite.wait_for_timeout(150)
    ergebnis["markierungNachDoppelklickPfeil"] = seite.evaluate(
        "() => window.getSelection().toString()")
    ergebnis["monatNachPfeilDoppelklick"] = seite.evaluate(
        "() => document.querySelector('.cal-monat').textContent")

    # 4. Ziehen statt Doppelklick — fuer den Pfeil die EINZIGE Messung, die am
    #    alten Stand ueberhaupt etwas zeigt. Gemessen: Ein Doppelklick IN einen
    #    <button> erzeugt in Chromium gar keine Markierung, auch ohne
    #    `user-select`. Der Zug ueber die Kopfzeile dagegen nimmt das
    #    Pfeilzeichen mit — und weil er im Monatsnamen endet, der markierbar
    #    bleiben soll, unterscheidet dieselbe Messung beide Faelle:
    #    alt "\u2039 August", neu "August".
    def ziehen(von_el, bis_el, bis_versatz=40):
        leeren()
        a = von_el.bounding_box()
        b = bis_el.bounding_box()
        y = a["y"] + a["height"] / 2
        seite.mouse.move(a["x"] + 2, y)
        seite.mouse.down()
        seite.mouse.move(b["x"] + bis_versatz, b["y"] + b["height"] / 2, steps=12)
        seite.mouse.up()
        seite.wait_for_timeout(150)
        return seite.evaluate("() => window.getSelection().toString()")

    # Der Zug beginnt IM KOPFKASTEN links neben dem Pfeil, nicht im Knopf
    # selbst: Chromium startet in einem <button> ueberhaupt keine Markierung,
    # gemessen — von dort aus faende der Zug an JEDEM Stand nichts.
    kopf = karte.locator(".cal-kopf").first
    ergebnis["markierungNachZugUeberPfeilUndMonat"] = ziehen(kopf, monat)

    # 5. Derselbe Zug quer ueber eine Terminzeile: der Fall "beim Wischen wird
    #    alles blau". Er endet in der Datumsspalte der naechsten Zeile, die
    #    markierbar bleibt.
    zeile = karte.locator(".cal-termin[data-uid]").first
    ergebnis["zeileText"] = zeile.text_content()
    ergebnis["markierungNachZugUeberZeile"] = ziehen(zeile, zeile, bis_versatz=200)

    leeren()
    return ergebnis


requests, responses, failures, console, errors = [], [], [], [], []
mark_console, mark_errors = [], []


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

        # ── Durchgang 1: Uhr im August, month_offset 0 ────────────────────────
        page = browser.new_page(viewport={"width": WIDTH, "height": 900},
                                device_scale_factor=2, locale="de-DE",
                                timezone_id="Europe/Berlin")
        horchen(page)
        # Die Uhr MUSS vor dem Laden stehen, sonst rechnet month_offset einen
        # anderen Monat aus — und man misst einen leeren Monat, statt einen
        # Fehler der Karte zu sehen.
        page.clock.install(time=datetime(2026, 8, 15, 12, 0))
        page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        page.wait_for_selector(".cal-tag", timeout=20000)
        page.wait_for_timeout(800)

        bericht = page.evaluate(AUSLESEN)
        umgebung = page.evaluate(UMGEBUNG)
        geometrie = page.evaluate(GEOMETRIE)
        editor = page.evaluate(EDITOR)

        page.screenshot(path=str(OUT / "kalender-page.png"), full_page=True)
        page.locator("busch-calendar-card").nth(0).screenshot(
            path=str(OUT / "kalender-voll.png"))
        page.locator("busch-calendar-card").nth(1).screenshot(
            path=str(OUT / "kalender-kompakt.png"))
        # NUR das Farbfeld des Editors: das ist eigenes HTML der Karte, keine
        # Attrappe. Vom ha-form-Teil entsteht bewusst kein Bild.
        page.locator("busch-calendar-card-editor > div").screenshot(
            path=str(OUT / "kalender-editor-farbfeld.png"))

        # ── Regel 1 und 4: drei Breiten, zwei Themen ─────────────────────────
        # Die Screenshots oben entstehen bei der uebergebenen Breite und
        # bleiben unberuehrt. Erst danach wird `#wrap` freigegeben, damit die
        # Karte dem Ansichtsfenster folgt — sonst haenge sie an `max-width`
        # und alle drei Breiten ergaeben dasselbe Bild.
        #
        # BEIDE Karten werden gemessen, einzeln: die volle Liste (`#karte-a`,
        # mit Ueberschrift und Fuss) und die kompakte (`#karte-b`, ohne leere
        # Tage). Eine allein belegte die andere nicht.
        page.evaluate("""() => {
            for (const id of ['wrap', 'editorwrap']) {
              const w = document.getElementById(id);
              if (w) { w.style.maxWidth = 'none'; w.style.width = 'auto'; }
            }
        }""")
        ui = {}
        for kennung in ("#karte-a", "#karte-b"):
            ui[kennung] = regeln.lauf_breiten(
                page, messung=lambda p, k=kennung: regeln.messe_text(p, k))
            ui[kennung].update(regeln.messe_kontrast_touch(page, kennung, ausnahmen=pathlib.Path(__file__).resolve().parent / "kontrast-ausnahmen.json"))  # M26
            for lauf in ui[kennung]["laeufe"]:
                page.set_viewport_size({"width": lauf["breite"], "height": 1400})
                page.evaluate("(t) => { document.documentElement.dataset.theme = t; }",
                              lauf["thema"])
                page.wait_for_timeout(250)
                page.locator(kennung).screenshot(
                    path=str(OUT / ("kalender-%s-%d-%s.png"
                                    % (kennung[1:], lauf["breite"], lauf["thema"]))))

        # Mobile Bedienung: Monatswechsel und belegte Termine brauchen auch
        # bei 320 px eine ausreichend grosse Trefferflaeche.
        page.set_viewport_size({"width": 320, "height": 1400})
        touch_targets = page.evaluate("""() => ({
            arrows: [...document.querySelectorAll('#karte-a .cal-pfeil')]
              .map(el => el.getBoundingClientRect().height),
            events: [...document.querySelectorAll('#karte-a .cal-termin[data-uid]')]
              .map(el => el.getBoundingClientRect().height)
        })""")

        # ── Gegenprobe: schlaegt die Messung ueberhaupt an? ───────────────────
        page.set_viewport_size({"width": WIDTH, "height": 1400})
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
        page.wait_for_timeout(300)
        selbsttest = regeln.selbsttest(page, "#karte-a")
        ha_icon = regeln.ha_icon_fehlend(page)  # M79: stand-in active, names without a path
        page.close()

        # ── Durchgang 2: Uhr im September, month_offset -1 ────────────────────
        # Eigene Seite, weil page.clock an der Seite haengt.
        seite2 = browser.new_page(viewport={"width": WIDTH, "height": 900},
                                  device_scale_factor=2, locale="de-DE",
                                  timezone_id="Europe/Berlin")
        horchen(seite2)
        seite2.clock.install(time=datetime(2026, 9, 15, 12, 0))
        seite2.goto(f"http://127.0.0.1:{PORT}/page-vormonat.html", wait_until="load")
        seite2.wait_for_selector(".cal-tag", timeout=20000)
        seite2.wait_for_timeout(800)

        bericht2 = seite2.evaluate(AUSLESEN)
        umgebung2 = seite2.evaluate(UMGEBUNG)
        geometrie2 = seite2.evaluate(GEOMETRIE)

        seite2.screenshot(path=str(OUT / "kalender-vormonat-page.png"), full_page=True)
        seite2.locator("busch-calendar-card").nth(0).screenshot(
            path=str(OUT / "kalender-vormonat.png"))
        seite2.close()

        # ── Durchgang 3: Markierung ──────────────────────────────────────────
        seite3 = browser.new_page(viewport={"width": WIDTH, "height": 900},
                                  device_scale_factor=2, locale="de-DE",
                                  timezone_id="Europe/Berlin")
        seite3.on("console", lambda m: mark_console.append((m.type, m.text)))
        seite3.on("pageerror", lambda e: mark_errors.append(str(e)))
        seite3.clock.install(time=datetime(2026, 8, 15, 12, 0))
        seite3.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        seite3.wait_for_selector(".cal-tag", timeout=20000)
        seite3.wait_for_timeout(800)
        markierung = markierung_messen(seite3)
        seite3.close()

        browser.close()
finally:
    server.terminate()

report = {
    "requests": requests,
    "vendor_requests": [u for u in requests if "/vendor/" in u or "hacsfiles" in u],
    "bad_responses": [r for r in responses if r[0] >= 400],
    "request_failures": failures,
    "console_errors": [c for c in console if c[0] == "error"],
    "console_all": console,
    "page_errors": errors,
    "ha_icon": ha_icon,
    "laufend": {
        "seite": "page.html",
        "uhrGestelltAuf": "2026-08-15 12:00",
        "umgebung": umgebung,
        "karten": bericht,
        "geometrie": geometrie,
        "editor": editor,
    },
    "markierung": {
        "seite": "page.html (eigener Durchgang, eigene Horchlisten)",
        "uhrGestelltAuf": "2026-08-15 12:00",
        "messung": markierung,
        "console_all": mark_console,
        "page_errors": mark_errors,
    },
    "vormonat": {
        "seite": "page-vormonat.html",
        "uhrGestelltAuf": "2026-09-15 12:00",
        "umgebung": umgebung2,
        "karten": bericht2,
        "geometrie": geometrie2,
    },
    "ui_regeln": ui,
    "ui_regeln_zaehlung": {k: regeln.zaehle(v) for k, v in ui.items()},
    "touch_targets": touch_targets,
    "ui_selbsttest": selbsttest,
}
(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                 encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False)[:14000])
print("\nUI-Regeln:", json.dumps(report["ui_regeln_zaehlung"], ensure_ascii=False))
print("Selbsttest:", json.dumps({k: v for k, v in selbsttest.items() if k != "befund"},
                                ensure_ascii=False))

# Ein Verstoss gegen Regel 1 ist ein Fehler, kein Hinweis (docs/ui-regeln.md).
# Der Selbsttest zaehlt nicht mit — er ist die Gegenprobe am WERKZEUG. Er muss
# in BEIDE Richtungen stimmen: die fehlerhafte Sonde wird gemeldet, die
# gewollte Kuerzung NICHT.
schlecht = regeln.bewerte(ui)
# #1326 (M39): both pages load through calendar/event/subscribe, no REST fetch.
for name, umg in (("laufend", umgebung), ("vormonat", umgebung2)):
    rest = [c for c in umg.get("apiCalls", []) if " calendars/" in c]
    if not umg.get("abos") or rest:
        print(f"FEHLER: Kalender ({name}) laedt nicht ueber calendar/event/subscribe (M39):",
              umg.get("abos"), rest)
        schlecht = 1
if not all(touch_targets.values()) or any(
        height < 44 for targets in touch_targets.values() for height in targets):
    print("FEHLER: Monatswechsel oder Termin ist auf 320 px kleiner als 44 px.")
    schlecht = 1
if not (selbsttest["ueberlauf_erkannt"] and selbsttest["ausserhalb_erkannt"]):
    print("FEHLER: Die Gegenprobe hat nicht angeschlagen — die Messung ist blind.")
    schlecht = 1
if not (selbsttest["ellipsis_nicht_gemeldet"]
        and selbsttest["ellipsis_als_gekuerzt_gezaehlt"]):
    print("FEHLER: Die gewollte Kuerzung wird als Ueberlauf gemeldet — "
          "die Messung ist ueberempfindlich.")
    schlecht = 1
sys.exit(schlecht)
