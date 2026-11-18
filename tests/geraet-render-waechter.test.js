"use strict";

// M15 (#1283): `set hass` of the device card renders only when something of its own changed.
// The card runs fully on the shared test kit (setConfig, set hass, core stream, render); a
// foreign state change must cost 0 renders, an own change exactly 1.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

async function lamp(config = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, globals: { performance: { now: () => clock.now } } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    extra: { formatEntityState: (state) => state.state, formatEntityAttributeValue: (state, name) => String(state.attributes[name] ?? "") },
    states: {
      "light.lamp": { state: "on", attributes: { friendly_name: "Lamp", supported_color_modes: ["brightness"], brightness: 128 } },
      "sensor.lamp_power": { state: "12", attributes: { friendly_name: "Lamp power", unit_of_measurement: "W" } },
      "sensor.other": { state: "5", attributes: { friendly_name: "Other" } },
    },
    entities: {
      "light.lamp": { entity_id: "light.lamp", device_id: "dev", platform: "hue", labels: [] },
      "sensor.lamp_power": { entity_id: "sensor.lamp_power", device_id: "dev", platform: "hue", labels: [] },
      "sensor.other": { entity_id: "sensor.other", device_id: "other", platform: "mqtt", labels: [] },
    },
    devices: {
      dev: { id: "dev", name: "Lamp", manufacturer: "Example", model: "L1", area_id: null, labels: [] },
      other: { id: "other", name: "Other", manufacturer: null, model: null, area_id: null, labels: [] },
    },
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "light.lamp", quick_controls: true, ...config });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  ha.onUpdate((hass) => { card.hass = hass; });
  await clock.advance(100);
  const original = card._render;
  let renders = 0;
  card._render = function (...args) { renders++; return original.apply(this, args); };
  return { clock, ha, card, renders: () => renders, reset: () => { renders = 0; } };
}

test("M15: a foreign state change does not render the device card, an own change renders once", async () => {
  const { clock, ha, card, renders, reset } = await lamp();
  assert.ok(card._core.synced(ha.hass), "core synced with hass.states");
  for (let i = 0; i < 5; i++) ha.patchState("sensor.other", { state: String(10 + i) });
  await clock.advance(50);
  assert.equal(renders(), 0, "foreign updates must not render");
  reset();
  ha.patchState("light.lamp", { attributes: { brightness: 50 } });
  await clock.advance(50);
  assert.equal(renders(), 1, "own primary change renders once");
  assert.equal(Number(card._quickNodes.find((el) => el.dataset.control === "brightness").value), 50);
  reset();
  ha.patchState("sensor.lamp_power", { state: "13" });
  await clock.advance(50);
  assert.equal(renders(), 1, "own secondary change renders once");
});

test("M15: language and configuration count as own changes", async () => {
  const { clock, ha, card, renders, reset } = await lamp();
  const de = { ...ha.hass, language: "de", locale: { ...ha.hass.locale, language: "de" } };
  card.hass = de;
  await clock.advance(10);
  assert.equal(renders(), 1, "language change renders");
  assert.equal(card._pfeil.getAttribute("aria-label"), "Aufklappen");
  reset();
  card.setConfig({ entity: "light.lamp", quick_controls: false });
  card.hass = de;
  assert.ok(renders() >= 1, "new config renders");
  assert.equal(card._quick.hidden, true);
});

test("M15: a filter result is a dependency and a foreign update still does not render", async () => {
  const { clock, ha, card, renders, reset } = await lamp({ filter: { include: [{ state: "on" }, { domain: "sensor", state: "12" }] } });
  assert.equal(card._filterShowPrimary, true);
  ha.patchState("sensor.other", { state: "12" });
  await clock.advance(50);
  assert.equal(renders(), 0, "foreign update with filter must not render");
  reset();
  ha.patchState("light.lamp", { state: "off" });
  await clock.advance(50);
  assert.ok(renders() >= 1, "filter change renders");
  assert.equal(card._filterShowPrimary, false, "primary filtered out after own change");
  assert.equal(card._quick.hidden, true);
});
