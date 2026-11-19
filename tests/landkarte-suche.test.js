"use strict";

// M66 (#1321, P20): the map card finds `ha-map.leafletMap` event-driven (whenDefined, updateComplete,
// MutationObserver) instead of a 250 ms search loop; the loop stays only as fallback.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");

/** MutationObserver stand-in: `notify()` delivers one batch to every connected observer. */
function observerKit() {
  const live = new Set();
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.targets = []; }
    observe(target) { this.targets.push(target); live.add(this); }
    disconnect() { this.targets = []; live.delete(this); }
  }
  return { MutationObserver, live, notify: () => { for (const o of [...live]) queueMicrotask(() => o.cb([], o)); } };
}

/** A card with an inner HA map card whose `ha-map` gets its Leaflet map only later, as in HA. */
function setup({ observer = true } = {}) {
  const obs = observerKit();
  const env = kit.createEnvironment({ globals: observer ? { MutationObserver: obs.MutationObserver } : {} });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-map-card");
  card._config = { map_style: "osm" };
  const inner = env.document.createElement("hui-map-card");
  inner.attachShadow({ mode: "open" });
  inner.updateComplete = Promise.resolve(true);
  card._inner = inner;
  const applied = [];
  card._applyTiles = () => { applied.push(env.clock.now); return !!card._haMap?.leafletMap; };
  const start = env.clock.now;
  /** HA's order: the element is defined and rendered, Leaflet builds its panes (DOM mutation),
   *  and `leafletMap` is assigned after that, once the async setup resumes. */
  const leafletAt = async (ms) => {
    await env.clock.advance(ms);
    const haMap = env.document.createElement("ha-map");
    haMap.attachShadow({ mode: "open" });
    inner.shadowRoot.appendChild(haMap);
    if (!env.customElements.get("ha-map")) env.customElements.define("ha-map", class {});
    obs.notify();
    await kit.createClock().flush();
    haMap.leafletMap = { leaflet: true };
    obs.notify();
    return haMap;
  };
  return { env, card, inner, applied, start, leafletAt, obs };
}

test("M66: tile style is applied within 100 ms after ha-map.leafletMap appears, no 250 ms loop", async () => {
  const { env, card, applied, start, leafletAt, obs } = setup();
  card._sucheKarte();
  await leafletAt(40);
  await env.clock.advance(60);
  assert.ok(card._haMap?.leafletMap, "ha-map found");
  assert.ok(applied.length && applied[0] - start <= 100, `applied after ${applied[0] - start} ms`);
  assert.equal(obs.live.size, 0, "observer disconnected after success");
  assert.equal(env.clock.pending(), 0, "no search timer left after success");
});

test("M66: a found map is not searched again (one application, then quiet)", async () => {
  const { env, card, applied, leafletAt } = setup();
  card._sucheKarte();
  await leafletAt(10);
  await env.clock.advance(20);
  const n = applied.length;
  await env.clock.advance(5000);
  assert.equal(applied.length, n, "no further checks after success");
});

test("M66: without MutationObserver the 250 ms loop stays as fallback", async () => {
  const { env, card, start, leafletAt } = setup({ observer: false });
  card._sucheKarte();
  await leafletAt(40);
  await env.clock.advance(100);
  assert.equal(card._haMap, null, "the loop has not looked again yet");
  await env.clock.advance(200);
  assert.ok(card._haMap?.leafletMap, "found by the fallback loop");
  assert.ok(env.clock.now - start >= 250);
});

test("M66: no ha-map within 10 s leaves HA's tiles alone, warns once and stops", async () => {
  const { env, card, obs } = setup();
  card._sucheKarte();
  await env.clock.advance(9000);
  assert.equal(env.logs.filter((l) => l.level === "warn").length, 0);
  await env.clock.advance(1100);
  const warns = env.logs.filter((l) => l.level === "warn");
  assert.equal(warns.length, 1);
  assert.match(String(warns[0].args[0]), /leafletMap/);
  assert.equal(obs.live.size, 0, "observer disconnected");
  assert.equal(env.clock.pending(), 0, "no timer left");
});

test("M66: a rebuild cancels the earlier search", async () => {
  const { env, card, obs } = setup();
  card._sucheKarte();
  card._sucheKarte();
  assert.equal(obs.live.size, 1, "only the newest observer is connected");
  await env.clock.advance(10100);
  assert.equal(env.logs.filter((l) => l.level === "warn").length, 1, "one warning, not one per search");
});
