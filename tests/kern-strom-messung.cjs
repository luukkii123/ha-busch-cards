'use strict';
// M10 (#1297): network counters and heap of the shared core on the M6 fixture (3000 entities).
// Counts per WS message type (shared test kit), JSON bytes of requests, answers and of the events the
// core receives, for attach, 10 state changes and one reconnect; heap of the core after gc.
// subscribe_entities is answered like HA does: a full compressed message after subscribing and after
// every reconnect, then one compressed diff per change (home-assistant-js-websocket format).
//   node --expose-gc tests/kern-strom-messung.cjs <fixture.json> [bundle.js] [out.json]
// The fixture stays outside the repo (hacs/docs/render/perf-buschcheck/fixture.json, read only).
const fs = require('node:fs');
const path = require('node:path');
const kit = require('./_testkit.cjs');

const [fixtureFile, bundleArg, outFile] = process.argv.slice(2);
if (!fixtureFile) { console.error('usage: node --expose-gc kern-strom-messung.cjs <fixture.json> [bundle.js] [out.json]'); process.exit(2); }
const BUNDLE = path.resolve(bundleArg || path.join(__dirname, '..', 'dist', 'busch-cards.js'));
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const byId = (rows, key) => Object.fromEntries(rows.map((row) => [row[key], row]));

function world() {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ['ensureBuschCore'] });
  const ha = kit.createHass({
    clock, states: fixture.states, entities: fixture.display, devices: byId(fixture.deviceRegistry, 'id'),
    areas: byId(fixture.areas, 'area_id'), floors: byId(fixture.floors, 'floor_id'), labels: byId(fixture.labels, 'label_id'),
  });
  // Answers are fresh objects, as after JSON over the socket.
  ha.respond('get_states', (_m, c) => clone(Object.values(c.server.states)));
  ha.respond('config/entity_registry/list', () => clone(fixture.entityRegistry));
  ha.respond('config/device_registry/list', () => clone(fixture.deviceRegistry));
  ha.respond('config/area_registry/list', () => clone(fixture.areas));
  ha.respond('config/floor_registry/list', () => clone(fixture.floors));
  ha.respond('config/label_registry/list', () => clone(fixture.labels));
  // Event bytes the core receives per event type (the kit counts requests and answers only).
  const events = {};
  const subscribe = ha.connection.subscribeEvents;
  ha.connection.subscribeEvents = (callback, type) => subscribe.call(ha.connection, (event) => {
    const key = type || '*'; events[key] = events[key] || { count: 0, bytes: 0 };
    events[key].count++; events[key].bytes += bytes(event); callback(event);
  }, type);
  // Server side of subscribe_entities; message bytes count as events of type "subscribe_entities".
  const seconds = (iso) => Date.parse(iso) / 1000;
  const compressed = (st) => ({ s: st.state, a: st.attributes, c: st.context?.id, lc: seconds(st.last_changed), ...(st.last_updated !== st.last_changed ? { lu: seconds(st.last_updated) } : {}) });
  let entitySubs = 0;
  const subscribeMessage = ha.connection.subscribeMessage;
  ha.connection.subscribeMessage = (callback, message) => {
    if (message.type !== 'subscribe_entities') return subscribeMessage.call(ha.connection, callback, message);
    return subscribeMessage.call(ha.connection, (payload) => {
      events.subscribe_entities = events.subscribe_entities || { count: 0, bytes: 0 };
      events.subscribe_entities.count++; events.subscribe_entities.bytes += bytes(payload); callback(payload);
    }, message).then((off) => { entitySubs++; Promise.resolve().then(full); return () => { entitySubs--; return off(); }; });
  };
  const full = () => { if (entitySubs) ha.pushMessage('subscribe_entities', { a: Object.fromEntries(Object.entries(ha.server.states).map(([id, st]) => [id, compressed(st)])) }); };
  const change = (id, patch, online = true) => {
    const hass = ha.patchState(id, patch), st = ha.server.states[id];
    if (online && entitySubs) ha.pushMessage('subscribe_entities', { c: { [id]: { '+': { s: st.state, c: st.context.id, lu: seconds(st.last_updated) } } } });
    return hass;
  };
  return { clock, ha, events, full, change, ensureBuschCore: exposed.ensureBuschCore };
}

function snapshot(w) {
  const { stats } = w.ha;
  const sum = (map, re) => Object.entries(map).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
  const subscribe = Object.fromEntries(Object.entries(stats.count).filter(([k]) => k.startsWith('subscribe_events:')).sort().map(([k, v]) => [k.slice(17), v]));
  const registry = /^config\/\w+_registry\/list$/;
  const out = {
    get_states: w.ha.count('get_states'),
    subscribe_events: w.ha.count('subscribe_events'),
    subscribe_events_by_type: subscribe,
    subscribe_entities: w.ha.count('subscribe_entities'),
    registry_list: w.ha.countMatching(registry),
    bytes_in_get_states: stats.bytesIn.get_states || 0,
    bytes_in_registry_list: sum(stats.bytesIn, registry),
    bytes_requests_and_answers: sum(stats.bytesIn, /^(?!call_service$)/) + sum(stats.bytesOut, /^(?!call_service$)/) - (stats.bytesIn.subscribe_events || 0) - (stats.bytesOut.subscribe_events || 0),
    bytes_events: Object.values(w.events).reduce((n, e) => n + e.bytes, 0),
    events_by_type: clone(w.events),
  };
  out.bytes_total = out.bytes_requests_and_answers + out.bytes_events;
  return out;
}
function reset(w) { w.ha.resetStats(); for (const key of Object.keys(w.events)) delete w.events[key]; }
function heap() { for (let i = 0; i < 4; i++) global.gc?.(); return process.memoryUsage().heapUsed; }

async function main() {
  const w = world(), core = w.ensureBuschCore(1);
  const h0 = heap();
  // A card retains the core and hands every new hass to it, as `set hass` does.
  core.retain(w.ha.hass); w.ha.onUpdate((hass) => core.attach(hass));
  await w.clock.advance(200);
  const attach = snapshot(w);
  const h1 = heap();
  reset(w);
  const ids = Object.keys(fixture.states).slice(0, 10);
  for (const [i, id] of ids.entries()) w.change(id, { state: String(1000 + i) });
  await w.clock.advance(200);
  const changes10 = snapshot(w);
  const correctAfterChanges = ids.every((id, i) => core.getEntity(id)?.state === String(1000 + i));
  reset(w);
  // Socket drop: a change made while disconnected must be visible after the reconnect.
  w.ha.disconnect();
  w.change(ids[0], { state: 'while-offline' }, false);
  w.ha.reconnect(); w.full(); core.attach(w.ha.hass);
  await w.clock.advance(200);
  const reconnect = snapshot(w);
  const correctAfterReconnect = core.getEntity(ids[0])?.state === 'while-offline';
  const report = {
    node: process.version, bundle: path.basename(BUNDLE), core: core.version, sourceHash: core.sourceHash,
    entities: Object.keys(fixture.states).length, gc: typeof global.gc === 'function',
    streaming: !!core.streaming, attach, changes10, reconnect, correctAfterChanges, correctAfterReconnect,
    heapCoreKB: Math.round((h1 - h0) / 1024),
  };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
