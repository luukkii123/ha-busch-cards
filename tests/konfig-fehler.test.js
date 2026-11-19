"use strict";

// M75 (#1321, F12): configuration errors come from the dictionaries (de + en, language from hass or
// navigator.language), no German literal in `throw new Error(...)` outside the synced shared blocks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const DEUTSCH = /[äöüÄÖÜß]|\b(?:fehlt|fehlen|muss|müssen|nicht|ungültig|ungueltig|erforderlich|benötigt|liess|ließ|Konfiguration|Regel|Regeln|Liste|bitte|kein|keine)\b/;

function load(language) {
  const env = kit.createEnvironment({ language });
  const { exposed } = kit.loadScript(BUNDLE, {
    globals: env,
    expose: ["BuschScheduleCard", "BuschMapCard", "devNormalisiereKonfig", "buschSmartConfig",
      "TEXTE_BUSCH_SCHEDULE_CARD", "TEXTE_BUSCH_MAP_CARD", "TEXTE_BUSCH_DEVICE_CARD", "TEXTE_BUSCH_SMART_ENTITIES"],
  });
  return exposed;
}

const message = (fn) => { try { fn(); } catch (e) { return e.message; } assert.fail("expected a throw"); };

test("M75: no German literal in throw new Error outside the shared blocks", () => {
  const own = SOURCE.replace(/\/\* BEGIN BUSCH SHARED (UI|CORE)[\s\S]*?\/\* END BUSCH SHARED \1 \*\//g, "")
    .replace(/\/\* BEGIN VENDOR leaflet[\s\S]*?\/\* END VENDOR leaflet \*\//, "");
  const found = [];
  for (const m of own.matchAll(/throw new Error\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
    if (DEUTSCH.test(m[2])) found.push(m[2]);
  }
  assert.deepEqual(found, []);
});

for (const language of ["de", "en"]) {
  test(`M75: schedule and map configuration errors follow the dictionary (${language})`, () => {
    const k = load(language);
    const ts = k.TEXTE_BUSCH_SCHEDULE_CARD[language].texte, tm = k.TEXTE_BUSCH_MAP_CARD[language].texte;
    assert.equal(message(() => new k.BuschScheduleCard().setConfig({})), ts.fehlt_entity);
    assert.equal(message(() => new k.BuschScheduleCard().setConfig({ entity: "light.x" })), ts.falsche_entity);
    assert.equal(message(() => new k.BuschMapCard().setConfig(null)), tm.fehlt_konfig);
  });

  test(`M75: device filter and smart item errors follow the dictionary (${language})`, () => {
    const k = load(language);
    const td = k.TEXTE_BUSCH_DEVICE_CARD[language].texte, tsm = k.TEXTE_BUSCH_SMART_ENTITIES[language].texte;
    assert.equal(message(() => k.devNormalisiereKonfig({ device_id: "d", filter: { include: {} } })), td.filter_liste);
    assert.equal(message(() => k.devNormalisiereKonfig({ device_id: "d", filter: { include: [{ unknown: 1 }] } })),
      td.filter_unbekannt.replace("{key}", "unknown"));
    assert.equal(message(() => k.buschSmartConfig({ entities: [], item: [], item_param: "entity" })), tsm.item_karte);
    if (language === "en") {
      for (const t of [td.filter_struktur, td.filter_regel, td.filter_unbekannt, td.filter_undoder, td.filter_attribute,
        td.filter_liste, tsm.item_karte, tsm.item_pfad, tsm.item_pfad_skalar]) assert.doesNotMatch(t, DEUTSCH);
    }
  });
}
