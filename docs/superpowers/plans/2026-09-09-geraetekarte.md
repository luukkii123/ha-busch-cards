# busch-device-card — Umsetzungsplan

> **Für agentische Umsetzer:** PFLICHT-TEILSKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe.
> Schritte nutzen Kästchen (`- [ ]`) zur Nachverfolgung.

**Ziel:** Eine vierte Lovelace-Karte in `dist/busch-cards.js`, die aus einer
Entität deren Gerät macht: Kopfzeile mit Gerätename, Untertitel, Label-Chips,
darunter HAs Tile-Karte mit passenden Features und die übrigen Entitäten des
Geräts, gruppiert wie auf HAs Geräteseite.

**Architektur:** Reine Funktionen (Konfiguration, Vorlagenwahl, Geräteauflösung,
Entitätenmenge, Filter, Gruppierung, Strukturstempel) sind vom DOM getrennt und
laufen unter Node. Die Kartenklasse zeichnet nur Kopfzeile, Chips und
Gruppenköpfe selbst; Bedienelement und Zeilen kommen von HA über
`window.loadCardHelpers()` (`createCardElement`, `createRowElement`). Der Editor
ist `ha-form` mit Schema und zweisprachigem Wörterbuch.

**Technik:** Vanilla JavaScript, Custom Elements, kein Build, keine Abhängigkeit.
Tests mit `node --test` und `node:vm` über `tests/laden.js`. Darstellung im
Playwright-Container mit `docs/render/regeln.py`.

**Spec:** `docs/superpowers/specs/2026-09-09-geraetekarte-design.md`

## Globale Vorgaben

- **Kein `npm`, keine `package.json`, keine Abhängigkeit.** Nur eingebaute
  Node-Bausteine. Die Datei liegt auf einer SMB-Share.
- **Kein Build.** `dist/busch-cards.js` ist Quelle und Auslieferung.
- **Jeder neue Name auf oberster Ebene beginnt mit `dev` oder `DEV_`.**
  Ausnahmen laut Spec Abschnitt 10: `SCHEMA_BUSCH_DEVICE_CARD`,
  `TEXTE_BUSCH_DEVICE_CARD`, `BuschDeviceCard`, `BuschDeviceCardEditor`,
  `waehlerGeraet`. Belegt sind unter anderem `CARD_VERSION`, `buschSprache`,
  `buschTexte`, `buschSchemaMitTexten`, `buschFuellen`, alle `cal*`, `CAL_*`,
  `MAP_*`, `SCHEDULE_*`, `clamp`, `queryDeepShadow`, `leafletLaden`.
- **Kartentag** `busch-device-card`, Editor `busch-device-card-editor`.
- **Sprache im Code:** Bezeichner und Kommentare deutsch, wie der Bestand.
  Nutzersichtbarer Text **nur** in `TEXTE_BUSCH_DEVICE_CARD` (de + en).
- **Wörterbuchform** aus `scripts/ui-regeln-pruefen.py`: `SCHEMA_<TAG>` und
  `TEXTE_<TAG>` als Objektliterale auf oberster Ebene; jedes Schemablatt hat
  `labels` und `helpers` in beiden Sprachen; Auswahltexte unter
  `texte["<feld>_<wert>"]`.
- **Kein `config.<schlüssel>` ohne Schemafeld** (Regel 3.3). Die Karte liest
  ausschließlich die elf Schlüssel aus Spec Abschnitt 8.
- **Regel 1:** jeder einzeilige Textcontainer trägt
  `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`;
  mehrzeilige `overflow-wrap:anywhere`.
- **`CARD_VERSION`** wird erst in Aufgabe 7 auf `"0.10.0"` gesetzt.
- Nach **jeder** Änderung an `dist/busch-cards.js`:
  `node --check dist/busch-cards.js` **und** `node --test tests/`.
- Sandbox-Falle (`tests/karte.test.js`, Kommentar): Listen aus der Sandbox
  tragen einen fremden `Array.prototype`; **kein `deepStrictEqual`** auf
  Arrays oder Objekte aus der Karte. Vergleichen über `JSON.stringify`,
  `length` und Index.
- Vor dem ersten Commit `git status` in `hacs/busch-cards/`; nur eigene
  Dateien mit `git add <pfad>` vorlegen.

---

### Aufgabe 1: Konfiguration, Vorlagenwahl, Geräteauflösung

**Dateien:**
- Anlegen: `tests/geraet-attrappe.js` (gemeinsame `hass`-Attrappe)
- Anlegen: `tests/geraet.test.js`
- Ändern: `dist/busch-cards.js` — neuer Abschnitt **vor** dem Block
  `customElements.define("busch-calendar-card", …)` am Dateiende

**Schnittstellen:**
- Erzeugt: `DEV_STANDARD` (Objekt mit den Vorgaben aller Optionen außer `entity`).
- Erzeugt: `DEV_VORLAGEN` (`{ light: { domains, features }, … , generic }`).
- Erzeugt: `devNormalisiereKonfig(config) → konfig` — Vorgaben gemischt,
  `labels` immer ein Array aus Zeichenketten, `entity` als Zeichenkette oder `""`.
- Erzeugt: `devDomain(entityId) → "light"`.
- Erzeugt: `devVorlageWaehlen(template, entityId) → "light" | … | "generic"`.
- Erzeugt: `devGeraetAufloesen(hass, entityId) → { fehler }` oder
  `{ eintrag, geraet, bereich, name, untertitel, platform }`; `fehler` ist
  einer der Wörterbuchschlüssel `keineEntitaet`, `altesHa`, `nichtRegistriert`,
  `keinGeraet`.
- Erzeugt: `devUntertitel(geraet, bereich) → "Shelly · Plus 1PM · Wohnzimmer"`.

- [ ] **Schritt 1: Die Attrappe schreiben**

`tests/geraet-attrappe.js`:

```js
"use strict";

/**
 * Eine `hass`-Attrappe mit den Registerformen aus Spec Abschnitt 2 — belegt
 * am Frontend-Quelltext (`EntityRegistryDisplayEntry`, `DeviceRegistryEntry`,
 * `LabelRegistryEntry`). Ein Shelly mit acht Entitaeten, ein zweites Geraet,
 * eine Entitaet ohne Geraet.
 */
function eintrag(entity_id, extra) {
  return { entity_id, device_id: "d1", area_id: null, labels: [], platform: "shelly", ...extra };
}

function zustand(name, state, extra) {
  return { state, attributes: { friendly_name: name, ...(extra || {}) } };
}

function baueHass() {
  return {
    locale: { language: "de-DE" },
    states: {
      "light.decke": zustand("Wohnzimmer Deckenlampe", "on", { brightness: 180 }),
      "sensor.decke_leistung": zustand("Wohnzimmer Deckenlampe Leistung", "12.4"),
      "sensor.decke_energie": zustand("Wohnzimmer Deckenlampe Energie", "3.21"),
      "sensor.decke_rssi": zustand("Wohnzimmer Deckenlampe RSSI", "-61"),
      "update.decke_firmware": zustand("Wohnzimmer Deckenlampe Firmware", "off"),
      "switch.decke_kindersicherung": zustand("Wohnzimmer Deckenlampe Kindersicherung", "off"),
      "binary_sensor.decke_ueberhitzt": zustand("Wohnzimmer Deckenlampe Überhitzt", "off"),
      "event.decke_taster": zustand("Wohnzimmer Deckenlampe Taster", "2026-09-09T10:00:00+00:00"),
      "sensor.decke_versteckt": zustand("Versteckt", "1"),
      "sensor.anderes": zustand("Anderes", "5"),
      "sensor.ohne_geraet": zustand("Ohne Gerät", "7"),
    },
    entities: {
      "light.decke": eintrag("light.decke", { labels: ["l_wichtig"] }),
      "sensor.decke_leistung": eintrag("sensor.decke_leistung", { labels: ["l_energie"] }),
      "sensor.decke_energie": eintrag("sensor.decke_energie", { labels: ["l_energie", "l_wichtig"] }),
      "sensor.decke_rssi": eintrag("sensor.decke_rssi", { entity_category: "diagnostic" }),
      "update.decke_firmware": eintrag("update.decke_firmware", { entity_category: "config" }),
      "switch.decke_kindersicherung": eintrag("switch.decke_kindersicherung", { entity_category: "config" }),
      "binary_sensor.decke_ueberhitzt": eintrag("binary_sensor.decke_ueberhitzt"),
      "event.decke_taster": eintrag("event.decke_taster"),
      "sensor.decke_versteckt": eintrag("sensor.decke_versteckt", { hidden: true }),
      "sensor.anderes": eintrag("sensor.anderes", { device_id: "d2", platform: "mqtt" }),
      "sensor.ohne_geraet": eintrag("sensor.ohne_geraet", { device_id: undefined }),
    },
    devices: {
      d1: {
        id: "d1", name: "shellyplus1pm-abc123", name_by_user: "Wohnzimmer Deckenlampe",
        manufacturer: "Shelly", model: "Plus 1PM", area_id: "wohnzimmer", labels: [],
      },
      d2: {
        id: "d2", name: "Aqara Sensor", name_by_user: null,
        manufacturer: null, model: null, area_id: null, labels: [],
      },
    },
    areas: { wohnzimmer: { area_id: "wohnzimmer", name: "Wohnzimmer", icon: "mdi:sofa" } },
    aufrufe: [],
    async callWS(nachricht) {
      this.aufrufe.push(nachricht.type);
      if (nachricht.type === "config/label_registry/list") {
        return [
          { label_id: "l_wichtig", name: "Wichtig", icon: "mdi:star", color: "red", description: null },
          { label_id: "l_energie", name: "Energie", icon: null, color: "green", description: null },
        ];
      }
      return [];
    },
    dienste: [],
    async callService(domain, service, daten) {
      this.dienste.push(`${domain}.${service} ${JSON.stringify(daten)}`);
    },
  };
}

module.exports = { baueHass };
```

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

`tests/geraet.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");
const { baueHass } = require("./geraet-attrappe.js");

const {
  DEV_STANDARD,
  DEV_VORLAGEN,
  devNormalisiereKonfig,
  devDomain,
  devVorlageWaehlen,
  devGeraetAufloesen,
  devUntertitel,
} = ladeKarte([
  "DEV_STANDARD",
  "DEV_VORLAGEN",
  "devNormalisiereKonfig",
  "devDomain",
  "devVorlageWaehlen",
  "devGeraetAufloesen",
  "devUntertitel",
]);

/* ── Konfiguration ─────────────────────────────────────────────────────── */

test("die Vorgaben stimmen mit Spec Abschnitt 8 ueberein", () => {
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  assert.strictEqual(k.entity, "light.decke");
  assert.strictEqual(k.title, "");
  assert.strictEqual(k.template, "auto");
  assert.strictEqual(k.labels.length, 0);
  assert.strictEqual(k.show_subtitle, true);
  assert.strictEqual(k.show_config, true);
  assert.strictEqual(k.show_diagnostic, true);
  assert.strictEqual(k.start_expanded, false);
  assert.strictEqual(k.tap_action, "expand");
  assert.strictEqual(k.hold_action, "more-info");
  assert.strictEqual(k.navigation_path, "");
});

test("gesetzte Werte bleiben, labels wird immer eine Liste", () => {
  const k = devNormalisiereKonfig({
    entity: "light.decke", template: "switch", labels: "l_energie",
    tap_action: "toggle", start_expanded: true,
  });
  assert.strictEqual(k.template, "switch");
  assert.strictEqual(JSON.stringify(k.labels), '["l_energie"]');
  assert.strictEqual(k.tap_action, "toggle");
  assert.strictEqual(k.start_expanded, true);
});

test("ohne Konfiguration: leere Entitaet, kein Absturz", () => {
  const k = devNormalisiereKonfig(undefined);
  assert.strictEqual(k.entity, "");
  assert.strictEqual(Array.isArray(k.labels), true);
});

test("ein unbekannter Aktionswert faellt auf die Vorgabe zurueck", () => {
  const k = devNormalisiereKonfig({ entity: "x.y", tap_action: "fliegen", hold_action: 7 });
  assert.strictEqual(k.tap_action, DEV_STANDARD.tap_action);
  assert.strictEqual(k.hold_action, DEV_STANDARD.hold_action);
});

/* ── Vorlagen ──────────────────────────────────────────────────────────── */

test("die Vorlagentabelle aus Spec Abschnitt 4 steht vollstaendig", () => {
  const namen = Object.keys(DEV_VORLAGEN).sort().join(",");
  assert.strictEqual(namen, "climate,cover,fan,generic,light,lock,media,switch");
  assert.strictEqual(DEV_VORLAGEN.light.features[0].type, "light-brightness");
  assert.strictEqual(DEV_VORLAGEN.climate.features.map((f) => f.type).join(","),
    "target-temperature,climate-hvac-modes");
  assert.strictEqual(DEV_VORLAGEN.cover.features.map((f) => f.type).join(","),
    "cover-open-close,cover-position");
  assert.strictEqual(DEV_VORLAGEN.fan.features[0].type, "fan-speed");
  assert.strictEqual(DEV_VORLAGEN.media.features[0].type, "media-player-volume-slider");
  assert.strictEqual(DEV_VORLAGEN.lock.features[0].type, "lock-commands");
  assert.strictEqual(DEV_VORLAGEN.switch.features[0].type, "toggle");
  assert.strictEqual(DEV_VORLAGEN.generic.features.length, 0);
});

test("auto waehlt nach der Domain der Entitaet", () => {
  assert.strictEqual(devDomain("light.decke"), "light");
  assert.strictEqual(devVorlageWaehlen("auto", "light.decke"), "light");
  assert.strictEqual(devVorlageWaehlen("auto", "climate.wohnen"), "climate");
  assert.strictEqual(devVorlageWaehlen("auto", "cover.rollo"), "cover");
  assert.strictEqual(devVorlageWaehlen("auto", "fan.luefter"), "fan");
  assert.strictEqual(devVorlageWaehlen("auto", "media_player.tv"), "media");
  assert.strictEqual(devVorlageWaehlen("auto", "lock.tuer"), "lock");
  assert.strictEqual(devVorlageWaehlen("auto", "switch.steckdose"), "switch");
  assert.strictEqual(devVorlageWaehlen("auto", "input_boolean.gast"), "switch");
  assert.strictEqual(devVorlageWaehlen("auto", "sensor.temp"), "generic");
  assert.strictEqual(devVorlageWaehlen("auto", ""), "generic");
});

test("ein gesetzter Wert erzwingt die Vorlage, ein unbekannter faellt auf generic", () => {
  assert.strictEqual(devVorlageWaehlen("switch", "light.decke"), "switch");
  assert.strictEqual(devVorlageWaehlen("light", "sensor.temp"), "light");
  assert.strictEqual(devVorlageWaehlen("regenbogen", "light.decke"), "generic");
});

/* ── Geraeteaufloesung ─────────────────────────────────────────────────── */

test("Entitaet -> Geraet -> Bereich, name_by_user schlaegt name", () => {
  const a = devGeraetAufloesen(baueHass(), "light.decke");
  assert.strictEqual(a.fehler, undefined);
  assert.strictEqual(a.geraet.id, "d1");
  assert.strictEqual(a.name, "Wohnzimmer Deckenlampe");
  assert.strictEqual(a.bereich.name, "Wohnzimmer");
  assert.strictEqual(a.platform, "shelly");
  assert.strictEqual(a.untertitel, "Shelly · Plus 1PM · Wohnzimmer");
});

test("ohne name_by_user der Registername; leere Teile fallen samt Punkt weg", () => {
  const a = devGeraetAufloesen(baueHass(), "sensor.anderes");
  assert.strictEqual(a.name, "Aqara Sensor");
  assert.strictEqual(a.untertitel, "");
  assert.strictEqual(devUntertitel({ manufacturer: "Aqara", model: null }, null), "Aqara");
  assert.strictEqual(devUntertitel({ manufacturer: null, model: "T1" }, { name: "Bad" }), "T1 · Bad");
});

test("die vier Fehlerfaelle aus Spec Abschnitt 9", () => {
  const hass = baueHass();
  assert.strictEqual(devGeraetAufloesen(hass, "").fehler, "keineEntitaet");
  assert.strictEqual(devGeraetAufloesen({ states: {} }, "light.decke").fehler, "altesHa");
  assert.strictEqual(devGeraetAufloesen(hass, "light.gibtsnicht").fehler, "nichtRegistriert");
  assert.strictEqual(devGeraetAufloesen(hass, "sensor.ohne_geraet").fehler, "keinGeraet");
});

test("ein device_id ohne Geraet im Register zaehlt als keinGeraet", () => {
  const hass = baueHass();
  hass.entities["light.decke"].device_id = "d_weg";
  assert.strictEqual(devGeraetAufloesen(hass, "light.decke").fehler, "keinGeraet");
});
```

- [ ] **Schritt 3: Test laufen lassen, muss fehlschlagen**

Run: `cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards" && node --test tests/geraet.test.js`
Erwartet: FAIL — `DEV_STANDARD is not defined` (ReferenceError aus dem Sammler).

- [ ] **Schritt 4: Umsetzen**

In `dist/busch-cards.js`, **direkt vor** der Zeile
`customElements.define("busch-calendar-card", BuschCalendarCard);` einfügen:

```js
/* ────────────────────────────────────────────────────────────────────────────
 * busch-device-card — eine Entität, ihr ganzes Gerät
 *
 * Spec: docs/superpowers/specs/2026-09-09-geraetekarte-design.md
 *
 * Alles, was die Karte über Geräte weiß, steht schon im `hass`-Objekt:
 * `hass.entities` (Registereinträge mit `device_id`, `labels`, `hidden`,
 * `entity_category`, `platform`), `hass.devices`, `hass.areas`. Belegt am
 * Frontend-Quelltext (`src/data/entity/entity_registry.ts`,
 * `src/data/device/device_registry.ts`) am 09.09.2026. Nur die Label-NAMEN
 * kommen per WebSocket (`config/label_registry/list`).
 *
 * Bedienelement und Entitätenzeilen zeichnet HA selbst — über
 * `window.loadCardHelpers()`: `createCardElement({type:"tile", …})` und
 * `createRowElement({entity})`. Diese Datei zeichnet nur Kopfzeile, Chips und
 * Gruppenköpfe. Namensraum: `dev` / `DEV_`.
 * ──────────────────────────────────────────────────────────────────────── */

const DEV_STANDARD = {
  title: "",
  template: "auto",
  labels: [],
  show_subtitle: true,
  show_config: true,
  show_diagnostic: true,
  start_expanded: false,
  tap_action: "expand",
  hold_action: "more-info",
  navigation_path: "",
};

/** Die Kopfzeilen-Aktionen aus Spec Abschnitt 6. */
const DEV_AKTIONEN = ["expand", "more-info", "toggle", "device-page", "navigate", "none"];

/**
 * Vorlage → Features der Tile-Karte (Spec Abschnitt 4). Die Typnamen stehen
 * in `src/panels/lovelace/card-features/types.ts`. Ein Feature, das die
 * Domain nicht unterstützt oder das die HA-Version nicht kennt, rendert HA
 * leer — die Karte prüft das nicht selbst.
 */
const DEV_VORLAGEN = {
  light: { domains: ["light"], features: [{ type: "light-brightness" }] },
  climate: {
    domains: ["climate"],
    features: [{ type: "target-temperature" }, { type: "climate-hvac-modes" }],
  },
  cover: {
    domains: ["cover"],
    features: [{ type: "cover-open-close" }, { type: "cover-position" }],
  },
  fan: { domains: ["fan"], features: [{ type: "fan-speed" }] },
  media: { domains: ["media_player"], features: [{ type: "media-player-volume-slider" }] },
  lock: { domains: ["lock"], features: [{ type: "lock-commands" }] },
  switch: { domains: ["switch", "input_boolean"], features: [{ type: "toggle" }] },
  generic: { domains: [], features: [] },
};

function devNormalisiereKonfig(config) {
  const roh = config || {};
  const k = { ...DEV_STANDARD, ...roh };
  k.entity = typeof roh.entity === "string" ? roh.entity : "";
  if (typeof roh.labels === "string") k.labels = [roh.labels];
  else if (Array.isArray(roh.labels)) k.labels = roh.labels.filter((l) => typeof l === "string");
  else k.labels = [];
  if (!DEV_AKTIONEN.includes(k.tap_action)) k.tap_action = DEV_STANDARD.tap_action;
  if (!DEV_AKTIONEN.includes(k.hold_action)) k.hold_action = DEV_STANDARD.hold_action;
  if (typeof k.navigation_path !== "string") k.navigation_path = "";
  if (typeof k.title !== "string") k.title = "";
  return k;
}

function devDomain(entityId) {
  const s = String(entityId || "");
  const p = s.indexOf(".");
  return p > 0 ? s.slice(0, p) : "";
}

function devVorlageWaehlen(template, entityId) {
  if (template && template !== "auto") {
    return DEV_VORLAGEN[template] ? template : "generic";
  }
  const domain = devDomain(entityId);
  for (const name of Object.keys(DEV_VORLAGEN)) {
    if (DEV_VORLAGEN[name].domains.includes(domain)) return name;
  }
  return "generic";
}

/** „Hersteller · Modell · Bereich" — leere Teile fallen samt Punkt weg. */
function devUntertitel(geraet, bereich) {
  const teile = [];
  if (geraet && geraet.manufacturer) teile.push(String(geraet.manufacturer));
  if (geraet && geraet.model) teile.push(String(geraet.model));
  if (bereich && bereich.name) teile.push(String(bereich.name));
  return teile.join(" · ");
}

/**
 * Entität → Gerät → Bereich. Liefert `{ fehler }` mit einem Wörterbuch-
 * schlüssel aus `texte`, oder die Auflösung.
 */
function devGeraetAufloesen(hass, entityId) {
  if (!entityId) return { fehler: "keineEntitaet" };
  if (!hass || !hass.entities || !hass.devices) return { fehler: "altesHa" };
  const eintrag = hass.entities[entityId];
  if (!eintrag) return { fehler: "nichtRegistriert" };
  if (!eintrag.device_id) return { fehler: "keinGeraet" };
  const geraet = hass.devices[eintrag.device_id];
  if (!geraet) return { fehler: "keinGeraet" };
  const bereich = (geraet.area_id && hass.areas && hass.areas[geraet.area_id]) || null;
  const name = geraet.name_by_user || geraet.name || entityId;
  return {
    eintrag,
    geraet,
    bereich,
    name,
    untertitel: devUntertitel(geraet, bereich),
    platform: eintrag.platform || "",
  };
}
```

- [ ] **Schritt 5: Prüfen, muss grün sein**

Run: `node --check dist/busch-cards.js && node --test tests/`
Erwartet: alle Tests bestanden, auch `namensraum.test.js`.

- [ ] **Schritt 6: Commit**

```bash
git add tests/geraet-attrappe.js tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Konfiguration, Vorlagenwahl, Geräteauflösung"
```

---

### Aufgabe 2: Entitätenmenge, Label-Filter, Gruppierung, Strukturstempel

**Dateien:**
- Ändern: `tests/geraet.test.js` (anhängen)
- Ändern: `dist/busch-cards.js` (im `dev`-Abschnitt hinter `devGeraetAufloesen`)

**Schnittstellen:**
- Erzeugt: `DEV_SENSOR_DOMAINS` (Liste), `DEV_GRUPPEN` (`["control","sensor","config","diagnostic"]`).
- Erzeugt: `devEntitaetenDesGeraets(hass, deviceId, hauptId) → [eintrag]` —
  ohne `hidden`, ohne die Hauptentität.
- Erzeugt: `devLabelFilter(eintraege, labels) → [eintrag]` — Oder-Verknüpfung; leer = alle.
- Erzeugt: `devGruppe(eintrag) → "control"|"sensor"|"config"|"diagnostic"`.
- Erzeugt: `devAnzeigename(hass, eintrag) → string`.
- Erzeugt: `devKurzname(anzeigename, geraeteName) → string` — streicht das
  Gerätenamen-Präfix („Wohnzimmer Deckenlampe Leistung" → „Leistung").
- Erzeugt: `devGruppieren(hass, eintraege, konfig) → [{ gruppe, ids }]` — in
  fester Reihenfolge, leere weg, `config`/`diagnostic` nur wenn erlaubt,
  innerhalb sortiert nach Anzeigename.
- Erzeugt: `devStrukturStempel(deviceId, vorlage, gruppen, konfig) → string`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An `tests/geraet.test.js` anhängen (und die neuen Namen oben im `ladeKarte`-
Aufruf ergänzen: `DEV_SENSOR_DOMAINS`, `devEntitaetenDesGeraets`,
`devLabelFilter`, `devGruppe`, `devAnzeigename`, `devKurzname`,
`devGruppieren`, `devStrukturStempel`):

```js
/* ── Entitaetenmenge ───────────────────────────────────────────────────── */

test("alle Entitaeten desselben Geraets, ohne hidden, ohne Hauptentitaet", () => {
  const ids = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke").map((e) => e.entity_id).sort();
  assert.strictEqual(ids.join(","),
    "binary_sensor.decke_ueberhitzt,event.decke_taster,sensor.decke_energie," +
    "sensor.decke_leistung,sensor.decke_rssi,switch.decke_kindersicherung,update.decke_firmware");
});

test("Label-Filter: Oder-Verknuepfung, leer heisst alle", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  assert.strictEqual(devLabelFilter(alle, []).length, alle.length);
  const energie = devLabelFilter(alle, ["l_energie"]).map((e) => e.entity_id).sort().join(",");
  assert.strictEqual(energie, "sensor.decke_energie,sensor.decke_leistung");
  const beide = devLabelFilter(alle, ["l_energie", "l_wichtig"]).map((e) => e.entity_id).sort().join(",");
  assert.strictEqual(beide, "sensor.decke_energie,sensor.decke_leistung");
  assert.strictEqual(devLabelFilter(alle, ["l_gibtsnicht"]).length, 0);
});

/* ── Gruppierung ───────────────────────────────────────────────────────── */

test("die Sensorliste ist HAs SENSOR_ENTITIES plus event", () => {
  assert.strictEqual(DEV_SENSOR_DOMAINS.slice().sort().join(","),
    "binary_sensor,calendar,camera,device_tracker,event,image,sensor,weather");
});

test("entity_category gewinnt, sonst entscheidet die Domain", () => {
  const h = baueHass();
  assert.strictEqual(devGruppe(h.entities["sensor.decke_rssi"]), "diagnostic");
  assert.strictEqual(devGruppe(h.entities["update.decke_firmware"]), "config");
  assert.strictEqual(devGruppe(h.entities["switch.decke_kindersicherung"]), "config");
  assert.strictEqual(devGruppe(h.entities["sensor.decke_leistung"]), "sensor");
  assert.strictEqual(devGruppe(h.entities["event.decke_taster"]), "sensor");
  assert.strictEqual(devGruppe(h.entities["binary_sensor.decke_ueberhitzt"]), "sensor");
  assert.strictEqual(devGruppe({ entity_id: "switch.x" }), "control");
  assert.strictEqual(devGruppe({ entity_id: "notify.x" }), "control");
});

test("Anzeigename: Registername, sonst friendly_name, sonst die ID; Kurzname ohne Geraetepraefix", () => {
  const h = baueHass();
  assert.strictEqual(devAnzeigename(h, h.entities["sensor.decke_leistung"]), "Wohnzimmer Deckenlampe Leistung");
  h.entities["sensor.decke_leistung"].name = "Verbrauch";
  assert.strictEqual(devAnzeigename(h, h.entities["sensor.decke_leistung"]), "Verbrauch");
  assert.strictEqual(devAnzeigename(h, { entity_id: "sensor.fremd" }), "sensor.fremd");
  assert.strictEqual(devKurzname("Wohnzimmer Deckenlampe Leistung", "Wohnzimmer Deckenlampe"), "Leistung");
  assert.strictEqual(devKurzname("Wohnzimmer Deckenlampe", "Wohnzimmer Deckenlampe"), "Wohnzimmer Deckenlampe");
  assert.strictEqual(devKurzname("Leistung", "Wohnzimmer Deckenlampe"), "Leistung");
});

test("vier Gruppen in fester Reihenfolge, leere fehlen, innen nach Name sortiert", () => {
  const h = baueHass();
  const konfig = devNormalisiereKonfig({ entity: "light.decke" });
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const gruppen = devGruppieren(h, alle, konfig);
  assert.strictEqual(gruppen.map((g) => g.gruppe).join(","), "sensor,config,diagnostic");
  assert.strictEqual(gruppen[0].ids.join(","),
    "sensor.decke_energie,sensor.decke_leistung,event.decke_taster,binary_sensor.decke_ueberhitzt");
  assert.strictEqual(gruppen[1].ids.join(","), "update.decke_firmware,switch.decke_kindersicherung");
  assert.strictEqual(gruppen[2].ids.join(","), "sensor.decke_rssi");
});

test("show_config / show_diagnostic blenden ihre Gruppe ganz aus", () => {
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const k = devNormalisiereKonfig({ entity: "light.decke", show_config: false, show_diagnostic: false });
  assert.strictEqual(devGruppieren(h, alle, k).map((g) => g.gruppe).join(","), "sensor");
});

/* ── Strukturstempel (Spec Abschnitt 7) ────────────────────────────────── */

test("gleiche Struktur ergibt denselben Stempel, ein Zustandswechsel aendert nichts", () => {
  const h = baueHass();
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  const g1 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  h.states["light.decke"].state = "off";
  const g2 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.strictEqual(devStrukturStempel("d1", "light", g1, k), devStrukturStempel("d1", "light", g2, k));
});

test("eine neue Entitaet, eine andere Vorlage oder Konfiguration aendern den Stempel", () => {
  const h = baueHass();
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  const g1 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  const s1 = devStrukturStempel("d1", "light", g1, k);
  h.entities["sensor.decke_neu"] = { entity_id: "sensor.decke_neu", device_id: "d1", labels: [] };
  const g2 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.notStrictEqual(devStrukturStempel("d1", "light", g2, k), s1);
  assert.notStrictEqual(devStrukturStempel("d1", "switch", g1, k), s1);
  const k2 = devNormalisiereKonfig({ entity: "light.decke", show_subtitle: false });
  assert.notStrictEqual(devStrukturStempel("d1", "light", g1, k2), s1);
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet.test.js`
Erwartet: FAIL — `DEV_SENSOR_DOMAINS is not defined`.

- [ ] **Schritt 3: Umsetzen**

Hinter `devGeraetAufloesen` einfügen:

```js
/**
 * HAs `SENSOR_ENTITIES` aus `src/common/const.ts` plus `event`. HA führt
 * `event`, `notify` und Assist als eigene Gruppen; diese Karte faltet `event`
 * in Sensoren und den Rest in Steuerung (Spec Abschnitt 5).
 */
const DEV_SENSOR_DOMAINS = [
  "sensor", "binary_sensor", "calendar", "camera", "device_tracker", "image", "weather", "event",
];

/** Reihenfolge der Gruppen in der Karte. */
const DEV_GRUPPEN = ["control", "sensor", "config", "diagnostic"];

function devEntitaetenDesGeraets(hass, deviceId, hauptId) {
  const aus = [];
  const register = (hass && hass.entities) || {};
  for (const id of Object.keys(register)) {
    const e = register[id];
    if (!e || e.device_id !== deviceId || e.hidden || id === hauptId) continue;
    aus.push(e);
  }
  return aus;
}

function devLabelFilter(eintraege, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return eintraege.slice();
  return eintraege.filter((e) => Array.isArray(e.labels) && e.labels.some((l) => labels.includes(l)));
}

function devGruppe(eintrag) {
  if (eintrag.entity_category === "config") return "config";
  if (eintrag.entity_category === "diagnostic") return "diagnostic";
  return DEV_SENSOR_DOMAINS.includes(devDomain(eintrag.entity_id)) ? "sensor" : "control";
}

function devAnzeigename(hass, eintrag) {
  if (eintrag.name) return String(eintrag.name);
  const zustand = hass && hass.states && hass.states[eintrag.entity_id];
  const fn = zustand && zustand.attributes && zustand.attributes.friendly_name;
  return fn ? String(fn) : eintrag.entity_id;
}

/** „Wohnzimmer Deckenlampe Leistung" → „Leistung"; der Gerätename allein bleibt. */
function devKurzname(anzeigename, geraeteName) {
  const n = String(anzeigename || "");
  const g = String(geraeteName || "");
  if (g && n.length > g.length + 1 && n.startsWith(g + " ")) return n.slice(g.length + 1);
  return n;
}

function devGruppieren(hass, eintraege, konfig) {
  const koerbe = { control: [], sensor: [], config: [], diagnostic: [] };
  for (const e of eintraege) koerbe[devGruppe(e)].push(e);
  const aus = [];
  for (const gruppe of DEV_GRUPPEN) {
    if (gruppe === "config" && !konfig.show_config) continue;
    if (gruppe === "diagnostic" && !konfig.show_diagnostic) continue;
    const liste = koerbe[gruppe];
    if (!liste.length) continue;
    liste.sort((a, b) =>
      devAnzeigename(hass, a).localeCompare(devAnzeigename(hass, b), undefined, { sensitivity: "base" })
    );
    aus.push({ gruppe, ids: liste.map((e) => e.entity_id) });
  }
  return aus;
}

/**
 * Spec Abschnitt 7: Nur wenn sich dieser Stempel ändert, wird das DOM neu
 * gebaut. Ein Zustandswechsel ändert ihn nicht — der wird nur durchgereicht.
 */
function devStrukturStempel(deviceId, vorlage, gruppen, konfig) {
  const felder = Object.keys(DEV_STANDARD).concat(["entity"]).sort()
    .map((k) => `${k}=${JSON.stringify(konfig[k])}`);
  const g = gruppen.map((x) => `${x.gruppe}:${x.ids.join(",")}`);
  return [deviceId, vorlage, g.join("|"), felder.join("&")].join("#");
}
```

- [ ] **Schritt 4: Prüfen, muss grün sein**

Run: `node --check dist/busch-cards.js && node --test tests/`

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Entitätenmenge, Label-Filter, Gruppierung, Strukturstempel"
```

---

### Aufgabe 3: Wörterbuch, Schema, Label- und Helferladen

**Dateien:**
- Anlegen: `tests/geraet-editor.test.js`
- Ändern: `dist/busch-cards.js` (im `dev`-Abschnitt)

**Schnittstellen:**
- Erzeugt: `SCHEMA_BUSCH_DEVICE_CARD`, `TEXTE_BUSCH_DEVICE_CARD` (Form aus
  `scripts/ui-regeln-pruefen.py`).
- Erzeugt: `devLabelsLaden(hass) → Promise<Map<label_id, eintrag>>`; einmal je
  Seite über den Modulzwischenspeicher `devLabelCache`; bei Fehler leere Map.
- Erzeugt: `devHelferLaden() → Promise<helfer|null>`; Zwischenspeicher `devHelferCache`.
- Erzeugt: `devLabelFarbe(eintrag) → "var(--red-color)" | "#rrggbb" | ""`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/geraet-editor.test.js`:

```js
"use strict";

/**
 * Schema und Woerterbuch sind Daten — unter Node pruefbar. NICHT belegt wird
 * hier, dass HAs echtes `ha-form` die Selektoren zeichnet (Playwright,
 * Aufgabe 6, und echtes HA, Spec Abschnitt 12 Schritt 4).
 */
const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");
const { baueHass } = require("./geraet-attrappe.js");

const {
  SCHEMA_BUSCH_DEVICE_CARD,
  TEXTE_BUSCH_DEVICE_CARD,
  DEV_STANDARD,
  DEV_VORLAGEN,
  DEV_AKTIONEN,
  devLabelsLaden,
  devLabelFarbe,
} = ladeKarte([
  "SCHEMA_BUSCH_DEVICE_CARD",
  "TEXTE_BUSCH_DEVICE_CARD",
  "DEV_STANDARD",
  "DEV_VORLAGEN",
  "DEV_AKTIONEN",
  "devLabelsLaden",
  "devLabelFarbe",
]);

/** Spec Abschnitt 8, woertlich. */
const OPTIONEN_DER_SPEC = [
  "entity", "title", "template", "labels", "show_subtitle", "show_config",
  "show_diagnostic", "start_expanded", "tap_action", "hold_action", "navigation_path",
];

function schemaBlaetter(schema) {
  const aus = [];
  for (const e of schema) {
    if (Array.isArray(e.schema)) aus.push(...schemaBlaetter(e.schema));
    else if (e.name) aus.push(e);
  }
  return aus;
}

test("jede Option der Spec steht im Schema, und nichts darueber hinaus", () => {
  const namen = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).map((b) => b.name).sort().join(",");
  assert.strictEqual(namen, OPTIONEN_DER_SPEC.slice().sort().join(","));
});

test("jedes Standardfeld hat ein Schemablatt", () => {
  const namen = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).map((b) => b.name);
  for (const k of Object.keys(DEV_STANDARD)) assert.ok(namen.includes(k), k);
});

test("entity ist Pflicht, labels ein Label-Selektor mit Mehrfachauswahl", () => {
  const blaetter = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD);
  const entity = blaetter.find((b) => b.name === "entity");
  assert.strictEqual(entity.required, true);
  assert.ok(entity.selector.entity, "entity-Selektor");
  const labels = blaetter.find((b) => b.name === "labels");
  assert.strictEqual(labels.selector.label.multiple, true);
});

test("die Auswahlfelder bieten genau die Werte der Spec", () => {
  const blaetter = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD);
  const werte = (name) => blaetter.find((b) => b.name === name).selector.select.options.map((o) => o.value);
  assert.strictEqual(werte("template").join(","), ["auto"].concat(Object.keys(DEV_VORLAGEN)).join(","));
  assert.strictEqual(werte("tap_action").join(","), DEV_AKTIONEN.join(","));
  assert.strictEqual(werte("hold_action").join(","), DEV_AKTIONEN.join(","));
});

for (const sprache of ["de", "en"]) {
  test(`${sprache}: jedes Schemablatt hat Label und Helper, jeder Helper nennt die Vorgabe`, () => {
    const t = TEXTE_BUSCH_DEVICE_CARD[sprache];
    assert.ok(t.name && t.description, "name/description");
    for (const b of schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD)) {
      assert.ok(t.labels[b.name], `${sprache}.labels.${b.name}`);
      assert.ok(t.helpers[b.name], `${sprache}.helpers.${b.name}`);
      assert.ok(/\.$/.test(t.helpers[b.name]), `Helper ${b.name} endet mit Punkt`);
      if (b.name !== "entity") {
        assert.ok(/Vorgabe|Default/.test(t.helpers[b.name]), `Helper ${b.name} nennt die Vorgabe`);
      }
    }
  });

  test(`${sprache}: jeder Auswahlwert hat einen Text, jede Gruppe und jeder Fehler auch`, () => {
    const t = TEXTE_BUSCH_DEVICE_CARD[sprache].texte;
    for (const v of ["auto"].concat(Object.keys(DEV_VORLAGEN))) assert.ok(t[`template_${v}`], `template_${v}`);
    for (const a of DEV_AKTIONEN) {
      assert.ok(t[`tap_action_${a}`], `tap_action_${a}`);
      assert.ok(t[`hold_action_${a}`], `hold_action_${a}`);
    }
    for (const g of ["control", "sensor", "config", "diagnostic"]) assert.ok(t[`gruppe_${g}`], `gruppe_${g}`);
    for (const f of ["keineEntitaet", "altesHa", "nichtRegistriert", "keinGeraet", "helferFehlt", "laden", "keineTreffer"]) {
      assert.ok(t[f], f);
    }
  });
}

test("Labels werden einmal geladen und als Map geliefert; ein zweiter Aufruf fragt nicht erneut", async () => {
  const hass = baueHass();
  const a = await devLabelsLaden(hass);
  assert.strictEqual(a.get("l_wichtig").name, "Wichtig");
  await devLabelsLaden(hass);
  assert.strictEqual(hass.aufrufe.filter((t) => t === "config/label_registry/list").length, 1);
});

test("Label-Farbe: HA-Farbname wird zur CSS-Variablen, Hex bleibt, nichts wird leer", () => {
  assert.strictEqual(devLabelFarbe({ color: "red" }), "var(--red-color)");
  assert.strictEqual(devLabelFarbe({ color: "#123456" }), "#123456");
  assert.strictEqual(devLabelFarbe({ color: null }), "");
  assert.strictEqual(devLabelFarbe(undefined), "");
});
```

Der Test zum **Fehlerfall** des Label-Ladens braucht eine frische Sandbox, weil
der Zwischenspeicher im Modul liegt. Zusätzlich anhängen:

```js
test("scheitert der WebSocket-Aufruf, kommt eine leere Map und kein Wurf", async () => {
  const { devLabelsLaden: frisch } = ladeKarte(["devLabelsLaden"]);
  const hass = { async callWS() { throw new Error("offline"); } };
  const m = await frisch(hass);
  assert.strictEqual(m.size, 0);
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet-editor.test.js`
Erwartet: FAIL — `SCHEMA_BUSCH_DEVICE_CARD is not defined`.

- [ ] **Schritt 3: Umsetzen**

Hinter `devStrukturStempel` einfügen:

```js
const SCHEMA_BUSCH_DEVICE_CARD = [
  { name: "entity", required: true, selector: { entity: {} } },
  { name: "title", selector: { text: {} } },
  {
    name: "template",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto" }, { value: "light" }, { value: "climate" }, { value: "cover" },
          { value: "fan" }, { value: "media" }, { value: "lock" }, { value: "switch" },
          { value: "generic" },
        ],
      },
    },
  },
  { name: "labels", selector: { label: { multiple: true } } },
  {
    type: "grid",
    schema: [
      { name: "show_subtitle", selector: { boolean: {} } },
      { name: "start_expanded", selector: { boolean: {} } },
      { name: "show_config", selector: { boolean: {} } },
      { name: "show_diagnostic", selector: { boolean: {} } },
    ],
  },
  {
    type: "grid",
    schema: [
      {
        name: "tap_action",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "expand" }, { value: "more-info" }, { value: "toggle" },
              { value: "device-page" }, { value: "navigate" }, { value: "none" },
            ],
          },
        },
      },
      {
        name: "hold_action",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "expand" }, { value: "more-info" }, { value: "toggle" },
              { value: "device-page" }, { value: "navigate" }, { value: "none" },
            ],
          },
        },
      },
    ],
  },
  { name: "navigation_path", selector: { text: {} } },
];

const TEXTE_BUSCH_DEVICE_CARD = {
  de: {
    name: "Busch Gerät",
    description: "Zeigt zu einer Entität ihr ganzes Gerät: Kopfzeile, Bedienelement und alle Entitäten, gruppiert wie auf der Geräteseite.",
    labels: {
      entity: "Entität",
      title: "Überschrift",
      template: "Darstellung",
      labels: "Nur Entitäten mit Label",
      show_subtitle: "Untertitel zeigen",
      start_expanded: "Offen starten",
      show_config: "Konfiguration zeigen",
      show_diagnostic: "Diagnose zeigen",
      tap_action: "Tippen auf die Kopfzeile",
      hold_action: "Halten auf der Kopfzeile",
      navigation_path: "Navigationsziel",
    },
    helpers: {
      entity: "Irgendeine Entität des Geräts. Die Karte sucht daraus das Gerät und zeigt diese Entität oben als Bedienelement.",
      title: "Überschrift der Karte. Leer nimmt den Gerätenamen. Vorgabe: leer.",
      template: "Welche Bedienelemente oben stehen. Automatisch richtet sich nach der Art der Entität. Vorgabe: automatisch.",
      labels: "Zeigt unten nur Entitäten, die eines dieser Labels tragen. Die Entität oben bleibt immer. Vorgabe: alle.",
      show_subtitle: "Hersteller, Modell und Bereich unter dem Namen. Vorgabe an.",
      start_expanded: "An zeigt die Entitätenliste sofort, aus erst nach dem Aufklappen. Vorgabe aus.",
      show_config: "Die Gruppe Konfiguration überhaupt anbieten. Vorgabe an.",
      show_diagnostic: "Die Gruppe Diagnose überhaupt anbieten. Vorgabe an.",
      tap_action: "Was ein Tippen auf Name und Untertitel tut. Vorgabe: aufklappen.",
      hold_action: "Was ein Halten auf Name und Untertitel tut. Vorgabe: Details öffnen.",
      navigation_path: "Pfad im Dashboard, etwa /lovelace/geraete. Wirkt nur bei der Aktion Navigieren. Vorgabe: leer.",
    },
    texte: {
      template_auto: "Automatisch",
      template_light: "Licht",
      template_climate: "Klima",
      template_cover: "Rollo/Tor",
      template_fan: "Lüfter",
      template_media: "Medien",
      template_lock: "Schloss",
      template_switch: "Schalter",
      template_generic: "Allgemein",
      tap_action_expand: "Aufklappen",
      "tap_action_more-info": "Details öffnen",
      tap_action_toggle: "Umschalten",
      "tap_action_device-page": "Geräteseite öffnen",
      tap_action_navigate: "Navigieren",
      tap_action_none: "Nichts",
      hold_action_expand: "Aufklappen",
      "hold_action_more-info": "Details öffnen",
      hold_action_toggle: "Umschalten",
      "hold_action_device-page": "Geräteseite öffnen",
      hold_action_navigate: "Navigieren",
      hold_action_none: "Nichts",
      gruppe_control: "Steuerung",
      gruppe_sensor: "Sensoren",
      gruppe_config: "Konfiguration",
      gruppe_diagnostic: "Diagnose",
      keineEntitaet: "Keine Entität gewählt. Im Karteneditor eine auswählen.",
      altesHa: "Braucht Home Assistant 2024.11 oder neuer.",
      nichtRegistriert: "{entity} ist nicht registriert.",
      keinGeraet: "{entity} gehört zu keinem Gerät.",
      helferFehlt: "Bausteine von Home Assistant nicht ladbar.",
      laden: "Wird geladen …",
      keineTreffer: "Kein Eintrag mit diesen Labels.",
      aufklappen: "Aufklappen",
      zuklappen: "Zuklappen",
    },
  },
  en: {
    name: "Busch device",
    description: "Shows the whole device behind an entity: header, control and every entity, grouped like the device page.",
    labels: {
      entity: "Entity",
      title: "Heading",
      template: "Layout",
      labels: "Only entities with label",
      show_subtitle: "Show subtitle",
      start_expanded: "Start expanded",
      show_config: "Show configuration",
      show_diagnostic: "Show diagnostic",
      tap_action: "Tap on the header",
      hold_action: "Hold on the header",
      navigation_path: "Navigation target",
    },
    helpers: {
      entity: "Any entity of the device. The card finds the device from it and shows this entity as the control at the top.",
      title: "Heading of the card. Empty uses the device name. Default: empty.",
      template: "Which controls appear at the top. Automatic follows the kind of entity. Default: automatic.",
      labels: "Lists only entities carrying one of these labels below. The entity at the top always stays. Default: all.",
      show_subtitle: "Manufacturer, model and area below the name. Default on.",
      start_expanded: "On shows the entity list right away, off only after expanding. Default off.",
      show_config: "Offer the configuration group at all. Default on.",
      show_diagnostic: "Offer the diagnostic group at all. Default on.",
      tap_action: "What a tap on name and subtitle does. Default: expand.",
      hold_action: "What a hold on name and subtitle does. Default: open details.",
      navigation_path: "Dashboard path such as /lovelace/devices. Only used by the navigate action. Default: empty.",
    },
    texte: {
      template_auto: "Automatic",
      template_light: "Light",
      template_climate: "Climate",
      template_cover: "Cover",
      template_fan: "Fan",
      template_media: "Media",
      template_lock: "Lock",
      template_switch: "Switch",
      template_generic: "Generic",
      tap_action_expand: "Expand",
      "tap_action_more-info": "Open details",
      tap_action_toggle: "Toggle",
      "tap_action_device-page": "Open device page",
      tap_action_navigate: "Navigate",
      tap_action_none: "Nothing",
      hold_action_expand: "Expand",
      "hold_action_more-info": "Open details",
      hold_action_toggle: "Toggle",
      "hold_action_device-page": "Open device page",
      hold_action_navigate: "Navigate",
      hold_action_none: "Nothing",
      gruppe_control: "Controls",
      gruppe_sensor: "Sensors",
      gruppe_config: "Configuration",
      gruppe_diagnostic: "Diagnostic",
      keineEntitaet: "No entity chosen. Pick one in the card editor.",
      altesHa: "Needs Home Assistant 2024.11 or newer.",
      nichtRegistriert: "{entity} is not registered.",
      keinGeraet: "{entity} belongs to no device.",
      helferFehlt: "Home Assistant building blocks could not be loaded.",
      laden: "Loading …",
      keineTreffer: "No entry with these labels.",
      aufklappen: "Expand",
      zuklappen: "Collapse",
    },
  },
};

/** Ein Aufruf je Seite, nicht je Karte. Bei Fehler eine leere Map. */
let devLabelCache = null;
function devLabelsLaden(hass) {
  if (!devLabelCache) {
    devLabelCache = Promise.resolve()
      .then(() => hass.callWS({ type: "config/label_registry/list" }))
      .then((liste) => {
        const m = new Map();
        for (const e of Array.isArray(liste) ? liste : []) m.set(e.label_id, e);
        return m;
      })
      .catch(() => new Map());
  }
  return devLabelCache;
}

/** HA speichert Label-Farben als Namen (`red`, `indigo`) — im Frontend
 *  werden sie zu `var(--<name>-color)`. Hex-Werte bleiben, wie sie sind. */
function devLabelFarbe(eintrag) {
  const farbe = eintrag && eintrag.color;
  if (!farbe) return "";
  const s = String(farbe);
  if (s.startsWith("#") || s.startsWith("rgb") || s.startsWith("var(")) return s;
  return `var(--${s}-color)`;
}

/** `window.loadCardHelpers()` einmal je Seite; `null`, wenn es fehlt. */
let devHelferCache = null;
function devHelferLaden() {
  if (!devHelferCache) {
    devHelferCache = Promise.resolve()
      .then(() => {
        if (typeof window === "undefined" || typeof window.loadCardHelpers !== "function") return null;
        return window.loadCardHelpers();
      })
      .then((h) => (h && typeof h.createCardElement === "function" && typeof h.createRowElement === "function" ? h : null))
      .catch(() => null);
  }
  return devHelferCache;
}
```

- [ ] **Schritt 4: Prüfen, muss grün sein**

Run: `node --check dist/busch-cards.js && node --test tests/`
Zusätzlich: `python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards`
Erwartet: R3.2 meldet **noch** „kein customCards-Eintrag" für den neuen Tag
(kommt in Aufgabe 5) — alles andere ohne Befund. Notieren, nicht beheben.

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet-editor.test.js dist/busch-cards.js
git commit -m "busch-device-card: Schema, Wörterbuch, Label- und Helferladen"
```

---

### Aufgabe 4: Die Kartenklasse

**Dateien:**
- Ändern: `dist/busch-cards.js` (im `dev`-Abschnitt hinter `devHelferLaden`)
- Ändern: `tests/geraet.test.js` (Test für `getStubConfig`)

**Schnittstellen:**
- Erzeugt: `DEV_STIL` (CSS), `BuschDeviceCard` mit `getConfigElement`,
  `getStubConfig(hass, entities)`, `setConfig`, `set hass`, `getCardSize`,
  `getGridOptions`.
- Verbraucht: alles aus Aufgabe 1–3.

- [ ] **Schritt 1: Den fehlschlagenden Test für die Vorgabe anhängen**

An `tests/geraet.test.js` anhängen (`BuschDeviceCard` in `ladeKarte` ergänzen):

```js
/* ── Kartenklasse: Vorgabe fuer den Kartenwaehler ──────────────────────── */

test("getStubConfig nimmt die erste Entitaet, die zu einem Geraet gehoert", () => {
  const h = baueHass();
  const stub = BuschDeviceCard.getStubConfig(h, ["sensor.ohne_geraet", "sensor.decke_leistung", "light.decke"]);
  assert.strictEqual(stub.type, "custom:busch-device-card");
  assert.strictEqual(stub.entity, "sensor.decke_leistung");
});

test("getStubConfig ohne Entitaetenliste sucht in hass.states; ohne alles bleibt entity leer", () => {
  const h = baueHass();
  assert.ok(h.entities[BuschDeviceCard.getStubConfig(h).entity].device_id);
  assert.strictEqual(BuschDeviceCard.getStubConfig(undefined).entity, "");
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet.test.js` — FAIL, `BuschDeviceCard is not defined`.

- [ ] **Schritt 3: Stil und Kartenklasse umsetzen**

```js
const DEV_STIL = `
  .dev-kopf { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
    padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px); cursor:pointer;
    user-select:none; -webkit-user-select:none; min-width:0; }
  .dev-icon { flex:0 0 40px; width:40px; height:40px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    background:rgba(var(--rgb-primary-color, 3, 169, 244), .12);
    color:var(--primary-color); --mdc-icon-size:24px; }
  .dev-titel { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .dev-name { font-size:1.05em; font-weight:var(--ha-font-weight-medium, 500);
    color:var(--primary-text-color);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .dev-unter { display:flex; align-items:center; gap:6px; min-width:0;
    font-size:.85em; color:var(--secondary-text-color); }
  .dev-unter-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .dev-brand { width:16px; height:16px; flex:0 0 16px; }
  .dev-pfeil { flex:0 0 auto; width:24px; height:24px; color:var(--secondary-text-color);
    transition:transform .2s ease; --mdc-icon-size:24px; }
  .dev-offen .dev-pfeil { transform:rotate(180deg); }
  .dev-chips { display:flex; flex-wrap:wrap; gap:4px;
    padding:0 var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .dev-chip { display:inline-flex; align-items:center; gap:4px; max-width:100%; min-width:0;
    font-size:.75em; padding:2px 8px; border-radius:12px;
    border:1px solid var(--dev-chip-farbe, var(--divider-color));
    color:var(--primary-text-color); }
  .dev-chip-punkt { width:8px; height:8px; border-radius:50%; flex:0 0 8px;
    background:var(--dev-chip-farbe, var(--secondary-text-color)); }
  .dev-chip-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .dev-tile { padding:0 var(--ha-space-3, 12px) var(--ha-space-3, 12px); }
  .dev-liste { border-top:1px solid var(--divider-color);
    padding:var(--ha-space-1, 4px) var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .dev-liste[hidden] { display:none; }
  .dev-gruppe-kopf { display:flex; align-items:center; gap:6px; min-width:0;
    padding:var(--ha-space-2, 8px) 0 var(--ha-space-1, 4px);
    font-size:.78em; text-transform:uppercase; letter-spacing:.06em;
    color:var(--secondary-text-color); background:none; border:0; width:100%;
    text-align:left; font-family:inherit; cursor:default; }
  .dev-gruppe-kopf.dev-klappbar { cursor:pointer; }
  .dev-gruppe-kopf .dev-gruppe-text { overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; min-width:0; }
  .dev-gruppe-kopf .dev-gruppe-pfeil { width:18px; height:18px; flex:0 0 18px;
    --mdc-icon-size:18px; transition:transform .2s ease; }
  .dev-gruppe.dev-zu .dev-gruppe-pfeil { transform:rotate(-90deg); }
  .dev-gruppe.dev-zu .dev-zeilen { display:none; }
  .dev-zeilen > * { display:block; padding:var(--ha-space-1, 4px) 0; }
  .dev-hinweis { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-4, 16px);
    color:var(--secondary-text-color); font-size:.9em; overflow-wrap:anywhere; }
  .dev-hinweis.dev-fehler { color:var(--error-color); }
`;

class BuschDeviceCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-device-card-editor");
  }

  /** Die erste Entität, die zu einem Gerät gehört — damit die Vorschau im
   *  Kartenwähler sofort ein Gerät zeigt (Spec Abschnitt 8). */
  static getStubConfig(hass, entities) {
    const register = (hass && hass.entities) || {};
    const liste = Array.isArray(entities) && entities.length
      ? entities
      : Object.keys((hass && hass.states) || {});
    const treffer = liste.find((id) => register[id] && register[id].device_id) || liste[0] || "";
    return { type: "custom:busch-device-card", entity: treffer };
  }

  setConfig(config) {
    this._config = devNormalisiereKonfig(config);
    this._offen = Boolean(this._config.start_expanded);
    this._zu = { config: true, diagnostic: true };
    this._stempel = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._labels && hass && typeof hass.callWS === "function") {
      this._labels = new Map();
      devLabelsLaden(hass).then((m) => {
        this._labels = m;
        this._zeichneChips();
      });
    }
    this._render();
  }

  getCardSize() {
    return 3 + (this._offen ? this._zeilenZahl || 0 : 0);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  get _texte() {
    return buschTexte(TEXTE_BUSCH_DEVICE_CARD, this._hass).texte;
  }

  /* ── Aufbau ─────────────────────────────────────────────────────────── */

  _geruest() {
    if (this._karte) return;
    this._karte = document.createElement("ha-card");
    const stil = document.createElement("style");
    stil.textContent = DEV_STIL;
    this._karte.appendChild(stil);

    this._kopf = document.createElement("div");
    this._kopf.className = "dev-kopf";
    this._icon = document.createElement("div");
    this._icon.className = "dev-icon";
    this._titel = document.createElement("div");
    this._titel.className = "dev-titel";
    this._name = document.createElement("div");
    this._name.className = "dev-name";
    this._unter = document.createElement("div");
    this._unter.className = "dev-unter";
    this._brand = document.createElement("img");
    this._brand.className = "dev-brand";
    this._brand.alt = "";
    this._brand.addEventListener("error", () => { this._brand.hidden = true; });
    this._unterText = document.createElement("span");
    this._unterText.className = "dev-unter-text";
    this._unter.append(this._brand, this._unterText);
    this._titel.append(this._name, this._unter);
    this._pfeil = document.createElement("ha-icon");
    this._pfeil.className = "dev-pfeil";
    this._pfeil.setAttribute("icon", "mdi:chevron-down");
    this._pfeil.icon = "mdi:chevron-down";
    this._kopf.append(this._icon, this._titel, this._pfeil);

    this._chips = document.createElement("div");
    this._chips.className = "dev-chips";
    this._tileBehaelter = document.createElement("div");
    this._tileBehaelter.className = "dev-tile";
    this._liste = document.createElement("div");
    this._liste.className = "dev-liste";
    this._hinweis = document.createElement("div");
    this._hinweis.className = "dev-hinweis";
    this._hinweis.hidden = true;

    this._karte.append(this._kopf, this._chips, this._tileBehaelter, this._liste, this._hinweis);
    this.appendChild(this._karte);
    this._bindeKopf();
  }

  /** Tippen/Halten wie in HA: 500 ms, Bewegung über 10 px bricht ab. */
  _bindeKopf() {
    let timer = null;
    let gehalten = false;
    let start = null;
    const abbrechen = () => { if (timer) { clearTimeout(timer); timer = null; } };
    this._kopf.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".dev-pfeil")) return;
      gehalten = false;
      start = { x: e.clientX, y: e.clientY };
      abbrechen();
      timer = setTimeout(() => { gehalten = true; this._aktion(this._config.hold_action); }, 500);
    });
    this._kopf.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) abbrechen();
    });
    this._kopf.addEventListener("pointerup", (e) => {
      if (e.target.closest(".dev-pfeil")) return;
      const warTimer = Boolean(timer);
      abbrechen();
      if (!gehalten && warTimer) this._aktion(this._config.tap_action);
      start = null;
    });
    this._kopf.addEventListener("pointercancel", abbrechen);
    this._kopf.addEventListener("pointerleave", abbrechen);
    // Der Pfeil klappt immer, unabhängig von tap_action (Spec Abschnitt 6).
    this._pfeil.addEventListener("click", (e) => { e.stopPropagation(); this._aktion("expand"); });
    this._kopf.setAttribute("role", "button");
    this._kopf.tabIndex = 0;
    this._kopf.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._aktion(this._config.tap_action); }
    });
  }

  /* ── Zeichnen ───────────────────────────────────────────────────────── */

  _render() {
    if (!this._config || !this._hass) return;
    this._geruest();
    const t = this._texte;
    const a = devGeraetAufloesen(this._hass, this._config.entity);

    if (a.fehler) {
      this._stempel = null;
      this._auf = null;
      this._name.textContent = this._config.title || this._config.entity || t.keineEntitaet;
      this._unter.hidden = true;
      this._icon.textContent = "";
      this._pfeil.hidden = true;
      this._chips.textContent = "";
      this._tileBehaelter.textContent = "";
      this._liste.textContent = "";
      this._liste.hidden = true;
      this._hinweis.textContent = buschFuellen(t[a.fehler], { entity: this._config.entity });
      this._hinweis.className = "dev-hinweis dev-fehler";
      this._hinweis.hidden = false;
      return;
    }

    this._auf = a;
    const vorlage = devVorlageWaehlen(this._config.template, this._config.entity);
    const alle = devEntitaetenDesGeraets(this._hass, a.geraet.id, this._config.entity);
    const gefiltert = devLabelFilter(alle, this._config.labels);
    const gruppen = devGruppieren(this._hass, gefiltert, this._config);
    const stempel = devStrukturStempel(a.geraet.id, vorlage, gruppen, this._config);
    this._zeilenZahl = gruppen.reduce((n, g) => n + g.ids.length, 0);

    if (stempel !== this._stempel) {
      this._stempel = stempel;
      this._zeichneKopf(a);
      this._zeichneChips();
      this._baueBausteine(stempel, vorlage, gruppen);
    }
    this._reicheHassDurch();
    this._zeigeListe();
  }

  _zeichneKopf(a) {
    this._name.textContent = this._config.title || a.name;
    this._unter.hidden = !this._config.show_subtitle;
    this._unterText.textContent = a.untertitel;
    if (a.platform) {
      this._brand.hidden = false;
      this._brand.src = `https://brands.home-assistant.io/_/${encodeURIComponent(a.platform)}/icon.png`;
    } else {
      this._brand.hidden = true;
    }
    this._icon.textContent = "";
    const icon = document.createElement("ha-state-icon");
    if (a.eintrag.icon) icon.icon = a.eintrag.icon;
    this._stateIcon = icon;
    this._icon.appendChild(icon);
    this._hinweis.hidden = true;
  }

  _zeichneChips() {
    if (!this._chips || !this._config) return;
    this._chips.textContent = "";
    for (const id of this._config.labels) {
      const e = this._labels && this._labels.get(id);
      const chip = document.createElement("span");
      chip.className = "dev-chip";
      const farbe = devLabelFarbe(e);
      if (farbe) chip.style.setProperty("--dev-chip-farbe", farbe);
      const punkt = document.createElement("span");
      punkt.className = "dev-chip-punkt";
      const text = document.createElement("span");
      text.className = "dev-chip-text";
      text.textContent = (e && e.name) || id;
      chip.append(punkt, text);
      this._chips.appendChild(chip);
    }
  }

  /** Tile und Zeilen von HA. Asynchron; eine veraltete Antwort (Stempel
   *  inzwischen anders) wird verworfen. */
  async _baueBausteine(stempel, vorlage, gruppen) {
    const t = this._texte;
    this._tileBehaelter.textContent = "";
    this._liste.textContent = "";
    this._tile = null;
    this._zeilen = [];
    const laden = document.createElement("div");
    laden.className = "dev-hinweis";
    laden.textContent = t.laden;
    this._tileBehaelter.appendChild(laden);

    const helfer = await devHelferLaden();
    if (this._stempel !== stempel) return;
    this._tileBehaelter.textContent = "";
    if (!helfer) {
      this._helferFehlt = true;
      this._hinweis.textContent = t.helferFehlt;
      this._hinweis.className = "dev-hinweis dev-fehler";
      this._hinweis.hidden = false;
      this._zeigeListe();
      return;
    }

    try {
      const tile = helfer.createCardElement({
        type: "tile",
        entity: this._config.entity,
        features: DEV_VORLAGEN[vorlage].features.map((f) => ({ ...f })),
      });
      this._tile = tile;
      this._tileBehaelter.appendChild(tile);
    } catch (e) {
      this._tile = null;
    }

    const geraeteName = this._auf ? this._auf.name : "";
    for (const g of gruppen) {
      const block = document.createElement("div");
      block.className = "dev-gruppe";
      block.dataset.gruppe = g.gruppe;
      const klappbar = g.gruppe === "config" || g.gruppe === "diagnostic";
      const kopf = document.createElement(klappbar ? "button" : "div");
      kopf.className = "dev-gruppe-kopf" + (klappbar ? " dev-klappbar" : "");
      if (klappbar) {
        kopf.type = "button";
        const pfeil = document.createElement("ha-icon");
        pfeil.className = "dev-gruppe-pfeil";
        pfeil.setAttribute("icon", "mdi:chevron-down");
        pfeil.icon = "mdi:chevron-down";
        kopf.appendChild(pfeil);
        if (this._zu[g.gruppe]) block.classList.add("dev-zu");
        kopf.addEventListener("click", () => {
          this._zu[g.gruppe] = !this._zu[g.gruppe];
          block.classList.toggle("dev-zu", this._zu[g.gruppe]);
        });
      }
      const text = document.createElement("span");
      text.className = "dev-gruppe-text";
      text.textContent = klappbar ? `${t["gruppe_" + g.gruppe]} (${g.ids.length})` : t["gruppe_" + g.gruppe];
      kopf.appendChild(text);
      const zeilen = document.createElement("div");
      zeilen.className = "dev-zeilen";
      for (const id of g.ids) {
        try {
          const voll = devAnzeigename(this._hass, this._hass.entities[id]);
          const zeile = helfer.createRowElement({ entity: id, name: devKurzname(voll, geraeteName) });
          this._zeilen.push(zeile);
          zeilen.appendChild(zeile);
        } catch (e) { /* eine kaputte Zeile reißt die anderen nicht mit */ }
      }
      block.append(kopf, zeilen);
      this._liste.appendChild(block);
    }
    if (!gruppen.length) {
      const leer = document.createElement("div");
      leer.className = "dev-hinweis";
      leer.textContent = this._config.labels.length ? t.keineTreffer : "";
      if (leer.textContent) this._liste.appendChild(leer);
    }
    this._reicheHassDurch();
    this._zeigeListe();
  }

  _reicheHassDurch() {
    if (this._tile) this._tile.hass = this._hass;
    for (const z of this._zeilen || []) z.hass = this._hass;
    if (this._stateIcon && this._auf) {
      this._stateIcon.hass = this._hass;
      this._stateIcon.stateObj = this._hass.states[this._config.entity];
    }
  }

  _zeigeListe() {
    const hatListe = !this._helferFehlt
      && ((this._zeilenZahl || 0) > 0 || this._config.labels.length > 0);
    this._pfeil.hidden = !hatListe;
    this._liste.hidden = !(this._offen && hatListe);
    this._karte.classList.toggle("dev-offen", this._offen && hatListe);
    const t = this._texte;
    this._kopf.setAttribute("aria-expanded", String(this._offen && hatListe));
    this._pfeil.setAttribute("title", this._offen ? t.zuklappen : t.aufklappen);
  }

  /* ── Aktionen (Spec Abschnitt 6) ─────────────────────────────────────── */

  _aktion(name) {
    if (!this._auf && name !== "none") return;
    switch (name) {
      case "expand":
        this._offen = !this._offen;
        this._zeigeListe();
        break;
      case "more-info":
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: this._config.entity }, bubbles: true, composed: true,
        }));
        break;
      case "toggle":
        this._hass.callService("homeassistant", "toggle", { entity_id: this._config.entity });
        break;
      case "device-page":
        this._navigiere(`/config/devices/device/${this._auf.geraet.id}`);
        break;
      case "navigate":
        if (this._config.navigation_path) this._navigiere(this._config.navigation_path);
        break;
      default:
        break;
    }
  }

  /** So navigiert HA selbst (`src/common/navigate.ts`): pushState, dann
   *  `location-changed` am `window`. */
  _navigiere(pfad) {
    history.pushState(null, "", pfad);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
}
```

- [ ] **Schritt 4: Prüfen**

Run: `node --check dist/busch-cards.js && node --test tests/`
Erwartet: grün. `namensraum.test.js` bleibt grün (keine Dublette).

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Kartenklasse — Kopfzeile, Chips, Tile, Gruppen, Aktionen"
```

---

### Aufgabe 5: Editor, Anmeldung, statische UI-Regeln

**Dateien:**
- Ändern: `dist/busch-cards.js` (Editorklasse hinter der Karte; `define` und
  `customCards.push` **am Dateiende**, hinter dem Kalender-Eintrag)
- Ändern: `tests/geraet-editor.test.js` (Editor-Verdrahtung)

**Schnittstellen:**
- Erzeugt: `BuschDeviceCardEditor` (`setConfig`, `set hass`, `_render`, `_emit`), `waehlerGeraet`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An `tests/geraet-editor.test.js` anhängen (`BuschDeviceCardEditor` in
`ladeKarte` ergänzen):

```js
/* ── Editor-Verdrahtung: ha-form bekommt Schema, Daten, Label, Helper ──── */

class EreignisStub { constructor(name, init) { this.type = name; this.detail = init.detail; } }

function domAttrappe() {
  const knoten = () => ({
    kinder: [], style: {}, eigenschaften: {},
    setAttribute() {}, addEventListener(name, fn) { this["on_" + name.replace(/-/g, "_")] = fn; },
    appendChild(k) { this.kinder.push(k); return k; }, append(...k) { this.kinder.push(...k); },
  });
  return { createElement(tag) { const k = knoten(); k.tag = tag; return k; } };
}

test("der Editor gibt ha-form Schema, Daten mit Vorgaben, Label und Helper aus dem Woerterbuch", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"], { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function (k) { this._angehaengt = k; };
  ed.setConfig({ entity: "light.decke", template: "switch" });
  ed.hass = baueHass();
  const form = ed._form;
  assert.strictEqual(form.tag, "ha-form");
  assert.strictEqual(form.data.entity, "light.decke");
  assert.strictEqual(form.data.template, "switch");
  assert.strictEqual(form.data.tap_action, "expand");
  assert.strictEqual(form.computeLabel({ name: "labels" }), "Nur Entitäten mit Label");
  assert.ok(/Vorgabe/.test(form.computeHelper({ name: "template" })));
  const template = form.schema.find((s) => s.name === "template");
  assert.strictEqual(template.selector.select.options[1].label, "Licht");
});

test("value-changed: Vorgaben fallen aus der Konfiguration, gesetzte Werte bleiben", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"], { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function () {};
  let gemeldet = null;
  ed.dispatchEvent = (ev) => { gemeldet = ev.detail.config; };
  ed.setConfig({ type: "custom:busch-device-card", entity: "light.decke" });
  ed.hass = baueHass();
  ed._form.on_value_changed({
    stopPropagation() {},
    detail: { value: { entity: "light.decke", template: "auto", tap_action: "toggle", labels: [] } },
  });
  assert.strictEqual(gemeldet.type, "custom:busch-device-card");
  assert.strictEqual(gemeldet.entity, "light.decke");
  assert.strictEqual(gemeldet.tap_action, "toggle");
  assert.strictEqual(gemeldet.template, undefined, "Vorgabe wandert nicht in die Konfiguration");
  assert.strictEqual(gemeldet.labels, undefined, "leere Liste ist die Vorgabe");
});
```

`CustomEvent` fehlt in der Sandbox. Beide Tests laden deshalb mit
`ladeKarte(["BuschDeviceCardEditor"], { document: dokument, CustomEvent: EreignisStub })`,
wobei `class EreignisStub { constructor(name, init) { this.type = name; this.detail = init.detail; } }`
oben in der Testdatei steht.

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet-editor.test.js` — FAIL, `BuschDeviceCardEditor is not defined`.

- [ ] **Schritt 3: Editor und Anmeldung umsetzen**

Hinter `BuschDeviceCard`:

```js
class BuschDeviceCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      const texte = buschTexte(TEXTE_BUSCH_DEVICE_CARD, this._hass);
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_DEVICE_CARD, texte);
      this._form.computeLabel = (s) => texte.labels[s.name] || s.name;
      this._form.computeHelper = (s) => texte.helpers[s.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const neu = { ...this._config, ...event.detail.value };
        // Vorgaben nicht ins YAML schreiben — so bleibt die Konfiguration
        // so kurz wie das, was der Nutzer wirklich geändert hat.
        for (const [k, v] of Object.entries(DEV_STANDARD)) {
          if (neu[k] === v) delete neu[k];
          else if (Array.isArray(v) && Array.isArray(neu[k]) && neu[k].length === 0) delete neu[k];
        }
        this._emit(neu);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { ...DEV_STANDARD, ...this._config };
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }
}
```

**Am Dateiende**, hinter dem `window.customCards.push({ type: "busch-calendar-card", … })`:

```js
customElements.define("busch-device-card", BuschDeviceCard);
customElements.define("busch-device-card-editor", BuschDeviceCardEditor);

const waehlerGeraet = buschTexte(TEXTE_BUSCH_DEVICE_CARD);

window.customCards.push({
  type: "busch-device-card",
  name: waehlerGeraet.name,
  description: waehlerGeraet.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
```

Außerdem den Dateikopf-Kommentar (Zeile 1–17) um die vierte Karte ergänzen,
falls er die Karten aufzählt.

- [ ] **Schritt 4: Prüfen — Node und statischer Regelprüfer**

Run:
```bash
node --check dist/busch-cards.js && node --test tests/
python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards
```
Erwartet: alle Tests grün; der Regelprüfer meldet **keinen** Befund für
`busch-device-card` (R3.1 Methoden + customCards, R3.2 Wörterbuch, R3.3
config-Schlüssel, R3.4 nowrap/ellipsis). Bleibt ein Befund, ist er zu
beheben, nicht in die Ausnahmeliste zu schreiben.

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet-editor.test.js dist/busch-cards.js
git commit -m "busch-device-card: Editor und Anmeldung im Kartenwähler"
```

---

### Aufgabe 6: Nachweis im Chromium

**Dateien:**
- Anlegen: `../docs/render/render-geraet.py` (bei den anderen Renderskripten
  unter `hacs/docs/render/`; das Repo `hacs` versioniert diesen Ordner)
- Erzeugt: `../docs/render/geraet/` (Bilder + `report.json`; **nicht** ins
  Repo — steht in `.gitignore` von `hacs`? Prüfen mit `git check-ignore`;
  sonst nur `report.json` und drei Bilder vorlegen)
- Kopieren: zwei Bilder nach `docs/preview-device.png` und
  `docs/preview-device-expanded.png` in `busch-cards/`

**Was das Skript belegt** (Spec Abschnitt 12, Schritt 3):
1. Regel 1 bei 320/480/960 px, hell/dunkel, an **vier** Karten: A (Shelly,
   zugeklappt), B (Shelly, aufgeklappt, Label-Filter, langer Titel), C
   (Aqara-Sensor, `generic`), D (Fehler: Entität ohne Gerät).
2. DOM-Auslese: Tile-Stub trägt die Vorlagen-Features; Gruppenköpfe mit
   Zählern; Chips mit Label-Namen aus der WS-Attrappe; Kurznamen ohne Präfix.
3. Verhalten: Klick auf Kopf klappt auf; `hass`-Neusetzen baut das DOM
   **nicht** um (Zeilenknoten identisch); Halten feuert `hass-more-info`;
   `device-page` ändert `location.pathname`.

- [ ] **Schritt 1: Das Renderskript schreiben**

`hacs/docs/render/render-geraet.py`:

```python
#!/usr/bin/env python3
"""Rendert busch-device-card aus busch-cards.js in echtem Chromium.

Aufruf:  python3 render-geraet.py <pfad/busch-cards.js> <ausgabeordner> [breite]

`window.loadCardHelpers` ist hier eine ATTRAPPE: Tile und Zeilen sind feste
Kaesten mit Text. Gemessen wird die EIGENE Oberflaeche der Karte (Kopfzeile,
Chips, Gruppenkoepfe) — HAs Bausteine misst HA. Aufbau wie render-kalender.py.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
  .stub-tile { height: 56px; display:flex; align-items:center; padding: 0 12px;
               border: 1px dashed var(--divider-color); border-radius: 12px; font-size: 12px;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .stub-row { height: 32px; display:flex; align-items:center; font-size: 13px;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
<div id="wrap"></div>
<script>
  class HaCard extends HTMLElement {}
  customElements.define('ha-card', HaCard);
  class HaIcon extends HTMLElement {
    connectedCallback() { this.style.display = 'inline-block'; this.style.width = '24px';
      this.style.height = '24px'; this.textContent = '\\u25BE'; }
  }
  customElements.define('ha-icon', HaIcon);
  class HaStateIcon extends HTMLElement {
    connectedCallback() { this.style.display = 'inline-block'; this.style.width = '24px';
      this.style.height = '24px'; this.textContent = '\\u25C6'; }
  }
  customElements.define('ha-state-icon', HaStateIcon);
  class HaForm extends HTMLElement {
    set schema(v) { this._schema = v; } get schema() { return this._schema; }
    set data(v) { this._data = v; } get data() { return this._data; }
    set hass(v) { this._hass = v; } get hass() { return this._hass; }
  }
  customElements.define('ha-form', HaForm);

  /* Attrappe der Helfer: feste Kaesten, die `hass` annehmen. */
  class StubTile extends HTMLElement {
    set hass(v) { this._hass = v; this.dataset.hassGesetzt = String((Number(this.dataset.hassGesetzt) || 0) + 1); }
  }
  customElements.define('stub-tile', StubTile);
  class StubRow extends HTMLElement {
    set hass(v) { this._hass = v; this.dataset.hassGesetzt = String((Number(this.dataset.hassGesetzt) || 0) + 1); }
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
      r.textContent = (cfg.name || cfg.entity) + '  —  ' + cfg.entity;
      return r;
    },
  });

  /* ── erfundener hass mit echten Registerformen ─────────────────────── */
  const e = (id, x) => Object.assign({ entity_id: id, device_id: 'd1', area_id: null, labels: [], platform: 'shelly' }, x || {});
  const z = (n, s) => ({ state: s, attributes: { friendly_name: n } });
  window.__wsAufrufe = [];
  window.__dienste = [];
  const hass = {
    locale: { language: 'de-DE' },
    states: {
      'light.decke': z('Wohnzimmer Deckenlampe', 'on'),
      'sensor.decke_leistung': z('Wohnzimmer Deckenlampe Leistung', '12.4'),
      'sensor.decke_energie': z('Wohnzimmer Deckenlampe Energie', '3.21'),
      'sensor.decke_rssi': z('Wohnzimmer Deckenlampe RSSI', '-61'),
      'update.decke_firmware': z('Wohnzimmer Deckenlampe Firmware', 'off'),
      'switch.decke_kindersicherung': z('Wohnzimmer Deckenlampe Kindersicherung', 'off'),
      'binary_sensor.decke_ueberhitzt': z('Wohnzimmer Deckenlampe Überhitzt', 'off'),
      'event.decke_taster': z('Wohnzimmer Deckenlampe Taster', '2026-09-09T10:00:00+00:00'),
      'sensor.aqara_temp': z('Aqara Temperatur', '21.3'),
      'sensor.aqara_feuchte': z('Aqara Luftfeuchte', '48'),
      'sensor.aqara_batterie': z('Aqara Batterie', '87'),
      'sensor.ohne_geraet': z('Ohne Gerät', '7'),
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
      d1: { id: 'd1', name: 'shellyplus1pm-abc123', name_by_user: 'Wohnzimmer Deckenlampe',
            manufacturer: 'Shelly', model: 'Plus 1PM', area_id: 'wohnzimmer', labels: [] },
      d2: { id: 'd2', name: 'Aqara Temperatur- und Luftfeuchtesensor mit sehr langem Namen für den Umbruchtest',
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
      return [];
    },
    async callService(d, s, x) { window.__dienste.push(d + '.' + s + ' ' + JSON.stringify(x)); },
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
  window.__b = mk('karte-b', { entity: 'light.decke', start_expanded: true, labels: ['l_energie', 'l_wichtig'],
                                title: 'Eine absichtlich viel zu lange Überschrift, die gekürzt werden muss, damit Regel 1 hält' });
  window.__c = mk('karte-c', { entity: 'sensor.aqara_temp', start_expanded: true, hold_action: 'device-page' });
  window.__d = mk('karte-d', { entity: 'sensor.ohne_geraet' });
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
        page = browser.new_page(viewport={"width": WIDTH, "height": 1400},
                                device_scale_factor=2, locale="de-DE")
        horchen(page)
        page.goto(f"http://127.0.0.1:{PORT}/page.html", wait_until="load")
        page.wait_for_selector("#karte-b .stub-row", timeout=20000)
        page.wait_for_timeout(800)

        bericht = page.evaluate(AUSLESEN)
        umgebung = page.evaluate(UMGEBUNG)

        page.screenshot(path=str(OUT / "geraet-page.png"), full_page=True)
        for kennung in ("a", "b", "c", "d"):
            page.locator(f"#karte-{kennung}").screenshot(path=str(OUT / f"geraet-{kennung}.png"))

        page.evaluate("""() => { const w = document.getElementById('wrap');
                              w.style.maxWidth = 'none'; w.style.width = 'auto'; }""")
        ui = {}
        for kennung in ("#karte-a", "#karte-b", "#karte-c", "#karte-d"):
            ui[kennung] = regeln.lauf_breiten(
                page, messung=lambda p, k=kennung: regeln.messe_text(p, k))
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
    "umgebung": umgebung,
    "karten": bericht,
    "verhalten": verhalten,
    "karten_nach_verhalten": nachher,
    "ui_regeln": ui,
    "ui_regeln_zaehlung": {k: regeln.zaehle(v) for k, v in ui.items()},
    "ui_selbsttest": selbsttest,
}
regeln.schreibe(OUT / "report.json", report)
sys.exit(regeln.bewerte(report))
```

Falls `regeln.schreibe` eine andere Signatur hat (`schreibe(pfad, report, zeige)`),
den Aufruf anpassen; die Funktion steht in `regeln.py` ab Zeile ~903.

- [ ] **Schritt 2: Laufen lassen**

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /work/render-geraet.py /cards/dist/busch-cards.js /work/geraet'
```

Erwartet: Exit 0. Danach `report.json` **lesen**, nicht nur den Exit-Code:

| Feld | Sollwert |
| --- | --- |
| `page_errors`, `console_errors`, `request_failures` (ohne brands) | leer |
| `karten[0].tile` | `TILE light.decke [light-brightness]` |
| `karten[1].chips` | `["Energie","Wichtig"]` |
| `karten[1].gruppen` | genau eine Gruppe `sensor` mit zwei Zeilen `Energie`, `Leistung` (Label-Filter) |
| `karten[2].gruppen` | `sensor` (Luftfeuchte) offen, `diagnostic (1)` zu |
| `karten[2].tile` | `TILE sensor.aqara_temp []` |
| `karten[3].hinweis` | `sensor.ohne_geraet gehört zu keinem Gerät.` und `pfeilSichtbar: false` |
| `karten[0].listeSichtbar` | `false`; `karten[1].listeSichtbar` `true` |
| `verhalten.zeilenIdentischNachHass` | `true` |
| `verhalten.hassAnZeilenDurchgereicht` | `true` |
| `verhalten.zeilenNachNeuerEntitaet` | 3 (Energie, Leistung, Neu) |
| `verhalten.aOffenNachTipp` | `true`; `aOffenNachHalten` unverändert `true` |
| `verhalten.moreInfoNachHalten` | `["light.decke"]` |
| `verhalten.pfadNachDevicePage` | `/config/devices/device/d2` |
| `verhalten.diagnoseZuVorher/Nachher` | `true` / `false` |
| `ui_regeln_zaehlung.*` | `ueberlauf`, `ausserhalb`, `ueberlappung` je 0 |
| `ui_selbsttest.ueberlauf_erkannt` | `true` |
| `umgebung.wsAufrufe` | genau **ein** `config/label_registry/list` bei vier Karten |

Ein abweichender Wert ist ein Fehler der Karte oder der Attrappe — erst
klären, welcher, dann beheben, dann **neu laufen lassen**.

- [ ] **Schritt 3: Die Bilder wirklich ansehen**

`geraet-a.png`, `geraet-b.png`, `geraet-c.png`, `geraet-d.png`,
`geraet-a-offen.png` und je ein 320-px-Bild hell/dunkel mit dem Read-Werkzeug
öffnen. Prüfen: Name gekürzt mit „…", Untertitel einzeilig, Chips mit Punkt in
Rot/Grün, Gruppenköpfe in Kapitälchen, Fehlerkarte D rot ohne Pfeil, dunkles
Thema lesbar. Was auf dem Bild fehlt oder falsch ist, wird behoben — ein
grüner Bericht allein ist kein Beleg (`hacs/CLAUDE.md`, „Nicht verhandelbar").

- [ ] **Schritt 4: Die drei anderen Karten gegenprüfen**

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /work/render-kalender.py /cards/dist/busch-cards.js /work/kalender-nach-geraet && \
      python3 /work/render-zeitplan.py /cards/dist/busch-cards.js /work/zeitplan-nach-geraet'
```

Erwartet: beide Exit 0, `tageZeilen` 31 bzw. der Zeitplan mit `amPm: 0` wie
vor der Änderung. Das ist der Schritt gegen die Namenskollision.

- [ ] **Schritt 5: Bilder ins Repo, Skript committen**

```bash
cp "../docs/render/geraet/geraet-b.png" docs/preview-device-expanded.png
cp "../docs/render/geraet/geraet-a.png" docs/preview-device.png
git add docs/preview-device.png docs/preview-device-expanded.png
git commit -m "busch-device-card: Vorschaubilder aus dem Chromium-Lauf"
cd .. && git status --short docs/render/ && git add docs/render/render-geraet.py \
  && git commit -m "render-geraet.py: Nachweislauf für busch-device-card" && cd busch-cards
```

Vor dem Commit im `hacs`-Repo: `git log -1 --format=%cr` und
`git status` ansehen — arbeitet dort eine andere Sitzung (Unraid-SSH-Spec vom
selben Tag), **nur** `docs/render/render-geraet.py` vorlegen, nichts sonst.

---

### Aufgabe 7: README, Version, Übergabe

**Dateien:**
- Ändern: `README.md` (Kopftabelle, neuer Abschnitt)
- Ändern: `dist/busch-cards.js` (`CARD_VERSION`)
- Ändern: `../CLAUDE.md` (HIER WEITERMACHEN; Versionstabelle **nicht** — die
  zeigt den getaggten Stand)

- [ ] **Schritt 1: README**

Kopfsatz auf „Vier Lovelace-Karten", Tabelle um
`busch-device-card | ein Gerät samt aller Entitäten, aus einer Entität ermittelt`.
Neuer Abschnitt am Ende nach dem Muster der Kalenderkarte:

```markdown
# `busch-device-card`

Gib der Karte **irgendeine** Entität — sie sucht das Gerät dazu und zeigt
Name, Hersteller, Modell und Bereich, darüber Home Assistants Tile-Karte mit
den zur Entität passenden Bedienelementen, und darunter alle übrigen
Entitäten des Geräts, gruppiert wie auf der Geräteseite: Steuerung, Sensoren,
Konfiguration, Diagnose.

![Zugeklappt](docs/preview-device.png) ![Aufgeklappt mit Label-Filter](docs/preview-device-expanded.png)

```yaml
type: custom:busch-device-card
entity: light.wohnzimmer_decke
template: auto          # auto | light | climate | cover | fan | media | lock | switch | generic
labels: []              # nur Entitäten mit einem dieser Labels
start_expanded: false
tap_action: expand      # expand | more-info | toggle | device-page | navigate | none
hold_action: more-info
```

## Optionen

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `entity` | — | Entität, über die das Gerät gefunden wird; zugleich das Bedienelement oben |
| `title` | Gerätename | Überschrift |
| `template` | `auto` | Bedienelemente der Tile-Karte: Licht → Helligkeit, Klima → Solltemperatur + Modi, Rollo → Auf/Zu + Position, Lüfter → Geschwindigkeit, Medien → Lautstärke, Schloss → Sperren, Schalter → Umschalten, Allgemein → nur Zustand |
| `labels` | alle | zeigt unten nur Entitäten mit einem dieser Labels; das Bedienelement oben bleibt |
| `show_subtitle` | `true` | Hersteller · Modell · Bereich |
| `show_config` / `show_diagnostic` | `true` | die eingeklappten Gruppen überhaupt anbieten |
| `start_expanded` | `false` | Liste beim Laden offen |
| `tap_action` / `hold_action` | `expand` / `more-info` | Tippen bzw. Halten auf der Kopfzeile; `device-page` öffnet HAs Geräteseite |
| `navigation_path` | leer | Ziel für `navigate` |

Bedienelement und Zeilen sind Home Assistants eigene Bausteine
(`tile`-Karte, `entities`-Zeilen) — Formatierung, Einheiten und Klick auf
eine Zeile verhalten sich wie überall in HA. Versteckte Entitäten (`hidden`)
erscheinen nicht.
```

Ganz oben im README den „Nachweis"-Absatz, falls vorhanden, um einen Satz zum
Chromium-Lauf `render-geraet.py` ergänzen — mit dem Hinweis, dass die Helfer
dort Attrappen sind.

- [ ] **Schritt 2: Version**

`CARD_VERSION` von `"0.9.1"` auf `"0.10.0"`. `node --check`, `node --test tests/`.

- [ ] **Schritt 3: Commit und Push**

```bash
git add README.md dist/busch-cards.js
git commit -m "busch-device-card 0.10.0: README und Version"
git push origin main
```

**Nicht taggen.** Der Tag braucht die vier Belege aus `docs/ui-regeln.md`,
„Abnahme", und die Sichtung im echten Home Assistant (Spec Abschnitt 12,
Schritt 4) — die entscheidet der Nutzer.

- [ ] **Schritt 4: `hacs/CLAUDE.md` fortschreiben**

Erst `cd .. && git status --short && git log -1 --format='%cr %s'`. Dann im
Abschnitt „HIER WEITERMACHEN" einen Punkt ergänzen:

```markdown
7. **`busch-device-card` (0.10.0 auf `main`, ungetaggt).** Spec
   `busch-cards/docs/superpowers/specs/2026-09-09-geraetekarte-design.md`,
   Plan `…/plans/2026-09-09-geraetekarte.md`. Node-Tests und Chromium-Lauf
   (`docs/render/render-geraet.py`, Helfer als Attrappe) grün; **nie in
   echtem HA gesehen** — dort prüfen: Tile-Features je Vorlage, Zeilen,
   Label-Selektor im Editor, `device-page`, dann die vier Belege und Tag.
```

Nur diese Datei vorlegen: `git add CLAUDE.md && git commit -m "HIER WEITERMACHEN: busch-device-card 0.10.0 ungetaggt" && git push origin main`.

- [ ] **Schritt 5: Meldung**

```bash
"/mnt/user/Data/Claude Projekte/scripts/ha-notify.sh" \
  "HACS: busch-device-card 0.10.0 gebaut, Tests und Chromium grün, ungetaggt — im echten HA prüfen" \
  --agent "HACS"
```
