"use strict";

// Calendar reloads and the module-wide month cache with a fake clock (#1283, M39; netcode N14, performance P17).
// Two cards with the same two calendars run fully on the kit DOM. Every
// `GET calendars/...` is one call_api in the kit counters.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const MIN = 60 * 1000;

function world(start) {
  const clock = kit.createClock(start);
  const env = kit.createEnvironment({ clock, globals: { performance } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    states: { "calendar.a": { state: "off", attributes: { friendly_name: "A" } }, "calendar.b": { state: "off", attributes: { friendly_name: "B" } } },
  });
  ha.respond("call_api", () => []);
  return { clock, env, ha };
}

async function mount(w, config = { entities: ["calendar.a", "calendar.b"] }) {
  const card = w.env.document.createElement("busch-calendar-card");
  card.setConfig(config);
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  card.connectedCallback?.();
  w.ha.onUpdate((hass) => { card.hass = hass; });
  await w.clock.advance(50);
  return card;
}

/** Calls per calendar since the last reset. */
function perCalendar(ha) {
  const out = {};
  for (const entry of ha.log) {
    if (entry.kind !== "api") continue;
    const entity = /calendars\/([^?]+)/.exec(entry.message.path)?.[1];
    out[entity] = (out[entity] || 0) + 1;
  }
  return out;
}

test("M39: one fetch per calendar for two cards, on becoming visible and at midnight; none while hidden", async () => {
  // 10 March 2027, 22:07 local time: midnight stays inside the month, so only the timer can cause a fetch.
  const w = world(new Date(2027, 2, 10, 22, 7, 0).getTime());
  const cards = [await mount(w), await mount(w)];
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1, "calendar.b": 1 }, "two cards share one fetch per calendar");
  for (const card of cards) assert.ok(Array.isArray(card._tage), "both cards show the month");

  w.ha.resetStats();
  w.env.document.setHidden(true);
  await w.clock.advance(40 * MIN);
  assert.equal(w.ha.count("call_api"), 0, "no fetch while hidden");

  w.env.document.setHidden(false);
  await w.clock.advance(100);
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1, "calendar.b": 1 }, "becoming visible: one fetch per calendar");

  // To 23:59, then across midnight (the 15-minute ticks fall on :07, :22, :37, :52).
  await w.clock.advance(new Date(2027, 2, 10, 23, 59, 0).getTime() - w.clock.now);
  w.ha.resetStats();
  await w.clock.advance(2 * MIN);
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1, "calendar.b": 1 }, "midnight: one fetch per calendar");

  // The ticks at 00:07 and 00:22 refresh only data older than 15 minutes: 00:07 keeps the midnight result.
  w.ha.resetStats();
  await w.clock.advance(30 * MIN);
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1, "calendar.b": 1 }, "the visible 15-minute tick: one fetch per calendar");

  w.ha.resetStats();
  w.env.document.setHidden(true);
  await w.clock.advance(24 * 60 * MIN);
  assert.equal(w.ha.count("call_api"), 0, "a hidden tab fetches nothing, midnight included");
});

test("M39: a new card with cached calendars shows the month without a fetch", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  await mount(w);
  w.ha.resetStats();
  const later = await mount(w);
  assert.equal(w.ha.count("call_api"), 0, "the cache serves the second card");
  assert.ok(Array.isArray(later._tage));
});

test("M39: a changed last_changed and an own edit fetch again, past the cache", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const [first, second] = [await mount(w), await mount(w)];
  w.ha.resetStats();
  w.ha.patchState("calendar.a", { state: "on", last_changed: new Date(w.clock.now).toISOString() });
  await w.clock.advance(100);
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1 }, "only the changed calendar, once for both cards");

  w.ha.resetStats();
  first._nachEigenerAenderung();
  await w.clock.advance(100);
  assert.deepEqual(perCalendar(w.ha), { "calendar.a": 1, "calendar.b": 1 }, "an own edit reads fresh");
  w.ha.resetStats();
  second._lade();
  await w.clock.advance(100);
  assert.equal(w.ha.count("call_api"), 0, "the other card uses the fresh result");
});

test("M39: retention call counts as in docs/render/calendar-state-retention.py", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const card = await mount(w, { entities: ["calendar.a"], month_offset: 0, show_empty_days: true, title: "Retention" });
  card._versatzLaufend = 1;
  card._render();
  w.ha.resetStats();
  card.setConfig({ ...card._config });
  await w.clock.advance(100);
  assert.equal(card._versatzLaufend, 1);
  assert.equal(w.ha.count("call_api"), 0, "an equal config echo fetches nothing");
  w.ha.patchState("calendar.a", { state: "on", last_changed: new Date(w.clock.now).toISOString() });
  await w.clock.advance(100);
  assert.equal(w.ha.count("call_api"), 1, "a new last_changed fetches the month shown");
  assert.equal(card._versatzLaufend, 1, "the browsed month stays");
});

test("M39: the month cache belongs to one connection; another HA connection fetches its own events", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const other = kit.createHass({ clock: w.clock, states: { "calendar.a": { state: "off", attributes: { friendly_name: "A" } } } });
  other.respond("call_api", () => []);
  const cards = [w.ha.hass, other.hass].map((hass) => {
    const card = w.env.document.createElement("busch-calendar-card");
    card.setConfig({ entities: ["calendar.a"] });
    w.env.document.body.appendChild(card);
    card.hass = hass;
    card.connectedCallback?.();
    return card;
  });
  await w.clock.advance(50);
  assert.deepEqual([w.ha.count("call_api"), other.count("call_api")], [1, 1], "each connection fetches its own events, also while the other fetch runs");
  assert.ok(cards.every((card) => Array.isArray(card._tage)));
});
