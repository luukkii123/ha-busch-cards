"use strict";

// Send/echo races of the device card quick controls with the shared test kit (#1273, M5 for M14).
// The card runs fully (setConfig, set hass, core, render) on the kit DOM; HA
// answers the service at once but the new state arrives 1500 ms later, as a
// Zigbee thermostat does. The race test was `todo` while the card still jumped
// back. M14 (#1283) turned it into a normal test and added the keyboard batch
// and the busy power button.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

async function thermostat({ echo = true } = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, globals: { performance: { now: () => clock.now } } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock, echoDelay: 1500,
    states: { "climate.room": { state: "heat", attributes: { friendly_name: "Room", supported_features: 1, temperature: 21, min_temp: 7, max_temp: 35, target_temp_step: 0.5, hvac_modes: ["off", "heat"] } } },
    entities: { "climate.room": { entity_id: "climate.room", device_id: "dev", platform: "zha", labels: [] } },
    devices: { dev: { id: "dev", name: "Thermostat", manufacturer: "Example", model: "T1", area_id: null, labels: [] } },
    echo: (call) => (echo && call.service === "set_temperature" ? { [call.data.entity_id]: { attributes: { temperature: call.data.temperature } } } : null),
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

test("M14: after release the slider holds the sent value until the state echo arrives", async () => {
  const { clock, ha, slider, env } = await thermostat();
  release(slider, env, 22);
  const seen = [];
  for (const step of [0, 100, 500, 1000, 1499]) { await clock.advance(step - (seen.at(-1)?.[0] ?? 0)); seen.push([step, Number(slider.value)]); }
  assert.equal(ha.count("climate.set_temperature"), 1);
  assert.deepEqual(seen, [[0, 22], [100, 22], [500, 22], [1000, 22], [1499, 22]], `slider jumped back between send and echo: ${JSON.stringify(seen)}`);
  await clock.advance(1);
  assert.equal(Number(slider.value), 22, "echo keeps the value");
});

function key(slider, env, next) {
  slider.focus();
  slider.dispatchEvent(new env.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  slider.value = next;
  slider.dispatchEvent(new env.Event("input", { bubbles: true }));
  slider.dispatchEvent(new env.Event("change", { bubbles: true }));
  slider.dispatchEvent(new env.KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
}

test("M14: five arrow keys within 300 ms send one call with the last value; the value holds until the 1500 ms echo", async () => {
  const { clock, ha, slider, env } = await thermostat();
  for (let i = 1; i <= 5; i++) { key(slider, env, 21 + i * 0.5); await clock.advance(60); }
  assert.equal(ha.count("climate.set_temperature"), 0, "keyboard steps are still collected");
  await clock.advance(400);
  const keyboardCoalesced = ha.count("climate.set_temperature");
  const sentAt = clock.now;
  let pendingHeldUntilEcho = true;
  while (clock.now < sentAt + 1490) { await clock.advance(100); if (Number(slider.value) !== 23.5) pendingHeldUntilEcho = false; }
  await clock.advance(1600);
  const report = { pendingHeldUntilEcho, keyboardCoalesced, sent: ha.services.map((s) => s.data.temperature), final: Number(slider.value) };
  assert.deepEqual(report, { pendingHeldUntilEcho: true, keyboardCoalesced: 1, sent: [23.5], final: 23.5 });
});

test("M14: arrow keys step from the shown value like a browser; one step stays held and five steps send their sum", async () => {
  const { clock, ha, slider, env } = await thermostat();
  key(slider, env, Number(slider.value) + 0.5);
  assert.equal(Number(slider.value), 21.5, "one step is not mistaken for the echo");
  for (let i = 2; i <= 5; i++) { key(slider, env, Number(slider.value) + 0.5); await clock.advance(60); }
  await clock.advance(400);
  assert.deepEqual(ha.services.map((s) => s.data.temperature), [23.5]);
  assert.equal(Number(slider.value), 23.5);
  await clock.advance(1600);
  assert.equal(Number(slider.value), 23.5, "echo keeps the value");
});

test("M14: a failed call drops the held value and shows HA's value again", async () => {
  const { clock, ha, card, slider, env } = await thermostat();
  ha.behave("climate.set_temperature", { delay: 200, reject: new Error("offline") });
  release(slider, env, 25);
  await clock.advance(100);
  assert.equal(Number(slider.value), 25, "held while the call is in flight");
  await clock.advance(200);
  assert.equal(Number(slider.value), 21, "back to HA after the error");
  assert.equal(card._dienstFehler.hidden, false);
});

test("M14: the held value ends after 10 s without an echo", async () => {
  const { clock, ha, slider, env } = await thermostat({ echo: false });
  ha.behave("climate.set_temperature", { hang: true });
  release(slider, env, 25);
  await clock.advance(9900);
  assert.equal(Number(slider.value), 25);
  await clock.advance(200);
  assert.equal(Number(slider.value), 21);
});

async function lamp(language = "en", { echo = true } = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, language, globals: { performance: { now: () => clock.now } } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock, echoDelay: 1500, language,
    states: { "switch.plug": { state: "off", attributes: { friendly_name: "Plug" } } },
    entities: { "switch.plug": { entity_id: "switch.plug", device_id: "dev", platform: "zha", labels: [] } },
    devices: { dev: { id: "dev", name: "Plug", manufacturer: "Example", model: "P1", area_id: null, labels: [] } },
    echo: (call) => (echo ? { [call.data.entity_id]: { state: call.service === "turn_on" ? "on" : "off" } } : null),
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "switch.plug", quick_controls: true });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  ha.onUpdate((hass) => { card.hass = hass; });
  await clock.flush();
  const button = () => card._quickNodes.find((el) => el.dataset.control === "power");
  return { clock, ha, card, button, env };
}

test("M14: the power button is busy in the same tick, ignores a second click and clears on the new state", async () => {
  const { clock, ha, card, button } = await lamp();
  const el = button();
  el.click();
  assert.equal(el.getAttribute("aria-busy"), "true", "busy in the same tick");
  assert.equal(el.textContent, "Switching …");
  assert.ok(el.classList.contains("dev-quick-pending"));
  assert.ok(card.querySelector('[aria-busy="true"]'), "light DOM query finds the busy button");
  el.click();
  assert.equal(ha.count("switch.turn_on"), 1, "second click while busy is ignored");
  await clock.advance(1500);
  assert.equal(card.querySelector('[aria-busy="true"]'), null, "busy cleared by the new state");
  assert.equal(button().textContent, "Turn off");
});

test("M14: the busy power button clears on error and after 10 s; German label", async () => {
  const { clock, ha, card, button } = await lamp("de", { echo: false });
  ha.behave("switch.turn_on", { delay: 100, reject: new Error("offline") });
  button().click();
  assert.equal(button().textContent, "Schaltet …");
  await clock.advance(150);
  assert.equal(button().getAttribute("aria-busy"), null, "error clears busy");
  assert.equal(button().textContent, "Einschalten");
  ha.behave("switch.turn_on", { hang: true });
  button().click();
  await clock.advance(9900);
  assert.equal(button().getAttribute("aria-busy"), "true");
  await clock.advance(200);
  assert.equal(button().getAttribute("aria-busy"), null, "10 s limit clears busy");
  assert.equal(card.querySelector('[aria-busy="true"]'), null);
});
