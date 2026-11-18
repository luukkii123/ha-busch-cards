"use strict";

// M48 (#1300, P9): an open editor gives `ha-form` new schema, data and label functions only when its
// config, the language or (network) the registry changed. A foreign state change only passes `hass` on.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const WATCHED = ["schema", "data", "computeLabel", "computeHelper"];

function setup() {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, globals: { performance: { now: () => clock.now } } });
  const sets = new Map();
  // A counting stand-in for HA's ha-form; defined before the bundle loads, like in a running frontend.
  class CountingForm extends env.HTMLElement {
    constructor() {
      super();
      this._values = {};
      for (const key of WATCHED) Object.defineProperty(this, key, {
        configurable: true,
        get: () => this._values[key],
        set: (value) => { sets.set(key, (sets.get(key) || 0) + 1); this._values[key] = value; },
      });
    }
  }
  env.customElements.define("ha-form", CountingForm);
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    extra: { formatEntityState: (state) => state.state },
    states: {
      "calendar.home": { state: "off", attributes: { friendly_name: "Home" } },
      "calendar.work": { state: "off", attributes: { friendly_name: "Work" } },
      "light.lamp": { state: "on", attributes: { friendly_name: "Lamp" } },
      "sensor.other": { state: "5", attributes: { friendly_name: "Other" } },
      "device_tracker.phone": { state: "home", attributes: { friendly_name: "Phone" } },
    },
    entities: {
      "light.lamp": { entity_id: "light.lamp", device_id: "dev", platform: "hue", labels: [] },
      "sensor.other": { entity_id: "sensor.other", device_id: "other", platform: "mqtt", labels: [] },
      "device_tracker.phone": { entity_id: "device_tracker.phone", device_id: "router", platform: "fritz", config_entry_id: "fritz1", labels: [] },
    },
    devices: {
      dev: { id: "dev", name: "Lamp", area_id: null, labels: [] },
      other: { id: "other", name: "Other", area_id: null, labels: [] },
      router: { id: "router", name: "Router", area_id: null, labels: [] },
    },
  });
  const total = () => [...sets.values()].reduce((n, v) => n + v, 0);
  return { clock, env, ha, sets, total, reset: () => sets.clear() };
}

const EDITORS = [
  ["busch-schedule-card-editor", { type: "custom:busch-schedule-card", entity: "schedule.x" }],
  ["busch-calendar-card-editor", { type: "custom:busch-calendar-card", entities: ["calendar.home", { entity: "calendar.work", color: "#ff0000" }] }],
  ["busch-map-card-editor", { type: "custom:busch-map-card", entities: ["light.lamp"] }],
  ["busch-device-card-editor", { type: "custom:busch-device-card", entity: "light.lamp" }],
  ["busch-smart-entities-editor", { type: "custom:busch-smart-entities", filter: { include: [{ domain: "light" }] } }],
  ["busch-network-card-editor", { type: "custom:busch-network-card" }],
  ["busch-fritz-device-card-editor", { type: "custom:busch-fritz-device-card", device_id: "router" }],
];

async function open(name, config) {
  const s = setup();
  const editor = s.env.document.createElement(name);
  editor.dispatchEvent = () => true;
  editor.setConfig(config);
  editor.hass = s.ha.hass;
  s.env.document.body.appendChild(editor);
  editor.connectedCallback?.();
  s.ha.onUpdate((hass) => { editor.hass = hass; });
  await s.clock.advance(100);
  const forms = () => {
    const found = [];
    const walk = (node) => { if (!node) return; if (String(node.tagName).toLowerCase() === "ha-form") found.push(node); walk(node.shadowRoot); for (const child of node.childNodes || node.children || []) walk(child); };
    walk(editor);
    return found;
  };
  return { ...s, editor, forms };
}

for (const [name, config] of EDITORS) {
  test(`M48 ${name}: foreign state changes set no schema, data or label function on ha-form`, async () => {
    const { clock, ha, editor, sets, total, reset, forms } = await open(name, config);
    assert.ok(forms().length > 0, "editor renders at least one ha-form");
    reset();
    for (let i = 0; i < 5; i++) ha.patchState("sensor.other", { state: String(10 + i) });
    await clock.advance(50);
    assert.equal(total(), 0, `sets per foreign update: ${JSON.stringify(Object.fromEntries(sets))}`);
    assert.ok(forms().every((form) => form.hass === ha.hass), "ha-form still receives the new hass");
    editor.setConfig({ ...config, title: "Changed" });
    await clock.advance(50);
    assert.ok((sets.get("data") || 0) >= 1, "a real config change supplies new data");
  });
}

test("M48 editors set new schema and label functions after a language change, then none again", async () => {
  for (const [name, config] of EDITORS) {
    const { clock, ha, editor, sets, total, reset } = await open(name, config);
    reset();
    const german = { ...ha.hass, language: "de", locale: { ...(ha.hass.locale || {}), language: "de" } };
    editor.hass = german;
    await clock.advance(50);
    assert.ok((sets.get("schema") || 0) >= 1, `${name}: schema after language change ${JSON.stringify(Object.fromEntries(sets))}`);
    reset();
    editor.hass = { ...german };
    await clock.advance(50);
    assert.equal(total(), 0, `${name}: same language again`);
  }
});

test("M48 fritz editor: a registry change still refreshes the role schema", async () => {
  const { clock, ha, editor, sets, reset, forms } = await open("busch-fritz-device-card-editor", EDITORS[6][1]);
  const roleOptions = () => forms().flatMap((form) => form.schema || []).filter((field) => field.name === "role_wlan").flatMap((field) => field.selector.entity.include_entities);
  assert.deepEqual(roleOptions(), []);
  reset();
  ha.setState("switch.guest_wifi", { state: "on", attributes: { friendly_name: "Guest WiFi" } });
  ha.setRegistry("entity", { ...ha.server.entities, "switch.guest_wifi": { entity_id: "switch.guest_wifi", device_id: "router", platform: "fritz", config_entry_id: "fritz1", labels: [] } }, { action: "create", entity_id: "switch.guest_wifi" });
  await clock.advance(1000);
  assert.ok((sets.get("schema") || 0) >= 1, `schema sets after registry change ${JSON.stringify(Object.fromEntries(sets))}`);
  assert.deepEqual(roleOptions(), ["switch.guest_wifi"]);
  void editor;
});
