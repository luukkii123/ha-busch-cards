"use strict";

/**
 * Die Woerterbuecher aller drei Karten — Regel 3 aus `docs/ui-regeln.md`.
 *
 * Was hier belegt wird: Zu JEDEM Schemafeld gibt es ein Label und einen Helper
 * in BEIDEN Sprachen, die Labels sind kurz und punktlos, die Helper sind ganze
 * Saetze und nennen eine Vorgabe — und die Sprachwahl haengt wirklich an
 * `hass.locale.language` bzw., ohne `hass`, an `navigator.language`.
 *
 * Was hier NICHT belegt wird: dass Home Assistants echtes `ha-form` die Helper
 * auch anzeigt. Das entscheidet der Blick ins Frontend.
 *
 * `scripts/ui-regeln-pruefen.py` misst dieselbe Form am Dateitext. Beide
 * Wege zusammen sind mehr als jeder allein: der Pruefer sieht die Datei, wie
 * sie ausgeliefert wird, dieser Test die Werte, wie sie im Browser entstehen.
 */

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const geladen = ladeKarte([
  "SCHEMA_BUSCH_SCHEDULE_CARD",
  "TEXTE_BUSCH_SCHEDULE_CARD",
  "SCHEMA_BUSCH_CALENDAR_CARD",
  "TEXTE_BUSCH_CALENDAR_CARD",
  "SCHEMA_BUSCH_MAP_CARD",
  "TEXTE_BUSCH_MAP_CARD",
  "buschSprache",
  "buschTexte",
  "buschSchemaMitTexten",
  "buschFuellen",
]);

/** Die drei Paare, so wie `ui-regeln-pruefen.py` sie erwartet. */
const KARTEN = [
  ["busch-schedule-card", geladen.SCHEMA_BUSCH_SCHEDULE_CARD, geladen.TEXTE_BUSCH_SCHEDULE_CARD],
  ["busch-calendar-card", geladen.SCHEMA_BUSCH_CALENDAR_CARD, geladen.TEXTE_BUSCH_CALENDAR_CARD],
  ["busch-map-card", geladen.SCHEMA_BUSCH_MAP_CARD, geladen.TEXTE_BUSCH_MAP_CARD],
];

/** Blattnamen eines `ha-form`-Schemas, `type: "grid"` eingeschlossen. */
function schemaNamen(schema) {
  const namen = [];
  for (const eintrag of schema) {
    if (Array.isArray(eintrag.schema)) namen.push(...schemaNamen(eintrag.schema));
    else if (eintrag.name) namen.push(eintrag.name);
  }
  return namen;
}

for (const [tag, schema, texte] of KARTEN) {
  test(`${tag}: jedes Schemafeld hat Label und Helper in beiden Sprachen`, () => {
    const fehlend = [];
    for (const sprache of ["de", "en"]) {
      for (const name of schemaNamen(schema)) {
        if (!texte[sprache].labels[name]) fehlend.push(`${sprache}.labels.${name}`);
        if (!texte[sprache].helpers[name]) fehlend.push(`${sprache}.helpers.${name}`);
      }
    }
    assert.deepStrictEqual(fehlend, []);
  });

  test(`${tag}: kein Label ohne Schemafeld`, () => {
    const namen = schemaNamen(schema);
    for (const sprache of ["de", "en"]) {
      for (const name of Object.keys(texte[sprache].labels)) {
        assert.ok(namen.includes(name), `${sprache}: Label ohne Feld: ${name}`);
      }
    }
  });

  test(`${tag}: Labels sind kurz, in Satzschreibweise und ohne Punkt`, () => {
    for (const sprache of ["de", "en"]) {
      for (const [name, text] of Object.entries(texte[sprache].labels)) {
        assert.doesNotMatch(text, /\.$/, `${sprache}.${name} endet auf einen Punkt`);
        assert.doesNotMatch(text, /[()]/, `${sprache}.${name} enthaelt Klammern`);
        assert.ok(
          text.split(/\s+/).length <= 4,
          `${sprache}.${name} hat mehr als vier Woerter: ${text}`
        );
      }
    }
  });

  test(`${tag}: jeder Helper ist ein ganzer Satz und nennt die Vorgabe`, () => {
    for (const sprache of ["de", "en"]) {
      for (const [name, text] of Object.entries(texte[sprache].helpers)) {
        assert.match(text, /\.$/, `${sprache}.${name} endet nicht mit Punkt`);
        assert.match(
          text,
          sprache === "de" ? /Vorgabe|Pflichtfeld/ : /Default|Required/,
          `${sprache}.${name} nennt weder Vorgabe noch Pflicht`
        );
      }
    }
  });

  test(`${tag}: name und description gibt es in beiden Sprachen`, () => {
    for (const sprache of ["de", "en"]) {
      assert.ok(texte[sprache].name, `${sprache}.name fehlt`);
      assert.ok(texte[sprache].description, `${sprache}.description fehlt`);
    }
    assert.notStrictEqual(
      texte.de.description,
      texte.en.description,
      "beide Sprachen tragen denselben Satz — dann ist eine davon nicht uebersetzt"
    );
  });
}

/* ── Die Sprachwahl selbst ──────────────────────────────────────────────── */

test("hass.locale.language entscheidet", () => {
  assert.strictEqual(geladen.buschSprache({ locale: { language: "de" } }), "de");
  assert.strictEqual(geladen.buschSprache({ locale: { language: "de-AT" } }), "de");
  assert.strictEqual(geladen.buschSprache({ locale: { language: "en" } }), "en");
  assert.strictEqual(geladen.buschSprache({ locale: { language: "fr" } }), "en");
});

test("die aeltere Schreibweise hass.language greift ebenfalls", () => {
  assert.strictEqual(geladen.buschSprache({ language: "de" }), "de");
});

test("ohne hass und ohne navigator bleibt es bei Englisch", () => {
  // In der Sandbox gibt es kein `navigator` — genau der Fall, gegen den die
  // Abfrage mit `typeof` abgesichert ist. Ohne sie wuerde das Laden der
  // Datei mit einem ReferenceError abbrechen, und zwar beim Kartenwaehler.
  assert.strictEqual(geladen.buschSprache(null), "en");
});

test("buschTexte liefert den passenden Abschnitt", () => {
  const de = geladen.buschTexte(geladen.TEXTE_BUSCH_SCHEDULE_CARD, { locale: { language: "de" } });
  const en = geladen.buschTexte(geladen.TEXTE_BUSCH_SCHEDULE_CARD, { locale: { language: "en" } });
  assert.strictEqual(de.labels.entity, "Zeitplan");
  assert.strictEqual(en.labels.entity, "Schedule");
});

test("die Auswahloptionen bekommen uebersetzte Beschriftungen", () => {
  for (const sprache of [
    { locale: { language: "de" } },
    { locale: { language: "en" } },
  ]) {
    const texte = geladen.buschTexte(geladen.TEXTE_BUSCH_SCHEDULE_CARD, sprache);
    const schema = geladen.buschSchemaMitTexten(geladen.SCHEMA_BUSCH_SCHEDULE_CARD, texte);
    const feld = schema.find((e) => e.name === "first_day");
    const beschriftungen = feld.selector.select.options.map((o) => o.label);
    assert.strictEqual(beschriftungen.length, 3);
    for (const b of beschriftungen) assert.ok(b && b.length > 2, `leere Option: ${b}`);
    // Und die Werte bleiben, was sie waren — sonst schriebe der Editor Muell
    // in die Konfiguration.
    // KEIN deepStrictEqual: das Feld entsteht in der Sandbox und hat deshalb
    // einen anderen Array-Prototyp als hier (siehe tests/laden.js).
    assert.strictEqual(
      feld.selector.select.options.map((o) => o.value).join(","),
      "auto,monday,sunday"
    );
  }
});

test("eine Vorlage ohne eigenen Text behaelt ihren Eigennamen", () => {
  const texte = geladen.buschTexte(geladen.TEXTE_BUSCH_MAP_CARD, { locale: { language: "en" } });
  const schema = geladen.buschSchemaMitTexten(geladen.SCHEMA_BUSCH_MAP_CARD, texte);
  const optionen = schema.find((e) => e.name === "map_style").selector.select.options;
  const nach = (wert) => optionen.find((o) => o.value === wert).label;
  assert.strictEqual(nach("osm"), "OpenStreetMap", "Eigenname, in beiden Sprachen gleich");
  assert.strictEqual(nach("ha"), "Home Assistant default", "hier greift das Woerterbuch");
  assert.strictEqual(nach("custom"), "Own URL");
});

test("buschFuellen ersetzt Platzhalter", () => {
  assert.strictEqual(geladen.buschFuellen("{n} Tage", { n: 3 }), "3 Tage");
  assert.strictEqual(geladen.buschFuellen("ohne", {}), "ohne");
  assert.strictEqual(geladen.buschFuellen("ohne", undefined), "ohne");
});

/* ── Der Kartenwaehler ──────────────────────────────────────────────────── */

test("der Kartenwaehler-Eintrag folgt navigator.language", () => {
  for (const [sprache, erwartet] of [["de-DE", "de"], ["en-GB", "en"]]) {
    const fenster = { customCards: [] };
    ladeKarte(["CARD_VERSION"], {
      window: fenster,
      navigator: { language: sprache },
    });
    for (const [tag, , texte] of KARTEN) {
      const eintrag = fenster.customCards.find((k) => k.type === tag);
      assert.ok(eintrag, `kein Eintrag fuer ${tag}`);
      assert.strictEqual(eintrag.name, texte[erwartet].name, `${tag}: falsche Sprache`);
      assert.strictEqual(eintrag.description, texte[erwartet].description);
      assert.strictEqual(eintrag.preview, true);
      assert.ok(eintrag.documentationURL, `${tag}: keine documentationURL`);
    }
  }
});
