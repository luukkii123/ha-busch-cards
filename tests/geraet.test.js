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
  DEV_GRUPPEN_WERTE,
  DEV_HA_AKTIONEN,
  DEV_ARTEN,
  devAktionNormalisieren,
  devMigriereKonfig,
  devArtVon,
  devGruppenSichtbar,
  devGruppeOffen,
  devKontext,
  devPlatzhalterErsetzen,
  devZielFuellen,
  devFuehreAus,
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
  "DEV_GRUPPEN_WERTE",
  "DEV_HA_AKTIONEN",
  "DEV_ARTEN",
  "devAktionNormalisieren",
  "devMigriereKonfig",
  "devArtVon",
  "devGruppenSichtbar",
  "devGruppeOffen",
  "devKontext",
  "devPlatzhalterErsetzen",
  "devZielFuellen",
  "devFuehreAus",
], {
  // `devFuehreAus` feuert `hass-more-info` als CustomEvent. Die Sandbox aus
  // `laden.js` bringt keins mit — hier eine Attrappe, die Name und Nutzlast
  // festhaelt, damit der Test sie lesen kann.
  CustomEvent: class { constructor(name, init) { this.type = name; this.detail = init && init.detail; } },
});

/* ── Konfiguration ─────────────────────────────────────────────────────── */

test("die Vorgaben stimmen mit Spec Abschnitt 8 ueberein", () => {
  const k = devNormalisiereKonfig({ entity: "light.decke" });
  assert.strictEqual(k.entity, "light.decke");
  assert.strictEqual(k.title, "");
  assert.strictEqual(k.template, "auto");
  assert.strictEqual(k.labels.length, 0);
  assert.strictEqual(k.show_subtitle, true);
  assert.strictEqual(JSON.stringify(k.groups), '["control","sensor","config","diagnostic"]');
  assert.strictEqual(JSON.stringify(k.groups_open), '["control"]');
  assert.strictEqual(k.start_expanded, false);
  assert.strictEqual(k.tap_action.action, "expand");
  assert.strictEqual(k.hold_action.action, "more-info");
  assert.strictEqual(k.row_tap_action.action, "more-info");
  assert.strictEqual(k.row_hold_action.action, "none");
});

test("gesetzte Werte bleiben, labels wird immer eine Liste", () => {
  const k = devNormalisiereKonfig({
    entity: "light.decke", template: "switch", labels: "l_energie",
    tap_action: { action: "toggle" }, start_expanded: true,
  });
  assert.strictEqual(k.template, "switch");
  assert.strictEqual(JSON.stringify(k.labels), '["l_energie"]');
  assert.strictEqual(k.tap_action.action, "toggle");
  assert.strictEqual(k.start_expanded, true);
});

test("ohne Konfiguration: leere Entitaet, kein Absturz", () => {
  const k = devNormalisiereKonfig(undefined);
  assert.strictEqual(k.entity, "");
  assert.strictEqual(Array.isArray(k.labels), true);
});

test("eine unbekannte Aktion bleibt stehen und tut spaeter nichts", () => {
  // Seit 0.11.0 setzt die Normalisierung eine unbekannte Aktion NICHT mehr
  // zurueck. `devFuehreAus` ignoriert sie schlicht (Spec 0.11.0, 3.3).
  const k = devNormalisiereKonfig({ entity: "x.y", tap_action: { action: "fliegen" }, hold_action: 7 });
  assert.strictEqual(k.tap_action.action, "fliegen");
  assert.strictEqual(k.hold_action.action, DEV_STANDARD.hold_action.action,
    "ein Wert, der gar keine Aktion ist, faellt auf die Vorgabe");
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

test("groups steuert, welche Gruppen ueberhaupt erscheinen", () => {
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const k = devNormalisiereKonfig({ entity: "light.decke", groups: ["sensor"] });
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

/* ── Aktionsform und Migration (Spec 0.11.0, Abschnitt 3) ──────────────── */

test("eine Zeichenkette wird zur Objektform, ein Objekt bleibt", () => {
  assert.strictEqual(devAktionNormalisieren("expand").action, "expand");
  assert.strictEqual(devAktionNormalisieren({ action: "toggle" }).action, "toggle");
  assert.strictEqual(devAktionNormalisieren(undefined), undefined);
  assert.strictEqual(devAktionNormalisieren(null), undefined);
  assert.strictEqual(devAktionNormalisieren({}), undefined, "ohne action ist es keine Aktion");
});

test("die alte call-service-Form wird zu perform-action", () => {
  const a = devAktionNormalisieren({ action: "call-service", service: "light.turn_on", service_data: { x: 1 } });
  assert.strictEqual(a.action, "perform-action");
  assert.strictEqual(a.perform_action, "light.turn_on");
  assert.strictEqual(a.service, undefined);
  assert.strictEqual(JSON.stringify(a.data), '{"x":1}');
  assert.strictEqual(a.service_data, undefined);
});

test("ein altes navigation_path wandert in die Navigationsaktion", () => {
  const a = devAktionNormalisieren("navigate", "/lovelace/geraete");
  assert.strictEqual(a.navigation_path, "/lovelace/geraete");
  const b = devAktionNormalisieren({ action: "navigate", navigation_path: "/a" }, "/b");
  assert.strictEqual(b.navigation_path, "/a");
});

test("devArtVon trennt eigene Arten von HAs Arten", () => {
  assert.strictEqual(devArtVon({ action: "expand" }), "expand");
  assert.strictEqual(devArtVon({ action: "device-page" }), "device-page");
  assert.strictEqual(devArtVon({ action: "perform-action" }), "ha");
  assert.strictEqual(devArtVon({ action: "more-info" }), "ha");
  assert.strictEqual(devArtVon(undefined), "ha");
  assert.strictEqual(JSON.stringify(DEV_ARTEN), '["expand","device-page","ha"]');
});

test("die Migration bildet jede Zeile der Spec-Tabelle ab", () => {
  const alt = {
    entity: "light.decke",
    tap_action: "expand",
    hold_action: "more-info",
    navigation_path: "/lovelace/x",
    show_config: false,
    show_diagnostic: true,
  };
  const neu = devMigriereKonfig(alt);
  assert.strictEqual(neu.tap_action.action, "expand");
  assert.strictEqual(neu.hold_action.action, "more-info");
  assert.strictEqual(neu.navigation_path, undefined, "der alte Schluessel verschwindet");
  assert.strictEqual(neu.show_config, undefined);
  assert.strictEqual(neu.show_diagnostic, undefined);
  assert.strictEqual(JSON.stringify(neu.groups), '["control","sensor","diagnostic"]');
});

test("show_diagnostic false nimmt nur die Diagnose heraus", () => {
  const neu = devMigriereKonfig({ entity: "x.y", show_diagnostic: false });
  assert.strictEqual(JSON.stringify(neu.groups), '["control","sensor","config"]');
});

test("die Migration ist idempotent", () => {
  const alt = { entity: "light.decke", tap_action: "navigate", navigation_path: "/x", show_config: false };
  const einmal = devMigriereKonfig(alt);
  const zweimal = devMigriereKonfig(einmal);
  assert.strictEqual(JSON.stringify(zweimal), JSON.stringify(einmal));
  assert.strictEqual(zweimal.tap_action.navigation_path, "/x");
});

test("eine Konfiguration ohne Altlasten bleibt unveraendert", () => {
  const neu = { entity: "light.decke", groups: ["control"], tap_action: { action: "expand" } };
  assert.strictEqual(JSON.stringify(devMigriereKonfig(neu)), JSON.stringify(neu));
});

test("die neuen Vorgaben stehen in DEV_STANDARD", () => {
  assert.strictEqual(JSON.stringify(DEV_STANDARD.groups), '["control","sensor","config","diagnostic"]');
  assert.strictEqual(JSON.stringify(DEV_STANDARD.groups_open), '["control"]');
  assert.strictEqual(JSON.stringify(DEV_STANDARD.labels_hide), "[]");
  assert.strictEqual(DEV_STANDARD.tap_action.action, "expand");
  assert.strictEqual(DEV_STANDARD.hold_action.action, "more-info");
  assert.strictEqual(DEV_STANDARD.row_tap_action.action, "more-info");
  assert.strictEqual(DEV_STANDARD.row_hold_action.action, "none");
  assert.strictEqual(DEV_STANDARD.show_config, undefined, "abgeloest durch groups");
  assert.strictEqual(DEV_STANDARD.navigation_path, undefined, "steckt jetzt in der Aktion");
  assert.strictEqual(JSON.stringify(DEV_HA_AKTIONEN),
    '["more-info","toggle","navigate","url","perform-action","none"]');
  assert.strictEqual(JSON.stringify(DEV_GRUPPEN_WERTE),
    '["control","sensor","config","diagnostic"]');
});

/* ── Negativfilter und Gruppen (Spec 0.11.0, Abschnitte 7 und 8) ───────── */

test("labels_hide entfernt Eintraege, Ausschluss schlaegt Einschluss", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  // sensor.decke_energie traegt beide Labels, sensor.decke_leistung nur l_energie.
  const nurEnergie = devLabelFilter(alle, [], ["l_wichtig"]).map((e) => e.entity_id);
  assert.ok(!nurEnergie.includes("sensor.decke_energie"), "der Eintrag mit l_wichtig faellt weg");
  assert.ok(nurEnergie.includes("sensor.decke_leistung"));
  const beides = devLabelFilter(alle, ["l_energie"], ["l_wichtig"]).map((e) => e.entity_id).sort();
  assert.strictEqual(beides.join(","), "sensor.decke_leistung",
    "erst einschliessen, dann ausschliessen — der Eintrag mit beiden verschwindet");
});

test("beide Listen leer laesst alles stehen", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  assert.strictEqual(devLabelFilter(alle, [], []).length, alle.length);
  assert.strictEqual(devLabelFilter(alle, undefined, undefined).length, alle.length);
});

test("devGruppenSichtbar haelt die feste Reihenfolge ein", () => {
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({ groups: ["diagnostic", "control"] })),
    '["control","diagnostic"]');
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({ groups: [] })), "[]");
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({})),
    '["control","sensor","config","diagnostic"]', "ohne Angabe alle vier");
});

test("devGruppeOffen liest groups_open", () => {
  assert.strictEqual(devGruppeOffen({ groups_open: ["control", "sensor"] }, "sensor"), true);
  assert.strictEqual(devGruppeOffen({ groups_open: ["control"] }, "sensor"), false);
  assert.strictEqual(devGruppeOffen({}, "control"), false);
});

test("groups leer ergibt gar keine Gruppe", () => {
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const leer = devNormalisiereKonfig({ entity: "light.decke", groups: [] });
  assert.strictEqual(devGruppieren(h, alle, leer).length, 0);
});

test("ein groups_open-Wert ausserhalb von groups stoert nicht", () => {
  const k = devNormalisiereKonfig({ entity: "light.decke", groups: ["sensor"], groups_open: ["config"] });
  assert.strictEqual(JSON.stringify(k.groups), '["sensor"]');
  assert.strictEqual(devGruppeOffen(k, "config"), true, "der Wert bleibt stehen");
  const h = baueHass();
  const gruppen = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.strictEqual(gruppen.map((g) => g.gruppe).join(","), "sensor",
    "gezeichnet wird nur, was in groups steht");
});

/* ── Kontext und Platzhalter (Spec 0.11.0, Abschnitt 4) ────────────────── */

const KONTEXT = { entity: "sensor.a", device: "d1", area: "wohnzimmer" };

test("devKontext liest Entitaet, Geraet und Bereich", () => {
  const k = devKontext("sensor.a", { id: "d1" }, { area_id: "wohnzimmer" });
  assert.strictEqual(k.entity, "sensor.a");
  assert.strictEqual(k.device, "d1");
  assert.strictEqual(k.area, "wohnzimmer");
  const ohne = devKontext("", null, null);
  assert.strictEqual(ohne.entity, "");
  assert.strictEqual(ohne.device, "");
  assert.strictEqual(ohne.area, "");
});

test("die drei Platzhalter werden ersetzt, mit und ohne Leerzeichen", () => {
  assert.strictEqual(devPlatzhalterErsetzen("{{ entity }}", KONTEXT), "sensor.a");
  assert.strictEqual(devPlatzhalterErsetzen("{{entity}}", KONTEXT), "sensor.a");
  assert.strictEqual(devPlatzhalterErsetzen("{{ device }}", KONTEXT), "d1");
  assert.strictEqual(devPlatzhalterErsetzen("{{ area }}", KONTEXT), "wohnzimmer");
  assert.strictEqual(devPlatzhalterErsetzen("vor {{ entity }} nach", KONTEXT), "vor sensor.a nach");
});

test("Platzhalter greifen in der Tiefe, durch Objekte und Listen", () => {
  const ein = { a: { b: ["{{ entity }}", { c: "{{ device }}" }] }, d: 7, e: true, f: null };
  const aus = devPlatzhalterErsetzen(ein, KONTEXT);
  assert.strictEqual(JSON.stringify(aus), '{"a":{"b":["sensor.a",{"c":"d1"}]},"d":7,"e":true,"f":null}');
  assert.strictEqual(ein.a.b[0], "{{ entity }}", "die Vorlage bleibt unberuehrt");
});

test("ein unbekannter Ausdruck bleibt woertlich stehen", () => {
  assert.strictEqual(devPlatzhalterErsetzen("{{ state }}", KONTEXT), "{{ state }}");
  assert.strictEqual(devPlatzhalterErsetzen("{{ entity | upper }}", KONTEXT), "{{ entity | upper }}");
});

test("ein leerer Bereich ergibt eine leere Zeichenkette, keinen Platzhalter", () => {
  assert.strictEqual(devPlatzhalterErsetzen("x{{ area }}y", { entity: "a", device: "b", area: "" }), "xy");
});

test("ein leeres Ziel fuellt sich mit der Entitaet des Kontexts", () => {
  const a = devZielFuellen({ action: "perform-action", perform_action: "x.y" }, KONTEXT);
  assert.strictEqual(JSON.stringify(a.target), '{"entity_id":"sensor.a"}');
  const b = devZielFuellen({ action: "perform-action", perform_action: "x.y", target: {} }, KONTEXT);
  assert.strictEqual(JSON.stringify(b.target), '{"entity_id":"sensor.a"}');
});

test("ein gesetztes Ziel bleibt unangetastet, auch eine fremde Entitaet", () => {
  const a = devZielFuellen(
    { action: "perform-action", perform_action: "x.y", target: { entity_id: "light.fremd" } }, KONTEXT);
  assert.strictEqual(JSON.stringify(a.target), '{"entity_id":"light.fremd"}');
  const b = devZielFuellen({ action: "toggle" }, KONTEXT);
  assert.strictEqual(b.target, undefined, "nur perform-action bekommt ein Ziel");
});

/* ── Ausfuehrung (Spec 0.11.0, Abschnitt 3.3) ──────────────────────────── */

/** Eine Karten-Attrappe, die nur mitschreibt. */
function karteAttrappe() {
  return {
    umschaltungen: 0, ereignisse: [], fehler: [],
    _umschalten() { this.umschaltungen += 1; },
    _zeigeDienstFehler(f) { this.fehler.push(String(f)); },
    dispatchEvent(ev) { this.ereignisse.push(ev); },
  };
}

/** Eine hass-Attrappe, die Dienstaufrufe mitschreibt. */
function hassAttrappe(werfen) {
  return {
    aufrufe: [],
    callService(domain, dienst, daten, ziel) {
      this.aufrufe.push({ domain, dienst, daten, ziel });
      return werfen ? Promise.reject(new Error("Dienst kaputt")) : Promise.resolve();
    },
  };
}

test("perform-action ruft den Dienst mit ersetztem Ziel und ersetzten Daten", async () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  devFuehreAus(karte, hass, {
    action: "perform-action", perform_action: "label.add",
    target: { entity_id: "{{ entity }}" }, data: { label_id: "geprueft", geraet: "{{ device }}" },
  }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(hass.aufrufe.length, 1);
  assert.strictEqual(hass.aufrufe[0].domain, "label");
  assert.strictEqual(hass.aufrufe[0].dienst, "add");
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].ziel), '{"entity_id":"sensor.a"}');
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].daten), '{"label_id":"geprueft","geraet":"d1"}');
});

test("perform-action ohne Ziel nimmt die Entitaet des Kontexts", async () => {
  const hass = hassAttrappe(false);
  devFuehreAus(karteAttrappe(), hass, { action: "perform-action", perform_action: "homeassistant.turn_on" }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].ziel), '{"entity_id":"sensor.a"}');
});

test("ein Dienst ohne Punkt ruft nichts auf", async () => {
  const hass = hassAttrappe(false);
  for (const wert of [undefined, "", "licht", ".turn_on", "light."]) {
    devFuehreAus(karteAttrappe(), hass, { action: "perform-action", perform_action: wert }, KONTEXT);
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(hass.aufrufe.length, 0);
});

test("ein fehlgeschlagener Dienstaufruf landet bei der Karte, nicht im Nichts", async () => {
  const karte = karteAttrappe();
  devFuehreAus(karte, hassAttrappe(true), { action: "perform-action", perform_action: "x.y" }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(karte.fehler.length, 1);
  assert.ok(/Dienst kaputt/.test(karte.fehler[0]));
});

test("toggle, more-info, expand und none tun genau eines", async () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  devFuehreAus(karte, hass, { action: "toggle" }, KONTEXT);
  assert.strictEqual(hass.aufrufe[0].domain, "homeassistant");
  assert.strictEqual(hass.aufrufe[0].dienst, "toggle");
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].daten), '{"entity_id":"sensor.a"}');
  devFuehreAus(karte, hass, { action: "more-info" }, KONTEXT);
  assert.strictEqual(karte.ereignisse.length, 1);
  assert.strictEqual(karte.ereignisse[0].detail.entityId, "sensor.a");
  devFuehreAus(karte, hass, { action: "expand" }, KONTEXT);
  assert.strictEqual(karte.umschaltungen, 1);
  devFuehreAus(karte, hass, { action: "none" }, KONTEXT);
  devFuehreAus(karte, hass, { action: "gibtsnicht" }, KONTEXT);
  devFuehreAus(karte, hass, undefined, KONTEXT);
  assert.strictEqual(hass.aufrufe.length, 1, "keine weiteren Dienstaufrufe");
  assert.strictEqual(karte.ereignisse.length, 1);
  assert.strictEqual(karte.umschaltungen, 1);
});

test("navigate und url ohne Pfad tun nichts", () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  devFuehreAus(karte, hass, { action: "navigate" }, KONTEXT);
  devFuehreAus(karte, hass, { action: "url" }, KONTEXT);
  assert.strictEqual(hass.aufrufe.length, 0);
});

test("getStubConfig startet aufgeklappt, damit die Vorschau etwas zeigt", () => {
  const stub = BuschDeviceCard.getStubConfig(baueHass(), ["light.decke"]);
  assert.strictEqual(stub.start_expanded, true);
  assert.strictEqual(stub.entity, "light.decke");
});

test("die Vorgabe von start_expanded bleibt aus", () => {
  assert.strictEqual(DEV_STANDARD.start_expanded, false);
  assert.strictEqual(devNormalisiereKonfig({ entity: "light.decke" }).start_expanded, false);
});

test("auch ein reiner Ausschluss kann die Liste leeren", () => {
  // Befund vom 10.09.2026 an echten Daten: Label `ignore` auf allen
  // Entitaeten eines Zigbee-Schalters filtert alles weg.
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const k = devNormalisiereKonfig({ entity: "light.decke", labels_hide: ["l_energie", "l_wichtig"] });
  const uebrig = devLabelFilter(alle, k.labels, k.labels_hide).map((e) => e.entity_id).sort();
  assert.ok(!uebrig.includes("sensor.decke_energie"));
  assert.ok(!uebrig.includes("sensor.decke_leistung"));
  assert.strictEqual(k.labels.length, 0, "ohne Einschlussliste");
  assert.ok(k.labels_hide.length > 0, "nur die Ausschlussliste ist gesetzt");
});
