"use strict";

// Write/read races of the schedule card with the shared test kit (#1283, M12; netcode N3, performance P19).
// The card runs fully (setConfig, set hass, render) on the kit DOM. The kit computes
// an answer when the request arrives, so a delayed `schedule/list` carries the
// server state of its start time, as a slow HA does.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");
const { installSubscriptions, unknownCommand } = require("./abo-attrappe.js");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function plan(id, monday) {
  const item = { id, name: id };
  for (const day of DAYS) item[day] = [];
  item.monday = monday || [{ from: "08:00:00", to: "09:00:00" }];
  return item;
}

/** A kit world with schedules on the server; `schedule/update` replaces the stored item like HA does.
 *  `subscribe: false` is an HA without `schedule/subscribe` (#1326): the card reads `schedule/list` on state changes. */
function world(ids = ["heating"], { subscribe = false } = {}) {
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
  if (subscribe) installSubscriptions(ha, { schedule: () => [...server.values()] });
  else unknownCommand(ha, "schedule/subscribe");
  return { clock, env, ha, server };
}

/**
 * The real card class with its real constructor, loading, saving and
 * visibility handling. Only drawing is stubbed: the kit DOM does not parse
 * the card's innerHTML template. Every status text is recorded.
 */
async function mount(w, id = "heating") {
  const card = w.env.document.createElement("busch-schedule-card");
  card._config = { entity: `schedule.${id}`, first_day: "auto", step: 15, highlight_today: true, read_only: false };
  const statuses = [];
  for (const name of ["_renderAll", "_renderDays", "_renderHeader", "_renderTexte", "_renderNow"]) card[name] = () => {};
  card._renderStatus = (text) => { statuses.push(text); };
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  card.connectedCallback();
  w.ha.onUpdate((hass) => { card.hass = hass; });
  const events = [];
  card.addEventListener("hass-notification", (event) => events.push(event.detail.message));
  await w.clock.advance(50);
  assert.ok(card._model, "card loaded its schedule");
  return { card, events, statuses };
}

/** One drag-created block, the same path a finger takes. */
function drag(card, day, start, end) {
  card._drag = { day, mode: "create", moved: true, preview: { start, end } };
  card._onPointerUp();
}

// Card objects come from the vm realm; plain JSON makes them comparable with deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const ranges = (model, day) => plain((model[day] || []).map((block) => [block.start, block.end]));

for (const subscribe of [false, true]) test(`M12: two quick edits send exactly two schedule/update, one after the other, newest wins${subscribe ? " (subscribed)" : ""}`, async () => {
  const w = world(["heating"], { subscribe });
  const { card } = await mount(w);
  w.ha.behave("schedule/update", { delay: 300 });
  w.ha.resetStats();
  drag(card, "tuesday", 420, 480);
  await w.clock.advance(10);
  drag(card, "wednesday", 600, 660);
  await w.clock.advance(2000);
  const updates = w.ha.log.filter((entry) => entry.type === "schedule/update");
  assert.equal(updates.length, 2, `exactly two schedule/update, got ${updates.length}`);
  assert.ok(updates[1].at >= updates[0].done, "the second update starts only after the first was answered");
  assert.deepEqual(plain(updates[1].message.tuesday), [{ from: "07:00:00", to: "08:00:00" }], "the second update keeps the first edit");
  assert.deepEqual(plain(updates[1].message.wednesday), [{ from: "10:00:00", to: "11:00:00" }], "and carries the newest edit");
  const stored = w.server.get("heating");
  assert.equal(stored.tuesday.length, 1);
  assert.equal(stored.wednesday.length, 1);
  assert.deepEqual(ranges(card._model, "wednesday"), [[600, 660]]);
});

test("M12: an older _load does not overwrite the saved state, and a read skipped while saving is caught up", async () => {
  const w = world();
  const { card } = await mount(w);
  // A state change starts a slow read of the state BEFORE the edit.
  w.ha.behaveOnce("schedule/list", { delay: 500 });
  w.ha.patchState("schedule.heating", { state: "on" });
  await w.clock.advance(10);
  drag(card, "tuesday", 420, 480);
  // While the save runs, another state change arrives; its read is skipped.
  w.ha.patchState("schedule.heating", { state: "off" });
  await w.clock.advance(2000);
  assert.deepEqual(ranges(card._model, "tuesday"), [[420, 480]], "the saved block is still shown");
  const update = w.ha.log.find((entry) => entry.type === "schedule/update");
  assert.ok(update, "the edit was saved");
  const later = w.ha.log.filter((entry) => entry.type === "schedule/list" && entry.id > update.doneSeq);
  assert.ok(later.length >= 1, "a read after the save syncs the card");
});

for (const subscribe of [false, true]) test(`M12: a change made elsewhere between load and save shows the conflict and is not overwritten${subscribe ? " (subscribed)" : ""}`, async () => {
  const w = world(["heating"], { subscribe });
  const { card, events } = await mount(w);
  // Another tab adds a Friday block; this card does not see it yet.
  const foreign = JSON.parse(JSON.stringify(w.server.get("heating")));
  foreign.friday = [{ from: "18:00:00", to: "19:00:00" }];
  w.server.set("heating", foreign);
  w.ha.resetStats();
  drag(card, "tuesday", 420, 480);
  await w.clock.advance(1000);
  assert.equal(w.ha.count("schedule/update"), 0, "the stale edit must not replace the foreign one");
  assert.deepEqual(plain(w.server.get("heating").friday), [{ from: "18:00:00", to: "19:00:00" }]);
  assert.equal(events.length, 1, "one notification");
  assert.equal(events[0], card._texte.fremdGeaendert, "the conflict message");
  assert.deepEqual(ranges(card._model, "friday"), [[1080, 1140]], "the card shows the server state");
  assert.deepEqual(ranges(card._model, "tuesday"), [], "the rejected edit is gone");
});

test("M12/P19: three cards, return to the tab: one schedule/list and no loading status", async () => {
  const w = world(["a", "b", "c"]);
  const cards = [];
  const statuses = [];
  for (const id of ["a", "b", "c"]) {
    const mounted = await mount(w, id);
    cards.push(mounted.card);
    mounted.card._renderStatus = (text) => { statuses.push(text); };
  }
  await w.clock.advance(5000);
  w.ha.resetStats();
  w.env.document.setHidden(true);
  await w.clock.advance(60000);
  w.env.document.setHidden(false);
  await w.clock.advance(100);
  assert.equal(w.ha.count("schedule/list"), 1, `one shared read, got ${w.ha.count("schedule/list")}`);
  const loading = cards[0]._texte.laden;
  assert.ok(!statuses.includes(loading), `no loading status on return: ${JSON.stringify(statuses)}`);
  for (const card of cards) assert.ok(card._model, "every card still shows its schedule");
});
