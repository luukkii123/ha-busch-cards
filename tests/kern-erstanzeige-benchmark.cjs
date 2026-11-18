'use strict';
// #1297 (M10 regression): core work from the first hass to the running state stream, old core vs new core.
// One world per run on the M6 fixture (3000 entities): attach + 16 more cards with the same hass and 25 subscribed
// queries (20 plain, 5 Smart), 10 set hass before the stream, then the stream start, then 10 set hass with the stream.
// Stream start: core >= 1.3.0 gets the full subscribe_entities message `a` (as the M6 stand-in sends it after 50 ms);
// core 1.2.0 gets its get_states answer (fresh objects). Registry lists stay pending, so only the state path is timed.
// Times are synchronous core work plus the microtasks it queued (query flush, subscriber calls).
//   node tests/kern-erstanzeige-benchmark.cjs <fixture.json> <bundle.js>[,<bundle.js>…] [out.json]
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const [fixtureFile, bundleArg, outFile] = process.argv.slice(2);
if (!fixtureFile) { console.error('usage: node kern-erstanzeige-benchmark.cjs <fixture.json> [bundle.js,…] [out.json]'); process.exit(2); }
const BUNDLES = (bundleArg || path.join(__dirname, '..', 'dist', 'busch-cards.js')).split(',').map((file) => path.resolve(file));
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const RUNS = 15, WARMUP = 3, CARDS = 17, UPDATES = 10;
const byId = (rows, key) => Object.fromEntries(rows.map((row) => [row[key], row]));
const pick = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const drain = () => new Promise((resolve) => setImmediate(resolve));
const seconds = (iso) => Date.parse(iso) / 1000;
const compress = (st) => ({ s: st.state, a: st.attributes || {}, c: st.context?.id || '', lc: seconds(st.last_changed), lu: seconds(st.last_updated) });

function loadCore(file) {
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} }, window: { customCards: [] }, customElements: { define() {}, get() {} },
    HTMLElement: class {}, document: { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }) },
    performance, setTimeout, clearTimeout, queueMicrotask,
  };
  context.globalThis = context; vm.createContext(context);
  return vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;({ BuschCardsCore });', context, { filename: file }).BuschCardsCore;
}

async function run(BuschCardsCore) {
  const listeners = new Map(); let entities = null, snapshot = null;
  const connection = {
    subscribeEvents: (callback, type) => { listeners.set(type, callback); return Promise.resolve(() => {}); },
    subscribeMessage: (callback, message) => { if (message.type === 'subscribe_entities') entities = callback; return Promise.resolve(() => {}); },
    addEventListener() {}, removeEventListener() {},
  };
  const callWS = (message) => message.type === 'get_states' ? new Promise((resolve) => { snapshot = resolve; }) : new Promise(() => {});
  let hass = { states: fixture.states, entities: fixture.display, devices: byId(fixture.deviceRegistry, 'id'), areas: byId(fixture.areas, 'area_id'),
    floors: byId(fixture.floors, 'floor_id'), connection, callWS, language: 'de', locale: { language: 'de' }, formatEntityState: (s) => s?.state };
  const core = new BuschCardsCore(); let notified = 0;
  const counters = () => ({ stateUpdates: core.metrics.stateUpdates, queriesRecalculated: core.metrics.queriesRecalculated, notified });
  const delta = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, b[key] - a[key]]));
  const ids = Object.keys(hass.states).filter((id) => !id.startsWith('person.'));
  let step = 0;
  const change = () => {
    const id = ids[(step++ * 7919) % ids.length], prev = hass.states[id], ts = new Date(1_800_000_000_000 + step * 1000).toISOString();
    const next = { ...prev, state: prev.state === 'on' ? 'off' : 'on', last_changed: ts, last_updated: ts, context: { id: 'u' + step } };
    hass = { ...hass, states: { ...hass.states, [id]: next } };
    return { id, prev, next };
  };
  // Attach: first card attaches, 16 more set the same hass, the cards subscribe their queries.
  let start = performance.now();
  for (let card = 0; card < CARDS; card++) core.attach(hass);
  for (let i = 0; i < 20; i++) core.subscribe(core.query({ filter: { include: [{ domain: 'sensor', state: '< ' + (10 + i) }] } }), () => notified++);
  for (let i = 0; i < 5; i++) core.subscribe(core.smartQuery({ filter: { include: [{ domain: 'light', state: i % 2 ? 'on' : 'off' }] } }), () => notified++);
  await drain();
  const attachMs = performance.now() - start;
  const before = [];
  for (let i = 0; i < UPDATES; i++) { change(); start = performance.now(); for (let card = 0; card < CARDS; card++) core.attach(hass); await drain(); before.push(performance.now() - start); }
  // Stream start.
  const c0 = counters();
  // The message is decoded from JSON by the socket before the core sees it, so it is built outside the timing.
  if (!entities && !snapshot) throw new Error('no state stream requested');
  const message = entities ? { a: Object.fromEntries(Object.entries(hass.states).map(([id, st]) => [id, compress(st)])) } : JSON.parse(JSON.stringify(Object.values(hass.states)));
  start = performance.now();
  if (entities) entities(message); else snapshot(message);
  await drain(); await drain();
  const streamMs = performance.now() - start, streamCounts = delta(c0, counters());
  if (!core.streaming) throw new Error('stream did not start');
  const after = [];
  for (let i = 0; i < UPDATES; i++) {
    const { id, prev, next } = change(); start = performance.now();
    if (entities) entities({ c: { [id]: { '+': { s: next.state, c: next.context.id, lc: seconds(next.last_changed) } } } });
    else listeners.get('state_changed')?.({ data: { entity_id: id, old_state: prev, new_state: next } });
    for (let card = 0; card < CARDS; card++) core.attach(hass);
    await drain(); after.push(performance.now() - start);
  }
  const correct = Object.keys(hass.states).every((id) => core.getEntity(id)?.state === hass.states[id].state);
  core.dispose();
  return { version: core.version, attachMs, before, streamMs, streamCounts, after, correct };
}

const stat = (values) => { const sorted = [...values].sort((a, b) => a - b); return { median: +pick(sorted, 0.5).toFixed(3), p95: +pick(sorted, 0.95).toFixed(3) }; };

async function main() {
  const report = { node: process.version, entities: Object.keys(fixture.states).length, runs: RUNS, warmup: WARMUP, cards: CARDS, queries: 25, result: [] };
  for (const file of BUNDLES) {
    const Core = loadCore(file), runs = [];
    for (let i = 0; i < WARMUP + RUNS; i++) { const r = await run(Core); if (i >= WARMUP) runs.push(r); }
    report.result.push({ bundle: path.basename(file), core: runs[0].version,
      attachMs: stat(runs.map((r) => r.attachMs)), setHassBeforeStreamMs: stat(runs.flatMap((r) => r.before)),
      streamStartMs: stat(runs.map((r) => r.streamMs)), streamStartCounts: runs[0].streamCounts,
      setHassWithStreamMs: stat(runs.flatMap((r) => r.after)), correct: runs.every((r) => r.correct) });
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.result.some((r) => !r.correct)) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exit(1); });
