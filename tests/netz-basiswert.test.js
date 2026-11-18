"use strict";

// Network baseline per card build for M10/M11 (#1273, M5), measured with the
// shared test kit on the full device card (setConfig, set hass, core, render).
// The numbers live in tests/netz-basiswert.json. When M10/M11 change them on
// purpose, regenerate the file with BUSCH_BASISWERT_SCHREIBEN=1 and say so in
// the commit.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const BASELINE = path.join(__dirname, "netz-basiswert.json");
const REGISTRY = /^config\/\w+_registry\/list$/;

function world() {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock });
  kit.loadScript(BUNDLE, { globals: env });
  const states = {}, entities = {};
  for (let i = 0; i < 20; i++) {
    const id = `sensor.s${i}`;
    states[id] = { state: String(i), attributes: { friendly_name: `Sensor ${i}` } };
    entities[id] = { entity_id: id, device_id: i < 4 ? "dev" : `d${i}`, platform: "demo", labels: [] };
  }
  states["light.lamp"] = { state: "on", attributes: { friendly_name: "Lamp", supported_color_modes: ["brightness"], brightness: 128 } };
  entities["light.lamp"] = { entity_id: "light.lamp", device_id: "dev", platform: "demo", labels: [] };
  const devices = { dev: { id: "dev", name: "Lamp", manufacturer: "Example", model: "L1", area_id: "room", labels: [] } };
  const ha = kit.createHass({ clock, states, entities, devices, areas: { room: { area_id: "room", name: "Room" } } });
  return { clock, env, ha };
}

async function build(w, n) {
  const cards = [];
  for (let i = 0; i < n; i++) {
    const card = w.env.document.createElement("busch-device-card");
    card.setConfig({ entity: "light.lamp", quick_controls: true });
    w.env.document.body.appendChild(card);
    card.hass = w.ha.hass;
    card.connectedCallback?.();
    cards.push(card);
  }
  w.ha.onUpdate((hass) => { for (const card of cards) card.hass = hass; });
  await w.clock.advance(100);
  return cards;
}

function snapshot(ha) {
  const count = (key) => ha.count(key);
  return {
    get_states: count("get_states"),
    registry_list: ha.countMatching(REGISTRY),
    registry_list_by_type: Object.fromEntries(Object.keys(ha.stats.count).filter((k) => REGISTRY.test(k)).sort().map((k) => [k, count(k)])),
    subscribe_events: count("subscribe_events"),
    subscribe_state_changed: count("subscribe_events:state_changed"),
  };
}

async function measure() {
  const out = {};
  for (const n of [1, 3]) {
    const w = world();
    await build(w, n);
    out[`build_${n}_card${n > 1 ? "s" : ""}`] = snapshot(w.ha);
    if (n === 1) out.get_states_bytes_in_fixture = w.ha.stats.bytesIn.get_states || 0;
  }
  {
    const w = world();
    await build(w, 1);
    w.ha.resetStats();
    for (let i = 0; i < 10; i++) w.ha.patchState(`sensor.s${i}`, { state: String(100 + i) });
    await w.clock.advance(100);
    out.after_10_state_changes = snapshot(w.ha);
    w.ha.resetStats();
    w.ha.setRegistry("entity", w.ha.server.entities);
    await w.clock.advance(100);
    out.after_entity_registry_updated = snapshot(w.ha);
    w.ha.resetStats();
    w.ha.reconnect();
    await w.clock.advance(100);
    out.after_reconnect = snapshot(w.ha);
  }
  return out;
}

test("baseline of get_states and config/*_registry/list per device card build (M10/M11)", async () => {
  const measured = await measure();
  if (process.env.BUSCH_BASISWERT_SCHREIBEN === "1") {
    const doc = { note: "M5 baseline for M10/M11: WS requests of the device card with the shared test kit; regenerate with BUSCH_BASISWERT_SCHREIBEN=1", measured };
    fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + "\n");
  }
  assert.deepEqual(measured, JSON.parse(fs.readFileSync(BASELINE, "utf8")).measured);
});
