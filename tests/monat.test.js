"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const { calMonatsGrenzen, calMonatsName } = ladeKarte([
  "calMonatsGrenzen",
  "calMonatsName",
]);

test("Versatz null liefert den laufenden Monat vollstaendig", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 8, 6), 0);
  assert.strictEqual(start.getFullYear(), 2026);
  assert.strictEqual(start.getMonth(), 8);
  assert.strictEqual(start.getDate(), 1);
  assert.strictEqual(start.getHours(), 0);
  assert.strictEqual(ende.getDate(), 30, "September hat 30 Tage");
  assert.strictEqual(ende.getHours(), 23);
  assert.strictEqual(ende.getMinutes(), 59);
});

test("Versatz minus eins am 6. Oktober liefert den ganzen September", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 9, 6), -1);
  assert.strictEqual(start.getMonth(), 8, "September");
  assert.strictEqual(start.getDate(), 1);
  assert.strictEqual(ende.getMonth(), 8);
  assert.strictEqual(ende.getDate(), 30);
});

test("Versatz minus eins im Januar springt ins Vorjahr", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 0, 15), -1);
  assert.strictEqual(start.getFullYear(), 2025);
  assert.strictEqual(start.getMonth(), 11, "Dezember");
  assert.strictEqual(ende.getDate(), 31);
});

test("Versatz plus eins im Dezember springt ins Folgejahr", () => {
  const { start } = calMonatsGrenzen(new Date(2026, 11, 20), 1);
  assert.strictEqual(start.getFullYear(), 2027);
  assert.strictEqual(start.getMonth(), 0, "Januar");
});

test("Februar im Schaltjahr hat 29 Tage", () => {
  const { ende } = calMonatsGrenzen(new Date(2028, 1, 10), 0);
  assert.strictEqual(ende.getDate(), 29);
});

test("Februar im Normaljahr hat 28 Tage", () => {
  const { ende } = calMonatsGrenzen(new Date(2026, 1, 10), 0);
  assert.strictEqual(ende.getDate(), 28);
});

test("der Monatsname nennt Monat und Jahr", () => {
  assert.strictEqual(calMonatsName(new Date(2026, 8, 1), "de-DE"), "September 2026");
});
