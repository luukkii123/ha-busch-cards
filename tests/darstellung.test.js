"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calMonatsGrenzen,
  calGruppiereNachTag,
  calSummeStunden,
  calEscape,
  calFormatUhrzeit,
  calFormatStunden,
  calListeHtml,
} = ladeKarte([
  "calMonatsGrenzen",
  "calGruppiereNachTag",
  "calSummeStunden",
  "calEscape",
  "calFormatUhrzeit",
  "calFormatStunden",
  "calListeHtml",
]);

const ACHT_STUNDEN = {
  start: { dateTime: "2026-08-03T08:00:00+02:00" },
  end: { dateTime: "2026-08-03T16:00:00+02:00" },
  summary: "DZ",
  uid: "a",
};

const HALBE_STUNDE = {
  start: { dateTime: "2026-08-04T08:00:00+02:00" },
  end: { dateTime: "2026-08-04T08:30:00+02:00" },
  summary: "TA",
  uid: "b",
};

const URLAUB = {
  start: { date: "2026-08-10" },
  end: { date: "2026-08-13" },
  summary: "Urlaub",
  uid: "c",
};

test("die Summe zaehlt Stunden und ganztaegige getrennt", () => {
  const s = calSummeStunden([ACHT_STUNDEN, HALBE_STUNDE, URLAUB]);
  assert.strictEqual(s.stunden, 8.5);
  assert.strictEqual(s.ganztags, 1, "der Urlaub zaehlt als ein Termin, nicht als drei Tage");
  assert.strictEqual(s.tageMitTermin, 5, "3. + 4. + drei Urlaubstage");
});

test("dieselbe uid wird nur einmal gezaehlt", () => {
  const s = calSummeStunden([ACHT_STUNDEN, ACHT_STUNDEN]);
  assert.strictEqual(s.stunden, 8);
});

test("Stunden werden mit Komma und einer Nachkommastelle gezeigt", () => {
  assert.strictEqual(calFormatStunden(168.5, "de-DE"), "168,5");
  assert.strictEqual(calFormatStunden(8, "de-DE"), "8,0");
});

test("Uhrzeiten sind zweistellig", () => {
  const d = new Date(2026, 7, 3, 8, 49);
  assert.strictEqual(calFormatUhrzeit(d, "de-DE"), "08:49");
});

test("HTML in Termintiteln wird entschaerft", () => {
  const boese = calEscape('<img src=x onerror="alert(1)">');
  assert.ok(!boese.includes("<img"), "spitze Klammern muessen ersetzt sein");
  assert.ok(boese.includes("&lt;img"));
  assert.strictEqual(calEscape('a & b "c"'), "a &amp; b &quot;c&quot;");
});

test("der Termintitel landet entschaerft in der Liste", () => {
  const boese = { ...ACHT_STUNDEN, summary: '<script>alert(1)</script>', uid: "x" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([boese], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(!html.includes("<script>"), "kein rohes script-Tag im HTML");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("ohne leere Tage stehen nur Tage mit Terminen in der Liste", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const html = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const zeilen = (html.match(/class="cal-tag[ "]/g) || []).length;
  assert.strictEqual(zeilen, 1, "nur der 3. August");
});

test("mit leeren Tagen steht jeder Tag des Monats in der Liste", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const html = calListeHtml(tage, {
    zeigeLeereTage: true, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const zeilen = (html.match(/class="cal-tag[ "]/g) || []).length;
  assert.strictEqual(zeilen, 31);
});

test("ganztaegige Termine zeigen keine Uhrzeit", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([URLAUB], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(html.includes("ganztägig"));
  assert.ok(html.includes("Urlaub"));
});

test("Beschreibung und Ort stehen im title der Zeile", () => {
  const mitOrt = { ...ACHT_STUNDEN, description: "Frühschicht", location: "Halle 2", uid: "o" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([mitOrt], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(html.includes('title="Frühschicht · Halle 2"'));
});

test("bei einem einzigen Kalender wird kein Farbpunkt gezeichnet", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const einer = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const mehrere = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: true,
  });
  assert.ok(!einer.includes("cal-punkt"));
  assert.ok(mehrere.includes("cal-punkt"));
});
