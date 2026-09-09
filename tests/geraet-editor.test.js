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

test("scheitert der WebSocket-Aufruf, kommt eine leere Map und kein Wurf", async () => {
  // Frische Sandbox: der Zwischenspeicher liegt im Modul.
  const { devLabelsLaden: frisch } = ladeKarte(["devLabelsLaden"]);
  const hass = { async callWS() { throw new Error("offline"); } };
  const m = await frisch(hass);
  assert.strictEqual(m.size, 0);
});

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

test("beide Sprachen kennen dieselben Domainwoerter, keines leer", () => {
  const de = Object.keys(TEXTE_BUSCH_DEVICE_CARD.de.texte).filter((k) => k.startsWith("domain_"));
  const en = Object.keys(TEXTE_BUSCH_DEVICE_CARD.en.texte).filter((k) => k.startsWith("domain_"));
  assert.ok(de.length >= 20, "genug Domains abgedeckt: " + de.length);
  assert.strictEqual(de.slice().sort().join(","), en.slice().sort().join(","));
  for (const k of de) {
    assert.ok(TEXTE_BUSCH_DEVICE_CARD.de.texte[k], "de." + k);
    assert.ok(TEXTE_BUSCH_DEVICE_CARD.en.texte[k], "en." + k);
  }
  // Die Domains, die in der Attrappe und am echten Geraet vorkommen.
  for (const d of ["update", "select", "sensor", "light", "switch", "binary_sensor", "event"]) {
    assert.ok(TEXTE_BUSCH_DEVICE_CARD.de.texte["domain_" + d], "domain_" + d);
  }
});
