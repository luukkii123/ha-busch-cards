"use strict";

// M27 (Buschcheck W3/F4): one state block for loading, empty, error and offline in every card
// of busch-cards, each card with a live region, and the network error replaces the loading line.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");
const { load, fixture } = require("./network-fixture");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");

const walk = (node, out = []) => {
  for (const child of node?.children || []) { out.push(child); walk(child, out); }
  return out;
};
const regions = (root) => walk(root).filter((n) => ["status", "alert"].includes(n.attributes?.role) && n.attributes?.["aria-live"]);
const stateOf = (root, kind) => walk(root).find((n) => String(n.className || "").split(/\s+/).includes("busch-state") && n.attributes?.["data-kind"] === kind);
const text = (node) => (node?.textContent ?? "") + (node?.children || []).map(text).join("");

test("M27: a network configuration error replaces the loading line, no loading text beside it", () => {
  const l = load(), f = fixture(l), card = new l.BuschNetworkCard();
  card.setConfig({ filter: { include: [{ cidr: "bad/99" }] } });
  card._core = null;
  card.hass = f.hass;
  card._render();
  const root = card.shadowRoot;
  const error = stateOf(root, "error");
  assert.ok(error, "error state block present");
  assert.equal(error.attributes.role, "alert");
  assert.equal(error.attributes["aria-live"], "assertive");
  assert.match(text(error), /CIDR/);
  assert.equal(stateOf(root, "loading"), undefined, "no loading state next to the error");
  assert.ok(!text(root).includes(l.BUSCH_NETWORK_TEXT.en.loading), "loading text gone");
});

test("M27: without core the network card shows one loading state block as a live region", () => {
  const l = load(), f = fixture(l), card = new l.BuschNetworkCard();
  card.setConfig({});
  card._core = null;
  card.hass = f.hass;
  card._render();
  const loading = stateOf(card.shadowRoot, "loading");
  assert.ok(loading);
  assert.equal(loading.attributes.role, "status");
  assert.equal(loading.attributes["aria-busy"], "true");
  assert.equal(stateOf(card.shadowRoot, "error"), undefined);
});

test("M27: network and FRITZ cards keep the same live region node across rebuilds", () => {
  for (const kind of ["BuschNetworkCard", "BuschFritzDeviceCard"]) {
    const l = load(), f = fixture(l), card = new l[kind]();
    card._core = f.core;
    card.setConfig({ device_id: "router" });
    card._hass = f.hass;
    card._render();
    const first = regions(card.shadowRoot);
    assert.ok(first.length >= 1, kind + " has a live region");
    const node = card._stateNode;
    card._error = "failed";
    card._render();
    assert.equal(card._stateNode, node, kind + " updates its region in place");
    assert.equal(node.attributes["data-kind"], "error");
    assert.equal(node.attributes.role, "alert");
    card.disconnectedCallback();
  }
});

test("M27: FRITZ card without a device shows an empty state that names the editor step", () => {
  const l = load(), f = fixture(l), card = new l.BuschFritzDeviceCard();
  card._core = f.core;
  card.setConfig({});
  card._hass = f.hass;
  card._render();
  const empty = stateOf(card.shadowRoot, "empty");
  assert.ok(empty);
  assert.match(text(empty), /FRITZ/);
  card.disconnectedCallback();
});

test("M27: an empty network client list uses the shared empty state block", () => {
  const l = load(), f = fixture(l), card = new l.BuschNetworkCard();
  card._core = f.core;
  card.setConfig({ filter: { include: [{ name: "nothing-matches-this" }] } });
  card._hass = f.hass;
  card._render();
  const empty = stateOf(card.shadowRoot, "empty");
  assert.ok(empty, "empty state block");
  assert.equal(empty.attributes.role, "status");
  assert.match(text(empty), new RegExp(l.BUSCH_NETWORK_TEXT.en.empty));
  card.disconnectedCallback();
});

function device(config) {
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({ states: { "light.lamp": { state: "on", attributes: { friendly_name: "Lamp" } } }, entities: {}, devices: {} });
  const card = env.document.createElement("busch-device-card");
  card.setConfig(config);
  env.document.body.appendChild(card);
  card.hass = ha.hass;
  card.connectedCallback?.();
  return { env, card };
}

test("M27: device card has its live region from the start and fills it with the error block", async () => {
  const { env, card } = device({ entity: "light.missing" });
  await env.clock.advance(50);
  const region = card._hinweis;
  assert.ok(region, "region exists");
  assert.equal(region.hidden, false, "region is never display:none");
  const error = stateOf(card, "error");
  assert.equal(error, region, "the error lands in the persistent region");
  assert.equal(region.attributes.role, "alert");
  assert.ok(text(region).length > 0);
});

test("M27: calendar card keeps one state region for loading, empty and all-failed", async () => {
  const env = kit.createEnvironment({ language: "de" });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_CALENDAR_CARD"] });
  const card = env.document.createElement("busch-calendar-card");
  card.setConfig({ entities: [] });
  const region = card._zustand;
  assert.ok(region);
  assert.equal(region.attributes["data-kind"], "empty");
  assert.match(text(region), new RegExp(exposed.TEXTE_BUSCH_CALENDAR_CARD.de.texte.keinKalender));
  card._config.entities = [{ entity: "calendar.a" }];
  card._tage = null;
  card._render();
  assert.equal(card._zustand, region, "same node");
  assert.equal(region.attributes["data-kind"], "loading");
  card._tage = [];
  card._fehler = ["calendar.a"];
  card._render();
  assert.equal(region.attributes["data-kind"], "error");
  assert.equal(region.attributes.role, "alert");
  assert.doesNotMatch(card._koerper.innerHTML, /cal-hinweis/, "the failure is not repeated in the hint line");
  card._fehler = [];
  card._render();
  assert.equal(region.attributes["data-kind"], "empty");
});

test("M27: schedule card shows first load and error in the state region, error offers a reload", async () => {
  const env = kit.createEnvironment({ language: "de" });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_SCHEDULE_CARD"] });
  const t = exposed.TEXTE_BUSCH_SCHEDULE_CARD.de.texte;
  const card = env.document.createElement("busch-schedule-card");
  card._hass = { locale: { language: "de" }, states: { "schedule.test": { state: "off", attributes: {} } } };
  card._config = { entity: "schedule.test" };
  const mk = () => env.document.createElement("div");
  card._els = { status: mk(), zustand: mk(), hint: mk() };
  let loads = 0;
  card._load = () => { loads++; };
  card._renderStatus(t.laden);
  assert.equal(card._els.zustand.attributes["data-kind"], "loading");
  assert.equal(card._els.status.textContent, "", "no second loading line in the header");
  card._error = "kaputt";
  card._renderStatus("");
  const zustand = card._els.zustand;
  assert.equal(zustand.attributes["data-kind"], "error");
  assert.equal(zustand.attributes.role, "alert");
  const button = walk(zustand).find((n) => n.tagName === "BUTTON");
  assert.ok(button, "reload button");
  assert.equal(button.getAttribute("aria-label"), t.erneutLaden);
  button.click();
  assert.equal(loads, 1);
  card._error = null;
  card._model = {};
  card._renderStatus(t.speichernLaeuft);
  assert.equal(card._els.status.textContent, t.speichernLaeuft, "with a plan the header status stays");
  assert.ok(!String(zustand.className).includes("busch-state"), "region cleared");
  assert.equal(zustand.attributes.role, "status");
  assert.match(SOURCE, /<div class="status" role="status" aria-live="polite"><\/div>/);
  assert.match(SOURCE, /<div class="zustand busch-zustand" role="status" aria-live="polite"><\/div>/);
  for (const lang of ["de", "en"]) assert.ok(exposed.TEXTE_BUSCH_SCHEDULE_CARD[lang].texte.erneutLaden, lang);
});

test("M27: map card holds a loading region in its own ha-card and turns it into the error in place", async () => {
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-map-card");
  const built = card._build();
  const wrap = card.shadowRoot.querySelector(".wrap");
  const region = wrap.querySelector(".zustand");
  assert.ok(region && region.closest("ha-card"), "region inside an own ha-card");
  assert.equal(region.attributes["data-kind"], "loading");
  await built;
  assert.equal(wrap.querySelector(".zustand"), region, "same node after the failure");
  assert.equal(region.attributes["data-kind"], "error");
  assert.equal(region.attributes.role, "alert");
  assert.ok(region.classList.contains("fehler"));
});

test("M27: smart entities show errors as the shared alert block", () => {
  const env = kit.createEnvironment({ language: "en" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-smart-entities");
  card._message("Broken filter");
  const error = stateOf(card.shadowRoot, "error");
  assert.ok(error);
  assert.equal(error.attributes.role, "alert");
  assert.match(text(error), /Broken filter/);
});
