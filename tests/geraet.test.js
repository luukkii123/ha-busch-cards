"use strict";

/**
 * Reine Funktionen der Geraetekarte: Konfiguration, Vorlagenwahl,
 * Geraeteaufloesung, Entitaetenmenge, Filter, Gruppierung, Strukturstempel.
 * Spec: docs/superpowers/specs/2026-09-09-geraetekarte-design.md
 *
 * Sandbox-Falle (siehe karte.test.js): Listen aus der Karte tragen einen
 * fremden Array.prototype — kein deepStrictEqual, Vergleich ueber Strings.
 */
const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");
const { baueHass } = require("./geraet-attrappe.js");

const {
  DEV_STANDARD,
  DEV_VORLAGEN,
  devNormalisiereKonfig,
  devDomain,
  devVorlageWaehlen,
  devGeraetAufloesen,
  devUntertitel,
} = ladeKarte([
  "DEV_STANDARD",
  "DEV_VORLAGEN",
  "devNormalisiereKonfig",
  "devDomain",
  "devVorlageWaehlen",
  "devGeraetAufloesen",
  "devUntertitel",
]);

/* ── Konfiguration ─────────────────────────────────────────────────────── */

test("die Vorgaben stimmen mit Spec Abschnitt 8 ueberein", () => {
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  assert.strictEqual(k.entity, "light.decke");
  assert.strictEqual(k.title, "");
  assert.strictEqual(k.template, "auto");
  assert.strictEqual(k.labels.length, 0);
  assert.strictEqual(k.show_subtitle, true);
  assert.strictEqual(k.show_config, true);
  assert.strictEqual(k.show_diagnostic, true);
  assert.strictEqual(k.start_expanded, false);
  assert.strictEqual(k.tap_action, "expand");
  assert.strictEqual(k.hold_action, "more-info");
  assert.strictEqual(k.navigation_path, "");
});

test("gesetzte Werte bleiben, labels wird immer eine Liste", () => {
  const k = devNormalisiereKonfig({
    entity: "light.decke", template: "switch", labels: "l_energie",
    tap_action: "toggle", start_expanded: true,
  });
  assert.strictEqual(k.template, "switch");
  assert.strictEqual(JSON.stringify(k.labels), '["l_energie"]');
  assert.strictEqual(k.tap_action, "toggle");
  assert.strictEqual(k.start_expanded, true);
});

test("ohne Konfiguration: leere Entitaet, kein Absturz", () => {
  const k = devNormalisiereKonfig(undefined);
  assert.strictEqual(k.entity, "");
  assert.strictEqual(Array.isArray(k.labels), true);
});

test("ein unbekannter Aktionswert faellt auf die Vorgabe zurueck", () => {
  const k = devNormalisiereKonfig({ entity: "x.y", tap_action: "fliegen", hold_action: 7 });
  assert.strictEqual(k.tap_action, DEV_STANDARD.tap_action);
  assert.strictEqual(k.hold_action, DEV_STANDARD.hold_action);
});

/* ── Vorlagen ──────────────────────────────────────────────────────────── */

test("die Vorlagentabelle aus Spec Abschnitt 4 steht vollstaendig", () => {
  const namen = Object.keys(DEV_VORLAGEN).sort().join(",");
  assert.strictEqual(namen, "climate,cover,fan,generic,light,lock,media,switch");
  assert.strictEqual(DEV_VORLAGEN.light.features[0].type, "light-brightness");
  assert.strictEqual(DEV_VORLAGEN.climate.features.map((f) => f.type).join(","),
    "target-temperature,climate-hvac-modes");
  assert.strictEqual(DEV_VORLAGEN.cover.features.map((f) => f.type).join(","),
    "cover-open-close,cover-position");
  assert.strictEqual(DEV_VORLAGEN.fan.features[0].type, "fan-speed");
  assert.strictEqual(DEV_VORLAGEN.media.features[0].type, "media-player-volume-slider");
  assert.strictEqual(DEV_VORLAGEN.lock.features[0].type, "lock-commands");
  assert.strictEqual(DEV_VORLAGEN.switch.features[0].type, "toggle");
  assert.strictEqual(DEV_VORLAGEN.generic.features.length, 0);
});

test("auto waehlt nach der Domain der Entitaet", () => {
  assert.strictEqual(devDomain("light.decke"), "light");
  assert.strictEqual(devVorlageWaehlen("auto", "light.decke"), "light");
  assert.strictEqual(devVorlageWaehlen("auto", "climate.wohnen"), "climate");
  assert.strictEqual(devVorlageWaehlen("auto", "cover.rollo"), "cover");
  assert.strictEqual(devVorlageWaehlen("auto", "fan.luefter"), "fan");
  assert.strictEqual(devVorlageWaehlen("auto", "media_player.tv"), "media");
  assert.strictEqual(devVorlageWaehlen("auto", "lock.tuer"), "lock");
  assert.strictEqual(devVorlageWaehlen("auto", "switch.steckdose"), "switch");
  assert.strictEqual(devVorlageWaehlen("auto", "input_boolean.gast"), "switch");
  assert.strictEqual(devVorlageWaehlen("auto", "sensor.temp"), "generic");
  assert.strictEqual(devVorlageWaehlen("auto", ""), "generic");
});

test("ein gesetzter Wert erzwingt die Vorlage, ein unbekannter faellt auf generic", () => {
  assert.strictEqual(devVorlageWaehlen("switch", "light.decke"), "switch");
  assert.strictEqual(devVorlageWaehlen("light", "sensor.temp"), "light");
  assert.strictEqual(devVorlageWaehlen("regenbogen", "light.decke"), "generic");
});

/* ── Geraeteaufloesung ─────────────────────────────────────────────────── */

test("Entitaet -> Geraet -> Bereich, name_by_user schlaegt name", () => {
  const a = devGeraetAufloesen(baueHass(), "light.decke");
  assert.strictEqual(a.fehler, undefined);
  assert.strictEqual(a.geraet.id, "d1");
  assert.strictEqual(a.name, "Wohnzimmer Deckenlampe");
  assert.strictEqual(a.bereich.name, "Wohnzimmer");
  assert.strictEqual(a.platform, "shelly");
  assert.strictEqual(a.untertitel, "Shelly · Plus 1PM · Wohnzimmer");
});

test("ohne name_by_user der Registername; leere Teile fallen samt Punkt weg", () => {
  const a = devGeraetAufloesen(baueHass(), "sensor.anderes");
  assert.strictEqual(a.name, "Aqara Sensor");
  assert.strictEqual(a.untertitel, "");
  assert.strictEqual(devUntertitel({ manufacturer: "Aqara", model: null }, null), "Aqara");
  assert.strictEqual(devUntertitel({ manufacturer: null, model: "T1" }, { name: "Bad" }), "T1 · Bad");
});

test("die vier Fehlerfaelle aus Spec Abschnitt 9", () => {
  const hass = baueHass();
  assert.strictEqual(devGeraetAufloesen(hass, "").fehler, "keineEntitaet");
  assert.strictEqual(devGeraetAufloesen({ states: {} }, "light.decke").fehler, "altesHa");
  assert.strictEqual(devGeraetAufloesen(hass, "light.gibtsnicht").fehler, "nichtRegistriert");
  assert.strictEqual(devGeraetAufloesen(hass, "sensor.ohne_geraet").fehler, "keinGeraet");
});

test("ein device_id ohne Geraet im Register zaehlt als keinGeraet", () => {
  const hass = baueHass();
  hass.entities["light.decke"].device_id = "d_weg";
  assert.strictEqual(devGeraetAufloesen(hass, "light.decke").fehler, "keinGeraet");
});
