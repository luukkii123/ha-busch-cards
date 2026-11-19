"use strict";

// M61 (Buschcheck W11): one card header across the family. Card titles use BuschUI.header level 1
// (--ha-card-header-font-size, medium), subtitles the shared subtitle step, group names the one
// level-2 section heading.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");
const { load, fixture } = require("./network-fixture");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const slice = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to, SOURCE.indexOf(from)));

function isLevel1(header, title, name) {
  assert.ok(header.classList ? header.classList.contains("busch-ui-header") : /busch-ui-header/.test(header.className));
  assert.equal(header.getAttribute("role"), "group");
  if (name) assert.equal(header.getAttribute("aria-label"), name);
  assert.match(title.className, /busch-ui-title/);
  assert.equal(title.getAttribute("data-level") ?? title.dataset?.level, "1");
  assert.equal(title.getAttribute("role"), "heading");
}

test("M61: schedule header is BuschUI.header level 1 with the shared subtitle", () => {
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-schedule-card");
  card._config = { entity: "schedule.pool" };
  card._hass = { locale: { language: "de" }, states: { "schedule.pool": { state: "off", attributes: { friendly_name: "Poolpumpe" } } } };
  const mk = (tag = "div") => env.document.createElement(tag);
  card._els = { head: mk(), icon: mk("ha-icon"), name: mk(), sub: mk() };
  card._renderHeader();
  isLevel1(card._els.head, card._els.name, "Poolpumpe");
  assert.ok(card._els.sub.classList.contains("busch-ui-subtitle"));
  const rule = slice("class BuschScheduleCard extends", "</style>").match(/\.head \.name \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /font-size/, "size comes from the shared title step");
});

test("M61: device header is level 1, the group name is the level-2 heading around its toggle", async () => {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, language: "de", globals: { performance: { now: () => clock.now } } });
  env.window.loadCardHelpers = async () => ({
    createCardElement: () => env.document.createElement("div"),
    createRowElement: () => env.document.createElement("div"),
  });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    language: "de",
    extra: { formatEntityState: (state) => state.state },
    states: { "sensor.t": { state: "21", attributes: { friendly_name: "Bad Temperatur" } }, "sensor.h": { state: "50", attributes: { friendly_name: "Bad Feuchte" } } },
    entities: {
      "sensor.t": { entity_id: "sensor.t", device_id: "d", platform: "zha", labels: [] },
      "sensor.h": { entity_id: "sensor.h", device_id: "d", platform: "zha", labels: [] },
    },
    devices: { d: { id: "d", name: "Bad", manufacturer: "LUMI", model: "x", area_id: null, labels: [] } },
  });
  const card = env.document.createElement("busch-device-card");
  card.setConfig({ entity: "sensor.t", start_expanded: true });
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  await clock.advance(100);
  isLevel1(card._titel, card._name, "Bad");
  assert.ok(card._unter.classList.contains("busch-ui-subtitle"));
  const heading = card.querySelector(".dev-gruppe .dev-gruppe-ueberschrift");
  assert.ok(heading, "group heading");
  assert.ok(heading.classList.contains("busch-ui-heading2"));
  assert.equal(heading.getAttribute("role"), "heading");
  assert.equal(heading.getAttribute("aria-level"), "3");
  assert.equal(heading.firstChild.tagName, "BUTTON", "the toggle sits inside the heading");
  const css = slice("const DEV_STIL = `", "`;");
  assert.doesNotMatch(css.match(/\.dev-name \{([^}]*)\}/)[1], /font-size|font-weight/);
  assert.match(css.match(/\.dev-gruppe-kopf \{([^}]*)\}/)[1], /font-size:inherit; font-weight:inherit;/);
});

test("M61: calendar title row carries the level-1 title text", () => {
  assert.match(SOURCE, /<div class="cal-titel-zeile"><div class="cal-titel-text">\$\{calEscape\(this\._config\.title\)\}<\/div><\/div>/);
  assert.match(SOURCE, /BuschUI\.header\(\{ node: titelZeile, titleNode: titelZeile\.firstElementChild, level: 1 \}\)/);
  const rule = slice("const CAL_STIL = `", "`;").match(/\.cal-titel-zeile \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /font-weight/);
});

test("M61: network and FRITZ titles use the level-1 step, not the row size", () => {
  const l = load(), f = fixture(l);
  for (const Card of [l.BuschNetworkCard, l.BuschFritzDeviceCard]) {
    const card = new Card();
    card._core = f.core;
    card.setConfig({ device_id: "router" });
    card._hass = f.hass;
    card._render();
    const all = [];
    (function walk(n) { for (const c of n.children || []) { all.push(c); walk(c); } })(card.shadowRoot);
    const title = all.find((n) => n.tagName === "H2");
    assert.ok(title);
    assert.equal(title.attributes["data-level"], "1");
    card.disconnectedCallback();
  }
  assert.doesNotMatch(SOURCE, /h2,\.client-name\{font-size/);
});
