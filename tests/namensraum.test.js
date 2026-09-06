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
