"use strict";

// The schedule card follows `schedule/subscribe` instead of reading `schedule/list` on every state change (#1326, M12).
// HA 2026.11.1: DictStorageCollectionWebsocket registers `schedule/subscribe` (helpers/collection.py); the first
// event holds every stored plan as `added`, later events the changes. YAML plans are not in it.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");
const { installSubscriptions } = require("./abo-attrappe.js");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function plan(id, monday) {
  const item = { id, name: id };
  for (const day of DAYS) item[day] = [];
  item.monday = monday || [{ from: "08:00:00", to: "09:00:00" }];
  return item;
}

function world(ids = ["heating"], { subscribe = true } = {}) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock });
  kit.loadScript(BUNDLE, { globals: env });
  const states = Object.fromEntries(ids.map((id) => [`schedule.${id}`, { state: "off", attributes: { friendly_name: id, editable: true } }]));
  const ha = kit.createHass({ clock, states });
  const server = new Map(ids.map((id) => [id, plan(id)]));
  ha.respond("schedule/list", () => JSON.parse(JSON.stringify([...server.values()])));
  ha.respond("schedule/update", (msg) => {
    const { type, schedule_id: id, ...rest } = msg;
    void type;
    const next = { id, ...JSON.parse(JSON.stringify(rest)) };
    server.set(id, next);
    return next;
  });
  if (!subscribe) ha.behave("schedule/subscribe", { reject: Object.assign(new Error("Unknown command."), { code: "unknown_command" }) });
  const abo = installSubscriptions(ha, { schedule: () => [...server.values()] });
  return { clock, env, ha, server, abo };
}

async function mount(w, id = "heating") {
  const card = w.env.document.createElement("busch-schedule-card");
  card._config = { entity: `schedule.${id}`, first_day: "auto", step: 15, highlight_today: true, read_only: false };
  const statuses = [];
  for (const name of ["_renderAll", "_renderDays", "_renderHeader", "_renderTexte", "_renderNow"]) card[name] = () => {};
  card._renderStatus = (text) => { statuses.push(text); };
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  card.connectedCallback();
  w.ha.onUpdate((hass) => { if (card.isConnected) card.hass = hass; });
  const events = [];
  card.addEventListener("hass-notification", (event) => events.push(event.detail.message));
  await w.clock.advance(50);
  assert.ok(card._model, "card loaded its schedule");
  return { card, events, statuses };
}

function drag(card, day, start, end) {
  card._drag = { day, mode: "create", moved: true, preview: { start, end } };
  card._onPointerUp();
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const ranges = (model, day) => plain((model[day] || []).map((block) => [block.start, block.end]));

test("M12 abo: three cards share one schedule/subscribe and load without schedule/list", async () => {
  const w = world(["a", "b", "c"]);
  const cards = [];
  for (const id of ["a", "b", "c"]) cards.push((await mount(w, id)).card);
  assert.equal(w.ha.count("schedule/subscribe"), 1, "one subscription per connection");
  assert.equal(w.ha.count("schedule/list"), 0, "the subscription carries the plans");
  assert.deepEqual(plain(w.abo.options("schedule/subscribe")), [{ resubscribe: false }], "the card resubscribes itself after a reconnect");
  for (const card of cards) assert.deepEqual(ranges(card._model, "monday"), [[480, 540]]);
});

test("M12 abo: a state change and a return to the tab poll nothing while the subscription is live", async () => {
  const w = world(["a", "b", "c"]);
  const cards = [];
  const statuses = [];
  for (const id of ["a", "b", "c"]) {
    const mounted = await mount(w, id);
    cards.push(mounted.card);
    mounted.card._renderStatus = (text) => { statuses.push(text); };
  }
  w.ha.resetStats();
  w.ha.patchState("schedule.a", { state: "on" });
  w.ha.patchState("schedule.b", { state: "on" });
  await w.clock.advance(100);
  w.env.document.setHidden(true);
  await w.clock.advance(60000);
  w.env.document.setHidden(false);
  await w.clock.advance(5000);
  assert.deepEqual(plain(w.ha.stats.count), {}, `no request at all: ${JSON.stringify(w.ha.stats.count)}`);
  assert.ok(!statuses.includes(cards[0]._texte.laden), "no loading status on return");
});

test("M12 abo: a change pushed by HA reaches only the card of that plan, without a request", async () => {
  const w = world(["a", "b"]);
  const a = (await mount(w, "a")).card;
  const b = (await mount(w, "b")).card;
  const bModel = b._model;
  w.ha.resetStats();
  const changed = plan("a", [{ from: "06:00:00", to: "07:30:00" }]);
  w.server.set("a", changed);
  w.abo.pushSchedule("updated", changed);
  await w.clock.advance(50);
  assert.deepEqual(ranges(a._model, "monday"), [[360, 450]], "card a shows the new plan");
  assert.equal(b._model, bModel, "card b is untouched");
  assert.deepEqual(plain(w.ha.stats.count), {}, "no request");
});

test("M12 abo: saving still checks a fresh schedule/list, and the own save does not flicker back", async () => {
  const w = world();
  const { card } = await mount(w);
  w.ha.resetStats();
  drag(card, "tuesday", 420, 480);
  await w.clock.advance(1000);
  assert.equal(w.ha.count("schedule/list"), 1, "one fresh read for the conflict check");
  assert.equal(w.ha.count("schedule/update"), 1, "one write");
  const list = w.ha.log.find((entry) => entry.type === "schedule/list");
  const update = w.ha.log.find((entry) => entry.type === "schedule/update");
  assert.ok(list.id < update.id, "the read comes before the write");
  assert.deepEqual(ranges(card._model, "tuesday"), [[420, 480]], "the saved block stays, also before HA pushes it");
  w.abo.pushSchedule("updated", w.server.get("heating"));
  await w.clock.advance(50);
  assert.deepEqual(ranges(card._model, "tuesday"), [[420, 480]], "and after the push");
});

test("M12 abo: a foreign change between push and save still shows the conflict", async () => {
  const w = world();
  const { card, events } = await mount(w);
  const foreign = plain(w.server.get("heating"));
  foreign.friday = [{ from: "18:00:00", to: "19:00:00" }];
  w.server.set("heating", foreign); // stored, but not pushed yet
  drag(card, "tuesday", 420, 480);
  await w.clock.advance(1000);
  assert.equal(w.ha.count("schedule/update"), 0, "the stale edit is not written");
  assert.equal(events[0], card._texte.fremdGeaendert);
  assert.deepEqual(ranges(card._model, "friday"), [[1080, 1140]]);
});

test("M12 abo: reconnect ends the old subscription, subscribes anew and takes the new snapshot", async () => {
  const w = world();
  const { card } = await mount(w);
  w.ha.resetStats();
  w.ha.disconnect();
  w.server.set("heating", plan("heating", [{ from: "10:00:00", to: "11:00:00" }]));
  w.ha.reconnect();
  await w.clock.advance(100);
  assert.equal(w.ha.count("schedule/subscribe"), 1, "subscribed anew");
  assert.equal(w.ha.count("unsubscribe_events"), 1, "the old subscription is ended");
  assert.equal(w.abo.active("schedule/subscribe").length, 1, "exactly one live subscription");
  assert.equal(w.ha.count("schedule/list"), 0);
  assert.deepEqual(ranges(card._model, "monday"), [[600, 660]], "the plan changed while offline is shown");
});

test("M12 abo: the subscription ends when the last card is removed", async () => {
  const w = world(["a", "b"]);
  const a = (await mount(w, "a")).card;
  const b = (await mount(w, "b")).card;
  a.remove();
  a.disconnectedCallback();
  await w.clock.advance(10);
  assert.equal(w.abo.active("schedule/subscribe").length, 1, "card b still needs it");
  b.remove();
  b.disconnectedCallback();
  await w.clock.advance(10);
  assert.equal(w.abo.active("schedule/subscribe").length, 0, "ended with the last card");
  assert.equal(w.ha.count("unsubscribe_events"), 1);
});

test("M12 abo: without schedule/subscribe (older HA) the card reads schedule/list as before", async () => {
  const w = world(["heating"], { subscribe: false });
  const { card } = await mount(w);
  assert.equal(w.ha.count("schedule/list"), 1, "first load from the list");
  await w.clock.advance(1500); // past the one-second shared read
  w.ha.resetStats();
  w.ha.patchState("schedule.heating", { state: "on" });
  await w.clock.advance(2000);
  assert.equal(w.ha.count("schedule/list"), 1, "a state change reads the list");
  assert.ok(card._model);
});

test("M12 abo: a plan missing from the subscription (YAML) falls back to schedule/list", async () => {
  const w = world();
  const yaml = plan("yaml_plan", [{ from: "05:00:00", to: "06:00:00" }]);
  // HA lists only storage plans in both places; here the stand-in lists it to show the fallback read.
  w.ha.respond("schedule/list", () => plain([...w.server.values(), yaml]));
  w.ha.patchState("schedule.yaml_plan", { state: "off", attributes: { editable: false } });
  const { card } = await mount(w, "yaml_plan");
  assert.equal(w.ha.count("schedule/list"), 1, "one fallback read");
  assert.deepEqual(ranges(card._model, "monday"), [[300, 360]]);
});
