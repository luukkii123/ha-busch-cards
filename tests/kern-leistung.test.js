'use strict';
// #641: Leistungskorrektur im gemeinsamen Kern (C1 gebündeltes rebuild, C2 Schonfrist, C3 Gerätversionen/track).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ladeKarte } = require('./laden');
const { baueHass } = require('./geraet-attrappe');

/** Kern mit eigener Zeitsteuerung: `timer.tick(ms)` lässt fällige setTimeout-Rückrufe laufen. */
function kernMitUhr() {
  const timer = { jetzt: 0, liste: new Map(), id: 0,
    setTimeout(fn, ms = 0) { const id = ++timer.id; timer.liste.set(id, { fn, bis: timer.jetzt + ms }); return id; },
    clearTimeout(id) { timer.liste.delete(id); },
    tick(ms) { timer.jetzt += ms; for (const [id, t] of [...timer.liste]) if (t.bis <= timer.jetzt) { timer.liste.delete(id); t.fn(); } } };
  const { BuschCardsCore } = ladeKarte(['BuschCardsCore'], { setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout, performance });
  return { core: new BuschCardsCore(), timer };
}
function kern() { const { BuschCardsCore } = ladeKarte(['BuschCardsCore'], { setTimeout, clearTimeout, performance }); return new BuschCardsCore(); }
const neu = (h, id, state) => ({ ...h.states[id], state });

test('C3: Zustandsänderung erhöht nur die Version des betroffenen Geräts', () => {
  const c = kern(), h = baueHass(); c.seed(h);
  const v = id => c.index.devVersion?.get(id) || 0;
  const d1 = v('d1'), d2 = v('d2');
  c.updateState('light.decke', neu(h, 'light.decke', 'off'));
  assert.equal(v('d1'), d1 + 1, 'eigenes Gerät zählt hoch');
  assert.equal(v('d2'), d2, 'fremdes Gerät bleibt');
  c.dispose();
});

test('C3: rebuild() erhöht die Epoche', () => {
  const c = kern(), h = baueHass(); c.seed(h);
  const e = c.index.epoch; assert.equal(typeof e, 'number');
  c.index.rebuild(); assert.equal(c.index.epoch, e + 1);
  c.dispose();
});

test('C3: track() erfasst gelesene Geräte, unchanged() erkennt Änderungen', () => {
  const c = kern(), h = baueHass(); c.seed(h);
  const deps = c.track(() => { c.getDeviceEntities('d1'); c.getEntity('sensor.ohne_geraet'); });
  assert.ok(c.unchanged(deps), 'ohne Änderung unverändert');
  c.updateState('sensor.anderes', neu(h, 'sensor.anderes', '6'));
  assert.ok(c.unchanged(deps), 'fremdes Gerät ändert nichts');
  c.updateState('sensor.decke_leistung', neu(h, 'sensor.decke_leistung', '13'));
  assert.ok(!c.unchanged(deps), 'Änderung am gelesenen Gerät');
  const d2 = c.track(() => c.getEntity('sensor.ohne_geraet'));
  c.updateState('sensor.ohne_geraet', neu(h, 'sensor.ohne_geraet', '8'));
  assert.ok(!c.unchanged(d2), 'Entität ohne Gerät wird einzeln verfolgt');
  const d3 = c.track(() => c.getEntity('light.decke'));
  c.index.rebuild(); assert.ok(!c.unchanged(d3), 'neue Epoche = geändert');
  assert.ok(!c.unchanged(c.track(() => {})), 'nichts gelesen = immer neu');
  assert.ok(!c.unchanged(null));
  c.dispose();
});

test('C3: verschachteltes track() meldet innere Lesungen auch außen', () => {
  const c = kern(), h = baueHass(); c.seed(h);
  let innen; const aussen = c.track(() => { innen = c.track(() => c.getEntity('sensor.anderes')); });
  c.updateState('sensor.anderes', neu(h, 'sensor.anderes', '9'));
  assert.ok(!c.unchanged(innen)); assert.ok(!c.unchanged(aussen), 'äußere Spur kennt d2');
  c.dispose();
});

test('C2: release() gibt erst nach 30 s Schonfrist frei', () => {
  const { core, timer } = kernMitUhr(), h = baueHass();
  let disposed = 0; const orig = core.dispose.bind(core); core.dispose = () => { disposed++; orig(); };
  const frei = core.retain(h); const vorher = disposed;
  frei(); frei();
  assert.equal(disposed, vorher, 'nicht sofort freigegeben');
  timer.tick(29999); assert.equal(disposed, vorher, 'vor Ablauf noch da');
  timer.tick(1); assert.equal(disposed, vorher + 1, 'nach 30 s freigegeben');
  assert.equal(core.connection, null);
});

test('C2: neues retain() in der Schonfrist bricht die Freigabe ab', async () => {
  const { core, timer } = kernMitUhr(), h = baueHass();
  let calls = 0; const ws = h.callWS; h.callWS = (...a) => { calls++; return ws ? ws.apply(h, a) : Promise.resolve([]); };
  let disposed = 0; const orig = core.dispose.bind(core); core.dispose = () => { disposed++; orig(); };
  const frei = core.retain(h); await new Promise(r => setImmediate(r)); const vorher = disposed, n = calls; frei();
  timer.tick(10000);
  const frei2 = core.retain(h); await new Promise(r => setImmediate(r));
  timer.tick(60000);
  assert.equal(disposed, vorher, 'Kern bleibt verbunden');
  assert.equal(calls, n, 'kein erneuter Abruf von get_states/Registern');
  assert.equal(core.users, 1);
  frei2(); timer.tick(30000); assert.equal(disposed, vorher + 1); assert.equal(core.connection, null);
});

test('C1: mehrere gleichzeitige Registerladungen ergeben ein rebuild', async () => {
  const c = kern(), h = baueHass();
  const listen = { entity: Object.values(h.entities), device: Object.values(h.devices), area: Object.values(h.areas || {}), floor: [], label: [] };
  h.connection = {};
  h.callWS = msg => { const m = /^config\/(\w+)_registry\/list$/.exec(msg.type); return Promise.resolve(m ? listen[m[1]] : []); };
  let n = 0; const orig = c.index.rebuild.bind(c.index); c.index.rebuild = () => { n++; orig(); };
  c.attach(h); const nachSeed = n; await c.ready;
  assert.equal(n - nachSeed, 1, `rebuilds nach Registerladungen: ${n - nachSeed}`);
  assert.ok(c.getDeviceEntities('d1').some(e => e.entity_id === 'light.decke'), 'Index ist danach aktuell');
  c.dispose();
});

// M10: subscribe_entities. A full message after a reconnect must not count as a change for untouched devices,
// otherwise every guarded card renders again (Unraid #641, device card M15).
test('M10: voller Strom nach Reconnect lässt unveränderte Geräte unverändert, geänderte zählen hoch', async () => {
  const c = kern(), h = baueHass(); let push; h.connection = { subscribeMessage: async (cb, msg) => { if (msg.type === 'subscribe_entities') push = cb; return () => {}; } };
  const stamp = id => ({ ...h.states[id], entity_id: id, last_changed: '2026-11-18T10:00:00.000Z', last_updated: '2026-11-18T10:00:00.000Z', context: { id: 'c-' + id } });
  h.states = Object.fromEntries(Object.keys(h.states).map(id => [id, stamp(id)]));
  const voll = states => push({ a: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, { s: s.state, a: s.attributes, c: s.context.id, lc: Date.parse(s.last_changed) / 1000 }])) });
  c.attach(h); await new Promise(r => setImmediate(r)); voll(h.states);
  const deps1 = c.track(() => c.getDeviceEntities('d1')), deps2 = c.track(() => c.getDeviceEntities('d2'));
  c._entitiesFull = true; // as after a ready event
  voll({ ...h.states, 'sensor.anderes': { ...h.states['sensor.anderes'], state: '6', last_updated: '2026-11-18T10:00:05.000Z', last_changed: '2026-11-18T10:00:05.000Z', context: { id: 'neu' } } });
  assert.ok(c.unchanged(deps1), 'd1 unverändert');
  assert.ok(!c.unchanged(deps2), 'd2 geändert');
  assert.equal(c.getEntity('sensor.anderes').state, '6');
  c.dispose();
});

// #1297: the first full stream message after attach carries the state the core already indexed from hass.states.
// It must not index anything again, recalculate a query or call a subscriber (checked against an M6 regression).
test('M10: erste a-Meldung mit dem Stand aus hass.states indiziert nichts neu und benachrichtigt keine Abfrage', async () => {
  const c = kern(), h = baueHass(); let push; h.connection = { subscribeMessage: async (cb, msg) => { if (msg.type === 'subscribe_entities') push = cb; return () => {}; } };
  const stamp = id => ({ ...h.states[id], entity_id: id, last_changed: '2026-11-18T10:00:00.000Z', last_updated: '2026-11-18T10:00:05.000Z', context: { id: 'c-' + id } });
  h.states = Object.fromEntries(Object.keys(h.states).map(id => [id, stamp(id)]));
  c.attach(h); let calls = 0;
  c.subscribe(c.query({ filter: { include: [{ domain: 'light' }] } }), () => calls++);
  c.subscribe(c.smartQuery({ filter: { include: [{ domain: 'sensor' }] } }), () => calls++);
  await new Promise(r => setImmediate(r));
  const vorher = { ...c.metrics }, epoch = c.index.epoch, deps = c.track(() => c.getDeviceEntities('d1')); calls = 0;
  push({ a: Object.fromEntries(Object.entries(h.states).map(([id, s]) => [id, { s: s.state, a: s.attributes, c: s.context.id, lc: Date.parse(s.last_changed) / 1000, lu: Date.parse(s.last_updated) / 1000 }])) });
  await new Promise(r => setImmediate(r));
  assert.ok(c.streaming, 'Strom aktiv');
  assert.equal(c.metrics.stateUpdates - vorher.stateUpdates, 0, 'Indexupdates');
  assert.equal(c.metrics.queriesRecalculated - vorher.queriesRecalculated, 0, 'neu berechnete Abfragen');
  assert.equal(calls, 0, 'Abonnenten benachrichtigt');
  assert.equal(c.index.epoch, epoch, 'kein rebuild');
  assert.ok(c.unchanged(deps), 'Gerät unverändert');
  c.dispose();
});
