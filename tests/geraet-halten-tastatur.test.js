"use strict";

// M74 (#1321, F11): hold actions of the device card by keyboard, Shift+Enter or the context menu key,
// on the header and on an entity row; plain Enter stays the tap action, text fields keep their keys.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

async function device(config = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, language: "de", globals: { performance: { now: () => clock.now } } });
  env.window.loadCardHelpers = async () => ({
    createCardElement: () => env.document.createElement("div"),
    createRowElement: (cfg) => { const row = env.document.createElement("div"); row.textContent = cfg.name; return row; },
  });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_DEVICE_CARD"] });
  const ha = kit.createHass({
    clock,
    language: "de",
    extra: { formatEntityState: (state) => state.state },
    states: {
      "light.lampe": { state: "on", attributes: { friendly_name: "Lampe" } },
      "sensor.lampe_leistung": { state: "5", attributes: { friendly_name: "Lampe Leistung" } },
    },
    entities: {
      "light.lampe": { entity_id: "light.lampe", device_id: "d", platform: "hue", labels: [] },
      "sensor.lampe_leistung": { entity_id: "sensor.lampe_leistung", device_id: "d", platform: "hue", labels: [] },
    },
    devices: { d: { id: "d", name: "Lampe", manufacturer: "Signify", model: "LCT", area_id: null, labels: [] } },
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "light.lampe", start_expanded: true, ...config });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  await clock.advance(100);
  const moreInfo = [];
  card.addEventListener("hass-more-info", (e) => moreInfo.push(e.detail.entityId));
  const key = (target, key, extra = {}) => {
    const e = new env.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(e);
    return e;
  };
  return { env, card, clock, ha, moreInfo, key, texte: exposed.TEXTE_BUSCH_DEVICE_CARD };
}

test("M74: Shift+Enter on the device header runs the hold action, not the tap action", async () => {
  const { card, moreInfo, key, ha } = await device({ tap_action: { action: "toggle" }, hold_action: { action: "more-info" } });
  const e = key(card._kopf, "Enter", { shiftKey: true });
  assert.deepEqual(moreInfo, ["light.lampe"], "hold action more-info fired");
  assert.equal(e.defaultPrevented, true);
  assert.equal(ha.stats.count["homeassistant.toggle"] || 0, 0, "tap action not run");
});

test("M74: the context menu key on the header runs the hold action", async () => {
  const { card, moreInfo, key } = await device({ tap_action: { action: "none" }, hold_action: { action: "more-info" } });
  const e = key(card._kopf, "ContextMenu");
  assert.deepEqual(moreInfo, ["light.lampe"]);
  assert.equal(e.defaultPrevented, true, "no browser context menu over the action");
});

test("M74: plain Enter keeps the tap action; key repeat and an empty hold action do nothing", async () => {
  const { card, moreInfo, key } = await device({ tap_action: { action: "none" }, hold_action: { action: "more-info" } });
  key(card._kopf, "Enter");
  assert.deepEqual(moreInfo, [], "plain Enter is the tap action (none)");
  key(card._kopf, "Enter", { shiftKey: true, repeat: true });
  assert.deepEqual(moreInfo, [], "held key repeat does not fire again");
  const leer = await device({ hold_action: { action: "none" } });
  const e = leer.key(leer.card._kopf, "ContextMenu");
  assert.deepEqual(leer.moreInfo, []);
  assert.equal(e.defaultPrevented, false, "without hold action the key stays the browser's");
});

test("M74: Shift+Enter on an entity row runs row_hold_action for that row, the row's own tap is swallowed once", async () => {
  const { card, moreInfo, key, clock, env } = await device({ row_hold_action: { action: "more-info" }, row_tap_action: { action: "toggle" } });
  const rahmen = card.querySelectorAll(".dev-zeile").find((r) => r.dataset.entity === "sensor.lampe_leistung");
  assert.ok(rahmen, "row frame");
  const e = key(rahmen.firstChild, "Enter", { shiftKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(moreInfo, ["sensor.lampe_leistung"]);
  assert.equal(card._haltVerbraucht, true, "the row's own tap on keyup is swallowed");
  rahmen.dispatchEvent(new env.KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  await clock.advance(1);
  assert.equal(card._haltVerbraucht, false, "reset after the keyup, no stale swallow");
});

test("M74: a text field inside a row keeps Shift+Enter", async () => {
  const { card, moreInfo, key, env } = await device({ row_hold_action: { action: "more-info" } });
  const rahmen = card.querySelector(".dev-zeile");
  const feld = env.document.createElement("input");
  rahmen.appendChild(feld);
  const e = key(feld, "Enter", { shiftKey: true });
  assert.deepEqual(moreInfo, []);
  assert.equal(e.defaultPrevented, false);
});

test("M74: the keyboard way is documented in the editor helpers (de + en)", async () => {
  const { texte } = await device();
  assert.match(texte.de.helpers.hold_kind, /Umschalt\+Enter/);
  assert.match(texte.de.helpers.row_hold_action, /Kontextmenütaste/);
  assert.match(texte.en.helpers.hold_kind, /Shift\+Enter/);
  assert.match(texte.en.helpers.row_hold_action, /context menu key/);
});
