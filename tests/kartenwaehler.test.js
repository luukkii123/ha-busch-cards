"use strict";

// #1011 Kartenwähler: keine Live-Vorschau, ein Satz Beschreibung, billige Vorgaben.
const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const KLASSEN = ["BuschScheduleCard", "BuschMapCard", "BuschCalendarCard", "BuschDeviceCard",
  "BuschSmartEntities", "BuschNetworkCard", "BuschFritzDeviceCard"];

function eintraege(sprache) {
  const fenster = { customCards: [] };
  ladeKarte(["CARD_VERSION"], { window: fenster, navigator: { language: sprache } });
  return fenster.customCards;
}

test("jeder Kartenwähler-Eintrag: preview false, Name und ein Satz Beschreibung (de und en)", () => {
  for (const sprache of ["de-DE", "en-US"]) {
    const liste = eintraege(sprache);
    assert.strictEqual(liste.length, 7);
    for (const e of liste) {
      assert.strictEqual(e.preview, false, `${e.type}: preview`);
      assert.match(e.name, /^Busch /, `${e.type}: Name beginnt mit Busch`);
      assert.match(e.description, /^[A-ZÄÖÜ].*[^.]\.$/, `${e.type}: ein Satz mit Punkt: ${e.description}`);
      assert.ok(!/[.!?] /.test(e.description), `${e.type}: genau ein Satz: ${e.description}`);
      assert.ok(!/—/.test(e.description), `${e.type}: kein Gedankenstrich-Fragment`);
    }
  }
});

function zaehlHass() {
  const zaehler = { states: 0, entities: 0, devices: 0, netz: 0 };
  const st = (id, attributes = {}) => ({ entity_id: id, state: "on", attributes });
  const states = {
    "sun.sun": st("sun.sun"), "light.flur": st("light.flur"), "schedule.heizung": st("schedule.heizung"),
    "calendar.familie": st("calendar.familie"), "person.lukas": st("person.lukas"),
  };
  const entities = {
    "sun.sun": { entity_id: "sun.sun", platform: "sun" },
    "light.flur": { entity_id: "light.flur", platform: "hue", device_id: "lampe" },
  };
  const devices = { lampe: { id: "lampe", name: "Flurlampe" } };
  const zaehl = (obj, k) => new Proxy(obj, { ownKeys(t) { zaehler[k]++; return Reflect.ownKeys(t); } });
  const netz = () => { zaehler.netz++; return new Promise(() => {}); };
  const hass = {
    states: zaehl(states, "states"), entities: zaehl(entities, "entities"), devices: zaehl(devices, "devices"),
    areas: {}, floors: {}, locale: { language: "de" }, callWS: netz, callApi: netz,
    connection: { subscribeEvents: netz, subscribeMessage: netz, sendMessagePromise: netz },
  };
  return { hass, zaehler };
}

test("getStubConfig: höchstens ein Durchlauf je Register für alle Karten, kein Netz", () => {
  const klassen = ladeKarte(KLASSEN);
  const { hass, zaehler } = zaehlHass();
  const ergebnisse = {};
  for (let runde = 0; runde < 2; runde++) {
    for (const name of KLASSEN) ergebnisse[name] = klassen[name].getStubConfig(hass);
  }
  assert.ok(zaehler.states <= 1, `hass.states ${zaehler.states}× durchlaufen`);
  assert.ok(zaehler.entities <= 1, `hass.entities ${zaehler.entities}× durchlaufen`);
  assert.ok(zaehler.devices <= 1, `hass.devices ${zaehler.devices}× durchlaufen`);
  assert.strictEqual(zaehler.netz, 0, "Netz- oder WebSocket-Abfrage im Kartenwähler");
  // Die Vorgaben selbst bleiben wie bisher.
  assert.strictEqual(ergebnisse.BuschScheduleCard.entity, "schedule.heizung");
  assert.deepStrictEqual([...ergebnisse.BuschCalendarCard.entities], ["calendar.familie"]);
  assert.deepStrictEqual([...ergebnisse.BuschMapCard.entities], ["person.lukas"]);
  assert.strictEqual(ergebnisse.BuschDeviceCard.entity, "light.flur");
  assert.strictEqual(ergebnisse.BuschSmartEntities.filter.include[0].integration, "sun");
  assert.strictEqual(ergebnisse.BuschNetworkCard.type, "custom:busch-network-card");
  assert.strictEqual(ergebnisse.BuschFritzDeviceCard.type, "custom:busch-fritz-device-card");
});

test("getStubConfig: ein neues Register baut den Index neu", () => {
  const { BuschScheduleCard } = ladeKarte(["BuschScheduleCard"]);
  const a = zaehlHass().hass, b = zaehlHass().hass;
  delete b.states["schedule.heizung"];
  assert.strictEqual(BuschScheduleCard.getStubConfig(a).entity, "schedule.heizung");
  assert.strictEqual(BuschScheduleCard.getStubConfig(b).entity, "");
});
