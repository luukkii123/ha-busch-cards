"use strict";

// Restfund Bildprüfung H (#1321): a device card with a device_id that does not exist showed
// "Kein Gerät gewählt" in the header AND "existiert nicht" below. Now one clear state: the shared
// state block with the cause and the next step; the header with the placeholder text is gone.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

async function device(config, language = "de") {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, language, globals: { performance: { now: () => clock.now } } });
  env.window.loadCardHelpers = async () => ({
    createCardElement: () => env.document.createElement("div"),
    createRowElement: (cfg) => { const row = env.document.createElement("div"); row.textContent = cfg.name; return row; },
  });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_DEVICE_CARD"] });
  const ha = kit.createHass({
    clock, language,
    extra: { formatEntityState: (state) => state.state },
    states: { "light.lampe": { state: "on", attributes: { friendly_name: "Lampe" } } },
    entities: { "light.lampe": { entity_id: "light.lampe", device_id: "d", platform: "hue", labels: [] } },
    devices: { d: { id: "d", name: "Lampe", manufacturer: "Signify", model: "LCT", area_id: null, labels: [] } },
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig(config);
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  await clock.advance(100);
  return { card, clock, ha, t: exposed.TEXTE_BUSCH_DEVICE_CARD[language].texte };
}
const text = (node) => (node?.textContent ?? "") + (node?.children || []).map(text).join("");
const visibleText = (node) => (node?.hidden ? "" : (node?.nodeType === 3 ? node.data : (node?.childNodes || []).map(visibleText).join("")));

test("Restfund H: device_id that does not exist shows one state, not 'no device selected' beside 'does not exist'", async () => {
  const { card, t } = await device({ device_id: "missing" });
  const all = visibleText(card.shadowRoot || card);
  assert.ok(all.includes(t.geraetFehlt), "cause shown");
  assert.ok(!all.includes(t.keineEntitaet), "no 'Kein Gerät gewählt' at the same time");
  assert.equal(card._kopf.hidden, true, "no header with a placeholder name");
  const state = card._hinweis;
  assert.equal(state.attributes["data-kind"], "error");
  assert.match(text(state), new RegExp(t.geraetFehltHinweis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "next step as hint");
});

test("Restfund H: without device and entity the message appears once", async () => {
  const { card, t } = await device({});
  const all = visibleText(card.shadowRoot || card);
  assert.equal(all.split(t.keineEntitaet).length - 1, 1, "once, not in header and state block");
});

test("Restfund H: a configured title stays as header in the error state; a valid device shows the header again", async () => {
  const mit = await device({ device_id: "missing", title: "Flur" });
  assert.equal(mit.card._kopf.hidden, false);
  assert.equal(mit.card._name.textContent, "Flur");
  const { card, ha, clock } = await device({ device_id: "missing" });
  card.setConfig({ device_id: "d" });
  card.hass = ha.hass;
  await clock.advance(100);
  assert.equal(card._kopf.hidden, false, "header back for a real device");
  assert.equal(card._name.textContent, "Lampe");
});

test("Restfund H: hint texts exist in both languages", async () => {
  const de = await device({ device_id: "missing" }, "de");
  const en = await device({ device_id: "missing" }, "en");
  assert.equal(de.t.geraetFehltHinweis, "Im Karteneditor ein anderes Gerät auswählen.");
  assert.equal(en.t.geraetFehltHinweis, "Choose another device in the card editor.");
});

test("Restfund H: the hidden header really disappears (display:flex would beat the UA [hidden] rule)", () => {
  const source = require("node:fs").readFileSync(BUNDLE, "utf8");
  const css = source.slice(source.indexOf("const DEV_STIL = `"), source.indexOf("`;", source.indexOf("const DEV_STIL = `")));
  assert.match(css, /\.dev-kopf\[hidden\]\s*\{\s*display:\s*none;/);
});
