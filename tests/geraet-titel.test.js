"use strict";

// M60 (Buschcheck F10/W17, E12): device card name readable on a phone. Up to two lines,
// full text as tooltip, subtitle and entity IDs secondary (tooltip), group headings in
// sentence case, group toggle 24 px icon in a 44 px target with aria-expanded.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const CSS = SOURCE.slice(SOURCE.indexOf("const DEV_STIL = `"), SOURCE.indexOf("`;", SOURCE.indexOf("const DEV_STIL = `")));
const NAME = "Aqara Temperatur- und Luftfeuchtesensor im Badezimmer";

async function device(config = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, language: "de", globals: { performance: { now: () => clock.now } } });
  env.window.loadCardHelpers = async () => ({
    createCardElement: () => env.document.createElement("div"),
    createRowElement: (cfg) => { const row = env.document.createElement("div"); row.textContent = cfg.name; return row; },
  });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    language: "de",
    extra: { formatEntityState: (state) => state.state },
    states: {
      "sensor.aqara_temp": { state: "21", attributes: { friendly_name: `${NAME} Temperatur` } },
      "sensor.aqara_feuchte": { state: "50", attributes: { friendly_name: `${NAME} Luftfeuchte` } },
      "sensor.aqara_rssi": { state: "-60", attributes: { friendly_name: `${NAME} RSSI` } },
    },
    entities: {
      "sensor.aqara_temp": { entity_id: "sensor.aqara_temp", device_id: "d", platform: "zha", labels: [] },
      "sensor.aqara_feuchte": { entity_id: "sensor.aqara_feuchte", device_id: "d", platform: "zha", labels: [] },
      "sensor.aqara_rssi": { entity_id: "sensor.aqara_rssi", device_id: "d", platform: "zha", labels: [], entity_category: "diagnostic" },
    },
    devices: { d: { id: "d", name: NAME, manufacturer: "LUMI", model: "lumi.weather", area_id: null, labels: [] } },
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "sensor.aqara_temp", start_expanded: true, ...config });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  await clock.advance(100);
  return { card, clock };
}

test("M60: the full name and the subtitle are available as tooltips", async () => {
  const { card } = await device();
  assert.equal(card._name.textContent, NAME);
  assert.equal(card._name.title, NAME);
  assert.equal(card._unterText.title, "LUMI · lumi.weather");
});

test("M60: entity IDs are secondary: the row shows the name, the ID is its tooltip", async () => {
  const { card } = await device();
  const rows = card.querySelectorAll(".dev-zeile");
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.equal(row.title, row.dataset.entity);
    assert.ok(!row.textContent.includes(row.dataset.entity), "no raw ID in the row text");
  }
});

test("M60: group heads toggle with aria-expanded; the whole head is the button", async () => {
  const { card } = await device({ groups_open: ["sensor"] });
  const kopf = card.querySelector('.dev-gruppe[data-gruppe="sensor"] .dev-gruppe-kopf');
  assert.equal(kopf.tagName, "BUTTON");
  assert.equal(kopf.getAttribute("aria-expanded"), "true");
  assert.equal(kopf.querySelector(".dev-gruppe-text").textContent, "Sensoren (1)");
  kopf.click();
  assert.equal(kopf.getAttribute("aria-expanded"), "false");
  assert.ok(kopf.parentNode.classList.contains("dev-zu"));
  kopf.click();
  assert.equal(kopf.getAttribute("aria-expanded"), "true");
});

test("M60: CSS: name up to two lines, headings in sentence case, 24 px arrows in 44 px targets", () => {
  const name = CSS.match(/\.dev-name \{([^}]*)\}/)[1];
  assert.match(name, /-webkit-line-clamp:2;/);
  assert.match(name, /overflow-wrap:anywhere;/);
  assert.doesNotMatch(name, /white-space:nowrap/);
  const kopf = CSS.match(/\.dev-gruppe-kopf \{([^}]*)\}/)[1];
  assert.doesNotMatch(kopf, /uppercase|letter-spacing/);
  assert.match(kopf, /min-height:44px;/);
  assert.match(CSS, /\.dev-gruppe-kopf \.dev-gruppe-pfeil \{ width:24px; height:24px; flex:0 0 24px;\s*--mdc-icon-size:24px;/);
  assert.match(CSS, /\.dev-pfeil \{ flex:0 0 44px; width:44px; height:44px;[^}]*--mdc-icon-size:24px;/);
  // Narrow cards drop the integration logo to leave room for the name.
  assert.match(CSS, /@container \(max-width:380px\) \{[^@]*\.dev-brand \{ display:none; \}/);
});
