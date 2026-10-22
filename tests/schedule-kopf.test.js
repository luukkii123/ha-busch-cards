'use strict';
// Kopfzeile der Zeitplan-Karte: `next_event` lokalisiert, relativ/absolut wie
// der Rest der Karte (HH:MM, Wochentagsnamen), nie als roher ISO-Text und nie
// über HAs generischen Attributformatierer (der liefert „23. Oktober 2026 um
// 12:00:00“ bzw. den Rohwert, wenn sein Zeitstempel-Muster nicht greift).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ladeKarte } = require('./laden');

// Feste Uhr in der Sandbox: `new Date()` ohne Argument liefert JETZT.
const uhr = (jetzt) => class extends Date {
  constructor(...a) { super(...(a.length ? a : [jetzt.getTime()])); }
  static now() { return jetzt.getTime(); }
};
const lade = (jetzt = new Date()) => ladeKarte(
  ['BuschScheduleCard', 'scheduleNextLabel', 'TEXTE_BUSCH_SCHEDULE_CARD'],
  { navigator: { language: 'de' }, Date: uhr(jetzt) },
);

function els() {
  const node = () => ({ textContent: '', title: '', attrs: {}, classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
  return { head: node(), icon: node(), name: node(), sub: node() };
}

function kopf(next, { language = 'de', state = 'off', now } = {}) {
  const l = lade(now);
  const card = Object.create(l.BuschScheduleCard.prototype);
  card._config = { entity: 'schedule.test' };
  card._hass = {
    locale: { language, time_zone: 'server' },
    config: { time_zone: 'Europe/Vienna' },
    // Simuliert den beobachteten Fehlfall: HA gibt den Rohwert zurück.
    formatEntityAttributeValue: (s, attr) => s.attributes[attr],
    states: { 'schedule.test': { state, attributes: { friendly_name: 'Test', next_event: next } } },
  };
  card._els = els();
  card._renderHeader();
  return card._els.sub;
}

// 22.10.2026 10:00 Wiener Zeit
const JETZT = new Date('2026-10-22T08:00:00Z');

test('heute: nur Uhrzeit HH:MM, kein ISO-Text', () => {
  const sub = kopf('2026-10-22T18:30:00+02:00', { now: JETZT });
  assert.equal(sub.textContent, 'Aus · ab 18:30');
  assert.doesNotMatch(sub.textContent, /\d{4}-\d{2}-\d{2}T/);
});

test('morgen: relativ „morgen“ plus Uhrzeit', () => {
  const sub = kopf('2026-10-23T06:00:00+02:00', { now: JETZT, state: 'on' });
  assert.equal(sub.textContent, 'Ein · bis morgen 06:00');
});

test('innerhalb einer Woche: Wochentag plus Uhrzeit', () => {
  const sub = kopf('2026-10-26T07:15:00+01:00', { now: JETZT });
  assert.equal(sub.textContent, 'Aus · ab Montag 07:15');
});

test('weiter weg: absolutes Datum plus Uhrzeit', () => {
  const sub = kopf('2026-11-05T09:00:00+01:00', { now: JETZT });
  assert.equal(sub.textContent, 'Aus · ab 05.11. 09:00');
});

test('Tooltip nennt den vollständigen Zeitpunkt lokalisiert', () => {
  const sub = kopf('2026-10-23T06:00:00+02:00', { now: JETZT });
  assert.match(sub.title, /Oktober 2026/);
  assert.match(sub.title, /06:00/);
});

test('englisch: tomorrow / weekday, 24-h-Uhr wie die Blöcke', () => {
  assert.equal(kopf('2026-10-23T06:00:00+02:00', { now: JETZT, language: 'en' }).textContent,
    'Off · from tomorrow 06:00');
  assert.equal(kopf('2026-10-26T07:15:00+01:00', { now: JETZT, language: 'en' }).textContent,
    'Off · from Monday 07:15');
});

test('Zeitzone des Servers zählt, nicht UTC: 23:30 Wien bleibt heute', () => {
  const sub = kopf('2026-10-22T23:30:00+02:00', { now: JETZT });
  assert.equal(sub.textContent, 'Aus · ab 23:30');
});

test('unlesbarer Wert: nur der Zustand, kein Rohtext', () => {
  const sub = kopf('kaputt', { now: JETZT });
  assert.equal(sub.textContent, 'Aus');
});

test('scheduleNextLabel ist eine reine Funktion', () => {
  const l = lade();
  const r = l.scheduleNextLabel('2026-10-22T18:30:00+02:00',
    { locale: { language: 'de', time_zone: 'server' }, config: { time_zone: 'Europe/Vienna' } },
    l.TEXTE_BUSCH_SCHEDULE_CARD.de, JETZT);
  assert.equal(r.text, '18:30');
});
