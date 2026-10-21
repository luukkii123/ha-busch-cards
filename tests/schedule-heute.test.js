'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ladeKarte } = require('./laden');


// Minimal DOM: just enough for _renderNow (rows, label, track, line).
function element(cls) {
  const el = {
    className: cls || '', dataset: {}, style: {}, children: [], attrs: {}, title: '',
    classList: {
      set: new Set(cls ? [cls] : []),
      toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); },
      contains(name) { return this.set.has(name); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    append(child) { this.remove.call(child); child.parent = this; this.children.push(child); },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    get lastElementChild() { return this.children[this.children.length - 1] || null; },
    querySelector(sel) {
      const want = sel.replace(':scope > ', '').replace('.', '');
      return this.children.find((c) => c.className === want) || null;
    },
    querySelectorAll(sel) {
      const want = sel.replace(':scope > ', '').replace('.', '');
      return this.children.filter((c) => c.className === want);
    },
  };
  return el;
}

const lade = () => ladeKarte(
  ['BuschScheduleCard', 'scheduleNow', 'SCHEMA_BUSCH_SCHEDULE_CARD', 'TEXTE_BUSCH_SCHEDULE_CARD'],
  { navigator: { language: 'de' }, document: { createElement: () => element() } },
);

function karte(config) {
  const l = lade();
  const card = Object.create(l.BuschScheduleCard.prototype);
  card._hass = { locale: { language: 'de' }, states: { 'schedule.test': { attributes: {} } } };
  card._config = { entity: 'schedule.test', highlight_today: true, read_only: false, ...config };
  const days = element('days');
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    const row = element('day');
    row.dataset.day = day;
    row.append(element('label'));
    const track = element('track');
    track.append(element('block'));
    row.append(track);
    days.append(row);
  }
  card._els = { days };
  return { l, card, days, labels: Object.fromEntries(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((long, i) => [['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i], { long }])) };
}

test('scheduleNow maps browser time to weekday and minute', () => {
  const { scheduleNow } = lade();
  // 21.10.2026 is a Wednesday.
  const now = scheduleNow({ locale: {} }, new Date(2026, 9, 21, 13, 45));
  assert.equal(now.day, 'wednesday');
  assert.equal(now.minute, 13 * 60 + 45);
  assert.equal(scheduleNow(null, new Date(2026, 9, 25, 0, 0)).day, 'sunday');
});

test('scheduleNow follows the server time zone when HA is set to server time', () => {
  const { scheduleNow } = lade();
  // 23:30 UTC on a Tuesday is already Wednesday 01:30 in Vienna (CEST).
  const date = new Date(Date.UTC(2026, 9, 20, 23, 30));
  const now = scheduleNow({ locale: { time_zone: 'server' }, config: { time_zone: 'Europe/Vienna' } }, date);
  assert.equal(now.day, 'wednesday');
  assert.equal(now.minute, 90);
  const fallback = scheduleNow({ locale: { time_zone: 'server' }, config: { time_zone: 'Not/AZone' } }, date);
  assert.equal(fallback.day, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][(date.getDay() + 6) % 7]);
});

test('today row is marked and gets exactly one time line as last track child', () => {
  const { card, days, labels } = karte();
  card._renderNow(labels);
  card._renderNow(labels); // second pass must not duplicate the line
  const today = days.children.find((row) => row.classList.contains('today'));
  const todayName = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][(new Date().getDay() + 6) % 7];
  assert.equal(today.dataset.day, todayName);
  const track = today.querySelector('.track');
  assert.equal(track.querySelectorAll('.now').length, 1);
  assert.equal(track.lastElementChild.className, 'now');
  assert.match(track.lastElementChild.style.left, /%$/);
  assert.equal(track.attrs['aria-label'], `${labels[todayName].long}, heute`);
  const others = days.children.filter((row) => row !== today);
  for (const row of others) {
    assert.equal(row.classList.contains('today'), false);
    assert.equal(row.querySelector('.track').querySelectorAll('.now').length, 0);
  }
});

test('highlight_today false removes marker and line', () => {
  const { card, days, labels } = karte();
  card._renderNow(labels);
  card._config.highlight_today = false;
  card._renderNow(labels);
  for (const row of days.children) {
    assert.equal(row.classList.contains('today'), false);
    assert.equal(row.querySelector('.track').querySelectorAll('.now').length, 0);
  }
});

test('setConfig defaults: highlight on, read only off; explicit values win', () => {
  const l = lade();
  const card = Object.create(l.BuschScheduleCard.prototype);
  card._build = () => {};
  card.setConfig({ entity: 'schedule.a' });
  assert.equal(card._config.highlight_today, true);
  assert.equal(card._config.read_only, false);
  const second = Object.create(l.BuschScheduleCard.prototype);
  second._build = () => {};
  second.setConfig({ entity: 'schedule.a', highlight_today: false, read_only: true });
  assert.equal(second._config.highlight_today, false);
  assert.equal(second._config.read_only, true);
});

test('read_only locks the card even for an editable schedule', async () => {
  const { card } = karte({ read_only: true });
  assert.equal(card._yamlOnly, false);
  assert.equal(card._readonly, true);
  let calls = 0;
  card._hass.callWS = async () => { calls++; };
  card._item = { name: 'x' };
  card._scheduleId = 'id';
  card._model = { monday: [{ start: 0, end: 60 }] };
  await card._save();
  card._dayTarget = 'monday';
  card._renderDays = () => { throw new Error('must not redraw'); };
  card._applyDayAction('all');
  assert.equal(calls, 0);
  assert.deepEqual(card._model.tuesday, undefined);
  let opened = false;
  card._dialogOeffnen = () => { opened = true; };
  card._openDayDialog('monday');
  card._openNewBlockDialog('monday');
  card._openBlockDialog('monday', 0);
  assert.equal(opened, false);
});

test('hint distinguishes YAML lock, configured lock and editable', () => {
  const { card, l } = karte();
  const hint = { textContent: '', classList: { add() {}, remove() {} } };
  card._els.hint = hint;
  card._els.status = { textContent: '' };
  const texte = l.TEXTE_BUSCH_SCHEDULE_CARD.de.texte;
  card._renderStatus('');
  assert.equal(hint.textContent, texte.hinweisZiehen);
  card._config.read_only = true;
  card._renderStatus('');
  assert.equal(hint.textContent, texte.hinweisSchreibschutz);
  card._hass.states['schedule.test'].attributes.editable = false;
  card._renderStatus('');
  assert.equal(hint.textContent, texte.hinweisNurLesen);
});

test('both new options have editor fields with labels and helpers in both languages', () => {
  const { SCHEMA_BUSCH_SCHEDULE_CARD: schema, TEXTE_BUSCH_SCHEDULE_CARD: texte } = lade();
  for (const name of ['highlight_today', 'read_only']) {
    assert.ok(schema.some((field) => field.name === name && field.selector.boolean), name);
    for (const sprache of ['de', 'en']) {
      assert.ok(texte[sprache].labels[name], `${sprache} label ${name}`);
      assert.match(texte[sprache].helpers[name], /\.$/, `${sprache} helper ${name}`);
    }
  }
});
