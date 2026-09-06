"use strict";

/**
 * Pruefungen fuer den Karteneditor.
 *
 * Was hier belegt wird: Schema und Beschriftungen sind reine Daten, also unter
 * Node pruefbar — jede Option der Spec steht im Schema, jede hat eine deutsche
 * Beschriftung, und die Verschmelzung der Kalenderliste verliert keine
 * gesetzte Farbe.
 *
 * Was hier NICHT belegt wird: dass Home Assistants echtes `ha-form` diese
 * Selektoren darstellt. Das entscheidet erst ein Blick ins Frontend.
 */

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const { CAL_CARD_SCHEMA, CAL_LABELS, CAL_STANDARD, BuschCalendarCardEditor } =
  ladeKarte([
    "CAL_CARD_SCHEMA",
    "CAL_LABELS",
    "CAL_STANDARD",
    "BuschCalendarCardEditor",
  ]);

/** Abschnitt 5 der Spec, woertlich: alle Optionen der Karte. */
const OPTIONEN_DER_SPEC = [
  "entities",
  "month_offset",
  "navigation",
  "show_empty_days",
  "show_total",
  "title",
  "open_event_on_tap",
];

/** Das Schema ist verschachtelt (`type: "grid"`); gesucht sind die Blaetter. */
function schemaNamen(schema) {
  const namen = [];
  for (const eintrag of schema) {
    if (Array.isArray(eintrag.schema)) namen.push(...schemaNamen(eintrag.schema));
    else if (eintrag.name) namen.push(eintrag.name);
  }
  return namen;
}

test("jede Option der Spec steht im Schema", () => {
  const namen = schemaNamen(CAL_CARD_SCHEMA);
  const fehlend = OPTIONEN_DER_SPEC.filter((o) => !namen.includes(o));
  assert.deepStrictEqual(
    fehlend,
    [],
    `Nur in YAML einstellbar: ${fehlend.join(", ")}. Der Nutzer hat ` +
      "ausdruecklich verlangt, dass jede Option im Editor steht."
  );
});

test("das Schema erfindet keine Option, die es nicht gibt", () => {
  const namen = schemaNamen(CAL_CARD_SCHEMA);
  const ueberzaehlig = namen.filter((n) => !OPTIONEN_DER_SPEC.includes(n));
  assert.deepStrictEqual(ueberzaehlig, [], "unbekannte Felder im Schema");
});

test("jedes Schemafeld hat eine deutsche Beschriftung", () => {
  for (const name of schemaNamen(CAL_CARD_SCHEMA)) {
    assert.ok(CAL_LABELS[name], `keine Beschriftung fuer ${name}`);
    assert.notStrictEqual(
      CAL_LABELS[name],
      name,
      `${name} traegt nur den technischen Namen`
    );
  }
});

test("jede Beschriftung gehoert zu einem Schemafeld", () => {
  const namen = schemaNamen(CAL_CARD_SCHEMA);
  for (const name of Object.keys(CAL_LABELS)) {
    assert.ok(namen.includes(name), `Beschriftung ohne Feld: ${name}`);
  }
});

test("jede Option ausser entities hat einen Standardwert", () => {
  for (const name of OPTIONEN_DER_SPEC) {
    if (name === "entities") continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(CAL_STANDARD, name),
      `${name} fehlt in CAL_STANDARD`
    );
  }
});

test("month_offset laesst negative Werte zu", () => {
  const feld = CAL_CARD_SCHEMA.find((e) => e.name === "month_offset");
  assert.ok(feld.selector.number.min < 0, "sonst gaebe es keinen Vormonat");
});

test("der Entitaetsselektor nimmt mehrere Kalender", () => {
  const feld = CAL_CARD_SCHEMA.find((e) => e.name === "entities");
  assert.strictEqual(feld.selector.entity.domain, "calendar");
  assert.strictEqual(feld.selector.entity.multiple, true);
});

/* ── Verschmelzung der Kalenderliste ────────────────────────────────────── */

function editorMit(entities) {
  const editor = new BuschCalendarCardEditor();
  editor._config = { ...CAL_STANDARD, entities };
  return editor;
}

test("eine gesetzte Farbe ueberlebt eine Aenderung der Auswahl", () => {
  const editor = editorMit([
    { entity: "calendar.a", color: "#ff0000" },
    "calendar.b",
  ]);
  const neu = editor._verschmelzeEntities(["calendar.a", "calendar.c"]);
  assert.deepStrictEqual(neu, [{ entity: "calendar.a", color: "#ff0000" }, "calendar.c"]);
});

// ENTFALLEN mit v0.7.1: „auch eine gesetzte Beschriftung ueberlebt".
// Die Option `label` gab es nur in der Normalisierung, gezeichnet wurde sie
// nie — kein Ort dafuer, die Karte hat keine Legende. Statt sie nachzubauen,
// ist sie aus Code, Spec und README entfernt. Die Pruefung darueber deckt das,
// worauf es beim Verschmelzen wirklich ankommt: eine gesetzte Farbe.

test("ein entfernter Kalender verschwindet wirklich", () => {
  const editor = editorMit([{ entity: "calendar.a", color: "#ff0000" }]);
  assert.deepStrictEqual(editor._verschmelzeEntities(["calendar.b"]), ["calendar.b"]);
});

test("die neue Reihenfolge gewinnt", () => {
  const editor = editorMit([
    { entity: "calendar.a", color: "#ff0000" },
    { entity: "calendar.b", color: "#00ff00" },
  ]);
  const neu = editor._verschmelzeEntities(["calendar.b", "calendar.a"]);
  assert.deepStrictEqual(neu.map((e) => e.entity), ["calendar.b", "calendar.a"]);
});

test("eine leere Auswahl ergibt eine leere Liste, keinen Absturz", () => {
  const editor = editorMit([{ entity: "calendar.a", color: "#ff0000" }]);
  // Das leere Feld entsteht in der Sandbox und hat deshalb einen anderen
  // Array-Prototyp als hier; `deepStrictEqual` vergleicht den mit.
  const leer = editor._verschmelzeEntities(undefined);
  assert.strictEqual(leer.length, 0);
});

/* ── Anmeldung ──────────────────────────────────────────────────────────── */

test("die Karte und ihr Editor sind angemeldet", () => {
  const angemeldet = [];
  const fenster = { customCards: [] };
  ladeKarte(["CARD_VERSION"], {
    window: fenster,
    customElements: { define(name) { angemeldet.push(name); } },
  });
  assert.ok(angemeldet.includes("busch-calendar-card"), "Karte nicht angemeldet");
  assert.ok(
    angemeldet.includes("busch-calendar-card-editor"),
    "Editor nicht angemeldet — dann bleibt der Editor im Dashboard leer"
  );
  const eintrag = fenster.customCards.find((k) => k.type === "busch-calendar-card");
  assert.ok(eintrag, "kein Eintrag im Kartenwaehler");
  assert.strictEqual(eintrag.preview, true);
});

test("die Kartenklasse verweist auf denselben Editornamen", () => {
  const erzeugt = [];
  const { BuschCalendarCard } = ladeKarte(["BuschCalendarCard"], {
    document: {
      createElement(name) {
        erzeugt.push(name);
        return { style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} };
      },
    },
  });
  BuschCalendarCard.getConfigElement();
  assert.deepStrictEqual(erzeugt, ["busch-calendar-card-editor"]);
});
