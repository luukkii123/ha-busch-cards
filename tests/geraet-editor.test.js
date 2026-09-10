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
  devLabelsLaden,
  devLabelFarbe,
  DEV_ARTEN,
  DEV_HA_AKTIONEN,
  DEV_GRUPPEN_WERTE,
  devSchemaFuer,
} = ladeKarte([
  "SCHEMA_BUSCH_DEVICE_CARD",
  "TEXTE_BUSCH_DEVICE_CARD",
  "DEV_STANDARD",
  "DEV_VORLAGEN",
  "devLabelsLaden",
  "devLabelFarbe",
  "DEV_ARTEN",
  "DEV_HA_AKTIONEN",
  "DEV_GRUPPEN_WERTE",
  "devSchemaFuer",
]);

/** Spec Abschnitt 8, woertlich. */
const OPTIONEN_DER_SPEC = [
  "entity", "title", "template", "labels", "labels_hide", "groups", "groups_open",
  "show_subtitle", "start_expanded", "tap_action", "hold_action",
  "row_tap_action", "row_hold_action",
];
/** Zwei Felder leben nur im Editor und landen in keiner Konfiguration. */
const NUR_EDITOR = ["tap_kind", "hold_kind"];

function schemaBlaetter(schema) {
  const aus = [];
  for (const e of schema) {
    if (Array.isArray(e.schema)) aus.push(...schemaBlaetter(e.schema));
    else if (e.name) aus.push(e);
  }
  return aus;
}

test("das Schema enthaelt jede Option der Spec plus die zwei Editorfelder", () => {
  const namen = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).map((b) => b.name).sort().join(",");
  assert.strictEqual(namen, OPTIONEN_DER_SPEC.concat(NUR_EDITOR).sort().join(","));
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
  assert.strictEqual(werte("tap_kind").join(","), DEV_ARTEN.join(","));
  assert.strictEqual(werte("hold_kind").join(","), DEV_ARTEN.join(","));
  assert.strictEqual(werte("groups").join(","), DEV_GRUPPEN_WERTE.join(","));
  assert.strictEqual(werte("groups_open").join(","), DEV_GRUPPEN_WERTE.join(","));
  for (const feld of ["groups", "groups_open"]) {
    assert.strictEqual(blaetter.find((b) => b.name === feld).selector.select.multiple, true, feld);
  }
});

test("die vier Aktionsfelder nutzen HAs eigenen Aktionseditor, ohne assist", () => {
  const blaetter = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD);
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    const b = blaetter.find((x) => x.name === feld);
    assert.ok(b.selector.ui_action, feld + " braucht den ui_action-Selektor");
    assert.strictEqual(b.selector.ui_action.actions.join(","), DEV_HA_AKTIONEN.join(","), feld);
    assert.ok(!b.selector.ui_action.actions.includes("assist"), feld + " darf assist nicht anbieten");
  }
});

test("labels_hide ist ein Label-Selektor mit Mehrfachauswahl", () => {
  const b = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).find((x) => x.name === "labels_hide");
  assert.strictEqual(b.selector.label.multiple, true);
});

test("devSchemaFuer zeigt HAs Aktionseditor nur bei der Art ha", () => {
  const namen = (k) => schemaBlaetter(devSchemaFuer(k)).map((b) => b.name);
  const eigen = namen({ tap_action: { action: "expand" }, hold_action: { action: "device-page" } });
  assert.ok(!eigen.includes("tap_action"), "bei expand kein HA-Editor");
  assert.ok(!eigen.includes("hold_action"), "bei device-page kein HA-Editor");
  assert.ok(eigen.includes("tap_kind") && eigen.includes("hold_kind"));
  const ha = namen({ tap_action: { action: "perform-action" }, hold_action: { action: "more-info" } });
  assert.ok(ha.includes("tap_action") && ha.includes("hold_action"));
});

test("devSchemaFuer laesst die Zeilenfelder stehen und aendert das Original nicht", () => {
  const vorher = JSON.stringify(SCHEMA_BUSCH_DEVICE_CARD);
  const namen = schemaBlaetter(devSchemaFuer({ tap_action: { action: "expand" } })).map((b) => b.name);
  assert.ok(namen.includes("row_tap_action") && namen.includes("row_hold_action"));
  assert.strictEqual(JSON.stringify(SCHEMA_BUSCH_DEVICE_CARD), vorher, "das Literal bleibt unberuehrt");
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
    for (const a of DEV_ARTEN) {
      assert.ok(t[`tap_kind_${a}`], `tap_kind_${a}`);
      assert.ok(t[`hold_kind_${a}`], `hold_kind_${a}`);
    }
    for (const g of DEV_GRUPPEN_WERTE) {
      assert.ok(t[`groups_${g}`], `groups_${g}`);
      assert.ok(t[`groups_open_${g}`], `groups_open_${g}`);
      assert.ok(t[`gruppe_${g}`], `gruppe_${g}`);
    }
    for (const f of ["keineEntitaet", "altesHa", "nichtRegistriert", "keinGeraet",
                     "helferFehlt", "laden", "keineTreffer", "dienstFehler"]) {
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

test("der Editor gibt ha-form das gefilterte Schema und die Art als Datenfeld", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function (k) { this._angehaengt = k; };
  ed.setConfig({ entity: "light.decke" });
  ed.hass = baueHass();
  const form = ed._form;
  assert.strictEqual(form.tag, "ha-form");
  assert.strictEqual(form.data.entity, "light.decke");
  assert.strictEqual(form.data.tap_kind, "expand", "aus der Vorgabe abgeleitet");
  assert.strictEqual(form.data.hold_kind, "ha");
  const namen = form.schema.flatMap((e) => (e.schema ? e.schema.map((x) => x.name) : [e.name]));
  assert.ok(!namen.includes("tap_action"), "bei expand kein HA-Editor");
  assert.ok(namen.includes("hold_action"), "bei ha schon");
  assert.strictEqual(form.computeLabel({ name: "labels_hide" }), "Entitäten mit Label verbergen");
  assert.ok(/Vorgabe/.test(form.computeHelper({ name: "groups" })));
});

test("die Art zu wechseln schreibt die Aktion um und setzt das Schema neu", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function () {};
  let gemeldet = null;
  ed.dispatchEvent = (ev) => { gemeldet = ev.detail.config; };
  ed.setConfig({ type: "custom:busch-device-card", entity: "light.decke" });
  ed.hass = baueHass();
  ed._form.on_value_changed({
    stopPropagation() {},
    detail: { value: { ...ed._form.data, tap_kind: "ha" } },
  });
  assert.strictEqual(gemeldet.tap_action.action, "more-info", "die Art ha startet bei more-info");
  assert.strictEqual(gemeldet.tap_kind, undefined, "die Art landet nie in der Konfiguration");
  assert.strictEqual(gemeldet.hold_kind, undefined);
  const namen = ed._form.schema.flatMap((e) => (e.schema ? e.schema.map((x) => x.name) : [e.name]));
  assert.ok(namen.includes("tap_action"), "das Schema ist neu gesetzt");
});

test("eine gesetzte HA-Aktion bleibt erhalten, Vorgaben fallen heraus", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function () {};
  let gemeldet = null;
  ed.dispatchEvent = (ev) => { gemeldet = ev.detail.config; };
  ed.setConfig({ type: "custom:busch-device-card", entity: "light.decke" });
  ed.hass = baueHass();
  ed._form.on_value_changed({
    stopPropagation() {},
    detail: {
      value: {
        ...ed._form.data, tap_kind: "ha",
        tap_action: { action: "perform-action", perform_action: "label.add" },
        labels_hide: [], groups: ["control", "sensor", "config", "diagnostic"],
      },
    },
  });
  assert.strictEqual(gemeldet.tap_action.perform_action, "label.add");
  assert.strictEqual(gemeldet.labels_hide, undefined, "leere Vorgabe faellt heraus");
  assert.strictEqual(gemeldet.groups, undefined, "die Vorgabe aller vier Gruppen faellt heraus");
  assert.strictEqual(gemeldet.hold_action, undefined, "unveraenderte Vorgabe faellt heraus");
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
