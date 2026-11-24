#!/usr/bin/env python3
"""Rendert die Zeitplan-Karte aus busch-cards.js in echtem Chromium.

Aufruf:  python3 render-zeitplan.py <pfad/busch-cards.js> <ausgabeordner> [breite]

Zweck über die Screenshots hinaus: **die Blockbeschriftungen aus dem DOM
auslesen**. In v0.3.0 gewann im gemeinsamen Gültigkeitsbereich das zweite
`formatClock` (Timeline, Millisekunden-Zeitstempel), und jede Uhrzeit der
Zeitplan-Karte stand als `01:00 AM` im Balken. Der Beleg dafür, dass das behoben
ist, ist nicht der Anblick, sondern `blockTexts` in `report.json`.

Die Datei wird über einen lokalen HTTP-Server ausgeliefert, damit jeder
Nachladeversuch aus einem Unterordner ein echter 404 wäre.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

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
PORT = 8098
# Feste Uhr für Heute-Markierung und Uhrzeitlinie: Mittwoch, 13:45 in Wien.
WIEN = ZoneInfo("Europe/Vienna")
UHR = datetime(2026, 10, 21, 13, 45, tzinfo=WIEN)

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>busch-schedule-card render</title>
<style id="regeln-thema">
  /* Die Karte nutzt ausschließlich HA-eigene CSS-Variablen. Ohne sie bleibt
     jeder Block weiß auf weiß — das wäre ein Fehler der Attrappe, nicht der
     Karte. Werte aus dem hellen und dem dunklen Standardtheme von Home
     Assistant.

     Die Kennung `regeln-thema` ist ein Vertrag mit `regeln.py`: eine Seite,
     die ihn trägt, bringt beide Themen selbst mit, und `lauf_breiten` legt
     nur noch `data-theme` am <html> um. Fehlt die Kennung, schiebt
     `regeln.py` seine eigenen Werte nach. */
  :root, :root[data-theme="light"] {
    color-scheme: light;
    --primary-color: #03a9f4;
    --accent-color: #ff9800;
    --primary-text-color: #212121;
    --secondary-text-color: #727272;
    --disabled-text-color: #bdbdbd;
    --divider-color: #e0e0e0;
    --error-color: #db4437;
    --card-background-color: #fff;
    --ha-card-background: #fff;
    --primary-background-color: #fafafa;
    --secondary-background-color: #e5e5e5;
    --text-primary-color: #fff;
    --ha-card-border-radius: 12px;
    --ha-space-1: 4px; --ha-space-2: 8px; --ha-space-3: 12px; --ha-space-4: 16px;
    --ha-font-size-s: 12px; --ha-font-size-m: 14px; --ha-font-size-l: 16px;
    --ha-font-weight-normal: 400; --ha-font-weight-medium: 500;
    --ha-font-weight-bold: 700;
    --seite-hintergrund: #f2f4f7;
    --karte-hintergrund: #fff;
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --primary-text-color: #e1e1e1;
    --secondary-text-color: #9b9b9b;
    --disabled-text-color: #6f6f6f;
    --divider-color: #474747;
    --card-background-color: #1c1c1c;
    --ha-card-background: #1c1c1c;
    --primary-background-color: #111;
    --secondary-background-color: #202020;
    --text-primary-color: #212121;
    --seite-hintergrund: #111;
    --karte-hintergrund: #1c1c1c;
  }
  body { margin: 0; padding: 16px; background: var(--seite-hintergrund);
         font-family: Roboto, sans-serif; color: var(--primary-text-color); }
  #wrap { max-width: __MAXW__px; margin: 0 auto; }
  ha-card { display: block; background: var(--karte-hintergrund);
            border-radius: var(--ha-card-border-radius); padding: 16px;
            box-shadow: 0 2px 6px rgba(0,0,0,.15); }
</style>
<div id="wrap"></div>
<script>
  /* Like HA's ha-card, the stand-in paints its surface from its OWN shadow
     root (:host). The card renders <ha-card> inside its shadow root, where the
     page rule `ha-card { … }` above never applies: without this the card stood
     transparent on the page background, and the contrast measurement (M26)
     judged every text against #f2f4f7 instead of the card surface (run
     20261119-164604: secondary text 4.37:1, on the real card #fff 4.81:1). */
  class HaCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host { display: block;'
        + ' background: var(--ha-card-background, var(--card-background-color, white));'
        + ' border-radius: var(--ha-card-border-radius, 12px);'
        + ' box-shadow: 0 2px 6px rgba(0,0,0,.15); color: var(--primary-text-color); }</style><slot></slot>';
    }
  }
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    connectedCallback() { this.style.display = 'inline-block';
      this.style.width = '24px'; this.style.height = '24px'; this.textContent = '◆'; }
  }
  customElements.define('ha-icon', HaIcon);
  class HaForm extends HTMLElement {}
  customElements.define('ha-form', HaForm);

  /* ── erfundener hass ───────────────────────────────────────────────────── */
  // Zeiten mit Bedacht gewählt: 08:00, 17:30 und 24:00 sind genau die Werte,
  // an denen die Namenskollision in v0.3.0 „01:00 AM" ergab.
  const item = {
    id: 'pool_zeitplan',
    name: 'Poolpumpe',
    icon: 'mdi:pool',
    monday:    [{ from: '08:00:00', to: '12:00:00' }, { from: '17:30:00', to: '21:15:00' }],
    tuesday:   [{ from: '06:45:00', to: '09:30:00' }],
    wednesday: [{ from: '08:00:00', to: '12:00:00' }, { from: '17:30:00', to: '21:15:00' }],
    thursday:  [{ from: '13:20:00', to: '15:05:00' }],
    friday:    [{ from: '08:00:00', to: '12:00:00' }, { from: '17:30:00', to: '24:00:00' }],
    saturday:  [{ from: '00:00:00', to: '24:00:00' }],
    sunday:    [],
  };
  window.__wsCalls = [];
  window.__hass = {
    locale: { language: 'de', first_weekday: 'monday' },
    states: {
      'schedule.pool_zeitplan': {
        entity_id: 'schedule.pool_zeitplan', state: 'off',
        last_updated: new Date().toISOString(),
        attributes: { friendly_name: 'Poolpumpe', icon: 'mdi:pool', editable: true,
                      next_event: new Date(Date.now() + 3600e3).toISOString() },
      },
    },
    callWS(msg) {
      window.__wsCalls.push(msg);
      if (msg.type === 'schedule/list') return Promise.resolve([item]);
      if (msg.type === 'config/entity_registry/get')
        return Promise.resolve({ entity_id: msg.entity_id, unique_id: 'pool_zeitplan' });
      return Promise.reject({ code: 'unknown_command' });
    },
    callService() { return Promise.resolve(); },
    formatEntityAttributeValue: (s, a) => '18:30',
    // #1326 (M12): HA's `schedule/subscribe`. The first event lists every
    // stored plan as `added` (helpers/collection.py); the card loads from it
    // and reads `schedule/list` only for the conflict check before a save.
    connection: {
      subscribeMessage(callback, msg) {
        window.__wsCalls.push(msg);
        if (msg.type !== 'schedule/subscribe') return Promise.reject({ code: 'unknown_command' });
        Promise.resolve().then(() => callback([{ change_type: 'added', schedule_id: item.id,
                                                 item: JSON.parse(JSON.stringify(item)) }]));
        return Promise.resolve(() => Promise.resolve());
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };
</script>
<script src="/busch-cards.js"></script>
<script>
  window.__ready = (async () => {
    const card = document.createElement('busch-schedule-card');
    card.setConfig({ type: 'custom:busch-schedule-card',
                     entity: 'schedule.pool_zeitplan', title: 'Poolpumpe', step: 15 });
    document.getElementById('wrap').appendChild(card);
    card.hass = window.__hass;
    window.__card = card;
    return true;
  })();
</script>
"""
PAGE = PAGE.replace("__MAXW__", str(WIDTH - 60))
(SERVE / "page.html").write_text(PAGE, encoding="utf-8")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--directory", str(SERVE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(1.5)

requests, responses, failures, console, errors = [], [], [], [], []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        regeln.ha_icon_attrappe(browser)  # M79: shared ha-icon with the real MDI glyphs (hacs/docs/render/mdi-pfade.json)
        page = browser.new_page(viewport={"width": WIDTH, "height": 900},
                                device_scale_factor=2, locale="de-DE",
                                timezone_id="Europe/Vienna")
        # `set_fixed_time` friert nur Date ein; Timer laufen weiter — der
        # Minutentakt der Karte lässt sich so echt abwarten.
        page.clock.set_fixed_time(UHR)
        page.on("request", lambda r: requests.append(r.url))
        page.on("response", lambda r: responses.append((r.status, r.url)))
        page.on("requestfailed", lambda r: failures.append((r.url, r.failure)))
        page.on("console", lambda m: console.append((m.type, m.text)))
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        page.wait_for_function(
            "window.__card && window.__card.shadowRoot.querySelectorAll('.block').length > 0",
            timeout=20000)
        page.wait_for_timeout(800)

        probe = page.evaluate("""() => {
            const card = window.__card;
            const sr = card.shadowRoot;
            const blocks = [...sr.querySelectorAll('.block')];
            return {
              cardTag: card.tagName.toLowerCase(),
              blockCount: blocks.length,
              // Der eigentliche Beleg: was steht wirklich im Balken?
              blockTexts: blocks.map(b => ({
                day: b.dataset.day,
                title: b.getAttribute('title'),
                capShort: b.querySelector('.cap-short')?.textContent ?? null,
                capFull: b.querySelector('.cap-full')?.textContent ?? null,
              })),
              amPm: blocks.filter(b => /AM|PM/i.test(b.getAttribute('title') || '')).length,
              rulerText: [...sr.querySelectorAll('.ruler span, .ruler div')]
                           .map(e => e.textContent.trim()).filter(Boolean),
              dayLabels: [...sr.querySelectorAll('.day .label')].map(e => e.textContent.trim()),
              headerName: sr.querySelector('.name')?.textContent ?? null,
              headerSub: sr.querySelector('.sub')?.textContent ?? null,
              status: sr.querySelector('.status')?.textContent ?? null,
              wsCalls: window.__wsCalls.map(c => c.type),
              // Anatomie der beiden Dialoge (Regel 2): Titel da, X oben LINKS,
              // hoechstens zwei Aktionsknoepfe, Abbrechen dabei, Breite <= 560.
              dialoge: ['.block-dialog', '.day-dialog'].map((sel) => {
                const d = sr.querySelector(sel);
                const kopf = d.querySelector('.dlg-kopf');
                const x = d.querySelector('.dlg-x');
                const aktionen = [...d.querySelectorAll('.actions button')];
                const kopfKnoepfe = [...kopf.querySelectorAll('button')];
                return {
                  wahl: sel,
                  titelDa: Boolean(d.querySelector('h2')),
                  xDa: Boolean(x),
                  // "oben links" heisst: der erste Knopf im Kopf, vor dem Titel.
                  xIstErsterImKopf: kopfKnoepfe[0] === x,
                  aktionsknoepfe: aktionen.map(b => b.textContent.trim()),
                  abbrechenDa: aktionen.some(b => b.dataset.act === 'cancel'),
                  maxBreiteCss: getComputedStyle(d).maxWidth,
                };
              }),
            };
        }""")

        page.screenshot(path=str(OUT / "zeitplan-page.png"), full_page=True)
        page.locator("busch-schedule-card").screenshot(path=str(OUT / "zeitplan-card.png"))

        # ── Regel 1 an drei Breiten in beiden Themen ─────────────────────────
        # Die Screenshots oben entstehen bei der übergebenen Breite und bleiben
        # unberührt. Erst danach wird `#wrap` freigegeben, damit die Karte dem
        # Ansichtsfenster folgt — sonst hinge sie an `max-width` und alle drei
        # Breiten ergäben dasselbe Bild.
        page.evaluate("""() => {
            const w = document.getElementById('wrap');
            w.style.maxWidth = 'none'; w.style.width = 'auto';
        }""")
        ui = regeln.lauf_breiten(
            page,
            messung=lambda p: regeln.messe_text(p, "busch-schedule-card"))
        ui.update(regeln.messe_kontrast_touch(page, "busch-schedule-card", ausnahmen=pathlib.Path(__file__).resolve().parent / "kontrast-ausnahmen.json"))  # M26
        # ── Ersatzprüfung zur Touch-Ausnahme `.track > .block` (M26, R24) ────
        # Ein Block ist so breit wie seine Dauer (24-h-Spur); die Touchmessung
        # misst nur seinen eigenen Kasten. Getroffen wird aber der Block MIT
        # seinen Griffen: ein Tipp auf einen Griff öffnet ihn ebenso
        # (`_onPointerDown` → `closest('.block')`, ohne Bewegung
        # `_openBlockDialog`), und unter 48 px wandern die Griffe nach außen.
        # Gemessen wird diese Trefferfläche: Block ∪ Griffe, auf die Spur
        # beschnitten (sie schneidet ab), mindestens 44 × 44; dazu muss jeder
        # Griff in seiner sichtbaren Mitte wirklich zum eigenen Block führen
        # (nicht vom Nachbarn verdeckt). Ein Fehlschlag steht als
        # `touch_verstoesse` im Bericht und ergibt Exit 1.
        ui["trefferflaeche"] = regeln.lauf_breiten(
            page, themen=("light",),
            messung=lambda p: p.evaluate("""() => {
                const sr = window.__card.shadowRoot, out = { touch_verstoesse: [], geprueft: 0 };
                for (const track of sr.querySelectorAll('.track')) {
                  const t = track.getBoundingClientRect();
                  for (const block of track.querySelectorAll(':scope > .block')) {
                    const teile = [block, ...block.querySelectorAll('.handle')].map((e) => {
                      const r = e.getBoundingClientRect();
                      return { e, l: Math.max(r.left, t.left), r: Math.min(r.right, t.right),
                               o: Math.max(r.top, t.top), u: Math.min(r.bottom, t.bottom) };
                    }).filter((k) => k.r - k.l >= 1 && k.u - k.o >= 1);
                    if (!teile.length) continue;
                    out.geprueft++;
                    const w = Math.max(...teile.map((k) => k.r)) - Math.min(...teile.map((k) => k.l));
                    const h = Math.max(...teile.map((k) => k.u)) - Math.min(...teile.map((k) => k.o));
                    const fremd = teile.filter((k) => k.e !== block).filter((k) => {
                      const hit = sr.elementFromPoint((k.l + k.r) / 2, (k.o + k.u) / 2);
                      return !hit || hit.closest('.block') !== block;
                    }).map((k) => k.e.className);
                    if (Math.min(w, h) < 43.5 || fremd.length)
                      out.touch_verstoesse.push({ name: block.getAttribute('aria-label'),
                        w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, verdeckt: fremd });
                  }
                }
                if (!out.geprueft) out.touch_verstoesse.push({ fehler: 'kein Block gemessen' });
                return out;
            }"""))
        for lauf in ui["laeufe"]:
            page.set_viewport_size({"width": lauf["breite"], "height": 1200})
            page.evaluate("(t) => { document.documentElement.dataset.theme = t; }",
                          lauf["thema"])
            page.wait_for_timeout(250)
            page.locator("busch-schedule-card").screenshot(
                path=str(OUT / ("zeitplan-%d-%s.png" % (lauf["breite"], lauf["thema"]))))

        # ── Der Theme-Haken: wirkt eine Angabe aus dem THEME? ────────────────
        # `--busch-schedule-color` und `--busch-schedule-track-color` sind
        # dokumentierte Haken (README, „Aussehen anpassen"). Ein Theme setzt sie
        # am Wurzelelement; von dort erbt die Karte. Stünde in der Karte eine
        # eigene `:host`-Zeile für dieselbe Marke, legte sie den Haken still
        # tot — Vererbung verliert gegen jede Regel, die das Element selbst
        # trifft. Genau das ist am 09.09.2026 einmal passiert.
        #
        # Gemessen wird die WIRKUNG, nicht der Stiltext: erst die Farbe ohne
        # Theme (das muss `--primary-color` sein, der Rückfall), dann mit einer
        # Angabe am <html>, die es sonst nirgends gibt. Das Paar ist der Beleg
        # — der zweite Wert allein könnte auch von woanders kommen.
        page.set_viewport_size({"width": WIDTH, "height": 1200})
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
        page.wait_for_timeout(300)
        farben_lesen = """() => {
            const sr = window.__card.shadowRoot;
            const block = sr.querySelector('.block');
            const spur = sr.querySelector('.track');
            return { block: getComputedStyle(block).backgroundColor,
                     spur: getComputedStyle(spur).backgroundColor };
        }"""
        ohne_theme = page.evaluate(farben_lesen)
        page.evaluate("""() => {
            const s = document.createElement('style');
            s.id = 'theme-haken-probe';
            s.textContent = ':root { --busch-schedule-color: rgb(1, 2, 3);'
                          + ' --busch-schedule-track-color: rgb(4, 5, 6); }';
            document.head.appendChild(s);
        }""")
        page.wait_for_timeout(300)
        mit_theme = page.evaluate(farben_lesen)
        page.evaluate("() => document.getElementById('theme-haken-probe').remove()")
        page.wait_for_timeout(200)
        zurueck_ohne = page.evaluate(farben_lesen)
        theme_haken = {
            "ohne_theme": ohne_theme,
            "mit_theme": mit_theme,
            "nach_dem_entfernen": zurueck_ohne,
            "erwartet_mit_theme": {"block": "rgb(1, 2, 3)", "spur": "rgb(4, 5, 6)"},
            "ergebnis": (
                "bestanden"
                if (mit_theme["block"] == "rgb(1, 2, 3)"
                    and mit_theme["spur"] == "rgb(4, 5, 6)"
                    and ohne_theme["block"] != "rgb(1, 2, 3)"
                    and zurueck_ohne["block"] == ohne_theme["block"])
                else "verletzt"
            ),
        }

        # ── Heute-Markierung, Uhrzeitlinie, Nur-Lesen (0.19.0) ──────────────
        # Uhr steht auf Mittwoch 13:45 → genau eine markierte Zeile, eine Linie
        # bei 825/1440 = 57,29 %. Dann Mitternacht: Uhr auf Donnerstag 00:01
        # und den ECHTEN Minutentakt der Karte abwarten — nicht _renderNow von
        # Hand rufen, sonst wäre der Takt selbst unbelegt.
        page.set_viewport_size({"width": WIDTH, "height": 1200})
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
        page.wait_for_timeout(300)
        heute_lesen = """() => {
            const sr = window.__card.shadowRoot;
            const rows = [...sr.querySelectorAll('.day')];
            const heute = rows.filter(r => r.classList.contains('today'));
            const andere = rows.find(r => !r.classList.contains('today'));
            const linien = [...sr.querySelectorAll('.track .now')];
            const stil = (r) => r ? getComputedStyle(r.querySelector('.label')) : null;
            const karte = sr.querySelector('ha-card').getBoundingClientRect();
            const zeile = heute[0]?.getBoundingClientRect();
            return {
              heuteTage: heute.map(r => r.dataset.day),
              linien: linien.length,
              linieTag: linien[0]?.closest('.day')?.dataset.day ?? null,
              linieLinks: linien[0]?.style.left ?? null,
              linieLetztesKind: linien[0]
                ? linien[0].parentElement.lastElementChild === linien[0] : null,
              linieSichtbar: linien[0] ? linien[0].getBoundingClientRect().width > 0 : null,
              spurName: heute[0]?.querySelector('.track')?.getAttribute('aria-label') ?? null,
              heuteGewicht: stil(heute[0])?.fontWeight ?? null,
              andereGewicht: stil(andere)?.fontWeight ?? null,
              heuteFarbe: stil(heute[0])?.color ?? null,
              andereFarbe: stil(andere)?.color ?? null,
              heuteHintergrund: heute[0] ? getComputedStyle(heute[0]).backgroundColor : null,
              heuteHoehe: zeile?.height ?? null,
              andereHoehe: andere?.getBoundingClientRect().height ?? null,
              zeileInKarte: zeile ? (zeile.left >= karte.left && zeile.right <= karte.right) : null,
              takt: Boolean(window.__card._nowTimer),
            };
        }"""
        mittwoch = page.evaluate(heute_lesen)
        page.locator("busch-schedule-card").screenshot(path=str(OUT / "zeitplan-heute.png"))
        page.clock.set_fixed_time(datetime(2026, 10, 22, 0, 1, tzinfo=WIEN))
        page.wait_for_timeout(61500)
        donnerstag = page.evaluate(heute_lesen)
        page.clock.set_fixed_time(UHR)
        basis = ("{ type: 'custom:busch-schedule-card', entity: 'schedule.pool_zeitplan',"
                 "  title: 'Poolpumpe', step: 15 }")
        page.evaluate("() => window.__card.setConfig({ ...%s, highlight_today: false })" % basis)
        page.wait_for_timeout(200)
        abgeschaltet = page.evaluate(heute_lesen)

        lesen_zustand = """() => {
            const sr = window.__card.shadowRoot;
            const sichtbar = (sel) => [...sr.querySelectorAll(sel)]
              .filter(e => getComputedStyle(e).display !== 'none').length;
            return {
              readonlyKlasse: Boolean(sr.querySelector('ha-card.readonly')),
              plusSichtbar: sichtbar('.add-block'),
              griffeSichtbar: sichtbar('.handle'),
              offeneDialoge: [...sr.querySelectorAll('dialog')].filter(d => d.open).length,
              hinweis: sr.querySelector('.hint')?.textContent ?? null,
              bloecke: sr.querySelectorAll('.block').length,
              updates: window.__wsCalls.filter(c => c.type === 'schedule/update').length,
            };
        }"""
        page.evaluate("() => window.__card.setConfig({ ...%s, read_only: true })" % basis)
        page.wait_for_timeout(200)
        gesperrt = page.evaluate(lesen_zustand)
        # Alle Bearbeitungswege versuchen: Block antippen, Plus, Tagesdialog,
        # Ziehen auf der leeren Sonntagsspur und Enter auf einem Block.
        page.evaluate("""() => {
            const c = window.__card, b = c.shadowRoot.querySelector('.block');
            c._openBlockDialog(b.dataset.day, Number(b.dataset.index));
            c._openNewBlockDialog('sunday');
            c._openDayDialog('monday');
        }""")
        spur = page.locator("busch-schedule-card .track[data-day='sunday']").bounding_box()
        page.mouse.move(spur["x"] + spur["width"] * 0.2, spur["y"] + spur["height"] / 2)
        page.mouse.down()
        page.mouse.move(spur["x"] + spur["width"] * 0.6, spur["y"] + spur["height"] / 2, steps=8)
        page.mouse.up()
        page.locator("busch-schedule-card .block").first.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        nach_versuchen = page.evaluate(lesen_zustand)
        page.locator("busch-schedule-card").screenshot(path=str(OUT / "zeitplan-nur-lesen.png"))
        page.evaluate("() => window.__card.setConfig(%s)" % basis)
        page.wait_for_timeout(200)
        wieder_frei = page.evaluate(lesen_zustand)

        heute_nurlesen = {
            "uhr_mittwoch_1345": mittwoch,
            "uhr_donnerstag_0001_nach_takt": donnerstag,
            "highlight_today_aus": abgeschaltet,
            "read_only_an": gesperrt,
            "read_only_nach_bearbeitungsversuchen": nach_versuchen,
            "read_only_aus": wieder_frei,
            "ergebnis": (
                "bestanden"
                if (mittwoch["heuteTage"] == ["wednesday"] and mittwoch["linien"] == 1
                    and mittwoch["linieTag"] == "wednesday"
                    and str(mittwoch["linieLinks"]).startswith("57.29")
                    and mittwoch["linieLetztesKind"] and mittwoch["linieSichtbar"]
                    and mittwoch["spurName"] == "Mittwoch, heute"
                    and mittwoch["heuteGewicht"] != mittwoch["andereGewicht"]
                    and mittwoch["heuteFarbe"] != mittwoch["andereFarbe"]
                    and mittwoch["heuteHintergrund"] not in ("rgba(0, 0, 0, 0)", "transparent")
                    and mittwoch["heuteHoehe"] == mittwoch["andereHoehe"]
                    and mittwoch["zeileInKarte"] and mittwoch["takt"]
                    and donnerstag["heuteTage"] == ["thursday"] and donnerstag["linien"] == 1
                    and str(donnerstag["linieLinks"]).startswith("0.069")
                    and abgeschaltet["heuteTage"] == [] and abgeschaltet["linien"] == 0
                    and gesperrt["readonlyKlasse"] and gesperrt["plusSichtbar"] == 0
                    and gesperrt["griffeSichtbar"] == 0
                    and gesperrt["hinweis"] == "Schreibschutz aktiv — hier nur zum Ansehen."
                    and nach_versuchen["offeneDialoge"] == 0
                    and nach_versuchen["bloecke"] == gesperrt["bloecke"]
                    and nach_versuchen["updates"] == gesperrt["updates"]
                    and not wieder_frei["readonlyKlasse"] and wieder_frei["plusSichtbar"] == 7
                    and wieder_frei["hinweis"].startswith("Ziehen legt"))
                else "verletzt"
            ),
        }

        # ── Gegenprobe: schlägt die Messung überhaupt an? ────────────────────
        page.set_viewport_size({"width": WIDTH, "height": 1200})
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }")
        page.wait_for_timeout(300)
        selbsttest = regeln.selbsttest(page, "busch-schedule-card")

        # ── Regel 2 an BEIDEN Dialogen der Zeitplan-Karte ───────────────────
        # Beide sind Popups im Sinn der Spec: sie überlagern die Karte. Der
        # Blockdialog ist zusätzlich ein Formular — für ihn gilt die
        # HA-Ausnahme (ungespeicherte Änderungen: wackeln statt schließen),
        # die weiter unten eigens gemessen wird.
        popup = regeln.messe_popup(
            page,
            # Der Dialog geht über Zieherkennung auf (pointerdown/pointerup mit
            # Schwelle), nicht über einen schlichten Klick. Für die Messung wird
            # deshalb der Weg genommen, den die Karte selbst nimmt.
            oeffnen=lambda: page.evaluate(
                "() => { const b = window.__card.shadowRoot.querySelector('.block');"
                "        if (b) window.__card._openBlockDialog(b.dataset.day,"
                "                                              Number(b.dataset.index)); }"),
            popup_selektor=".block-dialog",
            # Der eigene Schließ-Knopf ist das X oben links (Regel 2, Anatomie).
            schliessen_knopf_selektor=".block-dialog .dlg-x", dialog_typ="bearbeitung")

        popup_tag = regeln.messe_popup(
            page,
            oeffnen=lambda: page.evaluate(
                "() => window.__card._openDayDialog('monday')"),
            popup_selektor=".day-dialog",
            schliessen_knopf_selektor=".day-dialog .dlg-x")

        # ── Die HA-Ausnahme: Formular mit ungespeicherten Änderungen ─────────
        # Gemessen wird die WIRKUNG, nicht der Stiltext: erst mit unverändertem
        # Formular Escape (muss schließen), dann mit geänderter Zeit Escape
        # (muss offen bleiben und wackeln), dann Abbrechen (muss trotzdem
        # schließen — ein Abbrechen ist eine Ansage, kein Danebentippen).
        def block_auf():
            page.evaluate(
                "() => { const b = window.__card.shadowRoot.querySelector('.block');"
                "        window.__card._openBlockDialog(b.dataset.day,"
                "                                       Number(b.dataset.index)); }")
            page.wait_for_timeout(250)

        def block_offen():
            return page.evaluate(
                "() => { const d = window.__card.shadowRoot"
                "          .querySelector('.block-dialog');"
                "        return { offen: d.open, wackelt: d.classList.contains('wackelt'),"
                "                 von: d.querySelector('.f-from').value }; }")

        block_auf()
        page.keyboard.press("Escape")
        page.wait_for_timeout(350)
        unveraendert = block_offen()

        block_auf()
        page.evaluate(
            "() => { const d = window.__card.shadowRoot.querySelector('.block-dialog');"
            "        d.querySelector('.f-from').value = '09:45'; }")
        # Vor Escape beobachten: die Klasse lebt nur 300 ms. Den Zustand beim
        # Setzen festhalten, damit eine spaete Antwort unter Last ihn nicht
        # verpasst. Ohne Wackeln bleibt der Nachweis aus und die Probe wird rot.
        page.evaluate("""() => {
            const d = window.__card.shadowRoot.querySelector('.block-dialog');
            window.__wackelZustand = null;
            const beobachter = new MutationObserver(() => {
                if (!d.classList.contains('wackelt')) return;
                window.__wackelZustand = {
                    offen: d.open, wackelt: true,
                    von: d.querySelector('.f-from').value,
                };
                beobachter.disconnect();
            });
            beobachter.observe(d, { attributes: true, attributeFilter: ['class'] });
        }""")
        page.keyboard.press("Escape")
        geaendert = page.wait_for_function(
            "() => window.__wackelZustand", timeout=5000).json_value()
        page.wait_for_timeout(350)
        geaendert_danach = block_offen()

        # Und derselbe Fall am SCRIM: ein Klick neben den Dialog darf ein
        # Formular mit ungespeicherten Änderungen ebenfalls nicht schließen.
        # Der Punkt (5, 5) liegt sicher daneben — der Dialog ist bei 620 px
        # Ansichtsfenster 380 px breit und mittig.
        page.mouse.click(5, 5)
        page.wait_for_timeout(400)
        nach_scrim = block_offen()

        page.once("dialog", lambda dialog: dialog.accept())
        page.evaluate(
            "() => window.__card.shadowRoot"
            "        .querySelector('.block-dialog .actions button[data-act=\"cancel\"]').click()")
        page.wait_for_timeout(400)
        nach_abbrechen = block_offen()

        formular = {
            "escape_ohne_aenderung": unveraendert,
            "escape_mit_aenderung": geaendert,
            "escape_mit_aenderung_nach_wackeln": geaendert_danach,
            "scrim_mit_aenderung": nach_scrim,
            "abbrechen_mit_aenderung": nach_abbrechen,
            # Der Sollwert als PAAR — eine der beiden Zahlen allein belegt nichts.
            "ergebnis": (
                "bestanden"
                if (not unveraendert["offen"]
                    and geaendert["offen"] and geaendert["wackelt"]
                    and nach_scrim["offen"]
                    and not nach_abbrechen["offen"])
                else "verletzt"
            ),
        }

        # ── Regel 1 IM geoeffneten Dialog ────────────────────────────────────
        # `lauf_breiten` oben misst die Karte mit GESCHLOSSENEN Dialogen — ein
        # geschlossenes <dialog> ist `display: none`, seine Knoepfe haben
        # Rechteck 0, und `regeln.py` gibt dort zu Recht „kein Urteil" statt
        # „bestanden". Gemessen ist damit über die Dialoge noch nichts.
        #
        # Deshalb hier ein zweiter Durchgang mit OFFENEM Dialog. Als
        # Bezugsrechteck dient der Dialog selbst: `messe_text` nimmt die
        # `ha-card` unterhalb des übergebenen Elements, und im Dialog gibt es
        # keine — also bleibt sein eigenes Rechteck. Genau richtig: Text darf
        # nicht über den Rand des Dialogs hinausragen, und unter 450 px ist
        # der Dialog Vollbild.
        dialog_ui = {}
        # M76 (F14): every dialog also at the phone widths 360 and 390 (R06), with contrast and
        # touch targets measured inside the open dialog (M26); the widths are listed in report.json.
        DIALOG_BREITEN = (320, 360, 390, 480, 960)
        ausnahmen_datei = pathlib.Path(__file__).resolve().parent / "kontrast-ausnahmen.json"
        for wahl, oeffner in (
            (".block-dialog",
             "() => { const b = window.__card.shadowRoot.querySelector('.block');"
             "        window.__card._openBlockDialog(b.dataset.day,"
             "                                       Number(b.dataset.index)); }"),
            (".day-dialog", "() => window.__card._openDayDialog('monday')"),
        ):
            def auf(p, o=oeffner):
                p.evaluate(o)
            dialog_ui[wahl] = regeln.lauf_breiten(
                page, breiten=DIALOG_BREITEN, vor_messung=auf,
                messung=lambda p, w=wahl: {
                    **regeln.messe_text(p, w),
                    **regeln.messe_kontrast_touch_hier(p, w, ausnahmen=ausnahmen_datei)})
            # ── Bilder der Dialoge: eigene Seite mit device_scale_factor 1 ──
            #
            # Bei `device_scale_factor=2` — dem Wert aller anderen Bilder hier —
            # steht in Chromiums SCREENSHOT eines formatfüllenden <dialog> eine
            # zweite, veraltete Kachel der Knopfzeile am oberen Rand: im Bild
            # zweimal „Abbrechen", oben und unten. Nachgemessen ist genau EINES
            # da. Belege, bei sonst gleichem Aufbau:
            #
            #   dsf 1 -> actionsY 1152, elementFromPoint(250,58) = div.dlg,
            #            im Bild EIN „Abbrechen"
            #   dsf 2 -> actionsY 1152, elementFromPoint(250,58) = div.dlg,
            #            im Bild ZWEI
            #
            # Gleiches DOM, gleicher Treffertest, anderes Bild. Weder ein
            # Neuladen bei der Zielbreite noch Schließen und Neuöffnen des
            # Dialogs noch längeres Warten half — nur der Maßstab. Die MESSUNG
            # ist davon unberührt: sie liest Kastenmaße, keine Pixel. Aber ein
            # Bild, das etwas zeigt, das es nicht gibt, taugt nicht als Beleg —
            # deshalb entstehen DIESE Bilder auf einer eigenen Seite mit
            # Maßstab 1.
            bildseite = browser.new_page(viewport={"width": 320, "height": 1200},
                                         device_scale_factor=1, locale="de-DE")
            for lauf in dialog_ui[wahl]["laeufe"]:
                bildseite.set_viewport_size({"width": lauf["breite"], "height": 1200})
                bildseite.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
                bildseite.wait_for_function(
                    "window.__card && window.__card.shadowRoot"
                    ".querySelectorAll('.block').length > 0", timeout=20000)
                bildseite.evaluate("""() => {
                    const w = document.getElementById('wrap');
                    w.style.maxWidth = 'none'; w.style.width = 'auto';
                }""")
                bildseite.evaluate("(t) => { document.documentElement.dataset.theme = t; }",
                                   lauf["thema"])
                bildseite.evaluate(oeffner)
                bildseite.wait_for_timeout(400)
                bildseite.screenshot(path=str(OUT / ("dialog-%s-%d-%s.png"
                                                     % (wahl[1:], lauf["breite"], lauf["thema"]))))
            bildseite.close()
            page.evaluate("() => { for (const d of"
                          " window.__card.shadowRoot.querySelectorAll('dialog'))"
                          "   if (d.open) d.close(); }")
            page.wait_for_timeout(200)

        # ── M76: block dialog on real phone heights without a large empty area ──
        # Full screen below 450 px (rule 2) with the actions fixed at the bottom. Measured: the gap
        # between the lowest visible content of `.body` and the top of the actions, as share of the
        # dialog height (limit 15 %), and the height of the duration preview that fills it.
        # Own page with scale 1, for the same reason as the dialog images above (dsf 2 ghosts).
        leerflaeche = []
        handy = browser.new_page(viewport={"width": 320, "height": 568},
                                 device_scale_factor=1, locale="de-DE")
        handy.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        handy.wait_for_function("window.__card && window.__card.shadowRoot"
                                ".querySelectorAll('.block').length > 0", timeout=20000)
        handy.evaluate("() => { const w = document.getElementById('wrap');"
                       " w.style.maxWidth = 'none'; w.style.width = 'auto'; }")
        for breite, hoehe in ((320, 568), (360, 640), (390, 844)):
            handy.set_viewport_size({"width": breite, "height": hoehe})
            handy.wait_for_timeout(250)
            handy.evaluate("() => { const b = window.__card.shadowRoot.querySelector('.block');"
                          "  window.__card._openBlockDialog(b.dataset.day, Number(b.dataset.index)); }")
            handy.wait_for_timeout(300)
            mass = handy.evaluate("""() => {
                const d = window.__card.shadowRoot.querySelector('.block-dialog');
                const r = d.getBoundingClientRect(), a = d.querySelector('.actions').getBoundingClientRect();
                const unten = Math.max(...[...d.querySelectorAll('.body > *')]
                  .map((e) => e.getBoundingClientRect()).filter((k) => k.width && k.height).map((k) => k.bottom));
                const v = d.querySelector('.vorschau').getBoundingClientRect();
                return { dialog_h: Math.round(r.height), leer_px: Math.round(a.top - unten),
                         vorschau_h: Math.round(v.height), dauer: d.querySelector('.dauer').textContent };
            }""")
            mass.update(breite=breite, hoehe=hoehe,
                        anteil=round(mass["leer_px"] / max(1, mass["dialog_h"]), 3))
            mass["ergebnis"] = ("bestanden" if mass["anteil"] <= 0.15 and mass["vorschau_h"] >= 120
                                and mass["dauer"] else "verletzt")
            handy.screenshot(path=str(OUT / ("dialog-block-dialog-handy-%dx%d.png" % (breite, hoehe))))
            leerflaeche.append(mass)
            handy.evaluate("() => { for (const d of"
                           " window.__card.shadowRoot.querySelectorAll('dialog'))"
                           "   if (d.open) d.close(); }")
            handy.wait_for_timeout(200)
        handy.close()

        ha_icon = regeln.ha_icon_fehlend(page)  # M79: stand-in active, names without a path
        browser.close()
finally:
    server.terminate()

report = {
    "requests": requests,
    "vendor_requests": [u for u in requests if "/vendor/" in u or "hacsfiles" in u],
    "bad_responses": [r for r in responses if r[0] >= 400],
    "request_failures": failures,
    "console_errors": [c for c in console if c[0] == "error"],
    "page_errors": errors,
    "ha_icon": ha_icon,
    "probe": probe,
    "ui_regeln": ui,
    "ui_regeln_zaehlung": regeln.zaehle(ui),
    "ui_selbsttest": selbsttest,
    "ui_popup": popup,
    "ui_popup_tagesdialog": popup_tag,
    "ui_regeln_dialoge": dialog_ui,
    "ui_regeln_dialoge_zaehlung": {k: regeln.zaehle(v) for k, v in dialog_ui.items()},
    # M76: widths per dialog (summary/report must show 360 and 390 for each dialog).
    "ui_dialog_breiten": {k: sorted({l["breite"] for l in v["laeufe"]}) for k, v in dialog_ui.items()},
    "ui_blockdialog_leerflaeche": leerflaeche,
    "ui_formular_ausnahme": formular,
    "ui_theme_haken": theme_haken,
    "ui_heute_nurlesen": heute_nurlesen,
}
(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False)[:8000])
print("\nUI-Regeln:", json.dumps(report["ui_regeln_zaehlung"], ensure_ascii=False))
print("UI-Regeln in den Dialogen:",
      json.dumps(report["ui_regeln_dialoge_zaehlung"], ensure_ascii=False))
print("Selbsttest:", json.dumps({k: v for k, v in selbsttest.items() if k != "befund"},
                                ensure_ascii=False))
print("Popup Block:", json.dumps({k: v["ergebnis"] for k, v in popup.items()},
                                 ensure_ascii=False))
print("Popup Tag:  ", json.dumps({k: v["ergebnis"] for k, v in popup_tag.items()},
                                 ensure_ascii=False))
print("Formular-Ausnahme:", formular["ergebnis"])
print("Dialogbreiten (M76):", json.dumps(report["ui_dialog_breiten"], ensure_ascii=False))
print("Blockdialog Leerflaeche (M76):", json.dumps(
    [{k: m[k] for k in ("breite", "hoehe", "anteil", "vorschau_h", "ergebnis")} for m in leerflaeche],
    ensure_ascii=False))
print("Heute/Nur-Lesen:", heute_nurlesen["ergebnis"])
print("Theme-Haken:", theme_haken["ergebnis"],
      json.dumps({"ohne": theme_haken["ohne_theme"], "mit": theme_haken["mit_theme"]},
                 ensure_ascii=False))
# Ein Verstoß gegen Regel 1 oder 2 ist ein Fehler, kein Hinweis
# (docs/ui-regeln.md). Der Selbsttest zählt nicht mit — er ist die Gegenprobe
# am Werkzeug, nicht ein Befund an der Karte. Schlägt er nicht an, taugt der
# ganze Lauf nichts; deshalb dann ebenfalls Exit 1.
schlecht = (regeln.bewerte(ui) or regeln.bewerte(popup)
            or regeln.bewerte(popup_tag) or regeln.bewerte(formular)
            or regeln.bewerte(dialog_ui) or regeln.bewerte(theme_haken)
            or regeln.bewerte(heute_nurlesen) or regeln.bewerte(leerflaeche))
# #1326 (M12): loaded through `schedule/subscribe`, without a `schedule/list` before the first edit.
erste_ws = probe["wsCalls"]
if "schedule/subscribe" not in erste_ws or "schedule/list" in erste_ws:
    print("FEHLER: Der Zeitplan lädt nicht über schedule/subscribe (M12):", erste_ws)
    schlecht = 1
if any({360, 390} - set(b) for b in report["ui_dialog_breiten"].values()):
    print("FEHLER: ein Dialog ohne 360/390 px (M76).")
    schlecht = 1
if not (selbsttest["ueberlauf_erkannt"] and selbsttest["ausserhalb_erkannt"]):
    print("FEHLER: Die Gegenprobe hat nicht angeschlagen — die Messung ist blind.")
    schlecht = 1
if not (selbsttest["ellipsis_nicht_gemeldet"]
        and selbsttest["ellipsis_als_gekuerzt_gezaehlt"]):
    print("FEHLER: Die gewollte Kürzung wird als Überlauf gemeldet — "
          "die Messung ist überempfindlich.")
    schlecht = 1
sys.exit(schlecht)
