"use strict";

// Send/echo races of the device card quick controls with the shared test kit (#1273, M5 for M14).
// The card runs fully (setConfig, set hass, core, render) on the kit DOM; HA
// answers the service at once but the new state arrives 1500 ms later, as a
// Zigbee thermostat does. The race test is `todo` while the card still jumps
// back: it runs and reports `not ok … # TODO` without failing the suite. M14
// turns it into a normal test.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

async function thermostat() {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock, echoDelay: 1500,
    states: { "climate.room": { state: "heat", attributes: { friendly_name: "Room", supported_features: 1, temperature: 21, min_temp: 7, max_temp: 35, target_temp_step: 0.5, hvac_modes: ["off", "heat"] } } },
    entities: { "climate.room": { entity_id: "climate.room", device_id: "dev", platform: "zha", labels: [] } },
    devices: { dev: { id: "dev", name: "Thermostat", manufacturer: "Example", model: "T1", area_id: null, labels: [] } },
    echo: (call) => (call.service === "set_temperature" ? { [call.data.entity_id]: { attributes: { temperature: call.data.temperature } } } : null),
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "climate.room", quick_controls: true });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  ha.onUpdate((hass) => { card.hass = hass; });
  await clock.flush();
  const slider = card._quickNodes.find((el) => el.dataset.control === "temperature");
  assert.ok(slider, "temperature slider rendered");
  return { clock, ha, card, slider, env };
}

function release(slider, env, value) {
  slider.focus();
  slider.value = value;
  slider.dispatchEvent(new env.Event("input", { bubbles: true }));
  slider.dispatchEvent(new env.Event("change", { bubbles: true }));
}

test("kit baseline: the thermostat slider sends one set_temperature and follows the echo", async () => {
  const { clock, ha, slider, env } = await thermostat();
  assert.equal(Number(slider.value), 21);
  release(slider, env, 22);
  await clock.advance(1500);
  assert.deepEqual(ha.services.map((s) => [s.service, s.data.temperature]), [["set_temperature", 22]]);
  assert.equal(Number(slider.value), 22);
});

test("M14: after release the slider holds the sent value until the state echo arrives", { todo: "M14 pending value held at the element until echo, error or timeout" }, async () => {
  const { clock, ha, slider, env } = await thermostat();
  release(slider, env, 22);
  const seen = [];
  for (const step of [0, 100, 500, 1000, 1499]) { await clock.advance(step - (seen.at(-1)?.[0] ?? 0)); seen.push([step, Number(slider.value)]); }
  assert.equal(ha.count("climate.set_temperature"), 1);
  assert.deepEqual(seen, [[0, 22], [100, 22], [500, 22], [1000, 22], [1499, 22]], `slider jumped back between send and echo: ${JSON.stringify(seen)}`);
  await clock.advance(1);
  assert.equal(Number(slider.value), 22, "echo keeps the value");
});
