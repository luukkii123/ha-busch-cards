"use strict";

/**
 * Eine `hass`-Attrappe mit den Registerformen aus Spec Abschnitt 2 — belegt
 * am Frontend-Quelltext (`EntityRegistryDisplayEntry`, `DeviceRegistryEntry`,
 * `LabelRegistryEntry`, gelesen 09.09.2026). Ein Shelly mit acht Entitaeten,
 * ein zweites Geraet ohne Hersteller, eine Entitaet ohne Geraet.
 */
function eintrag(entity_id, extra) {
  return { entity_id, device_id: "d1", area_id: null, labels: [], platform: "shelly", ...extra };
}

function zustand(name, state, extra) {
  return { state, attributes: { friendly_name: name, ...(extra || {}) } };
}

function baueHass() {
  return {
    locale: { language: "de-DE" },
    states: {
      "light.decke": zustand("Wohnzimmer Deckenlampe", "on", { brightness: 180 }),
      "sensor.decke_leistung": zustand("Wohnzimmer Deckenlampe Leistung", "12.4"),
      "sensor.decke_energie": zustand("Wohnzimmer Deckenlampe Energie", "3.21"),
      "sensor.decke_rssi": zustand("Wohnzimmer Deckenlampe RSSI", "-61"),
      "update.decke_firmware": zustand("Wohnzimmer Deckenlampe Firmware", "off"),
      "switch.decke_kindersicherung": zustand("Wohnzimmer Deckenlampe Kindersicherung", "off"),
      "binary_sensor.decke_ueberhitzt": zustand("Wohnzimmer Deckenlampe Überhitzt", "off"),
      "event.decke_taster": zustand("Wohnzimmer Deckenlampe Taster", "2026-09-09T10:00:00+00:00"),
      "sensor.decke_versteckt": zustand("Versteckt", "1"),
      "sensor.anderes": zustand("Anderes", "5"),
      "sensor.ohne_geraet": zustand("Ohne Gerät", "7"),
    },
    entities: {
      "light.decke": eintrag("light.decke", { labels: ["l_wichtig"] }),
      "sensor.decke_leistung": eintrag("sensor.decke_leistung", { labels: ["l_energie"] }),
      "sensor.decke_energie": eintrag("sensor.decke_energie", { labels: ["l_energie", "l_wichtig"] }),
      "sensor.decke_rssi": eintrag("sensor.decke_rssi", { entity_category: "diagnostic" }),
      "update.decke_firmware": eintrag("update.decke_firmware", { entity_category: "config" }),
      "switch.decke_kindersicherung": eintrag("switch.decke_kindersicherung", { entity_category: "config" }),
      "binary_sensor.decke_ueberhitzt": eintrag("binary_sensor.decke_ueberhitzt"),
      "event.decke_taster": eintrag("event.decke_taster"),
      "sensor.decke_versteckt": eintrag("sensor.decke_versteckt", { hidden: true }),
      "sensor.anderes": eintrag("sensor.anderes", { device_id: "d2", platform: "mqtt" }),
      "sensor.ohne_geraet": eintrag("sensor.ohne_geraet", { device_id: undefined }),
    },
    devices: {
      d1: {
        id: "d1", name: "shellyplus1pm-abc123", name_by_user: "Wohnzimmer Deckenlampe",
        manufacturer: "Shelly", model: "Plus 1PM", area_id: "wohnzimmer", labels: [],
      },
      d2: {
        id: "d2", name: "Aqara Sensor", name_by_user: null,
        manufacturer: null, model: null, area_id: null, labels: [],
      },
    },
    areas: { wohnzimmer: { area_id: "wohnzimmer", name: "Wohnzimmer", icon: "mdi:sofa" } },
    aufrufe: [],
    async callWS(nachricht) {
      this.aufrufe.push(nachricht.type);
      if (nachricht.type === "config/label_registry/list") {
        return [
          { label_id: "l_wichtig", name: "Wichtig", icon: "mdi:star", color: "red", description: null },
          { label_id: "l_energie", name: "Energie", icon: null, color: "green", description: null },
        ];
      }
      return [];
    },
    dienste: [],
    async callService(domain, service, daten) {
      this.dienste.push(`${domain}.${service} ${JSON.stringify(daten)}`);
    },
  };
}

module.exports = { baueHass };
