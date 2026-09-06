"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { topLevelNamen } = require("./laden.js");

test("kein Top-Level-Name ist doppelt vergeben", () => {
  const namen = topLevelNamen();
  const gesehen = new Set();
  const doppelt = [];
  for (const name of namen) {
    if (gesehen.has(name)) doppelt.push(name);
    gesehen.add(name);
  }
  assert.deepStrictEqual(
    doppelt,
    [],
    `Doppelte Top-Level-Namen: ${doppelt.join(", ")}. ` +
      "Die zweite Deklaration gewinnt still und bricht die andere Karte."
  );
});

test("die Datei laesst sich in der Sandbox ausfuehren", () => {
  const { ladeKarte } = require("./laden.js");
  const werte = ladeKarte(["CARD_VERSION"]);
  assert.match(werte.CARD_VERSION, /^\d+\.\d+\.\d+$/);
});

/* --------------------------------------------------------------------------
 * Der Waechter selbst — gemessen, nicht geglaubt
 *
 * Die Regex oben sieht nur Deklarationen am Zeilenanfang. Haengt man
 * `  function clamp(a,b,c){return 999}` mit zwei Leerzeichen ans Dateiende,
 * gewinnt diese zweite Deklaration still, `clamp(5,0,1)` liefert danach 999 —
 * und der Waechter bleibt gruen. Eine Alarmanlage, die sich mit zwei
 * Leerzeichen aushebeln laesst, ist keine.
 *
 * Deshalb fragt der Waechter jetzt den Parser von Node selbst. Die drei
 * Pruefungen hier belegen beide Haelften: er findet die eingerueckte
 * Doppeldeklaration UND er schlaegt nicht bei jeder eingerueckten
 * Deklaration innerhalb einer Funktion oder Klasse an.
 * ------------------------------------------------------------------------ */

const { modulFehler, quelle } = require("./laden.js");

test("die ausgelieferte Datei ist als Modul fehlerfrei", () => {
  assert.strictEqual(modulFehler(), null, "so laedt Home Assistant sie");
});

test("eine EINGERUECKTE Doppeldeklaration am Dateiende wird gefunden", () => {
  const verseucht = quelle() + "\n  function clamp(a, b, c) { return 999; }\n";
  const befund = modulFehler(verseucht);
  assert.ok(befund, "der Waechter muss hier anschlagen");
  assert.match(befund, /clamp/, "und den Namen nennen, um den es geht");
});

test("eingerueckte Deklarationen INNERHALB von Funktion und Klasse sind erlaubt", () => {
  const harmlos =
    quelle() +
    "\nfunction calProbeFuerDenWaechter() {\n" +
    "  const clamp = 1;\n" +
    "  function calGruppiereNachTag() { return clamp; }\n" +
    "  class CalInnen { clamp() { return 2; } }\n" +
    "  return calGruppiereNachTag() + new CalInnen().clamp();\n" +
    "}\n";
  assert.strictEqual(
    modulFehler(harmlos),
    null,
    "eigene Gueltigkeitsbereiche duerfen jeden Namen tragen"
  );
});
