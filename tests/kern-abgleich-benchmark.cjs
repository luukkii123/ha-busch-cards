'use strict';
// M10 (#1297): cost of the core's state sync per `set hass` with one changed entity.
// path "hass.states": core.attach(hass) compares the new hass.states (fallback of core 1.3.0 without stream);
// path "subscribe_entities": one compressed diff message plus core.attach(hass), which the stream makes a no-op.
// Each alone and with the bundled query flush of 25 subscribed queries (20 plain, 5 Smart).
// p95 limits for the path "hass.states" (fixed in the plan): 0.2 ms (3000), 1 ms (10 000).
//   node tests/kern-abgleich-benchmark.cjs [out.json]
const { ladeKarte } = require('./laden');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const { BuschCardsCore } = ladeKarte(['BuschCardsCore'], { performance, setTimeout, clearTimeout });

const LIMITS = { 3000: 0.2, 10000: 1 };
const RUNS = 401, WARMUP = 100;
const pick = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function world(size) {
  const states = {}, entities = {}, devices = {};
  for (let i = 0; i < size; i++) {
    const domain = i % 5 === 0 ? 'light' : 'sensor', id = `${domain}.bench_${i}`, device = 'dev_' + (i % 300);
    states[id] = { entity_id: id, state: String(i % 100), attributes: { friendly_name: 'Bench ' + i, device_class: i % 7 === 0 ? 'battery' : 'temperature' }, last_changed: '2026-11-18T10:00:00Z', last_updated: '2026-11-18T10:00:00Z', context: { id: 'c' + i } };
    entities[id] = { entity_id: id, device_id: device, platform: i % 2 ? 'mqtt' : 'demo', labels: [] };
    devices[device] = { id: device, name: device, labels: [] };
  }
  return { states, entities, devices };
}

async function measure(size, withQueries, path) {
  const { states, entities, devices } = world(size);
  let push = null;
  const connection = path === 'stream' ? { subscribeMessage: async (callback) => { push = callback; return () => {}; } } : {};
  let hass = { states, entities, devices, areas: {}, floors: {}, connection, language: 'en', locale: { language: 'en' }, formatEntityState: (s) => s.state };
  const core = new BuschCardsCore(); core.attach(hass);
  if (path === 'stream') {
    await new Promise((resolve) => setImmediate(resolve));
    push({ a: Object.fromEntries(Object.values(states).map((st) => [st.entity_id, { s: st.state, a: st.attributes, c: st.context.id, lc: Date.parse(st.last_changed) / 1000 }])) });
    if (!core.streaming) throw new Error('stream did not start');
  }
  const offs = [];
  if (withQueries) {
    for (let i = 0; i < 20; i++) offs.push(core.subscribe(core.query({ filter: { include: [{ domain: 'sensor', integration: 'mqtt', state: '< ' + (10 + i) }] } }), () => {}));
    for (let i = 0; i < 5; i++) offs.push(core.subscribe(core.smartQuery({ filter: { include: [{ domain: 'light', state: String(i) }] } }), () => {}));
  }
  const ids = Object.keys(states), samples = [];
  for (let run = 0; run < WARMUP + RUNS; run++) {
    const id = ids[(run * 7919) % ids.length], prev = hass.states[id];
    const next = { ...hass, states: { ...hass.states, [id]: { ...prev, state: String(run % 100), last_updated: new Date(1_800_000_000_000 + run).toISOString() } } };
    const start = performance.now();
    if (push) push({ c: { [id]: { '+': { s: String(run % 100), lu: 1_800_000_000 + run / 1000 } } } });
    core.attach(next);
    if (withQueries) core.engine.flush();
    const ms = performance.now() - start;
    if (run >= WARMUP) samples.push(ms);
    hass = next;
  }
  const correct = ids.every((id) => push ? core.getEntity(id)?.state === hass.states[id].state : core.getEntity(id)?.stateObject === hass.states[id]);
  offs.forEach((off) => off()); core.dispose();
  samples.sort((a, b) => a - b);
  return { path, entities: size, queries: withQueries ? 25 : 0, medianMs: +pick(samples, 0.5).toFixed(4), p95Ms: +pick(samples, 0.95).toFixed(4), maxMs: +samples.at(-1).toFixed(4), correct };
}

async function main() {
  const result = [];
  for (const path of ['hass.states', 'stream']) for (const size of [3000, 10000]) for (const withQueries of [false, true]) result.push(await measure(size, withQueries, path));
  const verdict = result.filter((r) => !r.queries && r.path === 'hass.states').map((r) => ({ entities: r.entities, p95Ms: r.p95Ms, limitMs: LIMITS[r.entities], ok: r.p95Ms <= LIMITS[r.entities] }));
  const report = { node: process.version, runs: RUNS, warmup: WARMUP, scope: 'one changed entity per set hass; stream = diff message + attach; queries=25 adds engine.flush()', result, verdict, keepHassStates: verdict.every((v) => v.ok) };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (result.some((r) => !r.correct)) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });
