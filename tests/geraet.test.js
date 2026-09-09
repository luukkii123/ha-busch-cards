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
  DEV_SENSOR_DOMAINS,
  devEntitaetenDesGeraets,
  devLabelFilter,
  devGruppe,
  devAnzeigename,
  devKurzname,
  devGruppieren,
  devStrukturStempel,
  devDomainName,
  TEXTE_BUSCH_DEVICE_CARD,
  BuschDeviceCard,
} = ladeKarte([
  "DEV_STANDARD",
  "DEV_VORLAGEN",
  "devNormalisiereKonfig",
  "devDomain",
  "devVorlageWaehlen",
  "devGeraetAufloesen",
  "devUntertitel",
  "DEV_SENSOR_DOMAINS",
  "devEntitaetenDesGeraets",
  "devLabelFilter",
  "devGruppe",
  "devAnzeigename",
  "devKurzname",
  "devGruppieren",
  "devStrukturStempel",
  "devDomainName",
  "TEXTE_BUSCH_DEVICE_CARD",
  "BuschDeviceCard",
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

/* ── Entitaetenmenge ───────────────────────────────────────────────────── */

test("alle Entitaeten desselben Geraets, ohne hidden, ohne Hauptentitaet", () => {
  const ids = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke").map((e) => e.entity_id).sort();
  assert.strictEqual(ids.join(","),
    "binary_sensor.decke_ueberhitzt,event.decke_taster,sensor.decke_energie," +
    "sensor.decke_leistung,sensor.decke_rssi,switch.decke_kindersicherung,update.decke_firmware");
});

test("Label-Filter: Oder-Verknuepfung, leer heisst alle", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  assert.strictEqual(devLabelFilter(alle, []).length, alle.length);
  const energie = devLabelFilter(alle, ["l_energie"]).map((e) => e.entity_id).sort().join(",");
  assert.strictEqual(energie, "sensor.decke_energie,sensor.decke_leistung");
  const beide = devLabelFilter(alle, ["l_energie", "l_wichtig"]).map((e) => e.entity_id).sort().join(",");
  assert.strictEqual(beide, "sensor.decke_energie,sensor.decke_leistung");
  assert.strictEqual(devLabelFilter(alle, ["l_gibtsnicht"]).length, 0);
});

/* ── Gruppierung ───────────────────────────────────────────────────────── */

test("die Sensorliste ist HAs SENSOR_ENTITIES plus event", () => {
  assert.strictEqual(DEV_SENSOR_DOMAINS.slice().sort().join(","),
    "binary_sensor,calendar,camera,device_tracker,event,image,sensor,weather");
});

test("entity_category gewinnt, sonst entscheidet die Domain", () => {
  const h = baueHass();
  assert.strictEqual(devGruppe(h.entities["sensor.decke_rssi"]), "diagnostic");
  assert.strictEqual(devGruppe(h.entities["update.decke_firmware"]), "config");
  assert.strictEqual(devGruppe(h.entities["switch.decke_kindersicherung"]), "config");
  assert.strictEqual(devGruppe(h.entities["sensor.decke_leistung"]), "sensor");
  assert.strictEqual(devGruppe(h.entities["event.decke_taster"]), "sensor");
  assert.strictEqual(devGruppe(h.entities["binary_sensor.decke_ueberhitzt"]), "sensor");
  assert.strictEqual(devGruppe({ entity_id: "switch.x" }), "control");
  assert.strictEqual(devGruppe({ entity_id: "notify.x" }), "control");
});

test("Anzeigename: Registername, sonst friendly_name, sonst die ID; Kurzname ohne Geraetepraefix", () => {
  const h = baueHass();
  assert.strictEqual(devAnzeigename(h, h.entities["sensor.decke_leistung"]), "Wohnzimmer Deckenlampe Leistung");
  h.entities["sensor.decke_leistung"].name = "Verbrauch";
  assert.strictEqual(devAnzeigename(h, h.entities["sensor.decke_leistung"]), "Verbrauch");
  assert.strictEqual(devAnzeigename(h, { entity_id: "sensor.fremd" }), "sensor.fremd");
  assert.strictEqual(devKurzname("Wohnzimmer Deckenlampe Leistung", "Wohnzimmer Deckenlampe"), "Leistung");
  assert.strictEqual(devKurzname("Leistung", "Wohnzimmer Deckenlampe"), "Leistung");
  // Ohne Rueckfall bleibt es beim alten Verhalten.
  assert.strictEqual(devKurzname("Wohnzimmer Deckenlampe", "Wohnzimmer Deckenlampe"), "Wohnzimmer Deckenlampe");
});

test("vier Gruppen in fester Reihenfolge, leere fehlen, innen nach Name sortiert", () => {
  const h = baueHass();
  const konfig = devNormalisiereKonfig({ entity: "light.decke" });
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const gruppen = devGruppieren(h, alle, konfig);
  assert.strictEqual(gruppen.map((g) => g.gruppe).join(","), "sensor,config,diagnostic");
  assert.strictEqual(gruppen[0].ids.join(","),
    "sensor.decke_energie,sensor.decke_leistung,event.decke_taster,binary_sensor.decke_ueberhitzt");
  assert.strictEqual(gruppen[1].ids.join(","), "update.decke_firmware,switch.decke_kindersicherung");
  assert.strictEqual(gruppen[2].ids.join(","), "sensor.decke_rssi");
});

test("show_config / show_diagnostic blenden ihre Gruppe ganz aus", () => {
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const k = devNormalisiereKonfig({ entity: "light.decke", show_config: false, show_diagnostic: false });
  assert.strictEqual(devGruppieren(h, alle, k).map((g) => g.gruppe).join(","), "sensor");
});

/* ── Strukturstempel (Spec Abschnitt 7) ────────────────────────────────── */

test("gleiche Struktur ergibt denselben Stempel, ein Zustandswechsel aendert nichts", () => {
  const h = baueHass();
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  const g1 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  h.states["light.decke"].state = "off";
  const g2 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.strictEqual(devStrukturStempel("d1", "light", g1, k), devStrukturStempel("d1", "light", g2, k));
});

test("eine neue Entitaet, eine andere Vorlage oder Konfiguration aendern den Stempel", () => {
  const h = baueHass();
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  const g1 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  const s1 = devStrukturStempel("d1", "light", g1, k);
  h.entities["sensor.decke_neu"] = { entity_id: "sensor.decke_neu", device_id: "d1", labels: [] };
  const g2 = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.notStrictEqual(devStrukturStempel("d1", "light", g2, k), s1);
  assert.notStrictEqual(devStrukturStempel("d1", "switch", g1, k), s1);
  const k2 = devNormalisiereKonfig({ entity: "light.decke", show_subtitle: false });
  assert.notStrictEqual(devStrukturStempel("d1", "light", g1, k2), s1);
});

/* ── Kartenklasse: Vorgabe fuer den Kartenwaehler ──────────────────────── */

test("getStubConfig nimmt die erste Entitaet, die zu einem Geraet gehoert", () => {
  const h = baueHass();
  const stub = BuschDeviceCard.getStubConfig(h, ["sensor.ohne_geraet", "sensor.decke_leistung", "light.decke"]);
  assert.strictEqual(stub.type, "custom:busch-device-card");
  assert.strictEqual(stub.entity, "sensor.decke_leistung");
});

test("getStubConfig ohne Entitaetenliste sucht in hass.states; ohne alles bleibt entity leer", () => {
  const h = baueHass();
  assert.ok(h.entities[BuschDeviceCard.getStubConfig(h).entity].device_id);
  assert.strictEqual(BuschDeviceCard.getStubConfig(undefined).entity, "");
});

/* ── Entitaet ohne eigenen Namen (Befund vom 10.09.2026 am echten Geraet) ── */

test("wiederholt der Name nur das Geraet, gewinnt der Rueckfall", () => {
  const g = "Wohnzimmer Deckenlampe";
  assert.strictEqual(devKurzname(g, g, "Firmware"), "Firmware");
  assert.strictEqual(devKurzname("", g, "Firmware"), "Firmware");
  assert.strictEqual(devKurzname("  ", g, "Firmware"), "Firmware");
  // Ein echter eigener Name schlaegt den Rueckfall weiterhin.
  assert.strictEqual(devKurzname(g + " Leistung", g, "Messwert"), "Leistung");
  assert.strictEqual(devKurzname("Verbrauch", g, "Messwert"), "Verbrauch");
});

test("der Rueckfall kommt aus dem Woerterbuch, sonst ist es die Domain", () => {
  const t = TEXTE_BUSCH_DEVICE_CARD.de.texte;
  assert.strictEqual(devDomainName(t, "update.x"), "Firmware");
  assert.strictEqual(devDomainName(t, "light.x"), "Licht");
  assert.strictEqual(devDomainName(t, "sensor.x"), "Messwert");
  assert.strictEqual(devDomainName(TEXTE_BUSCH_DEVICE_CARD.en.texte, "update.x"), "Firmware");
  assert.strictEqual(devDomainName(TEXTE_BUSCH_DEVICE_CARD.en.texte, "light.x"), "Light");
  assert.strictEqual(devDomainName(t, "gibtsnicht.x"), "gibtsnicht");
  assert.strictEqual(devDomainName(undefined, "light.x"), "light");
});

test("die Firmware-Zeile des Geraets heisst nicht mehr wie das Geraet", () => {
  const h = baueHass();
  const t = TEXTE_BUSCH_DEVICE_CARD.de.texte;
  const eintrag = h.entities["update.decke_firmware"];
  const voll = devAnzeigename(h, eintrag);
  assert.strictEqual(voll, "Wohnzimmer Deckenlampe", "die Attrappe bildet den echten Fall ab");
  assert.strictEqual(devKurzname(voll, "Wohnzimmer Deckenlampe", devDomainName(t, eintrag.entity_id)), "Firmware");
});
