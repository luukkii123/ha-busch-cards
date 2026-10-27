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
