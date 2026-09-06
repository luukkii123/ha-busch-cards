"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calMonatsGrenzen,
  calIstGanztags,
  calStartDatum,
  calEndDatum,
  calTagesSchluessel,
  calGruppiereNachTag,
} = ladeKarte([
  "calMonatsGrenzen",
  "calIstGanztags",
  "calStartDatum",
  "calEndDatum",
  "calTagesSchluessel",
  "calGruppiereNachTag",
]);

// Echte Form aus calendar.arbeitszeiten, August 2026.
const ZEITTERMIN = {
  start: { dateTime: "2026-08-03T08:49:13+02:00" },
  end: { dateTime: "2026-08-03T16:15:08+02:00" },
  summary: "DZ",
  description: "",
  location: null,
  uid: "4ab16f20-8f7e-11f1-8f38-e45f0129325d",
};

// Ganztaegig: Datum statt Zeitstempel, Ende ist AUSSCHLIESSEND.
const GANZTAGS_EIN_TAG = {
  start: { date: "2026-08-04" },
  end: { date: "2026-08-05" },
  summary: "Feiertag",
  uid: "ganztags-1",
};

const GANZTAGS_DREI_TAGE = {
  start: { date: "2026-08-10" },
  end: { date: "2026-08-13" },
  summary: "Urlaub",
  uid: "ganztags-3",
};

test("zeitgebundene und ganztaegige Termine werden unterschieden", () => {
  assert.strictEqual(calIstGanztags(ZEITTERMIN), false);
  assert.strictEqual(calIstGanztags(GANZTAGS_EIN_TAG), true);
});

test("ein ganztaegiges Datum wird als lokaler Tag gelesen, nicht als UTC", () => {
  const d = calStartDatum(GANZTAGS_EIN_TAG);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 7, "August");
  assert.strictEqual(d.getDate(), 4, "nicht der 3. — new Date('2026-08-04') waere UTC");
  assert.strictEqual(d.getHours(), 0);
});

test("das ausschliessende Ende eines Ganztagstermins wird zurueckgesetzt", () => {
  const e = calEndDatum(GANZTAGS_EIN_TAG);
  assert.strictEqual(e.getDate(), 4, "ein eintaegiger Termin endet an seinem eigenen Tag");
});

test("der Tagesschluessel ist stabil und nullgepolstert", () => {
  assert.strictEqual(calTagesSchluessel(new Date(2026, 8, 1)), "2026-09-01");
  assert.strictEqual(calTagesSchluessel(new Date(2026, 11, 31)), "2026-12-31");
});

test("jeder Tag des Monats bekommt einen Eintrag, auch die leeren", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ZEITTERMIN], start, ende);
  assert.strictEqual(tage.length, 31, "August hat 31 Tage");
  assert.strictEqual(tage[0].tagNummer, 1);
  assert.strictEqual(tage[30].tagNummer, 31);
  assert.strictEqual(tage[2].termine.length, 1, "der 3. hat den Termin");
  assert.strictEqual(tage[0].termine.length, 0, "der 1. ist leer");
});

test("ein mehrtaegiger Ganztagstermin erscheint an jedem betroffenen Tag", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([GANZTAGS_DREI_TAGE], start, ende);
  assert.strictEqual(tage[9].termine.length, 1, "10. August");
  assert.strictEqual(tage[10].termine.length, 1, "11. August");
  assert.strictEqual(tage[11].termine.length, 1, "12. August");
  assert.strictEqual(tage[12].termine.length, 0, "13. August NICHT, Ende ist ausschliessend");
});

test("Wochenenden sind gekennzeichnet", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([], start, ende);
  // 1. August 2026 ist ein Samstag.
  assert.strictEqual(tage[0].istWochenende, true, "Sa 01.08.");
  assert.strictEqual(tage[1].istWochenende, true, "So 02.08.");
  assert.strictEqual(tage[2].istWochenende, false, "Mo 03.08.");
});

test("Termine eines Tages stehen in zeitlicher Reihenfolge", () => {
  const spaet = { ...ZEITTERMIN, start: { dateTime: "2026-08-03T18:00:00+02:00" },
                  end: { dateTime: "2026-08-03T19:00:00+02:00" }, uid: "spaet" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([spaet, ZEITTERMIN], start, ende);
  assert.strictEqual(tage[2].termine[0].uid, ZEITTERMIN.uid, "08:49 vor 18:00");
  assert.strictEqual(tage[2].termine[1].uid, "spaet");
});

test("ganztaegige Termine stehen vor den zeitgebundenen desselben Tages", () => {
  const ganztagsAm3 = { start: { date: "2026-08-03" }, end: { date: "2026-08-04" },
                        summary: "Feiertag", uid: "g3" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ZEITTERMIN, ganztagsAm3], start, ende);
  assert.strictEqual(tage[2].termine[0].uid, "g3");
});

test("Termine ausserhalb des Monats werden verworfen", () => {
  const juli = { start: { dateTime: "2026-07-30T08:00:00+02:00" },
                 end: { dateTime: "2026-07-30T09:00:00+02:00" }, uid: "juli" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([juli], start, ende);
  const summe = tage.reduce((n, t) => n + t.termine.length, 0);
  assert.strictEqual(summe, 0);
});
