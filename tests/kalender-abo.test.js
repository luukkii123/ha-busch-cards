"use strict";

// The calendar card follows `calendar/event/subscribe` per shown month and calendar instead of a 15-minute poll
// (#1326, M39). HA 2026.11.1 (calendar/__init__.py handle_calendar_event_subscribe): `entity_id`, `start`, `end`;
// the first event goes to the new subscriber at once, later events after each state write of the entity.
// REST (`calendars/<entity>`) stays the fallback for errors and older HA.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");
const { installSubscriptions } = require("./abo-attrappe.js");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const MIN = 60 * 1000;

function event(summary, day) {
  return { summary, start: { dateTime: `2027-03-${day}T10:00:00+00:00` }, end: { dateTime: `2027-03-${day}T11:00:00+00:00` }, uid: `${summary}-uid` };
}

function world(start, { subscribe = true } = {}) {
  const clock = kit.createClock(start);
  const env = kit.createEnvironment({ clock, globals: { performance } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({
    clock,
    states: { "calendar.a": { state: "off", attributes: { friendly_name: "A" } }, "calendar.b": { state: "off", attributes: { friendly_name: "B" } } },
  });
  const data = { "calendar.a": [event("Arzt", "12")], "calendar.b": [event("Sport", "14")] };
  ha.respond("call_api", ({ path: url }) => data[/calendars\/([^?]+)/.exec(url)[1]] || []);
  if (!subscribe) ha.behave("calendar/event/subscribe", { reject: Object.assign(new Error("Unknown command."), { code: "unknown_command" }) });
  const abo = installSubscriptions(ha, { calendar: (entity) => data[entity] || [] });
  return { clock, env, ha, abo, data };
}

async function mount(w, config = { entities: ["calendar.a", "calendar.b"] }) {
  const card = w.env.document.createElement("busch-calendar-card");
  card.setConfig(config);
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  card.connectedCallback?.();
  w.ha.onUpdate((hass) => { if (card.isConnected) card.hass = hass; });
  await w.clock.advance(50);
  return card;
}

const summaries = (card) => JSON.parse(JSON.stringify((card._alleTermine || []).map((t) => t.summary).sort()));
const windows = (w) => w.abo.active("calendar/event/subscribe").map((m) => `${m.entity_id} ${m.start} ${m.end}`).sort();

test("M39 abo: two cards share one subscription per calendar and month, no REST fetch", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const cards = [await mount(w), await mount(w)];
  assert.equal(w.ha.count("calendar/event/subscribe"), 2, "one per calendar");
  assert.equal(w.ha.count("call_api"), 0, "no REST fetch");
  const start = new Date(2027, 2, 1).toISOString(), end = new Date(2027, 2, 31, 23, 59, 59, 999).toISOString();
  assert.deepEqual(windows(w), [`calendar.a ${start} ${end}`, `calendar.b ${start} ${end}`], "the shown month");
  assert.ok(w.abo.options("calendar/event/subscribe").every((o) => o && o.resubscribe === false));
  for (const card of cards) assert.deepEqual(summaries(card), ["Arzt", "Sport"]);
  assert.equal(cards[0]._alleTermine.find((t) => t.summary === "Arzt").start.dateTime, "2027-03-12T10:00:00+00:00", "the websocket form becomes the REST form");
});

test("M39 abo: no poll while subscribed: 15-minute tick, becoming visible, state change, midnight in the month", async () => {
  const w = world(new Date(2027, 2, 10, 22, 7, 0).getTime());
  await mount(w);
  await mount(w);
  w.ha.resetStats();
  await w.clock.advance(40 * MIN);
  w.env.document.setHidden(true);
  await w.clock.advance(10 * MIN);
  w.env.document.setHidden(false);
  w.ha.patchState("calendar.a", { state: "on", last_changed: new Date(w.clock.now).toISOString() });
  await w.clock.advance(3 * 60 * MIN);
  assert.deepEqual(JSON.parse(JSON.stringify(w.ha.stats.count)), {}, `no request at all: ${JSON.stringify(w.ha.stats.count)}`);
});

test("M39 abo: a pushed change reaches both cards without a request", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const cards = [await mount(w), await mount(w)];
  w.ha.resetStats();
  w.data["calendar.a"] = [event("Arzt", "12"), event("Neu", "20")];
  w.abo.pushCalendar("calendar.a");
  await w.clock.advance(50);
  for (const card of cards) assert.deepEqual(summaries(card), ["Arzt", "Neu", "Sport"]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.ha.stats.count)), {});
});

test("M39 abo: changing the month ends the old subscriptions and subscribes the new month", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const card = await mount(w);
  w.ha.resetStats();
  card._blaettern(1);
  await w.clock.advance(50);
  assert.equal(w.ha.count("calendar/event/subscribe"), 2, "the new month, once per calendar");
  assert.equal(w.ha.count("unsubscribe_events"), 2, "the old month ended");
  const start = new Date(2027, 3, 1).toISOString();
  assert.ok(windows(w).every((line) => line.includes(start)), `only April is live: ${windows(w)}`);
  assert.equal(w.ha.count("call_api"), 0);
});

test("M39 abo: midnight into a new month moves the subscription", async () => {
  const w = world(new Date(2027, 2, 31, 23, 58, 0).getTime());
  await mount(w);
  w.ha.resetStats();
  await w.clock.advance(5 * MIN);
  assert.equal(w.ha.count("calendar/event/subscribe"), 2);
  assert.equal(w.ha.count("unsubscribe_events"), 2);
  assert.ok(windows(w).every((line) => line.includes(new Date(2027, 3, 1).toISOString())));
});

test("M39 abo: removing the cards ends every subscription", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const cards = [await mount(w), await mount(w)];
  cards[0].remove();
  cards[0].disconnectedCallback();
  await w.clock.advance(10);
  assert.equal(windows(w).length, 2, "the other card still needs them");
  cards[1].remove();
  cards[1].disconnectedCallback();
  await w.clock.advance(10);
  assert.equal(windows(w).length, 0, "all ended");
  assert.equal(w.ha.count("unsubscribe_events"), 2);
});

test("M39 abo: reconnect subscribes anew and shows what changed while offline", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const card = await mount(w);
  w.ha.resetStats();
  w.ha.disconnect();
  w.data["calendar.b"] = [];
  w.ha.reconnect();
  await w.clock.advance(100);
  assert.equal(w.ha.count("calendar/event/subscribe"), 2, "both calendars subscribed anew");
  assert.equal(w.ha.count("unsubscribe_events"), 2, "the old subscriptions ended");
  assert.equal(windows(w).length, 2);
  assert.deepEqual(summaries(card), ["Arzt"]);
  assert.equal(w.ha.count("call_api"), 0);
});

test("M39 abo: older HA without the command falls back to REST", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime(), { subscribe: false });
  const card = await mount(w);
  assert.equal(w.ha.count("call_api"), 2, "one REST fetch per calendar");
  assert.deepEqual(summaries(card), ["Arzt", "Sport"]);
});

test("M39 abo: a failed push (events: null) fetches that calendar by REST", async () => {
  const w = world(new Date(2027, 2, 10, 12, 0, 0).getTime());
  const card = await mount(w);
  w.ha.resetStats();
  w.abo.pushCalendar("calendar.a", null);
  await w.clock.advance(50);
  assert.equal(w.ha.count("call_api"), 1, "REST for the failed calendar only");
  assert.deepEqual(summaries(card), ["Arzt", "Sport"]);
  assert.deepEqual(JSON.parse(JSON.stringify(card._fehler)), []);
});
