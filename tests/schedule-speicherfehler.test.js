'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ladeKarte } = require('./laden');

// A rejected schedule/update must fall back to the last state HA confirmed,
// not to the edited model (masterplan M2, netcode N1).

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const lade = () => ladeKarte(['BuschScheduleCard'], {
  navigator: { language: 'en' },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
});

/** The schedule as HA stores it: one block on Monday morning. */
function serverItem() {
  const item = { id: 'sched_1', name: 'Heating' };
  for (const day of DAYS) item[day] = [];
  item.monday = [{ from: '08:00:00', to: '09:00:00' }];
  return item;
}

/** A card with stubbed drawing and a fake hass whose answers the test sets. */
function karte() {
  const l = lade();
  const card = Object.create(l.BuschScheduleCard.prototype);
  const server = serverItem();
  const calls = [];
  const events = [];
  let rejectNextUpdate = true;
  card._hass = {
    locale: { language: 'en' },
    states: { 'schedule.heating': { attributes: {} } },
    async callWS(msg) {
      calls.push(JSON.parse(JSON.stringify(msg)));
      if (msg.type === 'schedule/list') return [JSON.parse(JSON.stringify(server))];
      if (msg.type === 'schedule/update') {
        if (rejectNextUpdate) {
          rejectNextUpdate = false;
          throw new Error('update rejected');
        }
        return {};
      }
      throw new Error(`unexpected ${msg.type}`);
    },
  };
  card._config = { entity: 'schedule.heating', read_only: false, step: 15 };
  card._scheduleId = 'sched_1';
  card._loadGeneration = 0;
  card._blockKeyCounter = 0;
  card._dialogTarget = null;
  card._els = null;
  card._renderAll = () => {};
  card._renderDays = () => {};
  card._renderStatus = () => {};
  card.dispatchEvent = (event) => { events.push(event); };
  card._acceptScheduleItem(serverItem());
  return { card, calls, events };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const ranges = (model) => Object.fromEntries(DAYS.map((day) =>
  [day, (model[day] || []).map((block) => [block.start, block.end])]));

test('a rejected schedule/update restores the confirmed state and does not resend the block', async () => {
  const { card, calls, events } = karte();
  const before = ranges(card._model);

  // Drag a new block on Monday 10:00-11:00; the drag mutates _model first.
  card._drag = { day: 'monday', mode: 'create', moved: true, preview: { start: 600, end: 660 } };
  card._onPointerUp();
  await flush();

  const update = calls.find((msg) => msg.type === 'schedule/update');
  assert.ok(update, 'the drag tried to save');
  assert.equal(update.monday.length, 2, 'the rejected update carried the new block');
  assert.deepEqual(ranges(card._model), before, '_model is the state before the drag');
  assert.equal(events.filter((event) => event.type === 'hass-notification').length, 1);
  assert.ok(calls.some((msg) => msg.type === 'schedule/list'), 'the card re-reads the server state');

  // The next edit, on another day, succeeds and must not carry the rejected block.
  card._drag = { day: 'tuesday', mode: 'create', moved: true, preview: { start: 420, end: 480 } };
  card._onPointerUp();
  await flush();

  const next = calls.filter((msg) => msg.type === 'schedule/update')[1];
  assert.ok(next, 'the second edit saved');
  assert.deepEqual(next.monday, [{ from: '08:00:00', to: '09:00:00' }]);
  assert.deepEqual(next.tuesday, [{ from: '07:00:00', to: '08:00:00' }]);
});
