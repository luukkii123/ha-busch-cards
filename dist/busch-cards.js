/**
 * Busch Cards — Lovelace-Karten für Home Assistant.
 *
 * Bewusst ohne Build-Schritt: eine einzelne Datei, reines Vanilla-JS mit
 * Custom Elements. Das Repo liegt auf einer SMB-Share, auf der kein npm läuft
 * — was hier steht, ist genau das, was ausgeliefert wird.
 *
 * Neue Karte hinzufügen: Klasse schreiben, `customElements.define(...)`,
 * Eintrag in `window.customCards` — alles in dieser Datei.
 *
 * Enthält vier Karten: `busch-schedule-card`, `busch-map-card`,
 * `busch-calendar-card` und seit 0.10.0 `busch-device-card`. Die
 * Timeline-Karte ist mitsamt ihrem Leaflet in ein eigenes Repo umgezogen
 * (https://github.com/luukkii123/ha-localtrack-cards), weil sie zur
 * Integration `localtrack` gehört und nichts mit dem Zeitplan-Helfer zu tun
 * hat.
 */

/* Shared runtime for this repository only. Public API major: 1. */
const BUSCH_CORE_KEY = Symbol.for("busch.cards.core");
const BUSCH_REGISTRY_IDS = { entity: "entity_id", device: "id", area: "area_id", floor: "floor_id", label: "label_id" };
function buschCoreMap(rows, key) {
  return new Map((Array.isArray(rows) ? rows : Object.values(rows || {})).map(row => [row[key], row]));
}
function buschCoreSet(map, key, id, add = true) {
  if (key === undefined || key === null || key === "") return;
  if (add) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); }
  else { const set = map.get(key); if (set) { set.delete(id); if (!set.size) map.delete(key); } }
}
class BuschRegistryCache {
  constructor(hass, onLoad = () => {}) { this.hass = hass; this.onLoad = onLoad; this.promises = new Map(); this.requests = {}; this.generation = 0; }
  load(name) {
    if (!(name in BUSCH_REGISTRY_IDS)) return Promise.reject(new Error(`Unknown registry: ${name}`));
    if (this.promises.has(name)) return this.promises.get(name);
    const generation = this.generation, hass = this.hass;
    const pending = Promise.resolve().then(() => {
      this.requests[name] = (this.requests[name] || 0) + 1;
      return hass.callWS({ type: `config/${name}_registry/list` });
    }).then(rows => {
      if (generation !== this.generation || this.promises.get(name) !== pending) return null;
      if (!Array.isArray(rows)) throw new Error(`Invalid ${name} registry response`);
      const map = buschCoreMap(rows, BUSCH_REGISTRY_IDS[name]);
      this.onLoad(name, map); return map;
    }).catch(error => { if (this.promises.get(name) === pending) this.promises.delete(name); throw error; });
    this.promises.set(name, pending); return pending;
  }
  invalidate(name) { this.promises.delete(name); }
  clear() { this.generation++; this.promises.clear(); }
}
class BuschEntityIndex {
  constructor() {
    this.entities = new Map(); this.devices = new Map(); this.areas = new Map(); this.floors = new Map(); this.labels = new Map(); this.registry = new Map(); this.states = new Map(); this.order = new Map(); this.nextOrder = 0;
    this.indices = Object.fromEntries(["domain", "state", "integration", "config_entry", "device", "area", "floor", "label", "manufacturer", "model", "entity_category"].map(key => [key, new Map()]));
    this.deviceIndices = { via_device_id: new Map(), config_entry_id: new Map() };
  }
  keys(info) {
    return { domain: [info.domain], state: [info.state], integration: [info.platform], config_entry: [info.config_entry_id], device: [info.device_id], area: [info.area_id], floor: [info.floor_id], label: info.labels, manufacturer: [info.manufacturer], model: [info.model], entity_category: [info.entity_category] };
  }
  update(id, state) {
    if (state) { if (!this.order.has(id)) this.order.set(id, this.nextOrder++); this.states.set(id, state); } else { this.states.delete(id); this.order.delete(id); }
    const old = this.entities.get(id);
    if (old) for (const [field, keys] of Object.entries(this.keys(old))) for (const key of keys) buschCoreSet(this.indices[field], key, id, false);
    const entry = this.registry.get(id);
    if (!entry && !state) { this.entities.delete(id); return { id, old, next: undefined }; }
    const device = this.devices.get(entry?.device_id);
    const area_id = entry?.area_id || device?.area_id;
    const next = { entity_id: id, domain: id.split(".")[0], registry: entry, stateObject: state || undefined, attributes: state?.attributes || {}, state: state?.state,
      platform: entry?.platform, config_entry_id: entry?.config_entry_id, device_id: entry?.device_id,
      area_id, floor_id: this.areas.get(area_id)?.floor_id,
      labels: [...new Set([...(entry?.labels || []), ...(device?.labels || [])])], manufacturer: device?.manufacturer, model: device?.model, entity_category: entry?.entity_category };
    this.entities.set(id, next);
    for (const [field, keys] of Object.entries(this.keys(next))) for (const key of keys) buschCoreSet(this.indices[field], key, id);
    return { id, old, next };
  }
  rebuild() {
    this.order = new Map([...this.states.keys()].map((id, i) => [id, i])); this.nextOrder = this.order.size;
    this.entities.clear(); for (const map of Object.values(this.indices)) map.clear();
    for (const map of Object.values(this.deviceIndices)) map.clear();
    for (const device of this.devices.values()) {
      buschCoreSet(this.deviceIndices.via_device_id, device.via_device_id, device.id);
      for (const entry of device.config_entries || []) buschCoreSet(this.deviceIndices.config_entry_id, entry, device.id);
    }
    for (const id of new Set([...this.states.keys(), ...this.registry.keys()])) this.update(id, this.states.get(id));
  }
}
/* Internal declarative API; auto-entities compatibility is an adapter. */
function buschCoreKey(value) {
  if (Array.isArray(value)) return '[' + value.map(buschCoreKey).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + buschCoreKey(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
/* Shared editor contract for the standalone Busch bundle. */
function buschEditorCopy(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function buschEditorUpdate(config,patch){const next=buschEditorCopy(config||{});for(const [key,value] of Object.entries(patch||{})){if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid editor config key');if(value===undefined)delete next[key];else next[key]=buschEditorCopy(value);}return next;}
function buschEditorUpdatePath(config,path,value){const parts=Array.isArray(path)?path:String(path).split('.');if(!parts.length||parts.some(part=>!String(part)||['__proto__','prototype','constructor'].includes(String(part))))throw new Error('Invalid editor config path');const next=buschEditorCopy(config||{});let node=next;for(let i=0;i<parts.length-1;i++){const part=parts[i];if(!Object.hasOwn(node,part)||!node[part]||typeof node[part]!=='object')node[part]=typeof parts[i+1]==='number'?[]:{};node=node[part];}const key=parts.at(-1);if(value===undefined){if(Array.isArray(node)&&typeof key==='number')node.splice(key,1);else delete node[key];}else node[key]=buschEditorCopy(value);return next;}
function buschEditorDeletePath(config,path){return buschEditorUpdatePath(config,path,undefined);}
class BuschEditorBase extends HTMLElement {
  constructor(){super();this.addEventListener?.('keydown',event=>event.stopPropagation());this.addEventListener?.('keyup',event=>event.stopPropagation());}
  _acceptConfig(config,normalize=buschEditorCopy){const next=buschEditorCopy(normalize(config));if(buschCoreKey(next)===buschCoreKey(this._config))return false;this._config=next;return true;}
  _publishConfig(config){const next=buschEditorCopy(config);this._config=next;this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:buschEditorCopy(next)},bubbles:true,composed:true}));return next;}
}
function buschCorePath(object, path) { return String(path).split(/[.:]/).reduce((value, key) => value?.[key], object); }
function buschCoreMatch(value, pattern) {
  if (typeof pattern !== 'string') return value === pattern;
  if (pattern.startsWith('$$')) return buschCoreMatch(JSON.stringify(value), pattern.slice(2));
  if (pattern.startsWith('/') && pattern.endsWith('/')) return typeof value === 'string' && new RegExp(pattern.slice(1, -1)).test(value);
  const numeric = pattern.match(/^\s*(<=|>=|==|!=|<|>|=)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (numeric) {
    const a = parseFloat(value), b = Number(numeric[2]);
    if (!Number.isFinite(a)) return false;
    return ({ '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b, '=': a === b, '==': a === b, '!=': a !== b })[numeric[1]];
  }
  return value === pattern;
}
const BUSCH_QUERY_FIELDS = { domain: 'domain', entity_id: 'entity_id', state: 'state', integration: 'platform', config_entry: 'config_entry_id', device: 'device_id', area: 'area_id', floor: 'floor_id', label: 'labels', device_manufacturer: 'manufacturer', device_model: 'model', entity_category: 'entity_category' };
const BUSCH_QUERY_INDEX = { domain: 'domain', state: 'state', integration: 'integration', config_entry: 'config_entry', device: 'device', area: 'area', floor: 'floor', label: 'label', device_manufacturer: 'manufacturer', device_model: 'model', entity_category: 'entity_category' };
const BUSCH_QUERY_TIME = new Set(['last_changed', 'last_updated', 'last_seen']);
function buschCompileRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Invalid query rule');
  const tests = [], guards = [], lookups = [], timeRules = [];
  for (const [raw, value] of Object.entries(rule)) {
    const key = raw.trim().split(/\s+/)[0];
    if (BUSCH_QUERY_TIME.has(key)) {
      const parsed = String(value).match(/^\s*(<=|>=|==|!=|<|>|=)?\s*(\d+(?:\.\d+)?)\s*(m|h|d)?(?:\s+ago)?\s*$/i);
      if (!parsed) throw new Error('Invalid time rule: ' + key);
      const operator = parsed[1] || '=', duration = Number(parsed[2]) * ({ m: 60000, h: 3600000, d: 86400000 }[(parsed[3] || 'm').toLowerCase()]);
      const timestamp = info => Date.parse(key === 'last_seen' ? info.attributes.last_seen : info.stateObject?.[key]);
      tests.push((info, now) => buschCoreMatch(now - timestamp(info), operator + ' ' + duration)); timeRules.push({ timestamp, duration });
    } else if (key === 'attributes') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid attributes rule');
      tests.push(info => Object.entries(value).every(([path, pattern]) => buschCoreMatch(buschCorePath(info.attributes, path.split(' ')[0]), pattern)));
    } else if (key === 'name') tests.push(info => buschCoreMatch(info.attributes.friendly_name, value));
    else if (key === 'hidden_by') { const fn = info => buschCoreMatch(info.registry?.hidden_by, value); tests.push(fn); guards.push(fn); }
    else if (key in BUSCH_QUERY_FIELDS) {
      const field = BUSCH_QUERY_FIELDS[key];
      const fn = info => key === 'label' ? info.labels.some(label => buschCoreMatch(label, value)) : buschCoreMatch(info[field], value) || (key === 'integration' && buschCoreMatch(info.config_entry_id, value));
      tests.push(fn); if (key !== 'state') guards.push(fn);
      if (typeof value === 'string' && !value.startsWith('$$') && !/[*/<>=!]/.test(value)) lookups.push([key, value]);
    } else throw new Error('Unsupported query rule: ' + key);
  }
  return { test: (info, now) => !!info?.stateObject && tests.length > 0 && tests.every(fn => fn(info, now)), guard: info => !!info && guards.every(fn => fn(info)), lookups, timeRules };
}
class BuschQueryEngine {
  constructor(core) { this.core = core; this.cache = new Map(); this.timer = null; }
  query(spec) {
    const copy = JSON.parse(JSON.stringify(spec)), key = buschCoreKey(copy);
    if (this.cache.has(key)) return this.cache.get(key);
    const filter = copy.filter || {};
    const query = { key, spec: copy, include: (filter.include || []).map(buschCompileRule), exclude: (filter.exclude || []).map(buschCompileRule), members: new Set(), deadlines: new Map(), nextDeadline: Infinity, subscribers: new Set(), result: Object.freeze([]), metrics: { calculations: 0, evaluated: 0, candidates: 0, executionMs: 0 } };
    this.cache.set(key, query); this.calculate(query); this.evict(); return query;
  }
  evict() {
    if (this.cache.size <= 128) return;
    for (const [key, query] of this.cache) { if (!query.subscribers.size) this.cache.delete(key); if (this.cache.size <= 128) break; }
  }
  candidates(rule) {
    const sets = [];
    for (const [field, value] of rule.lookups) {
      if (field === 'entity_id') sets.push(this.core.entities.has(value) ? new Set([value]) : new Set());
      else if (field === 'integration') sets.push(new Set([...(this.core.index.indices.integration.get(value) || []), ...(this.core.index.indices.config_entry.get(value) || [])]));
      else if (BUSCH_QUERY_INDEX[field]) sets.push(this.core.index.indices[BUSCH_QUERY_INDEX[field]].get(value) || new Set());
    }
    if (!sets.length) return this.core.entities.keys();
    sets.sort((a, b) => a.size - b.size);
    return [...sets[0]].filter(id => sets.every(set => set.has(id)));
  }
  matches(query, info, now) { return query.include.some(rule => rule.test(info, now)) && !query.exclude.some(rule => rule.test(info, now)); }
  calculate(query, ids) {
    if (query.smart) return query.smart.calculate(query, ids);
    const start = performance.now(), now = Date.now(); query.metrics.calculations++; this.core.metrics.queriesRecalculated++;
    if (!ids) { query.members.clear(); query.deadlines.clear(); ids = new Set(query.include.flatMap(rule => [...this.candidates(rule)])); }
    query.metrics.candidates = ids.size ?? ids.length;
    for (const id of ids) { query.metrics.evaluated++; if (this.matches(query, this.core.getEntity(id), now)) query.members.add(id); else query.members.delete(id); }
    const timed = [...query.include, ...query.exclude].filter(rule => rule.timeRules.length);
    for (const id of ids) {
      let next = Infinity; const info = this.core.getEntity(id);
      if (info?.stateObject) for (const rule of timed) {
        if (!rule.guard(info)) continue;
        for (const time of rule.timeRules) {
          const boundary = time.timestamp(info) + time.duration;
          for (const at of [boundary, boundary + 1]) if (at > now) next = Math.min(next, at);
        }
      }
      if (Number.isFinite(next)) query.deadlines.set(id, next); else query.deadlines.delete(id);
    }
    query.nextDeadline = Infinity;
    for (const at of query.deadlines.values()) query.nextDeadline = Math.min(query.nextDeadline, at);
    const result = [...query.members].sort();
    if (result.length !== query.result.length || result.some((id, index) => id !== query.result[index])) {
      query.result = Object.freeze(result); this.core.metrics.resultChanges++;
      for (const fn of query.subscribers) { try { fn(query.result); } catch (error) { console.warn('Busch Core subscriber failed', error?.name); } }
    }
    query.metrics.executionMs = performance.now() - start;
  }
  changed({ id, old, next }) {
    for (const query of this.cache.values()) {
      if (query.smart) { query.smart.changed(query, {id,old,next}); continue; }
      if (query.include.some(rule => rule.guard(old) || rule.guard(next))) this.calculate(query, [id]); else this.core.metrics.queriesSkipped++;
    }
    this.schedule();
  }
  refresh() { for (const query of this.cache.values()) this.calculate(query); this.schedule(); }
  subscribe(query, fn) {
    if (typeof fn !== 'function') throw new Error('A query subscriber must be a function');
    if (!this.cache.has(query.key)) { this.cache.set(query.key, query); this.calculate(query); }
    query = this.cache.get(query.key);
    query.subscribers.add(fn);
    try { fn(query.result); } catch (error) { console.warn('Busch Core subscriber failed', error?.name); }
    query.smart?.startTemplate(query);
    this.schedule();
    let active = true;
    return () => { if (!active) return; active = false; query.subscribers.delete(fn); if (!query.subscribers.size) { query.smart?.stop(query); this.cache.delete(query.key); } this.schedule(); };
  }
  schedule() {
    let deadline = Infinity;
    for (const query of this.cache.values()) if (query.subscribers.size) deadline = Math.min(deadline, query.nextDeadline);
    if (this.timer !== null && this.deadline === deadline) return;
    if (this.timer !== null) clearTimeout(this.timer); this.timer = null; this.deadline = deadline;
    if (Number.isFinite(deadline)) this.timer = setTimeout(() => {
      this.timer = null; const now = Date.now();
      for (const query of this.cache.values()) if (query.subscribers.size && query.nextDeadline <= now) this.calculate(query);
      this.schedule();
    }, Math.min(2147483647, Math.max(1, deadline - Date.now())));
  }
  stop() { for (const query of this.cache.values()) query.smart?.stop(query); if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
}
class BuschCardsCore {
  constructor() {
    this.apiVersion = "1.0"; this.version = "1.0.0"; this.index = new BuschEntityIndex(); this.metrics = { stateUpdates: 0, queriesSkipped: 0, queriesRecalculated: 0, resultChanges: 0, domRenders: null, structuralBuilds: 0 };
    this.registry = new BuschRegistryCache(null, (name, map) => {
      this.index[name === "entity" ? "registry" : name === "device" ? "devices" : name === "area" ? "areas" : name === "floor" ? "floors" : "labels"] = map;
      this.index.rebuild(); this.engine?.refresh(); this.lastErrors.delete(name);
      if (!this._notifyQueued) { this._notifyQueued = true; Promise.resolve().then(() => {
        this._notifyQueued = false;
        for (const listener of this._listeners) { try { listener(); } catch (error) { console.warn("Busch Core registry listener failed", error?.name); } }
      }); }
    });
    this._listeners = new Set(); this._deviceListeners = new Map(); this._dirtyDevices = new Set(); this.lastErrors = new Map(); this.unsubscribers = []; this.generation = 0; this.users = 0;
    this.ready = Promise.resolve(); this.engine = new BuschQueryEngine(this);
  }
  get entities() { return this.index.entities; }
  get devices() { return this.index.devices; }
  get areas() { return this.index.areas; }
  get floors() { return this.index.floors; }
  get labels() { return this.index.labels; }
  getEntity(id) { return this.entities.get(id); }
  getDevice(id) { return this.devices.get(id); }
  getDeviceEntities(id) { return [...(this.index.indices.device.get(id) || [])].map(entity => this.entities.get(entity)); }
  seed(hass) {
    this.index.registry = buschCoreMap(hass.entities, "entity_id"); this.index.devices = buschCoreMap(hass.devices, "id");
    this.index.areas = buschCoreMap(hass.areas, "area_id"); this.index.floors = buschCoreMap(hass.floors, "floor_id");
    this.index.states = new Map(Object.entries(hass.states || {})); this.index.rebuild(); this._states = hass.states;
    this._display = [hass.entities, hass.devices, hass.areas, hass.floors]; this.engine?.refresh();
  }
  attach(hass) {
    if (!hass) return;
    const identity = hass.connection || hass;
    if (this.connection === identity) {
      const languageChanged = this._language !== buschCoreKey(hass.locale || hass.language);
      this.hass = hass; this.registry.hass = hass; this._language = buschCoreKey(hass.locale || hass.language);
      if (languageChanged) this.engine.refresh();
      if (!this.streaming && [hass.entities, hass.devices, hass.areas, hass.floors].some((value, index) => value !== this._display[index])) this.seed(hass);
      // Without a stream, compare state references once for the shared runtime.
      if (!this.streaming && this._states !== hass.states) this.syncStates(hass.states || {});
      return;
    }
    this.dispose(); this.index.labels = new Map(); this.lastErrors.clear(); this.connection = identity; this.hass = hass; this.registry.hass = hass; this._language = buschCoreKey(hass.locale || hass.language); this.seed(hass);
    const generation = this.generation;
    const connection = hass.connection;
    let stateReady = Promise.resolve();
    if (typeof connection?.subscribeEvents === "function") {
      this._stateBuffer = [];
      const subscribe = (type, callback) => {
        return Promise.resolve(connection.subscribeEvents(event => { if (generation === this.generation) callback(event); }, type)).then(unsubscribe => {
          if (generation !== this.generation) unsubscribe(); else {
            this.unsubscribers.push(unsubscribe);
            if (type === "state_changed") return this.syncStream();
          }
        }).catch(() => { if (generation === this.generation) this.streaming = false; });
      };
      stateReady = subscribe("state_changed", event => {
        if (this._stateBuffer) this._stateBuffer.push(event.data);
        else this.updateState(event.data.entity_id, event.data.new_state);
      });
      for (const name of Object.keys(BUSCH_REGISTRY_IDS)) subscribe(`${name}_registry_updated`, () => {
        this._dirtyRegistries ||= new Set(); this._dirtyRegistries.add(name);
        if (this._registryTimer) return;
        this._registryTimer = setTimeout(() => { this._registryTimer = null; const names = [...this._dirtyRegistries]; this._dirtyRegistries.clear(); this.refreshRegistries(names, true); }, 50);
      });
      if (typeof connection.addEventListener === "function") {
        const onReady = () => {
          if (generation !== this.generation) return;
          this.registry.clear(); this._refreshing.clear(); this._queuedRefresh?.clear();
          this._snapshotEpoch = (this._snapshotEpoch || 0) + 1; this._snapshotPromise = null; this._stateBuffer = []; this.streaming = false;
          this.ready = Promise.all([this.syncStream(), this.refreshRegistries()]); return this.ready;
        };
        connection.addEventListener("ready", onReady);
        this.unsubscribers.push(() => connection.removeEventListener?.("ready", onReady));
      }
    }
    this.ready = Promise.all([stateReady, typeof hass.callWS === "function" ? this.refreshRegistries() : Promise.resolve()]);
  }
  syncStream() {
    if (this._snapshotPromise) return this._snapshotPromise;
    const generation = this.generation, epoch = this._snapshotEpoch || 0, hass = this.hass; this._stateBuffer ||= [];
    const pending = Promise.resolve().then(() => hass.callWS({ type: "get_states" })).then(rows => {
      if (generation !== this.generation || epoch !== (this._snapshotEpoch || 0)) return;
      if (!Array.isArray(rows)) throw new Error("Invalid state snapshot");
      const states = Object.fromEntries(rows.map(state => [state.entity_id, state]));
      for (const event of this._stateBuffer || []) {
        const previous = states[event.entity_id], next = event.new_state;
        if (!next) delete states[event.entity_id];
        else if (!previous || !previous.last_updated || !next.last_updated || next.last_updated >= previous.last_updated) states[event.entity_id] = next;
      }
      this._stateBuffer = null; this.syncStates(states); this.streaming = true; this.lastErrors.delete("states");
    }).catch(error => {
      if (generation !== this.generation || epoch !== (this._snapshotEpoch || 0)) return;
      for (const event of this._stateBuffer || []) this.updateState(event.entity_id, event.new_state);
      this._stateBuffer = null; this.streaming = false; this.lastErrors.set("states", error);
    }).finally(() => { if (this._snapshotPromise === pending) this._snapshotPromise = null; });
    this._snapshotPromise = pending; return pending;
  }
  syncStates(states) {
    const ids = new Set([...this.index.states.keys(), ...Object.keys(states)]);
    for (const id of ids) if (this.index.states.get(id) !== states[id]) this.updateState(id, states[id]);
    this._states = states;
  }
  updateState(id, state) {
    this.metrics.stateUpdates++; const change = this.index.update(id, state); this.engine?.changed(change);
    for (const device of [change.old?.device_id, change.next?.device_id]) if (device && this._deviceListeners.has(device)) this._dirtyDevices.add(device);
    if (this._dirtyDevices.size && !this._deviceNotifyQueued) {
      this._deviceNotifyQueued = true;
      Promise.resolve().then(() => {
        this._deviceNotifyQueued = false; const ids = [...this._dirtyDevices]; this._dirtyDevices.clear();
        for (const device of ids) for (const listener of this._deviceListeners.get(device) || []) { try { listener(); } catch {} }
      });
    }
  }
  watchDevice(deviceId, callback) {
    if (!this._deviceListeners.has(deviceId)) this._deviceListeners.set(deviceId,new Set());
    const listeners = this._deviceListeners.get(deviceId); listeners.add(callback);
    return () => { listeners.delete(callback); if (!listeners.size && this._deviceListeners.get(deviceId) === listeners) this._deviceListeners.delete(deviceId); };
  }
  refreshRegistries(names = Object.keys(BUSCH_REGISTRY_IDS), afterPending = false) {
    const generation = this.generation;
    this._refreshing ||= new Map(); this._queuedRefresh ||= new Set();
    return Promise.all(names.map(name => {
      if (this._refreshing.has(name)) {
        if (afterPending) this._queuedRefresh.add(name);
        return this._refreshing.get(name);
      }
      if (this.registry.promises.has(name)) this.registry.invalidate(name);
      const pending = this.registry.load(name).catch(error => {
        if (generation === this.generation) { this.lastErrors.set(name, error); for (const listener of this._listeners) { try { listener(); } catch {} } }
        return null;
      }).finally(() => {
        if (generation !== this.generation || this._refreshing.get(name) !== pending) return;
        this._refreshing.delete(name);
        if (this._queuedRefresh.delete(name)) return this.refreshRegistries([name]);
      });
      this._refreshing.set(name, pending); return pending;
    }));
  }
  loadEntityRegistry() { return this.registry.load("entity"); }
  loadDeviceRegistry() { return this.registry.load("device"); }
  loadAreaRegistry() { return this.registry.load("area"); }
  loadFloorRegistry() { return this.registry.load("floor"); }
  loadLabelRegistry() { return this.registry.load("label"); }
  watch(callback) { this._listeners.add(callback); return () => this._listeners.delete(callback); }
  retain(hass) { this.attach(hass); this.users++; let released = false; return () => { if (released) return; released = true; if (--this.users <= 0) this.dispose(); }; }
  query(spec) { return this.engine.query(spec); }
  smartQuery(spec, scopeDeviceId) { this.smart ||= new BuschSmartQueries(this); return this.smart.query(spec, scopeDeviceId); }
  subscribe(query, callback) { return this.engine.subscribe(query, callback); }
  debugSnapshot() { return { ...this.metrics, entities: this.entities.size, devices: this.devices.size, registryRequests: { ...this.registry.requests }, errors: [...this.lastErrors.keys()] }; }
  dispose() {
    this.generation++; for (const unsubscribe of this.unsubscribers.splice(0)) Promise.resolve(unsubscribe()).catch(() => {});
    this.streaming = false; this.connection = null; this.registry.clear(); this._refreshing = new Map(); this._queuedRefresh = new Set(); this._snapshotPromise = null; this._stateBuffer = null;
    if (this._registryTimer) clearTimeout(this._registryTimer); this._registryTimer = null; this._dirtyRegistries?.clear(); this._dirtyDevices.clear(); this.engine?.stop();
  }
}
function ensureBuschCore(requiredApiVersion = 1) {
  const major = Number(String(requiredApiVersion).split(".")[0]);
  if (major !== 1) throw new Error(`Busch Cards Core API ${major} is incompatible with API 1 / ist mit API 1 nicht kompatibel.`);
  const core = globalThis[BUSCH_CORE_KEY] || (globalThis[BUSCH_CORE_KEY] = new BuschCardsCore());
  if (Number(String(core.apiVersion).split(".")[0]) !== major) throw new Error("Busch Cards Core API mismatch / inkompatible API-Version.");
  return core;
}

// auto-entities 1.16.1 compatibility semantics, adapted for Busch's shared index.
// Upstream: https://github.com/thomasloven/lovelace-auto-entities
// Attribution and MIT permission notice follow this compatibility section.
function buschSmartMatch(value, pattern, now = Date.now()) {
  const checks = [];
  if (typeof pattern === 'string') {
    if (pattern.startsWith('$$')) { pattern = pattern.slice(2); value = JSON.stringify(value); }
    if ((pattern.startsWith('/') && pattern.endsWith('/')) || pattern.includes('*')) {
      if (!pattern.startsWith('/')) pattern = '/^' + pattern.replace(/\*/g, '.*') + '$/';
      const regex = new RegExp(pattern.slice(1, -1));
      checks.push(v => typeof v === 'string' && regex.test(v));
    }
    const age = /([mhd])\s+ago\s*$/i.exec(pattern);
    if (age) {
      pattern = pattern.replace(age[0], '');
      value = (now - new Date(value).getTime()) / 60000 / (age[1] === 'h' ? 60 : age[1] === 'd' ? 1440 : 1);
    }
    // Deliberately independent: upstream's overlapping != / ! comparisons
    // and unescaped glob punctuation are part of the imported config contract.
    const ops = {'<=':(a,b)=>a<=b,'>=':(a,b)=>a>=b,'==':(a,b)=>a===b,'!=':(a,b)=>a!==b,'<':(a,b)=>a<b,'>':(a,b)=>a>b,'!':(a,b)=>a!==b,'=':(a,b)=>a===b};
    for (const [op, test] of Object.entries(ops)) if (pattern.startsWith(op)) {
      const limit = parseFloat(pattern.slice(op.length)); checks.push(v => test(parseFloat(v), limit));
    }
  }
  return value !== undefined && (value === pattern || checks.some(fn => fn(value)));
}
function buschSmartContext(core, id) {
  const info = core.entities.get(id), entity = info?.registry;
  const state = core.index.states.get(id);
  const device = core.devices.get(entity?.device_id);
  const area = core.areas.get(entity?.area_id) || core.areas.get(device?.area_id);
  const floor = core.floors.get(area?.floor_id);
  return {info, entity, state, device, area, floor};
}
function buschSmartPath(value, path, valueOutput = false) {
  if (valueOutput && value && Object.hasOwn(value, String(path))) return value[String(path)];
  return String(path).split(valueOutput ? /[.:]/ : ':').reduce((obj, key) => obj?.[key], value);
}
function buschSmartFilter(core, rule, id, now = Date.now()) {
  if (typeof id !== 'string') id = id?.entity;
  const {entity, state, device, area, floor} = buschSmartContext(core, id);
  if (!state) return false;
  const entries = Object.entries(rule).map(([key,value]) => [key.trim().split(' ')[0].trim(),value]).filter(([key]) => !['type','options','sort'].includes(key));
  if (!entries.length) return false;
  return entries.every(([key,value]) => {
    const match = v => buschSmartMatch(v,value,now);
    switch (key) {
      case 'domain': return match(id.split('.')[0]);
      case 'entity_id': return match(id);
      case 'state': return match(state.state) || match(core.hass.formatEntityState(state));
      case 'name': return match(state.attributes?.friendly_name);
      case 'group': return !!core.index.states.get(value)?.attributes?.entity_id?.includes(id);
      case 'attributes': return Object.entries(value).every(([k,v]) => buschSmartMatch(buschSmartPath(state.attributes,k.split(' ')[0]),v,now));
      case 'not': return !buschSmartFilter(core,value,id,now);
      case 'and': return value.every(v => buschSmartFilter(core,v,id,now));
      case 'or': return value.some(v => buschSmartFilter(core,v,id,now));
      case 'device': return !!device && (match(device.id) || match(device.name_by_user) || match(device.name));
      case 'device_manufacturer': return !!device && match(device.manufacturer);
      case 'device_model': return !!device && match(device.model);
      case 'area': return !!entity && !!area && (match(area.name) || match(area.area_id));
      case 'floor': return !!entity && !!floor && (match(floor.name) || match(floor.floor_id));
      case 'level': return !!entity && !!floor && match(floor.level);
      case 'entity_category': return !!entity && match(entity.entity_category);
      case 'hidden_by': return !!entity && match(entity.hidden_by);
      case 'integration': return !!entity && (match(entity.platform) || match(entity.config_entry_id));
      case 'label': {
        if (!entity?.labels) return false;
        const labelMatch = label => match(label) || match(core.labels.get(label)?.name);
        return entity.labels.some(labelMatch) || !!device && device.labels.some(labelMatch);
      }
      case 'last_changed': case 'last_updated': case 'last_triggered':
        return buschSmartMatch(key === 'last_triggered' ? state.attributes.last_triggered : state[key], /([mhd])\s+ago\s*$/i.test(value) ? value : value + 'm ago',now);
      default: return false;
    }
  });
}
function buschSmartCompare(a,b,sort) {
  const [lt,gt] = sort.reverse ? [1,-1] : [-1,1];
  if (sort.ignore_case) { a=a?.toLowerCase?.()??a; b=b?.toLowerCase?.()??b; }
  if (sort.numeric && !(isNaN(parseFloat(a)) && isNaN(parseFloat(b)))) {
    a=isNaN(parseFloat(a))?undefined:parseFloat(a); b=isNaN(parseFloat(b))?undefined:parseFloat(b);
  }
  if (a===undefined && b===undefined) return 0;
  if (a===undefined) return gt;
  if (b===undefined) return lt;
  if (sort.numeric) return a===b?0:a<b?lt:gt;
  if (sort.ip) {
    const aa=a.split('.'),bb=b.split('.');
    return (sort.reverse?-1:1) * ([0,1,2,3].map(i=>buschSmartCompare(aa[i],bb[i],{numeric:true})).find(v=>v!==0)||0);
  }
  return (sort.reverse?-1:1)*String(a).localeCompare(String(b),undefined,sort);
}
function buschSmartSort(core, rows, sort) {
  const methods = ['none','domain','entity_id','friendly_name','name','device','device_name','area','state','attribute','last_changed','last_updated','last_triggered'];
  if (!sort?.method || !methods.includes(sort.method)) return rows;
  const method = {...sort};
  if (['last_changed','last_updated','last_triggered'].includes(method.method)) method.numeric=true;
  const prepare = row => {
    const {state,device,area}=buschSmartContext(core,row.entity);
    switch(method.method) {
      case 'none': return 0;
      case 'domain': return state?.entity_id?.split('.')[0];
      case 'entity_id': return state?.entity_id;
      case 'friendly_name': case 'name': return state?.attributes?.friendly_name || state?.entity_id?.split('.')[1];
      case 'device': case 'device_name': return device?.name_by_user??device?.name;
      case 'area': return area?.name;
      case 'state': return state?.state;
      case 'attribute': return method.attribute?.split(':').reduce((v,k)=>v?.[k],state?.attributes);
      default: { const value=method.method==='last_triggered'?state?.attributes?.last_triggered:state?.[method.method]; return value?new Date(value).getTime():undefined; }
    }
  };
  return rows.map(row=>({row,key:prepare(row)})).sort((a,b)=>buschSmartCompare(a.key,b.key,method)).map(x=>x.row);
}
function buschSmartPage(rows, sort) {
  if (!sort?.count && !sort?.first) return rows;
  const first=sort.first??0;return rows.slice(first,first+(sort.count??Infinity));
}
function buschSmartProcess(core, row, id) {
  const {entity,device,area,state}=buschSmartContext(core,id);
  let text=JSON.stringify(row).replace(/this.entity_id/g,id);
  if (row.eval_js === true) {
    const evaluate=new Function('entity_id','entity','device','area','state','"use strict"; return (String.raw`'+text+'`);');
    try { text=evaluate(id,entity?.name_by_user??entity?.name,device?.name_by_user??device?.name,area?.name_by_user??area?.name,state); }
    catch(error) { return {error:error.message}; }
  }
  return JSON.parse(text);
}
function buschSmartValueKey(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array:['+value.map(buschSmartValueKey).join(',')+']';
  if (typeof value === 'object') return 'object:{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+buschSmartValueKey(value[k])).join(',')+'}';
  return typeof value+':'+JSON.stringify(value);
}
function buschSmartUnique(rows, unique) {
  if (!unique) return rows;
  const seen=new Set();return rows.filter(row=>{const key=unique==='entity'?row.entity:buschSmartValueKey(row);if(seen.has(key))return false;seen.add(key);return true;});
}
function buschSmartResult(core, config, templateRows = [], matchedIncludes = null, trace = null) {
  if(trace)Object.assign(trace,{rows:[],missing:0,duplicates:0,projected:0,output:0,truncated:false});
  const record=entry=>{if(!trace)return;if(trace.rows.length<100)trace.rows.push(entry);else trace.truncated=true;};
  const format=row=>!row?null:typeof row==='string'?{entity:row.trim()}:row;
  const contexts=new Map();
  let rows=[...(config.entities||[]),...(templateRows||[])].map(format).filter(Boolean);
  for (const [index,rule] of (config.filter?.include||[]).entries()) {
    if (rule.type!==undefined) { rows.push(rule);continue; }
    const ids=matchedIncludes?.[index]??[...core.index.states.keys()].filter(id=>buschSmartFilter(core,rule,id));
    const add=buschSmartPage(buschSmartSort(core,Array.from(ids,id=>({entity:id})),rule.sort),rule.sort);
    rows.push(...add.map(row=>{const processed=buschSmartProcess(core,{...row,...rule.options},row.entity);contexts.set(processed,row.entity);return processed;}));
  }
  rows=rows.filter(row=>!(config.filter?.exclude||[]).some(rule=>buschSmartFilter(core,rule,row.entity)));
  if (!config.value) return buschSmartPage(buschSmartUnique(buschSmartSort(core,config.unique_values?buschSmartUnique(rows,true):rows,config.sort),config.unique),config.sort);
  rows=buschSmartUnique(rows,config.unique);
  const seen=new Set(), projected=[];
  for (const row of rows) {
    const sourceId=contexts.get(row)??row.entity;
    const {entity,state}=buschSmartContext(core,sourceId);
    const type=config.value.type||'entity_id';
    let value=type==='entity_id'?sourceId:type==='device_id'?entity?.device_id:buschSmartPath(state?.attributes,config.value.attribute??config.value.path??'',true);
    if (value===undefined || value===null) {
      if (config.value.missing!=='null' && config.value.missing!==null) {if(trace){trace.missing++;record({source:sourceId,value:null,status:'missing'});}continue;}
      value=null;
    }
    const key=buschSmartValueKey(value);
    if(config.unique_values && seen.has(key)){if(trace){trace.duplicates++;record({source:sourceId,value,status:'duplicate'});}continue;}
    if(trace)record({source:sourceId,value,status:'limited'});seen.add(key);projected.push({entity:sourceId,value});
  }
  const selected=buschSmartPage(buschSmartSort(core,projected,config.sort),config.sort);
  if(trace){trace.projected=projected.length;trace.output=selected.length;const ids=new Set(selected.map(row=>row.entity));for(const row of trace.rows)if(row.status==='limited'&&ids.has(row.source))row.status='selected';}
  return selected.map(row=>row.value);
}

/*
MIT License

Copyright (c) 2019 Thomas Lovén

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

function buschSmartSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(buschSmartSnapshot));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,buschSmartSnapshot(item)])));
  return value;
}
/* Smart Entities: shared incremental membership and final projection. */
function buschSmartPlan(rule) {
  const constraints = [], groups = new Set(), times = [];
  const walk = (node, safe = true) => {
    if (!node || typeof node !== 'object') return;
    for (const [raw, value] of Object.entries(node)) {
      const key = raw.trim().split(' ')[0];
      if (key === 'group') groups.add(value);
      if (key === 'and') { for (const child of value) walk(child, safe); }
      if (key === 'or') { for (const child of value) walk(child, false); }
      if (key === 'not') walk(value, false);
      if (safe && ['domain', 'integration', 'entity_id'].includes(key) && typeof value === 'string' && !value.startsWith('$$') && !/[*/<>=!]/.test(value)) constraints.push([key, value]);
      const time = (path, pattern) => {
        const text=String(pattern),match=text.match(/([mhd])\s+ago\s*$/i);
        const amount=match?parseFloat(text.slice(0,match.index).replace(/^\s*[<>=!]+/,'')):NaN;
        if (Number.isFinite(amount)) times.push({path,duration:amount*(match[1]==='h'?3600000:match[1]==='d'?86400000:60000)});
      };
      if (['last_changed','last_updated','last_triggered'].includes(key)) time(key === 'last_triggered' ? ['attributes',key] : [key], /[mhd]\s+ago\s*$/i.test(value) ? value : value + 'm ago');
      if (['state','entity_id','name'].includes(key)) time(key === 'name' ? ['attributes','friendly_name'] : [key], value);
      if (key === 'attributes') for (const [attr, pattern] of Object.entries(value || {})) time(['attributes',...attr.split(' ')[0].split(':')], pattern);
    }
  };
  walk(rule);
  return { constraints, groups, times, guard: info => !!info && constraints.every(([key,value]) => key === 'entity_id' ? info.entity_id === value : key === 'domain' ? info.domain === value : info.registry?.platform === value || info.registry?.config_entry_id === value) };
}
class BuschSmartQueries {
  constructor(core) { this.core = core; }
  query(config, scopeDeviceId) {
    const copy = JSON.parse(JSON.stringify(config)), cacheSpec = {...copy};
    if (!copy.filter?.template) for (const key of ['type','card','card_param','item','item_param','else','show_empty','debug']) delete cacheSpec[key];
    const key = 'smart:' + buschCoreKey(scopeDeviceId?{scopeDeviceId,spec:cacheSpec}:cacheSpec), engine = this.core.engine;
    if (engine.cache.has(key)) return engine.cache.get(key);
    const include = copy.filter?.include || [];
    const query = { key, scopeDeviceId, spec: copy, smart: this, javascript:(copy.filter?.include||[]).some(rule=>rule.options?.eval_js===true), include: include.map(buschSmartPlan), extraPlans:(copy.filter?.exclude||[]).map(buschSmartPlan), matched:include.map(()=>new Set()), subscribers:new Set(), result:Object.freeze([]), nextDeadline:Infinity, deadlines:new Map(), metrics:{calculations:0,evaluated:0,candidates:0,executionMs:0}, templateRows:[], templateGeneration:0 };
    engine.cache.set(key,query); this.calculate(query); engine.evict(); return query;
  }
  candidates(plan, query) { return this.core.engine.candidates({lookups:query.scopeDeviceId?[...plan.constraints,['device',query.scopeDeviceId]]:plan.constraints}); }
  changed(query, change) {
    const id = change.id;
    if (query.javascript || [...query.include,...query.extraPlans].some(p=>p.groups.has(id))) return this.calculate(query);
    if(query.scopeDeviceId && ![change.old,change.next].some(info=>info?.device_id===query.scopeDeviceId)){this.core.metrics.queriesSkipped++;return;}
    const statics = [...(query.spec.entities||[]),...query.templateRows];
    if (query.include.some(p=>p.guard(change.old)||p.guard(change.next)) || statics.some(row=>(typeof row==='string'?row.trim():row?.entity)===id)) this.calculate(query,[id]);
    else this.core.metrics.queriesSkipped++;
  }
  calculate(query, ids) {
    try { return this.compute(query, ids); } catch (error) { query.error=error; this.notify(query); }
  }
  compute(query, ids) {
    const start=performance.now(),now=Date.now(); query.metrics.calculations++;this.core.metrics.queriesRecalculated++;
    let touched=new Set();
    for (const [index,rule] of (query.spec.filter?.include||[]).entries()) {
      if (rule.type !== undefined) continue;
      const plan=query.include[index], candidates=ids || this.candidates(plan,query);
      if (!ids) query.matched[index].clear();
      for (const id of candidates) {
        if (!plan.guard(this.core.getEntity(id)) || (query.scopeDeviceId&&this.core.getEntity(id)?.device_id!==query.scopeDeviceId)) { query.matched[index].delete(id);continue; }
        touched.add(id);query.metrics.evaluated++;
        if (buschSmartFilter(this.core,rule,id,now)) query.matched[index].add(id);else query.matched[index].delete(id);
      }
    }
    if (!ids) query.deadlines.clear();
    // Plan every possible age boundary, including excluded and currently absent matches.
    const timed=[...query.include,...query.extraPlans].filter(p=>p.times.length);
    for(const id of ids || new Set([...touched,...[...(query.spec.entities||[]),...query.templateRows].map(e=>typeof e==='string'?e.trim():e.entity)])) {
      let deadline=Infinity;const info=this.core.getEntity(id);
      for(const plan of timed) if(plan.guard(info)) for(const time of plan.times) {
        const stamp=time.path.reduce((v,k)=>v?.[k],info?.stateObject), boundary=new Date(stamp).getTime()+time.duration;
        for(const at of [boundary,boundary+1]) if(at>now) deadline=Math.min(deadline,at);
      }
      if(Number.isFinite(deadline))query.deadlines.set(id,deadline);else query.deadlines.delete(id);
    }
    query.nextDeadline=Infinity;for(const at of query.deadlines.values())query.nextDeadline=Math.min(query.nextDeadline,at);
    query.metrics.candidates=touched.size;
    try {
      const result=buschSmartResult(this.core,query.spec,query.templateRows,query.matched.map(set=>[...set].sort((a,b)=>this.core.index.order.get(a)-this.core.index.order.get(b))));
      const signature=buschCoreKey(result);
      if(signature!==query.signature || query.error){query.signature=signature;query.result=buschSmartSnapshot(result);query.error=query.templateError||null;this.notify(query);}
    }catch(error){query.error=error;this.notify(query);}
    query.metrics.executionMs=performance.now()-start;
    if(query.subscribers.size)this.startTemplate(query);
  }
  notify(query){this.core.metrics.resultChanges++;for(const fn of query.subscribers){try{fn(query.result);}catch(error){console.warn('Busch Smart subscriber failed',error?.name);}}}
  startTemplate(query){
    const template=query.spec.filter?.template;
    if(!template || query.templateActive || !/\{[{%#]/.test(template))return;
    query.templateActive=true;const generation=++query.templateGeneration;
    const connection=this.core.hass?.connection;
    if(typeof connection?.subscribeMessage!=='function'){query.error=query.templateError=new Error('template_unavailable');this.notify(query);return;}
    Promise.resolve().then(()=>connection.subscribeMessage(message=>{
      if(generation!==query.templateGeneration)return;
      if(message.error){query.error=query.templateError=new Error('template_error');this.notify(query);return;}
      query.templateError=null;const raw=message.result;query.templateRows=typeof raw==='string'?raw.split(/[\s,]+/).filter(Boolean):Array.isArray(raw)?raw:[];
      if(query.templateQueued)return;query.templateQueued=true;
      Promise.resolve().then(()=>{query.templateQueued=false;if(generation!==query.templateGeneration)return;this.calculate(query);this.core.engine.schedule();});
    },{type:'render_template',template,variables:{config:query.spec},strict:true})).then(off=>{
      if(generation!==query.templateGeneration)off();else query.templateOff=off;
    }).catch(()=>{if(generation===query.templateGeneration){query.error=query.templateError=new Error('template_error');this.notify(query);}});
  }
  stop(query){query.templateGeneration++;query.templateOff?.();query.templateOff=null;query.templateActive=false;query.templateRows=[];query.templateError=null;}
}

const CARD_VERSION = "0.14.0";

console.info(
  `%c BUSCH-CARDS %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);


/* ────────────────────────────────────────────────────────────────────────────
 * Sprache und Wörterbücher — gemeinsam für alle drei Karten
 *
 * `docs/ui-regeln.md`, Regel 3: jede Karte hat EIN Wörterbuch mit beiden
 * Sprachen für Labels, Helper, Knöpfe, Fehlermeldungen und Leerzustände. Kein
 * nutzersichtbarer Text steht außerhalb davon.
 *
 * Welche Sprache gilt, entscheidet `hass.locale.language`. Der Eintrag im
 * Kartenwähler (`window.customCards`) entsteht aber beim Laden der Datei —
 * da gibt es noch keinen `hass`. Dort entscheidet `navigator.language`.
 * ──────────────────────────────────────────────────────────────────────── */

/** `de` oder `en` — mehr Sprachen hat diese Datei nicht. */
function buschSprache(hass) {
  let sprache = "";
  if (hass && hass.locale && hass.locale.language) sprache = hass.locale.language;
  else if (hass && hass.language) sprache = hass.language;
  else if (typeof navigator !== "undefined" && navigator.language) sprache = navigator.language;
  return String(sprache).toLowerCase().indexOf("de") === 0 ? "de" : "en";
}

/** Der Sprachabschnitt eines Wörterbuchs. Ohne `hass`: der Kartenwähler-Fall. */
function buschTexte(tabelle, hass) {
  return tabelle[buschSprache(hass)] || tabelle.en;
}

/**
 * Ein `ha-form`-Schema mit übersetzten Auswahl-Beschriftungen.
 *
 * Die Schemakonstanten stehen bewusst als reines Objektliteral in der Datei —
 * `scripts/ui-regeln-pruefen.py` liest sie so. Übersetzbarer Text darf darin
 * also nicht stehen. Die Beschriftung einer Auswahloption kommt deshalb aus
 * `texte.texte["<feld>_<wert>"]`; fehlt sie, bleibt die Vorgabe des Schemas
 * stehen (bei der Landkarte sind das Eigennamen wie „OpenStreetMap", die in
 * beiden Sprachen gleich heißen).
 */
function buschSchemaMitTexten(schema, texte) {
  return schema.map((eintrag) => {
    const kopie = { ...eintrag };
    if (Array.isArray(eintrag.schema)) {
      kopie.schema = buschSchemaMitTexten(eintrag.schema, texte);
    }
    const auswahl = eintrag.selector && eintrag.selector.select;
    if (auswahl && Array.isArray(auswahl.options)) {
      kopie.selector = {
        ...eintrag.selector,
        select: {
          ...auswahl,
          options: auswahl.options.map((option) => ({
            ...option,
            label:
              (texte.texte && texte.texte[`${eintrag.name}_${option.value}`]) ||
              option.label ||
              option.value,
          })),
        },
      };
    }
    return kopie;
  });
}

/** Platzhalter `{name}` in einem Text ersetzen. */
function buschFuellen(text, werte) {
  let aus = String(text);
  for (const name of Object.keys(werte || {})) {
    aus = aus.split(`{${name}}`).join(String(werte[name]));
  }
  return aus;
}


/* ────────────────────────────────────────────────────────────────────────────
 * busch-schedule-card — Zeitplan-Helfer (`schedule.*`) direkt im Dashboard
 *
 * Der Datenvertrag stammt aus homeassistant/components/schedule/__init__.py
 * (gelesen an 2026.8.2, gegengeprüft an einer laufenden Installation):
 *
 *   - Ein Eintrag je Wochentag: `{ from: "HH:MM:SS", to: "HH:MM:SS", data? }`
 *   - `from` < `to`, strikt. Gleiche Zeiten sind ungültig.
 *   - Blöcke dürfen sich **berühren** (`vorheriges_to == from`), aber nicht
 *     überlappen. Die Prüfung lautet `previous_to > from`.
 *   - `to` darf `24:00:00` sein (wird intern zu `time.max`); `from` nicht.
 *   - `schedule/update` **ersetzt den ganzen Datensatz**. Was nicht mitkommt,
 *     ist weg — nachgewiesen: ein Update ohne `icon` liefert den Eintrag ohne
 *     Icon zurück. Deshalb gehen Name, Icon, alle sieben Tage und ein etwaiges
 *     `data` je Block bei jedem Speichern mit.
 * ──────────────────────────────────────────────────────────────────────────── */

const SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const MINUTES_PER_DAY = 1440;

const SCHEMA_BUSCH_SCHEDULE_CARD = [
  { name: "entity", required: true, selector: { entity: { filter: { domain: "schedule" } } } },
  { name: "title", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
  {
    name: "first_day",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "auto" }, { value: "monday" }, { value: "sunday" }],
      },
    },
  },
  {
    name: "step",
    selector: { number: { min: 5, max: 60, step: 5, mode: "slider", unit_of_measurement: "min" } },
  },
];

const TEXTE_BUSCH_SCHEDULE_CARD = {
  de: {
    name: "Busch Zeitplan",
    description: "Zeitplan-Helfer im Dashboard bearbeiten — ziehen, tippen, kopieren.",
    labels: {
      entity: "Zeitplan",
      title: "Titel",
      icon: "Symbol",
      first_day: "Woche beginnt am",
      step: "Raster beim Ziehen",
    },
    helpers: {
      entity: "Der schedule-Helfer, dessen Blöcke die Karte zeigt und schreibt. Pflichtfeld, ohne ihn bleibt die Karte leer.",
      title: "Überschrift der Karte. Vorgabe: der Name des Helfers.",
      icon: "Ein mdi-Symbol links neben der Überschrift. Vorgabe: das Symbol des Helfers, sonst mdi:calendar-clock.",
      first_day: "Welcher Wochentag in der obersten Zeile steht. Vorgabe: wie in Home Assistant.",
      step: "Minuten, auf die Ziehen und Größenändern einrasten. Vorgabe 15.",
    },
    texte: {
      first_day_auto: "Wie in Home Assistant",
      first_day_monday: "Montag",
      first_day_sunday: "Sonntag",
      laden: "Lade …",
      speichernLaeuft: "Speichere …",
      nichtGefunden: "Zeitplan zu {entity} nicht gefunden. In YAML festgelegte Zeitpläne lassen sich nicht über die Oberfläche ändern.",
      nichtGespeichert: "Zeitplan nicht gespeichert: {grund}",
      entitaetFehlt: "Entität nicht gefunden",
      ein: "Ein",
      aus: "Aus",
      bis: "bis",
      ab: "ab",
      hinweisNurLesen: "In YAML festgelegt — hier nur zum Ansehen.",
      hinweisZiehen: "Ziehen legt einen Block an, Tippen öffnet ihn.",
      von: "Von",
      dialogBis: "Bis",
      mitternacht: "Bis <b>00:00</b> bedeutet Mitternacht am Tagesende.",
      fehlerBeideZeiten: "Bitte beide Zeiten angeben.",
      fehlerReihenfolge: "Die Startzeit muss vor der Endzeit liegen.",
      fehlerUeberschneidung: "Der Zeitraum überschneidet sich mit einem anderen Block.",
      schliessen: "Schließen",
      abbrechen: "Abbrechen",
      speichern: "Speichern",
      loeschen: "Löschen",
      blockLoeschen: "Block löschen",
      kopierenAlle: "Auf alle Tage kopieren",
      kopierenWerktage: "Auf Montag bis Freitag kopieren",
      kopierenWochenende: "Auf Samstag und Sonntag kopieren",
      tagLeeren: "Alle Blöcke dieses Tages löschen",
    },
  },
  en: {
    name: "Busch schedule",
    description: "Edit a schedule helper right on the dashboard — drag, tap, copy.",
    labels: {
      entity: "Schedule",
      title: "Title",
      icon: "Icon",
      first_day: "Week starts on",
      step: "Drag step",
    },
    helpers: {
      entity: "The schedule helper whose blocks this card shows and writes. Required; without it the card stays empty.",
      title: "Heading of the card. Default: the name of the helper.",
      icon: "An mdi icon left of the heading. Default: the icon of the helper, otherwise mdi:calendar-clock.",
      first_day: "Which weekday sits in the top row. Default: as in Home Assistant.",
      step: "Minutes that dragging and resizing snap to. Default 15.",
    },
    texte: {
      first_day_auto: "As in Home Assistant",
      first_day_monday: "Monday",
      first_day_sunday: "Sunday",
      laden: "Loading …",
      speichernLaeuft: "Saving …",
      nichtGefunden: "No schedule found for {entity}. Schedules defined in YAML cannot be changed from the interface.",
      nichtGespeichert: "Schedule not saved: {grund}",
      entitaetFehlt: "Entity not found",
      ein: "On",
      aus: "Off",
      bis: "until",
      ab: "from",
      hinweisNurLesen: "Defined in YAML — read only here.",
      hinweisZiehen: "Drag to add a block, tap to open it.",
      von: "From",
      dialogBis: "To",
      mitternacht: "A <b>00:00</b> end means midnight at the end of the day.",
      fehlerBeideZeiten: "Please enter both times.",
      fehlerReihenfolge: "The start time must be before the end time.",
      fehlerUeberschneidung: "This range overlaps another block.",
      schliessen: "Close",
      abbrechen: "Cancel",
      speichern: "Save",
      loeschen: "Delete",
      blockLoeschen: "Delete block",
      kopierenAlle: "Copy to every day",
      kopierenWerktage: "Copy to Monday through Friday",
      kopierenWochenende: "Copy to Saturday and Sunday",
      tagLeeren: "Delete every block of this day",
    },
  },
};

/** "HH:MM:SS" → Minuten seit Mitternacht. "24:00:00" → 1440. */
function parseScheduleTime(value) {
  const parts = String(value ?? "").split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY, hours * 60 + minutes);
}

/** Minuten → "HH:MM:SS" für die API. 1440 muss "24:00:00" sein. */
function formatScheduleTime(minutes) {
  const total = Math.round(minutes);
  if (total >= MINUTES_PER_DAY) return "24:00:00";
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

/** Minuten → "HH:MM" für die Anzeige. 1440 wird bewusst "24:00". */
function formatClock(minutes) {
  const total = Math.round(minutes);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Minuten → "HH:MM" für <input type="time">. Mitternacht ist dort 00:00. */
function toInputTime(minutes) {
  return formatClock(Math.round(minutes) % MINUTES_PER_DAY);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Freier Bereich um `index` herum. Nachbarn dürfen berührt werden, deshalb
 * sind deren Kanten inklusive Grenzen — genau wie `valid_schedule` es prüft.
 */
function freeRange(blocks, index) {
  const before = blocks[index - 1];
  const after = blocks[index + 1];
  return {
    min: before ? before.end : 0,
    max: after ? after.start : MINUTES_PER_DAY,
  };
}

/** Freie Lücke, die `minute` enthält. Ohne Lücke: null. */
function gapAt(blocks, minute) {
  let min = 0;
  for (const block of blocks) {
    if (block.start > minute) return { min, max: block.start };
    if (minute < block.end) return null; // liegt in einem Block
    min = block.end;
  }
  return min >= MINUTES_PER_DAY ? null : { min, max: MINUTES_PER_DAY };
}

class BuschScheduleCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-schedule-card-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((id) => id.startsWith("schedule."));
    return { type: "custom:busch-schedule-card", entity: entity || "" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._model = null; // { monday: [{start, end, data}], ... }
    this._item = null; // Rohdatensatz aus schedule/list
    this._scheduleId = null;
    this._loading = false;
    this._error = null;
    this._drag = null;
    this._onVisibility = () => {
      if (document.visibilityState === "visible") this._load(true);
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("busch-schedule-card: 'entity' fehlt");
    }
    if (!String(config.entity).startsWith("schedule.")) {
      throw new Error("busch-schedule-card: 'entity' muss ein schedule.* sein");
    }
    const step = Number(config.step);
    this._config = {
      first_day: "auto",
      ...config,
      step: Number.isFinite(step) && step >= 1 ? Math.min(60, step) : 15,
    };
    this._scheduleId = null;
    this._item = null;
    this._model = null;
    this._build();
    if (this._hass) this._load(true);
  }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!previous || buschSprache(previous) !== buschSprache(hass)) {
      // Beim Aufbau gab es noch keinen `hass` und damit keine Sprache. Die
      // festen Texte im Aufbau werden deshalb hier nachgezogen.
      this._renderTexte();
    }
    if (!previous) {
      this._load(true);
      return;
    }
    // Ein neues State-Objekt heißt: Zustand oder Attribute haben sich geändert.
    // Beim Zeitplan ändert sich dabei praktisch immer `next_event`.
    const before = previous.states?.[this._config.entity];
    const now = hass.states?.[this._config.entity];
    if (before !== now && !this._drag && !this._saving) this._load(false);
    this._renderHeader();
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisibility);
    if (this._hass && this._config && !this._model) this._load(true);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisibility);
    // Ein Dialog, dessen Karte aus dem Dokument fliegt, darf keinen
    // popstate-Lauscher zurücklassen — der hielte die Karte am Leben und
    // reagierte auf jede spätere Navigation.
    for (const dialog of [this._els?.blockDialog, this._els?.dayDialog]) {
      if (dialog && dialog._buschPop) {
        window.removeEventListener("popstate", dialog._buschPop);
        dialog._buschPop = null;
      }
    }
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 5 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_SCHEDULE_CARD, this._hass).texte;
  }

  get _readonly() {
    const state = this._hass?.states?.[this._config.entity];
    // `editable: false` heißt: in YAML definiert, die Storage-API greift nicht.
    return state?.attributes?.editable === false;
  }

  _orderedDays() {
    let first = this._config.first_day || "auto";
    if (first === "auto") {
      const locale = this._hass?.locale?.first_weekday;
      first = SCHEDULE_DAYS.includes(locale) ? locale : "monday";
    }
    const start = Math.max(0, SCHEDULE_DAYS.indexOf(first));
    return SCHEDULE_DAYS.slice(start).concat(SCHEDULE_DAYS.slice(0, start));
  }

  _dayLabels() {
    const language = this._hass?.locale?.language || navigator.language || "de";
    let short;
    let long;
    try {
      short = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
      long = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });
    } catch {
      short = new Intl.DateTimeFormat("de", { weekday: "short", timeZone: "UTC" });
      long = new Intl.DateTimeFormat("de", { weekday: "long", timeZone: "UTC" });
    }
    const labels = {};
    SCHEDULE_DAYS.forEach((day, index) => {
      // 1. Januar 2024 war ein Montag — daher der Versatz.
      const date = new Date(Date.UTC(2024, 0, 1 + index));
      labels[day] = { short: short.format(date), long: long.format(date) };
    });
    return labels;
  }

  /* ── Laden und Speichern ────────────────────────────────────────────── */

  async _load(showSpinner) {
    if (!this._hass || !this._config) return;
    if (this._loading) return;
    this._loading = true;
    if (showSpinner) this._renderStatus(this._texte.laden);
    try {
      if (!this._scheduleId) {
        this._scheduleId = await this._resolveScheduleId();
      }
      const items = await this._hass.callWS({ type: "schedule/list" });
      const item = items.find((entry) => entry.id === this._scheduleId);
      if (!item) {
        throw new Error(
          buschFuellen(this._texte.nichtGefunden, { entity: this._config.entity })
        );
      }
      this._item = item;
      this._model = {};
      for (const day of SCHEDULE_DAYS) {
        this._model[day] = (item[day] || [])
          .map((range) => ({
            start: parseScheduleTime(range.from),
            end: parseScheduleTime(range.to),
            // `data` ist frei belegbar und gehört dem Nutzer — unverändert
            // durchreichen, sonst löscht ein Klick fremde Angaben.
            data: range.data ? { ...range.data } : undefined,
          }))
          .sort((a, b) => a.start - b.start);
      }
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._loading = false;
      this._renderAll();
    }
  }

  /**
   * Die `schedule_id` ist die `unique_id` der Entität. Über die Registry ist
   * das auch nach einer Umbenennung korrekt; der Namensvergleich darunter ist
   * nur der Notnagel für Nutzer ohne Adminrechte.
   */
  async _resolveScheduleId() {
    const entityId = this._config.entity;
    try {
      const entry = await this._hass.callWS({
        type: "config/entity_registry/get",
        entity_id: entityId,
      });
      if (entry?.unique_id) return entry.unique_id;
    } catch {
      /* Registry nicht lesbar — unten weiter. */
    }
    return entityId.slice("schedule.".length);
  }

  async _save() {
    if (!this._hass || !this._item || !this._scheduleId) return;
    const snapshot = JSON.stringify(this._model);
    this._saving = true;
    this._renderStatus(this._texte.speichernLaeuft);

    const payload = {
      type: "schedule/update",
      schedule_id: this._scheduleId,
      name: this._item.name,
    };
    if (this._item.icon) payload.icon = this._item.icon;
    for (const day of SCHEDULE_DAYS) {
      payload[day] = (this._model[day] || [])
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((block) => {
          const range = {
            from: formatScheduleTime(block.start),
            to: formatScheduleTime(block.end),
          };
          if (block.data && Object.keys(block.data).length) range.data = block.data;
          return range;
        });
    }

    try {
      await this._hass.callWS(payload);
      for (const day of SCHEDULE_DAYS) {
        this._item[day] = payload[day];
      }
      this._error = null;
      this._renderStatus("");
    } catch (err) {
      // Zurück auf den letzten bestätigten Stand — ein halb gespeicherter
      // Zeitplan wäre schlimmer als gar keine Änderung.
      this._model = JSON.parse(snapshot);
      this._error = err?.message || String(err);
      this._notify(buschFuellen(this._texte.nichtGespeichert, { grund: this._error }));
      this._renderAll();
    } finally {
      this._saving = false;
    }
  }

  _notify(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        detail: { message },
        bubbles: true,
        composed: true,
      })
    );
  }

  /* ── Aufbau ─────────────────────────────────────────────────────────── */

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        /* Der Container haengt am Host, nicht an ha-card: ha-card bringt sein
           display:block aus dem eigenen Shadow DOM mit, und an einem inline
           dargestellten Element bliebe container-type wirkungslos. */
        :host {
          display: block;
          container-type: inline-size;
          /* --label-col ist ein reines Innenmass der Karte und wird deshalb
             hier festgelegt.

             Die beiden FARBEN stehen bewusst NICHT hier. Sie sind
             dokumentierte Theme-Haken: der Nutzer setzt sie in seinem Theme,
             und HA schreibt sie ans Wurzelelement. Von dort kommen sie durch
             Vererbung an. Eine Vererbung verliert aber gegen jede Regel, die
             das Element selbst trifft — eine Zeile
             --busch-schedule-color: ... an dieser Stelle wuerde die
             Themeangabe also totlegen. In Chromium nachgemessen: mit der
             :host-Zeile wirkte ein Theme am <html> nicht mehr.

             Stattdessen steht der Vorgabewert an der VERWENDUNGSSTELLE als
             var()-Rueckfall, und der Rueckfall ist eine HA-Variable, keine
             Hex-Farbe. Regel 4 ist damit erfuellt, und der Haken bleibt
             erhalten. Das Pruefskript kennt beide Namen in seiner Liste
             THEME_HAKEN. */
          --label-col: 40px;
        }
        ha-card {
          display: block;
          padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px) var(--ha-space-4, 16px);
        }
        .head {
          display: flex;
          align-items: center;
          gap: var(--ha-space-3, 12px);
          padding-bottom: var(--ha-space-3, 12px);
        }
        .head ha-icon {
          color: var(--state-icon-color, var(--paper-item-icon-color));
          flex: 0 0 auto;
        }
        .head.on ha-icon { color: var(--state-active-color, var(--primary-color)); }
        .head .text { flex: 1 1 auto; min-width: 0; }
        .head .name {
          font-size: var(--ha-card-header-font-size, 20px);
          line-height: 1.2;
          color: var(--ha-card-header-color, var(--primary-text-color));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .head .sub {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .head .status {
          flex: 0 1 auto;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .ruler {
          display: grid;
          grid-template-columns: var(--label-col, 40px) 1fr;
          align-items: end;
          gap: 0 8px;
          height: 16px;
          margin-bottom: 2px;
        }
        /* overflow: hidden ist Pflicht, weil die Beschriftungen darin
           ABSOLUT sitzen (Regel 1): der Container muss schneiden können, und
           sein Maß darf nicht vom Text abhängen — es kommt aus dem Raster
           (1fr) und der Höhe des Lineals. */
        .ruler .scale { position: relative; height: 100%; overflow: hidden; min-width: 0; }
        .ruler span {
          position: absolute;
          font-size: 10px;
          line-height: 1;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .ruler span[data-edge="start"] { transform: none; }
        .ruler span[data-edge="end"] { transform: translateX(-100%); }
        /* Bei schmaler Karte nur alle 6 Stunden beschriften. */
        @container (max-width: 460px) {
          .ruler span[data-minor="1"] { display: none; }
        }

        .day {
          display: grid;
          grid-template-columns: var(--label-col, 40px) 1fr;
          align-items: center;
          gap: 0 8px;
          margin-bottom: 4px;
        }
        .day .label {
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .day.today .label {
          color: var(--primary-text-color);
          font-weight: var(--ha-font-weight-medium, 500);
        }

        .track {
          position: relative;
          height: 30px;
          border-radius: 6px;
          background-color: var(--busch-schedule-track-color, var(--divider-color));
          background-image: linear-gradient(
            to right,
            var(--card-background-color) 0 1px,
            transparent 1px
          );
          background-size: calc(100% / 8) 100%;
          overflow: hidden;
          cursor: crosshair;
          /* Waagrecht gehört uns, senkrecht bleibt das Scrollen der Seite. */
          touch-action: pan-y;
          user-select: none;
          -webkit-user-select: none;
        }
        @container (max-width: 460px) {
          .track { height: 36px; }
        }
        .track:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .readonly .track { cursor: default; }

        .block {
          position: absolute;
          top: 0;
          bottom: 0;
          background: var(--busch-schedule-color, var(--primary-color));
          border-radius: 5px;
          color: var(--text-primary-color, #fff);
          font-size: 11px;
          line-height: 30px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          cursor: grab;
          box-sizing: border-box;
          /* Eigener Container je Block: nur so lässt sich die Beschriftung an
             der echten Pixelbreite ausrichten. Ein Prozentwert sagt nichts
             darüber, ob der Text hineinpasst — die Karte kann jede Breite
             haben. */
          container-type: inline-size;
        }
        @container (max-width: 460px) { .block { line-height: 36px; } }
        /* Drei Stufen, gemessen an der echten Blockbreite: gar nichts, nur die
           Startzeit, oder die volle Spanne. Ein 3-Stunden-Block ist auf einer
           normal breiten Karte nur rund 50 px breit — "01:00-04:00" passt dort
           nicht, "01:00" schon. */
        .block .cap-short, .block .cap-full { display: none; }
        @container (min-width: 44px) { .block .cap-short { display: inline; } }
        @container (min-width: 88px) {
          .block .cap-short { display: none; }
          .block .cap-full { display: inline; }
        }
        .block.dragging { cursor: grabbing; opacity: 0.9; }
        .readonly .block { cursor: default; }

        .handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 10px;
          cursor: ew-resize;
        }
        .handle.start { left: 0; }
        .handle.end { right: 0; }
        .handle::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 2px;
          height: 12px;
          border-radius: 1px;
          background: var(--text-primary-color, #fff);
          opacity: 0.55;
        }
        .readonly .handle { display: none; }

        .foot {
          display: flex;
          align-items: center;
          gap: var(--ha-space-2, 8px);
          margin-top: 10px;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
        }
        .foot .hint { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
        .foot .err { color: var(--error-color, #db4437); }

        /* ── Dialoge ──────────────────────────────────────────────────────
           Anatomie nach docs/ui-regeln.md, Regel 2: Titel, Schließen-X oben
           links, Aktionsknöpfe unten rechts, Breite höchstens 560 px,
           Vollbild unter 450 px Breite oder 500 px Höhe.

           Der Stapelkontext braucht kein z-index: ein natives <dialog> im
           showModal-Zustand steht in der Top-Layer und liegt damit über
           JEDER Leaflet-Ebene, auch über deren 1000er Bedienelementen. */
        dialog {
          border: none;
          border-radius: var(--ha-card-border-radius, 12px);
          padding: 0;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          max-width: min(92vw, 380px);
          width: 100%;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
        @media (max-width: 450px), (max-height: 500px) {
          dialog {
            max-width: 100%;
            width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }
          /* Am Handy stehen die Aktionsknoepfe unten fest (Regel 2). Das
             erledigt der Spaltenfluss allein: .dlg ist so hoch wie der
             Dialog, .body nimmt den ganzen Rest, .actions bleibt darunter.
             KEIN position: sticky — es waere hier wirkungslos (nur .body
             rollt) und Chromium liess bei jedem Groessenwechsel eine zweite,
             veraltete Fassung der Knopfzeile im Bild stehen. Gemessen: im DOM
             genau EIN .actions bei y=1152, im Bild zwei. */
          .dlg { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
          .dlg .body { flex: 1 1 auto; overflow: auto; min-height: 0; }
        }
        /* Wackeln statt Schließen: die HA-Ausnahme für ein Formular mit
           ungespeicherten Änderungen (Regel 2). Nur der Blockdialog ist ein
           Formular; die Tagesansicht ist keins und schließt immer. */
        @keyframes busch-schedule-wackeln {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        dialog.wackelt { animation: busch-schedule-wackeln 0.25s ease-in-out; }
        .dlg { padding: var(--ha-space-4, 16px); }
        .dlg-kopf {
          display: flex;
          align-items: center;
          gap: var(--ha-space-2, 8px);
          margin-bottom: var(--ha-space-4, 16px);
        }
        .dlg h2 {
          flex: 1 1 auto;
          margin: 0;
          font-size: 18px;
          font-weight: var(--ha-font-weight-normal, 400);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .dlg-kopf button {
          flex: 0 0 auto;
          font: inherit;
          border: none;
          background: none;
          color: var(--secondary-text-color);
          width: 40px;
          height: 40px;
          line-height: 1;
          border-radius: 50%;
          cursor: pointer;
        }
        .dlg-kopf button:hover { background: var(--divider-color); }
        .dlg-kopf button.danger { color: var(--error-color, #db4437); }
        .fields { display: flex; gap: var(--ha-space-3, 12px); }
        .fields label {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .fields input {
          font: inherit;
          font-size: var(--ha-font-size-l, 16px); /* unter 16px zoomt iOS beim Fokus hinein */
          padding: var(--ha-space-2, 8px) 10px;
          border-radius: 6px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          color-scheme: light dark;
          min-width: 0;
        }
        .fields input:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: -1px;
        }
        .dlg .note {
          margin-top: var(--ha-space-2, 8px);
          font-size: var(--ha-font-size-s, 12px);
          color: var(--secondary-text-color);
          overflow-wrap: anywhere;
        }
        .dlg .msg {
          margin-top: var(--ha-space-3, 12px);
          font-size: 13px;
          color: var(--error-color, #db4437);
          overflow-wrap: anywhere;
        }
        .dlg .msg:empty { display: none; }
        .actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--ha-space-2, 8px);
          margin: 20px 0 0;
          padding: 0;
        }
        .actions button {
          font: inherit;
          font-size: var(--ha-font-size-m, 14px);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: none;
          background: none;
          color: var(--primary-color);
          padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .actions button:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
        .actions button.danger { color: var(--error-color, #db4437); }
        .actions button.danger:hover { background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }

        .choices { display: flex; flex-direction: column; }
        .choices button {
          font: inherit;
          font-size: var(--ha-font-size-m, 14px);
          text-align: left;
          border: none;
          background: none;
          color: var(--primary-text-color);
          padding: var(--ha-space-3, 12px) var(--ha-space-2, 8px);
          border-radius: 6px;
          cursor: pointer;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .choices button:hover { background: var(--divider-color); }
        .choices button.danger { color: var(--error-color, #db4437); }
      </style>

      <ha-card>
        <div class="head">
          <ha-icon></ha-icon>
          <div class="text">
            <div class="name"></div>
            <div class="sub"></div>
          </div>
          <div class="status"></div>
        </div>
        <div class="ruler"><div class="spacer"></div><div class="scale"></div></div>
        <div class="days"></div>
        <div class="foot">
          <div class="hint"></div>
        </div>
      </ha-card>

      <dialog class="block-dialog">
        <div class="dlg">
          <div class="dlg-kopf">
            <button class="dlg-x" data-act="cancel"><ha-icon icon="mdi:close"></ha-icon></button>
            <h2></h2>
            <button class="danger dlg-del" data-act="delete"><ha-icon icon="mdi:delete"></ha-icon></button>
          </div>
          <div class="body">
            <div class="fields">
              <label><span class="l-from"></span> <input type="time" class="f-from"></label>
              <label><span class="l-to"></span> <input type="time" class="f-to"></label>
            </div>
            <div class="note"></div>
            <div class="msg"></div>
          </div>
          <menu class="actions">
            <button data-act="cancel"></button>
            <button data-act="ok"></button>
          </menu>
        </div>
      </dialog>

      <dialog class="day-dialog">
        <div class="dlg">
          <div class="dlg-kopf">
            <button class="dlg-x" data-act="cancel"><ha-icon icon="mdi:close"></ha-icon></button>
            <h2></h2>
          </div>
          <div class="body">
            <div class="choices">
              <button data-act="all"></button>
              <button data-act="weekdays"></button>
              <button data-act="weekend"></button>
              <button data-act="clear" class="danger"></button>
            </div>
          </div>
          <menu class="actions">
            <button data-act="cancel"></button>
          </menu>
        </div>
      </dialog>
    `;

    this._els = {
      card: this.shadowRoot.querySelector("ha-card"),
      head: this.shadowRoot.querySelector(".head"),
      icon: this.shadowRoot.querySelector(".head ha-icon"),
      name: this.shadowRoot.querySelector(".head .name"),
      sub: this.shadowRoot.querySelector(".head .sub"),
      status: this.shadowRoot.querySelector(".head .status"),
      scale: this.shadowRoot.querySelector(".ruler .scale"),
      days: this.shadowRoot.querySelector(".days"),
      hint: this.shadowRoot.querySelector(".foot .hint"),
      blockDialog: this.shadowRoot.querySelector(".block-dialog"),
      dayDialog: this.shadowRoot.querySelector(".day-dialog"),
    };

    this._buildRuler();
    this._renderTexte();
    this._wireDialogs();
  }

  /** Alles Feste im Aufbau, das Text ist — aus dem Wörterbuch, in der
   *  Sprache von `hass.locale.language`. Läuft beim Aufbau und noch einmal,
   *  sobald `hass` da ist: beim Aufbau gibt es ihn noch nicht. */
  _renderTexte() {
    if (!this._els) return;
    const t = this._texte;
    const setze = (sel, wert) => {
      const el = this.shadowRoot.querySelector(sel);
      if (el) el.textContent = wert;
    };
    setze(".block-dialog .l-from", t.von);
    setze(".block-dialog .l-to", t.dialogBis);
    setze(".block-dialog .actions button[data-act='cancel']", t.abbrechen);
    setze(".block-dialog .actions button[data-act='ok']", t.speichern);
    setze(".day-dialog .actions button[data-act='cancel']", t.abbrechen);
    setze(".day-dialog .choices button[data-act='all']", t.kopierenAlle);
    setze(".day-dialog .choices button[data-act='weekdays']", t.kopierenWerktage);
    setze(".day-dialog .choices button[data-act='weekend']", t.kopierenWochenende);
    setze(".day-dialog .choices button[data-act='clear']", t.tagLeeren);
    // Der Hinweis unter den Zeitfeldern enthält ein <b>; er ist der einzige
    // Text der Karte mit Auszeichnung und der einzige Grund für innerHTML.
    // Die Quelle ist das eigene Wörterbuch, nie Nutzereingabe.
    const note = this.shadowRoot.querySelector(".block-dialog .note");
    if (note) note.innerHTML = t.mitternacht;
    for (const [sel, titel] of [
      [".block-dialog .dlg-x", t.schliessen],
      [".day-dialog .dlg-x", t.schliessen],
      [".block-dialog .dlg-del", t.blockLoeschen],
    ]) {
      const el = this.shadowRoot.querySelector(sel);
      if (!el) continue;
      el.setAttribute("title", titel);
      el.setAttribute("aria-label", titel);
    }
  }

  _buildRuler() {
    const marks = [];
    for (let hour = 0; hour <= 24; hour += 3) {
      const edge = hour === 0 ? "start" : hour === 24 ? "end" : "";
      const minor = hour % 6 === 0 ? "0" : "1";
      marks.push(
        `<span style="left:${(hour / 24) * 100}%" data-edge="${edge}" data-minor="${minor}">${hour}</span>`
      );
    }
    this._els.scale.innerHTML = marks.join("");
  }

  _wireDialogs() {
    const blockDialog = this._els.blockDialog;
    blockDialog.addEventListener("click", (event) => {
      // Ein Klick NEBEN den Inhalt trifft das <dialog> selbst — das ist der
      // Scrim. Regel 2 verlangt, dass er schließt (beim Formular mit
      // ungespeicherten Änderungen: wackeln statt schließen).
      if (event.target === blockDialog) {
        this._resolveBlockDialog("scrim");
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      this._resolveBlockDialog(button.dataset.act);
    });
    // Escape löst am nativen <dialog> `cancel` aus. Der Vorgabeweg würde den
    // Dialog schließen, ohne den eigenen Verlaufseintrag abzuräumen — deshalb
    // abgefangen und über denselben Weg geführt wie jeder andere Schließer.
    blockDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._resolveBlockDialog("escape");
    });

    const dayDialog = this._els.dayDialog;
    dayDialog.addEventListener("click", (event) => {
      if (event.target === dayDialog) {
        this._dialogSchliessen(dayDialog);
        this._dayTarget = null;
        return;
      }
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      this._dialogSchliessen(dayDialog);
      this._applyDayAction(button.dataset.act);
    });
    dayDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._dialogSchliessen(dayDialog);
      this._dayTarget = null;
    });
  }

  /* ── Verlauf: Zurück-Taste und Zurück-Geste ──────────────────────────────
   *
   * `docs/ui-regeln.md`, Regel 2: Ein Popup schließt mit der Zurück-Taste,
   * OHNE die Seite zu verlassen. Ein selbstgebautes Überlagerungsfenster tut
   * das nicht von allein — die Zurück-Geste am Handy ist eine
   * Verlaufsnavigation, und ohne eigenen Eintrag verlässt sie das ganze
   * Dashboard. Genau das war der Stand bis hierher.
   *
   * Das Muster ist HAs eigenem Dialog-Manager (`addHistory`) nachgebaut, so
   * wie es in `ha-busch-lightcards` schon steht:
   *
   *   1. Beim Öffnen `history.pushState({ dialog: '<name>' }, '')` — die URL
   *      bleibt unangetastet, sonst wechselte das Dashboard die Ansicht.
   *   2. Ein `popstate`-Listener schließt das Popup, sobald der eigene
   *      Eintrag verschwunden ist.
   *   3. Beim Schließen über Knopf, Scrim oder Escape: liegt der eigene
   *      Eintrag oben, `history.back()`; sonst wird am Verlauf nichts
   *      geändert. So bleibt kein verwaister Eintrag stehen.
   *   4. Der Listener wird beim Schließen wieder entfernt.
   * ────────────────────────────────────────────────────────────────────── */

  /** Kennung des eigenen Verlaufseintrags eines der beiden Dialoge. */
  _dialogName(dialog) {
    return dialog === this._els.dayDialog
      ? "busch-schedule-card:tag"
      : "busch-schedule-card:block";
  }

  _liegtObenauf(dialog) {
    const zustand = typeof history !== "undefined" ? history.state : null;
    return Boolean(zustand && zustand.dialog === this._dialogName(dialog));
  }

  _dialogOeffnen(dialog) {
    if (dialog.open) return;
    dialog.showModal();
    if (typeof history === "undefined") return;
    try {
      history.pushState({ dialog: this._dialogName(dialog) }, "");
    } catch (fehler) {
      // Privater Modus und Ratenbegrenzung können das ablehnen. Escape,
      // Scrim und Schließ-Knopf wirken weiter; nur die Zurück-Geste fehlt.
      return;
    }
    const aufPop = () => {
      window.removeEventListener("popstate", aufPop);
      if (dialog._buschPop === aufPop) dialog._buschPop = null;
      if (dialog.open) dialog.close();
      if (dialog === this._els.blockDialog) this._dialogTarget = null;
      else this._dayTarget = null;
    };
    dialog._buschPop = aufPop;
    window.addEventListener("popstate", aufPop);
  }

  /** Schließt den Dialog und räumt genau den eigenen Verlaufseintrag ab. */
  _dialogSchliessen(dialog) {
    const aufPop = dialog._buschPop;
    if (aufPop && this._liegtObenauf(dialog)) {
      // `history.back()` löst `popstate` aus; der Listener schließt und
      // räumt sich selbst ab. Ein Notnagel für den Fall, dass `popstate`
      // ausbleibt — sonst bliebe der Dialog offen stehen.
      history.back();
      setTimeout(() => {
        if (dialog.open) dialog.close();
      }, 300);
      return;
    }
    if (aufPop) {
      window.removeEventListener("popstate", aufPop);
      dialog._buschPop = null;
    }
    if (dialog.open) dialog.close();
  }

  /** Kurzes Wackeln statt Schließen — die HA-Ausnahme für ein Formular mit
   *  ungespeicherten Änderungen (Regel 2). */
  _wackeln(dialog) {
    dialog.classList.remove("wackelt");
    // Neuzeichnen erzwingen, sonst startet die Animation beim zweiten Mal nicht.
    void dialog.offsetWidth;
    dialog.classList.add("wackelt");
    setTimeout(() => dialog.classList.remove("wackelt"), 300);
  }

  /* ── Zeichnen ───────────────────────────────────────────────────────── */

  _renderAll() {
    this._renderHeader();
    this._renderDays();
    this._renderStatus("");
  }

  _renderStatus(text) {
    if (!this._els) return;
    this._els.status.textContent = text;
    const hint = this._els.hint;
    if (this._error) {
      hint.textContent = this._error;
      hint.classList.add("err");
    } else {
      hint.classList.remove("err");
      hint.textContent = this._readonly
        ? this._texte.hinweisNurLesen
        : this._texte.hinweisZiehen;
    }
  }

  _renderHeader() {
    if (!this._els || !this._hass || !this._config) return;
    const state = this._hass.states[this._config.entity];
    const isOn = state?.state === "on";
    this._els.head.classList.toggle("on", isOn);
    this._els.icon.setAttribute(
      "icon",
      state?.attributes?.icon || this._config.icon || "mdi:calendar-clock"
    );
    this._els.name.textContent =
      this._config.title || state?.attributes?.friendly_name || this._config.entity;

    if (!state) {
      this._els.sub.textContent = this._texte.entitaetFehlt;
      return;
    }
    const parts = [isOn ? this._texte.ein : this._texte.aus];
    const next = state.attributes?.next_event;
    if (next) {
      const date = new Date(next);
      if (!Number.isNaN(date.getTime())) {
        const time = this._hass.formatEntityAttributeValue
          ? this._hass.formatEntityAttributeValue(state, "next_event")
          : date.toLocaleString(this._hass.locale?.language || "de");
        parts.push(`${isOn ? this._texte.bis : this._texte.ab} ${time}`);
      }
    }
    this._els.sub.textContent = parts.join(" · ");
  }

  _renderDays() {
    if (!this._els) return;
    const container = this._els.days;
    if (!this._model) {
      container.innerHTML = "";
      return;
    }

    this._els.card.classList.toggle("readonly", this._readonly);
    const labels = this._dayLabels();
    const todayIndex = (new Date().getDay() + 6) % 7; // JS: Sonntag = 0
    const today = SCHEDULE_DAYS[todayIndex];

    container.innerHTML = this._orderedDays()
      .map((day) => {
        const blocks = this._model[day] || [];
        const bars = blocks
          .map((block, index) => {
            const left = (block.start / MINUTES_PER_DAY) * 100;
            const width = ((block.end - block.start) / MINUTES_PER_DAY) * 100;
            const text = `${formatClock(block.start)}–${formatClock(block.end)}`;
            // Ob die Beschriftung passt, entscheidet die Container-Query oben.
            return `<div class="block" data-day="${day}" data-index="${index}"
                       style="left:${left}%;width:${width}%"
                       tabindex="0" role="button" title="${text}">
                      <span class="handle start"></span><span class="cap-short">${formatClock(block.start)}</span><span class="cap-full">${text}</span><span class="handle end"></span>
                    </div>`;
          })
          .join("");
        return `
          <div class="day${day === today ? " today" : ""}" data-day="${day}">
            <div class="label" title="${labels[day].long}">${labels[day].short}</div>
            <div class="track" data-day="${day}" tabindex="0" role="group"
                 aria-label="${labels[day].long}">${bars}</div>
          </div>`;
      })
      .join("");

    if (this._readonly) return;
    for (const track of container.querySelectorAll(".track")) {
      track.addEventListener("pointerdown", (event) => this._onPointerDown(event));
    }
    for (const label of container.querySelectorAll(".label")) {
      label.addEventListener("click", () =>
        this._openDayDialog(label.parentElement.dataset.day)
      );
      label.style.cursor = "pointer";
    }
    for (const block of container.querySelectorAll(".block")) {
      block.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._openBlockDialog(block.dataset.day, Number(block.dataset.index));
        }
      });
    }
  }

  /* ── Ziehen, Größe ändern, Anlegen ──────────────────────────────────── */

  _minuteAt(clientX, rect) {
    const ratio = (clientX - rect.left) / rect.width;
    return clamp(ratio * MINUTES_PER_DAY, 0, MINUTES_PER_DAY);
  }

  _snap(minute) {
    const step = this._config.step || 15;
    return clamp(Math.round(minute / step) * step, 0, MINUTES_PER_DAY);
  }

  _onPointerDown(event) {
    if (this._readonly || !this._model) return;
    if (event.button !== undefined && event.button !== 0) return;

    const track = event.currentTarget;
    const day = track.dataset.day;
    const blocks = this._model[day];
    const rect = track.getBoundingClientRect();
    const minute = this._minuteAt(event.clientX, rect);

    const blockEl = event.target.closest(".block");
    let drag;

    if (blockEl) {
      const index = Number(blockEl.dataset.index);
      const handle = event.target.closest(".handle");
      const mode = handle ? (handle.classList.contains("start") ? "start" : "end") : "move";
      drag = {
        mode,
        day,
        index,
        rect,
        track,
        element: blockEl,
        origin: minute,
        startedAt: { ...blocks[index] },
        moved: false,
      };
    } else {
      const gap = gapAt(blocks, minute);
      if (!gap) return;
      const anchor = clamp(this._snap(minute), gap.min, gap.max);
      drag = {
        mode: "create",
        day,
        index: -1,
        rect,
        track,
        element: null,
        origin: minute,
        anchor,
        gap,
        moved: false,
      };
    }

    this._drag = drag;
    track.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => this._onPointerMove(moveEvent);
    const onUp = (upEvent) => {
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      try {
        track.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* Zeiger war schon frei. */
      }
      this._onPointerUp(upEvent);
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;
    const minute = this._minuteAt(event.clientX, drag.rect);
    const pixels = Math.abs(minute - drag.origin) * (drag.rect.width / MINUTES_PER_DAY);
    if (!drag.moved && pixels < 4) return;
    drag.moved = true;
    event.preventDefault();

    const blocks = this._model[drag.day];

    if (drag.mode === "create") {
      if (!drag.element) {
        const element = document.createElement("div");
        element.className = "block dragging";
        drag.track.appendChild(element);
        drag.element = element;
      }
      const other = clamp(this._snap(minute), drag.gap.min, drag.gap.max);
      const start = Math.min(drag.anchor, other);
      const end = Math.max(drag.anchor, other);
      drag.preview = { start, end };
      this._paint(drag.element, start, end);
      return;
    }

    const { min, max } = freeRange(blocks, drag.index);
    const base = drag.startedAt;
    const step = this._config.step || 15;
    let start = base.start;
    let end = base.end;

    if (drag.mode === "move") {
      const length = base.end - base.start;
      const delta = this._snap(minute) - this._snap(drag.origin);
      start = clamp(base.start + delta, min, max - length);
      end = start + length;
    } else if (drag.mode === "start") {
      start = clamp(this._snap(minute), min, base.end - step);
      end = base.end;
    } else {
      start = base.start;
      end = clamp(this._snap(minute), base.start + step, max);
    }

    drag.preview = { start, end };
    drag.element.classList.add("dragging");
    this._paint(drag.element, start, end);
  }

  _paint(element, start, end) {
    element.style.left = `${(start / MINUTES_PER_DAY) * 100}%`;
    element.style.width = `${((end - start) / MINUTES_PER_DAY) * 100}%`;
  }

  _onPointerUp() {
    const drag = this._drag;
    this._drag = null;
    if (!drag) return;

    const blocks = this._model[drag.day];

    // Kein Zug: ein Tippen. Auf einem Block öffnet das den Dialog, auf freier
    // Fläche entsteht ein Block in Standardlänge.
    if (!drag.moved) {
      if (drag.mode === "create") {
        const step = this._config.step || 15;
        const length = Math.max(step, 60);
        const gap = drag.gap;
        let start = clamp(drag.anchor, gap.min, Math.max(gap.min, gap.max - length));
        let end = Math.min(start + length, gap.max);
        if (end - start < step) {
          start = gap.min;
          end = gap.max;
        }
        if (end - start < step) return;
        blocks.push({ start, end });
        blocks.sort((a, b) => a.start - b.start);
        this._renderDays();
        this._save();
      } else {
        this._openBlockDialog(drag.day, drag.index);
      }
      return;
    }

    if (drag.mode === "create") {
      const preview = drag.preview;
      drag.element?.remove();
      const step = this._config.step || 15;
      if (!preview || preview.end - preview.start < step) {
        this._renderDays();
        return;
      }
      blocks.push({ start: preview.start, end: preview.end });
    } else if (drag.preview) {
      blocks[drag.index] = {
        ...blocks[drag.index],
        start: drag.preview.start,
        end: drag.preview.end,
      };
    }

    blocks.sort((a, b) => a.start - b.start);
    this._renderDays();
    this._save();
  }

  /* ── Dialoge ────────────────────────────────────────────────────────── */

  _openBlockDialog(day, index) {
    const block = this._model?.[day]?.[index];
    if (!block) return;
    const labels = this._dayLabels();
    const dialog = this._els.blockDialog;
    // Das native Zeitfeld formatiert nach Sprache. Ohne diesen Hinweis richtet
    // es sich nach dem Browser und zeigt womöglich AM/PM, während der Rest der
    // Karte 24 Stunden anzeigt.
    dialog.lang = this._hass?.locale?.language || "de";
    dialog.querySelector("h2").textContent = labels[day].long;
    dialog.querySelector(".f-from").value = toInputTime(block.start);
    dialog.querySelector(".f-to").value = toInputTime(block.end);
    dialog.querySelector(".msg").textContent = "";
    // Ausgangsstand für die HA-Ausnahme „Formular mit ungespeicherten
    // Änderungen schließt nicht auf Escape oder Scrim".
    this._dialogStand = this._blockStand();
    this._dialogTarget = { day, index };
    this._dialogOeffnen(dialog);
  }

  /** Was gerade in den beiden Zeitfeldern steht — für den Vergleich mit dem
   *  Stand beim Öffnen. */
  _blockStand() {
    const dialog = this._els.blockDialog;
    return [
      dialog.querySelector(".f-from").value,
      dialog.querySelector(".f-to").value,
    ].join("|");
  }

  /** Hat der Nutzer im Blockdialog etwas geändert, ohne zu speichern? */
  _blockGeaendert() {
    return this._dialogStand !== undefined && this._blockStand() !== this._dialogStand;
  }

  _resolveBlockDialog(action) {
    const dialog = this._els.blockDialog;
    const target = this._dialogTarget;
    if (!target) {
      this._dialogSchliessen(dialog);
      return;
    }

    // Escape und Scrim: die einzige Ausnahme der Spec. Ein Formular mit
    // ungespeicherten Änderungen wackelt, statt sie wegzuwerfen. Der
    // Abbrechen-Knopf und die Zurück-Taste schließen weiterhin — sie sind
    // eine ausdrückliche Ansage, kein Danebentippen.
    if (action === "escape" || action === "scrim") {
      if (this._blockGeaendert()) {
        this._wackeln(dialog);
        return;
      }
      action = "cancel";
    }

    if (action === "cancel") {
      this._dialogSchliessen(dialog);
      this._dialogTarget = null;
      return;
    }

    const blocks = this._model[target.day];

    if (action === "delete") {
      blocks.splice(target.index, 1);
      this._dialogSchliessen(dialog);
      this._dialogTarget = null;
      this._renderDays();
      this._save();
      return;
    }

    const fromValue = dialog.querySelector(".f-from").value;
    const toValue = dialog.querySelector(".f-to").value;
    const message = dialog.querySelector(".msg");
    if (!fromValue || !toValue) {
      message.textContent = this._texte.fehlerBeideZeiten;
      return;
    }

    const start = parseScheduleTime(fromValue);
    // 00:00 als Ende kann nur das Tagesende meinen — from < to ist Pflicht.
    const parsedTo = parseScheduleTime(toValue);
    const end = parsedTo === 0 ? MINUTES_PER_DAY : parsedTo;

    if (start >= end) {
      message.textContent = this._texte.fehlerReihenfolge;
      return;
    }
    const others = blocks.filter((_, index) => index !== target.index);
    if (others.some((block) => start < block.end && end > block.start)) {
      message.textContent = this._texte.fehlerUeberschneidung;
      return;
    }

    blocks[target.index] = { ...blocks[target.index], start, end };
    blocks.sort((a, b) => a.start - b.start);
    this._dialogSchliessen(dialog);
    this._dialogTarget = null;
    this._renderDays();
    this._save();
  }

  _openDayDialog(day) {
    if (this._readonly || !this._model) return;
    const labels = this._dayLabels();
    const dialog = this._els.dayDialog;
    dialog.querySelector("h2").textContent = labels[day].long;
    this._dayTarget = day;
    this._dialogOeffnen(dialog);
  }

  _applyDayAction(action) {
    const day = this._dayTarget;
    this._dayTarget = null;
    if (!day || action === "cancel" || !this._model) return;

    const source = this._model[day] || [];
    const copy = () =>
      source.map((block) => ({ ...block, data: block.data ? { ...block.data } : undefined }));

    if (action === "clear") {
      this._model[day] = [];
    } else {
      let targets = [];
      if (action === "all") targets = SCHEDULE_DAYS;
      else if (action === "weekdays") targets = SCHEDULE_DAYS.slice(0, 5);
      else if (action === "weekend") targets = SCHEDULE_DAYS.slice(5);
      for (const target of targets) {
        if (target !== day) this._model[target] = copy();
      }
    }

    this._renderDays();
    this._save();
  }
}

class BuschScheduleCardEditor extends BuschEditorBase {
  setConfig(config) {
    if (!this._acceptConfig({ first_day: "auto", step: 15, ...config })) return;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      const texte = buschTexte(TEXTE_BUSCH_SCHEDULE_CARD, this._hass);
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_SCHEDULE_CARD, texte);
      this._form.computeLabel = (schema) => texte.labels[schema.name] || schema.name;
      this._form.computeHelper = (schema) => texte.helpers[schema.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        this._publishConfig(buschEditorUpdate(this._config,event.detail.value));
      });
      this.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}

/* ==========================================================================
 * busch-calendar-card — Terminliste je Kalendermonat
 *
 * Alle Namen auf oberster Ebene beginnen mit `cal`. Diese Datei hat einen
 * flachen Gueltigkeitsbereich: ein zweites `clamp` oder `formatClock` wuerde
 * die Zeitplan-Karte still kaputtmachen.
 * ========================================================================== */

/**
 * Erster und letzter Moment des Zielmonats, in lokaler Zeit.
 * `new Date(jahr, monat + 1, 0)` ist der letzte Tag des Monats davor — das
 * erledigt Monatslaengen und Schaltjahre ohne eigene Tabelle.
 */
function calMonatsGrenzen(basis, versatz) {
  const jahr = basis.getFullYear();
  const monat = basis.getMonth() + (versatz || 0);
  return {
    start: new Date(jahr, monat, 1, 0, 0, 0, 0),
    ende: new Date(jahr, monat + 1, 0, 23, 59, 59, 999),
  };
}

function calMonatsName(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", {
    month: "long",
    year: "numeric",
  });
}

function calIstGanztags(termin) {
  return Boolean(termin && termin.start && termin.start.date && !termin.start.dateTime);
}

/**
 * Ein reines Datum wird von Hand zerlegt. `new Date("2026-08-04")` liest die
 * Zeichenkette als UTC-Mitternacht — westlich von Greenwich ergaebe das den
 * 3. August. Der Konstruktor mit Zahlen nimmt lokale Zeit.
 */
function calDatumAusText(text) {
  const teile = String(text).split("-").map(Number);
  return new Date(teile[0], teile[1] - 1, teile[2], 0, 0, 0, 0);
}

function calStartDatum(termin) {
  return calIstGanztags(termin)
    ? calDatumAusText(termin.start.date)
    : new Date(termin.start.dateTime);
}

/**
 * Bei ganztaegigen Terminen ist `end.date` AUSSCHLIESSEND: ein eintaegiger
 * Termin am 4. hat das Ende am 5. Hier wird auf den letzten betroffenen Tag
 * zurueckgerechnet.
 *
 * Fehlt `end` ganz oder traegt es weder `date` noch `dateTime`, faellt der
 * Termin auf seinen eigenen Start zurueck und bekommt damit die Dauer null.
 * Der Rueckfall ist bewusst so gewaehlt und nicht als Auslassen: einen still
 * geschluckten Termin vermisst im Betrieb niemand, eine fehlende Zeitspanne
 * sieht man dagegen sofort. Und ein einzelner kaputter Eintrag darf die
 * uebrige Monatsliste nicht mitreissen — `termin.end.dateTime` warf hier
 * vorher einen TypeError.
 */
function calEndDatum(termin) {
  const ende = termin && termin.end;
  const roher = calIstGanztags(termin)
    ? ende && ende.date
    : ende && ende.dateTime;
  if (!roher) return calStartDatum(termin);
  // Ein vorhandenes, aber unlesbares Datum ("morgen frueh") ist dasselbe wie
  // ein fehlendes: `new Date(...)` liefert dann ein Invalid Date, und jeder
  // Vergleich damit ist false — der Termin faellt still aus der Tagesschleife.
  const roh = calIstGanztags(termin) ? calDatumAusText(roher) : new Date(roher);
  const von = calStartDatum(termin);
  if (Number.isNaN(roh.getTime())) return von;
  const bis = calIstGanztags(termin)
    ? new Date(roh.getFullYear(), roh.getMonth(), roh.getDate() - 1, 23, 59, 59, 999)
    : roh;
  // Ein Ende VOR dem Start ist so unbrauchbar wie ein fehlendes und bekommt
  // deshalb dieselbe Rueckfallregel. Zwei gemessene Faelle laufen hier
  // zusammen:
  //
  //   Ein ganztaegiger Termin mit `end.date` GLEICH `start.date` — die
  //   Rueckrechnung des ausschliessenden Endes landet einen Tag VOR dem
  //   Start. Der Termin fiel aus der Liste, stand aber als „1 ganztaegig"
  //   in der Fusszeile: eine Summe fuer etwas, das auf dem Schirm fehlt.
  //
  //   Ein rueckwaerts laufender Termin — die negative Dauer VERKLEINERTE die
  //   Monatssumme (gemessen: minus vier Stunden am selben Tag, minus
  //   zweiundfuenfzig ueber mehrere Tage), und ueber mehrere Tage verschwand
  //   er zusaetzlich aus der Liste.
  //
  // Mit dem Rueckfall bleibt er sichtbar und hat die Dauer null. Sichtbar und
  // erkennbar falsch ist besser als unsichtbar und heimlich verrechnet.
  if (bis < von) return von;
  return bis;
}

function calTagesSchluessel(datum) {
  const m = String(datum.getMonth() + 1).padStart(2, "0");
  const t = String(datum.getDate()).padStart(2, "0");
  return `${datum.getFullYear()}-${m}-${t}`;
}

/**
 * Ein Eintrag je Tag des Monats, auch fuer Tage ohne Termin.
 * Die Tage werden ueber ihre Nummer erzeugt, nicht durch Hochzaehlen eines
 * Date-Objekts: das bliebe an der Sommerzeitgrenze haengen.
 */
function calGruppiereNachTag(termine, start, ende) {
  const tage = [];
  const nachSchluessel = new Map();
  for (let n = 1; n <= ende.getDate(); n += 1) {
    const datum = new Date(start.getFullYear(), start.getMonth(), n);
    const eintrag = {
      schluessel: calTagesSchluessel(datum),
      datum,
      tagNummer: n,
      wochentag: datum.getDay(),
      istWochenende: datum.getDay() === 0 || datum.getDay() === 6,
      termine: [],
    };
    tage.push(eintrag);
    nachSchluessel.set(eintrag.schluessel, eintrag);
  }

  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;
    const von = calStartDatum(termin);
    // Die einzige Stelle, an der Ueberspringen richtig ist: ohne lesbaren Start
    // gibt es keinen Tag, an dem der Termin stehen koennte. Er wird nicht
    // versteckt, es fehlt schlicht der Ort. Ausdruecklich statt als Nebenwirkung
    // eines NaN-Vergleichs, damit die Absicht im Code steht — und die
    // Monatsliste laeuft weiter, statt am naechsten Termin zu haengen.
    if (Number.isNaN(von.getTime())) continue;
    const bis = calEndDatum(termin);
    // Jeden betroffenen Tag anfassen, damit mehrtaegige Termine ueberall stehen.
    let lauf = new Date(von.getFullYear(), von.getMonth(), von.getDate());
    const letzter = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
    let sicherung = 0;
    while (lauf <= letzter && sicherung < 400) {
      const treffer = nachSchluessel.get(calTagesSchluessel(lauf));
      if (treffer) treffer.termine.push(termin);
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }
  }

  for (const tag of tage) {
    tag.termine.sort((a, b) => {
      const ga = calIstGanztags(a);
      const gb = calIstGanztags(b);
      if (ga !== gb) return ga ? -1 : 1;
      return calStartDatum(a) - calStartDatum(b);
    });
  }

  return tage;
}

const calPalette = ["#3f8fd4", "#e08a3c", "#5aa469", "#b5559b", "#c95c5c", "#7d7fd4"];

/**
 * Summe ueber die ORIGINALLISTE aus dem Abruf, nicht ueber die gruppierten
 * Tage: dort steht ein dreitaegiger Urlaub an drei Tagen und wuerde dreifach
 * zaehlen. In der flachen Liste steht er genau einmal.
 *
 * KEINE Entdopplung ueber `uid`. Home Assistant gibt JEDER Instanz einer
 * wiederkehrenden Serie DIESELBE uid — ein woechentlicher Fruehdienst kommt
 * fuenfmal mit derselben Kennung. Wer sie entdoppelt, wirft vier Dienste weg:
 * fuenf Zeilen in der Liste und „8 h / 1 Tag" darunter, ein Widerspruch auf
 * demselben Bildschirm. Noetig war die Entdopplung ohnehin nie — das
 * Mehrfachvorkommen, gegen das sie gedacht war, entsteht erst in
 * `calGruppiereNachTag` und kann in dieser flachen Liste gar nicht auftreten.
 *
 * `start` und `ende` sind die Grenzen des GEZEIGTEN Monats. Gezaehlt wird nur,
 * was dazwischen liegt — sonst schlaegt ein Urlaub vom 25.07. bis 05.08. im
 * August-Fuss mit 272 Stunden und zwoelf Tagen zu Buche statt mit rund 112
 * und fuenf. Ohne Grenzen wird nicht geschnitten; die Karte gibt sie immer mit.
 */
function calSummeStunden(termine, start, ende) {
  const grenzeVon = start ? start.getTime() : -Infinity;
  // Der Monat wird als halboffenes Fenster gerechnet: `ende` ist
  // 23:59:59.999 — der letzte DARSTELLBARE Moment, nicht das Ende des Tages.
  // Fuer die Dauer liegt die obere Grenze deshalb eine Millisekunde spaeter,
  // sonst fehlte einem durchlaufenden Termin genau diese Millisekunde und ein
  // voller Monat ergaebe 743,9 statt 744 Stunden.
  const grenzeBis = ende ? ende.getTime() + 1 : Infinity;
  const tage = new Set();
  let ms = 0;
  let ganztags = 0;
  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;

    const von = calStartDatum(termin);
    // Ohne lesbaren Start ist `bis - von` NaN, und ein einziger kaputter
    // Termin macht die Summe des ganzen Monats zu NaN. Eine unbrauchbare
    // Summe sieht falsch aus statt unvollstaendig — deshalb hier dasselbe
    // Ueberspringen wie in `calGruppiereNachTag`. Es ist der einzige Fall, in
    // dem ein Termin ganz herausfaellt: es gibt keinen Tag, an dem er stehen
    // koennte, und ein Ersatzdatum waere erfunden. Sichtbar gemacht wird der
    // Verlust in der Hinweiszeile, deren Zahl `calZaehleNichtGezeigt` an der
    // Tagesschleife abliest. Ein kaputtes oder rueckwaerts laufendes ENDE
    // faellt dagegen in `calEndDatum` auf den Start zurueck, bleibt sichtbar
    // und zaehlt mit Dauer null.
    if (Number.isNaN(von.getTime())) continue;
    const bis = calEndDatum(termin);

    const vonMs = Math.max(von.getTime(), grenzeVon);
    const bisMs = Math.min(bis.getTime(), grenzeBis);
    // Kein Anteil im gezeigten Monat — der Termin gehoert in einen anderen Fuss.
    if (bisMs < vonMs) continue;

    // Fuer die TAGE zaehlt der letzte darstellbare Moment: Mitternacht gehoert
    // schon zum Folgemonat und darf dort keinen Tag mehr aufmachen.
    const letzter = new Date(Math.min(bis.getTime(), grenzeBis - 1));
    const letzterTag = new Date(letzter.getFullYear(), letzter.getMonth(), letzter.getDate());
    const erster = new Date(vonMs);
    let lauf = new Date(erster.getFullYear(), erster.getMonth(), erster.getDate());
    let sicherung = 0;
    while (lauf <= letzterTag && sicherung < 400) {
      tage.add(calTagesSchluessel(lauf));
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }

    if (calIstGanztags(termin)) ganztags += 1;
    else ms += bisMs - vonMs;
  }
  return { stunden: ms / 3600000, ganztags, tageMitTermin: tage.size };
}

function calEscape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calFormatUhrzeit(datum, locale) {
  return datum.toLocaleTimeString(locale || "de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calFormatStunden(zahl, locale) {
  return zahl.toLocaleString(locale || "de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function calWochentagKurz(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", { weekday: "short" });
}

function calTerminHtml(termin, optionen) {
  // `farben` ist optional: ein von Hand gebautes Optionsobjekt (Pruefungen,
  // spaetere Nachweise) soll die Liste nicht sprengen. Fuer `texte` gilt
  // dasselbe — ohne Angabe gilt die deutsche Fassung des Woerterbuchs.
  const texte = optionen.texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte;
  const farbe = (optionen.farben || {})[termin._entity] || calPalette[0];
  const punkt = optionen.mehrereKalender
    ? `<span class="cal-punkt" style="background:${calEscape(farbe)}"></span>`
    : "";
  const zeit = calIstGanztags(termin)
    ? texte.ganztags
    : `${calFormatUhrzeit(calStartDatum(termin), optionen.locale)} – ` +
      `${calFormatUhrzeit(calEndDatum(termin), optionen.locale)}`;
  // Beschreibung und Ort stehen zusaetzlich im `title` und erscheinen beim
  // Ueberfahren — auch dann, wenn der Termin-Dialog nicht erreichbar ist.
  const hinweis = [termin.description, termin.location].filter(Boolean).join(" · ");
  // `data-idx` ist der Platz des Termins in `_alleTermine`, `data-rid` seine
  // Wiederholung. Beide braucht der Klick, um von der Zeile zurueck auf den
  // vollstaendigen Termin zu kommen — die Kennung allein reicht bei einer
  // Serie nicht, dort tragen alle Vorkommen dieselbe `uid`.
  const idx = Number.isInteger(termin._idx) ? String(termin._idx) : "";
  return (
    `<div class="cal-termin" data-uid="${calEscape(termin.uid || "")}" ` +
    `data-entity="${calEscape(termin._entity || "")}" ` +
    `data-idx="${calEscape(idx)}" ` +
    `data-rid="${calEscape(termin.recurrence_id || "")}" ` +
    `title="${calEscape(hinweis)}">` +
    `${punkt}<span class="cal-zeit">${calEscape(zeit)}</span>` +
    `<span class="cal-titel">${calEscape(termin.summary || texte.ohneTitel)}</span>` +
    `</div>`
  );
}

function calListeHtml(tage, optionen) {
  // `optionen.heute` ist einspeisbar, damit die Hervorhebung pruefbar wird —
  // vor allem der Fall, dass sie im Vormonat gerade NICHT erscheinen darf.
  // Ohne Angabe bleibt es bei der Uhr; fuer die Karte aendert sich nichts.
  const heuteSchluessel = calTagesSchluessel(optionen.heute || new Date());
  const zeilen = [];
  for (const tag of tage) {
    if (!optionen.zeigeLeereTage && tag.termine.length === 0) continue;
    const klassen = ["cal-tag"];
    if (tag.istWochenende) klassen.push("cal-wochenende");
    if (tag.schluessel === heuteSchluessel) klassen.push("cal-heute");
    if (tag.termine.length === 0) klassen.push("cal-leer");
    const inhalt = tag.termine.length
      ? tag.termine.map((t) => calTerminHtml(t, optionen)).join("")
      : `<div class="cal-termin cal-nichts"></div>`;
    zeilen.push(
      `<div class="${klassen.join(" ")}">` +
        `<div class="cal-datum">` +
        `<span class="cal-wt">${calEscape(calWochentagKurz(tag.datum, optionen.locale))}</span>` +
        `<span class="cal-nr">${tag.tagNummer}.</span>` +
        `</div>` +
        `<div class="cal-inhalt">${inhalt}</div>` +
        `</div>`
    );
  }
  return zeilen.join("");
}

const CAL_STANDARD = {
  month_offset: 0,
  navigation: true,
  show_empty_days: true,
  show_total: false,
  title: "",
  open_event_on_tap: true,
  edit_on_tap: true,
};

function calNormalisiereKonfig(config) {
  const roh = Array.isArray(config && config.entities) ? config.entities : [];
  const entities = roh.map((eintrag, i) => {
    const objekt = typeof eintrag === "string" ? { entity: eintrag } : { ...eintrag };
    // KEIN `label`: Bis v0.7.0 wurde es normalisiert und nirgends gezeichnet.
    // Es gab keinen Ort dafuer — eine Legende hat die Karte nicht, und bei
    // einem einzigen Kalender wird nicht einmal der Farbpunkt gezeichnet.
    // Eine Option, die nur normalisiert wird, verspricht eine Wirkung, die
    // es nicht gibt. Deshalb entfernt statt nachgebaut.
    return {
      entity: objekt.entity,
      color: objekt.color || calPalette[i % calPalette.length],
    };
  }).filter((e) => Boolean(e.entity));
  return { ...CAL_STANDARD, ...config, entities };
}

/**
 * Wie viele der gelieferten Termine NICHT in der Liste stehen: geliefert minus
 * tatsaechlich platziert, abgelesen an der Tagesschleife selbst.
 *
 * Vorher bildete diese Funktion die Auslassbedingung von
 * `calGruppiereNachTag` ein ZWEITES Mal nach und zaehlte nur den unlesbaren
 * Start. Alles, was die Tagesschleife aus einem anderen Grund fallen laesst —
 * ein Termin ganz ausserhalb des gezeigten Monats etwa —, erschien in keiner
 * Hinweiszeile. Zwei Nachbildungen derselben Bedingung laufen frueher oder
 * spaeter auseinander; eine Differenz kann das nicht.
 *
 * `tage` ist das Ergebnis von `calGruppiereNachTag`. Ein mehrtaegiger Termin
 * liegt dort als DASSELBE Objekt in mehreren Tageslisten — das Set zaehlt ihn
 * deshalb einmal. Das setzt voraus, dass die gelieferte Liste keine zwei
 * Verweise auf dasselbe Objekt enthaelt; `_lade()` legt fuer jeden Termin eine
 * eigene flache Kopie an.
 */
function calZaehleNichtGezeigt(termine, tage) {
  const platziert = new Set();
  for (const tag of tage || []) {
    for (const termin of tag.termine) platziert.add(termin);
  }
  return Math.max(0, (termine || []).length - platziert.size);
}

/**
 * Der Text der Hinweiszeile. Steht ausserhalb der Klasse, weil `_render()` ein
 * Dokument braucht und unter Node nicht pruefbar waere — die Aussage selbst
 * soll aber belegbar sein, nicht nur der Weg dorthin.
 * Ohne Fehler und ohne uebersprungene Termine ist das Ergebnis leer; die
 * Zeile entfaellt dann ganz.
 */
function calHinweisText(fehler, nichtGezeigt, texte) {
  const t = texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte;
  const teile = [];
  if (fehler && fehler.length) {
    teile.push(buschFuellen(t.nichtErreichbar, { liste: fehler.join(", ") }));
  }
  if (nichtGezeigt > 0) {
    // Der Wortlaut nennt den GEMEINSAMEN Grund, nicht mehr nur einen von
    // mehreren: die Zahl kommt aus der Differenz und deckt jeden Termin ab,
    // fuer den die Tagesschleife keinen Platz im gezeigten Monat hatte.
    teile.push(
      nichtGezeigt === 1
        ? t.einerOhneTag
        : buschFuellen(t.mehrereOhneTag, { n: nichtGezeigt })
    );
  }
  return teile.join(" · ");
}

const CAL_STIL = `
  busch-calendar-card { display:block; height:100%; min-height:0; min-width:0; }
  busch-calendar-card > ha-card { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; box-sizing:border-box; }
  busch-calendar-card[data-preview], busch-calendar-card[data-preview] > ha-card { max-height:60vh; }
  busch-calendar-card .cal-body { display:flex; flex-direction:column; flex:1; min-height:0; }
  busch-calendar-card .cal-body > * { flex-shrink:0; }
  busch-calendar-card .cal-body > .cal-liste { flex:1 1 auto; min-height:0; overflow:auto; }

  .cal-kopf { display:flex; align-items:center; justify-content:space-between;
    gap:var(--ha-space-2, 8px);
    padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .cal-monat { font-size:1.1em; font-weight:var(--ha-font-weight-bold, 600);
    color:var(--primary-text-color); min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Zum \`user-select: none\` an dieser Stelle und an \`.cal-termin\`:
     Beschwerde des Nutzers — „wieso wird der betreff dann immer markiert lass
     das". Beide Flaechen sind KLICKFLAECHEN; wer darauf klickt, will oeffnen
     bzw. blaettern und nicht markieren. Ein zweiter Klick machte den Text
     stattdessen blau.

     NUR die Klickflaechen, nicht die ganze Karte: Monatsname, Kartentitel,
     Datumsspalte und Fusszeile bleiben markierbar — dort klickt niemand
     versehentlich, und wer sich „25,7 h" herauskopieren will, soll das
     koennen.

     \`-webkit-user-select\` bleibt Pflicht: die Home-Assistant-App auf iOS ist
     WebKit, und dort gilt bis heute nur die praefigierte Form. \`-moz-\` und
     \`-ms-\` stehen bewusst NICHT da — Firefox versteht die schlichte Form seit
     69, und der alte Edge spielt hier keine Rolle. */
  .cal-pfeil { background:none; border:none; cursor:pointer; padding:6px 10px;
    color:var(--secondary-text-color); font-size:1.2em; line-height:1; border-radius:6px;
    -webkit-user-select:none; user-select:none; }
  .cal-pfeil:hover { background:var(--divider-color); color:var(--primary-text-color); }
  /* Der Kartentitel ist einzeilig und wird GEKUERZT, nicht umgebrochen
     (Regel 1, letzter Punkt). */
  .cal-titel-zeile { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) 0;
    font-weight:var(--ha-font-weight-bold, 600); color:var(--primary-text-color);
    min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cal-liste { padding:0 var(--ha-space-2, 8px) var(--ha-space-2, 8px); }
  .cal-tag { display:flex; gap:12px; padding:6px 8px; border-radius:8px;
    border-bottom:1px solid var(--divider-color); }
  .cal-tag:last-child { border-bottom:none; }
  .cal-wochenende { background:var(--secondary-background-color); }
  .cal-heute { outline:2px solid var(--primary-color); outline-offset:-2px; }
  .cal-datum { display:flex; gap:6px; flex:0 0 auto; min-width:64px;
    align-items:baseline;
    color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
  .cal-wt, .cal-nr { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    min-width:0; }
  .cal-nr { font-weight:var(--ha-font-weight-bold, 600); color:var(--primary-text-color); }
  .cal-inhalt { flex:1; min-width:0; }
  .cal-termin { display:flex; gap:8px; align-items:baseline; padding:2px 0;
    cursor:pointer; -webkit-user-select:none; user-select:none; }
  /* Die leeren Tage tragen \`cursor: default\` und sind nicht klickbar — die
     Regel darueber gilt trotzdem auch fuer sie, und zwar bewusst: ihr Inhalt
     ist \`<div class="cal-termin cal-nichts"></div>\`, also LEER. Es gibt dort
     nichts zu markieren, die Regel kann dort folglich nichts wegnehmen. Eine
     Ausnahme (\`user-select: text\`) waere eine zweite Stelle, die dasselbe
     regelt, ohne etwas zu bewirken — und die eines Tages auseinanderlaeuft. */
  .cal-leer .cal-termin { cursor:default; min-height:1.2em; }
  .cal-punkt { width:8px; height:8px; border-radius:50%; flex:none;
    align-self:center; }
  /* Die Zeitspalte SCHRUMPFT NICHT (flex:0 0 auto) — der Titel daneben tut es
     und wird gekuerzt. Ohne min-width:0 am Titel waeche der Flexkasten ueber
     seinen Elternteil hinaus, statt zu kuerzen (Regel 1). */
  .cal-zeit { color:var(--secondary-text-color); font-variant-numeric:tabular-nums;
    flex:0 0 auto; min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cal-titel { color:var(--primary-text-color); flex:1 1 auto; min-width:0;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Linksbuendig mit festem Abstand, NICHT ueber die Breite verteilt.
     Gemessen: Mit \`space-between\` sassen bei zwei Werten "3 Tage" und
     "25,7 h" in den gegenueberliegenden Ecken, 436 px Leerraum dazwischen —
     und das ist der Regelfall, weil "1 ganztaegig" nur erscheint, wenn es im
     Monat einen ganztaegigen Termin gab. Die Zeile sprang also, je nachdem ob
     Urlaub drin war. Mit \`gap\` steht sie ruhig und liest sich als eine
     Angabe, ohne dass ein Trennzeichen noetig waere. */
  .cal-fuss { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:24px;
    padding:10px var(--ha-space-4, 16px);
    border-top:1px solid var(--divider-color); color:var(--secondary-text-color); }
  .cal-fuss span { min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .cal-hinweis { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
    color:var(--error-color, #db4437); overflow-wrap:anywhere; }
  .cal-leermeldung { padding:var(--ha-space-4, 16px);
    color:var(--secondary-text-color); overflow-wrap:anywhere; }
`;

/* ────────────────────────────────────────────────────────────────────────────
 * Der Termin-Dialog von Home Assistant
 *
 * Bis v0.8.0 oeffnete ein Klick auf eine Terminzeile nur den Info-Dialog der
 * Kalender-ENTITAET, weil es keinen bekannten Weg zum Dialog des einzelnen
 * Termins gab. Es gibt einen, und er ist am ausgelieferten Frontend belegt
 * (Home Assistant 2026.8.3).
 *
 * Wie HA selbst den Dialog oeffnet
 * (`src/panels/calendar/show-dialog-calendar-event-detail.ts`):
 *
 *     fireEvent(element, "show-dialog", {
 *       dialogTag: "dialog-calendar-event-detail",
 *       dialogImport: () => import("./dialog-calendar-event-detail"),
 *       dialogParams,
 *     });
 *
 * Das Ereignis koennen wir selbst feuern — `dialogImport` aber nicht bauen:
 * es ist eine Closure ueber einen bundle-internen Import, an den eine fremde
 * Karte nicht herankommt. `window.loadCardHelpers()` gibt ihn nicht her.
 *
 * DER AUSWEG: HA sein eigenes Kalenderelement bauen lassen, dessen
 * Klickbehandlung auf einer NICHT EINGEHAENGTEN Sonde aufrufen und den Import
 * aus dem dabei gefeuerten Ereignis abgreifen. Die Sonde haengt in keinem
 * Dokument — ihr Ereignis erreicht niemanden ausser unserem eigenen Lauscher,
 * es oeffnet also nichts und stoert nichts.
 *
 * Belegt am ausgelieferten Bundle: `_handleEventClick(e){…}` steht dort
 * unverkuerzt, ebenso `i.eventClick=e=>this._handleEventClick(e)` und die
 * Zeichenketten `ha-full-calendar` und `dialog-calendar-event-detail`.
 *
 * WAS DARAN NICHT BEWIESEN IST: dass der Weg zur Laufzeit greift. Unter Node
 * gibt es HAs Frontend nicht, und eine Attrappe, die `_handleEventClick`
 * nachbaut, wuerde nur belegen, dass die Attrappe funktioniert. Deshalb ist
 * jeder einzelne Schritt abgefangen und faellt auf den Entitaets-Dialog
 * zurueck. Ein toter Klick darf dabei NIE herauskommen.
 * ────────────────────────────────────────────────────────────────────────── */

const CAL_DIALOG_TAG = "dialog-calendar-event-detail";
/**
 * HAs EDITOR — der mit den Eingabefeldern, nicht der mit den Knoepfen.
 * Vertrag am ausgelieferten Buendel: `{ calendarId?, selectedDate?, entry?,
 * canDelete?, updated }`. Pflicht ist genau EIN Feld: `updated`. Es wird nach
 * jedem Erfolg unbedingt abgewartet (`await this._params.updated()`); fehlt
 * es, wirft der Dialog nach dem Speichern.
 *
 * `canEdit` gibt es hier NICHT: der Editor prueft die Aenderungsberechtigung
 * nirgends. Das muss die Karte selbst tun — siehe `calStufeWaehlen`.
 */
const CAL_EDITOR_DIALOG_TAG = "dialog-calendar-event-editor";

/** Die drei Stufen, von oben nach unten. Jede faellt auf die naechste. */
const CAL_STUFE_EDITOR = "editor";
const CAL_STUFE_ANSICHT = "ansicht";
const CAL_STUFE_ENTITAET = "entitaet";
const CAL_STUFEN = [CAL_STUFE_EDITOR, CAL_STUFE_ANSICHT, CAL_STUFE_ENTITAET];

/** Bitmaske von `supported_features` der Kalender-Entitaet:
 *  1 = anlegen (braucht die Karte nicht), 2 = loeschen, 4 = aendern. */
const CAL_MERKMAL_LOESCHEN = 2;
const CAL_MERKMAL_AENDERN = 4;

/** Wie lange auf die Definition von `ha-full-calendar` gewartet wird. */
const CAL_SONDE_ZEITGRENZE = 5000;

/** Beide abgegriffenen Ladefunktionen, sobald sie einmal da sind. */
let calDialogImporte = { ansicht: null, editor: null };
/**
 * Der EINE Versuch, sie zu holen — als Zusage gemerkt, nicht als Ergebnis.
 * Damit laufen zwei schnelle Klicks nicht in zwei Sonden, und ein
 * gescheiterter Versuch wird nicht bei jedem weiteren Klick wiederholt:
 * gescheitert ist gescheitert, und der Rueckfall ist dann der Dauerzustand.
 */
let calDialogVersuch = null;

/** Wartet auf `customElements.whenDefined`, aber nicht ewig. */
function calWarteAufElement(name) {
  return Promise.race([
    customElements.whenDefined(name),
    new Promise((_, ablehnen) =>
      setTimeout(() => ablehnen(new Error(`${name} wurde nicht definiert`)), CAL_SONDE_ZEITGRENZE)
    ),
  ]);
}

/**
 * Holt Home Assistants eigene Ladefunktionen fuer BEIDE Termin-Dialoge —
 * einmal. Ergebnis ist stets ein Objekt `{ ansicht, editor }`, dessen Felder
 * die Funktion oder `null` sind; sie wirft nie.
 *
 * Warum eine einzige Sonde fuer beide: Ansichts- und Editor-Ladefunktion
 * liegen im SELBEN Teilstueck des Frontends. Nacheinander
 * `_handleEventClick(...)` und `_createEvent()` auf derselben Instanz
 * aufzurufen holt beide; unterschieden wird am `dialogTag`.
 *
 * Und warum ueberhaupt: Ein einmal geoeffneter Ansichtsdialog registriert den
 * Editor NICHT mit — sein Ladeauftrag zieht das Editor-Modul nicht nach. Ohne
 * abgegriffene Ladefunktion bringt ein Ereignis mit dem Editor-Namen gar
 * nichts.
 */
function calHoleDialogImporte(hass, entityId) {
  if (calDialogVersuch) return calDialogVersuch;
  calDialogVersuch = (async () => {
    const leer = { ansicht: null, editor: null };
    try {
      if (typeof window === "undefined" || typeof window.loadCardHelpers !== "function") return leer;
      const helfer = await window.loadCardHelpers();
      if (!helfer || typeof helfer.createCardElement !== "function") return leer;

      // Der EINZIGE Zweck: HA laedt beim Bauen der eingebauten Kalenderkarte
      // das Buendel nach, in dem `ha-full-calendar` definiert wird. Die Karte
      // selbst wird weggeworfen, sie haengt nirgends. Scheitert das Bauen,
      // gehen wir trotzdem weiter — das Element kann laengst definiert sein.
      try {
        await helfer.createCardElement({ type: "calendar", entities: [entityId] });
      } catch (fehler) {
        /* Weiter: vielleicht ist `ha-full-calendar` schon da. */
      }

      if (typeof customElements === "undefined" || typeof customElements.whenDefined !== "function") {
        return leer;
      }
      await calWarteAufElement("ha-full-calendar");

      const sonde = document.createElement("ha-full-calendar");
      if (!sonde || typeof sonde._handleEventClick !== "function") return leer;
      sonde.hass = hass;

      const abgegriffen = { ansicht: null, editor: null };
      sonde.addEventListener("show-dialog", (ereignis) => {
        const einzel = ereignis && ereignis.detail;
        if (!einzel || typeof einzel.dialogImport !== "function") return;
        if (einzel.dialogTag === CAL_DIALOG_TAG) abgegriffen.ansicht = einzel.dialogImport;
        if (einzel.dialogTag === CAL_EDITOR_DIALOG_TAG) abgegriffen.editor = einzel.dialogImport;
      });

      // Beide Aufrufe EINZELN abgefangen: wirft der eine, soll der andere
      // trotzdem noch liefern. Vorher haette ein Fehlschlag beide gekostet.
      try {
        // Eine leere `eventData` reicht: HA baut daraus die Dialogparameter,
        // die wir ohnehin verwerfen — geholt wird allein `dialogImport`.
        sonde._handleEventClick({ event: { extendedProps: { calendar: entityId, eventData: {} } } });
      } catch (fehler) {
        /* Ansicht bleibt aus; vielleicht kommt wenigstens der Editor. */
      }

      try {
        // DIE FALLE, und sie ist scharf: `_createEvent` liest bei
        // `_activeView === "dayGridMonth"` — dem Standardwert — die Eigenschaft
        // `this.calendar.view`. Auf einer NICHT EINGEHAENGTEN Sonde gibt es
        // `this.calendar` nicht; die Sonde wuerde also werfen, BEVOR sie feuert,
        // und wir bekaemen nichts. `"listWeek"` trifft keinen der drei Zweige.
        //
        // Hergeleitet aus dem ausgelieferten Buendel, NICHT gemessen — unter
        // Node gibt es HAs Frontend nicht. Die Zeile kostet nichts und ist die
        // einzige Absicherung gegen einen Fehlschlag, den niemand sieht.
        sonde._activeView = "listWeek";
        if (typeof sonde._createEvent === "function") sonde._createEvent();
      } catch (fehler) {
        /* Editor bleibt aus; die Ansicht steht dann als Stufe 2 bereit. */
      }

      calDialogImporte = abgegriffen;
      return calDialogImporte;
    } catch (fehler) {
      console.warn(
        "busch-calendar-card: Home Assistants Termin-Dialoge liessen sich nicht "
        + "erreichen — der Klick oeffnet weiter den Kalender-Dialog. Grund: "
        + (fehler && fehler.message ? fehler.message : fehler)
      );
      return { ansicht: null, editor: null };
    }
  })();
  return calDialogVersuch;
}

/**
 * Die Rohform aus `calendars/…` in die flache Form, die HA intern benutzt
 * (`src/data/calendar.ts`). `uid` und `recurrence_id` sind dabei das
 * Entscheidende: ohne sie sind Aendern und Loeschen im Dialog kaputt. Sie
 * werden deshalb DURCHGEREICHT, nicht auf `""` normalisiert — ein leerer
 * String waere eine Kennung, die es nicht gibt.
 *
 * Ohne lesbaren Start gibt es keine Form, sondern `null`: derselbe Massstab,
 * den auch die Tagesschleife anlegt.
 */
function calNormalisiereTermin(termin) {
  if (!termin || typeof termin !== "object") return null;
  const start = termin.start || {};
  const ende = termin.end || {};
  const dtstart = start.dateTime || start.date || "";
  if (!dtstart) return null;
  return {
    summary: termin.summary || "",
    dtstart,
    dtend: ende.dateTime || ende.date || "",
    description: termin.description || "",
    location: termin.location || "",
    uid: termin.uid || undefined,
    recurrence_id: termin.recurrence_id || undefined,
    rrule: termin.rrule || undefined,
  };
}

/**
 * Was der Dialog darf, steht in der ENTITAET, nicht in unserer Annahme.
 * `calendar.arbeitszeiten` hat in der Anlage des Nutzers `7` — alles erlaubt.
 * Eine unbekannte oder fehlende Maske heisst „nichts erlaubt": ein zu
 * grosszuegiges Raten zeigte einen Speichern-Knopf, der beim Druck scheitert.
 */
function calBerechtigungen(zustand) {
  const roh = zustand && zustand.attributes ? zustand.attributes.supported_features : 0;
  const merkmale = Number(roh);
  const maske = Number.isFinite(merkmale) ? merkmale : 0;
  return {
    canEdit: Boolean(maske & CAL_MERKMAL_AENDERN),
    canDelete: Boolean(maske & CAL_MERKMAL_LOESCHEN),
  };
}

/**
 * Vom angeklickten `dataset` zurueck zum geladenen Termin.
 *
 * `data-idx` ist der schnelle Weg, `data-uid` und `data-entity` sind die
 * GEGENPROBE: passt der Termin am Index nicht zur Zeile, ist die Liste
 * zwischenzeitlich neu geladen worden, und der Index zeigt woanders hin. Dann
 * wird gesucht statt gegriffen — sonst oeffnete der Klick den falschen Termin,
 * und zwar lautlos.
 */
function calTerminAusZeile(termine, datensatz) {
  const liste = Array.isArray(termine) ? termine : [];
  if (!datensatz) return null;
  const uid = datensatz.uid || "";
  const entity = datensatz.entity || "";
  const passt = (t) => Boolean(t) && (t.uid || "") === uid && (t._entity || "") === entity;

  // NICHT `Number(datensatz.idx)` allein: `Number("")` ist 0, und ein leeres
  // `data-idx` — das die Zeile bekommt, wenn kein Index gesetzt ist — zeigte
  // damit auf den ERSTEN Termin. Bei einer Serie, deren Vorkommen alle
  // dieselbe `uid` tragen, haette die Gegenprobe das nicht gefangen: sie passt
  // ja. Gemessen an genau dieser Stelle.
  const roh = datensatz.idx;
  const i = roh === "" || roh === undefined || roh === null ? NaN : Number(roh);
  if (Number.isInteger(i) && i >= 0 && i < liste.length && passt(liste[i])) return liste[i];

  const treffer = liste.filter(passt);
  if (treffer.length === 0) return null;
  if (treffer.length === 1) return treffer[0];
  // Mehrere Vorkommen derselben Kennung: eine Serie. Die Wiederholung
  // entscheidet — und wenn auch die nicht trennt, das erste Vorkommen.
  const rid = datensatz.rid || "";
  return treffer.find((t) => (t.recurrence_id || "") === rid) || treffer[0];
}

/**
 * Die Parameter, die `dialog-calendar-event-detail` erwartet.
 * `updated` haengt die Karte selbst an — es ist das einzige Feld, das eine
 * Bindung an die laufende Instanz braucht.
 *
 * Ohne `uid` gibt es KEINE Parameter: der Dialog liesse sich zwar oeffnen,
 * aber Aendern und Loeschen liefen ins Leere. Dann ist der Entitaets-Dialog
 * die ehrlichere Antwort.
 */
function calDialogParameter(entityId, termin, farbe, zustand) {
  const eintrag = calNormalisiereTermin(termin);
  if (!eintrag || !eintrag.uid) return null;
  const rechte = calBerechtigungen(zustand);
  return {
    calendarId: entityId,
    entry: eintrag,
    color: farbe,
    canEdit: rechte.canEdit,
    canDelete: rechte.canDelete,
  };
}

/**
 * Die Parameter fuer `dialog-calendar-event-editor`.
 *
 * Absichtlich OHNE `canEdit`: der Editor kennt das Feld nicht. Es dort
 * hineinzuschreiben waere ein Versprechen, das niemand einloest. Und
 * absichtlich OHNE die Serien- und Rechtepruefung — die steht an genau EINER
 * Stelle, in `calStufeWaehlen`. Dieselbe Bedingung zweimal nachzubilden lief
 * in diesem Repo schon einmal auseinander.
 *
 * `updated` haengt die Karte an; es ist das einzige Pflichtfeld des Vertrags
 * und das einzige, das eine Bindung an die laufende Instanz braucht.
 */
function calEditorParameter(entityId, termin, zustand) {
  const eintrag = calNormalisiereTermin(termin);
  if (!eintrag || !eintrag.uid) return null;
  return {
    calendarId: entityId,
    entry: eintrag,
    canDelete: calBerechtigungen(zustand).canDelete,
  };
}

/**
 * DER SERIENSCHUTZ.
 *
 * Fehlt bei einem wiederkehrenden Termin die Instanzkennung `recurrence_id`,
 * aendert der Editor STILLSCHWEIGEND die ganze Serie: er sendet dann einen
 * leeren String, und der bedeutet „alle Vorkommen". Der Nutzer bekommt keine
 * Rueckfrage, weil die Rueckfrage genau an dieser Kennung haengt.
 *
 * Ob Home Assistant fuer gewoehnliche Instanzen einer Serie ueberhaupt eine
 * eigene Kennung liefert, ist UNBELEGT — offener Punkt seit der letzten Runde.
 * Solange das so ist, wird der Editor fuer diesen Fall nicht geoeffnet,
 * sondern der Ansichtsdialog: der hat einen Bearbeiten-Knopf und stellt die
 * Rueckfrage korrekt.
 *
 * Ein stillschweigend geaenderter Serientermin ist ein Datenverlust, den
 * niemand bemerkt, bis es zu spaet ist. Deshalb faellt die Entscheidung hier
 * zugunsten der langsameren, aber ehrlichen Stufe.
 */
function calAendertGanzeSerie(eintrag) {
  if (!eintrag) return false;
  return Boolean(eintrag.rrule) && !eintrag.recurrence_id;
}

/**
 * Welche Stufe ein Klick oeffnet — die ganze Entscheidung an einer Stelle,
 * ohne DOM und damit pruefbar.
 *
 * `lage` = `{ editOnTap, hatEditorImport, hatAnsichtImport, rechte, eintrag }`.
 *
 * Der Editor prueft die Aenderungsberechtigung NICHT selbst; ist Bit 4 der
 * Merkmale nicht gesetzt, zeigte er Eingabefelder fuer einen Kalender, der die
 * Aenderung hinterher ablehnt. Deshalb prueft die Karte.
 */
function calStufeWaehlen(lage) {
  const l = lage || {};
  const eintrag = l.eintrag || null;
  const rechte = l.rechte || {};
  // Beide Dialoge brauchen `uid`: ohne sie liefen Speichern und Loeschen ins
  // Leere. Dann ist der Entitaets-Dialog die ehrlichere Antwort.
  if (!eintrag || !eintrag.uid) return CAL_STUFE_ENTITAET;
  const editorMoeglich =
    l.editOnTap !== false &&
    Boolean(l.hatEditorImport) &&
    Boolean(rechte.canEdit) &&
    !calAendertGanzeSerie(eintrag);
  if (editorMoeglich) return CAL_STUFE_EDITOR;
  if (l.hatAnsichtImport) return CAL_STUFE_ANSICHT;
  return CAL_STUFE_ENTITAET;
}

/**
 * Die Stufe und alles, was darunter liegt — die Reihenfolge, in der die Karte
 * es versucht, wenn eine Stufe zur Laufzeit wirft. Endet IMMER am
 * Entitaets-Dialog: ein toter Klick darf nie herauskommen.
 */
function calStufenFolge(stufe) {
  const i = CAL_STUFEN.indexOf(stufe);
  return i < 0 ? [CAL_STUFE_ENTITAET] : CAL_STUFEN.slice(i);
}

class BuschCalendarCard extends HTMLElement {
  set preview(value) { this._preview=!!value; this.toggleAttribute('data-preview',this._preview); }
  get preview() { return !!this._preview; }
  set editMode(value) { this.preview=value; }
  get editMode() { return this.preview; }

  static getConfigElement() {
    return document.createElement("busch-calendar-card-editor");
  }

  static getStubConfig(hass) {
    const ersterKalender = hass
      ? Object.keys(hass.states).find((id) => id.startsWith("calendar."))
      : undefined;
    return {
      type: "custom:busch-calendar-card",
      entities: ersterKalender ? [ersterKalender] : [],
      month_offset: 0,
    };
  }

  setConfig(config) {
    this._config = calNormalisiereKonfig(config);
    // Der Blaetterzustand lebt nur im Speicher. Ein Klick auf einen Pfeil
    // schreibt NICHTS in die Konfiguration zurueck — sonst aenderte ein Blick
    // in den Vormonat das Dashboard fuer alle.
    this._versatzLaufend = this._config.month_offset;
    this._tage = null;
    this._fehler = [];
    this._nichtGezeigt = 0;
    this._render();
    // Schuetzt gegen die dauerhaft haengende Ladeanzeige: Ein zweiter Aufruf
    // aus dem Editor (Ueberschrift, Monatsversatz, Schalter) setzt `_tage`
    // wieder auf null, und `_ladeWennVeraendert()` loest NICHT nach — sein
    // Stempel haengt allein an der Entitaetsliste und deren Aenderungszeit,
    // und die ist unveraendert. Ohne diese Zeile bliebe die Karte auf
    // „Wird geladen …" stehen. Kreisen kann es nicht: `_lade()` ruft
    // `setConfig` nirgends auf.
    if (this._hass) this._lade();
  }

  set hass(hass) {
    const ersterAufruf = !this._hass;
    this._hass = hass;
    if (ersterAufruf) this._lade();
    else this._ladeWennVeraendert();
  }

  getCardSize() {
    return this._config && this._config.show_empty_days ? 12 : 6;
  }

  /** Spalten in Vielfachen von 3 (Regel 3). Eine Monatsliste braucht Hoehe,
   *  aber keine volle Breite — halbe Breite ist das Mindestmass. */
  getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_CALENDAR_CARD, this._hass).texte;
  }

  _ladeWennVeraendert() {
    if (!this._config || !this._hass) return;
    const stempel = this._config.entities
      .map((e) => {
        const zustand = this._hass.states[e.entity];
        return zustand ? `${e.entity}:${zustand.last_changed}` : `${e.entity}:fehlt`;
      })
      .join("|");
    if (stempel !== this._letzterStempel) {
      this._letzterStempel = stempel;
      this._lade();
    }
  }

  async _lade() {
    if (!this._hass || !this._config) return;
    const { start, ende } = calMonatsGrenzen(new Date(), this._versatzLaufend);
    // Ein monoton steigender Zaehler, KEINE Marke aus Monat und Kalenderanzahl.
    // Wer vor und gleich wieder zurueck blaettert, holt zweimal dasselbe
    // Fenster: eine inhaltliche Marke waere dann doppelt, und eine verspaetete
    // alte Antwort haette die frische kommentarlos ueberschrieben. Mit dem
    // Zaehler gewinnt immer die zuletzt gestartete Anfrage, egal welchen Monat
    // sie holt. Er wird NIE zurueckgesetzt, auch nicht in `setConfig` — sonst
    // traefe eine noch laufende alte Ladung wieder ihre eigene Nummer.
    this._ladeZaehler = (this._ladeZaehler || 0) + 1;
    const meineLadung = this._ladeZaehler;

    if (this._config.entities.length === 0) {
      this._tage = [];
      this._alleTermine = [];
      this._fehler = [];
      this._nichtGezeigt = 0;
      this._render();
      return;
    }

    const anfragen = this._config.entities.map((e) =>
      this._hass.callApi(
        "GET",
        `calendars/${e.entity}?start=${encodeURIComponent(start.toISOString())}` +
          `&end=${encodeURIComponent(ende.toISOString())}`
      )
    );
    const ergebnisse = await Promise.allSettled(anfragen);
    // Eine neuere Ladung ist gestartet — diese Antwort ist ueberholt.
    if (this._ladeZaehler !== meineLadung) return;

    const alle = [];
    const fehler = [];
    ergebnisse.forEach((r, i) => {
      const eintrag = this._config.entities[i];
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        for (const termin of r.value) {
          // Flache Kopie, kein Feld am Original: ein mehrtaegiger Termin liegt
          // als DASSELBE Objekt in mehreren Tageslisten — wer daran schreibt,
          // trifft alle seine Tage.
          // `_idx` ist der Platz in genau dieser Liste; die Terminzeile traegt
          // ihn als `data-idx`, damit der Klick den Termin wiederfindet.
          alle.push({ ...termin, _entity: eintrag.entity, _idx: alle.length });
        }
      } else {
        fehler.push(eintrag.entity);
      }
    });

    this._alleTermine = alle;
    this._tage = calGruppiereNachTag(alle, start, ende);
    this._fehler = fehler;
    this._nichtGezeigt = calZaehleNichtGezeigt(alle, this._tage);
    this._render();
  }

  _blaettern(schritt) {
    this._versatzLaufend += schritt;
    // `_tage` wird BEWUSST nicht geleert: die alte Liste bleibt stehen, bis
    // die neue da ist. Sonst blitzt zwischen zwei Monaten „Wird geladen …" auf.
    this._lade();
    this._render();
  }

  /**
   * Ein Klick auf eine Terminzeile oeffnet Home Assistants eigenen
   * Termin-EDITOR — den mit den Eingabefeldern. Wie die Karte an dessen
   * Ladefunktion kommt, steht ausfuehrlich bei `calHoleDialogImporte`.
   *
   * DREI STUFEN, jede faellt auf die naechste:
   *
   *   1. Editor (`dialog-calendar-event-editor`) — direkt in die Felder.
   *   2. Ansicht (`dialog-calendar-event-detail`) — der Stand von v0.8.1,
   *      mit Knoepfen zum Bearbeiten und Loeschen darin.
   *   3. Entitaet (`hass-more-info`) — der Stand bis v0.8.0.
   *
   * WELCHE Stufe entschieden wird, steht in `calStufeWaehlen`. Hier steht nur,
   * was danach passiert — und dass jede Stufe EINZELN abgefangen ist: wirft
   * das Oeffnen, wird die naechste versucht. Ein Klick, der gar nichts tut,
   * waere das Schlechteste von allem; der Nutzer saehe nicht, ob die Karte
   * kaputt ist oder er danebengetippt hat.
   *
   * Diese Methode wirft nie und lehnt nie ab; die aufrufende Klickbehandlung
   * wartet nicht auf sie.
   */
  async _oeffneTermin(datensatz) {
    const entity = (datensatz && datensatz.entity) || "";
    if (!this._config.open_event_on_tap || !entity) return;

    let stufen = [CAL_STUFE_ENTITAET];
    let parameter = null;
    let editorParameter = null;
    let importe = { ansicht: null, editor: null };
    try {
      const termin = calTerminAusZeile(this._alleTermine, datensatz);
      const eintrag = this._config.entities.find((e) => e.entity === entity);
      const zustand = this._hass && this._hass.states ? this._hass.states[entity] : null;
      parameter = calDialogParameter(
        entity,
        termin,
        eintrag ? eintrag.color : calPalette[0],
        zustand
      );
      // Die Rohform, NICHT `parameter.entry`: das ist bereits normalisiert,
      // und `calEditorParameter` normalisiert selbst. Zweimal normalisieren
      // ergaebe `null`, weil die flache Form kein `start`-Objekt mehr hat.
      editorParameter = calEditorParameter(entity, termin, zustand);
      if (parameter) {
        importe = await calHoleDialogImporte(this._hass, entity);
        stufen = calStufenFolge(
          calStufeWaehlen({
            editOnTap: this._config.edit_on_tap !== false,
            hatEditorImport: Boolean(importe.editor),
            hatAnsichtImport: Boolean(importe.ansicht),
            rechte: { canEdit: parameter.canEdit, canDelete: parameter.canDelete },
            eintrag: parameter.entry,
          })
        );
      }
    } catch (fehler) {
      console.warn(
        "busch-calendar-card: Stufe liess sich nicht bestimmen, es bleibt beim "
        + "Kalender-Dialog. Grund: " + (fehler && fehler.message ? fehler.message : fehler)
      );
    }

    for (const stufe of stufen) {
      try {
        if (stufe === CAL_STUFE_EDITOR && editorParameter && importe.editor) {
          this._zeigeDialog(CAL_EDITOR_DIALOG_TAG, importe.editor, {
            ...editorParameter,
            // `updated` ist das EINZIGE Pflichtfeld des Vertrags: HA wartet es
            // nach jedem Erfolg unbedingt ab. Fehlt es, wirft der Dialog nach
            // dem Speichern.
            updated: () => this._lade(),
          });
          return;
        }
        if (stufe === CAL_STUFE_ANSICHT && parameter && importe.ansicht) {
          this._zeigeDialog(CAL_DIALOG_TAG, importe.ansicht, {
            ...parameter,
            updated: () => this._lade(),
          });
          return;
        }
        if (stufe === CAL_STUFE_ENTITAET) {
          this._oeffneEntitaet(entity);
          return;
        }
      } catch (fehler) {
        console.warn(
          `busch-calendar-card: Stufe „${stufe}" liess sich nicht oeffnen, `
          + "es geht eine Stufe tiefer. Grund: "
          + (fehler && fehler.message ? fehler.message : fehler)
        );
      }
    }
  }

  /**
   * Ein `show-dialog` an HAs Dialogverwaltung.
   *
   * `addHistory: true` ist der dokumentierte Weg, die Zurueck-Taste an einen
   * HA-Dialog zu binden: `src/dialogs/make-dialog-manager.ts` fuehrt das Feld
   * in `ShowDialogParams` und legt bei `true` beim Oeffnen
   * `history.pushState({ dialog: dialogTag }, '')` an und ruft beim Schliessen
   * `history.back()`. Genau das verlangt Regel 2 aus `docs/ui-regeln.md`.
   *
   * Es WEGZULASSEN waere die Annahme, HAs Vorgabe sei `true`. Ist sie es,
   * aendert die Zeile nichts; ist sie es nicht, verliesse die Zurueck-Taste
   * das Dashboard. Deshalb steht es hier ausdruecklich.
   */
  _zeigeDialog(tag, laden, parameter) {
    this.dispatchEvent(
      new CustomEvent("show-dialog", {
        detail: {
          dialogTag: tag,
          dialogImport: laden,
          dialogParams: parameter,
          addHistory: true,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Der Rueckfall: HAs Info-Dialog der Kalender-Entitaet. */
  _oeffneEntitaet(entity) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this._config) return;
    const t = this._texte;
    const locale = (this._hass && this._hass.locale && this._hass.locale.language) || "de-DE";
    const { start, ende } = calMonatsGrenzen(new Date(), this._versatzLaufend);

    if (!this._karte) {
      this._karte = document.createElement("ha-card");
      const stil = document.createElement("style");
      stil.textContent = CAL_STIL;
      this._karte.appendChild(stil);
      this._koerper = document.createElement("div");
      this._koerper.className = "cal-body";
      this._karte.appendChild(this._koerper);
      this.appendChild(this._karte);

      this._koerper.addEventListener("click", (ereignis) => {
        const pfeil = ereignis.target.closest(".cal-pfeil");
        if (pfeil) {
          this._blaettern(Number(pfeil.dataset.schritt));
          return;
        }
        const zeile = ereignis.target.closest(".cal-termin");
        if (zeile && zeile.dataset.uid) {
          // Ohne `await`: die Klickbehandlung ist synchron, und
          // `_oeffneTermin` lehnt nie ab.
          this._oeffneTermin(zeile.dataset);
        }
      });
    }

    const farben = {};
    for (const e of this._config.entities) farben[e.entity] = e.color;

    const kopf =
      (this._config.title
        ? `<div class="cal-titel-zeile">${calEscape(this._config.title)}</div>`
        : "") +
      `<div class="cal-kopf">` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="-1" aria-label="${calEscape(t.vorigerMonat)}" title="${calEscape(t.vorigerMonat)}">‹</button>`
        : `<span></span>`) +
      `<span class="cal-monat">${calEscape(calMonatsName(start, locale))}</span>` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="1" aria-label="${calEscape(t.naechsterMonat)}" title="${calEscape(t.naechsterMonat)}">›</button>`
        : `<span></span>`) +
      `</div>`;

    let rumpf;
    if (this._config.entities.length === 0) {
      rumpf = `<div class="cal-leermeldung">${calEscape(t.keinKalender)}</div>`;
    } else if (this._tage === null) {
      rumpf = `<div class="cal-leermeldung">${calEscape(t.laden)}</div>`;
    } else {
      const liste = calListeHtml(this._tage, {
        zeigeLeereTage: this._config.show_empty_days,
        locale,
        farben,
        texte: t,
        mehrereKalender: this._config.entities.length > 1,
      });
      rumpf = liste
        ? `<div class="cal-liste">${liste}</div>`
        : `<div class="cal-leermeldung">${calEscape(t.keineTermine)}</div>`;
    }

    let fuss = "";
    if (this._config.show_total && this._tage) {
      // MIT den Monatsgrenzen: eine Summe, die schneiden kann, aber
      // ungeschnitten aufgerufen wird, ist so falsch wie eine, die es nicht kann.
      const s = calSummeStunden(this._alleTermine || [], start, ende);
      const teile = [
        buschFuellen(t.tage, { n: s.tageMitTermin }),
        buschFuellen(t.stunden, { n: calFormatStunden(s.stunden, locale) }),
      ];
      if (s.ganztags) teile.push(buschFuellen(t.summeGanztags, { n: s.ganztags }));
      // Ein Span JE WERT, linksbuendig mit festem `gap` im Stil. KEIN Trenner
      // dazwischen: auf dem Bildschirm trennt sie der Raum.
      //
      // Wer den Fuss misst, liest die Spans EINZELN (`.cal-fuss span`).
      // `textContent` des Kastens klebt sie zu „6 Tage25,7 h1 ganztägig"
      // zusammen — das ist ein Messproblem, kein Darstellungsproblem. Es wurde
      // in v0.7.1 kurzzeitig andersherum geloest (ein Span mit Mittelpunkten),
      // und damit war `space-between` toter Code und die Zeile klebte links.
      // Die Messung passt sich der Darstellung an, nicht umgekehrt.
      fuss = `<div class="cal-fuss">${teile.map((t) => `<span>${calEscape(t)}</span>`).join("")}</div>`;
    }

    const hinweisText = calHinweisText(this._fehler || [], this._nichtGezeigt || 0, t);
    const hinweis = hinweisText
      ? `<div class="cal-hinweis">${calEscape(hinweisText)}</div>`
      : "";

    this._koerper.innerHTML = kopf + rumpf + fuss + hinweis;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Editor der Kalenderkarte.
 *
 * Jede Option aus Abschnitt 5 der Spec steht im Schema — keine existiert nur
 * in YAML. Die Farben je Kalender stehen bewusst NICHT im `ha-form`-Schema:
 * sie haengen an den Eintraegen von `entities`, und der Entitaetsselektor
 * kennt nur flache Zeichenketten. Sie bekommen deshalb ein eigenes Feld
 * darunter, das erst ab dem zweiten Kalender erscheint (ein Punkt, der immer
 * dieselbe Farbe hat, traegt keine Information).
 * ────────────────────────────────────────────────────────────────────────── */

const SCHEMA_BUSCH_CALENDAR_CARD = [
  { name: "title", selector: { text: {} } },
  {
    name: "entities",
    selector: { entity: { domain: "calendar", multiple: true } },
  },
  {
    name: "month_offset",
    selector: { number: { min: -24, max: 24, step: 1, mode: "box" } },
  },
  {
    type: "grid",
    schema: [
      { name: "navigation", selector: { boolean: {} } },
      { name: "show_empty_days", selector: { boolean: {} } },
      { name: "show_total", selector: { boolean: {} } },
      { name: "open_event_on_tap", selector: { boolean: {} } },
      { name: "edit_on_tap", selector: { boolean: {} } },
    ],
  },
];

const TEXTE_BUSCH_CALENDAR_CARD = {
  de: {
    name: "Busch Kalender",
    description: "Termine als Monatsliste, mit Monatsversatz und Blättern.",
    labels: {
      title: "Überschrift",
      entities: "Kalender",
      month_offset: "Monatsversatz",
      navigation: "Pfeile zum Blättern",
      show_empty_days: "Leere Tage zeigen",
      show_total: "Summe in der Fußzeile",
      open_event_on_tap: "Klick öffnet den Termin",
      edit_on_tap: "Klick öffnet den Editor",
    },
    helpers: {
      title: "Zeile über dem Monatsnamen. Leer lässt sie ganz weg. Vorgabe: leer.",
      entities: "Die Kalender, deren Termine die Karte zeigt. Ab dem zweiten erscheint darunter je ein Farbfeld. Vorgabe: keiner.",
      month_offset: "0 zeigt den laufenden Monat, -1 den Vormonat, 1 den nächsten. Vorgabe 0.",
      navigation: "Setzt links und rechts vom Monatsnamen je einen Pfeil. Geblättert wird nur in dieser Ansicht, das Dashboard bleibt unverändert. Vorgabe an.",
      show_empty_days: "An steht jeder Tag des Monats in der Liste, auch ohne Termin. Vorgabe an.",
      show_total: "Zeigt unter der Liste Tage mit Terminen, Stunden und ganztägige Termine des gezeigten Monats. Vorgabe aus.",
      open_event_on_tap: "An öffnet ein Klick auf eine Terminzeile den Termin-Dialog von Home Assistant. Vorgabe an.",
      edit_on_tap: "An öffnet der Klick gleich den Editor mit den Eingabefeldern, aus die Ansicht mit den Knöpfen. Bei einem Serientermin ohne eigene Kennung bleibt es immer bei der Ansicht. Vorgabe an.",
    },
    texte: {
      ganztags: "ganztägig",
      ohneTitel: "(ohne Titel)",
      keinKalender: "Kein Kalender gewählt. Im Karteneditor einen auswählen.",
      laden: "Wird geladen …",
      keineTermine: "Keine Termine in diesem Monat.",
      nichtErreichbar: "Nicht erreichbar: {liste}",
      einerOhneTag: "1 Termin ohne Tag im gezeigten Monat, nicht angezeigt.",
      mehrereOhneTag: "{n} Termine ohne Tag im gezeigten Monat, nicht angezeigt.",
      tage: "{n} Tage",
      stunden: "{n} h",
      summeGanztags: "{n} ganztägig",
      vorigerMonat: "Voriger Monat",
      naechsterMonat: "Nächster Monat",
      farben: "Farben",
    },
  },
  en: {
    name: "Busch calendar",
    description: "Events as a month list, with a month offset and paging.",
    labels: {
      title: "Heading",
      entities: "Calendars",
      month_offset: "Month offset",
      navigation: "Paging arrows",
      show_empty_days: "Show empty days",
      show_total: "Total in the footer",
      open_event_on_tap: "Tap opens the event",
      edit_on_tap: "Tap opens the editor",
    },
    helpers: {
      title: "A line above the month name. Empty leaves it out entirely. Default: empty.",
      entities: "The calendars whose events this card shows. From the second one on, a colour field appears below. Default: none.",
      month_offset: "0 shows the current month, -1 the previous one, 1 the next. Default 0.",
      navigation: "Puts an arrow on each side of the month name. Paging affects this view only, the dashboard stays unchanged. Default on.",
      show_empty_days: "On, every day of the month is listed, even without an event. Default on.",
      show_total: "Shows days with events, hours and all-day events of the shown month below the list. Default off.",
      open_event_on_tap: "On, a tap on an event row opens Home Assistant's event dialog. Default on.",
      edit_on_tap: "On, the tap goes straight to the editor with the input fields, off to the view with the buttons. For a recurring event without its own id it always stays on the view. Default on.",
    },
    texte: {
      ganztags: "all day",
      ohneTitel: "(untitled)",
      keinKalender: "No calendar chosen. Pick one in the card editor.",
      laden: "Loading …",
      keineTermine: "No events this month.",
      nichtErreichbar: "Unreachable: {liste}",
      einerOhneTag: "1 event has no day in the month shown and is not listed.",
      mehrereOhneTag: "{n} events have no day in the month shown and are not listed.",
      tage: "{n} days",
      stunden: "{n} h",
      summeGanztags: "{n} all day",
      vorigerMonat: "Previous month",
      naechsterMonat: "Next month",
      farben: "Colours",
    },
  },
};

class BuschCalendarCardEditor extends BuschEditorBase {
  setConfig(config) {
    if (!this._acceptConfig({ ...CAL_STANDARD, ...config })) return;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /** Der Entitaetsselektor liefert Zeichenketten. Eigene Farben, die schon
   *  gesetzt waren, muessen dabei erhalten bleiben. */
  _verschmelzeEntities(neueListe) {
    const alt = new Map();
    for (const e of this._config.entities || []) {
      if (typeof e === "object" && e.entity) alt.set(e.entity, e);
    }
    return (neueListe || []).map((id) => (alt.has(id) ? alt.get(id) : id));
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      const texte = buschTexte(TEXTE_BUSCH_CALENDAR_CARD, this._hass);
      this._texte = texte.texte;
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_CALENDAR_CARD, texte);
      this._form.computeLabel = (schema) => texte.labels[schema.name] || schema.name;
      this._form.computeHelper = (schema) => texte.helpers[schema.name] || "";
      this._form.addEventListener("value-changed", (ereignis) => {
        ereignis.stopPropagation();
        const werte = { ...ereignis.detail.value };
        if (Object.hasOwn(werte, "entities")) werte.entities = this._verschmelzeEntities(werte.entities);
        this._publishConfig({ ...this._config, ...werte });
        this._renderFarben();
      });
      this.appendChild(this._form);

      this._farbFeld = document.createElement("div");
      this._farbFeld.style.padding = "8px 0 0";
      this.appendChild(this._farbFeld);
    }

    this._form.hass = this._hass;
    // ha-form erwartet flache Zeichenketten im Entitaetsselektor.
    this._form.data = {
      ...this._config,
      entities: (this._config.entities || []).map((e) =>
        typeof e === "string" ? e : e.entity
      ),
    };
    this._renderFarben();
  }

  _renderFarben() {
    const normal = calNormalisiereKonfig(this._config);
    if (normal.entities.length < 2) {
      this._farbFeld.innerHTML = "";
      return;
    }
    const farbenTitel = (this._texte || TEXTE_BUSCH_CALENDAR_CARD.de.texte).farben;
    this._farbFeld.innerHTML =
      `<div style="font-weight:600;margin:8px 0 4px">${calEscape(farbenTitel)}</div>` +
      normal.entities
        .map((e) => {
          const name =
            (this._hass.states[e.entity] &&
              this._hass.states[e.entity].attributes.friendly_name) ||
            e.entity;
          return (
            `<label style="display:flex;align-items:center;gap:10px;padding:4px 0">` +
            `<input type="color" data-entity="${calEscape(e.entity)}" value="${calEscape(e.color)}">` +
            `<span>${calEscape(name)}</span></label>`
          );
        })
        .join("");

    for (const feld of this._farbFeld.querySelectorAll("input[type=color]")) {
      feld.addEventListener("input", (ereignis) => {
        const id = ereignis.target.dataset.entity;
        const liste = calNormalisiereKonfig(this._config).entities;
        const index = liste.findIndex((entry) => entry.entity === id);
        if (index < 0) return;
        this._publishConfig(buschEditorUpdatePath(
          { ...this._config, entities: liste }, ["entities", index, "color"], ereignis.target.value
        ));
      });
    }
  }
}

if (!customElements.get?.("busch-schedule-card")) customElements.define("busch-schedule-card", BuschScheduleCard);
if (!customElements.get?.("busch-schedule-card-editor")) customElements.define("busch-schedule-card-editor", BuschScheduleCardEditor);

/* Der Kartenwaehler liest `name` und `description` beim LADEN der Datei —
 * da gibt es noch keinen `hass`. Die Sprache kommt hier deshalb aus
 * `navigator.language`; `buschTexte` ohne zweites Argument macht genau das
 * (docs/ui-regeln.md, Regel 3). */
const waehlerZeitplan = buschTexte(TEXTE_BUSCH_SCHEDULE_CARD);

window.customCards = window.customCards || [];
window.customCards.some(card => card.type === "busch-schedule-card") || window.customCards.push({
  type: "busch-schedule-card",
  name: waehlerZeitplan.name,
  description: waehlerZeitplan.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});


/* ═══════════════════════════════════════════════════════════════════════════
 * BEGIN VENDOR — Leaflet 1.9.4 (BSD-2-Clause), unverändert eingebettet.
 *
 * Nur die Bibliothek, ohne CSS und Marker-Bilder: Diese Datei zeichnet keine
 * eigene Karte. Sie haengt lediglich eine Rasterebene an eine Karte, die Home
 * Assistant schon aufgebaut hat — dessen Leaflet-CSS ist dann bereits geladen.
 *
 * Warum ueberhaupt eingebettet: Zeichnet Home Assistant seine Grundkarte als
 * Vektorkarte, gibt es keine Rasterebene, deren URL man tauschen koennte. Dann
 * braucht es eine eigene — und dafuer eine `L.TileLayer`-Klasse. Die ist aus
 * dem Kartenobjekt heraus nicht erreichbar: Leaflet-Klassen verweisen nicht
 * aufeinander, und HAs Leaflet liegt in einem Modul ohne globalen Namen.
 *
 * ERST BEI BEDARF geladen, ueber `leafletLaden()` weiter unten — und nur,
 * wenn nicht schon ein Leaflet auf der Seite liegt. Details dort.
 * ═══════════════════════════════════════════════════════════════════════════ */

function leafletLaden() {
  // ERST BEI BEDARF, nicht beim Laden der Datei. Zwei Gruende:
  //
  // 1. Leaflets UMD greift sofort auf `window.requestAnimationFrame`,
  //    `navigator.userAgent` und das echte DOM zu. Die Testsandbox in
  //    `tests/laden.js` stellt davon nur einen Bruchteil — beim Laden auf
  //    oberster Ebene brach dort jeder Test ab.
  // 2. Die 147 kB werden nur ausgewertet, wenn wirklich eine Vektor-Grundkarte
  //    ersetzt werden muss. Wer nur den Zeitplan oder den Kalender benutzt,
  //    zahlt nichts dafuer.
  //
  // Liegt bereits ein Leaflet auf der Seite (etwa aus `ha-localtrack-cards`),
  // wird dessen Instanz mitbenutzt: zwei Kopien derselben Bibliothek an einem
  // Kartenobjekt sind unnoetig und eine Fehlerquelle.
  if (typeof window === "undefined") return null;
  if (window.L) return window.L;
  if (leafletLaden._versucht) return null;
  leafletLaden._versucht = true;
  try {
/* @preserve
 * Leaflet 1.9.4, a JS library for interactive maps. https://leafletjs.com
 * (c) 2010-2023 Vladimir Agafonkin, (c) 2010-2011 CloudMade
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).leaflet={})}(this,function(t){"use strict";function l(t){for(var e,i,n=1,o=arguments.length;n<o;n++)for(e in i=arguments[n])t[e]=i[e];return t}var R=Object.create||function(t){return N.prototype=t,new N};function N(){}function a(t,e){var i,n=Array.prototype.slice;return t.bind?t.bind.apply(t,n.call(arguments,1)):(i=n.call(arguments,2),function(){return t.apply(e,i.length?i.concat(n.call(arguments)):arguments)})}var D=0;function h(t){return"_leaflet_id"in t||(t._leaflet_id=++D),t._leaflet_id}function j(t,e,i){var n,o,s=function(){n=!1,o&&(r.apply(i,o),o=!1)},r=function(){n?o=arguments:(t.apply(i,arguments),setTimeout(s,e),n=!0)};return r}function H(t,e,i){var n=e[1],e=e[0],o=n-e;return t===n&&i?t:((t-e)%o+o)%o+e}function u(){return!1}function i(t,e){return!1===e?t:(e=Math.pow(10,void 0===e?6:e),Math.round(t*e)/e)}function W(t){return t.trim?t.trim():t.replace(/^\s+|\s+$/g,"")}function F(t){return W(t).split(/\s+/)}function c(t,e){for(var i in Object.prototype.hasOwnProperty.call(t,"options")||(t.options=t.options?R(t.options):{}),e)t.options[i]=e[i];return t.options}function U(t,e,i){var n,o=[];for(n in t)o.push(encodeURIComponent(i?n.toUpperCase():n)+"="+encodeURIComponent(t[n]));return(e&&-1!==e.indexOf("?")?"&":"?")+o.join("&")}var V=/\{ *([\w_ -]+) *\}/g;function q(t,i){return t.replace(V,function(t,e){e=i[e];if(void 0===e)throw new Error("No value provided for variable "+t);return e="function"==typeof e?e(i):e})}var d=Array.isArray||function(t){return"[object Array]"===Object.prototype.toString.call(t)};function G(t,e){for(var i=0;i<t.length;i++)if(t[i]===e)return i;return-1}var K="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";function Y(t){return window["webkit"+t]||window["moz"+t]||window["ms"+t]}var X=0;function J(t){var e=+new Date,i=Math.max(0,16-(e-X));return X=e+i,window.setTimeout(t,i)}var $=window.requestAnimationFrame||Y("RequestAnimationFrame")||J,Q=window.cancelAnimationFrame||Y("CancelAnimationFrame")||Y("CancelRequestAnimationFrame")||function(t){window.clearTimeout(t)};function x(t,e,i){if(!i||$!==J)return $.call(window,a(t,e));t.call(e)}function r(t){t&&Q.call(window,t)}var tt={__proto__:null,extend:l,create:R,bind:a,get lastId(){return D},stamp:h,throttle:j,wrapNum:H,falseFn:u,formatNum:i,trim:W,splitWords:F,setOptions:c,getParamString:U,template:q,isArray:d,indexOf:G,emptyImageUrl:K,requestFn:$,cancelFn:Q,requestAnimFrame:x,cancelAnimFrame:r};function et(){}et.extend=function(t){function e(){c(this),this.initialize&&this.initialize.apply(this,arguments),this.callInitHooks()}var i,n=e.__super__=this.prototype,o=R(n);for(i in(o.constructor=e).prototype=o,this)Object.prototype.hasOwnProperty.call(this,i)&&"prototype"!==i&&"__super__"!==i&&(e[i]=this[i]);if(t.statics&&l(e,t.statics),t.includes){var s=t.includes;if("undefined"!=typeof L&&L&&L.Mixin){s=d(s)?s:[s];for(var r=0;r<s.length;r++)s[r]===L.Mixin.Events&&console.warn("Deprecated include of L.Mixin.Events: this property will be removed in future releases, please inherit from L.Evented instead.",(new Error).stack)}l.apply(null,[o].concat(t.includes))}return l(o,t),delete o.statics,delete o.includes,o.options&&(o.options=n.options?R(n.options):{},l(o.options,t.options)),o._initHooks=[],o.callInitHooks=function(){if(!this._initHooksCalled){n.callInitHooks&&n.callInitHooks.call(this),this._initHooksCalled=!0;for(var t=0,e=o._initHooks.length;t<e;t++)o._initHooks[t].call(this)}},e},et.include=function(t){var e=this.prototype.options;return l(this.prototype,t),t.options&&(this.prototype.options=e,this.mergeOptions(t.options)),this},et.mergeOptions=function(t){return l(this.prototype.options,t),this},et.addInitHook=function(t){var e=Array.prototype.slice.call(arguments,1),i="function"==typeof t?t:function(){this[t].apply(this,e)};return this.prototype._initHooks=this.prototype._initHooks||[],this.prototype._initHooks.push(i),this};var e={on:function(t,e,i){if("object"==typeof t)for(var n in t)this._on(n,t[n],e);else for(var o=0,s=(t=F(t)).length;o<s;o++)this._on(t[o],e,i);return this},off:function(t,e,i){if(arguments.length)if("object"==typeof t)for(var n in t)this._off(n,t[n],e);else{t=F(t);for(var o=1===arguments.length,s=0,r=t.length;s<r;s++)o?this._off(t[s]):this._off(t[s],e,i)}else delete this._events;return this},_on:function(t,e,i,n){"function"!=typeof e?console.warn("wrong listener type: "+typeof e):!1===this._listens(t,e,i)&&(e={fn:e,ctx:i=i===this?void 0:i},n&&(e.once=!0),this._events=this._events||{},this._events[t]=this._events[t]||[],this._events[t].push(e))},_off:function(t,e,i){var n,o,s;if(this._events&&(n=this._events[t]))if(1===arguments.length){if(this._firingCount)for(o=0,s=n.length;o<s;o++)n[o].fn=u;delete this._events[t]}else"function"!=typeof e?console.warn("wrong listener type: "+typeof e):!1!==(e=this._listens(t,e,i))&&(i=n[e],this._firingCount&&(i.fn=u,this._events[t]=n=n.slice()),n.splice(e,1))},fire:function(t,e,i){if(this.listens(t,i)){var n=l({},e,{type:t,target:this,sourceTarget:e&&e.sourceTarget||this});if(this._events){var o=this._events[t];if(o){this._firingCount=this._firingCount+1||1;for(var s=0,r=o.length;s<r;s++){var a=o[s],h=a.fn;a.once&&this.off(t,h,a.ctx),h.call(a.ctx||this,n)}this._firingCount--}}i&&this._propagateEvent(n)}return this},listens:function(t,e,i,n){"string"!=typeof t&&console.warn('"string" type argument expected');var o=e,s=("function"!=typeof e&&(n=!!e,i=o=void 0),this._events&&this._events[t]);if(s&&s.length&&!1!==this._listens(t,o,i))return!0;if(n)for(var r in this._eventParents)if(this._eventParents[r].listens(t,e,i,n))return!0;return!1},_listens:function(t,e,i){if(this._events){var n=this._events[t]||[];if(!e)return!!n.length;i===this&&(i=void 0);for(var o=0,s=n.length;o<s;o++)if(n[o].fn===e&&n[o].ctx===i)return o}return!1},once:function(t,e,i){if("object"==typeof t)for(var n in t)this._on(n,t[n],e,!0);else for(var o=0,s=(t=F(t)).length;o<s;o++)this._on(t[o],e,i,!0);return this},addEventParent:function(t){return this._eventParents=this._eventParents||{},this._eventParents[h(t)]=t,this},removeEventParent:function(t){return this._eventParents&&delete this._eventParents[h(t)],this},_propagateEvent:function(t){for(var e in this._eventParents)this._eventParents[e].fire(t.type,l({layer:t.target,propagatedFrom:t.target},t),!0)}},it=(e.addEventListener=e.on,e.removeEventListener=e.clearAllEventListeners=e.off,e.addOneTimeEventListener=e.once,e.fireEvent=e.fire,e.hasEventListeners=e.listens,et.extend(e));function p(t,e,i){this.x=i?Math.round(t):t,this.y=i?Math.round(e):e}var nt=Math.trunc||function(t){return 0<t?Math.floor(t):Math.ceil(t)};function m(t,e,i){return t instanceof p?t:d(t)?new p(t[0],t[1]):null==t?t:"object"==typeof t&&"x"in t&&"y"in t?new p(t.x,t.y):new p(t,e,i)}function f(t,e){if(t)for(var i=e?[t,e]:t,n=0,o=i.length;n<o;n++)this.extend(i[n])}function _(t,e){return!t||t instanceof f?t:new f(t,e)}function s(t,e){if(t)for(var i=e?[t,e]:t,n=0,o=i.length;n<o;n++)this.extend(i[n])}function g(t,e){return t instanceof s?t:new s(t,e)}function v(t,e,i){if(isNaN(t)||isNaN(e))throw new Error("Invalid LatLng object: ("+t+", "+e+")");this.lat=+t,this.lng=+e,void 0!==i&&(this.alt=+i)}function w(t,e,i){return t instanceof v?t:d(t)&&"object"!=typeof t[0]?3===t.length?new v(t[0],t[1],t[2]):2===t.length?new v(t[0],t[1]):null:null==t?t:"object"==typeof t&&"lat"in t?new v(t.lat,"lng"in t?t.lng:t.lon,t.alt):void 0===e?null:new v(t,e,i)}p.prototype={clone:function(){return new p(this.x,this.y)},add:function(t){return this.clone()._add(m(t))},_add:function(t){return this.x+=t.x,this.y+=t.y,this},subtract:function(t){return this.clone()._subtract(m(t))},_subtract:function(t){return this.x-=t.x,this.y-=t.y,this},divideBy:function(t){return this.clone()._divideBy(t)},_divideBy:function(t){return this.x/=t,this.y/=t,this},multiplyBy:function(t){return this.clone()._multiplyBy(t)},_multiplyBy:function(t){return this.x*=t,this.y*=t,this},scaleBy:function(t){return new p(this.x*t.x,this.y*t.y)},unscaleBy:function(t){return new p(this.x/t.x,this.y/t.y)},round:function(){return this.clone()._round()},_round:function(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this},floor:function(){return this.clone()._floor()},_floor:function(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this},ceil:function(){return this.clone()._ceil()},_ceil:function(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this},trunc:function(){return this.clone()._trunc()},_trunc:function(){return this.x=nt(this.x),this.y=nt(this.y),this},distanceTo:function(t){var e=(t=m(t)).x-this.x,t=t.y-this.y;return Math.sqrt(e*e+t*t)},equals:function(t){return(t=m(t)).x===this.x&&t.y===this.y},contains:function(t){return t=m(t),Math.abs(t.x)<=Math.abs(this.x)&&Math.abs(t.y)<=Math.abs(this.y)},toString:function(){return"Point("+i(this.x)+", "+i(this.y)+")"}},f.prototype={extend:function(t){var e,i;if(t){if(t instanceof p||"number"==typeof t[0]||"x"in t)e=i=m(t);else if(e=(t=_(t)).min,i=t.max,!e||!i)return this;this.min||this.max?(this.min.x=Math.min(e.x,this.min.x),this.max.x=Math.max(i.x,this.max.x),this.min.y=Math.min(e.y,this.min.y),this.max.y=Math.max(i.y,this.max.y)):(this.min=e.clone(),this.max=i.clone())}return this},getCenter:function(t){return m((this.min.x+this.max.x)/2,(this.min.y+this.max.y)/2,t)},getBottomLeft:function(){return m(this.min.x,this.max.y)},getTopRight:function(){return m(this.max.x,this.min.y)},getTopLeft:function(){return this.min},getBottomRight:function(){return this.max},getSize:function(){return this.max.subtract(this.min)},contains:function(t){var e,i;return(t=("number"==typeof t[0]||t instanceof p?m:_)(t))instanceof f?(e=t.min,i=t.max):e=i=t,e.x>=this.min.x&&i.x<=this.max.x&&e.y>=this.min.y&&i.y<=this.max.y},intersects:function(t){t=_(t);var e=this.min,i=this.max,n=t.min,t=t.max,o=t.x>=e.x&&n.x<=i.x,t=t.y>=e.y&&n.y<=i.y;return o&&t},overlaps:function(t){t=_(t);var e=this.min,i=this.max,n=t.min,t=t.max,o=t.x>e.x&&n.x<i.x,t=t.y>e.y&&n.y<i.y;return o&&t},isValid:function(){return!(!this.min||!this.max)},pad:function(t){var e=this.min,i=this.max,n=Math.abs(e.x-i.x)*t,t=Math.abs(e.y-i.y)*t;return _(m(e.x-n,e.y-t),m(i.x+n,i.y+t))},equals:function(t){return!!t&&(t=_(t),this.min.equals(t.getTopLeft())&&this.max.equals(t.getBottomRight()))}},s.prototype={extend:function(t){var e,i,n=this._southWest,o=this._northEast;if(t instanceof v)i=e=t;else{if(!(t instanceof s))return t?this.extend(w(t)||g(t)):this;if(e=t._southWest,i=t._northEast,!e||!i)return this}return n||o?(n.lat=Math.min(e.lat,n.lat),n.lng=Math.min(e.lng,n.lng),o.lat=Math.max(i.lat,o.lat),o.lng=Math.max(i.lng,o.lng)):(this._southWest=new v(e.lat,e.lng),this._northEast=new v(i.lat,i.lng)),this},pad:function(t){var e=this._southWest,i=this._northEast,n=Math.abs(e.lat-i.lat)*t,t=Math.abs(e.lng-i.lng)*t;return new s(new v(e.lat-n,e.lng-t),new v(i.lat+n,i.lng+t))},getCenter:function(){return new v((this._southWest.lat+this._northEast.lat)/2,(this._southWest.lng+this._northEast.lng)/2)},getSouthWest:function(){return this._southWest},getNorthEast:function(){return this._northEast},getNorthWest:function(){return new v(this.getNorth(),this.getWest())},getSouthEast:function(){return new v(this.getSouth(),this.getEast())},getWest:function(){return this._southWest.lng},getSouth:function(){return this._southWest.lat},getEast:function(){return this._northEast.lng},getNorth:function(){return this._northEast.lat},contains:function(t){t=("number"==typeof t[0]||t instanceof v||"lat"in t?w:g)(t);var e,i,n=this._southWest,o=this._northEast;return t instanceof s?(e=t.getSouthWest(),i=t.getNorthEast()):e=i=t,e.lat>=n.lat&&i.lat<=o.lat&&e.lng>=n.lng&&i.lng<=o.lng},intersects:function(t){t=g(t);var e=this._southWest,i=this._northEast,n=t.getSouthWest(),t=t.getNorthEast(),o=t.lat>=e.lat&&n.lat<=i.lat,t=t.lng>=e.lng&&n.lng<=i.lng;return o&&t},overlaps:function(t){t=g(t);var e=this._southWest,i=this._northEast,n=t.getSouthWest(),t=t.getNorthEast(),o=t.lat>e.lat&&n.lat<i.lat,t=t.lng>e.lng&&n.lng<i.lng;return o&&t},toBBoxString:function(){return[this.getWest(),this.getSouth(),this.getEast(),this.getNorth()].join(",")},equals:function(t,e){return!!t&&(t=g(t),this._southWest.equals(t.getSouthWest(),e)&&this._northEast.equals(t.getNorthEast(),e))},isValid:function(){return!(!this._southWest||!this._northEast)}};var ot={latLngToPoint:function(t,e){t=this.projection.project(t),e=this.scale(e);return this.transformation._transform(t,e)},pointToLatLng:function(t,e){e=this.scale(e),t=this.transformation.untransform(t,e);return this.projection.unproject(t)},project:function(t){return this.projection.project(t)},unproject:function(t){return this.projection.unproject(t)},scale:function(t){return 256*Math.pow(2,t)},zoom:function(t){return Math.log(t/256)/Math.LN2},getProjectedBounds:function(t){var e;return this.infinite?null:(e=this.projection.bounds,t=this.scale(t),new f(this.transformation.transform(e.min,t),this.transformation.transform(e.max,t)))},infinite:!(v.prototype={equals:function(t,e){return!!t&&(t=w(t),Math.max(Math.abs(this.lat-t.lat),Math.abs(this.lng-t.lng))<=(void 0===e?1e-9:e))},toString:function(t){return"LatLng("+i(this.lat,t)+", "+i(this.lng,t)+")"},distanceTo:function(t){return st.distance(this,w(t))},wrap:function(){return st.wrapLatLng(this)},toBounds:function(t){var t=180*t/40075017,e=t/Math.cos(Math.PI/180*this.lat);return g([this.lat-t,this.lng-e],[this.lat+t,this.lng+e])},clone:function(){return new v(this.lat,this.lng,this.alt)}}),wrapLatLng:function(t){var e=this.wrapLng?H(t.lng,this.wrapLng,!0):t.lng;return new v(this.wrapLat?H(t.lat,this.wrapLat,!0):t.lat,e,t.alt)},wrapLatLngBounds:function(t){var e=t.getCenter(),i=this.wrapLatLng(e),n=e.lat-i.lat,e=e.lng-i.lng;return 0==n&&0==e?t:(i=t.getSouthWest(),t=t.getNorthEast(),new s(new v(i.lat-n,i.lng-e),new v(t.lat-n,t.lng-e)))}},st=l({},ot,{wrapLng:[-180,180],R:6371e3,distance:function(t,e){var i=Math.PI/180,n=t.lat*i,o=e.lat*i,s=Math.sin((e.lat-t.lat)*i/2),e=Math.sin((e.lng-t.lng)*i/2),t=s*s+Math.cos(n)*Math.cos(o)*e*e,i=2*Math.atan2(Math.sqrt(t),Math.sqrt(1-t));return this.R*i}}),rt=6378137,rt={R:rt,MAX_LATITUDE:85.0511287798,project:function(t){var e=Math.PI/180,i=this.MAX_LATITUDE,i=Math.max(Math.min(i,t.lat),-i),i=Math.sin(i*e);return new p(this.R*t.lng*e,this.R*Math.log((1+i)/(1-i))/2)},unproject:function(t){var e=180/Math.PI;return new v((2*Math.atan(Math.exp(t.y/this.R))-Math.PI/2)*e,t.x*e/this.R)},bounds:new f([-(rt=rt*Math.PI),-rt],[rt,rt])};function at(t,e,i,n){d(t)?(this._a=t[0],this._b=t[1],this._c=t[2],this._d=t[3]):(this._a=t,this._b=e,this._c=i,this._d=n)}function ht(t,e,i,n){return new at(t,e,i,n)}at.prototype={transform:function(t,e){return this._transform(t.clone(),e)},_transform:function(t,e){return t.x=(e=e||1)*(this._a*t.x+this._b),t.y=e*(this._c*t.y+this._d),t},untransform:function(t,e){return new p((t.x/(e=e||1)-this._b)/this._a,(t.y/e-this._d)/this._c)}};var lt=l({},st,{code:"EPSG:3857",projection:rt,transformation:ht(lt=.5/(Math.PI*rt.R),.5,-lt,.5)}),ut=l({},lt,{code:"EPSG:900913"});function ct(t){return document.createElementNS("http://www.w3.org/2000/svg",t)}function dt(t,e){for(var i,n,o,s,r="",a=0,h=t.length;a<h;a++){for(i=0,n=(o=t[a]).length;i<n;i++)r+=(i?"L":"M")+(s=o[i]).x+" "+s.y;r+=e?b.svg?"z":"x":""}return r||"M0 0"}var _t=document.documentElement.style,pt="ActiveXObject"in window,mt=pt&&!document.addEventListener,n="msLaunchUri"in navigator&&!("documentMode"in document),ft=y("webkit"),gt=y("android"),vt=y("android 2")||y("android 3"),yt=parseInt(/WebKit\/([0-9]+)|$/.exec(navigator.userAgent)[1],10),yt=gt&&y("Google")&&yt<537&&!("AudioNode"in window),xt=!!window.opera,wt=!n&&y("chrome"),bt=y("gecko")&&!ft&&!xt&&!pt,Pt=!wt&&y("safari"),Lt=y("phantom"),o="OTransition"in _t,Tt=0===navigator.platform.indexOf("Win"),Mt=pt&&"transition"in _t,zt="WebKitCSSMatrix"in window&&"m11"in new window.WebKitCSSMatrix&&!vt,_t="MozPerspective"in _t,Ct=!window.L_DISABLE_3D&&(Mt||zt||_t)&&!o&&!Lt,Zt="undefined"!=typeof orientation||y("mobile"),St=Zt&&ft,Et=Zt&&zt,kt=!window.PointerEvent&&window.MSPointerEvent,Ot=!(!window.PointerEvent&&!kt),At="ontouchstart"in window||!!window.TouchEvent,Bt=!window.L_NO_TOUCH&&(At||Ot),It=Zt&&xt,Rt=Zt&&bt,Nt=1<(window.devicePixelRatio||window.screen.deviceXDPI/window.screen.logicalXDPI),Dt=function(){var t=!1;try{var e=Object.defineProperty({},"passive",{get:function(){t=!0}});window.addEventListener("testPassiveEventSupport",u,e),window.removeEventListener("testPassiveEventSupport",u,e)}catch(t){}return t}(),jt=!!document.createElement("canvas").getContext,Ht=!(!document.createElementNS||!ct("svg").createSVGRect),Wt=!!Ht&&((Wt=document.createElement("div")).innerHTML="<svg/>","http://www.w3.org/2000/svg"===(Wt.firstChild&&Wt.firstChild.namespaceURI));function y(t){return 0<=navigator.userAgent.toLowerCase().indexOf(t)}var b={ie:pt,ielt9:mt,edge:n,webkit:ft,android:gt,android23:vt,androidStock:yt,opera:xt,chrome:wt,gecko:bt,safari:Pt,phantom:Lt,opera12:o,win:Tt,ie3d:Mt,webkit3d:zt,gecko3d:_t,any3d:Ct,mobile:Zt,mobileWebkit:St,mobileWebkit3d:Et,msPointer:kt,pointer:Ot,touch:Bt,touchNative:At,mobileOpera:It,mobileGecko:Rt,retina:Nt,passiveEvents:Dt,canvas:jt,svg:Ht,vml:!Ht&&function(){try{var t=document.createElement("div"),e=(t.innerHTML='<v:shape adj="1"/>',t.firstChild);return e.style.behavior="url(#default#VML)",e&&"object"==typeof e.adj}catch(t){return!1}}(),inlineSvg:Wt,mac:0===navigator.platform.indexOf("Mac"),linux:0===navigator.platform.indexOf("Linux")},Ft=b.msPointer?"MSPointerDown":"pointerdown",Ut=b.msPointer?"MSPointerMove":"pointermove",Vt=b.msPointer?"MSPointerUp":"pointerup",qt=b.msPointer?"MSPointerCancel":"pointercancel",Gt={touchstart:Ft,touchmove:Ut,touchend:Vt,touchcancel:qt},Kt={touchstart:function(t,e){e.MSPOINTER_TYPE_TOUCH&&e.pointerType===e.MSPOINTER_TYPE_TOUCH&&O(e);ee(t,e)},touchmove:ee,touchend:ee,touchcancel:ee},Yt={},Xt=!1;function Jt(t,e,i){return"touchstart"!==e||Xt||(document.addEventListener(Ft,$t,!0),document.addEventListener(Ut,Qt,!0),document.addEventListener(Vt,te,!0),document.addEventListener(qt,te,!0),Xt=!0),Kt[e]?(i=Kt[e].bind(this,i),t.addEventListener(Gt[e],i,!1),i):(console.warn("wrong event specified:",e),u)}function $t(t){Yt[t.pointerId]=t}function Qt(t){Yt[t.pointerId]&&(Yt[t.pointerId]=t)}function te(t){delete Yt[t.pointerId]}function ee(t,e){if(e.pointerType!==(e.MSPOINTER_TYPE_MOUSE||"mouse")){for(var i in e.touches=[],Yt)e.touches.push(Yt[i]);e.changedTouches=[e],t(e)}}var ie=200;function ne(t,i){t.addEventListener("dblclick",i);var n,o=0;function e(t){var e;1!==t.detail?n=t.detail:"mouse"===t.pointerType||t.sourceCapabilities&&!t.sourceCapabilities.firesTouchEvents||((e=Ne(t)).some(function(t){return t instanceof HTMLLabelElement&&t.attributes.for})&&!e.some(function(t){return t instanceof HTMLInputElement||t instanceof HTMLSelectElement})||((e=Date.now())-o<=ie?2===++n&&i(function(t){var e,i,n={};for(i in t)e=t[i],n[i]=e&&e.bind?e.bind(t):e;return(t=n).type="dblclick",n.detail=2,n.isTrusted=!1,n._simulated=!0,n}(t)):n=1,o=e))}return t.addEventListener("click",e),{dblclick:i,simDblclick:e}}var oe,se,re,ae,he,le,ue=we(["transform","webkitTransform","OTransform","MozTransform","msTransform"]),ce=we(["webkitTransition","transition","OTransition","MozTransition","msTransition"]),de="webkitTransition"===ce||"OTransition"===ce?ce+"End":"transitionend";function _e(t){return"string"==typeof t?document.getElementById(t):t}function pe(t,e){var i=t.style[e]||t.currentStyle&&t.currentStyle[e];return"auto"===(i=i&&"auto"!==i||!document.defaultView?i:(t=document.defaultView.getComputedStyle(t,null))?t[e]:null)?null:i}function P(t,e,i){t=document.createElement(t);return t.className=e||"",i&&i.appendChild(t),t}function T(t){var e=t.parentNode;e&&e.removeChild(t)}function me(t){for(;t.firstChild;)t.removeChild(t.firstChild)}function fe(t){var e=t.parentNode;e&&e.lastChild!==t&&e.appendChild(t)}function ge(t){var e=t.parentNode;e&&e.firstChild!==t&&e.insertBefore(t,e.firstChild)}function ve(t,e){return void 0!==t.classList?t.classList.contains(e):0<(t=xe(t)).length&&new RegExp("(^|\\s)"+e+"(\\s|$)").test(t)}function M(t,e){var i;if(void 0!==t.classList)for(var n=F(e),o=0,s=n.length;o<s;o++)t.classList.add(n[o]);else ve(t,e)||ye(t,((i=xe(t))?i+" ":"")+e)}function z(t,e){void 0!==t.classList?t.classList.remove(e):ye(t,W((" "+xe(t)+" ").replace(" "+e+" "," ")))}function ye(t,e){void 0===t.className.baseVal?t.className=e:t.className.baseVal=e}function xe(t){return void 0===(t=t.correspondingElement?t.correspondingElement:t).className.baseVal?t.className:t.className.baseVal}function C(t,e){if("opacity"in t.style)t.style.opacity=e;else if("filter"in t.style){var i=!1,n="DXImageTransform.Microsoft.Alpha";try{i=t.filters.item(n)}catch(t){if(1===e)return}e=Math.round(100*e),i?(i.Enabled=100!==e,i.Opacity=e):t.style.filter+=" progid:"+n+"(opacity="+e+")"}}function we(t){for(var e=document.documentElement.style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return!1}function be(t,e,i){e=e||new p(0,0);t.style[ue]=(b.ie3d?"translate("+e.x+"px,"+e.y+"px)":"translate3d("+e.x+"px,"+e.y+"px,0)")+(i?" scale("+i+")":"")}function Z(t,e){t._leaflet_pos=e,b.any3d?be(t,e):(t.style.left=e.x+"px",t.style.top=e.y+"px")}function Pe(t){return t._leaflet_pos||new p(0,0)}function Le(){S(window,"dragstart",O)}function Te(){k(window,"dragstart",O)}function Me(t){for(;-1===t.tabIndex;)t=t.parentNode;t.style&&(ze(),le=(he=t).style.outlineStyle,t.style.outlineStyle="none",S(window,"keydown",ze))}function ze(){he&&(he.style.outlineStyle=le,le=he=void 0,k(window,"keydown",ze))}function Ce(t){for(;!((t=t.parentNode).offsetWidth&&t.offsetHeight||t===document.body););return t}function Ze(t){var e=t.getBoundingClientRect();return{x:e.width/t.offsetWidth||1,y:e.height/t.offsetHeight||1,boundingClientRect:e}}ae="onselectstart"in document?(re=function(){S(window,"selectstart",O)},function(){k(window,"selectstart",O)}):(se=we(["userSelect","WebkitUserSelect","OUserSelect","MozUserSelect","msUserSelect"]),re=function(){var t;se&&(t=document.documentElement.style,oe=t[se],t[se]="none")},function(){se&&(document.documentElement.style[se]=oe,oe=void 0)});pt={__proto__:null,TRANSFORM:ue,TRANSITION:ce,TRANSITION_END:de,get:_e,getStyle:pe,create:P,remove:T,empty:me,toFront:fe,toBack:ge,hasClass:ve,addClass:M,removeClass:z,setClass:ye,getClass:xe,setOpacity:C,testProp:we,setTransform:be,setPosition:Z,getPosition:Pe,get disableTextSelection(){return re},get enableTextSelection(){return ae},disableImageDrag:Le,enableImageDrag:Te,preventOutline:Me,restoreOutline:ze,getSizedParentNode:Ce,getScale:Ze};function S(t,e,i,n){if(e&&"object"==typeof e)for(var o in e)ke(t,o,e[o],i);else for(var s=0,r=(e=F(e)).length;s<r;s++)ke(t,e[s],i,n);return this}var E="_leaflet_events";function k(t,e,i,n){if(1===arguments.length)Se(t),delete t[E];else if(e&&"object"==typeof e)for(var o in e)Oe(t,o,e[o],i);else if(e=F(e),2===arguments.length)Se(t,function(t){return-1!==G(e,t)});else for(var s=0,r=e.length;s<r;s++)Oe(t,e[s],i,n);return this}function Se(t,e){for(var i in t[E]){var n=i.split(/\d/)[0];e&&!e(n)||Oe(t,n,null,null,i)}}var Ee={mouseenter:"mouseover",mouseleave:"mouseout",wheel:!("onwheel"in window)&&"mousewheel"};function ke(e,t,i,n){var o,s,r=t+h(i)+(n?"_"+h(n):"");e[E]&&e[E][r]||(s=o=function(t){return i.call(n||e,t||window.event)},!b.touchNative&&b.pointer&&0===t.indexOf("touch")?o=Jt(e,t,o):b.touch&&"dblclick"===t?o=ne(e,o):"addEventListener"in e?"touchstart"===t||"touchmove"===t||"wheel"===t||"mousewheel"===t?e.addEventListener(Ee[t]||t,o,!!b.passiveEvents&&{passive:!1}):"mouseenter"===t||"mouseleave"===t?e.addEventListener(Ee[t],o=function(t){t=t||window.event,We(e,t)&&s(t)},!1):e.addEventListener(t,s,!1):e.attachEvent("on"+t,o),e[E]=e[E]||{},e[E][r]=o)}function Oe(t,e,i,n,o){o=o||e+h(i)+(n?"_"+h(n):"");var s,r,i=t[E]&&t[E][o];i&&(!b.touchNative&&b.pointer&&0===e.indexOf("touch")?(n=t,r=i,Gt[s=e]?n.removeEventListener(Gt[s],r,!1):console.warn("wrong event specified:",s)):b.touch&&"dblclick"===e?(n=i,(r=t).removeEventListener("dblclick",n.dblclick),r.removeEventListener("click",n.simDblclick)):"removeEventListener"in t?t.removeEventListener(Ee[e]||e,i,!1):t.detachEvent("on"+e,i),t[E][o]=null)}function Ae(t){return t.stopPropagation?t.stopPropagation():t.originalEvent?t.originalEvent._stopped=!0:t.cancelBubble=!0,this}function Be(t){return ke(t,"wheel",Ae),this}function Ie(t){return S(t,"mousedown touchstart dblclick contextmenu",Ae),t._leaflet_disable_click=!0,this}function O(t){return t.preventDefault?t.preventDefault():t.returnValue=!1,this}function Re(t){return O(t),Ae(t),this}function Ne(t){if(t.composedPath)return t.composedPath();for(var e=[],i=t.target;i;)e.push(i),i=i.parentNode;return e}function De(t,e){var i,n;return e?(n=(i=Ze(e)).boundingClientRect,new p((t.clientX-n.left)/i.x-e.clientLeft,(t.clientY-n.top)/i.y-e.clientTop)):new p(t.clientX,t.clientY)}var je=b.linux&&b.chrome?window.devicePixelRatio:b.mac?3*window.devicePixelRatio:0<window.devicePixelRatio?2*window.devicePixelRatio:1;function He(t){return b.edge?t.wheelDeltaY/2:t.deltaY&&0===t.deltaMode?-t.deltaY/je:t.deltaY&&1===t.deltaMode?20*-t.deltaY:t.deltaY&&2===t.deltaMode?60*-t.deltaY:t.deltaX||t.deltaZ?0:t.wheelDelta?(t.wheelDeltaY||t.wheelDelta)/2:t.detail&&Math.abs(t.detail)<32765?20*-t.detail:t.detail?t.detail/-32765*60:0}function We(t,e){var i=e.relatedTarget;if(!i)return!0;try{for(;i&&i!==t;)i=i.parentNode}catch(t){return!1}return i!==t}var mt={__proto__:null,on:S,off:k,stopPropagation:Ae,disableScrollPropagation:Be,disableClickPropagation:Ie,preventDefault:O,stop:Re,getPropagationPath:Ne,getMousePosition:De,getWheelDelta:He,isExternalTarget:We,addListener:S,removeListener:k},Fe=it.extend({run:function(t,e,i,n){this.stop(),this._el=t,this._inProgress=!0,this._duration=i||.25,this._easeOutPower=1/Math.max(n||.5,.2),this._startPos=Pe(t),this._offset=e.subtract(this._startPos),this._startTime=+new Date,this.fire("start"),this._animate()},stop:function(){this._inProgress&&(this._step(!0),this._complete())},_animate:function(){this._animId=x(this._animate,this),this._step()},_step:function(t){var e=+new Date-this._startTime,i=1e3*this._duration;e<i?this._runFrame(this._easeOut(e/i),t):(this._runFrame(1),this._complete())},_runFrame:function(t,e){t=this._startPos.add(this._offset.multiplyBy(t));e&&t._round(),Z(this._el,t),this.fire("step")},_complete:function(){r(this._animId),this._inProgress=!1,this.fire("end")},_easeOut:function(t){return 1-Math.pow(1-t,this._easeOutPower)}}),A=it.extend({options:{crs:lt,center:void 0,zoom:void 0,minZoom:void 0,maxZoom:void 0,layers:[],maxBounds:void 0,renderer:void 0,zoomAnimation:!0,zoomAnimationThreshold:4,fadeAnimation:!0,markerZoomAnimation:!0,transform3DLimit:8388608,zoomSnap:1,zoomDelta:1,trackResize:!0},initialize:function(t,e){e=c(this,e),this._handlers=[],this._layers={},this._zoomBoundLayers={},this._sizeChanged=!0,this._initContainer(t),this._initLayout(),this._onResize=a(this._onResize,this),this._initEvents(),e.maxBounds&&this.setMaxBounds(e.maxBounds),void 0!==e.zoom&&(this._zoom=this._limitZoom(e.zoom)),e.center&&void 0!==e.zoom&&this.setView(w(e.center),e.zoom,{reset:!0}),this.callInitHooks(),this._zoomAnimated=ce&&b.any3d&&!b.mobileOpera&&this.options.zoomAnimation,this._zoomAnimated&&(this._createAnimProxy(),S(this._proxy,de,this._catchTransitionEnd,this)),this._addLayers(this.options.layers)},setView:function(t,e,i){if((e=void 0===e?this._zoom:this._limitZoom(e),t=this._limitCenter(w(t),e,this.options.maxBounds),i=i||{},this._stop(),this._loaded&&!i.reset&&!0!==i)&&(void 0!==i.animate&&(i.zoom=l({animate:i.animate},i.zoom),i.pan=l({animate:i.animate,duration:i.duration},i.pan)),this._zoom!==e?this._tryAnimatedZoom&&this._tryAnimatedZoom(t,e,i.zoom):this._tryAnimatedPan(t,i.pan)))return clearTimeout(this._sizeTimer),this;return this._resetView(t,e,i.pan&&i.pan.noMoveStart),this},setZoom:function(t,e){return this._loaded?this.setView(this.getCenter(),t,{zoom:e}):(this._zoom=t,this)},zoomIn:function(t,e){return t=t||(b.any3d?this.options.zoomDelta:1),this.setZoom(this._zoom+t,e)},zoomOut:function(t,e){return t=t||(b.any3d?this.options.zoomDelta:1),this.setZoom(this._zoom-t,e)},setZoomAround:function(t,e,i){var n=this.getZoomScale(e),o=this.getSize().divideBy(2),t=(t instanceof p?t:this.latLngToContainerPoint(t)).subtract(o).multiplyBy(1-1/n),n=this.containerPointToLatLng(o.add(t));return this.setView(n,e,{zoom:i})},_getBoundsCenterZoom:function(t,e){e=e||{},t=t.getBounds?t.getBounds():g(t);var i=m(e.paddingTopLeft||e.padding||[0,0]),n=m(e.paddingBottomRight||e.padding||[0,0]),o=this.getBoundsZoom(t,!1,i.add(n));return(o="number"==typeof e.maxZoom?Math.min(e.maxZoom,o):o)===1/0?{center:t.getCenter(),zoom:o}:(e=n.subtract(i).divideBy(2),n=this.project(t.getSouthWest(),o),i=this.project(t.getNorthEast(),o),{center:this.unproject(n.add(i).divideBy(2).add(e),o),zoom:o})},fitBounds:function(t,e){if((t=g(t)).isValid())return t=this._getBoundsCenterZoom(t,e),this.setView(t.center,t.zoom,e);throw new Error("Bounds are not valid.")},fitWorld:function(t){return this.fitBounds([[-90,-180],[90,180]],t)},panTo:function(t,e){return this.setView(t,this._zoom,{pan:e})},panBy:function(t,e){var i;return e=e||{},(t=m(t).round()).x||t.y?(!0===e.animate||this.getSize().contains(t)?(this._panAnim||(this._panAnim=new Fe,this._panAnim.on({step:this._onPanTransitionStep,end:this._onPanTransitionEnd},this)),e.noMoveStart||this.fire("movestart"),!1!==e.animate?(M(this._mapPane,"leaflet-pan-anim"),i=this._getMapPanePos().subtract(t).round(),this._panAnim.run(this._mapPane,i,e.duration||.25,e.easeLinearity)):(this._rawPanBy(t),this.fire("move").fire("moveend"))):this._resetView(this.unproject(this.project(this.getCenter()).add(t)),this.getZoom()),this):this.fire("moveend")},flyTo:function(n,o,t){if(!1===(t=t||{}).animate||!b.any3d)return this.setView(n,o,t);this._stop();var s=this.project(this.getCenter()),r=this.project(n),e=this.getSize(),a=this._zoom,h=(n=w(n),o=void 0===o?a:o,Math.max(e.x,e.y)),i=h*this.getZoomScale(a,o),l=r.distanceTo(s)||1,u=1.42,c=u*u;function d(t){t=(i*i-h*h+(t?-1:1)*c*c*l*l)/(2*(t?i:h)*c*l),t=Math.sqrt(t*t+1)-t;return t<1e-9?-18:Math.log(t)}function _(t){return(Math.exp(t)-Math.exp(-t))/2}function p(t){return(Math.exp(t)+Math.exp(-t))/2}var m=d(0);function f(t){return h*(p(m)*(_(t=m+u*t)/p(t))-_(m))/c}var g=Date.now(),v=(d(1)-m)/u,y=t.duration?1e3*t.duration:1e3*v*.8;return this._moveStart(!0,t.noMoveStart),function t(){var e=(Date.now()-g)/y,i=(1-Math.pow(1-e,1.5))*v;e<=1?(this._flyToFrame=x(t,this),this._move(this.unproject(s.add(r.subtract(s).multiplyBy(f(i)/l)),a),this.getScaleZoom(h/(e=i,h*(p(m)/p(m+u*e))),a),{flyTo:!0})):this._move(n,o)._moveEnd(!0)}.call(this),this},flyToBounds:function(t,e){t=this._getBoundsCenterZoom(t,e);return this.flyTo(t.center,t.zoom,e)},setMaxBounds:function(t){return t=g(t),this.listens("moveend",this._panInsideMaxBounds)&&this.off("moveend",this._panInsideMaxBounds),t.isValid()?(this.options.maxBounds=t,this._loaded&&this._panInsideMaxBounds(),this.on("moveend",this._panInsideMaxBounds)):(this.options.maxBounds=null,this)},setMinZoom:function(t){var e=this.options.minZoom;return this.options.minZoom=t,this._loaded&&e!==t&&(this.fire("zoomlevelschange"),this.getZoom()<this.options.minZoom)?this.setZoom(t):this},setMaxZoom:function(t){var e=this.options.maxZoom;return this.options.maxZoom=t,this._loaded&&e!==t&&(this.fire("zoomlevelschange"),this.getZoom()>this.options.maxZoom)?this.setZoom(t):this},panInsideBounds:function(t,e){this._enforcingBounds=!0;var i=this.getCenter(),t=this._limitCenter(i,this._zoom,g(t));return i.equals(t)||this.panTo(t,e),this._enforcingBounds=!1,this},panInside:function(t,e){var i=m((e=e||{}).paddingTopLeft||e.padding||[0,0]),n=m(e.paddingBottomRight||e.padding||[0,0]),o=this.project(this.getCenter()),t=this.project(t),s=this.getPixelBounds(),i=_([s.min.add(i),s.max.subtract(n)]),s=i.getSize();return i.contains(t)||(this._enforcingBounds=!0,n=t.subtract(i.getCenter()),i=i.extend(t).getSize().subtract(s),o.x+=n.x<0?-i.x:i.x,o.y+=n.y<0?-i.y:i.y,this.panTo(this.unproject(o),e),this._enforcingBounds=!1),this},invalidateSize:function(t){if(!this._loaded)return this;t=l({animate:!1,pan:!0},!0===t?{animate:!0}:t);var e=this.getSize(),i=(this._sizeChanged=!0,this._lastCenter=null,this.getSize()),n=e.divideBy(2).round(),o=i.divideBy(2).round(),n=n.subtract(o);return n.x||n.y?(t.animate&&t.pan?this.panBy(n):(t.pan&&this._rawPanBy(n),this.fire("move"),t.debounceMoveend?(clearTimeout(this._sizeTimer),this._sizeTimer=setTimeout(a(this.fire,this,"moveend"),200)):this.fire("moveend")),this.fire("resize",{oldSize:e,newSize:i})):this},stop:function(){return this.setZoom(this._limitZoom(this._zoom)),this.options.zoomSnap||this.fire("viewreset"),this._stop()},locate:function(t){var e,i;return t=this._locateOptions=l({timeout:1e4,watch:!1},t),"geolocation"in navigator?(e=a(this._handleGeolocationResponse,this),i=a(this._handleGeolocationError,this),t.watch?this._locationWatchId=navigator.geolocation.watchPosition(e,i,t):navigator.geolocation.getCurrentPosition(e,i,t)):this._handleGeolocationError({code:0,message:"Geolocation not supported."}),this},stopLocate:function(){return navigator.geolocation&&navigator.geolocation.clearWatch&&navigator.geolocation.clearWatch(this._locationWatchId),this._locateOptions&&(this._locateOptions.setView=!1),this},_handleGeolocationError:function(t){var e;this._container._leaflet_id&&(e=t.code,t=t.message||(1===e?"permission denied":2===e?"position unavailable":"timeout"),this._locateOptions.setView&&!this._loaded&&this.fitWorld(),this.fire("locationerror",{code:e,message:"Geolocation error: "+t+"."}))},_handleGeolocationResponse:function(t){if(this._container._leaflet_id){var e,i,n=new v(t.coords.latitude,t.coords.longitude),o=n.toBounds(2*t.coords.accuracy),s=this._locateOptions,r=(s.setView&&(e=this.getBoundsZoom(o),this.setView(n,s.maxZoom?Math.min(e,s.maxZoom):e)),{latlng:n,bounds:o,timestamp:t.timestamp});for(i in t.coords)"number"==typeof t.coords[i]&&(r[i]=t.coords[i]);this.fire("locationfound",r)}},addHandler:function(t,e){return e&&(e=this[t]=new e(this),this._handlers.push(e),this.options[t]&&e.enable()),this},remove:function(){if(this._initEvents(!0),this.options.maxBounds&&this.off("moveend",this._panInsideMaxBounds),this._containerId!==this._container._leaflet_id)throw new Error("Map container is being reused by another instance");try{delete this._container._leaflet_id,delete this._containerId}catch(t){this._container._leaflet_id=void 0,this._containerId=void 0}for(var t in void 0!==this._locationWatchId&&this.stopLocate(),this._stop(),T(this._mapPane),this._clearControlPos&&this._clearControlPos(),this._resizeRequest&&(r(this._resizeRequest),this._resizeRequest=null),this._clearHandlers(),this._loaded&&this.fire("unload"),this._layers)this._layers[t].remove();for(t in this._panes)T(this._panes[t]);return this._layers=[],this._panes=[],delete this._mapPane,delete this._renderer,this},createPane:function(t,e){e=P("div","leaflet-pane"+(t?" leaflet-"+t.replace("Pane","")+"-pane":""),e||this._mapPane);return t&&(this._panes[t]=e),e},getCenter:function(){return this._checkIfLoaded(),this._lastCenter&&!this._moved()?this._lastCenter.clone():this.layerPointToLatLng(this._getCenterLayerPoint())},getZoom:function(){return this._zoom},getBounds:function(){var t=this.getPixelBounds();return new s(this.unproject(t.getBottomLeft()),this.unproject(t.getTopRight()))},getMinZoom:function(){return void 0===this.options.minZoom?this._layersMinZoom||0:this.options.minZoom},getMaxZoom:function(){return void 0===this.options.maxZoom?void 0===this._layersMaxZoom?1/0:this._layersMaxZoom:this.options.maxZoom},getBoundsZoom:function(t,e,i){t=g(t),i=m(i||[0,0]);var n=this.getZoom()||0,o=this.getMinZoom(),s=this.getMaxZoom(),r=t.getNorthWest(),t=t.getSouthEast(),i=this.getSize().subtract(i),t=_(this.project(t,n),this.project(r,n)).getSize(),r=b.any3d?this.options.zoomSnap:1,a=i.x/t.x,i=i.y/t.y,t=e?Math.max(a,i):Math.min(a,i),n=this.getScaleZoom(t,n);return r&&(n=Math.round(n/(r/100))*(r/100),n=e?Math.ceil(n/r)*r:Math.floor(n/r)*r),Math.max(o,Math.min(s,n))},getSize:function(){return this._size&&!this._sizeChanged||(this._size=new p(this._container.clientWidth||0,this._container.clientHeight||0),this._sizeChanged=!1),this._size.clone()},getPixelBounds:function(t,e){t=this._getTopLeftPoint(t,e);return new f(t,t.add(this.getSize()))},getPixelOrigin:function(){return this._checkIfLoaded(),this._pixelOrigin},getPixelWorldBounds:function(t){return this.options.crs.getProjectedBounds(void 0===t?this.getZoom():t)},getPane:function(t){return"string"==typeof t?this._panes[t]:t},getPanes:function(){return this._panes},getContainer:function(){return this._container},getZoomScale:function(t,e){var i=this.options.crs;return e=void 0===e?this._zoom:e,i.scale(t)/i.scale(e)},getScaleZoom:function(t,e){var i=this.options.crs,t=(e=void 0===e?this._zoom:e,i.zoom(t*i.scale(e)));return isNaN(t)?1/0:t},project:function(t,e){return e=void 0===e?this._zoom:e,this.options.crs.latLngToPoint(w(t),e)},unproject:function(t,e){return e=void 0===e?this._zoom:e,this.options.crs.pointToLatLng(m(t),e)},layerPointToLatLng:function(t){t=m(t).add(this.getPixelOrigin());return this.unproject(t)},latLngToLayerPoint:function(t){return this.project(w(t))._round()._subtract(this.getPixelOrigin())},wrapLatLng:function(t){return this.options.crs.wrapLatLng(w(t))},wrapLatLngBounds:function(t){return this.options.crs.wrapLatLngBounds(g(t))},distance:function(t,e){return this.options.crs.distance(w(t),w(e))},containerPointToLayerPoint:function(t){return m(t).subtract(this._getMapPanePos())},layerPointToContainerPoint:function(t){return m(t).add(this._getMapPanePos())},containerPointToLatLng:function(t){t=this.containerPointToLayerPoint(m(t));return this.layerPointToLatLng(t)},latLngToContainerPoint:function(t){return this.layerPointToContainerPoint(this.latLngToLayerPoint(w(t)))},mouseEventToContainerPoint:function(t){return De(t,this._container)},mouseEventToLayerPoint:function(t){return this.containerPointToLayerPoint(this.mouseEventToContainerPoint(t))},mouseEventToLatLng:function(t){return this.layerPointToLatLng(this.mouseEventToLayerPoint(t))},_initContainer:function(t){t=this._container=_e(t);if(!t)throw new Error("Map container not found.");if(t._leaflet_id)throw new Error("Map container is already initialized.");S(t,"scroll",this._onScroll,this),this._containerId=h(t)},_initLayout:function(){var t=this._container,e=(this._fadeAnimated=this.options.fadeAnimation&&b.any3d,M(t,"leaflet-container"+(b.touch?" leaflet-touch":"")+(b.retina?" leaflet-retina":"")+(b.ielt9?" leaflet-oldie":"")+(b.safari?" leaflet-safari":"")+(this._fadeAnimated?" leaflet-fade-anim":"")),pe(t,"position"));"absolute"!==e&&"relative"!==e&&"fixed"!==e&&"sticky"!==e&&(t.style.position="relative"),this._initPanes(),this._initControlPos&&this._initControlPos()},_initPanes:function(){var t=this._panes={};this._paneRenderers={},this._mapPane=this.createPane("mapPane",this._container),Z(this._mapPane,new p(0,0)),this.createPane("tilePane"),this.createPane("overlayPane"),this.createPane("shadowPane"),this.createPane("markerPane"),this.createPane("tooltipPane"),this.createPane("popupPane"),this.options.markerZoomAnimation||(M(t.markerPane,"leaflet-zoom-hide"),M(t.shadowPane,"leaflet-zoom-hide"))},_resetView:function(t,e,i){Z(this._mapPane,new p(0,0));var n=!this._loaded,o=(this._loaded=!0,e=this._limitZoom(e),this.fire("viewprereset"),this._zoom!==e);this._moveStart(o,i)._move(t,e)._moveEnd(o),this.fire("viewreset"),n&&this.fire("load")},_moveStart:function(t,e){return t&&this.fire("zoomstart"),e||this.fire("movestart"),this},_move:function(t,e,i,n){void 0===e&&(e=this._zoom);var o=this._zoom!==e;return this._zoom=e,this._lastCenter=t,this._pixelOrigin=this._getNewPixelOrigin(t),n?i&&i.pinch&&this.fire("zoom",i):((o||i&&i.pinch)&&this.fire("zoom",i),this.fire("move",i)),this},_moveEnd:function(t){return t&&this.fire("zoomend"),this.fire("moveend")},_stop:function(){return r(this._flyToFrame),this._panAnim&&this._panAnim.stop(),this},_rawPanBy:function(t){Z(this._mapPane,this._getMapPanePos().subtract(t))},_getZoomSpan:function(){return this.getMaxZoom()-this.getMinZoom()},_panInsideMaxBounds:function(){this._enforcingBounds||this.panInsideBounds(this.options.maxBounds)},_checkIfLoaded:function(){if(!this._loaded)throw new Error("Set map center and zoom first.")},_initEvents:function(t){this._targets={};var e=t?k:S;e((this._targets[h(this._container)]=this)._container,"click dblclick mousedown mouseup mouseover mouseout mousemove contextmenu keypress keydown keyup",this._handleDOMEvent,this),this.options.trackResize&&e(window,"resize",this._onResize,this),b.any3d&&this.options.transform3DLimit&&(t?this.off:this.on).call(this,"moveend",this._onMoveEnd)},_onResize:function(){r(this._resizeRequest),this._resizeRequest=x(function(){this.invalidateSize({debounceMoveend:!0})},this)},_onScroll:function(){this._container.scrollTop=0,this._container.scrollLeft=0},_onMoveEnd:function(){var t=this._getMapPanePos();Math.max(Math.abs(t.x),Math.abs(t.y))>=this.options.transform3DLimit&&this._resetView(this.getCenter(),this.getZoom())},_findEventTargets:function(t,e){for(var i,n=[],o="mouseout"===e||"mouseover"===e,s=t.target||t.srcElement,r=!1;s;){if((i=this._targets[h(s)])&&("click"===e||"preclick"===e)&&this._draggableMoved(i)){r=!0;break}if(i&&i.listens(e,!0)){if(o&&!We(s,t))break;if(n.push(i),o)break}if(s===this._container)break;s=s.parentNode}return n=n.length||r||o||!this.listens(e,!0)?n:[this]},_isClickDisabled:function(t){for(;t&&t!==this._container;){if(t._leaflet_disable_click)return!0;t=t.parentNode}},_handleDOMEvent:function(t){var e,i=t.target||t.srcElement;!this._loaded||i._leaflet_disable_events||"click"===t.type&&this._isClickDisabled(i)||("mousedown"===(e=t.type)&&Me(i),this._fireDOMEvent(t,e))},_mouseEvents:["click","dblclick","mouseover","mouseout","contextmenu"],_fireDOMEvent:function(t,e,i){"click"===t.type&&((a=l({},t)).type="preclick",this._fireDOMEvent(a,a.type,i));var n=this._findEventTargets(t,e);if(i){for(var o=[],s=0;s<i.length;s++)i[s].listens(e,!0)&&o.push(i[s]);n=o.concat(n)}if(n.length){"contextmenu"===e&&O(t);var r,a=n[0],h={originalEvent:t};for("keypress"!==t.type&&"keydown"!==t.type&&"keyup"!==t.type&&(r=a.getLatLng&&(!a._radius||a._radius<=10),h.containerPoint=r?this.latLngToContainerPoint(a.getLatLng()):this.mouseEventToContainerPoint(t),h.layerPoint=this.containerPointToLayerPoint(h.containerPoint),h.latlng=r?a.getLatLng():this.layerPointToLatLng(h.layerPoint)),s=0;s<n.length;s++)if(n[s].fire(e,h,!0),h.originalEvent._stopped||!1===n[s].options.bubblingMouseEvents&&-1!==G(this._mouseEvents,e))return}},_draggableMoved:function(t){return(t=t.dragging&&t.dragging.enabled()?t:this).dragging&&t.dragging.moved()||this.boxZoom&&this.boxZoom.moved()},_clearHandlers:function(){for(var t=0,e=this._handlers.length;t<e;t++)this._handlers[t].disable()},whenReady:function(t,e){return this._loaded?t.call(e||this,{target:this}):this.on("load",t,e),this},_getMapPanePos:function(){return Pe(this._mapPane)||new p(0,0)},_moved:function(){var t=this._getMapPanePos();return t&&!t.equals([0,0])},_getTopLeftPoint:function(t,e){return(t&&void 0!==e?this._getNewPixelOrigin(t,e):this.getPixelOrigin()).subtract(this._getMapPanePos())},_getNewPixelOrigin:function(t,e){var i=this.getSize()._divideBy(2);return this.project(t,e)._subtract(i)._add(this._getMapPanePos())._round()},_latLngToNewLayerPoint:function(t,e,i){i=this._getNewPixelOrigin(i,e);return this.project(t,e)._subtract(i)},_latLngBoundsToNewLayerBounds:function(t,e,i){i=this._getNewPixelOrigin(i,e);return _([this.project(t.getSouthWest(),e)._subtract(i),this.project(t.getNorthWest(),e)._subtract(i),this.project(t.getSouthEast(),e)._subtract(i),this.project(t.getNorthEast(),e)._subtract(i)])},_getCenterLayerPoint:function(){return this.containerPointToLayerPoint(this.getSize()._divideBy(2))},_getCenterOffset:function(t){return this.latLngToLayerPoint(t).subtract(this._getCenterLayerPoint())},_limitCenter:function(t,e,i){var n,o;return!i||(n=this.project(t,e),o=this.getSize().divideBy(2),o=new f(n.subtract(o),n.add(o)),o=this._getBoundsOffset(o,i,e),Math.abs(o.x)<=1&&Math.abs(o.y)<=1)?t:this.unproject(n.add(o),e)},_limitOffset:function(t,e){var i;return e?(i=new f((i=this.getPixelBounds()).min.add(t),i.max.add(t)),t.add(this._getBoundsOffset(i,e))):t},_getBoundsOffset:function(t,e,i){e=_(this.project(e.getNorthEast(),i),this.project(e.getSouthWest(),i)),i=e.min.subtract(t.min),e=e.max.subtract(t.max);return new p(this._rebound(i.x,-e.x),this._rebound(i.y,-e.y))},_rebound:function(t,e){return 0<t+e?Math.round(t-e)/2:Math.max(0,Math.ceil(t))-Math.max(0,Math.floor(e))},_limitZoom:function(t){var e=this.getMinZoom(),i=this.getMaxZoom(),n=b.any3d?this.options.zoomSnap:1;return n&&(t=Math.round(t/n)*n),Math.max(e,Math.min(i,t))},_onPanTransitionStep:function(){this.fire("move")},_onPanTransitionEnd:function(){z(this._mapPane,"leaflet-pan-anim"),this.fire("moveend")},_tryAnimatedPan:function(t,e){t=this._getCenterOffset(t)._trunc();return!(!0!==(e&&e.animate)&&!this.getSize().contains(t))&&(this.panBy(t,e),!0)},_createAnimProxy:function(){var t=this._proxy=P("div","leaflet-proxy leaflet-zoom-animated");this._panes.mapPane.appendChild(t),this.on("zoomanim",function(t){var e=ue,i=this._proxy.style[e];be(this._proxy,this.project(t.center,t.zoom),this.getZoomScale(t.zoom,1)),i===this._proxy.style[e]&&this._animatingZoom&&this._onZoomTransitionEnd()},this),this.on("load moveend",this._animMoveEnd,this),this._on("unload",this._destroyAnimProxy,this)},_destroyAnimProxy:function(){T(this._proxy),this.off("load moveend",this._animMoveEnd,this),delete this._proxy},_animMoveEnd:function(){var t=this.getCenter(),e=this.getZoom();be(this._proxy,this.project(t,e),this.getZoomScale(e,1))},_catchTransitionEnd:function(t){this._animatingZoom&&0<=t.propertyName.indexOf("transform")&&this._onZoomTransitionEnd()},_nothingToAnimate:function(){return!this._container.getElementsByClassName("leaflet-zoom-animated").length},_tryAnimatedZoom:function(t,e,i){if(!this._animatingZoom){if(i=i||{},!this._zoomAnimated||!1===i.animate||this._nothingToAnimate()||Math.abs(e-this._zoom)>this.options.zoomAnimationThreshold)return!1;var n=this.getZoomScale(e),n=this._getCenterOffset(t)._divideBy(1-1/n);if(!0!==i.animate&&!this.getSize().contains(n))return!1;x(function(){this._moveStart(!0,i.noMoveStart||!1)._animateZoom(t,e,!0)},this)}return!0},_animateZoom:function(t,e,i,n){this._mapPane&&(i&&(this._animatingZoom=!0,this._animateToCenter=t,this._animateToZoom=e,M(this._mapPane,"leaflet-zoom-anim")),this.fire("zoomanim",{center:t,zoom:e,noUpdate:n}),this._tempFireZoomEvent||(this._tempFireZoomEvent=this._zoom!==this._animateToZoom),this._move(this._animateToCenter,this._animateToZoom,void 0,!0),setTimeout(a(this._onZoomTransitionEnd,this),250))},_onZoomTransitionEnd:function(){this._animatingZoom&&(this._mapPane&&z(this._mapPane,"leaflet-zoom-anim"),this._animatingZoom=!1,this._move(this._animateToCenter,this._animateToZoom,void 0,!0),this._tempFireZoomEvent&&this.fire("zoom"),delete this._tempFireZoomEvent,this.fire("move"),this._moveEnd(!0))}});function Ue(t){return new B(t)}var B=et.extend({options:{position:"topright"},initialize:function(t){c(this,t)},getPosition:function(){return this.options.position},setPosition:function(t){var e=this._map;return e&&e.removeControl(this),this.options.position=t,e&&e.addControl(this),this},getContainer:function(){return this._container},addTo:function(t){this.remove(),this._map=t;var e=this._container=this.onAdd(t),i=this.getPosition(),t=t._controlCorners[i];return M(e,"leaflet-control"),-1!==i.indexOf("bottom")?t.insertBefore(e,t.firstChild):t.appendChild(e),this._map.on("unload",this.remove,this),this},remove:function(){return this._map&&(T(this._container),this.onRemove&&this.onRemove(this._map),this._map.off("unload",this.remove,this),this._map=null),this},_refocusOnMap:function(t){this._map&&t&&0<t.screenX&&0<t.screenY&&this._map.getContainer().focus()}}),Ve=(A.include({addControl:function(t){return t.addTo(this),this},removeControl:function(t){return t.remove(),this},_initControlPos:function(){var i=this._controlCorners={},n="leaflet-",o=this._controlContainer=P("div",n+"control-container",this._container);function t(t,e){i[t+e]=P("div",n+t+" "+n+e,o)}t("top","left"),t("top","right"),t("bottom","left"),t("bottom","right")},_clearControlPos:function(){for(var t in this._controlCorners)T(this._controlCorners[t]);T(this._controlContainer),delete this._controlCorners,delete this._controlContainer}}),B.extend({options:{collapsed:!0,position:"topright",autoZIndex:!0,hideSingleBase:!1,sortLayers:!1,sortFunction:function(t,e,i,n){return i<n?-1:n<i?1:0}},initialize:function(t,e,i){for(var n in c(this,i),this._layerControlInputs=[],this._layers=[],this._lastZIndex=0,this._handlingClick=!1,this._preventClick=!1,t)this._addLayer(t[n],n);for(n in e)this._addLayer(e[n],n,!0)},onAdd:function(t){this._initLayout(),this._update(),(this._map=t).on("zoomend",this._checkDisabledLayers,this);for(var e=0;e<this._layers.length;e++)this._layers[e].layer.on("add remove",this._onLayerChange,this);return this._container},addTo:function(t){return B.prototype.addTo.call(this,t),this._expandIfNotCollapsed()},onRemove:function(){this._map.off("zoomend",this._checkDisabledLayers,this);for(var t=0;t<this._layers.length;t++)this._layers[t].layer.off("add remove",this._onLayerChange,this)},addBaseLayer:function(t,e){return this._addLayer(t,e),this._map?this._update():this},addOverlay:function(t,e){return this._addLayer(t,e,!0),this._map?this._update():this},removeLayer:function(t){t.off("add remove",this._onLayerChange,this);t=this._getLayer(h(t));return t&&this._layers.splice(this._layers.indexOf(t),1),this._map?this._update():this},expand:function(){M(this._container,"leaflet-control-layers-expanded"),this._section.style.height=null;var t=this._map.getSize().y-(this._container.offsetTop+50);return t<this._section.clientHeight?(M(this._section,"leaflet-control-layers-scrollbar"),this._section.style.height=t+"px"):z(this._section,"leaflet-control-layers-scrollbar"),this._checkDisabledLayers(),this},collapse:function(){return z(this._container,"leaflet-control-layers-expanded"),this},_initLayout:function(){var t="leaflet-control-layers",e=this._container=P("div",t),i=this.options.collapsed,n=(e.setAttribute("aria-haspopup",!0),Ie(e),Be(e),this._section=P("section",t+"-list")),o=(i&&(this._map.on("click",this.collapse,this),S(e,{mouseenter:this._expandSafely,mouseleave:this.collapse},this)),this._layersLink=P("a",t+"-toggle",e));o.href="#",o.title="Layers",o.setAttribute("role","button"),S(o,{keydown:function(t){13===t.keyCode&&this._expandSafely()},click:function(t){O(t),this._expandSafely()}},this),i||this.expand(),this._baseLayersList=P("div",t+"-base",n),this._separator=P("div",t+"-separator",n),this._overlaysList=P("div",t+"-overlays",n),e.appendChild(n)},_getLayer:function(t){for(var e=0;e<this._layers.length;e++)if(this._layers[e]&&h(this._layers[e].layer)===t)return this._layers[e]},_addLayer:function(t,e,i){this._map&&t.on("add remove",this._onLayerChange,this),this._layers.push({layer:t,name:e,overlay:i}),this.options.sortLayers&&this._layers.sort(a(function(t,e){return this.options.sortFunction(t.layer,e.layer,t.name,e.name)},this)),this.options.autoZIndex&&t.setZIndex&&(this._lastZIndex++,t.setZIndex(this._lastZIndex)),this._expandIfNotCollapsed()},_update:function(){if(this._container){me(this._baseLayersList),me(this._overlaysList),this._layerControlInputs=[];for(var t,e,i,n=0,o=0;o<this._layers.length;o++)i=this._layers[o],this._addItem(i),e=e||i.overlay,t=t||!i.overlay,n+=i.overlay?0:1;this.options.hideSingleBase&&(this._baseLayersList.style.display=(t=t&&1<n)?"":"none"),this._separator.style.display=e&&t?"":"none"}return this},_onLayerChange:function(t){this._handlingClick||this._update();var e=this._getLayer(h(t.target)),t=e.overlay?"add"===t.type?"overlayadd":"overlayremove":"add"===t.type?"baselayerchange":null;t&&this._map.fire(t,e)},_createRadioElement:function(t,e){t='<input type="radio" class="leaflet-control-layers-selector" name="'+t+'"'+(e?' checked="checked"':"")+"/>",e=document.createElement("div");return e.innerHTML=t,e.firstChild},_addItem:function(t){var e,i=document.createElement("label"),n=this._map.hasLayer(t.layer),n=(t.overlay?((e=document.createElement("input")).type="checkbox",e.className="leaflet-control-layers-selector",e.defaultChecked=n):e=this._createRadioElement("leaflet-base-layers_"+h(this),n),this._layerControlInputs.push(e),e.layerId=h(t.layer),S(e,"click",this._onInputClick,this),document.createElement("span")),o=(n.innerHTML=" "+t.name,document.createElement("span"));return i.appendChild(o),o.appendChild(e),o.appendChild(n),(t.overlay?this._overlaysList:this._baseLayersList).appendChild(i),this._checkDisabledLayers(),i},_onInputClick:function(){if(!this._preventClick){var t,e,i=this._layerControlInputs,n=[],o=[];this._handlingClick=!0;for(var s=i.length-1;0<=s;s--)t=i[s],e=this._getLayer(t.layerId).layer,t.checked?n.push(e):t.checked||o.push(e);for(s=0;s<o.length;s++)this._map.hasLayer(o[s])&&this._map.removeLayer(o[s]);for(s=0;s<n.length;s++)this._map.hasLayer(n[s])||this._map.addLayer(n[s]);this._handlingClick=!1,this._refocusOnMap()}},_checkDisabledLayers:function(){for(var t,e,i=this._layerControlInputs,n=this._map.getZoom(),o=i.length-1;0<=o;o--)t=i[o],e=this._getLayer(t.layerId).layer,t.disabled=void 0!==e.options.minZoom&&n<e.options.minZoom||void 0!==e.options.maxZoom&&n>e.options.maxZoom},_expandIfNotCollapsed:function(){return this._map&&!this.options.collapsed&&this.expand(),this},_expandSafely:function(){var t=this._section,e=(this._preventClick=!0,S(t,"click",O),this.expand(),this);setTimeout(function(){k(t,"click",O),e._preventClick=!1})}})),qe=B.extend({options:{position:"topleft",zoomInText:'<span aria-hidden="true">+</span>',zoomInTitle:"Zoom in",zoomOutText:'<span aria-hidden="true">&#x2212;</span>',zoomOutTitle:"Zoom out"},onAdd:function(t){var e="leaflet-control-zoom",i=P("div",e+" leaflet-bar"),n=this.options;return this._zoomInButton=this._createButton(n.zoomInText,n.zoomInTitle,e+"-in",i,this._zoomIn),this._zoomOutButton=this._createButton(n.zoomOutText,n.zoomOutTitle,e+"-out",i,this._zoomOut),this._updateDisabled(),t.on("zoomend zoomlevelschange",this._updateDisabled,this),i},onRemove:function(t){t.off("zoomend zoomlevelschange",this._updateDisabled,this)},disable:function(){return this._disabled=!0,this._updateDisabled(),this},enable:function(){return this._disabled=!1,this._updateDisabled(),this},_zoomIn:function(t){!this._disabled&&this._map._zoom<this._map.getMaxZoom()&&this._map.zoomIn(this._map.options.zoomDelta*(t.shiftKey?3:1))},_zoomOut:function(t){!this._disabled&&this._map._zoom>this._map.getMinZoom()&&this._map.zoomOut(this._map.options.zoomDelta*(t.shiftKey?3:1))},_createButton:function(t,e,i,n,o){i=P("a",i,n);return i.innerHTML=t,i.href="#",i.title=e,i.setAttribute("role","button"),i.setAttribute("aria-label",e),Ie(i),S(i,"click",Re),S(i,"click",o,this),S(i,"click",this._refocusOnMap,this),i},_updateDisabled:function(){var t=this._map,e="leaflet-disabled";z(this._zoomInButton,e),z(this._zoomOutButton,e),this._zoomInButton.setAttribute("aria-disabled","false"),this._zoomOutButton.setAttribute("aria-disabled","false"),!this._disabled&&t._zoom!==t.getMinZoom()||(M(this._zoomOutButton,e),this._zoomOutButton.setAttribute("aria-disabled","true")),!this._disabled&&t._zoom!==t.getMaxZoom()||(M(this._zoomInButton,e),this._zoomInButton.setAttribute("aria-disabled","true"))}}),Ge=(A.mergeOptions({zoomControl:!0}),A.addInitHook(function(){this.options.zoomControl&&(this.zoomControl=new qe,this.addControl(this.zoomControl))}),B.extend({options:{position:"bottomleft",maxWidth:100,metric:!0,imperial:!0},onAdd:function(t){var e="leaflet-control-scale",i=P("div",e),n=this.options;return this._addScales(n,e+"-line",i),t.on(n.updateWhenIdle?"moveend":"move",this._update,this),t.whenReady(this._update,this),i},onRemove:function(t){t.off(this.options.updateWhenIdle?"moveend":"move",this._update,this)},_addScales:function(t,e,i){t.metric&&(this._mScale=P("div",e,i)),t.imperial&&(this._iScale=P("div",e,i))},_update:function(){var t=this._map,e=t.getSize().y/2,t=t.distance(t.containerPointToLatLng([0,e]),t.containerPointToLatLng([this.options.maxWidth,e]));this._updateScales(t)},_updateScales:function(t){this.options.metric&&t&&this._updateMetric(t),this.options.imperial&&t&&this._updateImperial(t)},_updateMetric:function(t){var e=this._getRoundNum(t);this._updateScale(this._mScale,e<1e3?e+" m":e/1e3+" km",e/t)},_updateImperial:function(t){var e,i,t=3.2808399*t;5280<t?(i=this._getRoundNum(e=t/5280),this._updateScale(this._iScale,i+" mi",i/e)):(i=this._getRoundNum(t),this._updateScale(this._iScale,i+" ft",i/t))},_updateScale:function(t,e,i){t.style.width=Math.round(this.options.maxWidth*i)+"px",t.innerHTML=e},_getRoundNum:function(t){var e=Math.pow(10,(Math.floor(t)+"").length-1),t=t/e;return e*(t=10<=t?10:5<=t?5:3<=t?3:2<=t?2:1)}})),Ke=B.extend({options:{position:"bottomright",prefix:'<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">'+(b.inlineSvg?'<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" class="leaflet-attribution-flag"><path fill="#4C7BE1" d="M0 0h12v4H0z"/><path fill="#FFD500" d="M0 4h12v3H0z"/><path fill="#E0BC00" d="M0 7h12v1H0z"/></svg> ':"")+"Leaflet</a>"},initialize:function(t){c(this,t),this._attributions={}},onAdd:function(t){for(var e in(t.attributionControl=this)._container=P("div","leaflet-control-attribution"),Ie(this._container),t._layers)t._layers[e].getAttribution&&this.addAttribution(t._layers[e].getAttribution());return this._update(),t.on("layeradd",this._addAttribution,this),this._container},onRemove:function(t){t.off("layeradd",this._addAttribution,this)},_addAttribution:function(t){t.layer.getAttribution&&(this.addAttribution(t.layer.getAttribution()),t.layer.once("remove",function(){this.removeAttribution(t.layer.getAttribution())},this))},setPrefix:function(t){return this.options.prefix=t,this._update(),this},addAttribution:function(t){return t&&(this._attributions[t]||(this._attributions[t]=0),this._attributions[t]++,this._update()),this},removeAttribution:function(t){return t&&this._attributions[t]&&(this._attributions[t]--,this._update()),this},_update:function(){if(this._map){var t,e=[];for(t in this._attributions)this._attributions[t]&&e.push(t);var i=[];this.options.prefix&&i.push(this.options.prefix),e.length&&i.push(e.join(", ")),this._container.innerHTML=i.join(' <span aria-hidden="true">|</span> ')}}}),n=(A.mergeOptions({attributionControl:!0}),A.addInitHook(function(){this.options.attributionControl&&(new Ke).addTo(this)}),B.Layers=Ve,B.Zoom=qe,B.Scale=Ge,B.Attribution=Ke,Ue.layers=function(t,e,i){return new Ve(t,e,i)},Ue.zoom=function(t){return new qe(t)},Ue.scale=function(t){return new Ge(t)},Ue.attribution=function(t){return new Ke(t)},et.extend({initialize:function(t){this._map=t},enable:function(){return this._enabled||(this._enabled=!0,this.addHooks()),this},disable:function(){return this._enabled&&(this._enabled=!1,this.removeHooks()),this},enabled:function(){return!!this._enabled}})),ft=(n.addTo=function(t,e){return t.addHandler(e,this),this},{Events:e}),Ye=b.touch?"touchstart mousedown":"mousedown",Xe=it.extend({options:{clickTolerance:3},initialize:function(t,e,i,n){c(this,n),this._element=t,this._dragStartTarget=e||t,this._preventOutline=i},enable:function(){this._enabled||(S(this._dragStartTarget,Ye,this._onDown,this),this._enabled=!0)},disable:function(){this._enabled&&(Xe._dragging===this&&this.finishDrag(!0),k(this._dragStartTarget,Ye,this._onDown,this),this._enabled=!1,this._moved=!1)},_onDown:function(t){var e,i;this._enabled&&(this._moved=!1,ve(this._element,"leaflet-zoom-anim")||(t.touches&&1!==t.touches.length?Xe._dragging===this&&this.finishDrag():Xe._dragging||t.shiftKey||1!==t.which&&1!==t.button&&!t.touches||((Xe._dragging=this)._preventOutline&&Me(this._element),Le(),re(),this._moving||(this.fire("down"),i=t.touches?t.touches[0]:t,e=Ce(this._element),this._startPoint=new p(i.clientX,i.clientY),this._startPos=Pe(this._element),this._parentScale=Ze(e),i="mousedown"===t.type,S(document,i?"mousemove":"touchmove",this._onMove,this),S(document,i?"mouseup":"touchend touchcancel",this._onUp,this)))))},_onMove:function(t){var e;this._enabled&&(t.touches&&1<t.touches.length?this._moved=!0:!(e=new p((e=t.touches&&1===t.touches.length?t.touches[0]:t).clientX,e.clientY)._subtract(this._startPoint)).x&&!e.y||Math.abs(e.x)+Math.abs(e.y)<this.options.clickTolerance||(e.x/=this._parentScale.x,e.y/=this._parentScale.y,O(t),this._moved||(this.fire("dragstart"),this._moved=!0,M(document.body,"leaflet-dragging"),this._lastTarget=t.target||t.srcElement,window.SVGElementInstance&&this._lastTarget instanceof window.SVGElementInstance&&(this._lastTarget=this._lastTarget.correspondingUseElement),M(this._lastTarget,"leaflet-drag-target")),this._newPos=this._startPos.add(e),this._moving=!0,this._lastEvent=t,this._updatePosition()))},_updatePosition:function(){var t={originalEvent:this._lastEvent};this.fire("predrag",t),Z(this._element,this._newPos),this.fire("drag",t)},_onUp:function(){this._enabled&&this.finishDrag()},finishDrag:function(t){z(document.body,"leaflet-dragging"),this._lastTarget&&(z(this._lastTarget,"leaflet-drag-target"),this._lastTarget=null),k(document,"mousemove touchmove",this._onMove,this),k(document,"mouseup touchend touchcancel",this._onUp,this),Te(),ae();var e=this._moved&&this._moving;this._moving=!1,Xe._dragging=!1,e&&this.fire("dragend",{noInertia:t,distance:this._newPos.distanceTo(this._startPos)})}});function Je(t,e,i){for(var n,o,s,r,a,h,l,u=[1,4,2,8],c=0,d=t.length;c<d;c++)t[c]._code=si(t[c],e);for(s=0;s<4;s++){for(h=u[s],n=[],c=0,o=(d=t.length)-1;c<d;o=c++)r=t[c],a=t[o],r._code&h?a._code&h||((l=oi(a,r,h,e,i))._code=si(l,e),n.push(l)):(a._code&h&&((l=oi(a,r,h,e,i))._code=si(l,e),n.push(l)),n.push(r));t=n}return t}function $e(t,e){var i,n,o,s,r,a,h;if(!t||0===t.length)throw new Error("latlngs not passed");I(t)||(console.warn("latlngs are not flat! Only the first ring will be used"),t=t[0]);for(var l=w([0,0]),u=g(t),c=(u.getNorthWest().distanceTo(u.getSouthWest())*u.getNorthEast().distanceTo(u.getNorthWest())<1700&&(l=Qe(t)),t.length),d=[],_=0;_<c;_++){var p=w(t[_]);d.push(e.project(w([p.lat-l.lat,p.lng-l.lng])))}for(_=r=a=h=0,i=c-1;_<c;i=_++)n=d[_],o=d[i],s=n.y*o.x-o.y*n.x,a+=(n.x+o.x)*s,h+=(n.y+o.y)*s,r+=3*s;u=0===r?d[0]:[a/r,h/r],u=e.unproject(m(u));return w([u.lat+l.lat,u.lng+l.lng])}function Qe(t){for(var e=0,i=0,n=0,o=0;o<t.length;o++){var s=w(t[o]);e+=s.lat,i+=s.lng,n++}return w([e/n,i/n])}var ti,gt={__proto__:null,clipPolygon:Je,polygonCenter:$e,centroid:Qe};function ei(t,e){if(e&&t.length){var i=t=function(t,e){for(var i=[t[0]],n=1,o=0,s=t.length;n<s;n++)(function(t,e){var i=e.x-t.x,e=e.y-t.y;return i*i+e*e})(t[n],t[o])>e&&(i.push(t[n]),o=n);o<s-1&&i.push(t[s-1]);return i}(t,e=e*e),n=i.length,o=new(typeof Uint8Array!=void 0+""?Uint8Array:Array)(n);o[0]=o[n-1]=1,function t(e,i,n,o,s){var r,a,h,l=0;for(a=o+1;a<=s-1;a++)h=ri(e[a],e[o],e[s],!0),l<h&&(r=a,l=h);n<l&&(i[r]=1,t(e,i,n,o,r),t(e,i,n,r,s))}(i,o,e,0,n-1);var s,r=[];for(s=0;s<n;s++)o[s]&&r.push(i[s]);return r}return t.slice()}function ii(t,e,i){return Math.sqrt(ri(t,e,i,!0))}function ni(t,e,i,n,o){var s,r,a,h=n?ti:si(t,i),l=si(e,i);for(ti=l;;){if(!(h|l))return[t,e];if(h&l)return!1;a=si(r=oi(t,e,s=h||l,i,o),i),s===h?(t=r,h=a):(e=r,l=a)}}function oi(t,e,i,n,o){var s,r,a=e.x-t.x,e=e.y-t.y,h=n.min,n=n.max;return 8&i?(s=t.x+a*(n.y-t.y)/e,r=n.y):4&i?(s=t.x+a*(h.y-t.y)/e,r=h.y):2&i?(s=n.x,r=t.y+e*(n.x-t.x)/a):1&i&&(s=h.x,r=t.y+e*(h.x-t.x)/a),new p(s,r,o)}function si(t,e){var i=0;return t.x<e.min.x?i|=1:t.x>e.max.x&&(i|=2),t.y<e.min.y?i|=4:t.y>e.max.y&&(i|=8),i}function ri(t,e,i,n){var o=e.x,e=e.y,s=i.x-o,r=i.y-e,a=s*s+r*r;return 0<a&&(1<(a=((t.x-o)*s+(t.y-e)*r)/a)?(o=i.x,e=i.y):0<a&&(o+=s*a,e+=r*a)),s=t.x-o,r=t.y-e,n?s*s+r*r:new p(o,e)}function I(t){return!d(t[0])||"object"!=typeof t[0][0]&&void 0!==t[0][0]}function ai(t){return console.warn("Deprecated use of _flat, please use L.LineUtil.isFlat instead."),I(t)}function hi(t,e){var i,n,o,s,r,a;if(!t||0===t.length)throw new Error("latlngs not passed");I(t)||(console.warn("latlngs are not flat! Only the first ring will be used"),t=t[0]);for(var h=w([0,0]),l=g(t),u=(l.getNorthWest().distanceTo(l.getSouthWest())*l.getNorthEast().distanceTo(l.getNorthWest())<1700&&(h=Qe(t)),t.length),c=[],d=0;d<u;d++){var _=w(t[d]);c.push(e.project(w([_.lat-h.lat,_.lng-h.lng])))}for(i=d=0;d<u-1;d++)i+=c[d].distanceTo(c[d+1])/2;if(0===i)a=c[0];else for(n=d=0;d<u-1;d++)if(o=c[d],s=c[d+1],i<(n+=r=o.distanceTo(s))){a=[s.x-(r=(n-i)/r)*(s.x-o.x),s.y-r*(s.y-o.y)];break}l=e.unproject(m(a));return w([l.lat+h.lat,l.lng+h.lng])}var vt={__proto__:null,simplify:ei,pointToSegmentDistance:ii,closestPointOnSegment:function(t,e,i){return ri(t,e,i)},clipSegment:ni,_getEdgeIntersection:oi,_getBitCode:si,_sqClosestPointOnSegment:ri,isFlat:I,_flat:ai,polylineCenter:hi},yt={project:function(t){return new p(t.lng,t.lat)},unproject:function(t){return new v(t.y,t.x)},bounds:new f([-180,-90],[180,90])},xt={R:6378137,R_MINOR:6356752.314245179,bounds:new f([-20037508.34279,-15496570.73972],[20037508.34279,18764656.23138]),project:function(t){var e=Math.PI/180,i=this.R,n=t.lat*e,o=this.R_MINOR/i,o=Math.sqrt(1-o*o),s=o*Math.sin(n),s=Math.tan(Math.PI/4-n/2)/Math.pow((1-s)/(1+s),o/2),n=-i*Math.log(Math.max(s,1e-10));return new p(t.lng*e*i,n)},unproject:function(t){for(var e,i=180/Math.PI,n=this.R,o=this.R_MINOR/n,s=Math.sqrt(1-o*o),r=Math.exp(-t.y/n),a=Math.PI/2-2*Math.atan(r),h=0,l=.1;h<15&&1e-7<Math.abs(l);h++)e=s*Math.sin(a),e=Math.pow((1-e)/(1+e),s/2),a+=l=Math.PI/2-2*Math.atan(r*e)-a;return new v(a*i,t.x*i/n)}},wt={__proto__:null,LonLat:yt,Mercator:xt,SphericalMercator:rt},Pt=l({},st,{code:"EPSG:3395",projection:xt,transformation:ht(bt=.5/(Math.PI*xt.R),.5,-bt,.5)}),li=l({},st,{code:"EPSG:4326",projection:yt,transformation:ht(1/180,1,-1/180,.5)}),Lt=l({},ot,{projection:yt,transformation:ht(1,0,-1,0),scale:function(t){return Math.pow(2,t)},zoom:function(t){return Math.log(t)/Math.LN2},distance:function(t,e){var i=e.lng-t.lng,e=e.lat-t.lat;return Math.sqrt(i*i+e*e)},infinite:!0}),o=(ot.Earth=st,ot.EPSG3395=Pt,ot.EPSG3857=lt,ot.EPSG900913=ut,ot.EPSG4326=li,ot.Simple=Lt,it.extend({options:{pane:"overlayPane",attribution:null,bubblingMouseEvents:!0},addTo:function(t){return t.addLayer(this),this},remove:function(){return this.removeFrom(this._map||this._mapToAdd)},removeFrom:function(t){return t&&t.removeLayer(this),this},getPane:function(t){return this._map.getPane(t?this.options[t]||t:this.options.pane)},addInteractiveTarget:function(t){return this._map._targets[h(t)]=this},removeInteractiveTarget:function(t){return delete this._map._targets[h(t)],this},getAttribution:function(){return this.options.attribution},_layerAdd:function(t){var e,i=t.target;i.hasLayer(this)&&(this._map=i,this._zoomAnimated=i._zoomAnimated,this.getEvents&&(e=this.getEvents(),i.on(e,this),this.once("remove",function(){i.off(e,this)},this)),this.onAdd(i),this.fire("add"),i.fire("layeradd",{layer:this}))}})),ui=(A.include({addLayer:function(t){var e;if(t._layerAdd)return e=h(t),this._layers[e]||((this._layers[e]=t)._mapToAdd=this,t.beforeAdd&&t.beforeAdd(this),this.whenReady(t._layerAdd,t)),this;throw new Error("The provided object is not a Layer.")},removeLayer:function(t){var e=h(t);return this._layers[e]&&(this._loaded&&t.onRemove(this),delete this._layers[e],this._loaded&&(this.fire("layerremove",{layer:t}),t.fire("remove")),t._map=t._mapToAdd=null),this},hasLayer:function(t){return h(t)in this._layers},eachLayer:function(t,e){for(var i in this._layers)t.call(e,this._layers[i]);return this},_addLayers:function(t){for(var e=0,i=(t=t?d(t)?t:[t]:[]).length;e<i;e++)this.addLayer(t[e])},_addZoomLimit:function(t){isNaN(t.options.maxZoom)&&isNaN(t.options.minZoom)||(this._zoomBoundLayers[h(t)]=t,this._updateZoomLevels())},_removeZoomLimit:function(t){t=h(t);this._zoomBoundLayers[t]&&(delete this._zoomBoundLayers[t],this._updateZoomLevels())},_updateZoomLevels:function(){var t,e=1/0,i=-1/0,n=this._getZoomSpan();for(t in this._zoomBoundLayers)var o=this._zoomBoundLayers[t].options,e=void 0===o.minZoom?e:Math.min(e,o.minZoom),i=void 0===o.maxZoom?i:Math.max(i,o.maxZoom);this._layersMaxZoom=i===-1/0?void 0:i,this._layersMinZoom=e===1/0?void 0:e,n!==this._getZoomSpan()&&this.fire("zoomlevelschange"),void 0===this.options.maxZoom&&this._layersMaxZoom&&this.getZoom()>this._layersMaxZoom&&this.setZoom(this._layersMaxZoom),void 0===this.options.minZoom&&this._layersMinZoom&&this.getZoom()<this._layersMinZoom&&this.setZoom(this._layersMinZoom)}}),o.extend({initialize:function(t,e){var i,n;if(c(this,e),this._layers={},t)for(i=0,n=t.length;i<n;i++)this.addLayer(t[i])},addLayer:function(t){var e=this.getLayerId(t);return this._layers[e]=t,this._map&&this._map.addLayer(t),this},removeLayer:function(t){t=t in this._layers?t:this.getLayerId(t);return this._map&&this._layers[t]&&this._map.removeLayer(this._layers[t]),delete this._layers[t],this},hasLayer:function(t){return("number"==typeof t?t:this.getLayerId(t))in this._layers},clearLayers:function(){return this.eachLayer(this.removeLayer,this)},invoke:function(t){var e,i,n=Array.prototype.slice.call(arguments,1);for(e in this._layers)(i=this._layers[e])[t]&&i[t].apply(i,n);return this},onAdd:function(t){this.eachLayer(t.addLayer,t)},onRemove:function(t){this.eachLayer(t.removeLayer,t)},eachLayer:function(t,e){for(var i in this._layers)t.call(e,this._layers[i]);return this},getLayer:function(t){return this._layers[t]},getLayers:function(){var t=[];return this.eachLayer(t.push,t),t},setZIndex:function(t){return this.invoke("setZIndex",t)},getLayerId:h})),ci=ui.extend({addLayer:function(t){return this.hasLayer(t)?this:(t.addEventParent(this),ui.prototype.addLayer.call(this,t),this.fire("layeradd",{layer:t}))},removeLayer:function(t){return this.hasLayer(t)?((t=t in this._layers?this._layers[t]:t).removeEventParent(this),ui.prototype.removeLayer.call(this,t),this.fire("layerremove",{layer:t})):this},setStyle:function(t){return this.invoke("setStyle",t)},bringToFront:function(){return this.invoke("bringToFront")},bringToBack:function(){return this.invoke("bringToBack")},getBounds:function(){var t,e=new s;for(t in this._layers){var i=this._layers[t];e.extend(i.getBounds?i.getBounds():i.getLatLng())}return e}}),di=et.extend({options:{popupAnchor:[0,0],tooltipAnchor:[0,0],crossOrigin:!1},initialize:function(t){c(this,t)},createIcon:function(t){return this._createIcon("icon",t)},createShadow:function(t){return this._createIcon("shadow",t)},_createIcon:function(t,e){var i=this._getIconUrl(t);if(i)return i=this._createImg(i,e&&"IMG"===e.tagName?e:null),this._setIconStyles(i,t),!this.options.crossOrigin&&""!==this.options.crossOrigin||(i.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),i;if("icon"===t)throw new Error("iconUrl not set in Icon options (see the docs).");return null},_setIconStyles:function(t,e){var i=this.options,n=i[e+"Size"],n=m(n="number"==typeof n?[n,n]:n),o=m("shadow"===e&&i.shadowAnchor||i.iconAnchor||n&&n.divideBy(2,!0));t.className="leaflet-marker-"+e+" "+(i.className||""),o&&(t.style.marginLeft=-o.x+"px",t.style.marginTop=-o.y+"px"),n&&(t.style.width=n.x+"px",t.style.height=n.y+"px")},_createImg:function(t,e){return(e=e||document.createElement("img")).src=t,e},_getIconUrl:function(t){return b.retina&&this.options[t+"RetinaUrl"]||this.options[t+"Url"]}});var _i=di.extend({options:{iconUrl:"marker-icon.png",iconRetinaUrl:"marker-icon-2x.png",shadowUrl:"marker-shadow.png",iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],tooltipAnchor:[16,-28],shadowSize:[41,41]},_getIconUrl:function(t){return"string"!=typeof _i.imagePath&&(_i.imagePath=this._detectIconPath()),(this.options.imagePath||_i.imagePath)+di.prototype._getIconUrl.call(this,t)},_stripUrl:function(t){function e(t,e,i){return(e=e.exec(t))&&e[i]}return(t=e(t,/^url\((['"])?(.+)\1\)$/,2))&&e(t,/^(.*)marker-icon\.png$/,1)},_detectIconPath:function(){var t=P("div","leaflet-default-icon-path",document.body),e=pe(t,"background-image")||pe(t,"backgroundImage");return document.body.removeChild(t),(e=this._stripUrl(e))?e:(t=document.querySelector('link[href$="leaflet.css"]'))?t.href.substring(0,t.href.length-"leaflet.css".length-1):""}}),pi=n.extend({initialize:function(t){this._marker=t},addHooks:function(){var t=this._marker._icon;this._draggable||(this._draggable=new Xe(t,t,!0)),this._draggable.on({dragstart:this._onDragStart,predrag:this._onPreDrag,drag:this._onDrag,dragend:this._onDragEnd},this).enable(),M(t,"leaflet-marker-draggable")},removeHooks:function(){this._draggable.off({dragstart:this._onDragStart,predrag:this._onPreDrag,drag:this._onDrag,dragend:this._onDragEnd},this).disable(),this._marker._icon&&z(this._marker._icon,"leaflet-marker-draggable")},moved:function(){return this._draggable&&this._draggable._moved},_adjustPan:function(t){var e=this._marker,i=e._map,n=this._marker.options.autoPanSpeed,o=this._marker.options.autoPanPadding,s=Pe(e._icon),r=i.getPixelBounds(),a=i.getPixelOrigin(),a=_(r.min._subtract(a).add(o),r.max._subtract(a).subtract(o));a.contains(s)||(o=m((Math.max(a.max.x,s.x)-a.max.x)/(r.max.x-a.max.x)-(Math.min(a.min.x,s.x)-a.min.x)/(r.min.x-a.min.x),(Math.max(a.max.y,s.y)-a.max.y)/(r.max.y-a.max.y)-(Math.min(a.min.y,s.y)-a.min.y)/(r.min.y-a.min.y)).multiplyBy(n),i.panBy(o,{animate:!1}),this._draggable._newPos._add(o),this._draggable._startPos._add(o),Z(e._icon,this._draggable._newPos),this._onDrag(t),this._panRequest=x(this._adjustPan.bind(this,t)))},_onDragStart:function(){this._oldLatLng=this._marker.getLatLng(),this._marker.closePopup&&this._marker.closePopup(),this._marker.fire("movestart").fire("dragstart")},_onPreDrag:function(t){this._marker.options.autoPan&&(r(this._panRequest),this._panRequest=x(this._adjustPan.bind(this,t)))},_onDrag:function(t){var e=this._marker,i=e._shadow,n=Pe(e._icon),o=e._map.layerPointToLatLng(n);i&&Z(i,n),e._latlng=o,t.latlng=o,t.oldLatLng=this._oldLatLng,e.fire("move",t).fire("drag",t)},_onDragEnd:function(t){r(this._panRequest),delete this._oldLatLng,this._marker.fire("moveend").fire("dragend",t)}}),mi=o.extend({options:{icon:new _i,interactive:!0,keyboard:!0,title:"",alt:"Marker",zIndexOffset:0,opacity:1,riseOnHover:!1,riseOffset:250,pane:"markerPane",shadowPane:"shadowPane",bubblingMouseEvents:!1,autoPanOnFocus:!0,draggable:!1,autoPan:!1,autoPanPadding:[50,50],autoPanSpeed:10},initialize:function(t,e){c(this,e),this._latlng=w(t)},onAdd:function(t){this._zoomAnimated=this._zoomAnimated&&t.options.markerZoomAnimation,this._zoomAnimated&&t.on("zoomanim",this._animateZoom,this),this._initIcon(),this.update()},onRemove:function(t){this.dragging&&this.dragging.enabled()&&(this.options.draggable=!0,this.dragging.removeHooks()),delete this.dragging,this._zoomAnimated&&t.off("zoomanim",this._animateZoom,this),this._removeIcon(),this._removeShadow()},getEvents:function(){return{zoom:this.update,viewreset:this.update}},getLatLng:function(){return this._latlng},setLatLng:function(t){var e=this._latlng;return this._latlng=w(t),this.update(),this.fire("move",{oldLatLng:e,latlng:this._latlng})},setZIndexOffset:function(t){return this.options.zIndexOffset=t,this.update()},getIcon:function(){return this.options.icon},setIcon:function(t){return this.options.icon=t,this._map&&(this._initIcon(),this.update()),this._popup&&this.bindPopup(this._popup,this._popup.options),this},getElement:function(){return this._icon},update:function(){var t;return this._icon&&this._map&&(t=this._map.latLngToLayerPoint(this._latlng).round(),this._setPos(t)),this},_initIcon:function(){var t=this.options,e="leaflet-zoom-"+(this._zoomAnimated?"animated":"hide"),i=t.icon.createIcon(this._icon),n=!1,i=(i!==this._icon&&(this._icon&&this._removeIcon(),n=!0,t.title&&(i.title=t.title),"IMG"===i.tagName&&(i.alt=t.alt||"")),M(i,e),t.keyboard&&(i.tabIndex="0",i.setAttribute("role","button")),this._icon=i,t.riseOnHover&&this.on({mouseover:this._bringToFront,mouseout:this._resetZIndex}),this.options.autoPanOnFocus&&S(i,"focus",this._panOnFocus,this),t.icon.createShadow(this._shadow)),o=!1;i!==this._shadow&&(this._removeShadow(),o=!0),i&&(M(i,e),i.alt=""),this._shadow=i,t.opacity<1&&this._updateOpacity(),n&&this.getPane().appendChild(this._icon),this._initInteraction(),i&&o&&this.getPane(t.shadowPane).appendChild(this._shadow)},_removeIcon:function(){this.options.riseOnHover&&this.off({mouseover:this._bringToFront,mouseout:this._resetZIndex}),this.options.autoPanOnFocus&&k(this._icon,"focus",this._panOnFocus,this),T(this._icon),this.removeInteractiveTarget(this._icon),this._icon=null},_removeShadow:function(){this._shadow&&T(this._shadow),this._shadow=null},_setPos:function(t){this._icon&&Z(this._icon,t),this._shadow&&Z(this._shadow,t),this._zIndex=t.y+this.options.zIndexOffset,this._resetZIndex()},_updateZIndex:function(t){this._icon&&(this._icon.style.zIndex=this._zIndex+t)},_animateZoom:function(t){t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center).round();this._setPos(t)},_initInteraction:function(){var t;this.options.interactive&&(M(this._icon,"leaflet-interactive"),this.addInteractiveTarget(this._icon),pi&&(t=this.options.draggable,this.dragging&&(t=this.dragging.enabled(),this.dragging.disable()),this.dragging=new pi(this),t&&this.dragging.enable()))},setOpacity:function(t){return this.options.opacity=t,this._map&&this._updateOpacity(),this},_updateOpacity:function(){var t=this.options.opacity;this._icon&&C(this._icon,t),this._shadow&&C(this._shadow,t)},_bringToFront:function(){this._updateZIndex(this.options.riseOffset)},_resetZIndex:function(){this._updateZIndex(0)},_panOnFocus:function(){var t,e,i=this._map;i&&(t=(e=this.options.icon.options).iconSize?m(e.iconSize):m(0,0),e=e.iconAnchor?m(e.iconAnchor):m(0,0),i.panInside(this._latlng,{paddingTopLeft:e,paddingBottomRight:t.subtract(e)}))},_getPopupAnchor:function(){return this.options.icon.options.popupAnchor},_getTooltipAnchor:function(){return this.options.icon.options.tooltipAnchor}});var fi=o.extend({options:{stroke:!0,color:"#3388ff",weight:3,opacity:1,lineCap:"round",lineJoin:"round",dashArray:null,dashOffset:null,fill:!1,fillColor:null,fillOpacity:.2,fillRule:"evenodd",interactive:!0,bubblingMouseEvents:!0},beforeAdd:function(t){this._renderer=t.getRenderer(this)},onAdd:function(){this._renderer._initPath(this),this._reset(),this._renderer._addPath(this)},onRemove:function(){this._renderer._removePath(this)},redraw:function(){return this._map&&this._renderer._updatePath(this),this},setStyle:function(t){return c(this,t),this._renderer&&(this._renderer._updateStyle(this),this.options.stroke&&t&&Object.prototype.hasOwnProperty.call(t,"weight")&&this._updateBounds()),this},bringToFront:function(){return this._renderer&&this._renderer._bringToFront(this),this},bringToBack:function(){return this._renderer&&this._renderer._bringToBack(this),this},getElement:function(){return this._path},_reset:function(){this._project(),this._update()},_clickTolerance:function(){return(this.options.stroke?this.options.weight/2:0)+(this._renderer.options.tolerance||0)}}),gi=fi.extend({options:{fill:!0,radius:10},initialize:function(t,e){c(this,e),this._latlng=w(t),this._radius=this.options.radius},setLatLng:function(t){var e=this._latlng;return this._latlng=w(t),this.redraw(),this.fire("move",{oldLatLng:e,latlng:this._latlng})},getLatLng:function(){return this._latlng},setRadius:function(t){return this.options.radius=this._radius=t,this.redraw()},getRadius:function(){return this._radius},setStyle:function(t){var e=t&&t.radius||this._radius;return fi.prototype.setStyle.call(this,t),this.setRadius(e),this},_project:function(){this._point=this._map.latLngToLayerPoint(this._latlng),this._updateBounds()},_updateBounds:function(){var t=this._radius,e=this._radiusY||t,i=this._clickTolerance(),t=[t+i,e+i];this._pxBounds=new f(this._point.subtract(t),this._point.add(t))},_update:function(){this._map&&this._updatePath()},_updatePath:function(){this._renderer._updateCircle(this)},_empty:function(){return this._radius&&!this._renderer._bounds.intersects(this._pxBounds)},_containsPoint:function(t){return t.distanceTo(this._point)<=this._radius+this._clickTolerance()}});var vi=gi.extend({initialize:function(t,e,i){if(c(this,e="number"==typeof e?l({},i,{radius:e}):e),this._latlng=w(t),isNaN(this.options.radius))throw new Error("Circle radius cannot be NaN");this._mRadius=this.options.radius},setRadius:function(t){return this._mRadius=t,this.redraw()},getRadius:function(){return this._mRadius},getBounds:function(){var t=[this._radius,this._radiusY||this._radius];return new s(this._map.layerPointToLatLng(this._point.subtract(t)),this._map.layerPointToLatLng(this._point.add(t)))},setStyle:fi.prototype.setStyle,_project:function(){var t,e,i,n,o,s=this._latlng.lng,r=this._latlng.lat,a=this._map,h=a.options.crs;h.distance===st.distance?(n=Math.PI/180,o=this._mRadius/st.R/n,t=a.project([r+o,s]),e=a.project([r-o,s]),e=t.add(e).divideBy(2),i=a.unproject(e).lat,n=Math.acos((Math.cos(o*n)-Math.sin(r*n)*Math.sin(i*n))/(Math.cos(r*n)*Math.cos(i*n)))/n,!isNaN(n)&&0!==n||(n=o/Math.cos(Math.PI/180*r)),this._point=e.subtract(a.getPixelOrigin()),this._radius=isNaN(n)?0:e.x-a.project([i,s-n]).x,this._radiusY=e.y-t.y):(o=h.unproject(h.project(this._latlng).subtract([this._mRadius,0])),this._point=a.latLngToLayerPoint(this._latlng),this._radius=this._point.x-a.latLngToLayerPoint(o).x),this._updateBounds()}});var yi=fi.extend({options:{smoothFactor:1,noClip:!1},initialize:function(t,e){c(this,e),this._setLatLngs(t)},getLatLngs:function(){return this._latlngs},setLatLngs:function(t){return this._setLatLngs(t),this.redraw()},isEmpty:function(){return!this._latlngs.length},closestLayerPoint:function(t){for(var e=1/0,i=null,n=ri,o=0,s=this._parts.length;o<s;o++)for(var r=this._parts[o],a=1,h=r.length;a<h;a++){var l,u,c=n(t,l=r[a-1],u=r[a],!0);c<e&&(e=c,i=n(t,l,u))}return i&&(i.distance=Math.sqrt(e)),i},getCenter:function(){if(this._map)return hi(this._defaultShape(),this._map.options.crs);throw new Error("Must add layer to map before using getCenter()")},getBounds:function(){return this._bounds},addLatLng:function(t,e){return e=e||this._defaultShape(),t=w(t),e.push(t),this._bounds.extend(t),this.redraw()},_setLatLngs:function(t){this._bounds=new s,this._latlngs=this._convertLatLngs(t)},_defaultShape:function(){return I(this._latlngs)?this._latlngs:this._latlngs[0]},_convertLatLngs:function(t){for(var e=[],i=I(t),n=0,o=t.length;n<o;n++)i?(e[n]=w(t[n]),this._bounds.extend(e[n])):e[n]=this._convertLatLngs(t[n]);return e},_project:function(){var t=new f;this._rings=[],this._projectLatlngs(this._latlngs,this._rings,t),this._bounds.isValid()&&t.isValid()&&(this._rawPxBounds=t,this._updateBounds())},_updateBounds:function(){var t=this._clickTolerance(),t=new p(t,t);this._rawPxBounds&&(this._pxBounds=new f([this._rawPxBounds.min.subtract(t),this._rawPxBounds.max.add(t)]))},_projectLatlngs:function(t,e,i){var n,o,s=t[0]instanceof v,r=t.length;if(s){for(o=[],n=0;n<r;n++)o[n]=this._map.latLngToLayerPoint(t[n]),i.extend(o[n]);e.push(o)}else for(n=0;n<r;n++)this._projectLatlngs(t[n],e,i)},_clipPoints:function(){var t=this._renderer._bounds;if(this._parts=[],this._pxBounds&&this._pxBounds.intersects(t))if(this.options.noClip)this._parts=this._rings;else for(var e,i,n,o,s=this._parts,r=0,a=0,h=this._rings.length;r<h;r++)for(e=0,i=(o=this._rings[r]).length;e<i-1;e++)(n=ni(o[e],o[e+1],t,e,!0))&&(s[a]=s[a]||[],s[a].push(n[0]),n[1]===o[e+1]&&e!==i-2||(s[a].push(n[1]),a++))},_simplifyPoints:function(){for(var t=this._parts,e=this.options.smoothFactor,i=0,n=t.length;i<n;i++)t[i]=ei(t[i],e)},_update:function(){this._map&&(this._clipPoints(),this._simplifyPoints(),this._updatePath())},_updatePath:function(){this._renderer._updatePoly(this)},_containsPoint:function(t,e){var i,n,o,s,r,a,h=this._clickTolerance();if(this._pxBounds&&this._pxBounds.contains(t))for(i=0,s=this._parts.length;i<s;i++)for(n=0,o=(r=(a=this._parts[i]).length)-1;n<r;o=n++)if((e||0!==n)&&ii(t,a[o],a[n])<=h)return!0;return!1}});yi._flat=ai;var xi=yi.extend({options:{fill:!0},isEmpty:function(){return!this._latlngs.length||!this._latlngs[0].length},getCenter:function(){if(this._map)return $e(this._defaultShape(),this._map.options.crs);throw new Error("Must add layer to map before using getCenter()")},_convertLatLngs:function(t){var t=yi.prototype._convertLatLngs.call(this,t),e=t.length;return 2<=e&&t[0]instanceof v&&t[0].equals(t[e-1])&&t.pop(),t},_setLatLngs:function(t){yi.prototype._setLatLngs.call(this,t),I(this._latlngs)&&(this._latlngs=[this._latlngs])},_defaultShape:function(){return(I(this._latlngs[0])?this._latlngs:this._latlngs[0])[0]},_clipPoints:function(){var t=this._renderer._bounds,e=this.options.weight,e=new p(e,e),t=new f(t.min.subtract(e),t.max.add(e));if(this._parts=[],this._pxBounds&&this._pxBounds.intersects(t))if(this.options.noClip)this._parts=this._rings;else for(var i,n=0,o=this._rings.length;n<o;n++)(i=Je(this._rings[n],t,!0)).length&&this._parts.push(i)},_updatePath:function(){this._renderer._updatePoly(this,!0)},_containsPoint:function(t){var e,i,n,o,s,r,a,h,l=!1;if(!this._pxBounds||!this._pxBounds.contains(t))return!1;for(o=0,a=this._parts.length;o<a;o++)for(s=0,r=(h=(e=this._parts[o]).length)-1;s<h;r=s++)i=e[s],n=e[r],i.y>t.y!=n.y>t.y&&t.x<(n.x-i.x)*(t.y-i.y)/(n.y-i.y)+i.x&&(l=!l);return l||yi.prototype._containsPoint.call(this,t,!0)}});var wi=ci.extend({initialize:function(t,e){c(this,e),this._layers={},t&&this.addData(t)},addData:function(t){var e,i,n,o=d(t)?t:t.features;if(o){for(e=0,i=o.length;e<i;e++)((n=o[e]).geometries||n.geometry||n.features||n.coordinates)&&this.addData(n);return this}var s,r=this.options;return(!r.filter||r.filter(t))&&(s=bi(t,r))?(s.feature=Zi(t),s.defaultOptions=s.options,this.resetStyle(s),r.onEachFeature&&r.onEachFeature(t,s),this.addLayer(s)):this},resetStyle:function(t){return void 0===t?this.eachLayer(this.resetStyle,this):(t.options=l({},t.defaultOptions),this._setLayerStyle(t,this.options.style),this)},setStyle:function(e){return this.eachLayer(function(t){this._setLayerStyle(t,e)},this)},_setLayerStyle:function(t,e){t.setStyle&&("function"==typeof e&&(e=e(t.feature)),t.setStyle(e))}});function bi(t,e){var i,n,o,s,r="Feature"===t.type?t.geometry:t,a=r?r.coordinates:null,h=[],l=e&&e.pointToLayer,u=e&&e.coordsToLatLng||Li;if(!a&&!r)return null;switch(r.type){case"Point":return Pi(l,t,i=u(a),e);case"MultiPoint":for(o=0,s=a.length;o<s;o++)i=u(a[o]),h.push(Pi(l,t,i,e));return new ci(h);case"LineString":case"MultiLineString":return n=Ti(a,"LineString"===r.type?0:1,u),new yi(n,e);case"Polygon":case"MultiPolygon":return n=Ti(a,"Polygon"===r.type?1:2,u),new xi(n,e);case"GeometryCollection":for(o=0,s=r.geometries.length;o<s;o++){var c=bi({geometry:r.geometries[o],type:"Feature",properties:t.properties},e);c&&h.push(c)}return new ci(h);case"FeatureCollection":for(o=0,s=r.features.length;o<s;o++){var d=bi(r.features[o],e);d&&h.push(d)}return new ci(h);default:throw new Error("Invalid GeoJSON object.")}}function Pi(t,e,i,n){return t?t(e,i):new mi(i,n&&n.markersInheritOptions&&n)}function Li(t){return new v(t[1],t[0],t[2])}function Ti(t,e,i){for(var n,o=[],s=0,r=t.length;s<r;s++)n=e?Ti(t[s],e-1,i):(i||Li)(t[s]),o.push(n);return o}function Mi(t,e){return void 0!==(t=w(t)).alt?[i(t.lng,e),i(t.lat,e),i(t.alt,e)]:[i(t.lng,e),i(t.lat,e)]}function zi(t,e,i,n){for(var o=[],s=0,r=t.length;s<r;s++)o.push(e?zi(t[s],I(t[s])?0:e-1,i,n):Mi(t[s],n));return!e&&i&&0<o.length&&o.push(o[0].slice()),o}function Ci(t,e){return t.feature?l({},t.feature,{geometry:e}):Zi(e)}function Zi(t){return"Feature"===t.type||"FeatureCollection"===t.type?t:{type:"Feature",properties:{},geometry:t}}Tt={toGeoJSON:function(t){return Ci(this,{type:"Point",coordinates:Mi(this.getLatLng(),t)})}};function Si(t,e){return new wi(t,e)}mi.include(Tt),vi.include(Tt),gi.include(Tt),yi.include({toGeoJSON:function(t){var e=!I(this._latlngs);return Ci(this,{type:(e?"Multi":"")+"LineString",coordinates:zi(this._latlngs,e?1:0,!1,t)})}}),xi.include({toGeoJSON:function(t){var e=!I(this._latlngs),i=e&&!I(this._latlngs[0]),t=zi(this._latlngs,i?2:e?1:0,!0,t);return Ci(this,{type:(i?"Multi":"")+"Polygon",coordinates:t=e?t:[t]})}}),ui.include({toMultiPoint:function(e){var i=[];return this.eachLayer(function(t){i.push(t.toGeoJSON(e).geometry.coordinates)}),Ci(this,{type:"MultiPoint",coordinates:i})},toGeoJSON:function(e){var i,n,t=this.feature&&this.feature.geometry&&this.feature.geometry.type;return"MultiPoint"===t?this.toMultiPoint(e):(i="GeometryCollection"===t,n=[],this.eachLayer(function(t){t.toGeoJSON&&(t=t.toGeoJSON(e),i?n.push(t.geometry):"FeatureCollection"===(t=Zi(t)).type?n.push.apply(n,t.features):n.push(t))}),i?Ci(this,{geometries:n,type:"GeometryCollection"}):{type:"FeatureCollection",features:n})}});var Mt=Si,Ei=o.extend({options:{opacity:1,alt:"",interactive:!1,crossOrigin:!1,errorOverlayUrl:"",zIndex:1,className:""},initialize:function(t,e,i){this._url=t,this._bounds=g(e),c(this,i)},onAdd:function(){this._image||(this._initImage(),this.options.opacity<1&&this._updateOpacity()),this.options.interactive&&(M(this._image,"leaflet-interactive"),this.addInteractiveTarget(this._image)),this.getPane().appendChild(this._image),this._reset()},onRemove:function(){T(this._image),this.options.interactive&&this.removeInteractiveTarget(this._image)},setOpacity:function(t){return this.options.opacity=t,this._image&&this._updateOpacity(),this},setStyle:function(t){return t.opacity&&this.setOpacity(t.opacity),this},bringToFront:function(){return this._map&&fe(this._image),this},bringToBack:function(){return this._map&&ge(this._image),this},setUrl:function(t){return this._url=t,this._image&&(this._image.src=t),this},setBounds:function(t){return this._bounds=g(t),this._map&&this._reset(),this},getEvents:function(){var t={zoom:this._reset,viewreset:this._reset};return this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},setZIndex:function(t){return this.options.zIndex=t,this._updateZIndex(),this},getBounds:function(){return this._bounds},getElement:function(){return this._image},_initImage:function(){var t="IMG"===this._url.tagName,e=this._image=t?this._url:P("img");M(e,"leaflet-image-layer"),this._zoomAnimated&&M(e,"leaflet-zoom-animated"),this.options.className&&M(e,this.options.className),e.onselectstart=u,e.onmousemove=u,e.onload=a(this.fire,this,"load"),e.onerror=a(this._overlayOnError,this,"error"),!this.options.crossOrigin&&""!==this.options.crossOrigin||(e.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),this.options.zIndex&&this._updateZIndex(),t?this._url=e.src:(e.src=this._url,e.alt=this.options.alt)},_animateZoom:function(t){var e=this._map.getZoomScale(t.zoom),t=this._map._latLngBoundsToNewLayerBounds(this._bounds,t.zoom,t.center).min;be(this._image,t,e)},_reset:function(){var t=this._image,e=new f(this._map.latLngToLayerPoint(this._bounds.getNorthWest()),this._map.latLngToLayerPoint(this._bounds.getSouthEast())),i=e.getSize();Z(t,e.min),t.style.width=i.x+"px",t.style.height=i.y+"px"},_updateOpacity:function(){C(this._image,this.options.opacity)},_updateZIndex:function(){this._image&&void 0!==this.options.zIndex&&null!==this.options.zIndex&&(this._image.style.zIndex=this.options.zIndex)},_overlayOnError:function(){this.fire("error");var t=this.options.errorOverlayUrl;t&&this._url!==t&&(this._url=t,this._image.src=t)},getCenter:function(){return this._bounds.getCenter()}}),ki=Ei.extend({options:{autoplay:!0,loop:!0,keepAspectRatio:!0,muted:!1,playsInline:!0},_initImage:function(){var t="VIDEO"===this._url.tagName,e=this._image=t?this._url:P("video");if(M(e,"leaflet-image-layer"),this._zoomAnimated&&M(e,"leaflet-zoom-animated"),this.options.className&&M(e,this.options.className),e.onselectstart=u,e.onmousemove=u,e.onloadeddata=a(this.fire,this,"load"),t){for(var i=e.getElementsByTagName("source"),n=[],o=0;o<i.length;o++)n.push(i[o].src);this._url=0<i.length?n:[e.src]}else{d(this._url)||(this._url=[this._url]),!this.options.keepAspectRatio&&Object.prototype.hasOwnProperty.call(e.style,"objectFit")&&(e.style.objectFit="fill"),e.autoplay=!!this.options.autoplay,e.loop=!!this.options.loop,e.muted=!!this.options.muted,e.playsInline=!!this.options.playsInline;for(var s=0;s<this._url.length;s++){var r=P("source");r.src=this._url[s],e.appendChild(r)}}}});var Oi=Ei.extend({_initImage:function(){var t=this._image=this._url;M(t,"leaflet-image-layer"),this._zoomAnimated&&M(t,"leaflet-zoom-animated"),this.options.className&&M(t,this.options.className),t.onselectstart=u,t.onmousemove=u}});var Ai=o.extend({options:{interactive:!1,offset:[0,0],className:"",pane:void 0,content:""},initialize:function(t,e){t&&(t instanceof v||d(t))?(this._latlng=w(t),c(this,e)):(c(this,t),this._source=e),this.options.content&&(this._content=this.options.content)},openOn:function(t){return(t=arguments.length?t:this._source._map).hasLayer(this)||t.addLayer(this),this},close:function(){return this._map&&this._map.removeLayer(this),this},toggle:function(t){return this._map?this.close():(arguments.length?this._source=t:t=this._source,this._prepareOpen(),this.openOn(t._map)),this},onAdd:function(t){this._zoomAnimated=t._zoomAnimated,this._container||this._initLayout(),t._fadeAnimated&&C(this._container,0),clearTimeout(this._removeTimeout),this.getPane().appendChild(this._container),this.update(),t._fadeAnimated&&C(this._container,1),this.bringToFront(),this.options.interactive&&(M(this._container,"leaflet-interactive"),this.addInteractiveTarget(this._container))},onRemove:function(t){t._fadeAnimated?(C(this._container,0),this._removeTimeout=setTimeout(a(T,void 0,this._container),200)):T(this._container),this.options.interactive&&(z(this._container,"leaflet-interactive"),this.removeInteractiveTarget(this._container))},getLatLng:function(){return this._latlng},setLatLng:function(t){return this._latlng=w(t),this._map&&(this._updatePosition(),this._adjustPan()),this},getContent:function(){return this._content},setContent:function(t){return this._content=t,this.update(),this},getElement:function(){return this._container},update:function(){this._map&&(this._container.style.visibility="hidden",this._updateContent(),this._updateLayout(),this._updatePosition(),this._container.style.visibility="",this._adjustPan())},getEvents:function(){var t={zoom:this._updatePosition,viewreset:this._updatePosition};return this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},isOpen:function(){return!!this._map&&this._map.hasLayer(this)},bringToFront:function(){return this._map&&fe(this._container),this},bringToBack:function(){return this._map&&ge(this._container),this},_prepareOpen:function(t){if(!(i=this._source)._map)return!1;if(i instanceof ci){var e,i=null,n=this._source._layers;for(e in n)if(n[e]._map){i=n[e];break}if(!i)return!1;this._source=i}if(!t)if(i.getCenter)t=i.getCenter();else if(i.getLatLng)t=i.getLatLng();else{if(!i.getBounds)throw new Error("Unable to get source layer LatLng.");t=i.getBounds().getCenter()}return this.setLatLng(t),this._map&&this.update(),!0},_updateContent:function(){if(this._content){var t=this._contentNode,e="function"==typeof this._content?this._content(this._source||this):this._content;if("string"==typeof e)t.innerHTML=e;else{for(;t.hasChildNodes();)t.removeChild(t.firstChild);t.appendChild(e)}this.fire("contentupdate")}},_updatePosition:function(){var t,e,i;this._map&&(e=this._map.latLngToLayerPoint(this._latlng),t=m(this.options.offset),i=this._getAnchor(),this._zoomAnimated?Z(this._container,e.add(i)):t=t.add(e).add(i),e=this._containerBottom=-t.y,i=this._containerLeft=-Math.round(this._containerWidth/2)+t.x,this._container.style.bottom=e+"px",this._container.style.left=i+"px")},_getAnchor:function(){return[0,0]}}),Bi=(A.include({_initOverlay:function(t,e,i,n){var o=e;return o instanceof t||(o=new t(n).setContent(e)),i&&o.setLatLng(i),o}}),o.include({_initOverlay:function(t,e,i,n){var o=i;return o instanceof t?(c(o,n),o._source=this):(o=e&&!n?e:new t(n,this)).setContent(i),o}}),Ai.extend({options:{pane:"popupPane",offset:[0,7],maxWidth:300,minWidth:50,maxHeight:null,autoPan:!0,autoPanPaddingTopLeft:null,autoPanPaddingBottomRight:null,autoPanPadding:[5,5],keepInView:!1,closeButton:!0,autoClose:!0,closeOnEscapeKey:!0,className:""},openOn:function(t){return!(t=arguments.length?t:this._source._map).hasLayer(this)&&t._popup&&t._popup.options.autoClose&&t.removeLayer(t._popup),t._popup=this,Ai.prototype.openOn.call(this,t)},onAdd:function(t){Ai.prototype.onAdd.call(this,t),t.fire("popupopen",{popup:this}),this._source&&(this._source.fire("popupopen",{popup:this},!0),this._source instanceof fi||this._source.on("preclick",Ae))},onRemove:function(t){Ai.prototype.onRemove.call(this,t),t.fire("popupclose",{popup:this}),this._source&&(this._source.fire("popupclose",{popup:this},!0),this._source instanceof fi||this._source.off("preclick",Ae))},getEvents:function(){var t=Ai.prototype.getEvents.call(this);return(void 0!==this.options.closeOnClick?this.options.closeOnClick:this._map.options.closePopupOnClick)&&(t.preclick=this.close),this.options.keepInView&&(t.moveend=this._adjustPan),t},_initLayout:function(){var t="leaflet-popup",e=this._container=P("div",t+" "+(this.options.className||"")+" leaflet-zoom-animated"),i=this._wrapper=P("div",t+"-content-wrapper",e);this._contentNode=P("div",t+"-content",i),Ie(e),Be(this._contentNode),S(e,"contextmenu",Ae),this._tipContainer=P("div",t+"-tip-container",e),this._tip=P("div",t+"-tip",this._tipContainer),this.options.closeButton&&((i=this._closeButton=P("a",t+"-close-button",e)).setAttribute("role","button"),i.setAttribute("aria-label","Close popup"),i.href="#close",i.innerHTML='<span aria-hidden="true">&#215;</span>',S(i,"click",function(t){O(t),this.close()},this))},_updateLayout:function(){var t=this._contentNode,e=t.style,i=(e.width="",e.whiteSpace="nowrap",t.offsetWidth),i=Math.min(i,this.options.maxWidth),i=(i=Math.max(i,this.options.minWidth),e.width=i+1+"px",e.whiteSpace="",e.height="",t.offsetHeight),n=this.options.maxHeight,o="leaflet-popup-scrolled";(n&&n<i?(e.height=n+"px",M):z)(t,o),this._containerWidth=this._container.offsetWidth},_animateZoom:function(t){var t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center),e=this._getAnchor();Z(this._container,t.add(e))},_adjustPan:function(){var t,e,i,n,o,s,r,a;this.options.autoPan&&(this._map._panAnim&&this._map._panAnim.stop(),this._autopanning?this._autopanning=!1:(t=this._map,e=parseInt(pe(this._container,"marginBottom"),10)||0,e=this._container.offsetHeight+e,a=this._containerWidth,(i=new p(this._containerLeft,-e-this._containerBottom))._add(Pe(this._container)),i=t.layerPointToContainerPoint(i),o=m(this.options.autoPanPadding),n=m(this.options.autoPanPaddingTopLeft||o),o=m(this.options.autoPanPaddingBottomRight||o),s=t.getSize(),r=0,i.x+a+o.x>s.x&&(r=i.x+a-s.x+o.x),i.x-r-n.x<(a=0)&&(r=i.x-n.x),i.y+e+o.y>s.y&&(a=i.y+e-s.y+o.y),i.y-a-n.y<0&&(a=i.y-n.y),(r||a)&&(this.options.keepInView&&(this._autopanning=!0),t.fire("autopanstart").panBy([r,a]))))},_getAnchor:function(){return m(this._source&&this._source._getPopupAnchor?this._source._getPopupAnchor():[0,0])}})),Ii=(A.mergeOptions({closePopupOnClick:!0}),A.include({openPopup:function(t,e,i){return this._initOverlay(Bi,t,e,i).openOn(this),this},closePopup:function(t){return(t=arguments.length?t:this._popup)&&t.close(),this}}),o.include({bindPopup:function(t,e){return this._popup=this._initOverlay(Bi,this._popup,t,e),this._popupHandlersAdded||(this.on({click:this._openPopup,keypress:this._onKeyPress,remove:this.closePopup,move:this._movePopup}),this._popupHandlersAdded=!0),this},unbindPopup:function(){return this._popup&&(this.off({click:this._openPopup,keypress:this._onKeyPress,remove:this.closePopup,move:this._movePopup}),this._popupHandlersAdded=!1,this._popup=null),this},openPopup:function(t){return this._popup&&(this instanceof ci||(this._popup._source=this),this._popup._prepareOpen(t||this._latlng)&&this._popup.openOn(this._map)),this},closePopup:function(){return this._popup&&this._popup.close(),this},togglePopup:function(){return this._popup&&this._popup.toggle(this),this},isPopupOpen:function(){return!!this._popup&&this._popup.isOpen()},setPopupContent:function(t){return this._popup&&this._popup.setContent(t),this},getPopup:function(){return this._popup},_openPopup:function(t){var e;this._popup&&this._map&&(Re(t),e=t.layer||t.target,this._popup._source!==e||e instanceof fi?(this._popup._source=e,this.openPopup(t.latlng)):this._map.hasLayer(this._popup)?this.closePopup():this.openPopup(t.latlng))},_movePopup:function(t){this._popup.setLatLng(t.latlng)},_onKeyPress:function(t){13===t.originalEvent.keyCode&&this._openPopup(t)}}),Ai.extend({options:{pane:"tooltipPane",offset:[0,0],direction:"auto",permanent:!1,sticky:!1,opacity:.9},onAdd:function(t){Ai.prototype.onAdd.call(this,t),this.setOpacity(this.options.opacity),t.fire("tooltipopen",{tooltip:this}),this._source&&(this.addEventParent(this._source),this._source.fire("tooltipopen",{tooltip:this},!0))},onRemove:function(t){Ai.prototype.onRemove.call(this,t),t.fire("tooltipclose",{tooltip:this}),this._source&&(this.removeEventParent(this._source),this._source.fire("tooltipclose",{tooltip:this},!0))},getEvents:function(){var t=Ai.prototype.getEvents.call(this);return this.options.permanent||(t.preclick=this.close),t},_initLayout:function(){var t="leaflet-tooltip "+(this.options.className||"")+" leaflet-zoom-"+(this._zoomAnimated?"animated":"hide");this._contentNode=this._container=P("div",t),this._container.setAttribute("role","tooltip"),this._container.setAttribute("id","leaflet-tooltip-"+h(this))},_updateLayout:function(){},_adjustPan:function(){},_setPosition:function(t){var e,i=this._map,n=this._container,o=i.latLngToContainerPoint(i.getCenter()),i=i.layerPointToContainerPoint(t),s=this.options.direction,r=n.offsetWidth,a=n.offsetHeight,h=m(this.options.offset),l=this._getAnchor(),i="top"===s?(e=r/2,a):"bottom"===s?(e=r/2,0):(e="center"===s?r/2:"right"===s?0:"left"===s?r:i.x<o.x?(s="right",0):(s="left",r+2*(h.x+l.x)),a/2);t=t.subtract(m(e,i,!0)).add(h).add(l),z(n,"leaflet-tooltip-right"),z(n,"leaflet-tooltip-left"),z(n,"leaflet-tooltip-top"),z(n,"leaflet-tooltip-bottom"),M(n,"leaflet-tooltip-"+s),Z(n,t)},_updatePosition:function(){var t=this._map.latLngToLayerPoint(this._latlng);this._setPosition(t)},setOpacity:function(t){this.options.opacity=t,this._container&&C(this._container,t)},_animateZoom:function(t){t=this._map._latLngToNewLayerPoint(this._latlng,t.zoom,t.center);this._setPosition(t)},_getAnchor:function(){return m(this._source&&this._source._getTooltipAnchor&&!this.options.sticky?this._source._getTooltipAnchor():[0,0])}})),Ri=(A.include({openTooltip:function(t,e,i){return this._initOverlay(Ii,t,e,i).openOn(this),this},closeTooltip:function(t){return t.close(),this}}),o.include({bindTooltip:function(t,e){return this._tooltip&&this.isTooltipOpen()&&this.unbindTooltip(),this._tooltip=this._initOverlay(Ii,this._tooltip,t,e),this._initTooltipInteractions(),this._tooltip.options.permanent&&this._map&&this._map.hasLayer(this)&&this.openTooltip(),this},unbindTooltip:function(){return this._tooltip&&(this._initTooltipInteractions(!0),this.closeTooltip(),this._tooltip=null),this},_initTooltipInteractions:function(t){var e,i;!t&&this._tooltipHandlersAdded||(e=t?"off":"on",i={remove:this.closeTooltip,move:this._moveTooltip},this._tooltip.options.permanent?i.add=this._openTooltip:(i.mouseover=this._openTooltip,i.mouseout=this.closeTooltip,i.click=this._openTooltip,this._map?this._addFocusListeners():i.add=this._addFocusListeners),this._tooltip.options.sticky&&(i.mousemove=this._moveTooltip),this[e](i),this._tooltipHandlersAdded=!t)},openTooltip:function(t){return this._tooltip&&(this instanceof ci||(this._tooltip._source=this),this._tooltip._prepareOpen(t)&&(this._tooltip.openOn(this._map),this.getElement?this._setAriaDescribedByOnLayer(this):this.eachLayer&&this.eachLayer(this._setAriaDescribedByOnLayer,this))),this},closeTooltip:function(){if(this._tooltip)return this._tooltip.close()},toggleTooltip:function(){return this._tooltip&&this._tooltip.toggle(this),this},isTooltipOpen:function(){return this._tooltip.isOpen()},setTooltipContent:function(t){return this._tooltip&&this._tooltip.setContent(t),this},getTooltip:function(){return this._tooltip},_addFocusListeners:function(){this.getElement?this._addFocusListenersOnLayer(this):this.eachLayer&&this.eachLayer(this._addFocusListenersOnLayer,this)},_addFocusListenersOnLayer:function(t){var e="function"==typeof t.getElement&&t.getElement();e&&(S(e,"focus",function(){this._tooltip._source=t,this.openTooltip()},this),S(e,"blur",this.closeTooltip,this))},_setAriaDescribedByOnLayer:function(t){t="function"==typeof t.getElement&&t.getElement();t&&t.setAttribute("aria-describedby",this._tooltip._container.id)},_openTooltip:function(t){var e;this._tooltip&&this._map&&(this._map.dragging&&this._map.dragging.moving()&&!this._openOnceFlag?(this._openOnceFlag=!0,(e=this)._map.once("moveend",function(){e._openOnceFlag=!1,e._openTooltip(t)})):(this._tooltip._source=t.layer||t.target,this.openTooltip(this._tooltip.options.sticky?t.latlng:void 0)))},_moveTooltip:function(t){var e=t.latlng;this._tooltip.options.sticky&&t.originalEvent&&(t=this._map.mouseEventToContainerPoint(t.originalEvent),t=this._map.containerPointToLayerPoint(t),e=this._map.layerPointToLatLng(t)),this._tooltip.setLatLng(e)}}),di.extend({options:{iconSize:[12,12],html:!1,bgPos:null,className:"leaflet-div-icon"},createIcon:function(t){var t=t&&"DIV"===t.tagName?t:document.createElement("div"),e=this.options;return e.html instanceof Element?(me(t),t.appendChild(e.html)):t.innerHTML=!1!==e.html?e.html:"",e.bgPos&&(e=m(e.bgPos),t.style.backgroundPosition=-e.x+"px "+-e.y+"px"),this._setIconStyles(t,"icon"),t},createShadow:function(){return null}}));di.Default=_i;var Ni=o.extend({options:{tileSize:256,opacity:1,updateWhenIdle:b.mobile,updateWhenZooming:!0,updateInterval:200,zIndex:1,bounds:null,minZoom:0,maxZoom:void 0,maxNativeZoom:void 0,minNativeZoom:void 0,noWrap:!1,pane:"tilePane",className:"",keepBuffer:2},initialize:function(t){c(this,t)},onAdd:function(){this._initContainer(),this._levels={},this._tiles={},this._resetView()},beforeAdd:function(t){t._addZoomLimit(this)},onRemove:function(t){this._removeAllTiles(),T(this._container),t._removeZoomLimit(this),this._container=null,this._tileZoom=void 0},bringToFront:function(){return this._map&&(fe(this._container),this._setAutoZIndex(Math.max)),this},bringToBack:function(){return this._map&&(ge(this._container),this._setAutoZIndex(Math.min)),this},getContainer:function(){return this._container},setOpacity:function(t){return this.options.opacity=t,this._updateOpacity(),this},setZIndex:function(t){return this.options.zIndex=t,this._updateZIndex(),this},isLoading:function(){return this._loading},redraw:function(){var t;return this._map&&(this._removeAllTiles(),(t=this._clampZoom(this._map.getZoom()))!==this._tileZoom&&(this._tileZoom=t,this._updateLevels()),this._update()),this},getEvents:function(){var t={viewprereset:this._invalidateAll,viewreset:this._resetView,zoom:this._resetView,moveend:this._onMoveEnd};return this.options.updateWhenIdle||(this._onMove||(this._onMove=j(this._onMoveEnd,this.options.updateInterval,this)),t.move=this._onMove),this._zoomAnimated&&(t.zoomanim=this._animateZoom),t},createTile:function(){return document.createElement("div")},getTileSize:function(){var t=this.options.tileSize;return t instanceof p?t:new p(t,t)},_updateZIndex:function(){this._container&&void 0!==this.options.zIndex&&null!==this.options.zIndex&&(this._container.style.zIndex=this.options.zIndex)},_setAutoZIndex:function(t){for(var e,i=this.getPane().children,n=-t(-1/0,1/0),o=0,s=i.length;o<s;o++)e=i[o].style.zIndex,i[o]!==this._container&&e&&(n=t(n,+e));isFinite(n)&&(this.options.zIndex=n+t(-1,1),this._updateZIndex())},_updateOpacity:function(){if(this._map&&!b.ielt9){C(this._container,this.options.opacity);var t,e=+new Date,i=!1,n=!1;for(t in this._tiles){var o,s=this._tiles[t];s.current&&s.loaded&&(o=Math.min(1,(e-s.loaded)/200),C(s.el,o),o<1?i=!0:(s.active?n=!0:this._onOpaqueTile(s),s.active=!0))}n&&!this._noPrune&&this._pruneTiles(),i&&(r(this._fadeFrame),this._fadeFrame=x(this._updateOpacity,this))}},_onOpaqueTile:u,_initContainer:function(){this._container||(this._container=P("div","leaflet-layer "+(this.options.className||"")),this._updateZIndex(),this.options.opacity<1&&this._updateOpacity(),this.getPane().appendChild(this._container))},_updateLevels:function(){var t=this._tileZoom,e=this.options.maxZoom;if(void 0!==t){for(var i in this._levels)i=Number(i),this._levels[i].el.children.length||i===t?(this._levels[i].el.style.zIndex=e-Math.abs(t-i),this._onUpdateLevel(i)):(T(this._levels[i].el),this._removeTilesAtZoom(i),this._onRemoveLevel(i),delete this._levels[i]);var n=this._levels[t],o=this._map;return n||((n=this._levels[t]={}).el=P("div","leaflet-tile-container leaflet-zoom-animated",this._container),n.el.style.zIndex=e,n.origin=o.project(o.unproject(o.getPixelOrigin()),t).round(),n.zoom=t,this._setZoomTransform(n,o.getCenter(),o.getZoom()),u(n.el.offsetWidth),this._onCreateLevel(n)),this._level=n}},_onUpdateLevel:u,_onRemoveLevel:u,_onCreateLevel:u,_pruneTiles:function(){if(this._map){var t,e,i,n=this._map.getZoom();if(n>this.options.maxZoom||n<this.options.minZoom)this._removeAllTiles();else{for(t in this._tiles)(i=this._tiles[t]).retain=i.current;for(t in this._tiles)(i=this._tiles[t]).current&&!i.active&&(e=i.coords,this._retainParent(e.x,e.y,e.z,e.z-5)||this._retainChildren(e.x,e.y,e.z,e.z+2));for(t in this._tiles)this._tiles[t].retain||this._removeTile(t)}}},_removeTilesAtZoom:function(t){for(var e in this._tiles)this._tiles[e].coords.z===t&&this._removeTile(e)},_removeAllTiles:function(){for(var t in this._tiles)this._removeTile(t)},_invalidateAll:function(){for(var t in this._levels)T(this._levels[t].el),this._onRemoveLevel(Number(t)),delete this._levels[t];this._removeAllTiles(),this._tileZoom=void 0},_retainParent:function(t,e,i,n){var t=Math.floor(t/2),e=Math.floor(e/2),i=i-1,o=new p(+t,+e),o=(o.z=i,this._tileCoordsToKey(o)),o=this._tiles[o];return o&&o.active?o.retain=!0:(o&&o.loaded&&(o.retain=!0),n<i&&this._retainParent(t,e,i,n))},_retainChildren:function(t,e,i,n){for(var o=2*t;o<2*t+2;o++)for(var s=2*e;s<2*e+2;s++){var r=new p(o,s),r=(r.z=i+1,this._tileCoordsToKey(r)),r=this._tiles[r];r&&r.active?r.retain=!0:(r&&r.loaded&&(r.retain=!0),i+1<n&&this._retainChildren(o,s,i+1,n))}},_resetView:function(t){t=t&&(t.pinch||t.flyTo);this._setView(this._map.getCenter(),this._map.getZoom(),t,t)},_animateZoom:function(t){this._setView(t.center,t.zoom,!0,t.noUpdate)},_clampZoom:function(t){var e=this.options;return void 0!==e.minNativeZoom&&t<e.minNativeZoom?e.minNativeZoom:void 0!==e.maxNativeZoom&&e.maxNativeZoom<t?e.maxNativeZoom:t},_setView:function(t,e,i,n){var o=Math.round(e),o=void 0!==this.options.maxZoom&&o>this.options.maxZoom||void 0!==this.options.minZoom&&o<this.options.minZoom?void 0:this._clampZoom(o),s=this.options.updateWhenZooming&&o!==this._tileZoom;n&&!s||(this._tileZoom=o,this._abortLoading&&this._abortLoading(),this._updateLevels(),this._resetGrid(),void 0!==o&&this._update(t),i||this._pruneTiles(),this._noPrune=!!i),this._setZoomTransforms(t,e)},_setZoomTransforms:function(t,e){for(var i in this._levels)this._setZoomTransform(this._levels[i],t,e)},_setZoomTransform:function(t,e,i){var n=this._map.getZoomScale(i,t.zoom),e=t.origin.multiplyBy(n).subtract(this._map._getNewPixelOrigin(e,i)).round();b.any3d?be(t.el,e,n):Z(t.el,e)},_resetGrid:function(){var t=this._map,e=t.options.crs,i=this._tileSize=this.getTileSize(),n=this._tileZoom,o=this._map.getPixelWorldBounds(this._tileZoom);o&&(this._globalTileRange=this._pxBoundsToTileRange(o)),this._wrapX=e.wrapLng&&!this.options.noWrap&&[Math.floor(t.project([0,e.wrapLng[0]],n).x/i.x),Math.ceil(t.project([0,e.wrapLng[1]],n).x/i.y)],this._wrapY=e.wrapLat&&!this.options.noWrap&&[Math.floor(t.project([e.wrapLat[0],0],n).y/i.x),Math.ceil(t.project([e.wrapLat[1],0],n).y/i.y)]},_onMoveEnd:function(){this._map&&!this._map._animatingZoom&&this._update()},_getTiledPixelBounds:function(t){var e=this._map,i=e._animatingZoom?Math.max(e._animateToZoom,e.getZoom()):e.getZoom(),i=e.getZoomScale(i,this._tileZoom),t=e.project(t,this._tileZoom).floor(),e=e.getSize().divideBy(2*i);return new f(t.subtract(e),t.add(e))},_update:function(t){var e=this._map;if(e){var i=this._clampZoom(e.getZoom());if(void 0===t&&(t=e.getCenter()),void 0!==this._tileZoom){var n,e=this._getTiledPixelBounds(t),o=this._pxBoundsToTileRange(e),s=o.getCenter(),r=[],e=this.options.keepBuffer,a=new f(o.getBottomLeft().subtract([e,-e]),o.getTopRight().add([e,-e]));if(!(isFinite(o.min.x)&&isFinite(o.min.y)&&isFinite(o.max.x)&&isFinite(o.max.y)))throw new Error("Attempted to load an infinite number of tiles");for(n in this._tiles){var h=this._tiles[n].coords;h.z===this._tileZoom&&a.contains(new p(h.x,h.y))||(this._tiles[n].current=!1)}if(1<Math.abs(i-this._tileZoom))this._setView(t,i);else{for(var l=o.min.y;l<=o.max.y;l++)for(var u=o.min.x;u<=o.max.x;u++){var c,d=new p(u,l);d.z=this._tileZoom,this._isValidTile(d)&&((c=this._tiles[this._tileCoordsToKey(d)])?c.current=!0:r.push(d))}if(r.sort(function(t,e){return t.distanceTo(s)-e.distanceTo(s)}),0!==r.length){this._loading||(this._loading=!0,this.fire("loading"));for(var _=document.createDocumentFragment(),u=0;u<r.length;u++)this._addTile(r[u],_);this._level.el.appendChild(_)}}}}},_isValidTile:function(t){var e=this._map.options.crs;if(!e.infinite){var i=this._globalTileRange;if(!e.wrapLng&&(t.x<i.min.x||t.x>i.max.x)||!e.wrapLat&&(t.y<i.min.y||t.y>i.max.y))return!1}return!this.options.bounds||(e=this._tileCoordsToBounds(t),g(this.options.bounds).overlaps(e))},_keyToBounds:function(t){return this._tileCoordsToBounds(this._keyToTileCoords(t))},_tileCoordsToNwSe:function(t){var e=this._map,i=this.getTileSize(),n=t.scaleBy(i),i=n.add(i);return[e.unproject(n,t.z),e.unproject(i,t.z)]},_tileCoordsToBounds:function(t){t=this._tileCoordsToNwSe(t),t=new s(t[0],t[1]);return t=this.options.noWrap?t:this._map.wrapLatLngBounds(t)},_tileCoordsToKey:function(t){return t.x+":"+t.y+":"+t.z},_keyToTileCoords:function(t){var t=t.split(":"),e=new p(+t[0],+t[1]);return e.z=+t[2],e},_removeTile:function(t){var e=this._tiles[t];e&&(T(e.el),delete this._tiles[t],this.fire("tileunload",{tile:e.el,coords:this._keyToTileCoords(t)}))},_initTile:function(t){M(t,"leaflet-tile");var e=this.getTileSize();t.style.width=e.x+"px",t.style.height=e.y+"px",t.onselectstart=u,t.onmousemove=u,b.ielt9&&this.options.opacity<1&&C(t,this.options.opacity)},_addTile:function(t,e){var i=this._getTilePos(t),n=this._tileCoordsToKey(t),o=this.createTile(this._wrapCoords(t),a(this._tileReady,this,t));this._initTile(o),this.createTile.length<2&&x(a(this._tileReady,this,t,null,o)),Z(o,i),this._tiles[n]={el:o,coords:t,current:!0},e.appendChild(o),this.fire("tileloadstart",{tile:o,coords:t})},_tileReady:function(t,e,i){e&&this.fire("tileerror",{error:e,tile:i,coords:t});var n=this._tileCoordsToKey(t);(i=this._tiles[n])&&(i.loaded=+new Date,this._map._fadeAnimated?(C(i.el,0),r(this._fadeFrame),this._fadeFrame=x(this._updateOpacity,this)):(i.active=!0,this._pruneTiles()),e||(M(i.el,"leaflet-tile-loaded"),this.fire("tileload",{tile:i.el,coords:t})),this._noTilesToLoad()&&(this._loading=!1,this.fire("load"),b.ielt9||!this._map._fadeAnimated?x(this._pruneTiles,this):setTimeout(a(this._pruneTiles,this),250)))},_getTilePos:function(t){return t.scaleBy(this.getTileSize()).subtract(this._level.origin)},_wrapCoords:function(t){var e=new p(this._wrapX?H(t.x,this._wrapX):t.x,this._wrapY?H(t.y,this._wrapY):t.y);return e.z=t.z,e},_pxBoundsToTileRange:function(t){var e=this.getTileSize();return new f(t.min.unscaleBy(e).floor(),t.max.unscaleBy(e).ceil().subtract([1,1]))},_noTilesToLoad:function(){for(var t in this._tiles)if(!this._tiles[t].loaded)return!1;return!0}});var Di=Ni.extend({options:{minZoom:0,maxZoom:18,subdomains:"abc",errorTileUrl:"",zoomOffset:0,tms:!1,zoomReverse:!1,detectRetina:!1,crossOrigin:!1,referrerPolicy:!1},initialize:function(t,e){this._url=t,(e=c(this,e)).detectRetina&&b.retina&&0<e.maxZoom?(e.tileSize=Math.floor(e.tileSize/2),e.zoomReverse?(e.zoomOffset--,e.minZoom=Math.min(e.maxZoom,e.minZoom+1)):(e.zoomOffset++,e.maxZoom=Math.max(e.minZoom,e.maxZoom-1)),e.minZoom=Math.max(0,e.minZoom)):e.zoomReverse?e.minZoom=Math.min(e.maxZoom,e.minZoom):e.maxZoom=Math.max(e.minZoom,e.maxZoom),"string"==typeof e.subdomains&&(e.subdomains=e.subdomains.split("")),this.on("tileunload",this._onTileRemove)},setUrl:function(t,e){return this._url===t&&void 0===e&&(e=!0),this._url=t,e||this.redraw(),this},createTile:function(t,e){var i=document.createElement("img");return S(i,"load",a(this._tileOnLoad,this,e,i)),S(i,"error",a(this._tileOnError,this,e,i)),!this.options.crossOrigin&&""!==this.options.crossOrigin||(i.crossOrigin=!0===this.options.crossOrigin?"":this.options.crossOrigin),"string"==typeof this.options.referrerPolicy&&(i.referrerPolicy=this.options.referrerPolicy),i.alt="",i.src=this.getTileUrl(t),i},getTileUrl:function(t){var e={r:b.retina?"@2x":"",s:this._getSubdomain(t),x:t.x,y:t.y,z:this._getZoomForUrl()};return this._map&&!this._map.options.crs.infinite&&(t=this._globalTileRange.max.y-t.y,this.options.tms&&(e.y=t),e["-y"]=t),q(this._url,l(e,this.options))},_tileOnLoad:function(t,e){b.ielt9?setTimeout(a(t,this,null,e),0):t(null,e)},_tileOnError:function(t,e,i){var n=this.options.errorTileUrl;n&&e.getAttribute("src")!==n&&(e.src=n),t(i,e)},_onTileRemove:function(t){t.tile.onload=null},_getZoomForUrl:function(){var t=this._tileZoom,e=this.options.maxZoom;return(t=this.options.zoomReverse?e-t:t)+this.options.zoomOffset},_getSubdomain:function(t){t=Math.abs(t.x+t.y)%this.options.subdomains.length;return this.options.subdomains[t]},_abortLoading:function(){var t,e,i;for(t in this._tiles)this._tiles[t].coords.z!==this._tileZoom&&((i=this._tiles[t].el).onload=u,i.onerror=u,i.complete||(i.src=K,e=this._tiles[t].coords,T(i),delete this._tiles[t],this.fire("tileabort",{tile:i,coords:e})))},_removeTile:function(t){var e=this._tiles[t];if(e)return e.el.setAttribute("src",K),Ni.prototype._removeTile.call(this,t)},_tileReady:function(t,e,i){if(this._map&&(!i||i.getAttribute("src")!==K))return Ni.prototype._tileReady.call(this,t,e,i)}});function ji(t,e){return new Di(t,e)}var Hi=Di.extend({defaultWmsParams:{service:"WMS",request:"GetMap",layers:"",styles:"",format:"image/jpeg",transparent:!1,version:"1.1.1"},options:{crs:null,uppercase:!1},initialize:function(t,e){this._url=t;var i,n=l({},this.defaultWmsParams);for(i in e)i in this.options||(n[i]=e[i]);var t=(e=c(this,e)).detectRetina&&b.retina?2:1,o=this.getTileSize();n.width=o.x*t,n.height=o.y*t,this.wmsParams=n},onAdd:function(t){this._crs=this.options.crs||t.options.crs,this._wmsVersion=parseFloat(this.wmsParams.version);var e=1.3<=this._wmsVersion?"crs":"srs";this.wmsParams[e]=this._crs.code,Di.prototype.onAdd.call(this,t)},getTileUrl:function(t){var e=this._tileCoordsToNwSe(t),i=this._crs,i=_(i.project(e[0]),i.project(e[1])),e=i.min,i=i.max,e=(1.3<=this._wmsVersion&&this._crs===li?[e.y,e.x,i.y,i.x]:[e.x,e.y,i.x,i.y]).join(","),i=Di.prototype.getTileUrl.call(this,t);return i+U(this.wmsParams,i,this.options.uppercase)+(this.options.uppercase?"&BBOX=":"&bbox=")+e},setParams:function(t,e){return l(this.wmsParams,t),e||this.redraw(),this}});Di.WMS=Hi,ji.wms=function(t,e){return new Hi(t,e)};var Wi=o.extend({options:{padding:.1},initialize:function(t){c(this,t),h(this),this._layers=this._layers||{}},onAdd:function(){this._container||(this._initContainer(),M(this._container,"leaflet-zoom-animated")),this.getPane().appendChild(this._container),this._update(),this.on("update",this._updatePaths,this)},onRemove:function(){this.off("update",this._updatePaths,this),this._destroyContainer()},getEvents:function(){var t={viewreset:this._reset,zoom:this._onZoom,moveend:this._update,zoomend:this._onZoomEnd};return this._zoomAnimated&&(t.zoomanim=this._onAnimZoom),t},_onAnimZoom:function(t){this._updateTransform(t.center,t.zoom)},_onZoom:function(){this._updateTransform(this._map.getCenter(),this._map.getZoom())},_updateTransform:function(t,e){var i=this._map.getZoomScale(e,this._zoom),n=this._map.getSize().multiplyBy(.5+this.options.padding),o=this._map.project(this._center,e),n=n.multiplyBy(-i).add(o).subtract(this._map._getNewPixelOrigin(t,e));b.any3d?be(this._container,n,i):Z(this._container,n)},_reset:function(){for(var t in this._update(),this._updateTransform(this._center,this._zoom),this._layers)this._layers[t]._reset()},_onZoomEnd:function(){for(var t in this._layers)this._layers[t]._project()},_updatePaths:function(){for(var t in this._layers)this._layers[t]._update()},_update:function(){var t=this.options.padding,e=this._map.getSize(),i=this._map.containerPointToLayerPoint(e.multiplyBy(-t)).round();this._bounds=new f(i,i.add(e.multiplyBy(1+2*t)).round()),this._center=this._map.getCenter(),this._zoom=this._map.getZoom()}}),Fi=Wi.extend({options:{tolerance:0},getEvents:function(){var t=Wi.prototype.getEvents.call(this);return t.viewprereset=this._onViewPreReset,t},_onViewPreReset:function(){this._postponeUpdatePaths=!0},onAdd:function(){Wi.prototype.onAdd.call(this),this._draw()},_initContainer:function(){var t=this._container=document.createElement("canvas");S(t,"mousemove",this._onMouseMove,this),S(t,"click dblclick mousedown mouseup contextmenu",this._onClick,this),S(t,"mouseout",this._handleMouseOut,this),t._leaflet_disable_events=!0,this._ctx=t.getContext("2d")},_destroyContainer:function(){r(this._redrawRequest),delete this._ctx,T(this._container),k(this._container),delete this._container},_updatePaths:function(){if(!this._postponeUpdatePaths){for(var t in this._redrawBounds=null,this._layers)this._layers[t]._update();this._redraw()}},_update:function(){var t,e,i,n;this._map._animatingZoom&&this._bounds||(Wi.prototype._update.call(this),t=this._bounds,e=this._container,i=t.getSize(),n=b.retina?2:1,Z(e,t.min),e.width=n*i.x,e.height=n*i.y,e.style.width=i.x+"px",e.style.height=i.y+"px",b.retina&&this._ctx.scale(2,2),this._ctx.translate(-t.min.x,-t.min.y),this.fire("update"))},_reset:function(){Wi.prototype._reset.call(this),this._postponeUpdatePaths&&(this._postponeUpdatePaths=!1,this._updatePaths())},_initPath:function(t){this._updateDashArray(t);t=(this._layers[h(t)]=t)._order={layer:t,prev:this._drawLast,next:null};this._drawLast&&(this._drawLast.next=t),this._drawLast=t,this._drawFirst=this._drawFirst||this._drawLast},_addPath:function(t){this._requestRedraw(t)},_removePath:function(t){var e=t._order,i=e.next,e=e.prev;i?i.prev=e:this._drawLast=e,e?e.next=i:this._drawFirst=i,delete t._order,delete this._layers[h(t)],this._requestRedraw(t)},_updatePath:function(t){this._extendRedrawBounds(t),t._project(),t._update(),this._requestRedraw(t)},_updateStyle:function(t){this._updateDashArray(t),this._requestRedraw(t)},_updateDashArray:function(t){if("string"==typeof t.options.dashArray){for(var e,i=t.options.dashArray.split(/[, ]+/),n=[],o=0;o<i.length;o++){if(e=Number(i[o]),isNaN(e))return;n.push(e)}t.options._dashArray=n}else t.options._dashArray=t.options.dashArray},_requestRedraw:function(t){this._map&&(this._extendRedrawBounds(t),this._redrawRequest=this._redrawRequest||x(this._redraw,this))},_extendRedrawBounds:function(t){var e;t._pxBounds&&(e=(t.options.weight||0)+1,this._redrawBounds=this._redrawBounds||new f,this._redrawBounds.extend(t._pxBounds.min.subtract([e,e])),this._redrawBounds.extend(t._pxBounds.max.add([e,e])))},_redraw:function(){this._redrawRequest=null,this._redrawBounds&&(this._redrawBounds.min._floor(),this._redrawBounds.max._ceil()),this._clear(),this._draw(),this._redrawBounds=null},_clear:function(){var t,e=this._redrawBounds;e?(t=e.getSize(),this._ctx.clearRect(e.min.x,e.min.y,t.x,t.y)):(this._ctx.save(),this._ctx.setTransform(1,0,0,1,0,0),this._ctx.clearRect(0,0,this._container.width,this._container.height),this._ctx.restore())},_draw:function(){var t,e,i=this._redrawBounds;this._ctx.save(),i&&(e=i.getSize(),this._ctx.beginPath(),this._ctx.rect(i.min.x,i.min.y,e.x,e.y),this._ctx.clip()),this._drawing=!0;for(var n=this._drawFirst;n;n=n.next)t=n.layer,(!i||t._pxBounds&&t._pxBounds.intersects(i))&&t._updatePath();this._drawing=!1,this._ctx.restore()},_updatePoly:function(t,e){if(this._drawing){var i,n,o,s,r=t._parts,a=r.length,h=this._ctx;if(a){for(h.beginPath(),i=0;i<a;i++){for(n=0,o=r[i].length;n<o;n++)s=r[i][n],h[n?"lineTo":"moveTo"](s.x,s.y);e&&h.closePath()}this._fillStroke(h,t)}}},_updateCircle:function(t){var e,i,n,o;this._drawing&&!t._empty()&&(e=t._point,i=this._ctx,n=Math.max(Math.round(t._radius),1),1!=(o=(Math.max(Math.round(t._radiusY),1)||n)/n)&&(i.save(),i.scale(1,o)),i.beginPath(),i.arc(e.x,e.y/o,n,0,2*Math.PI,!1),1!=o&&i.restore(),this._fillStroke(i,t))},_fillStroke:function(t,e){var i=e.options;i.fill&&(t.globalAlpha=i.fillOpacity,t.fillStyle=i.fillColor||i.color,t.fill(i.fillRule||"evenodd")),i.stroke&&0!==i.weight&&(t.setLineDash&&t.setLineDash(e.options&&e.options._dashArray||[]),t.globalAlpha=i.opacity,t.lineWidth=i.weight,t.strokeStyle=i.color,t.lineCap=i.lineCap,t.lineJoin=i.lineJoin,t.stroke())},_onClick:function(t){for(var e,i,n=this._map.mouseEventToLayerPoint(t),o=this._drawFirst;o;o=o.next)(e=o.layer).options.interactive&&e._containsPoint(n)&&(("click"===t.type||"preclick"===t.type)&&this._map._draggableMoved(e)||(i=e));this._fireEvent(!!i&&[i],t)},_onMouseMove:function(t){var e;!this._map||this._map.dragging.moving()||this._map._animatingZoom||(e=this._map.mouseEventToLayerPoint(t),this._handleMouseHover(t,e))},_handleMouseOut:function(t){var e=this._hoveredLayer;e&&(z(this._container,"leaflet-interactive"),this._fireEvent([e],t,"mouseout"),this._hoveredLayer=null,this._mouseHoverThrottled=!1)},_handleMouseHover:function(t,e){if(!this._mouseHoverThrottled){for(var i,n,o=this._drawFirst;o;o=o.next)(i=o.layer).options.interactive&&i._containsPoint(e)&&(n=i);n!==this._hoveredLayer&&(this._handleMouseOut(t),n&&(M(this._container,"leaflet-interactive"),this._fireEvent([n],t,"mouseover"),this._hoveredLayer=n)),this._fireEvent(!!this._hoveredLayer&&[this._hoveredLayer],t),this._mouseHoverThrottled=!0,setTimeout(a(function(){this._mouseHoverThrottled=!1},this),32)}},_fireEvent:function(t,e,i){this._map._fireDOMEvent(e,i||e.type,t)},_bringToFront:function(t){var e,i,n=t._order;n&&(e=n.next,i=n.prev,e&&((e.prev=i)?i.next=e:e&&(this._drawFirst=e),n.prev=this._drawLast,(this._drawLast.next=n).next=null,this._drawLast=n,this._requestRedraw(t)))},_bringToBack:function(t){var e,i,n=t._order;n&&(e=n.next,(i=n.prev)&&((i.next=e)?e.prev=i:i&&(this._drawLast=i),n.prev=null,n.next=this._drawFirst,this._drawFirst.prev=n,this._drawFirst=n,this._requestRedraw(t)))}});function Ui(t){return b.canvas?new Fi(t):null}var Vi=function(){try{return document.namespaces.add("lvml","urn:schemas-microsoft-com:vml"),function(t){return document.createElement("<lvml:"+t+' class="lvml">')}}catch(t){}return function(t){return document.createElement("<"+t+' xmlns="urn:schemas-microsoft.com:vml" class="lvml">')}}(),zt={_initContainer:function(){this._container=P("div","leaflet-vml-container")},_update:function(){this._map._animatingZoom||(Wi.prototype._update.call(this),this.fire("update"))},_initPath:function(t){var e=t._container=Vi("shape");M(e,"leaflet-vml-shape "+(this.options.className||"")),e.coordsize="1 1",t._path=Vi("path"),e.appendChild(t._path),this._updateStyle(t),this._layers[h(t)]=t},_addPath:function(t){var e=t._container;this._container.appendChild(e),t.options.interactive&&t.addInteractiveTarget(e)},_removePath:function(t){var e=t._container;T(e),t.removeInteractiveTarget(e),delete this._layers[h(t)]},_updateStyle:function(t){var e=t._stroke,i=t._fill,n=t.options,o=t._container;o.stroked=!!n.stroke,o.filled=!!n.fill,n.stroke?(e=e||(t._stroke=Vi("stroke")),o.appendChild(e),e.weight=n.weight+"px",e.color=n.color,e.opacity=n.opacity,n.dashArray?e.dashStyle=d(n.dashArray)?n.dashArray.join(" "):n.dashArray.replace(/( *, *)/g," "):e.dashStyle="",e.endcap=n.lineCap.replace("butt","flat"),e.joinstyle=n.lineJoin):e&&(o.removeChild(e),t._stroke=null),n.fill?(i=i||(t._fill=Vi("fill")),o.appendChild(i),i.color=n.fillColor||n.color,i.opacity=n.fillOpacity):i&&(o.removeChild(i),t._fill=null)},_updateCircle:function(t){var e=t._point.round(),i=Math.round(t._radius),n=Math.round(t._radiusY||i);this._setPath(t,t._empty()?"M0 0":"AL "+e.x+","+e.y+" "+i+","+n+" 0,23592600")},_setPath:function(t,e){t._path.v=e},_bringToFront:function(t){fe(t._container)},_bringToBack:function(t){ge(t._container)}},qi=b.vml?Vi:ct,Gi=Wi.extend({_initContainer:function(){this._container=qi("svg"),this._container.setAttribute("pointer-events","none"),this._rootGroup=qi("g"),this._container.appendChild(this._rootGroup)},_destroyContainer:function(){T(this._container),k(this._container),delete this._container,delete this._rootGroup,delete this._svgSize},_update:function(){var t,e,i;this._map._animatingZoom&&this._bounds||(Wi.prototype._update.call(this),e=(t=this._bounds).getSize(),i=this._container,this._svgSize&&this._svgSize.equals(e)||(this._svgSize=e,i.setAttribute("width",e.x),i.setAttribute("height",e.y)),Z(i,t.min),i.setAttribute("viewBox",[t.min.x,t.min.y,e.x,e.y].join(" ")),this.fire("update"))},_initPath:function(t){var e=t._path=qi("path");t.options.className&&M(e,t.options.className),t.options.interactive&&M(e,"leaflet-interactive"),this._updateStyle(t),this._layers[h(t)]=t},_addPath:function(t){this._rootGroup||this._initContainer(),this._rootGroup.appendChild(t._path),t.addInteractiveTarget(t._path)},_removePath:function(t){T(t._path),t.removeInteractiveTarget(t._path),delete this._layers[h(t)]},_updatePath:function(t){t._project(),t._update()},_updateStyle:function(t){var e=t._path,t=t.options;e&&(t.stroke?(e.setAttribute("stroke",t.color),e.setAttribute("stroke-opacity",t.opacity),e.setAttribute("stroke-width",t.weight),e.setAttribute("stroke-linecap",t.lineCap),e.setAttribute("stroke-linejoin",t.lineJoin),t.dashArray?e.setAttribute("stroke-dasharray",t.dashArray):e.removeAttribute("stroke-dasharray"),t.dashOffset?e.setAttribute("stroke-dashoffset",t.dashOffset):e.removeAttribute("stroke-dashoffset")):e.setAttribute("stroke","none"),t.fill?(e.setAttribute("fill",t.fillColor||t.color),e.setAttribute("fill-opacity",t.fillOpacity),e.setAttribute("fill-rule",t.fillRule||"evenodd")):e.setAttribute("fill","none"))},_updatePoly:function(t,e){this._setPath(t,dt(t._parts,e))},_updateCircle:function(t){var e=t._point,i=Math.max(Math.round(t._radius),1),n="a"+i+","+(Math.max(Math.round(t._radiusY),1)||i)+" 0 1,0 ",e=t._empty()?"M0 0":"M"+(e.x-i)+","+e.y+n+2*i+",0 "+n+2*-i+",0 ";this._setPath(t,e)},_setPath:function(t,e){t._path.setAttribute("d",e)},_bringToFront:function(t){fe(t._path)},_bringToBack:function(t){ge(t._path)}});function Ki(t){return b.svg||b.vml?new Gi(t):null}b.vml&&Gi.include(zt),A.include({getRenderer:function(t){t=(t=t.options.renderer||this._getPaneRenderer(t.options.pane)||this.options.renderer||this._renderer)||(this._renderer=this._createRenderer());return this.hasLayer(t)||this.addLayer(t),t},_getPaneRenderer:function(t){var e;return"overlayPane"!==t&&void 0!==t&&(void 0===(e=this._paneRenderers[t])&&(e=this._createRenderer({pane:t}),this._paneRenderers[t]=e),e)},_createRenderer:function(t){return this.options.preferCanvas&&Ui(t)||Ki(t)}});var Yi=xi.extend({initialize:function(t,e){xi.prototype.initialize.call(this,this._boundsToLatLngs(t),e)},setBounds:function(t){return this.setLatLngs(this._boundsToLatLngs(t))},_boundsToLatLngs:function(t){return[(t=g(t)).getSouthWest(),t.getNorthWest(),t.getNorthEast(),t.getSouthEast()]}});Gi.create=qi,Gi.pointsToPath=dt,wi.geometryToLayer=bi,wi.coordsToLatLng=Li,wi.coordsToLatLngs=Ti,wi.latLngToCoords=Mi,wi.latLngsToCoords=zi,wi.getFeature=Ci,wi.asFeature=Zi,A.mergeOptions({boxZoom:!0});var _t=n.extend({initialize:function(t){this._map=t,this._container=t._container,this._pane=t._panes.overlayPane,this._resetStateTimeout=0,t.on("unload",this._destroy,this)},addHooks:function(){S(this._container,"mousedown",this._onMouseDown,this)},removeHooks:function(){k(this._container,"mousedown",this._onMouseDown,this)},moved:function(){return this._moved},_destroy:function(){T(this._pane),delete this._pane},_resetState:function(){this._resetStateTimeout=0,this._moved=!1},_clearDeferredResetState:function(){0!==this._resetStateTimeout&&(clearTimeout(this._resetStateTimeout),this._resetStateTimeout=0)},_onMouseDown:function(t){if(!t.shiftKey||1!==t.which&&1!==t.button)return!1;this._clearDeferredResetState(),this._resetState(),re(),Le(),this._startPoint=this._map.mouseEventToContainerPoint(t),S(document,{contextmenu:Re,mousemove:this._onMouseMove,mouseup:this._onMouseUp,keydown:this._onKeyDown},this)},_onMouseMove:function(t){this._moved||(this._moved=!0,this._box=P("div","leaflet-zoom-box",this._container),M(this._container,"leaflet-crosshair"),this._map.fire("boxzoomstart")),this._point=this._map.mouseEventToContainerPoint(t);var t=new f(this._point,this._startPoint),e=t.getSize();Z(this._box,t.min),this._box.style.width=e.x+"px",this._box.style.height=e.y+"px"},_finish:function(){this._moved&&(T(this._box),z(this._container,"leaflet-crosshair")),ae(),Te(),k(document,{contextmenu:Re,mousemove:this._onMouseMove,mouseup:this._onMouseUp,keydown:this._onKeyDown},this)},_onMouseUp:function(t){1!==t.which&&1!==t.button||(this._finish(),this._moved&&(this._clearDeferredResetState(),this._resetStateTimeout=setTimeout(a(this._resetState,this),0),t=new s(this._map.containerPointToLatLng(this._startPoint),this._map.containerPointToLatLng(this._point)),this._map.fitBounds(t).fire("boxzoomend",{boxZoomBounds:t})))},_onKeyDown:function(t){27===t.keyCode&&(this._finish(),this._clearDeferredResetState(),this._resetState())}}),Ct=(A.addInitHook("addHandler","boxZoom",_t),A.mergeOptions({doubleClickZoom:!0}),n.extend({addHooks:function(){this._map.on("dblclick",this._onDoubleClick,this)},removeHooks:function(){this._map.off("dblclick",this._onDoubleClick,this)},_onDoubleClick:function(t){var e=this._map,i=e.getZoom(),n=e.options.zoomDelta,i=t.originalEvent.shiftKey?i-n:i+n;"center"===e.options.doubleClickZoom?e.setZoom(i):e.setZoomAround(t.containerPoint,i)}})),Zt=(A.addInitHook("addHandler","doubleClickZoom",Ct),A.mergeOptions({dragging:!0,inertia:!0,inertiaDeceleration:3400,inertiaMaxSpeed:1/0,easeLinearity:.2,worldCopyJump:!1,maxBoundsViscosity:0}),n.extend({addHooks:function(){var t;this._draggable||(t=this._map,this._draggable=new Xe(t._mapPane,t._container),this._draggable.on({dragstart:this._onDragStart,drag:this._onDrag,dragend:this._onDragEnd},this),this._draggable.on("predrag",this._onPreDragLimit,this),t.options.worldCopyJump&&(this._draggable.on("predrag",this._onPreDragWrap,this),t.on("zoomend",this._onZoomEnd,this),t.whenReady(this._onZoomEnd,this))),M(this._map._container,"leaflet-grab leaflet-touch-drag"),this._draggable.enable(),this._positions=[],this._times=[]},removeHooks:function(){z(this._map._container,"leaflet-grab"),z(this._map._container,"leaflet-touch-drag"),this._draggable.disable()},moved:function(){return this._draggable&&this._draggable._moved},moving:function(){return this._draggable&&this._draggable._moving},_onDragStart:function(){var t,e=this._map;e._stop(),this._map.options.maxBounds&&this._map.options.maxBoundsViscosity?(t=g(this._map.options.maxBounds),this._offsetLimit=_(this._map.latLngToContainerPoint(t.getNorthWest()).multiplyBy(-1),this._map.latLngToContainerPoint(t.getSouthEast()).multiplyBy(-1).add(this._map.getSize())),this._viscosity=Math.min(1,Math.max(0,this._map.options.maxBoundsViscosity))):this._offsetLimit=null,e.fire("movestart").fire("dragstart"),e.options.inertia&&(this._positions=[],this._times=[])},_onDrag:function(t){var e,i;this._map.options.inertia&&(e=this._lastTime=+new Date,i=this._lastPos=this._draggable._absPos||this._draggable._newPos,this._positions.push(i),this._times.push(e),this._prunePositions(e)),this._map.fire("move",t).fire("drag",t)},_prunePositions:function(t){for(;1<this._positions.length&&50<t-this._times[0];)this._positions.shift(),this._times.shift()},_onZoomEnd:function(){var t=this._map.getSize().divideBy(2),e=this._map.latLngToLayerPoint([0,0]);this._initialWorldOffset=e.subtract(t).x,this._worldWidth=this._map.getPixelWorldBounds().getSize().x},_viscousLimit:function(t,e){return t-(t-e)*this._viscosity},_onPreDragLimit:function(){var t,e;this._viscosity&&this._offsetLimit&&(t=this._draggable._newPos.subtract(this._draggable._startPos),e=this._offsetLimit,t.x<e.min.x&&(t.x=this._viscousLimit(t.x,e.min.x)),t.y<e.min.y&&(t.y=this._viscousLimit(t.y,e.min.y)),t.x>e.max.x&&(t.x=this._viscousLimit(t.x,e.max.x)),t.y>e.max.y&&(t.y=this._viscousLimit(t.y,e.max.y)),this._draggable._newPos=this._draggable._startPos.add(t))},_onPreDragWrap:function(){var t=this._worldWidth,e=Math.round(t/2),i=this._initialWorldOffset,n=this._draggable._newPos.x,o=(n-e+i)%t+e-i,n=(n+e+i)%t-e-i,t=Math.abs(o+i)<Math.abs(n+i)?o:n;this._draggable._absPos=this._draggable._newPos.clone(),this._draggable._newPos.x=t},_onDragEnd:function(t){var e,i,n,o,s=this._map,r=s.options,a=!r.inertia||t.noInertia||this._times.length<2;s.fire("dragend",t),!a&&(this._prunePositions(+new Date),t=this._lastPos.subtract(this._positions[0]),a=(this._lastTime-this._times[0])/1e3,e=r.easeLinearity,a=(t=t.multiplyBy(e/a)).distanceTo([0,0]),i=Math.min(r.inertiaMaxSpeed,a),t=t.multiplyBy(i/a),n=i/(r.inertiaDeceleration*e),(o=t.multiplyBy(-n/2).round()).x||o.y)?(o=s._limitOffset(o,s.options.maxBounds),x(function(){s.panBy(o,{duration:n,easeLinearity:e,noMoveStart:!0,animate:!0})})):s.fire("moveend")}})),St=(A.addInitHook("addHandler","dragging",Zt),A.mergeOptions({keyboard:!0,keyboardPanDelta:80}),n.extend({keyCodes:{left:[37],right:[39],down:[40],up:[38],zoomIn:[187,107,61,171],zoomOut:[189,109,54,173]},initialize:function(t){this._map=t,this._setPanDelta(t.options.keyboardPanDelta),this._setZoomDelta(t.options.zoomDelta)},addHooks:function(){var t=this._map._container;t.tabIndex<=0&&(t.tabIndex="0"),S(t,{focus:this._onFocus,blur:this._onBlur,mousedown:this._onMouseDown},this),this._map.on({focus:this._addHooks,blur:this._removeHooks},this)},removeHooks:function(){this._removeHooks(),k(this._map._container,{focus:this._onFocus,blur:this._onBlur,mousedown:this._onMouseDown},this),this._map.off({focus:this._addHooks,blur:this._removeHooks},this)},_onMouseDown:function(){var t,e,i;this._focused||(i=document.body,t=document.documentElement,e=i.scrollTop||t.scrollTop,i=i.scrollLeft||t.scrollLeft,this._map._container.focus(),window.scrollTo(i,e))},_onFocus:function(){this._focused=!0,this._map.fire("focus")},_onBlur:function(){this._focused=!1,this._map.fire("blur")},_setPanDelta:function(t){for(var e=this._panKeys={},i=this.keyCodes,n=0,o=i.left.length;n<o;n++)e[i.left[n]]=[-1*t,0];for(n=0,o=i.right.length;n<o;n++)e[i.right[n]]=[t,0];for(n=0,o=i.down.length;n<o;n++)e[i.down[n]]=[0,t];for(n=0,o=i.up.length;n<o;n++)e[i.up[n]]=[0,-1*t]},_setZoomDelta:function(t){for(var e=this._zoomKeys={},i=this.keyCodes,n=0,o=i.zoomIn.length;n<o;n++)e[i.zoomIn[n]]=t;for(n=0,o=i.zoomOut.length;n<o;n++)e[i.zoomOut[n]]=-t},_addHooks:function(){S(document,"keydown",this._onKeyDown,this)},_removeHooks:function(){k(document,"keydown",this._onKeyDown,this)},_onKeyDown:function(t){if(!(t.altKey||t.ctrlKey||t.metaKey)){var e,i,n=t.keyCode,o=this._map;if(n in this._panKeys)o._panAnim&&o._panAnim._inProgress||(i=this._panKeys[n],t.shiftKey&&(i=m(i).multiplyBy(3)),o.options.maxBounds&&(i=o._limitOffset(m(i),o.options.maxBounds)),o.options.worldCopyJump?(e=o.wrapLatLng(o.unproject(o.project(o.getCenter()).add(i))),o.panTo(e)):o.panBy(i));else if(n in this._zoomKeys)o.setZoom(o.getZoom()+(t.shiftKey?3:1)*this._zoomKeys[n]);else{if(27!==n||!o._popup||!o._popup.options.closeOnEscapeKey)return;o.closePopup()}Re(t)}}})),Et=(A.addInitHook("addHandler","keyboard",St),A.mergeOptions({scrollWheelZoom:!0,wheelDebounceTime:40,wheelPxPerZoomLevel:60}),n.extend({addHooks:function(){S(this._map._container,"wheel",this._onWheelScroll,this),this._delta=0},removeHooks:function(){k(this._map._container,"wheel",this._onWheelScroll,this)},_onWheelScroll:function(t){var e=He(t),i=this._map.options.wheelDebounceTime,e=(this._delta+=e,this._lastMousePos=this._map.mouseEventToContainerPoint(t),this._startTime||(this._startTime=+new Date),Math.max(i-(+new Date-this._startTime),0));clearTimeout(this._timer),this._timer=setTimeout(a(this._performZoom,this),e),Re(t)},_performZoom:function(){var t=this._map,e=t.getZoom(),i=this._map.options.zoomSnap||0,n=(t._stop(),this._delta/(4*this._map.options.wheelPxPerZoomLevel)),n=4*Math.log(2/(1+Math.exp(-Math.abs(n))))/Math.LN2,i=i?Math.ceil(n/i)*i:n,n=t._limitZoom(e+(0<this._delta?i:-i))-e;this._delta=0,this._startTime=null,n&&("center"===t.options.scrollWheelZoom?t.setZoom(e+n):t.setZoomAround(this._lastMousePos,e+n))}})),kt=(A.addInitHook("addHandler","scrollWheelZoom",Et),A.mergeOptions({tapHold:b.touchNative&&b.safari&&b.mobile,tapTolerance:15}),n.extend({addHooks:function(){S(this._map._container,"touchstart",this._onDown,this)},removeHooks:function(){k(this._map._container,"touchstart",this._onDown,this)},_onDown:function(t){var e;clearTimeout(this._holdTimeout),1===t.touches.length&&(e=t.touches[0],this._startPos=this._newPos=new p(e.clientX,e.clientY),this._holdTimeout=setTimeout(a(function(){this._cancel(),this._isTapValid()&&(S(document,"touchend",O),S(document,"touchend touchcancel",this._cancelClickPrevent),this._simulateEvent("contextmenu",e))},this),600),S(document,"touchend touchcancel contextmenu",this._cancel,this),S(document,"touchmove",this._onMove,this))},_cancelClickPrevent:function t(){k(document,"touchend",O),k(document,"touchend touchcancel",t)},_cancel:function(){clearTimeout(this._holdTimeout),k(document,"touchend touchcancel contextmenu",this._cancel,this),k(document,"touchmove",this._onMove,this)},_onMove:function(t){t=t.touches[0];this._newPos=new p(t.clientX,t.clientY)},_isTapValid:function(){return this._newPos.distanceTo(this._startPos)<=this._map.options.tapTolerance},_simulateEvent:function(t,e){t=new MouseEvent(t,{bubbles:!0,cancelable:!0,view:window,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY});t._simulated=!0,e.target.dispatchEvent(t)}})),Ot=(A.addInitHook("addHandler","tapHold",kt),A.mergeOptions({touchZoom:b.touch,bounceAtZoomLimits:!0}),n.extend({addHooks:function(){M(this._map._container,"leaflet-touch-zoom"),S(this._map._container,"touchstart",this._onTouchStart,this)},removeHooks:function(){z(this._map._container,"leaflet-touch-zoom"),k(this._map._container,"touchstart",this._onTouchStart,this)},_onTouchStart:function(t){var e,i,n=this._map;!t.touches||2!==t.touches.length||n._animatingZoom||this._zooming||(e=n.mouseEventToContainerPoint(t.touches[0]),i=n.mouseEventToContainerPoint(t.touches[1]),this._centerPoint=n.getSize()._divideBy(2),this._startLatLng=n.containerPointToLatLng(this._centerPoint),"center"!==n.options.touchZoom&&(this._pinchStartLatLng=n.containerPointToLatLng(e.add(i)._divideBy(2))),this._startDist=e.distanceTo(i),this._startZoom=n.getZoom(),this._moved=!1,this._zooming=!0,n._stop(),S(document,"touchmove",this._onTouchMove,this),S(document,"touchend touchcancel",this._onTouchEnd,this),O(t))},_onTouchMove:function(t){if(t.touches&&2===t.touches.length&&this._zooming){var e=this._map,i=e.mouseEventToContainerPoint(t.touches[0]),n=e.mouseEventToContainerPoint(t.touches[1]),o=i.distanceTo(n)/this._startDist;if(this._zoom=e.getScaleZoom(o,this._startZoom),!e.options.bounceAtZoomLimits&&(this._zoom<e.getMinZoom()&&o<1||this._zoom>e.getMaxZoom()&&1<o)&&(this._zoom=e._limitZoom(this._zoom)),"center"===e.options.touchZoom){if(this._center=this._startLatLng,1==o)return}else{i=i._add(n)._divideBy(2)._subtract(this._centerPoint);if(1==o&&0===i.x&&0===i.y)return;this._center=e.unproject(e.project(this._pinchStartLatLng,this._zoom).subtract(i),this._zoom)}this._moved||(e._moveStart(!0,!1),this._moved=!0),r(this._animRequest);n=a(e._move,e,this._center,this._zoom,{pinch:!0,round:!1},void 0);this._animRequest=x(n,this,!0),O(t)}},_onTouchEnd:function(){this._moved&&this._zooming?(this._zooming=!1,r(this._animRequest),k(document,"touchmove",this._onTouchMove,this),k(document,"touchend touchcancel",this._onTouchEnd,this),this._map.options.zoomAnimation?this._map._animateZoom(this._center,this._map._limitZoom(this._zoom),!0,this._map.options.zoomSnap):this._map._resetView(this._center,this._map._limitZoom(this._zoom))):this._zooming=!1}})),Xi=(A.addInitHook("addHandler","touchZoom",Ot),A.BoxZoom=_t,A.DoubleClickZoom=Ct,A.Drag=Zt,A.Keyboard=St,A.ScrollWheelZoom=Et,A.TapHold=kt,A.TouchZoom=Ot,t.Bounds=f,t.Browser=b,t.CRS=ot,t.Canvas=Fi,t.Circle=vi,t.CircleMarker=gi,t.Class=et,t.Control=B,t.DivIcon=Ri,t.DivOverlay=Ai,t.DomEvent=mt,t.DomUtil=pt,t.Draggable=Xe,t.Evented=it,t.FeatureGroup=ci,t.GeoJSON=wi,t.GridLayer=Ni,t.Handler=n,t.Icon=di,t.ImageOverlay=Ei,t.LatLng=v,t.LatLngBounds=s,t.Layer=o,t.LayerGroup=ui,t.LineUtil=vt,t.Map=A,t.Marker=mi,t.Mixin=ft,t.Path=fi,t.Point=p,t.PolyUtil=gt,t.Polygon=xi,t.Polyline=yi,t.Popup=Bi,t.PosAnimation=Fe,t.Projection=wt,t.Rectangle=Yi,t.Renderer=Wi,t.SVG=Gi,t.SVGOverlay=Oi,t.TileLayer=Di,t.Tooltip=Ii,t.Transformation=at,t.Util=tt,t.VideoOverlay=ki,t.bind=a,t.bounds=_,t.canvas=Ui,t.circle=function(t,e,i){return new vi(t,e,i)},t.circleMarker=function(t,e){return new gi(t,e)},t.control=Ue,t.divIcon=function(t){return new Ri(t)},t.extend=l,t.featureGroup=function(t,e){return new ci(t,e)},t.geoJSON=Si,t.geoJson=Mt,t.gridLayer=function(t){return new Ni(t)},t.icon=function(t){return new di(t)},t.imageOverlay=function(t,e,i){return new Ei(t,e,i)},t.latLng=w,t.latLngBounds=g,t.layerGroup=function(t,e){return new ui(t,e)},t.map=function(t,e){return new A(t,e)},t.marker=function(t,e){return new mi(t,e)},t.point=m,t.polygon=function(t,e){return new xi(t,e)},t.polyline=function(t,e){return new yi(t,e)},t.popup=function(t,e){return new Bi(t,e)},t.rectangle=function(t,e){return new Yi(t,e)},t.setOptions=c,t.stamp=h,t.svg=Ki,t.svgOverlay=function(t,e,i){return new Oi(t,e,i)},t.tileLayer=ji,t.tooltip=function(t,e){return new Ii(t,e)},t.transformation=ht,t.version="1.9.4",t.videoOverlay=function(t,e,i){return new ki(t,e,i)},window.L);t.noConflict=function(){return window.L=Xi,this},window.L=t});
/* Leaflet-Instanz festhalten, unabhängig davon, was später an `window.L` hängt. */
  } catch (error) {
    console.warn("busch-map-card: Leaflet liess sich nicht laden", error);
  }
  return window.L || null;
}


/* ═══════════════════════════════════════════════════════════════════════════
 * Karten-Karte — die eingebaute `map`-Karte mit frei wählbaren Kacheln.
 *
 * Der Kniff: Diese Karte baut die Landkarte NICHT nach. Sie erzeugt Home
 * Assistants eigene `map`-Karte, hängt sie in ihren Shadow-DOM und tauscht
 * danach nur die Kachelebene aus. Alles andere — Entitäten, Zonenkreise,
 * `hours_to_show`-Spuren, Genauigkeitsringe, Personenbilder, Beschriftungen,
 * `auto_fit`, `cluster` — bleibt identisch, weil es dieselbe Karte IST.
 *
 * Nachbauen wäre der teurere Weg: 14 Optionen plus sechs Felder je Entität,
 * und bei jedem Home-Assistant-Update droht neue Abweichung.
 *
 * Der Preis ist eine Abhängigkeit von HA-Interna (`ha-map.leafletMap`).
 * Deshalb gilt: Bricht der Kniff, faellt die Karte auf HAs normale Karte mit
 * deren eigenen Kacheln zurueck — niemals auf eine leere Karte.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kachelvorlagen. Alle ohne Schlüssel nutzbar.
 *
 * Die Quellenangabe je Vorlage ist keine Kosmetik: OpenStreetMap, CARTO, Esri
 * und OpenTopoMap verlangen sie in ihren Nutzungsbedingungen. Wer eine eigene
 * URL einträgt, traegt auch die eigene Angabe ein.
 *
 * `{r}` ersetzt Leaflet durch "@2x" nur bei `detectRetina`, sonst durch nichts
 * — das Feld darf also gefahrlos in der URL stehen.
 */
const MAP_STYLES = {
  ha: {
    name: "Home-Assistant-Standard",
    keep: true,   // Kacheln gar nicht anfassen
  },
  osm: {
    name: "OpenStreetMap",
    light: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  carto: {
    name: "CARTO Positron / Dark Matter",
    keyParam: "key",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  voyager: {
    name: "CARTO Voyager",
    keyParam: "key",
    light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    dark: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    name: "Esri Satellit",
    light: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: 'Kacheln &copy; Esri — Quellen: Esri, Maxar, Earthstar Geographics und die GIS-Gemeinschaft',
  },
  topo: {
    name: "OpenTopoMap",
    light: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attribution: 'Kartendaten &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://viewfinderpanoramas.org">SRTM</a> · Darstellung &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
  custom: {
    name: "Eigene URL",
    custom: true,
  },
};

const MAP_CARD_DEFAULTS = { map_style: "carto" };

/** Wo der Schluessel liegt, wenn er nicht in der Karte steht.
 *
 *  Ein Kachelschluessel gehoert EINMAL ins System, nicht in jede Karte. Ein
 *  `input_text`-Helfer ist dafuer der richtige Ort: er wird einmal angelegt,
 *  gilt fuer alle Dashboards und alle Geraete, und er landet nie in diesem
 *  oeffentlichen Repo. Wer mehrere Anbieter mischt, zeigt je Karte mit
 *  `tile_api_key_entity` auf einen anderen Helfer. */
const MAP_KEY_ENTITY = "input_text.carto_api_key";

/** Eigene Leaflet-Ebene fuer den Vektorfall. Fester Name, damit ein zweiter
 *  Aufruf dieselbe Ebene wiederfindet statt eine weitere anzulegen. */
const MAP_PANE = "busch-map-tiles";

/** Eigene Optionen der Karte — alles Uebrige gehoert der eingebauten Karte. */
const MAP_OWN_KEYS = [
  "map_style", "tile_url", "tile_url_dark", "tile_attribution", "tile_max_zoom",
  "tile_api_key", "tile_api_key_entity",
];

const SCHEMA_BUSCH_MAP_CARD = [
  {
    name: "map_style",
    selector: {
      select: {
        mode: "dropdown",
        // Die Beschriftungen der Vorlagen sind Eigennamen (OpenStreetMap,
        // CARTO, Esri) und in beiden Sprachen gleich. Nur `ha` und `custom`
        // heissen anders — `buschSchemaMitTexten` ersetzt genau die beiden
        // aus `texte.map_style_ha` bzw. `texte.map_style_custom`.
        options: Object.entries(MAP_STYLES).map(([value, s]) => ({ value, label: s.name })),
      },
    },
  },
  { name: "tile_url", selector: { text: {} } },
  { name: "tile_url_dark", selector: { text: {} } },
  { name: "tile_attribution", selector: { text: {} } },
  { name: "tile_max_zoom", selector: { number: { min: 1, max: 22, step: 1, mode: "box" } } },
  { name: "tile_api_key", selector: { text: {} } },
  {
    name: "tile_api_key_entity",
    selector: { entity: { filter: { domain: ["input_text"] } } },
  },
];

const TEXTE_BUSCH_MAP_CARD = {
  de: {
    name: "Busch Landkarte",
    description: "Die eingebaute Map-Karte mit frei wählbaren Kacheln — nur der Typ wird getauscht.",
    labels: {
      map_style: "Kartenvorlage",
      tile_url: "Eigene Kachel-URL",
      tile_url_dark: "Eigene Kachel-URL dunkel",
      tile_attribution: "Eigene Quellenangabe",
      tile_max_zoom: "Größte Zoomstufe",
      tile_api_key: "Schlüssel",
      tile_api_key_entity: "Schlüssel-Helfer",
    },
    helpers: {
      map_style: "Welche Kacheln die Karte zeichnet. Home-Assistant-Standard lässt sie unberührt. Vorgabe: CARTO Positron / Dark Matter.",
      tile_url: "Gilt nur bei der Vorlage Eigene URL. Eine Kachel-URL mit den Platzhaltern für Zoom, Spalte und Zeile. Vorgabe: leer.",
      tile_url_dark: "Wird im dunklen Thema anstelle der hellen URL geladen. Leer heißt: die helle gilt in beiden Themen. Vorgabe: leer.",
      tile_attribution: "Die Quellenangabe unten rechts in der Karte. Die meisten Anbieter verlangen sie. Vorgabe: leer.",
      tile_max_zoom: "Die größte Zoomstufe, die die eigene Kachelquelle liefert. Gilt nur bei der Vorlage Eigene URL. Vorgabe 19.",
      tile_api_key: "Ein Kachelschlüssel nur für diese Karte. Er überschreibt den Helfer. Vorgabe: leer, dann gilt der Helfer.",
      tile_api_key_entity: "Der input_text-Helfer, in dem der Kachelschlüssel steht. Ein Eintrag genügt für alle Karten. Vorgabe: input_text.carto_api_key.",
    },
    texte: {
      map_style_ha: "Home-Assistant-Standard",
      map_style_custom: "Eigene URL",
      innenTitel: "Alles Weitere wie bei der eingebauten Karte:",
      karteFehlt: "Die eingebaute Karte ließ sich nicht erzeugen: {grund}",
      editorFehlt: "Der eingebaute Map-Editor ließ sich nicht laden — die übrigen Optionen bitte in YAML bearbeiten. Sie sind dieselben wie bei type: map.",
    },
  },
  en: {
    name: "Busch map",
    description: "The built-in map card with freely chosen tiles — only the type changes.",
    labels: {
      map_style: "Tile preset",
      tile_url: "Own tile URL",
      tile_url_dark: "Own tile URL dark",
      tile_attribution: "Own attribution",
      tile_max_zoom: "Maximum zoom",
      tile_api_key: "Key",
      tile_api_key_entity: "Key helper",
    },
    helpers: {
      map_style: "Which tiles the map draws. Home Assistant default leaves them untouched. Default: CARTO Positron / Dark Matter.",
      tile_url: "Only used with the Own URL preset. A tile URL with the placeholders for zoom, column and row. Default: empty.",
      tile_url_dark: "Loaded instead of the light URL in the dark theme. Empty means the light one applies to both. Default: empty.",
      tile_attribution: "The attribution in the bottom right of the map. Most providers require it. Default: empty.",
      tile_max_zoom: "The highest zoom level your own tile source serves. Only used with the Own URL preset. Default 19.",
      tile_api_key: "A tile key for this card alone. It overrides the helper. Default: empty, then the helper applies.",
      tile_api_key_entity: "The input_text helper holding the tile key. One entry is enough for every card. Default: input_text.carto_api_key.",
    },
    texte: {
      map_style_ha: "Home Assistant default",
      map_style_custom: "Own URL",
      innenTitel: "Everything else as on the built-in card:",
      karteFehlt: "The built-in map card could not be created: {grund}",
      editorFehlt: "The built-in map editor could not be loaded — please edit the remaining options in YAML. They are the same as for type: map.",
    },
  },
};

/** Sucht ein Element durch verschachtelte Shadow-DOMs, mit Tiefenbegrenzung.
 *  Ohne Grenze laeuft die Suche auf einer grossen Oberflaeche lange. */
function queryDeepShadow(root, selector, depth = 6) {
  if (!root || depth < 0) return null;
  const direct = root.querySelector?.(selector);
  if (direct) return direct;
  const kinder = root.querySelectorAll ? root.querySelectorAll("*") : [];
  for (const kind of kinder) {
    if (kind.shadowRoot) {
      const treffer = queryDeepShadow(kind.shadowRoot, selector, depth - 1);
      if (treffer) return treffer;
    }
  }
  return null;
}

class BuschMapCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-map-card-editor");
  }

  static getStubConfig(hass) {
    const person = Object.keys(hass?.states || {}).find((id) => id.startsWith("person."));
    return {
      type: "custom:busch-map-card",
      entities: person ? [person] : [],
      map_style: "carto",
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._inner = null;
    this._haMap = null;
    this._layer = null;
    this._urspruenglich = null;   // Zustand vor dem Eingriff, fuer den Rueckfall
    this._dunkel = null;
    this._versuche = 0;
    this._gewarnt = false;
  }

  setConfig(config) {
    if (!config) throw new Error("busch-map-card: Konfiguration fehlt");
    this._config = { ...MAP_CARD_DEFAULTS, ...config };
    this._inner = null;
    this._haMap = null;
    this._layer = null;
    this._build();
  }

  set hass(hass) {
    const dunkelVorher = this._dunkelJetzt();
    const schluesselVorher = this._schluessel();
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    // Auch der Schluessel kann sich aendern — er steht in einem Helfer, den
    // der Nutzer jederzeit bearbeitet. Ohne diese Pruefung bliebe das
    // Wasserzeichen bis zum naechsten Neuladen stehen.
    if (this._layer
        && (this._dunkelJetzt() !== dunkelVorher || this._schluessel() !== schluesselVorher)) {
      this._applyTiles();
    }
  }

  getCardSize() {
    if (this._inner && typeof this._inner.getCardSize === "function") {
      return this._inner.getCardSize();
    }
    return 5;
  }

  /** Spalten in Vielfachen von 3 (Regel 3). Dieselben Masse wie bei HAs
   *  eingebauter Map-Karte: eine Landkarte unter halber Breite zeigt nichts. */
  getGridOptions() {
    return { columns: 12, rows: 4, min_columns: 6, min_rows: 3 };
  }

  /** Der Textabschnitt der geltenden Sprache. */
  get _texte() {
    return buschTexte(TEXTE_BUSCH_MAP_CARD, this._hass).texte;
  }

  /** Konfiguration fuer die eingebaute Karte: die eigenen Schluessel muessen
   *  raus, sonst reicht man ihr Felder, die sie nicht kennt. */
  _innerConfig() {
    const rest = { ...this._config };
    for (const key of MAP_OWN_KEYS) delete rest[key];
    rest.type = "map";
    return rest;
  }

  _stil() {
    const stil = MAP_STYLES[this._config.map_style] || MAP_STYLES.carto;
    if (!stil.custom) return stil;
    return {
      name: stil.name,
      light: this._config.tile_url || "",
      dark: this._config.tile_url_dark || "",
      attribution: this._config.tile_attribution || "",
      maxZoom: Number(this._config.tile_max_zoom) || 19,
    };
  }

  /** Der Schluessel, in dieser Reihenfolge: direkt in der Karte, sonst aus
   *  dem Helfer. So genuegt EIN Eintrag im System fuer alle Karten, und wer
   *  eine einzelne Karte anders bestuecken will, kann es trotzdem. */
  _schluessel() {
    const direkt = (this._config?.tile_api_key || "").trim();
    if (direkt) return direkt;
    const id = (this._config?.tile_api_key_entity || MAP_KEY_ENTITY).trim();
    const zustand = this._hass?.states?.[id]?.state;
    if (!zustand || zustand === "unknown" || zustand === "unavailable") return "";
    return String(zustand).trim();
  }

  _dunkelJetzt() {
    const modus = this._config?.theme_mode || "auto";
    if (modus === "dark") return true;
    if (modus === "light") return false;
    if (this._hass?.themes && typeof this._hass.themes.darkMode === "boolean") {
      return this._hass.themes.darkMode;
    }
    return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  }

  async _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; z-index: 0; }
        .fehler { padding: var(--ha-space-4, 16px); color: var(--error-color, #db4437);
                  font-size: 0.9em; overflow-wrap: anywhere; min-width: 0; }
      </style>
      <div class="wrap"></div>
    `;
    const wrap = this.shadowRoot.querySelector(".wrap");
    try {
      const helpers = await window.loadCardHelpers();
      const inner = await helpers.createCardElement(this._innerConfig());
      this._inner = inner;
      if (this._hass) inner.hass = this._hass;
      wrap.appendChild(inner);
      this._sucheKarte();
    } catch (error) {
      const meldung = buschFuellen(this._texte.karteFehlt, {
        grund: error?.message || error,
      });
      wrap.textContent = "";
      // Im Regelfall bringt HAs eingebaute map-Karte ihre eigene `ha-card`
      // mit — eine zweite darum wäre ein Rahmen im Rahmen. Im FEHLERFALL
      // gibt es sie nicht, und dann muss die Karte selbst eine stellen
      // (Regel 4: jede Karte rendert in `<ha-card>`).
      const karte = document.createElement("ha-card");
      const kasten = document.createElement("div");
      kasten.className = "fehler";
      // `textContent`, nicht `innerHTML`: die Fehlermeldung kommt aus einer
      // fremden Bibliothek und ist damit nichts, was man in HTML einsetzt.
      kasten.textContent = meldung;
      karte.appendChild(kasten);
      wrap.appendChild(karte);
    }
  }

  /** Die Leaflet-Instanz taucht erst auf, wenn die innere Karte gerendert hat.
   *  Deshalb ein paar Anlaeufe statt eines einzelnen Versuchs. */
  _sucheKarte() {
    this._versuche = 0;
    const versuch = () => {
      this._versuche += 1;
      const haMap = queryDeepShadow(this._inner?.shadowRoot || this._inner, "ha-map");
      if (haMap && haMap.leafletMap) {
        this._haMap = haMap;
        if (this._applyTiles()) return;
      }
      if (this._versuche < 40) {
        setTimeout(versuch, 250);
        return;
      }
      // Rueckfall: HAs Karte bleibt, wie sie ist. Kein leeres Feld.
      if (!this._gewarnt) {
        this._gewarnt = true;
        console.warn(
          "busch-map-card: `ha-map.leafletMap` nicht gefunden — die Kacheln "
          + "bleiben die von Home Assistant. Die Karte funktioniert unveraendert weiter."
        );
      }
    };
    versuch();
  }

  _applyTiles() {
    const map = this._haMap?.leafletMap;
    if (!map) return false;
    const stil = this._stil();
    const dunkel = this._dunkelJetzt();
    this._dunkel = dunkel;

    if (stil.keep) {
      this._layer = null;
      return true;   // Standardvorlage: bewusst nichts anfassen
    }
    let url = (dunkel && stil.dark) ? stil.dark : stil.light;
    if (!url) return false;   // Eigene URL noch leer — HAs Kacheln stehen lassen

    // CARTO verlangt einen Schluessel. Ohne ihn liefert es zwar HTTP 200 und
    // eine gueltige PNG-Kachel — aber mit "API KEY REQUIRED" quer eingebrannt.
    // Am 06.09.2026 auf Byte-Ebene nachgemessen: derselbe Kachelpfad ergab
    // ohne Schluessel 20411 B, mit `?key=` 22692 B. Der Parameter heisst `key`;
    // `api_key` wird stillschweigend ignoriert.
    //
    // Der Schluessel steht in der KARTENKONFIGURATION, nie im Quelltext: dieses
    // Repo ist oeffentlich.
    const schluessel = this._schluessel();
    if (stil.keyParam && schluessel) {
      url += (url.includes("?") ? "&" : "?")
        + encodeURIComponent(stil.keyParam) + "=" + encodeURIComponent(schluessel);
    } else if (stil.keyParam && !this._keyGemeldet) {
      this._keyGemeldet = true;
      console.info(
        "busch-map-card: " + stil.name + " braucht einen Schluessel, sonst steht "
        + "\"API KEY REQUIRED\" in den Kacheln. Kostenlos unter "
        + "https://carto.com/basemaps/apikey. Einmal in den Helfer "
        + MAP_KEY_ENTITY + " eintragen, dann gilt er fuer alle Karten."
      );
    }

    // Vorhandene Rasterebene suchen. `setUrl` ist der schonende Weg: er
    // vermeidet, eine Ebene aus UNSERER Leaflet-Kopie in HAs Karte zu haengen.
    let raster = null;
    map.eachLayer((layer) => {
      if (!raster && typeof layer.setUrl === "function" && typeof layer.getTileUrl === "function") {
        raster = layer;
      }
    });

    if (raster) {
      if (!this._urspruenglich) {
        this._urspruenglich = {
          url: raster._url,
          attribution: raster.options.attribution,
          subdomains: raster.options.subdomains,
          maxZoom: raster.options.maxZoom,
        };
      }
      if (stil.subdomains) raster.options.subdomains = stil.subdomains;
      if (stil.maxZoom) raster.options.maxZoom = stil.maxZoom;
      this._setzeQuellenangabe(map, raster, stil.attribution);
      raster.setUrl(url);
      this._layer = raster;
    } else {
      // Keine Rasterebene: Home Assistant zeichnet die Grundkarte als
      // Vektorkarte (MapLibre). Deren URL laesst sich nicht tauschen, also
      // legen wir eine eigene Rasterebene an — dafuer liegt Leaflet oben in
      // dieser Datei.
      const L = leafletLaden();
      if (!L || !L.tileLayer) {
        if (!this._gewarnt) {
          this._gewarnt = true;
          console.warn(
            "busch-map-card: kein Leaflet verfuegbar — die Grundkarte bleibt, "
            + "wie Home Assistant sie zeichnet."
          );
        }
        this._layer = null;
        return true;
      }
      try {
        // Eigene Ebene, damit die Reihenfolge sicher stimmt: ueber der
        // Grundkarte (tilePane, 200), aber UNTER Routen (400) und Markern
        // (600) — sonst verdecken unsere Kacheln die Personen.
        if (!map.getPane(MAP_PANE)) {
          const pane = map.createPane(MAP_PANE);
          pane.style.zIndex = "250";
          pane.style.pointerEvents = "none";
          // ABER: Home Assistant flacht ALLE Leaflet-Ebenen ein —
          // `.leaflet-pane { z-index: 0 !important; }` (frontend,
          // `src/components/map/ha-map.ts`, Zeile 958 im Stand 20260826.6 =
          // HA 2026.9.1). Ein `!important` aus einem Stilblatt schlaegt die
          // Zeile oben; unsere 250 gelten dort also NICHT. Alle Ebenen liegen
          // dann auf 0 und stapeln sich einzig nach Dokumentreihenfolge —
          // und `createPane` haengt neu ganz hinten an, hinter markerPane.
          // Genau daran verschwanden die Entitaeten: die undurchsichtigen
          // Kacheln lagen ueber den Markern (v0.9.0, gemeldet 09.09.2026).
          // Deshalb wird die Ebene direkt hinter die Grundkacheln
          // einsortiert. Das stimmt in BEIDEN Faellen: mit den 250 (ueber
          // tilePane 200, unter overlayPane 400) und ohne sie, allein nach
          // Reihenfolge.
          const ueberlagerung = map.getPane("overlayPane");
          if (ueberlagerung && ueberlagerung.parentNode === pane.parentNode) {
            pane.parentNode.insertBefore(pane, ueberlagerung);
          }
        }
        // Die Vektor-Grundkarte darunter abraeumen, wenn sie sich zu erkennen
        // gibt. Gelingt das nicht, deckt unsere undurchsichtige Rasterebene
        // sie ohnehin ab — nur laeuft sie dann unnoetig weiter.
        map.eachLayer((layer) => {
          const istVektorBasis = !!(layer._glMap || layer._maplibreMap
            || typeof layer.getMaplibreMap === "function");
          if (istVektorBasis) {
            try { map.removeLayer(layer); } catch (e) { /* dann eben verdeckt */ }
          }
        });
        const neu = L.tileLayer(url, {
          pane: MAP_PANE,
          attribution: stil.attribution,
          subdomains: stil.subdomains || "abc",
          maxZoom: stil.maxZoom || 19,
        });
        neu.addTo(map);
        this._layer = neu;
      } catch (error) {
        console.warn("busch-map-card: eigene Kachelebene fehlgeschlagen", error);
        this._layer = null;
        return false;
      }
    }

    // HAs Dunkelmodus-Filter abschalten: echte dunkle Kacheln brauchen keine
    // Invertierung, und beides zusammen ergibt Matsch. Nur wenn wir die
    // Kacheln wirklich getauscht haben.
    if (this._inner && this._layer) {
      this._inner.style.setProperty("--map-filter", "none");
    }
    return true;
  }

  _setzeQuellenangabe(map, layer, text) {
    if (!text) return;
    const control = map.attributionControl;
    if (control) {
      if (layer.options.attribution) {
        try { control.removeAttribution(layer.options.attribution); } catch (e) { /* egal */ }
      }
      try { control.addAttribution(text); } catch (e) { /* egal */ }
    }
    layer.options.attribution = text;
  }
}

class BuschMapCardEditor extends BuschEditorBase {
  setConfig(config) {
    if (!this._acceptConfig(config || {})) return;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  async _render() {
    if (!this._hass || !this._config) return;
    if (!this._aufgebaut) {
      this._aufgebaut = true;
      const texte = buschTexte(TEXTE_BUSCH_MAP_CARD, this._hass);
      this._texte = texte.texte;
      this._form = document.createElement("ha-form");
      this._form.schema = buschSchemaMitTexten(SCHEMA_BUSCH_MAP_CARD, texte);
      this._form.computeLabel = (s) => texte.labels[s.name] || s.name;
      this._form.computeHelper = (s) => texte.helpers[s.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const merged = { ...this._config, ...event.detail.value };
        for (const [key, value] of Object.entries(MAP_CARD_DEFAULTS)) {
          if (merged[key] === value) delete merged[key];
        }
        this._emit(merged);
      });
      this.appendChild(this._form);

      const hinweis = document.createElement("div");
      hinweis.style.cssText = "margin:12px 0 4px;font-size:0.85em;opacity:.7;";
      hinweis.textContent = texte.texte.innenTitel;
      this.appendChild(hinweis);
      this._innenBehaelter = document.createElement("div");
      this.appendChild(this._innenBehaelter);
      this._baueInnenEditor();
    }
    this._form.hass = this._hass;
    this._form.data = { ...MAP_CARD_DEFAULTS, ...this._config };
    if (this._innen) {
      this._innen.hass = this._hass;
      this._innen.setConfig(this._innerConfig());
    }
  }

  _innerConfig() {
    const rest = { ...this._config };
    for (const key of MAP_OWN_KEYS) delete rest[key];
    rest.type = "map";
    return rest;
  }

  /** Home Assistants eigenen Map-Editor einbetten. Klappt das nicht, bleibt
   *  ein ehrlicher Hinweis statt eines halben Formulars. */
  async _baueInnenEditor() {
    try {
      const helpers = await window.loadCardHelpers();
      // Mit der ECHTEN Konfiguration erzeugen, nicht mit `entities: []`: HAs
      // Map-Karte lehnt eine Konfiguration ohne Entitaeten ab, und der ganze
      // Editor fiel deshalb auf den Hinweistext zurueck. Am 06.09.2026 im
      // Screenshot des Nutzers gesehen.
      let karte = null;
      for (const versuch of [this._innerConfig(), { type: "map", entities: ["zone.home"] }]) {
        try {
          karte = await helpers.createCardElement(versuch);
          break;
        } catch (e) { /* naechster Versuch */ }
      }
      if (!karte) throw new Error("map-Karte liess sich nicht erzeugen");
      const editor = await karte.constructor.getConfigElement();
      editor.hass = this._hass;
      editor.setConfig(this._innerConfig());
      editor.addEventListener("config-changed", (event) => {
        event.stopPropagation();
        const innen = { ...(event.detail?.config || {}) };
        delete innen.type;
        const eigene = {};
        for (const key of MAP_OWN_KEYS) {
          if (this._config[key] !== undefined) eigene[key] = this._config[key];
        }
        this._emit({ type: this._config.type, ...innen, ...eigene });
      });
      this._innen = editor;
      this._innenBehaelter.appendChild(editor);
    } catch (error) {
      const kasten = document.createElement("div");
      kasten.style.cssText = "font-size:0.85em;opacity:.7;overflow-wrap:anywhere;";
      kasten.textContent = (this._texte || TEXTE_BUSCH_MAP_CARD.de.texte).editorFehlt;
      this._innenBehaelter.textContent = "";
      this._innenBehaelter.appendChild(kasten);
    }
  }

  _emit(config) {
    this._publishConfig(config);
  }
}

if (!customElements.get?.("busch-map-card")) customElements.define("busch-map-card", BuschMapCard);
if (!customElements.get?.("busch-map-card-editor")) customElements.define("busch-map-card-editor", BuschMapCardEditor);

const waehlerLandkarte = buschTexte(TEXTE_BUSCH_MAP_CARD);

window.customCards.some(card => card.type === "busch-map-card") || window.customCards.push({
  type: "busch-map-card",
  name: waehlerLandkarte.name,
  description: waehlerLandkarte.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});

/* ────────────────────────────────────────────────────────────────────────────
 * busch-device-card — eine Entität, ihr ganzes Gerät
 *
 * Spec: docs/superpowers/specs/2026-09-09-geraetekarte-design.md
 *
 * Alles, was die Karte über Geräte weiß, steht schon im `hass`-Objekt:
 * `hass.entities` (Registereinträge mit `device_id`, `labels`, `hidden`,
 * `entity_category`, `platform`), `hass.devices`, `hass.areas`. Belegt am
 * Frontend-Quelltext (`src/data/entity/entity_registry.ts`,
 * `src/data/device/device_registry.ts`) am 09.09.2026. Nur die Label-NAMEN
 * kommen per WebSocket (`config/label_registry/list`).
 *
 * Bedienelement und Entitätenzeilen zeichnet HA selbst — über
 * `window.loadCardHelpers()`: `createCardElement({type:"tile", …})` und
 * `createRowElement({entity})`. Diese Datei zeichnet nur Kopfzeile, Chips und
 * Gruppenköpfe. Namensraum: `dev` / `DEV_`.
 * ──────────────────────────────────────────────────────────────────────── */

const DEV_GRUPPEN_WERTE = ["control", "sensor", "config", "diagnostic"];

/** Die Aktionen, die Home Assistant selbst übersetzt. `assist` fehlt
 *  bewusst — sein Dialog kommt über einen bundle-internen Import, an den
 *  eine Karte nicht herankommt (Spec 0.11.0, Abschnitt 2). */
const DEV_HA_AKTIONEN = ["more-info", "toggle", "navigate", "url", "perform-action", "none"];

/** Die Art einer Kopfzeilen-Geste im Editor. `ha` heißt: HAs eigener
 *  Aktionseditor entscheidet, was drinsteht. */
const DEV_ARTEN = ["expand", "device-page", "ha"];

const DEV_STANDARD = {
  title: "",
  template: "auto",
  labels: [],
  labels_hide: [],
  groups: ["control", "sensor", "config", "diagnostic"],
  groups_open: ["control"],
  show_subtitle: true,
  start_expanded: false,
  tap_action: { action: "expand" },
  hold_action: { action: "more-info" },
  row_tap_action: { action: "more-info" },
  row_hold_action: { action: "none" },
};

/**
 * Eine Aktion in HAs Objektform bringen.
 *
 * `altPfad` ist das `navigation_path` aus einer Konfiguration vor `0.11.0`,
 * wo der Pfad neben der Aktion stand statt in ihr.
 */
function devAktionNormalisieren(wert, altPfad) {
  if (wert === undefined || wert === null) return undefined;
  const a = typeof wert === "string" ? { action: wert } : { ...wert };
  if (!a.action || typeof a.action !== "string") return undefined;
  if (a.action === "call-service") {
    a.action = "perform-action";
    if (a.service && !a.perform_action) a.perform_action = a.service;
    if (a.service_data && !a.data) a.data = a.service_data;
    delete a.service;
    delete a.service_data;
  }
  if (a.action === "navigate" && !a.navigation_path && altPfad) a.navigation_path = altPfad;
  return a;
}

/**
 * Eine Konfiguration aus `0.10.x` auf die Form von `0.11.0` bringen.
 * **Idempotent** — ein zweiter Durchlauf ändert nichts mehr.
 */
function devMigriereKonfig(config) {
  const k = { ...(config || {}) };
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    const a = devAktionNormalisieren(k[feld], k.navigation_path);
    if (a === undefined) delete k[feld];
    else k[feld] = a;
  }
  delete k.navigation_path;
  if (k.show_config !== undefined || k.show_diagnostic !== undefined) {
    const vorhanden = Array.isArray(k.groups) ? k.groups : DEV_GRUPPEN_WERTE;
    const weg = [];
    if (k.show_config === false) weg.push("config");
    if (k.show_diagnostic === false) weg.push("diagnostic");
    k.groups = DEV_GRUPPEN_WERTE.filter((g) => vorhanden.includes(g) && !weg.includes(g));
    delete k.show_config;
    delete k.show_diagnostic;
  }
  return k;
}

/** Welche Art hat diese Aktion im Editor? */
function devArtVon(aktion) {
  const a = aktion && aktion.action;
  return a === "expand" || a === "device-page" ? a : "ha";
}

/** Der Kontext, in dem eine Aktion läuft. */
function devKontext(entityId, geraet, bereich) {
  return {
    entity: entityId || "",
    device: (geraet && geraet.id) || "",
    area: (bereich && (bereich.area_id || bereich.id)) || "",
  };
}

/**
 * Drei Platzhalter, rekursiv in jeder Zeichenkette ersetzt. **Kein Jinja.**
 * Was nicht auf dieses Muster passt, bleibt wörtlich stehen — so sieht der
 * Nutzer im Dienstaufruf, dass sein Ausdruck nicht gegriffen hat.
 */
function devPlatzhalterErsetzen(wert, kontext) {
  if (typeof wert === "string") {
    return wert.replace(/\{\{\s*(entity|device|area)\s*\}\}/g, (ganz, name) => {
      const w = kontext[name];
      return w === undefined || w === null ? ganz : String(w);
    });
  }
  if (Array.isArray(wert)) return wert.map((x) => devPlatzhalterErsetzen(x, kontext));
  if (wert && typeof wert === "object") {
    const aus = {};
    for (const schluessel of Object.keys(wert)) {
      aus[schluessel] = devPlatzhalterErsetzen(wert[schluessel], kontext);
    }
    return aus;
  }
  return wert;
}

/** Ein leeres Ziel füllt sich mit der Entität des Kontexts. */
function devZielFuellen(aktion, kontext) {
  if (!aktion || aktion.action !== "perform-action") return aktion;
  const ziel = aktion.target;
  const leer = !ziel || (typeof ziel === "object" && Object.keys(ziel).length === 0);
  if (!leer || !kontext.entity) return aktion;
  return { ...aktion, target: { entity_id: kontext.entity } };
}

/** So navigiert Home Assistant selbst (`src/common/navigate.ts`). */
function devNavigiere(pfad) {
  history.pushState(null, "", pfad);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/**
 * Die einzige Stelle, die eine Aktion ausführt — für Kopfzeile und Zeilen.
 * `karte` darf fehlen; dann entfallen die Wege, die sie brauchen.
 */
function devFuehreAus(karte, hass, aktion, kontext) {
  const art = aktion && aktion.action;
  if (!art || art === "none") return;

  if (art === "expand") {
    if (karte && typeof karte._umschalten === "function") karte._umschalten();
    return;
  }
  if (art === "device-page") {
    if (kontext.device) devNavigiere(`/config/devices/device/${kontext.device}`);
    return;
  }
  if (art === "more-info") {
    if (!kontext.entity || !karte) return;
    karte.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: kontext.entity }, bubbles: true, composed: true,
    }));
    return;
  }
  if (art === "toggle") {
    if (kontext.entity && hass) hass.callService("homeassistant", "toggle", { entity_id: kontext.entity });
    return;
  }
  if (art === "navigate") {
    if (aktion.navigation_path) devNavigiere(aktion.navigation_path);
    return;
  }
  if (art === "url") {
    if (aktion.url_path && typeof window !== "undefined" && typeof window.open === "function") {
      window.open(aktion.url_path, "_blank", "noreferrer");
    }
    return;
  }
  if (art === "perform-action") {
    const voll = String(aktion.perform_action || "");
    const punkt = voll.indexOf(".");
    if (punkt <= 0 || punkt === voll.length - 1) {
      console.warn(`busch-device-card: perform-action ohne gültigen Dienst: "${voll}"`);
      return;
    }
    if (!hass || typeof hass.callService !== "function") return;
    const gefuellt = devZielFuellen(aktion, kontext);
    const daten = devPlatzhalterErsetzen(gefuellt.data || {}, kontext);
    const ziel = gefuellt.target ? devPlatzhalterErsetzen(gefuellt.target, kontext) : undefined;
    Promise.resolve()
      .then(() => hass.callService(voll.slice(0, punkt), voll.slice(punkt + 1), daten, ziel))
      .catch((fehler) => {
        if (karte && typeof karte._zeigeDienstFehler === "function") karte._zeigeDienstFehler(fehler);
      });
  }
}

/**
 * Vorlage → Features der Tile-Karte (Spec Abschnitt 4). Die Typnamen stehen
 * in `src/panels/lovelace/card-features/types.ts`. Ein Feature, das die
 * Domain nicht unterstützt oder das die HA-Version nicht kennt, rendert HA
 * leer — die Karte prüft das nicht selbst.
 */
const DEV_VORLAGEN = {
  light: { domains: ["light"], features: [{ type: "light-brightness" }] },
  climate: {
    domains: ["climate"],
    features: [{ type: "target-temperature" }, { type: "climate-hvac-modes" }],
  },
  cover: {
    domains: ["cover"],
    features: [{ type: "cover-open-close" }, { type: "cover-position" }],
  },
  fan: { domains: ["fan"], features: [{ type: "fan-speed" }] },
  media: { domains: ["media_player"], features: [{ type: "media-player-volume-slider" }] },
  lock: { domains: ["lock"], features: [{ type: "lock-commands" }] },
  switch: { domains: ["switch", "input_boolean"], features: [{ type: "toggle" }] },
  generic: { domains: [], features: [] },
};

function devFilterKonfig(filter) {
  if(filter===undefined)return undefined;
  if(!filter||typeof filter!=='object'||Array.isArray(filter)||Object.keys(filter).some(k=>!['include','exclude'].includes(k)))throw new Error('filter: include/exclude required / Include-/Exclude-Regeln erforderlich');
  const validate=rule=>{
    if(!rule||typeof rule!=='object'||Array.isArray(rule))throw new Error('filter: invalid rule / ungültige Regel');
    for(const [raw,value]of Object.entries(rule)){
      const key=raw.trim().split(' ')[0];
      if(!BUSCH_DEVICE_FILTER_RULES.includes(key))throw new Error('filter: unknown predicate / unbekannte Filterregel: '+key);
      if(key==='and'||key==='or'){if(!Array.isArray(value))throw new Error('filter: and/or requires a list / UND/ODER benötigt eine Liste');value.forEach(validate);}
      if(key==='not')validate(value);
      if(key==='attributes'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('filter.attributes: object required / Objekt erforderlich');
    }
  };
  for(const rules of Object.values(filter)){if(!Array.isArray(rules))throw new Error('filter: rules must be a list / Regeln müssen eine Liste sein');rules.forEach(validate);}
  return JSON.parse(JSON.stringify(filter));
}
function devNormalisiereKonfig(config) {
  const roh = devMigriereKonfig(config);
  const k = { ...DEV_STANDARD, ...roh };
  k.entity = typeof roh.entity === "string" ? roh.entity : "";
  k.device_id = typeof roh.device_id === "string" ? roh.device_id.trim() : "";
  if(roh.filter!==undefined)k.filter=devFilterKonfig(roh.filter);
  for (const feld of ["labels", "labels_hide"]) {
    if (typeof roh[feld] === "string") k[feld] = [roh[feld]];
    else if (Array.isArray(roh[feld])) k[feld] = roh[feld].filter((l) => typeof l === "string");
    else k[feld] = [];
  }
  for (const feld of ["groups", "groups_open"]) {
    const liste = Array.isArray(roh[feld]) ? roh[feld] : DEV_STANDARD[feld];
    k[feld] = DEV_GRUPPEN_WERTE.filter((w) => liste.includes(w));
  }
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    k[feld] = devAktionNormalisieren(k[feld]) || { ...DEV_STANDARD[feld] };
  }
  if (typeof k.title !== "string") k.title = "";
  return k;
}

function devDomain(entityId) {
  const s = String(entityId || "");
  const p = s.indexOf(".");
  return p > 0 ? s.slice(0, p) : "";
}

function devVorlageWaehlen(template, entityId) {
  if (template && template !== "auto") {
    return DEV_VORLAGEN[template] ? template : "generic";
  }
  const domain = devDomain(entityId);
  for (const name of Object.keys(DEV_VORLAGEN)) {
    if (DEV_VORLAGEN[name].domains.includes(domain)) return name;
  }
  return "generic";
}

/** „Hersteller · Modell · Bereich" — leere Teile fallen samt Punkt weg. */
function devUntertitel(geraet, bereich) {
  const teile = [];
  if (geraet && geraet.manufacturer) teile.push(String(geraet.manufacturer));
  if (geraet && geraet.model) teile.push(String(geraet.model));
  if (bereich && bereich.name) teile.push(String(bereich.name));
  return teile.join(" · ");
}

/**
 * Entität → Gerät → Bereich. Liefert `{ fehler }` mit einem Wörterbuch-
 * schlüssel aus `texte`, oder die Auflösung.
 */
function devGeraetAufloesen(hass, entityId, deviceId, core) {
  if (!entityId && !deviceId) return { fehler: "keineEntitaet" };
  if (!hass || (!core && (!hass.entities || !hass.devices))) return { fehler: "altesHa" };
  const entryFor = id => core ? core.getEntity(id)?.registry : hass.entities?.[id];
  let eintrag = entryFor(entityId);
  const id = deviceId || eintrag?.device_id;
  if (!deviceId && !eintrag) return { fehler: "nichtRegistriert" };
  if (!id) return { fehler: "keinGeraet" };
  const geraet = core ? core.getDevice(id) : hass.devices[id];
  if (!geraet) return { fehler: deviceId ? "geraetFehlt" : "keinGeraet" };
  if (deviceId && (!eintrag || eintrag.device_id !== id)) {
    const domains = ["climate", "light", "cover", "fan", "media_player", "switch", "lock"];
    const entries = devEntitaetenDesGeraets(hass, id, "", core)
      .filter(entry => domains.includes(devDomain(entry.entity_id)) && !entry.entity_category &&
        hass.states?.[entry.entity_id] && !["unavailable", "unknown"].includes(hass.states[entry.entity_id].state) && !entry.disabled_by);
    const rank = entry => {
      const pos = domains.indexOf(devDomain(entry.entity_id));
      return entry.entity_category ? 200 : pos < 0 ? 100 : pos;
    };
    entries.sort((a, b) => rank(a) - rank(b) || a.entity_id.localeCompare(b.entity_id));
    eintrag = entries[0] || {}; entityId = eintrag.entity_id || "";
  }
  const bereich = (geraet.area_id && (core ? core.areas.get(geraet.area_id) : hass.areas?.[geraet.area_id])) || null;
  const name = geraet.name_by_user || geraet.name || id;
  return { eintrag, geraet, bereich, entityId, name, untertitel: devUntertitel(geraet, bereich), platform: eintrag.platform || "" };
}

/**
 * HAs `SENSOR_ENTITIES` aus `src/common/const.ts` plus `event`. HA führt
 * `event`, `notify` und Assist als eigene Gruppen; diese Karte faltet `event`
 * in Sensoren und den Rest in Steuerung (Spec Abschnitt 5).
 */
const DEV_SENSOR_DOMAINS = [
  "sensor", "binary_sensor", "calendar", "camera", "device_tracker", "image", "weather", "event",
];

/** Reihenfolge der Gruppen in der Karte. */
const DEV_GRUPPEN = ["control", "sensor", "config", "diagnostic"];

function devEntitaetenDesGeraets(hass, deviceId, hauptId, core) {
  if (core) return core.getDeviceEntities(deviceId).map(info => info.registry).filter(e => e && !e.hidden && !e.hidden_by && !e.disabled_by && e.entity_id !== hauptId);
  const aus = [];
  const register = (hass && hass.entities) || {};
  for (const id of Object.keys(register)) {
    const e = register[id];
    if (!e || e.device_id !== deviceId || e.hidden || id === hauptId) continue;
    aus.push(e);
  }
  return aus;
}

/**
 * Erst einschließen, dann ausschließen. **Ausschluss schlägt Einschluss** —
 * ein Eintrag mit beiden Labels verschwindet (Spec 0.11.0, Abschnitt 8).
 */
function devLabelFilter(eintraege, labels, labelsHide) {
  const ein = Array.isArray(labels) ? labels : [];
  const aus = Array.isArray(labelsHide) ? labelsHide : [];
  let liste = eintraege.slice();
  if (ein.length) {
    liste = liste.filter((e) => Array.isArray(e.labels) && e.labels.some((l) => ein.includes(l)));
  }
  if (aus.length) {
    liste = liste.filter((e) => !(Array.isArray(e.labels) && e.labels.some((l) => aus.includes(l))));
  }
  return liste;
}

/** Welche Gruppen erscheinen, in fester Reihenfolge. */
function devGruppenSichtbar(konfig) {
  const g = Array.isArray(konfig.groups) ? konfig.groups : DEV_GRUPPEN_WERTE;
  return DEV_GRUPPEN_WERTE.filter((w) => g.includes(w));
}

/** Startet diese Gruppe offen? */
function devGruppeOffen(konfig, gruppe) {
  const g = Array.isArray(konfig.groups_open) ? konfig.groups_open : [];
  return g.includes(gruppe);
}

function devGruppe(eintrag) {
  if (eintrag.entity_category === "config") return "config";
  if (eintrag.entity_category === "diagnostic") return "diagnostic";
  return DEV_SENSOR_DOMAINS.includes(devDomain(eintrag.entity_id)) ? "sensor" : "control";
}

function devAnzeigename(hass, eintrag) {
  if (eintrag.name) return String(eintrag.name);
  const zustand = hass && hass.states && hass.states[eintrag.entity_id];
  const fn = zustand && zustand.attributes && zustand.attributes.friendly_name;
  return fn ? String(fn) : eintrag.entity_id;
}

/**
 * „Wohnzimmer Deckenlampe Leistung" → „Leistung".
 *
 * Trägt eine Entität KEINEN eigenen Namen (`has_entity_name` mit `name: null`
 * — bei Home Assistant der Normalfall für die Hauptentität und für `update.*`),
 * dann ist ihr `friendly_name` **der Gerätename selbst**. Ohne Rückfall stünde
 * in der Liste eine Zeile, die nur das Gerät wiederholt — am 10.09.2026 an
 * einem echten SONOFF-Zigbee-Schalter gemessen: die Firmware-Zeile hieß
 * „Keller Flurlicht". Deshalb `rueckfall`, den die Karte aus der Domain füllt.
 */
function devKurzname(anzeigename, geraeteName, rueckfall) {
  const n = String(anzeigename || "").trim();
  const g = String(geraeteName || "").trim();
  if (g && n.length > g.length + 1 && n.startsWith(g + " ")) return n.slice(g.length + 1);
  if (!n || (g && n === g)) return String(rueckfall || n || g);
  return n;
}

/** Rückfallname einer Entität ohne eigenen Namen: das Wort für ihre Domain. */
function devDomainName(texte, entityId) {
  const domain = devDomain(entityId);
  return (texte && texte["domain_" + domain]) || domain || entityId;
}

function devGruppieren(hass, eintraege, konfig) {
  const koerbe = { control: [], sensor: [], config: [], diagnostic: [] };
  for (const e of eintraege) koerbe[devGruppe(e)].push(e);
  const aus = [];
  const sichtbar = devGruppenSichtbar(konfig);
  for (const gruppe of DEV_GRUPPEN) {
    if (!sichtbar.includes(gruppe)) continue;
    const liste = koerbe[gruppe];
    if (!liste.length) continue;
    liste.sort((a, b) =>
      devAnzeigename(hass, a).localeCompare(devAnzeigename(hass, b), undefined, { sensitivity: "base" })
    );
    aus.push({ gruppe, ids: liste.map((e) => e.entity_id) });
  }
  return aus;
}

/**
 * Spec Abschnitt 7: Nur wenn sich dieser Stempel ändert, wird das DOM neu
 * gebaut. Ein Zustandswechsel ändert ihn nicht — der wird nur durchgereicht.
 */
function devStrukturStempel(deviceId, vorlage, gruppen, konfig) {
  const felder = Object.keys(DEV_STANDARD).concat(["entity"]).sort()
    .map((k) => `${k}=${JSON.stringify(konfig[k])}`);
  const g = gruppen.map((x) => `${x.gruppe}:${x.ids.join(",")}`);
  return [deviceId, vorlage, g.join("|"), felder.join("&")].join("#");
}

const SCHEMA_BUSCH_DEVICE_CARD = [
  { name: "filter", selector: { object: {} } },
  { name: "device_id", selector: { device: {} } },
  { name: "entity", selector: { entity: {} } },
  { name: "title", selector: { text: {} } },
  {
    name: "template",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto" }, { value: "light" }, { value: "climate" }, { value: "cover" },
          { value: "fan" }, { value: "media" }, { value: "lock" }, { value: "switch" },
          { value: "generic" },
        ],
      },
    },
  },
  { name: "labels", selector: { label: { multiple: true } } },
  { name: "labels_hide", selector: { label: { multiple: true } } },
  {
    name: "groups",
    selector: {
      select: {
        multiple: true, mode: "list",
        options: [
          { value: "control" }, { value: "sensor" }, { value: "config" }, { value: "diagnostic" },
        ],
      },
    },
  },
  {
    name: "groups_open",
    selector: {
      select: {
        multiple: true, mode: "list",
        options: [
          { value: "control" }, { value: "sensor" }, { value: "config" }, { value: "diagnostic" },
        ],
      },
    },
  },
  {
    type: "grid",
    schema: [
      { name: "show_subtitle", selector: { boolean: {} } },
      { name: "start_expanded", selector: { boolean: {} } },
    ],
  },
  {
    name: "tap_kind",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "expand" }, { value: "device-page" }, { value: "ha" }],
      },
    },
  },
  {
    name: "tap_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "hold_kind",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "expand" }, { value: "device-page" }, { value: "ha" }],
      },
    },
  },
  {
    name: "hold_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "row_tap_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "row_hold_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
];

/**
 * Die gefilterte Kopie für den Editor: HAs Aktionseditor erscheint nur, wenn
 * die Art darüber `ha` ist. Das Literal oben bleibt vollständig, weil
 * `scripts/ui-regeln-pruefen.py` es aus dem Quelltext liest und eine
 * berechnete Schemafunktion nicht lesen könnte.
 */
function devSchemaFuer(konfig) {
  const weg = [];
  if (devArtVon(konfig && konfig.tap_action) !== "ha") weg.push("tap_action");
  if (devArtVon(konfig && konfig.hold_action) !== "ha") weg.push("hold_action");
  return SCHEMA_BUSCH_DEVICE_CARD.filter((e) => !weg.includes(e.name));
}

const TEXTE_BUSCH_DEVICE_CARD = {
  de: {
    name: "Busch Gerät",
    description: "Zeigt zu einer Entität ihr ganzes Gerät: Kopfzeile, Bedienelement und alle Entitäten, gruppiert wie auf der Geräteseite.",
    labels: {
      filter: "Filter",
      device_id: "Gerät",
      entity: "Entität",
      title: "Überschrift",
      template: "Darstellung",
      labels: "Nur Entitäten mit Label",
      labels_hide: "Entitäten mit Label verbergen",
      groups: "Gruppen zeigen",
      groups_open: "Gruppen offen starten",
      show_subtitle: "Untertitel zeigen",
      start_expanded: "Offen starten",
      tap_kind: "Tippen auf die Kopfzeile",
      hold_kind: "Halten auf der Kopfzeile",
      tap_action: "Aktion beim Tippen",
      hold_action: "Aktion beim Halten",
      row_tap_action: "Tippen auf eine Zeile",
      row_hold_action: "Halten auf einer Zeile",
    },
    helpers: {
      filter: "Include-/Exclude-Regeln für Entities dieses Geräts, auch für das Hauptbedienelement. Vorgabe: keine zusätzlichen Regeln.",
      device_id: "Gerät direkt auswählen; weitere Entitäten sind nicht erforderlich. Vorgabe: Auswahl über die Entität.",
      entity: "Optionale Hauptentität des Geräts. Die Karte sucht daraus das Gerät und zeigt diese Entität oben als Bedienelement.",
      title: "Überschrift der Karte. Leer nimmt den Gerätenamen. Vorgabe: leer.",
      template: "Welche Bedienelemente oben stehen. Automatisch richtet sich nach der Art der Entität. Vorgabe: automatisch.",
      labels: "Zeigt unten nur Entitäten, die eines dieser Labels tragen. Die Label-Auswahl betrifft nur die Liste. Vorgabe: alle.",
      labels_hide: "Entitäten mit einem dieser Labels erscheinen nicht. Schlägt die Auswahl darüber. Vorgabe: keines.",
      groups: "Welche Gruppen unter dem Bedienelement überhaupt erscheinen. Vorgabe: alle vier.",
      groups_open: "Welche dieser Gruppen offen starten. Die übrigen sind zugeklappt und öffnen sich per Klick. Vorgabe: nur Steuerung.",
      show_subtitle: "Hersteller, Modell und Bereich unter dem Namen. Vorgabe an.",
      start_expanded: "An zeigt Bedienelement und Entitäten sofort, aus erst nach dem Aufklappen. Vorgabe aus.",
      tap_kind: "Aufklappen zeigt Bedienelement und Entitäten. Geräteseite öffnet die Seite von Home Assistant. Bei Aktion von Home Assistant erscheint darunter dessen eigener Editor. Vorgabe: Aufklappen.",
      hold_kind: "Dasselbe für einen eine halbe Sekunde langen Griff. Vorgabe: Aktion von Home Assistant.",
      tap_action: "Der Aktionseditor von Home Assistant. In Ziel und Daten setzt {{ entity }} die Hauptentität ein, {{ device }} das Gerät, {{ area }} den Bereich. Kein Jinja, nur diese drei. Vorgabe: Details öffnen.",
      hold_action: "Derselbe Editor für das Halten. Dieselben drei Platzhalter. Vorgabe: Details öffnen.",
      row_tap_action: "Was ein Tippen auf eine Entitätenzeile tut. {{ entity }} ist dann die angetippte Zeile. Ein leeres Ziel füllt sich mit ihr. Vorgabe: Details öffnen.",
      row_hold_action: "Dasselbe für das Halten auf einer Zeile. Vorgabe: nichts.",
    },
    texte: {
      filterBereich: "Filter",
      filterHilfe: "Regeln innerhalb eines Filters sind UND-verknüpft. Mehrere Include-Filter sind ODER-verknüpft; Exclude hat Vorrang. Ohne Include-Regel bleiben alle sichtbaren Geräte-Entities zugelassen. Label-Filter wirken zusätzlich auf die Liste.",
      filterFehler: "Die Entitätenauswahl konnte nicht ausgewertet werden. Regeln im Editor prüfen.",
      template_auto: "Automatisch",
      template_light: "Licht",
      template_climate: "Klima",
      template_cover: "Rollo/Tor",
      template_fan: "Lüfter",
      template_media: "Medien",
      template_lock: "Schloss",
      template_switch: "Schalter",
      template_generic: "Allgemein",
      tap_kind_expand: "Aufklappen",
      "tap_kind_device-page": "Geräteseite öffnen",
      tap_kind_ha: "Aktion von Home Assistant",
      hold_kind_expand: "Aufklappen",
      "hold_kind_device-page": "Geräteseite öffnen",
      hold_kind_ha: "Aktion von Home Assistant",
      groups_control: "Steuerung",
      groups_sensor: "Sensoren",
      groups_config: "Konfiguration",
      groups_diagnostic: "Diagnose",
      groups_open_control: "Steuerung",
      groups_open_sensor: "Sensoren",
      groups_open_config: "Konfiguration",
      groups_open_diagnostic: "Diagnose",
      dienstFehler: "Dienst fehlgeschlagen: {fehler}",
      gruppe_control: "Steuerung",
      gruppe_sensor: "Sensoren",
      gruppe_config: "Konfiguration",
      gruppe_diagnostic: "Diagnose",
      keineEntitaet: "Kein Gerät gewählt. Im Karteneditor ein Gerät oder eine Entität auswählen.",
      geraetFehlt: "Das gewählte Gerät existiert nicht oder wurde gelöscht.",
      altesHa: "Braucht Home Assistant 2024.11 oder neuer.",
      nichtRegistriert: "{entity} ist nicht registriert.",
      keinGeraet: "{entity} gehört zu keinem Gerät.",
      helferFehlt: "Bausteine von Home Assistant nicht ladbar.",
      laden: "Wird geladen …",
      keineTreffer: "Keine passenden Entitäten.",
      keineGeraeteEntitaeten: "Für dieses Gerät sind keine sichtbaren Entitäten verfügbar.",
      aufklappen: "Aufklappen",
      zuklappen: "Zuklappen",
      /* Rueckfallname fuer eine Entitaet ohne eigenen Namen, siehe devKurzname. */
      domain_update: "Firmware",
      domain_light: "Licht",
      domain_switch: "Schalter",
      domain_sensor: "Messwert",
      domain_binary_sensor: "Zustand",
      domain_select: "Auswahl",
      domain_number: "Wert",
      domain_button: "Knopf",
      domain_text: "Text",
      domain_climate: "Klima",
      domain_cover: "Behang",
      domain_fan: "Lüfter",
      domain_lock: "Schloss",
      domain_media_player: "Medien",
      domain_vacuum: "Sauger",
      domain_siren: "Sirene",
      domain_valve: "Ventil",
      domain_humidifier: "Befeuchter",
      domain_water_heater: "Boiler",
      domain_camera: "Kamera",
      domain_device_tracker: "Standort",
      domain_event: "Ereignis",
      domain_time: "Uhrzeit",
      domain_date: "Datum",
      domain_datetime: "Zeitpunkt",
      domain_scene: "Szene",
      domain_remote: "Fernbedienung",
      domain_lawn_mower: "Mäher",
      domain_alarm_control_panel: "Alarm",
      domain_image: "Bild",
      domain_weather: "Wetter",
      domain_todo: "Liste",
      domain_notify: "Nachricht",
      domain_conversation: "Assistent",
      domain_stt: "Spracherkennung",
      domain_tts: "Sprachausgabe",
      domain_assist_satellite: "Assist-Satellit",
      domain_input_boolean: "Schalter",
    },
  },
  en: {
    name: "Busch device",
    description: "Shows the whole device behind an entity: header, control and every entity, grouped like the device page.",
    labels: {
      filter: "Filters",
      device_id: "Device",
      entity: "Entity",
      title: "Heading",
      template: "Layout",
      labels: "Only entities with label",
      labels_hide: "Hide entities with label",
      groups: "Show groups",
      groups_open: "Groups open at start",
      show_subtitle: "Show subtitle",
      start_expanded: "Start expanded",
      tap_kind: "Tap on the header",
      hold_kind: "Hold on the header",
      tap_action: "Action on tap",
      hold_action: "Action on hold",
      row_tap_action: "Tap on a row",
      row_hold_action: "Hold on a row",
    },
    helpers: {
      filter: "Include/exclude rules for this device’s entities, including its main control. Default: no additional rules.",
      device_id: "Select a device directly; no entity is required. Default: resolve the entity’s device.",
      entity: "Any entity of the device. The card finds the device from it and shows this entity as the control at the top.",
      title: "Heading of the card. Empty uses the device name. Default: empty.",
      template: "Which controls appear at the top. Automatic follows the kind of entity. Default: automatic.",
      labels: "Lists only entities carrying one of these labels below. Label selection only affects the list. Default: all.",
      labels_hide: "Entities carrying one of these labels do not appear. Beats the selection above. Default: none.",
      groups: "Which groups appear below the control at all. Default: all four.",
      groups_open: "Which of those start open. The rest are collapsed and open on click. Default: controls only.",
      show_subtitle: "Manufacturer, model and area below the name. Default on.",
      start_expanded: "On shows the control and the entities right away, off only after expanding. Default off.",
      tap_kind: "Expand shows the control and the entities. Device page opens Home Assistant's own page. With Home Assistant action its editor appears below. Default: expand.",
      hold_kind: "The same for a half-second press. Default: Home Assistant action.",
      tap_action: "Home Assistant's action editor. In target and data, {{ entity }} inserts the main entity, {{ device }} the device, {{ area }} the area. No Jinja, just these three. Default: open details.",
      hold_action: "The same editor for holding. The same three placeholders. Default: open details.",
      row_tap_action: "What a tap on an entity row does. {{ entity }} is the tapped row then. An empty target fills itself with it. Default: open details.",
      row_hold_action: "The same for holding a row. Default: nothing.",
    },
    texte: {
      filterBereich: "Filters",
      filterHilfe: "Rules within a filter use AND. Multiple include filters use OR; exclude takes precedence. Without include rules, all visible device entities are allowed. Label filters additionally apply to the list.",
      filterFehler: "The entity selection could not be evaluated. Check the rules in the editor.",
      template_auto: "Automatic",
      template_light: "Light",
      template_climate: "Climate",
      template_cover: "Cover",
      template_fan: "Fan",
      template_media: "Media",
      template_lock: "Lock",
      template_switch: "Switch",
      template_generic: "Generic",
      tap_kind_expand: "Expand",
      "tap_kind_device-page": "Open device page",
      tap_kind_ha: "Home Assistant action",
      hold_kind_expand: "Expand",
      "hold_kind_device-page": "Open device page",
      hold_kind_ha: "Home Assistant action",
      groups_control: "Controls",
      groups_sensor: "Sensors",
      groups_config: "Configuration",
      groups_diagnostic: "Diagnostic",
      groups_open_control: "Controls",
      groups_open_sensor: "Sensors",
      groups_open_config: "Configuration",
      groups_open_diagnostic: "Diagnostic",
      dienstFehler: "Action failed: {fehler}",
      gruppe_control: "Controls",
      gruppe_sensor: "Sensors",
      gruppe_config: "Configuration",
      gruppe_diagnostic: "Diagnostic",
      keineEntitaet: "No device selected. Choose a device or an entity in the card editor.",
      geraetFehlt: "The selected device does not exist or has been deleted.",
      altesHa: "Needs Home Assistant 2024.11 or newer.",
      nichtRegistriert: "{entity} is not registered.",
      keinGeraet: "{entity} belongs to no device.",
      helferFehlt: "Home Assistant building blocks could not be loaded.",
      laden: "Loading …",
      keineTreffer: "No matching entities.",
      keineGeraeteEntitaeten: "No visible entities are available for this device.",
      aufklappen: "Expand",
      zuklappen: "Collapse",
      /* Rueckfallname fuer eine Entitaet ohne eigenen Namen, siehe devKurzname. */
      domain_update: "Firmware",
      domain_light: "Light",
      domain_switch: "Switch",
      domain_sensor: "Measurement",
      domain_binary_sensor: "State",
      domain_select: "Selection",
      domain_number: "Value",
      domain_button: "Button",
      domain_text: "Text",
      domain_climate: "Climate",
      domain_cover: "Cover",
      domain_fan: "Fan",
      domain_lock: "Lock",
      domain_media_player: "Media",
      domain_vacuum: "Vacuum",
      domain_siren: "Siren",
      domain_valve: "Valve",
      domain_humidifier: "Humidifier",
      domain_water_heater: "Water heater",
      domain_camera: "Camera",
      domain_device_tracker: "Location",
      domain_event: "Event",
      domain_time: "Time",
      domain_date: "Date",
      domain_datetime: "Date and time",
      domain_scene: "Scene",
      domain_remote: "Remote",
      domain_lawn_mower: "Lawn mower",
      domain_alarm_control_panel: "Alarm",
      domain_image: "Image",
      domain_weather: "Weather",
      domain_todo: "List",
      domain_notify: "Message",
      domain_conversation: "Assistant",
      domain_stt: "Speech to text",
      domain_tts: "Text to speech",
      domain_assist_satellite: "Assist satellite",
      domain_input_boolean: "Switch",
    },
  },
};

/** Ein Aufruf je Seite, nicht je Karte. Bei Fehler eine leere Map. */
function devLabelsLaden(hass) {
  const core = ensureBuschCore(1);
  core.attach(hass);
  return core.loadLabelRegistry().then(map => map || new Map()).catch(() => new Map());
}

/** HA speichert Label-Farben als Namen (`red`, `indigo`) — im Frontend
 *  werden sie zu `var(--<name>-color)`. Hex-Werte bleiben, wie sie sind. */
function devLabelFarbe(eintrag) {
  const farbe = eintrag && eintrag.color;
  if (!farbe) return "";
  const s = String(farbe);
  if (s.startsWith("#") || s.startsWith("rgb") || s.startsWith("var(")) return s;
  return `var(--${s}-color)`;
}

/** `window.loadCardHelpers()` einmal je Seite; `null`, wenn es fehlt. */
let devHelferCache = null;
function devHelferLaden() {
  if (!devHelferCache) {
    devHelferCache = Promise.resolve()
      .then(() => {
        if (typeof window === "undefined" || typeof window.loadCardHelpers !== "function") return null;
        return window.loadCardHelpers();
      })
      .then((h) => (h && typeof h.createCardElement === "function" && typeof h.createRowElement === "function" ? h : null))
      .catch(() => null);
  }
  return devHelferCache;
}

const DEV_STIL = `
  .dev-kopf { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
    padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px); cursor:pointer;
    user-select:none; -webkit-user-select:none; min-width:0; }
  .dev-icon[hidden] { display:none; }
  .dev-icon { flex:0 0 40px; width:40px; height:40px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    background:rgba(var(--rgb-primary-color, 3, 169, 244), .12);
    color:var(--primary-color); --mdc-icon-size:24px; }
  .dev-titel { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .dev-name { font-size:1.05em; font-weight:var(--ha-font-weight-medium, 500);
    color:var(--primary-text-color);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .dev-unter { display:flex; align-items:center; gap:6px; min-width:0;
    font-size:.85em; color:var(--secondary-text-color); }
  .dev-unter[hidden] { display:none; }
  .dev-unter-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .dev-brand { width:16px; height:16px; flex:0 0 16px; }
  .dev-brand[hidden] { display:none; }
  .dev-pfeil { flex:0 0 auto; width:24px; height:24px; color:var(--secondary-text-color);
    transition:transform .2s ease; --mdc-icon-size:24px; }
  .dev-pfeil[hidden] { display:none !important; }
  .dev-offen .dev-pfeil { transform:rotate(180deg); }
  .dev-chips { display:flex; flex-wrap:wrap; gap:4px;
    padding:0 var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .dev-chips:empty { display:none; }
  .dev-tile { padding:0 var(--ha-space-3, 12px) var(--ha-space-3, 12px); }
  .dev-tile:empty { display:none; }
  /* Ohne !important bliebe das Bedienelement beim Zuklappen stehen — dieselbe
     Absicherung wie bei .dev-liste. */
  .dev-tile[hidden] { display:none !important; }
  .dev-zeile { display:block; }
  .dev-dienstfehler { padding:0 var(--ha-space-4, 16px) var(--ha-space-2, 8px);
    color:var(--error-color); font-size:.85em; overflow-wrap:anywhere; }
  .dev-dienstfehler[hidden] { display:none; }
  .dev-liste { border-top:1px solid var(--divider-color);
    padding:var(--ha-space-1, 4px) var(--ha-space-4, 16px) var(--ha-space-2, 8px); }
  .dev-liste[hidden] { display:none; }
  .dev-gruppe-kopf { display:flex; align-items:center; gap:6px; min-width:0;
    padding:var(--ha-space-2, 8px) 0 var(--ha-space-1, 4px);
    font-size:.78em; text-transform:uppercase; letter-spacing:.06em;
    color:var(--secondary-text-color); background:none; border:0; width:100%;
    text-align:left; font-family:inherit; cursor:pointer; }
  .dev-gruppe-kopf .dev-gruppe-text { overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; min-width:0; }
  .dev-gruppe-kopf .dev-gruppe-pfeil { width:18px; height:18px; flex:0 0 18px;
    --mdc-icon-size:18px; transition:transform .2s ease; }
  .dev-gruppe.dev-zu .dev-gruppe-pfeil { transform:rotate(-90deg); }
  .dev-gruppe.dev-zu .dev-zeilen { display:none; }
  .dev-zeilen > * { display:block; padding:var(--ha-space-1, 4px) 0; }
  .dev-hinweis { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-4, 16px);
    color:var(--secondary-text-color); font-size:.9em; overflow-wrap:anywhere; }
  .dev-hinweis[hidden] { display:none; }
  .dev-hinweis.dev-fehler { color:var(--error-color); }
`;

class BuschDeviceCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-device-card-editor");
  }

  /** Die erste Entität, die zu einem Gerät gehört — damit die Vorschau im
   *  Kartenwähler sofort ein Gerät zeigt (Spec Abschnitt 8). */
  static getStubConfig(hass, entities) {
    const register = (hass && hass.entities) || {};
    const liste = Array.isArray(entities) && entities.length
      ? entities
      : Object.keys((hass && hass.states) || {});
    const treffer = liste.find((id) => register[id] && register[id].device_id) || liste[0] || "";
    // Aufgeklappt, damit die Vorschau im Kartenwaehler etwas zeigt. Die
    // VORGABE von start_expanded bleibt aus.
    return { type: "custom:busch-device-card", entity: treffer, start_expanded: true };
  }

  setConfig(config) {
    this._config = devNormalisiereKonfig(config);
    this._offen = Boolean(this._config.start_expanded);
    this._zu = {};
    this._stempel = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (hass) {
      this._core = ensureBuschCore(1);
      if (!this._releaseCore) {
        this._releaseCore = this._core.retain(hass);
        this._unwatchCore = this._core.watch(() => { this._labels = this._core.labels; this._render(); });
      } else this._core.attach(hass);
    }
    this._labels = this._core?.labels || new Map();
    this._render();
  }

  connectedCallback() { if (this._hass && !this._releaseCore) this.hass = this._hass; }
  disconnectedCallback() { this._filterOff?.(); this._filterOff=null; this._filterQuery=null; this._unwatchCore?.(); this._unwatchCore = null; this._releaseCore?.(); this._releaseCore = null; }

  getCardSize() {
    return this._offen ? 3 + (this._zeilenZahl || 0) : 2;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  get _texte() {
    return buschTexte(TEXTE_BUSCH_DEVICE_CARD, this._hass).texte;
  }

  /* ── Aufbau ─────────────────────────────────────────────────────────── */

  _geruest() {
    if (this._karte) return;
    this._karte = document.createElement("ha-card");
    const stil = document.createElement("style");
    stil.textContent = DEV_STIL;
    this._karte.appendChild(stil);

    this._kopf = document.createElement("div");
    this._kopf.className = "dev-kopf";
    this._icon = document.createElement("div");
    this._icon.className = "dev-icon";
    this._titel = document.createElement("div");
    this._titel.className = "dev-titel";
    this._name = document.createElement("div");
    this._name.className = "dev-name";
    this._unter = document.createElement("div");
    this._unter.className = "dev-unter";
    this._brand = document.createElement("img");
    this._brand.className = "dev-brand";
    this._brand.alt = "";
    this._brand.addEventListener("error", () => { this._brand.hidden = true; });
    this._unterText = document.createElement("span");
    this._unterText.className = "dev-unter-text";
    this._unter.append(this._brand, this._unterText);
    this._titel.append(this._name, this._unter);
    this._pfeil = document.createElement("ha-icon");
    this._pfeil.className = "dev-pfeil";
    this._pfeil.setAttribute("icon", "mdi:chevron-down");
    this._pfeil.icon = "mdi:chevron-down";
    this._kopf.append(this._icon, this._titel, this._pfeil);

    this._chips = document.createElement("div");
    this._chips.className = "dev-chips";
    this._tileBehaelter = document.createElement("div");
    this._tileBehaelter.className = "dev-tile";
    this._liste = document.createElement("div");
    this._liste.className = "dev-liste";
    this._hinweis = document.createElement("div");
    this._hinweis.className = "dev-hinweis";
    this._hinweis.hidden = true;
    this._dienstFehler = document.createElement("div");
    this._dienstFehler.className = "dev-dienstfehler";
    this._dienstFehler.hidden = true;

    this._karte.append(this._kopf, this._chips, this._dienstFehler,
                       this._tileBehaelter, this._liste, this._hinweis);
    this.appendChild(this._karte);
    this._bindeKopf();

    // Zeilen antippen: HAs Zeilen feuern beim Tippen auf den Namensbereich
    // `hass-more-info`. Genau das wird hier abgefangen — KEIN Klick-Abfangen,
    // sonst waere der Schalter einer Schalterzeile unbedienbar.
    // Eigene `more-info`-Ereignisse feuert die Karte an SICH; `_liste` ist ihr
    // Kind, kein Vorfahre, also greift dieser Horcher dort nicht.
    this._liste.addEventListener("hass-more-info", (ereignis) => {
      const id = ereignis.detail && ereignis.detail.entityId;
      if (!id) return;
      if (this._haltVerbraucht) {
        this._haltVerbraucht = false;
        ereignis.stopPropagation();
        return;
      }
      const aktion = this._config.row_tap_action;
      if (!aktion || aktion.action === "more-info") return;
      ereignis.stopPropagation();
      devFuehreAus(this, this._hass, aktion, this._zeilenKontext(id));
    });
  }

  /** Auf- und zuklappen. `devFuehreAus` ruft das fuer die Aktion `expand`. */
  _umschalten() {
    this._offen = !this._offen;
    this._zeigeListe();
  }

  /** Ein fehlgeschlagener Dienstaufruf, zwei Sekunden sichtbar. */
  _zeigeDienstFehler(fehler) {
    if (!this._dienstFehler) return;
    this._dienstFehler.textContent = buschFuellen(this._texte.dienstFehler, {
      fehler: (fehler && fehler.message) || String(fehler),
    });
    this._dienstFehler.hidden = false;
    if (this._fehlerUhr) clearTimeout(this._fehlerUhr);
    this._fehlerUhr = setTimeout(() => { this._dienstFehler.hidden = true; }, 2000);
  }

  /** Der Kontext der Kopfzeile: die Hauptentitaet dieser Karte. */
  _kopfKontext() {
    return devKontext(this._entityId,
      this._auf && this._auf.geraet, this._auf && this._auf.bereich);
  }

  /** Der Kontext einer Zeile: die angetippte Entitaet, dasselbe Geraet. */
  _zeilenKontext(entityId) {
    return devKontext(entityId,
      this._auf && this._auf.geraet, this._auf && this._auf.bereich);
  }

  /**
   * Halten auf einer Zeile. Der Rahmen hoert nur zu: kein eigener
   * Klick-Behandler, kein `pointer-events`, damit jedes Bedienelement der
   * Zeile erreichbar bleibt. Loest das Halten aus, wird das danach folgende
   * `hass-more-info` einmal geschluckt (`_haltVerbraucht`).
   */
  _bindeZeile(rahmen, entityId) {
    let timer = null;
    let start = null;
    const abbrechen = () => { if (timer) { clearTimeout(timer); timer = null; } };
    rahmen.addEventListener("pointerdown", (e) => {
      const aktion = this._config.row_hold_action;
      if (!aktion || aktion.action === "none") return;
      start = { x: e.clientX, y: e.clientY };
      abbrechen();
      timer = setTimeout(() => {
        timer = null;
        this._haltVerbraucht = true;
        devFuehreAus(this, this._hass, aktion, this._zeilenKontext(entityId));
      }, 500);
    });
    rahmen.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) abbrechen();
    });
    rahmen.addEventListener("pointerup", () => { abbrechen(); start = null; });
    rahmen.addEventListener("pointercancel", abbrechen);
    rahmen.addEventListener("pointerleave", abbrechen);
  }

  /** Tippen/Halten wie in HA: 500 ms, Bewegung über 10 px bricht ab. */
  _bindeKopf() {
    let timer = null;
    let gehalten = false;
    let start = null;
    const abbrechen = () => { if (timer) { clearTimeout(timer); timer = null; } };
    this._kopf.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".dev-pfeil")) return;
      gehalten = false;
      start = { x: e.clientX, y: e.clientY };
      abbrechen();
      timer = setTimeout(() => {
        timer = null; gehalten = true;
        devFuehreAus(this, this._hass, this._config.hold_action, this._kopfKontext());
      }, 500);
    });
    this._kopf.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) abbrechen();
    });
    this._kopf.addEventListener("pointerup", (e) => {
      if (e.target.closest(".dev-pfeil")) return;
      const warTimer = Boolean(timer);
      abbrechen();
      if (!gehalten && warTimer) {
        devFuehreAus(this, this._hass, this._config.tap_action, this._kopfKontext());
      }
      start = null;
    });
    this._kopf.addEventListener("pointercancel", abbrechen);
    this._kopf.addEventListener("pointerleave", abbrechen);
    // Der Pfeil klappt immer, unabhängig von tap_action (Spec Abschnitt 6).
    this._pfeil.addEventListener("click", (e) => { e.stopPropagation(); this._umschalten(); });
    this._kopf.setAttribute("role", "button");
    this._kopf.tabIndex = 0;
    this._kopf.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        devFuehreAus(this, this._hass, this._config.tap_action, this._kopfKontext());
      }
    });
  }

  /* ── Zeichnen ───────────────────────────────────────────────────────── */

  _filterForDevice(deviceId) {
    const filter=this._config.filter,active=filter?.include?.length||filter?.exclude?.length;
    if(!active||!this._core){this._filterOff?.();this._filterOff=null;this._filterQuery=null;return null;}
    const spec={filter:{include:filter.include?.length?filter.include:[{entity_id:'*'}],exclude:filter.exclude||[]}};
    const query=this._core.smartQuery(spec,deviceId);
    if(query!==this._filterQuery){this._filterOff?.();this._filterQuery=query;let initial=true;this._filterOff=this._core.subscribe(query,()=>{if(!initial)this._render();});initial=false;}
    return new Set(query.error?[]:query.result.map(row=>row.entity));
  }

  _render() {
    if (!this._config || !this._hass) return;
    this._geruest();
    const t = this._texte;
    const a = devGeraetAufloesen(this._hass, this._config.entity, this._config.device_id, this._core);
    this._entityId = a.entityId || "";

    if (a.fehler) {
      this._filterOff?.();this._filterOff=null;this._filterQuery=null;
      this._stempel = null;
      this._auf = null;
      this._name.textContent = this._config.title || this._config.entity || t.keineEntitaet;
      this._unter.hidden = true;
      this._icon.textContent = "";
      this._icon.hidden = true;
      this._pfeil.hidden = true;
      this._chips.textContent = "";
      this._tileBehaelter.textContent = "";
      this._liste.textContent = "";
      this._liste.hidden = true;
      this._tileBehaelter.hidden = true;
      this._dienstFehler.hidden = true;
      this._karte.classList.remove("dev-offen");
      this._hinweis.textContent = buschFuellen(t[a.fehler], { entity: this._config.entity });
      this._hinweis.className = "dev-hinweis dev-fehler";
      this._hinweis.hidden = false;
      return;
    }

    this._auf = a;
    const vorlage = devVorlageWaehlen(this._config.template, this._entityId);
    const alle = devEntitaetenDesGeraets(this._hass, a.geraet.id, this._entityId, this._core);
    const allowed=this._filterForDevice(a.geraet.id);
    this._filterShowPrimary=!allowed||allowed.has(this._entityId);
    const gefiltert = devLabelFilter(allowed?alle.filter(e=>allowed.has(e.entity_id)):alle, this._config.labels, this._config.labels_hide);
    const gruppen = devGruppieren(this._hass, gefiltert, this._config);
    const stempel = devStrukturStempel(a.geraet.id, vorlage, gruppen, this._config) + this._entityId + this._filterShowPrimary;
    this._zeilenZahl = gruppen.reduce((n, g) => n + g.ids.length, 0);

    if (stempel !== this._stempel) {
      this._stempel = stempel;
      if (this._core) this._core.metrics.structuralBuilds++;
      this._zeichneKopf(a);
      this._zeichneChips();
      this._baueBausteine(stempel, vorlage, gruppen);
    }
    if (this._name.textContent !== (this._config.title || a.name)) this._name.textContent = this._config.title || a.name;
    if (this._unterText.textContent !== a.untertitel) this._unterText.textContent = a.untertitel;
    this._reicheHassDurch();
    this._zeigeListe();
    if(this._filterQuery?.error){this._hinweis.textContent=t.filterFehler;this._hinweis.className='dev-hinweis dev-fehler';this._hinweis.hidden=false;this._filterErrorVisible=true;}else if(this._filterErrorVisible){this._hinweis.hidden=true;this._filterErrorVisible=false;}
  }

  _zeichneKopf(a) {
    this._name.textContent = this._config.title || a.name;
    this._unter.hidden = !this._config.show_subtitle;
    this._unterText.textContent = a.untertitel;
    if (a.platform) {
      this._brand.hidden = false;
      this._brand.src = `https://brands.home-assistant.io/_/${encodeURIComponent(a.platform)}/icon.png`;
    } else {
      this._brand.hidden = true;
    }
    this._icon.textContent = "";
    this._icon.hidden = false;
    const icon = document.createElement("ha-state-icon");
    if (a.eintrag.icon) icon.icon = a.eintrag.icon;
    this._stateIcon = icon;
    this._icon.appendChild(icon);
    this._hinweis.hidden = true;
  }

  _zeichneChips() {
    if(!this._chips)return;
    this._chips.textContent='';
    this._chips.hidden=true;
  }

  /** Tile und Zeilen von HA. Asynchron; eine veraltete Antwort (Stempel
   *  inzwischen anders) wird verworfen. */
  async _baueBausteine(stempel, vorlage, gruppen) {
    const t = this._texte;
    this._tileBehaelter.textContent = "";
    this._liste.textContent = "";
    this._tile = null;
    this._zeilen = [];
    const laden = document.createElement("div");
    laden.className = "dev-hinweis";
    laden.textContent = t.laden;
    this._tileBehaelter.appendChild(laden);

    const helfer = await devHelferLaden();
    if (this._stempel !== stempel) return;
    this._tileBehaelter.textContent = "";
    if (!helfer) {
      this._helferFehlt = true;
      this._hinweis.textContent = t.helferFehlt;
      this._hinweis.className = "dev-hinweis dev-fehler";
      this._hinweis.hidden = false;
      this._zeigeListe();
      return;
    }

    try {
      if (this._entityId && this._filterShowPrimary) {
      const tile = helfer.createCardElement({
        type: "tile",
        entity: this._entityId,
        features: DEV_VORLAGEN[vorlage].features.map((f) => ({ ...f })),
      });
      this._tile = tile;
      this._tileBehaelter.appendChild(tile);
      }
    } catch (e) {
      this._tile = null;
    }

    const geraeteName = this._auf ? this._auf.name : "";
    for (const g of gruppen) {
      const block = document.createElement("div");
      block.className = "dev-gruppe";
      block.dataset.gruppe = g.gruppe;
      // Seit 0.11.0 ist JEDE Gruppe klappbar, nicht mehr nur Konfiguration
      // und Diagnose; der Startzustand kommt aus `groups_open`.
      const kopf = document.createElement("button");
      kopf.className = "dev-gruppe-kopf";
      kopf.type = "button";
      const pfeil = document.createElement("ha-icon");
      pfeil.className = "dev-gruppe-pfeil";
      pfeil.setAttribute("icon", "mdi:chevron-down");
      pfeil.icon = "mdi:chevron-down";
      kopf.appendChild(pfeil);
      if (this._zu[g.gruppe] === undefined) {
        this._zu[g.gruppe] = !devGruppeOffen(this._config, g.gruppe);
      }
      if (this._zu[g.gruppe]) block.classList.add("dev-zu");
      kopf.addEventListener("click", () => {
        this._zu[g.gruppe] = !this._zu[g.gruppe];
        block.classList.toggle("dev-zu", this._zu[g.gruppe]);
      });
      const text = document.createElement("span");
      text.className = "dev-gruppe-text";
      text.textContent = `${t["gruppe_" + g.gruppe]} (${g.ids.length})`;
      kopf.appendChild(text);
      const zeilen = document.createElement("div");
      zeilen.className = "dev-zeilen";
      for (const id of g.ids) {
        try {
          const voll = devAnzeigename(this._hass, this._core?.getEntity(id)?.registry || this._hass.entities?.[id]);
          const kurz = devKurzname(voll, geraeteName, devDomainName(t, id));
          const zeile = helfer.createRowElement({ entity: id, name: kurz });
          const rahmen = document.createElement("div");
          rahmen.className = "dev-zeile";
          rahmen.dataset.entity = id;
          rahmen.appendChild(zeile);
          this._bindeZeile(rahmen, id);
          this._zeilen.push(zeile);
          zeilen.appendChild(rahmen);
        } catch (e) { /* eine kaputte Zeile reißt die anderen nicht mit */ }
      }
      block.append(kopf, zeilen);
      this._liste.appendChild(block);
    }
    // Auch der reine AUSSCHLUSS kann die Liste leeren — am 10.09.2026 an
    // echten Daten gesehen: Label `ignore` auf allen Entitaeten eines
    // Zigbee-Schalters. Ohne diese Zeile blieb die Liste stumm leer.
    if (!gruppen.length && (!this._entityId || !this._filterShowPrimary || this._config.filter || this._config.labels.length || this._config.labels_hide.length)) {
      const leer = document.createElement("div");
      leer.className = "dev-hinweis";
      leer.textContent = this._config.filter || this._config.labels.length || this._config.labels_hide.length ? t.keineTreffer : t.keineGeraeteEntitaeten;
      this._liste.appendChild(leer);
    }
    this._reicheHassDurch();
    this._zeigeListe();
  }

  _reicheHassDurch() {
    if (this._tile) this._tile.hass = this._hass;
    for (const z of this._zeilen || []) z.hass = this._hass;
    if (this._stateIcon && this._auf) {
      this._stateIcon.hass = this._hass;
      this._stateIcon.stateObj = this._hass.states[this._entityId];
    }
  }

  _zeigeListe() {
    // Zugeklappt bleiben nur Icon, Name, Untertitel und die Marken stehen —
    // auch das Bedienelement verschwindet (Spec 0.11.0, Abschnitt 6).
    const offen = Boolean(this._offen) && !this._helferFehlt;
    this._pfeil.hidden = Boolean(this._helferFehlt);
    this._tileBehaelter.hidden = !offen || !this._filterShowPrimary;
    this._liste.hidden = !offen;
    this._karte.classList.toggle("dev-offen", offen);
    const t = this._texte;
    this._kopf.setAttribute("aria-expanded", String(offen));
    this._pfeil.setAttribute("title", offen ? t.zuklappen : t.aufklappen);
  }


}

class BuschDeviceCardEditor extends BuschEditorBase {
  setConfig(config) {
    if (!this._acceptConfig(config,devMigriereKonfig)) return;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /** Die Daten, die `ha-form` sieht: Konfiguration plus die zwei Arten. */
  _daten() {
    return {
      ...DEV_STANDARD,
      ...this._config,
      tap_kind: devArtVon(this._config.tap_action || DEV_STANDARD.tap_action),
      hold_kind: devArtVon(this._config.hold_action || DEV_STANDARD.hold_action),
    };
  }

  _render() {
    if (!this._hass || !this._config) return;
    this._texte = buschTexte(TEXTE_BUSCH_DEVICE_CARD, this._hass);
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._texte.labels[s.name] || s.name;
      this._form.computeHelper = (s) => this._texte.helpers[s.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        this._uebernehmen(event.detail.value);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    // Gefiltert wird gegen die ZUSAMMENGEFUEHRTEN Daten, nicht gegen die rohe
    // Konfiguration: Ohne gesetzten Wert steht dort gar keine Aktion, und die
    // Vorgabe `expand` haette den HA-Editor faelschlich eingeblendet.
    const daten = this._daten();
    this._form.schema = buschSchemaMitTexten(devSchemaFuer(daten).filter(e=>!['filter','labels','labels_hide'].includes(e.name)), this._texte);
    this._form.data = daten;
    this._renderFilter();
  }

  _renderFilter() {
    if(!this._filterHost){this._filterHost=document.createElement('div');this._filterRoot=this._filterHost.attachShadow({mode:'open'});this.insertBefore(this._filterHost,this._form);}
    const key=buschCoreKey([this._config.filter,this._config.labels,this._config.labels_hide,buschSprache(this._hass)]);
    if(key===this._filterStamp){this._labelForm.hass=this._hass;return;}
    this._filterStamp=key;
    const root=this._filterRoot,t=this._texte,smart=buschTexte(TEXTE_BUSCH_SMART_ENTITIES,this._hass);
    const wasOpen=this._filterDetails?.open??false;
    root.replaceChildren(buschSmartElement('style',BUSCH_SMART_EDITOR_CSS));
    const section=buschSmartElement('details');section.open=wasOpen;this._filterDetails=section;section.append(buschSmartElement('summary',t.texte.filterBereich));root.append(section);
    const body=buschSmartElement('div');body.className='body';section.append(body);body.append(buschSmartElement('p',t.texte.filterHilfe));
    const labels=buschSmartElement('ha-form');this._labelForm=labels;labels.hass=this._hass;labels.computeLabel=s=>t.labels[s.name];labels.computeHelper=s=>t.helpers[s.name];labels.schema=SCHEMA_BUSCH_DEVICE_CARD.filter(e=>['labels','labels_hide'].includes(e.name));labels.data={labels:this._config.labels||[],labels_hide:this._config.labels_hide||[]};labels.computeLabel=s=>t.labels[s.name];labels.computeHelper=s=>t.helpers[s.name];labels.addEventListener('value-changed',event=>{event.stopPropagation();this._uebernehmen({...this._daten(),...event.detail.value});});body.append(labels);
    for(const name of ['include','exclude']){
      const heading=buschSmartElement('h4',smart[name]);body.append(heading);
      const rules=this._config.filter?.[name]||[];
      const currentRules=()=>this._config.filter?.[name]||[];
      const update=(next,render=true)=>this._emit({...this._config,filter:{...this._config.filter,[name]:next}},render);
      rules.forEach((rule,i)=>{const wrap=buschSmartElement('div');body.append(wrap);buschSmartFilterBuilder(wrap,rule,(v,render=true)=>update(currentRules().map((r,j)=>i===j?v:r),render),smart,BUSCH_DEVICE_FILTER_RULES);wrap.append(buschSmartButton(smart.remove,()=>update(currentRules().filter((_,j)=>i!==j))));});
      body.append(buschSmartButton(smart.add,()=>update([...currentRules(),{state:name==='exclude'?'unavailable':'on'}])));
    }
  }

  /**
   * Aus den Formulardaten wieder eine Konfiguration machen.
   *
   * Die beiden Art-Felder werden entfernt: `ha-form` reicht bei
   * `value-changed` immer das ganze Datenobjekt zurück, und ungefiltert
   * stünden sie im Dashboard-YAML.
   */
  _uebernehmen(werte) {
    const neu = { ...this._config, ...werte };
    for (const geste of ["tap", "hold"]) {
      const art = werte[geste + "_kind"];
      const feld = geste + "_action";
      if (art === "expand" || art === "device-page") neu[feld] = { action: art };
      else if (devArtVon(neu[feld]) !== "ha") neu[feld] = { action: "more-info" };
      delete neu[geste + "_kind"];
    }
    // Vorgaben wandern nicht in die Konfiguration.
    for (const [schluessel, vorgabe] of Object.entries(DEV_STANDARD)) {
      if (JSON.stringify(neu[schluessel]) === JSON.stringify(vorgabe)) delete neu[schluessel];
    }
    this._emit(neu);
  }

  _emit(config, render=true) {
    this._publishConfig(config);
    if(render) this._render();
    else this._filterStamp=buschCoreKey([config.filter,config.labels,config.labels_hide,buschSprache(this._hass)]);
  }
}

if (!customElements.get?.("busch-calendar-card")) customElements.define("busch-calendar-card", BuschCalendarCard);
if (!customElements.get?.("busch-calendar-card-editor")) customElements.define("busch-calendar-card-editor", BuschCalendarCardEditor);

const waehlerKalender = buschTexte(TEXTE_BUSCH_CALENDAR_CARD);

window.customCards.some(card => card.type === "busch-calendar-card") || window.customCards.push({
  type: "busch-calendar-card",
  name: waehlerKalender.name,
  description: waehlerKalender.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});

if (!customElements.get?.("busch-device-card")) customElements.define("busch-device-card", BuschDeviceCard);
if (!customElements.get?.("busch-device-card-editor")) customElements.define("busch-device-card-editor", BuschDeviceCardEditor);

const waehlerGeraet = buschTexte(TEXTE_BUSCH_DEVICE_CARD);

window.customCards.some(card => card.type === "busch-device-card") || window.customCards.push({
  type: "busch-device-card",
  name: waehlerGeraet.name,
  description: waehlerGeraet.description,
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
const BUSCH_SMART_RULES = ['domain','state','entity_id','name','group','area','floor','level','device','label','device_manufacturer','device_model','integration','hidden_by','attributes','last_changed','last_updated','last_triggered','entity_category','not','or','and','options','type','sort'];
const BUSCH_DEVICE_FILTER_RULES=BUSCH_SMART_RULES.filter(key=>!['options','type','sort'].includes(key));
function buschSmartConfig(config) {
  if(!config || (!config.entities&&!config.filter))throw new Error('filter / entities');
  const copy=JSON.parse(JSON.stringify(config));
  for(const rule of [...(copy.filter?.include||[]),...(copy.filter?.exclude||[])]) for(const key of Object.keys(rule)) if(rule.type===undefined&&!BUSCH_SMART_RULES.includes(key.trim().split(' ')[0]))throw new Error('Unknown rule: '+key);
  if(copy.value&&!['entity_id','device_id','attribute'].includes(copy.value.type))throw new Error('value.type');
  if(Object.hasOwn(copy,'item'))buschSmartItem(copy,null);
  return {...copy,type:'custom:busch-smart-entities'};
}
/* Bind only own object properties; never traverse prototypes or share template values. */
function buschSmartItem(config,value){
  const item=config.item,path=config.item_param;
  if(!item||Array.isArray(item)||typeof item!=='object'||typeof item.type!=='string'||!item.type.trim())throw new Error('item: expected a card object with type / Kartenobjekt mit type erforderlich');
  const parts=typeof path==='string'?path.split('.'):[];
  if(!parts.length||parts.some(k=>!k.trim()||k!==k.trim()||/^\d+$/.test(k)||['__proto__','prototype','constructor'].includes(k)))throw new Error('item_param: invalid object path / ungültiger Objektpfad');
  const result=JSON.parse(JSON.stringify(item));let target=result;
  for(const key of parts.slice(0,-1)){
    if(!Object.hasOwn(target,key))Object.defineProperty(target,key,{value:{},enumerable:true,writable:true,configurable:true});
    if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))throw new Error('item_param: path crosses a scalar or array / Pfad führt durch Einzelwert oder Liste');
    target=target[key];
  }
  Object.defineProperty(target,parts.at(-1),{value:JSON.parse(JSON.stringify(value??null)),enumerable:true,writable:true,configurable:true});
  return result;
}
function buschSmartCardConfig(config,result){
  const key=config.card_param||'entities';
  if(Object.hasOwn(config,'item'))return JSON.parse(JSON.stringify({type:'entities',...config.card,[key]:result.map(value=>buschSmartItem(config,value))}));
  return JSON.parse(JSON.stringify({type:'entities',[key]:result,...config.card}));
}
const TEXTE_BUSCH_SMART_ENTITIES = {
 de:{itemSection:'Karte pro Ergebnis',itemHelp:'Jeder Ergebniswert wird nach Deduplizierung und Begrenzung in eine eigene Kopie der Vorlage eingesetzt. Vorgabe: reine Wertausgabe.',filters:'Filter',more:'Weitere Optionen',navigation:'Konfigurationsbereiche',is:'ist',operator:'Operator',name:'Busch Smart Entities',description:'Entitäten gemeinsam filtern und eine beliebige Zielkarte befüllen.',loading:'Entitäten und Register werden geladen.',error:'Die Abfrage konnte nicht ausgeführt werden.',registry:'Registerdaten konnten nicht vollständig geladen werden. Bitte Rechte und Verbindung prüfen.',javascript:'JavaScript-Abfrage · Optimierung begrenzt',template:'Template-Abfrage · Optimierung begrenzt',declarative:'Deklarative Abfrage',target:'Zielkarte',static:'Statische Entities',include:'Include-Filter',exclude:'Exclude-Filter',templateSection:'Template',sortSection:'Sortierung',display:'Anzeige',advanced:'Erweitert',output:'Ergebnisausgabe',add:'Hinzufügen',remove:'Entfernen',rule:'Regel',and:'UND',or:'ODER',not:'NICHT',field:'Feld',value:'Wert',kind:'Typ',property:'Eigenschaft',string:'Text',number:'Zahl',boolean:'Ja/Nein',object:'Objekt',array:'Liste',null:'Leerwert',import:'Auto-Entities-Konfiguration übernehmen',importHelp:'Konfiguration als JSON einfügen. Alle Felder bleiben erhalten; nur der Kartentyp wird ersetzt.',invalid:'Ungültige Konfiguration.',json:'Erweiterte Kartenkonfiguration',preview:'Ergebnisvorschau',valueHelp:'Ohne Wertausgabe bleiben Entity-Zeilen erhalten. Device-IDs und Attribute benötigen eine Zielkarte, die diese Werte akzeptiert. Eindeutige Werte werden vor globaler Begrenzung gebildet.',filterHelp:'Regeln innerhalb eines Filters sind UND-verknüpft. Weitere Include-Filter fügen Treffer hinzu. Vorgabe: keine Filter.',labels:{card:'Zielkartenoptionen',item:'Kartenvorlage',item_enabled:'Karte pro Ergebnis erzeugen',item_type:'Ergebniskartentyp',item_param:'Bindungspfad',entities:'Statische Entities',filter:'Filter',value:'Ergebnisausgabe',sort:'Sortierung',else:'Alternative Karte',card_type:'Kartentyp',card_param:'Zielparameter',template:'Jinja-Template',show_empty:'Leere Karte anzeigen',unique:'Eindeutige Entity-Zeilen',debug:'Debug anzeigen',value_type:'Ausgabe',attribute:'Attributpfad',missing:'Fehlende Werte',unique_values:'Nur eindeutige Werte',method:'Sortieren nach',reverse:'Absteigend',ignore_case:'Großschreibung ignorieren',numeric:'Numerisch',ip:'IP-Adressen',sort_attribute:'Sortierattribut',first:'Erster Treffer',count:'Anzahl'},helpers:{card:'Weitere Optionen der Zielkarte als typisiertes Objekt bearbeiten. Vorgabe: Entities.',item:'Statische Optionen für jede Ergebniskarte. Vorgabe: keine Vorlage.',item_enabled:'Erzeugt aus jedem ausgegebenen Wert eine Karte. Vorgabe: aus.',item_type:'Kartentyp je Treffer, auch beliebige Custom Cards. Vorgabe: Tile.',item_param:'Objektpfad für den Wert, z. B. device_id oder config.target; keine Listenindizes. Vorgabe beim Aktivieren: entity.',entities:'Feste Entities vor dynamischen Treffern. Vorgabe: keine.',filter:'Rekursive Include-/Exclude-Regeln. Vorgabe: keine.',value:'Werte aus Treffern extrahieren. Vorgabe: Entity-Zeilen.',sort:'Globale Sortierung und Begrenzung. Vorgabe: unverändert.',else:'Karte für leere Ergebnisse. Vorgabe: keine.',card_type:'Zielkarte wählen. Vorgabe: Entities.',card_param:'Parameter der Zielkarte, der Treffer erhält. Vorgabe: entities.',template:'Home Assistant berechnet das Template. Vorgabe: kein Template.',show_empty:'Leere Ergebnisse anzeigen. Vorgabe: ein.',unique:'Ganze Zeilen oder nur Entity-IDs vergleichen. Vorgabe: aus.',debug:'Abfragezähler und Laufzeit anzeigen. Vorgabe: aus.',value_type:'Entity-Zeilen oder extrahierte Werte ausgeben. Vorgabe: Entity-Zeilen.',attribute:'Freier verschachtelter Attributpfad, etwa network.details.interface. Vorgabe: leer.',missing:'Fehlende Zuordnung überspringen oder null ausgeben. Vorgabe: überspringen.',unique_values:'Tatsächlich ausgegebene Werte deduplizieren. Vorgabe: aus.',method:'Name sortiert nach der ersten Treffer-Entity, Gerätename nach dem Register. Vorgabe: unverändert.',reverse:'Sortierreihenfolge umkehren. Vorgabe: aus.',ignore_case:'Text ohne Groß-/Kleinschreibung vergleichen. Vorgabe: aus.',numeric:'Zahlen statt Text vergleichen. Vorgabe: aus.',ip:'IP-Adressen numerisch vergleichen. Vorgabe: aus.',sort_attribute:'Attribut für die Sortierung. Vorgabe: leer.',first:'Anfang bei null zählen. Vorgabe: 0.',count:'Maximale Trefferzahl. Leer lässt alle Treffer zu.'}},
 en:{itemSection:'Card per result',itemHelp:'After deduplication and pagination, each result value is inserted into its own copy of the template. Default: raw values.',filters:'Filters',more:'More options',navigation:'Configuration sections',is:'is',operator:'Operator',name:'Busch Smart Entities',description:'Share entity queries and populate any target card.',loading:'Loading entities and registries.',error:'The query could not be evaluated.',registry:'Registry data could not be loaded completely. Check permissions and connection.',javascript:'JavaScript query · limited optimization',template:'Template query · limited optimization',declarative:'Declarative query',target:'Target card',static:'Static entities',include:'Include filters',exclude:'Exclude filters',templateSection:'Template',sortSection:'Sorting',display:'Display',advanced:'Advanced',output:'Result output',add:'Add',remove:'Remove',rule:'Rule',and:'AND',or:'OR',not:'NOT',field:'Field',value:'Value',kind:'Type',property:'Property',string:'Text',number:'Number',boolean:'Boolean',object:'Object',array:'List',null:'Null',import:'Import auto-entities configuration',importHelp:'Paste configuration as JSON. All fields are preserved; only the card type changes.',invalid:'Invalid configuration.',json:'Advanced card configuration',preview:'Result preview',valueHelp:'Without value output, entity rows are preserved. Device IDs and attributes require a target card that accepts these values. Unique values are calculated before global pagination.',filterHelp:'Rules within a filter use AND. Additional include filters add matches. Default: no filters.',labels:{card:'Target card options',item:'Card template',item_enabled:'Card per result',item_type:'Result card type',item_param:'Binding path',entities:'Static entities',filter:'Filters',value:'Result output',sort:'Sorting',else:'Alternative card',card_type:'Card type',card_param:'Target parameter',template:'Jinja template',show_empty:'Show empty card',unique:'Unique entity rows',debug:'Show debug',value_type:'Output',attribute:'Attribute path',missing:'Missing values',unique_values:'Unique values only',method:'Sort by',reverse:'Descending',ignore_case:'Ignore case',numeric:'Numeric',ip:'IP addresses',sort_attribute:'Sort attribute',first:'First match',count:'Count'},helpers:{card:'Edit further target card options as a typed object. Default: Entities.',item:'Static options for each result card. Default: no template.',item_enabled:'Creates a card from each output value. Default: off.',item_type:'Card type per result, including any custom card. Default: Tile.',item_param:'Object path for the value, e.g. device_id or config.target; no array indices. Default when enabled: entity.',entities:'Fixed entities before dynamic matches. Default: none.',filter:'Recursive include/exclude rules. Default: none.',value:'Extract values from matches. Default: entity rows.',sort:'Global sorting and pagination. Default: unchanged.',else:'Card for empty results. Default: none.',card_type:'Choose the target card. Default: Entities.',card_param:'Target parameter receiving the results. Default: entities.',template:'Home Assistant evaluates the template. Default: no template.',show_empty:'Display empty results. Default: on.',unique:'Compare complete rows or entity IDs only. Default: off.',debug:'Show query counters and execution time. Default: off.',value_type:'Output entity rows or extracted values. Default: entity rows.',attribute:'Free nested attribute path, for example network.details.interface. Default: empty.',missing:'Skip missing values or output null. Default: skip.',unique_values:'Deduplicate the actual output values. Default: off.',method:'Name sorts by the first matching entity; device name uses the registry. Default: unchanged.',reverse:'Reverse sort order. Default: off.',ignore_case:'Compare text without case. Default: off.',numeric:'Compare numbers instead of text. Default: off.',ip:'Compare IP addresses numerically. Default: off.',sort_attribute:'Attribute used for sorting. Default: empty.',first:'Zero-based start offset. Default: 0.',count:'Maximum results. Empty allows all results.'}}
};
Object.assign(TEXTE_BUSCH_SMART_ENTITIES.de, {
 texte:{unique_false:'Aus',unique_true:'Ganze Zeilen',unique_entity:'Entity-ID',value_type_rows:'Entity-Zeilen',value_type_entity_id:'Entity-ID',value_type_device_id:'Geräte-ID',value_type_attribute:'Attribut',missing_skip:'Überspringen',missing_null:'Leerwert (null)',method_none:'Unverändert',method_domain:'Domain',method_entity_id:'Entity-ID',method_name:'Name',method_device_name:'Gerätename',method_device:'Gerät',method_area:'Bereich',method_state:'Zustand',method_attribute:'Attribut',method_last_changed:'Letzte Zustandsänderung',method_last_updated:'Letzte Aktualisierung',method_last_triggered:'Letzte Auslösung',card_type_entities:'Entitäten',card_type_grid:'Raster',card_type_glance:'Übersicht',card_type_map:'Karte', 'card_type_vertical-stack':'Vertikaler Stapel'},
 rules:{domain:'Domain',state:'Zustand',entity_id:'Entity-ID',name:'Name',group:'Gruppe',area:'Bereich',floor:'Etage',level:'Stockwerk',device:'Gerät',label:'Label',device_manufacturer:'Hersteller',device_model:'Modell',integration:'Integration',hidden_by:'Verborgen durch',attributes:'Attribute',last_changed:'Letzte Zustandsänderung',last_updated:'Letzte Aktualisierung',last_triggered:'Letzte Auslösung',entity_category:'Entity-Kategorie',not:'NICHT',or:'ODER',and:'UND',options:'Zeilenoptionen',type:'Zeilentyp',sort:'Lokale Sortierung'}
});
Object.assign(TEXTE_BUSCH_SMART_ENTITIES.en, {texte:{method_device_name:'Device name'},rules:{domain:'Domain',state:'State',entity_id:'Entity ID',name:'Name',group:'Group',area:'Area',floor:'Floor',level:'Level',device:'Device',label:'Label',device_manufacturer:'Manufacturer',device_model:'Model',integration:'Integration',hidden_by:'Hidden by',attributes:'Attributes',last_changed:'Last changed',last_updated:'Last updated',last_triggered:'Last triggered',entity_category:'Entity category',not:'NOT',or:'OR',and:'AND',options:'Row options',type:'Row type',sort:'Local sorting'}});
const BUSCH_SMART_EDITOR_CSS = `:host{display:block;color:var(--primary-text-color)}*{box-sizing:border-box}details{margin-block:var(--ha-space-4,16px)}summary{cursor:pointer;font-weight:var(--ha-font-weight-medium,500);padding-block:var(--ha-space-2,8px)}.body{display:grid;gap:var(--ha-space-2,8px);min-width:0}p,pre{overflow-wrap:anywhere;white-space:pre-wrap;color:var(--secondary-text-color);margin:0}button,input,select,textarea{font:inherit;color:var(--primary-text-color);background:var(--card-background-color);max-width:100%;min-width:0;border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);padding:var(--ha-space-2,8px)}button{cursor:pointer;color:var(--primary-color)}.row{display:flex;flex-wrap:wrap;gap:var(--ha-space-2,8px);align-items:center}.row>*{flex:1;min-width:0}.node{margin-inline-start:var(--ha-space-2,8px);padding-block:var(--ha-space-2,8px)}.hint{font-size:var(--ha-font-size-s,12px)}textarea{width:100%;min-height:var(--ha-space-20,80px)}ha-form{display:block;min-width:0}
[hidden]{display:none!important}.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ha-space-1,4px);margin-block:var(--ha-space-2,8px)}.tabs button{border-radius:var(--ha-card-border-radius,12px);min-height:48px;overflow-wrap:anywhere}.tabs [aria-selected=true]{border-color:var(--primary-color);background:var(--secondary-background-color);font-weight:600}.editor-section{border-bottom:1px solid var(--divider-color)}.rule-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;padding-block:var(--ha-space-2,8px)}.rule-row label{display:grid;gap:var(--ha-space-1,4px);font-size:var(--ha-font-size-s,12px)}.rule-row select,.rule-row input{width:100%;min-height:44px;font-size:var(--ha-font-size-m,14px)}.rule-value{grid-column:1/-1}.rule-row .rule-operator{grid-column:1/-1}.node{margin-inline-start:0}.node .node{padding-inline-start:var(--ha-space-2,8px);border-inline-start:1px solid var(--divider-color)}button:focus-visible,summary:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}`;
function buschSmartElement(tag,text){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;}
function buschSmartButton(text,action){const b=buschSmartElement('button',text);b.type='button';b.addEventListener('click',action);return b;}
function buschSmartSelect(options,value,onchange,label){const select=buschSmartElement('select');select.setAttribute('aria-label',label);for(const [v,text]of options){const o=buschSmartElement('option',text);o.value=v;select.append(o);}select.value=String(value);select.addEventListener('change',()=>onchange(select.value));return select;}
/* UI identities live beside the JSON config and follow a rule across reordering. */
function buschSmartRuleUiNode(oldRule,oldUi,newRule,newId){
  const ui={id:oldUi?.id||newId(),children:{}};
  for(const [raw,value] of Object.entries(newRule||{})){
    const key=raw.trim().split(' ')[0];
    if((key==='and'||key==='or')&&Array.isArray(value))ui.children[raw]=buschSmartRuleUiList(oldRule?.[raw],oldUi?.children?.[raw],value,newId);
    else if(key==='not'&&value&&typeof value==='object')ui.children[raw]=buschSmartRuleUiNode(oldRule?.[raw],oldUi?.children?.[raw],value,newId);
  }
  return ui;
}
function buschSmartRuleUiList(oldRules=[],oldUi=[],newRules=[],newId){
  const used=new Set(),matches=new Array(newRules.length).fill(-1);
  for(const mode of ['identity','same','index'])for(let i=0;i<newRules.length;i++){
    if(matches[i]!==-1)continue;
    const index=oldRules.findIndex((old,j)=>!used.has(j)&&(
      mode==='same'?buschCoreKey(old)===buschCoreKey(newRules[i]):
      mode==='identity'?old===newRules[i]:j===i));
    if(index!==-1){matches[i]=index;used.add(index);}
  }
  return newRules.map((rule,i)=>{const j=matches[i];return buschSmartRuleUiNode(j<0?null:oldRules[j],j<0?null:oldUi[j],rule,newId);});
}
/* Recursive typed object editor: no YAML and no required source-code editing. */
function buschSmartObject(parent,value,change,t,label=t.value){
  const node=buschSmartElement('div');node.className='node';parent.append(node);
  const kind=Array.isArray(value)?'array':value===null?'null':typeof value;
  const row=buschSmartElement('div');row.className='row';node.append(row);
  row.append(buschSmartElement('span',label),buschSmartSelect(['string','number','boolean','object','array','null'].map(k=>[k,t[k]]),kind,k=>change({string:'',number:0,boolean:false,object:{},array:[],null:null}[k]),t.kind));
  if(kind==='object'||kind==='array'){
    for(let [key,item]of Object.entries(value)){
      const wrap=buschSmartElement('div');node.append(wrap);const controls=buschSmartElement('div');controls.className='row';wrap.append(controls);
      if(kind==='object'){const name=buschSmartElement('input');name.value=key;name.setAttribute('aria-label',t.property);name.addEventListener('input',()=>{const candidate=name.value;if(!candidate||candidate===key||Object.hasOwn(value,candidate))return;const next={...value},current=next[key];delete next[key];Object.defineProperty(next,candidate,{value:current,enumerable:true,writable:true,configurable:true});value=next;key=candidate;const label=wrap.querySelector(':scope > .node > .row > span');if(label)label.textContent=candidate;change(next,false);});name.addEventListener('blur',()=>{if(name.value!==key)name.value=key;});controls.append(name);}
      controls.append(buschSmartButton(t.remove,()=>{const next=kind==='array'?[...value]:{...value};if(kind==='array')next.splice(Number(key),1);else delete next[key];change(next);}));
      buschSmartObject(wrap,item,(v,render=true)=>{const next=kind==='array'?[...value]:{...value};Object.defineProperty(next,key,{value:v,enumerable:true,writable:true,configurable:true});value=next;change(next,render);},t,kind==='array'?String(Number(key)+1):key);
    }
    node.append(buschSmartButton(t.add,()=>{if(kind==='array')change([...value,'']);else{let n=1;while(Object.hasOwn(value,'field_'+n))n++;change({...value,['field_'+n]:''});}}));
  }else if(kind==='boolean') row.append(buschSmartSelect([['true','true'],['false','false']],value,v=>change(v==='true'),t.value));
  else if(kind!=='null'){const input=buschSmartElement('input');input.type=kind==='number'?'number':'text';input.value=value??'';input.setAttribute('aria-label',t.value);input.addEventListener('input',()=>change(kind==='number'?Number(input.value):input.value,false));row.append(input);}
}
function buschSmartFilterBuilder(parent,rule,change,t,fields=BUSCH_SMART_RULES,ui){
  const node=buschSmartElement('div');node.className='node';parent.append(node);
  for(const [raw,value] of Object.entries(rule)){
    const key=raw.trim().split(' ')[0],wrap=buschSmartElement('div');node.append(wrap);const row=buschSmartElement('div');row.className='row rule-row';if(ui)row.dataset.uiId=ui.id+':'+raw;wrap.append(row);
    const field=buschSmartElement('label',t.field);row.append(field);
    field.append(buschSmartSelect(fields.map(k=>[k,t.rules?.[k]||k]),key,next=>{const copy={...rule};delete copy[raw];let name=next,n=1;while(Object.hasOwn(copy,name))name=next+' '+n++;copy[name]=['and','or'].includes(next)?[{}]:next==='not'||['attributes','options','sort'].includes(next)?{}:'';change(copy);},t.field));row.append(buschSmartButton(t.remove,()=>{const copy={...rule};delete copy[raw];change(copy);}));
    const replace=(v,render=true)=>{rule={...rule,[raw]:v};change(rule,render);};
    if(key==='and'||key==='or'){
      value.forEach((child,i)=>{const container=buschSmartElement('div');wrap.append(container);buschSmartFilterBuilder(container,child,(v,render=true)=>replace(rule[raw].map((item,j)=>j===i?v:item),render),t,fields,ui?.children?.[raw]?.[i]);container.append(buschSmartButton(t.remove,()=>replace(rule[raw].filter((_,j)=>j!==i))));});
      wrap.append(buschSmartButton(t.add,()=>replace([...rule[raw],{}])));
    }else if(key==='not')buschSmartFilterBuilder(wrap,value,replace,t,fields,ui?.children?.[raw]);
    else if(typeof value==='string' && !['options','sort','attributes'].includes(key)) {
      const parsed=value.match(/^(<=|>=|==|!=|<|>|!|=)\s*(.*)$/), operator=parsed?.[1]||'is';
      const operatorSelect=buschSmartSelect([['is',t.is],...['<','<=','>','>=','=','==','!=','!'].map(op=>[op,op])],operator,op=>replace(op==='is'?input.value:op+' '+input.value),t.operator);
      const input=buschSmartElement('input');input.value=parsed?parsed[2]:value;input.setAttribute('aria-label',t.value);input.addEventListener('input',()=>replace(operatorSelect.value==='is'?input.value:operatorSelect.value+' '+input.value,false));const opLabel=buschSmartElement('label',t.operator);opLabel.className='rule-operator';opLabel.append(operatorSelect);const valueLabel=buschSmartElement('label',t.value);valueLabel.className='rule-value';valueLabel.append(input);row.append(opLabel,valueLabel);
    } else buschSmartObject(wrap,value,replace,t,t.value);
  }
  node.append(buschSmartButton(t.add+' · '+t.rule,()=>{let name='domain',i=1;while(Object.hasOwn(rule,name))name='domain '+i++;change({...rule,[name]:'sensor'});}));
}
class BuschSmartEntities extends HTMLElement {
  static getConfigElement(){return document.createElement('busch-smart-entities-editor');}
  static getStubConfig(hass){
    const counts=new Map();
    for(const [id,entry] of Object.entries(hass?.entities||{}))if(hass?.states?.[entry.entity_id||id]&&entry.platform)counts.set(entry.platform,(counts.get(entry.platform)||0)+1);
    const integration=counts.has('sun')?'sun':[...counts].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0]))[0]?.[0]||'sun';
    return {type:'custom:busch-smart-entities',filter:{include:[{integration}]},card:{type:'entities'},sort:{method:'name',count:6}};
  }
  getCardSize(){return this._child?.getCardSize?.()||1;}
  getGridOptions(){return {columns:12,rows:'auto'};}
  setConfig(config){this._config=buschSmartConfig(config);this._unsubscribe?.();this._unsubscribe=null;this._signature=null;this._trace=null;this._traceCalculation=null;this._generation=(this._generation||0)+1;this._connect();}
  set hass(hass){this._hass=hass;this._connect();if(this._child)this._child.hass=hass;}
  connectedCallback(){this._connect();}
  disconnectedCallback(){this._generation=(this._generation||0)+1;this._unsubscribe?.();this._unsubscribe=null;this._unwatch?.();this._unwatch=null;this._release?.();this._release=null;}
  _connect(){
    if(!this._hass||!this._config)return;
    this._core=ensureBuschCore(1);
    if(!this._release){this._release=this._core.retain(this._hass);this._unwatch=this._core.watch(()=>this._update(this._query?.result||[]));}else this._core.attach(this._hass);
    if(!this._unsubscribe){this._query=this._core.smartQuery(this._config);this._unsubscribe=this._core.subscribe(this._query,rows=>this._update(rows));}
  }
  _message(text){this._generation=(this._generation||0)+1;if(this.hidden){this.hidden=false;this.dispatchEvent(new Event('card-visibility-changed',{bubbles:true}));}if(!this.shadowRoot)this.attachShadow({mode:'open'});const card=buschSmartElement('ha-card'),p=buschSmartElement('p',text);p.style.padding='var(--ha-space-4,16px)';p.style.overflowWrap='anywhere';card.append(p);this.shadowRoot.replaceChildren(card);this._child=null;this._signature=null;}
  async _update(rows){
    if(!this._query)return;const generation=++this._generation;const t=buschTexte(TEXTE_BUSCH_SMART_ENTITIES,this._hass);
    if(this._query.error){this._message(t.error+' '+(this._query.spec.filter?.template?t.template:''));return;}
    if(this._core.lastErrors.size){this._message(t.registry);return;}
    const empty=!rows.length||rows.every(row=>['section','divider'].includes(row?.type));
    const target=empty&&this._config.else?this._config.else:buschSmartCardConfig(this._config,rows);
    const visible=!empty||this._config.show_empty!==false||!!this._config.else;
    if(this.hidden===visible){this.hidden=!visible;this.dispatchEvent(new Event('card-visibility-changed',{bubbles:true}));}
    const signature=buschCoreKey(target);if(signature===this._signature){this._debug();return;}
    try{
      const helpers=await window.loadCardHelpers();if(generation!==this._generation)return;
      if(!this.shadowRoot)this.attachShadow({mode:'open'});
      if(this._child&&this._childType===target.type)this._child.setConfig(target);else{
        const child=await helpers.createCardElement(target);if(generation!==this._generation)return;
        this._child=child;this._childType=target.type;this.shadowRoot.replaceChildren(child);
      }
      this._child.hass=this._hass;this._signature=signature;this._renders=(this._renders||0)+1;this._debug();
    }catch(error){if(generation===this._generation)this._message(t.error);}
  }
  _debug(){
    if(!this.shadowRoot||!this._config.debug)return;let output=this.shadowRoot.querySelector('[data-debug]');if(!output){output=buschSmartElement('pre');output.dataset.debug='';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;color:var(--secondary-text-color);font-size:var(--ha-font-size-s,12px)';this.shadowRoot.append(output);}
    const t=buschTexte(TEXTE_BUSCH_SMART_ENTITIES,this._hass);
    if(this._config.value&&this._traceCalculation!==this._query.metrics.calculations){this._traceCalculation=this._query.metrics.calculations;this._trace={};buschSmartResult(this._core,this._config,this._query.templateRows,this._query.matched.map(set=>[...set].sort((a,b)=>this._core.index.order.get(a)-this._core.index.order.get(b))),this._trace);}
    output.textContent=JSON.stringify({projection:this._trace,generated:this._config.item?buschSmartCardConfig(this._config,this._query.result):undefined,query:this._config.filter?.template?t.template:this._query.javascript?t.javascript:t.declarative,...this._query.metrics,result:this._query.result.length,targetConfigurations:this._renders,core:this._core.debugSnapshot()},null,2);
  }
}
const SCHEMA_BUSCH_SMART_ENTITIES = [
 {name:'item',selector:{object:{}}},{name:'item_enabled',selector:{boolean:{}}},
 {name:'item_type',selector:{select:{mode:'dropdown',custom_value:true,options:['tile','custom:busch-device-card','custom:busch-unraid-container-card'].map(value=>({value,label:value}))}}},
 {name:'item_param',selector:{text:{}}},
 {name:'filter',selector:{object:{}}},{name:'value',selector:{object:{}}},{name:'sort',selector:{object:{}}},{name:'else',selector:{object:{}}},{name:'card',selector:{object:{}}},
 {name:'entities',selector:{entity:{multiple:true}}},
 {name:'card_type',selector:{select:{mode:'dropdown',custom_value:true,options:['entities','grid','glance','map','vertical-stack','custom:apexcharts-card','custom:bubble-card'].map(value=>({value,label:value}))}}},
 {name:'card_param',selector:{text:{}}},{name:'template',selector:{text:{multiline:true}}},
 {name:'show_empty',selector:{boolean:{}}},{name:'unique',selector:{select:{mode:'dropdown',options:[{value:'false',label:'Off'},{value:'true',label:'Rows'},{value:'entity',label:'Entity'}]}}},
 {name:'debug',selector:{boolean:{}}},{name:'value_type',selector:{select:{mode:'dropdown',options:[{value:'rows',label:'Entity rows'},{value:'entity_id',label:'Entity ID'},{value:'device_id',label:'Device ID'},{value:'attribute',label:'Attribute'}]}}},
 {name:'attribute',selector:{text:{}}},{name:'missing',selector:{select:{mode:'dropdown',options:[{value:'skip',label:'Skip'},{value:'null',label:'Null'}]}}},{name:'unique_values',selector:{boolean:{}}},
 {name:'method',selector:{select:{mode:'dropdown',options:['none','domain','entity_id','name','device','device_name','area','state','attribute','last_changed','last_updated','last_triggered'].map(value=>({value,label:value}))}}},
 {name:'reverse',selector:{boolean:{}}},{name:'ignore_case',selector:{boolean:{}}},{name:'numeric',selector:{boolean:{}}},{name:'ip',selector:{boolean:{}}},{name:'sort_attribute',selector:{text:{}}},{name:'first',selector:{number:{min:0,mode:'box'}}},{name:'count',selector:{number:{min:0,mode:'box'}}}
];
class BuschSmartEntitiesEditor extends BuschEditorBase {
  _syncRuleUi(oldConfig,config){
    this._nextRuleUiId ||= 0;
    const newId=()=>`smart-rule-${++this._nextRuleUiId}`;
    this._ruleUiIds=Object.fromEntries(['include','exclude'].map(name=>[name,
      buschSmartRuleUiList(oldConfig?.filter?.[name]||[],this._ruleUiIds?.[name]||[],config?.filter?.[name]||[],newId)]));
  }
  setConfig(config){const previous=this._config;if(!this._acceptConfig(config||BuschSmartEntities.getStubConfig()))return;this._syncRuleUi(previous,this._config);this._render();}
  set hass(hass){const changed=buschSprache(this._hass)!==buschSprache(hass);this._hass=hass;if(!this.shadowRoot||changed)this._render();else for(const form of this.shadowRoot.querySelectorAll('ha-form,hui-entities-card-editor'))form.hass=hass;}
  _emit(config,render=true){const previous=this._config;this._publishConfig(config);this._syncRuleUi(previous,this._config);if(render)this._render();}
  _section(title,group='more',defaultOpen=false){const details=buschSmartElement('details');details.className='editor-section';details.dataset.group=group;details.dataset.section=title;details.open=this._sectionOpen?.get(title)??defaultOpen;details.append(buschSmartElement('summary',title));const body=buschSmartElement('div');body.className='body';details.append(body);this.shadowRoot.append(details);return body;}
  _form(parent,names,data,change){const t=this._t,form=buschSmartElement('ha-form');form.computeLabel=s=>t.labels[s.name]||s.name;form.computeHelper=s=>t.helpers[s.name]||'';form.hass=this._hass;form.schema=buschSchemaMitTexten(SCHEMA_BUSCH_SMART_ENTITIES.filter(f=>names.includes(f.name)),t);
    if(names.includes('attribute')) {
      const attrs=new Set();const walk=(obj,prefix='',depth=0)=>{if(depth>4||!obj||typeof obj!=='object')return;for(const [key,value]of Object.entries(obj)){const path=prefix?prefix+'.'+key:key;attrs.add(path);if(attrs.size<300)walk(value,path,depth+1);}};
      for(const state of Object.values(this._hass.states||{})){walk(state.attributes);if(attrs.size>=300)break;}
      form.schema=form.schema.map(f=>f.name==='attribute'?{...f,selector:{select:{custom_value:true,options:[...attrs].sort().map(value=>({value,label:value}))}}}:f);
    }form.data=data;form.computeLabel=s=>t.labels[s.name]||s.name;form.computeHelper=s=>t.helpers[s.name]||'';form.addEventListener('value-changed',event=>{event.stopPropagation();change(event.detail.value);});parent.append(form);return form;}
  _render(){
    if(!this._hass||!this._config)return;if(!this.shadowRoot)this.attachShadow({mode:'open'});this._t=buschTexte(TEXTE_BUSCH_SMART_ENTITIES,this._hass);const t=this._t,c=this._config;
    this._sectionOpen=new Map([...this.shadowRoot.querySelectorAll('.editor-section')].map(e=>[e.dataset.section,e.open]));this.shadowRoot.replaceChildren(buschSmartElement('style',BUSCH_SMART_EDITOR_CSS));
    const nav=buschSmartElement('div');nav.className='tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label',t.navigation);this.shadowRoot.append(nav);
    for(const [group,label]of [['filters',t.filters],['card',t.target],['more',t.more]]){const button=buschSmartButton(label,()=>this._showGroup(group));button.dataset.group=group;button.setAttribute('role','tab');button.id='tab-'+group;button.setAttribute('aria-controls','panel-'+group);nav.append(button);}
    nav.addEventListener('keydown',event=>{const tabs=[...nav.children],index=tabs.indexOf(event.target);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;event.preventDefault();tabs[next].click();tabs[next].focus();});
    const target=this._section(t.target,'card',true);this._form(target,['card_type','card_param'],{card_type:c.card?.type||'entities',card_param:c.card_param||'entities'},v=>this._emit({...this._config,card:{...this._config.card,type:v.card_type},card_param:v.card_param},v.card_type!==(this._config.card?.type||'entities')));
    const embedded=buschSmartElement('div');target.append(embedded);this._pendingTarget={host:embedded,config:c.card||{type:'entities'}};
    const advancedTarget=buschSmartElement('details');advancedTarget.append(buschSmartElement('summary',t.json));target.append(advancedTarget);buschSmartObject(advancedTarget,c.card||{type:'entities'},(v,render=true)=>this._emit({...this._config,card:v},render),t,t.labels.card);
    const itemBody=this._section(t.itemSection,'card',!!c.item);itemBody.append(buschSmartElement('p',t.itemHelp));
    this._form(itemBody,['item_enabled'],{item_enabled:!!c.item},v=>{const next={...this._config};if(v.item_enabled){next.item={type:'tile'};next.item_param='entity';if(!next.value)next.value={type:'entity_id',missing:'skip'};if(!next.card||next.card.type==='entities'){next.card={type:'vertical-stack'};next.card_param='cards';}}else{delete next.item;delete next.item_param;}this._emit(next);});
    if(c.item){
      this._form(itemBody,['item_type','item_param'],{item_type:c.item.type,item_param:c.item_param||''},v=>this._emit({...this._config,item:{...this._config.item,type:v.item_type},item_param:v.item_param},v.item_type!==this._config.item.type));
      const options=buschSmartElement('details');options.append(buschSmartElement('summary',t.json));itemBody.append(options);buschSmartObject(options,c.item,(v,render=true)=>this._emit({...this._config,item:v},render),t,t.labels.item);
    }
    const staticSection=this._section(t.static,'filters');
    this._form(staticSection,['entities'],{entities:(c.entities||[]).filter(e=>typeof e==='string')},v=>this._emit({...this._config,entities:[...(v.entities||[]),...(this._config.entities||[]).filter(e=>typeof e!=='string')]}));
    buschSmartObject(staticSection,c.entities||[],(v,render=true)=>this._emit({...this._config,entities:v},render),t);
    for(const name of ['include','exclude']){const body=this._section(t[name],'filters',name==='include');body.append(buschSmartElement('p',t.filterHelp));const rules=c.filter?.[name]||[];const currentRules=()=>this._config.filter?.[name]||[];rules.forEach((rule,i)=>{const wrap=buschSmartElement('div');body.append(wrap);buschSmartFilterBuilder(wrap,rule,(v,render=true)=>this._emit({...this._config,filter:{...this._config.filter,[name]:currentRules().map((r,j)=>i===j?v:r)}},render),t,BUSCH_SMART_RULES,this._ruleUiIds?.[name]?.[i]);wrap.append(buschSmartButton(t.remove,()=>this._emit({...this._config,filter:{...this._config.filter,[name]:currentRules().filter((_,j)=>i!==j)}})));});body.append(buschSmartButton(t.add,()=>this._emit({...this._config,filter:{...this._config.filter,[name]:[...currentRules(),{domain:'sensor'}]}})));}
    this._form(this._section(t.templateSection,'filters'),['template'],{template:c.filter?.template||''},v=>this._emit({...this._config,filter:{...this._config.filter,template:v.template}},false));
    const output=this._section(t.output,'more',true);output.append(buschSmartElement('p',t.valueHelp));const outputNames=['value_type','missing','unique_values'];if(c.value?.type==='attribute')outputNames.splice(1,0,'attribute');
    this._form(output,outputNames,{value_type:c.value?.type||'rows',attribute:c.value?.attribute||'',missing:c.value?.missing||'skip',unique_values:!!c.unique_values},v=>{const next={...this._config,unique_values:v.unique_values};if(v.value_type==='rows')delete next.value;else next.value={type:v.value_type,...(v.value_type==='attribute'?{attribute:v.attribute}:{}),missing:v.missing};this._emit(next,v.value_type!==(this._config.value?.type||'rows'));});
    const sortNames=['method','reverse','ignore_case','numeric','ip','sort_attribute','first','count'];this._form(this._section(t.sortSection),sortNames,{method:'none',first:0,...c.sort,sort_attribute:c.sort?.attribute||''},v=>{const sort={...v};sort.attribute=sort.sort_attribute;delete sort.sort_attribute;if(sort.method==='none')delete sort.method;this._emit({...this._config,sort},false);});
    const display=this._section(t.display);this._form(display,['show_empty','unique','debug'],{show_empty:c.show_empty!==false,unique:String(c.unique||false),debug:!!c.debug},v=>this._emit({...this._config,show_empty:v.show_empty,unique:v.unique==='true'?true:v.unique==='false'?false:v.unique,debug:v.debug},false));buschSmartObject(display,c.else||null,(v,render=true)=>{const next={...this._config};if(v===null)delete next.else;else next.else=v;this._emit(next,render);},t,'else');
    buschSmartObject(this._section(t.advanced),c,(v,render=true)=>this._emit(buschSmartConfig(v),render),t);
    const importer=this._section(t.import);importer.append(buschSmartElement('p',t.importHelp));const input=buschSmartElement('textarea');input.setAttribute('aria-label',t.import);importer.append(input);const error=buschSmartElement('p');importer.append(buschSmartButton(t.import,()=>{try{this._emit(buschSmartConfig(JSON.parse(input.value)));}catch(e){error.textContent=t.invalid;}}),error);
    for(const group of ['filters','card','more']){const panel=buschSmartElement('div');panel.id='panel-'+group;panel.dataset.panel=group;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','tab-'+group);for(const section of [...this.shadowRoot.querySelectorAll('.editor-section')])if(section.dataset.group===group)panel.append(section);if(group==='filters'){const include=[...panel.children].find(e=>e.dataset.section===t.include);if(include)panel.prepend(include);}this.shadowRoot.append(panel);}
    this._showGroup(this._activeGroup||'filters');
  }
  _showGroup(group){this._activeGroup=group;for(const tab of this.shadowRoot.querySelectorAll('[role=tab]')){const selected=tab.dataset.group===group;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}for(const panel of this.shadowRoot.querySelectorAll('[role=tabpanel]'))panel.hidden=panel.dataset.panel!==group;if(group==='card'&&this._pendingTarget){const {host,config}=this._pendingTarget;this._pendingTarget=null;this._targetEditor(host,config);}}
  async _targetEditor(host,config){try{const helpers=await window.loadCardHelpers(),parameter=this._config.card_param||'entities',preview={...config,[parameter]:config[parameter]||[]};const card=await helpers.createCardElement(preview);if(!host.isConnected||!card.constructor.getConfigElement)return;const editor=await card.constructor.getConfigElement();if(!host.isConnected)return;editor.hass=this._hass;editor.setConfig(preview);editor.addEventListener('config-changed',event=>{event.stopPropagation();const target={...event.detail.config};if(!Object.hasOwn(config,parameter)&&Array.isArray(target[parameter])&&!target[parameter].length)delete target[parameter];this._emit({...this._config,card:target},false);});host.append(editor);}catch(error){/* The typed object editor remains available. */}}
}
if (!customElements.get?.("busch-smart-entities")) customElements.define("busch-smart-entities", BuschSmartEntities);
if (!customElements.get?.("busch-smart-entities-editor")) customElements.define("busch-smart-entities-editor", BuschSmartEntitiesEditor);
if(!(window.customCards||=[]).some(card=>card.type==='busch-smart-entities'))window.customCards.push({type:'busch-smart-entities',name:buschTexte(TEXTE_BUSCH_SMART_ENTITIES).name,description:buschTexte(TEXTE_BUSCH_SMART_ENTITIES).description,preview:true,documentationURL:'https://github.com/luukkii123/ha-busch-cards'});
/* Unraid cards: joins are exclusively backend metadata + registry scope. */
const BUSCH_UNRAID_DEFAULTS = { title: '', config_entry_id: '', device_id: '', container_key: '', switch_entity: '', update_entity: '', layout: 'detailed', show_status: true, show_controls: true, show_containers: true, show_updates: true, state_filter: 'all', sort: 'name', show_restart: true, confirm_stop: true, confirm_restart: true, start_expanded: true };
const TEXTE_BUSCH_UNRAID_STACK_CARD = {
 de: {
  labels: {title:'Titel',config_entry_id:'Unraid-Instanz',device_id:'Gerät',container_key:'Container',switch_entity:'Schalter zuordnen',update_entity:'Update zuordnen',layout:'Darstellung',show_status:'Status anzeigen',show_controls:'Steuerung anzeigen',show_containers:'Container anzeigen',show_updates:'Updates anzeigen',state_filter:'Container filtern',sort:'Sortierung',show_restart:'Neustart anzeigen',confirm_stop:'Stoppen bestätigen',confirm_restart:'Neustart bestätigen',start_expanded:'Aufgeklappt starten'},
  helpers: {title:'Eigener Kartentitel; Vorgabe ist der Gerätename.',config_entry_id:'Begrenzt die Auswahl auf diese Unraid-Instanz; Vorgabe sind alle Instanzen.',device_id:'Wählt ein Unraid-Gerät; Vorgabe ist das erste passende Gerät.',container_key:'Wählt einen Container anhand seiner Backendkennung; Vorgabe ist der einzige Container, sonst bitte auswählen.',switch_entity:'Ordnet bei älterem Backend einen Schalter ausdrücklich zu; Vorgabe ist die automatische Zuordnung.',update_entity:'Ordnet bei älterem Backend das passende Update ausdrücklich zu; Vorgabe ist die automatische Zuordnung.',layout:'Bestimmt den Umfang der Angaben; Vorgabe ist ausführlich.',show_status:'Zeigt Zustand und laufende Container; Vorgabe ist ein.',show_controls:'Zeigt verfügbare Start- und Stoppaktionen; Vorgabe ist ein.',show_containers:'Zeigt die Containerliste des Stacks; Vorgabe ist ein.',show_updates:'Zeigt zugeordnete verfügbare Updates; Vorgabe ist ein.',state_filter:'Zeigt alle, laufende oder gestoppte Container; Vorgabe ist alle.',sort:'Sortiert Container nach Name oder Zustand; Vorgabe ist Name.',show_restart:'Zeigt ausschließlich native Neustartaktionen; ohne Backendunterstützung nicht verfügbar. Vorgabe ist ein.',confirm_stop:'Fragt vor dem Stoppen nach; Vorgabe ist ein.',confirm_restart:'Fragt vor dem Neustart nach; Vorgabe ist ein.',start_expanded:'Öffnet die Containerliste beim Laden; Vorgabe ist ein.'},
  texte:{layout_compact:'Kompakt',layout_detailed:'Ausführlich',state_filter_all:'Alle',state_filter_running:'Laufend',state_filter_stopped:'Gestoppt',sort_name:'Name',sort_state:'Zustand'},
  stack:'Unraid-Stack',container:'Unraid-Container',stack_description:'Steuert einen Unraid-Compose-Stack und seine Container.',container_description:'Zeigt und steuert einen Unraid-Container.',empty:'Kein passendes Unraid-Gerät gefunden.',metadata:'Keine eindeutige Zuordnung verfügbar. Backend aktualisieren oder einen Schalter im Editor auswählen.',choose:'Bitte einen Container im Editor auswählen.',none:'Keine Container für diesen Filter.',start:'Starten',stop:'Stoppen',restart:'Neu starten',details:'Details',update:'Update',running:'Läuft',stopped:'Gestoppt',partial:'Teilweise gestartet',unavailable:'Nicht verfügbar',unknown:'Unbekannt',paused:'Pausiert',standalone:'Eigenständiger Container',container_group:'Container ({count})',expand:'Container aufklappen',collapse:'Container zuklappen',running_count:'{running} von {total} laufen',confirm_stop:'„{name}“ stoppen?',confirm_restart:'„{name}“ neu starten?',failed:'Aktion fehlgeschlagen. Bitte Zustand und Berechtigungen prüfen.',restart_missing:'Native Neustartfunktion fehlt. Dafür ist das aktualisierte Unraid-Backend erforderlich. Vorgabe ist ein.'
 },
 en: {
  labels: {title:'Title',config_entry_id:'Unraid instance',device_id:'Device',container_key:'Container',switch_entity:'Assign switch',update_entity:'Assign update',layout:'Layout',show_status:'Show status',show_controls:'Show controls',show_containers:'Show containers',show_updates:'Show updates',state_filter:'Filter containers',sort:'Sort order',show_restart:'Show restart',confirm_stop:'Confirm stop',confirm_restart:'Confirm restart',start_expanded:'Start expanded'},
  helpers: {title:'Custom card title; defaults to the device name.',config_entry_id:'Limits selection to this Unraid instance; defaults to all instances.',device_id:'Selects an Unraid device; defaults to the first matching device.',container_key:'Selects a container using its backend identity; defaults to the only container, otherwise select one.',switch_entity:'Explicitly assigns a switch on older backends; defaults to automatic matching.',update_entity:'Explicitly assigns the matching update on older backends; defaults to automatic matching.',layout:'Controls the amount of detail; defaults to detailed.',show_status:'Shows state and running count; enabled by default.',show_controls:'Shows available start and stop actions; enabled by default.',show_containers:'Shows the stack container list; enabled by default.',show_updates:'Shows matching available updates; enabled by default.',state_filter:'Shows all, running or stopped containers; defaults to all.',sort:'Sorts containers by name or state; defaults to name.',show_restart:'Shows native restart actions only; unavailable without backend support. Enabled by default.',confirm_stop:'Asks before stopping; enabled by default.',confirm_restart:'Asks before restarting; enabled by default.',start_expanded:'Expands the container list when loaded; enabled by default.'},
  texte:{layout_compact:'Compact',layout_detailed:'Detailed',state_filter_all:'All',state_filter_running:'Running',state_filter_stopped:'Stopped',sort_name:'Name',sort_state:'State'},
  stack:'Unraid stack',container:'Unraid container',stack_description:'Controls an Unraid Compose stack and its containers.',container_description:'Displays and controls an Unraid container.',empty:'No matching Unraid device found.',metadata:'No unambiguous mapping available. Update the backend or select a switch in the editor.',choose:'Select a container in the editor.',none:'No containers match this filter.',start:'Start',stop:'Stop',restart:'Restart',details:'Details',update:'Update',running:'Running',stopped:'Stopped',partial:'Partially running',unavailable:'Unavailable',unknown:'Unknown',paused:'Paused',standalone:'Standalone container',container_group:'Containers ({count})',expand:'Expand containers',collapse:'Collapse containers',running_count:'{running} of {total} running',confirm_stop:'Stop “{name}”?',confirm_restart:'Restart “{name}”?',failed:'Action failed. Check the current state and permissions.',restart_missing:'Native restart is unavailable. The updated Unraid backend is required. Enabled by default.'
 }
};
const TEXTE_BUSCH_UNRAID_CONTAINER_CARD = {
 de: {
  labels: {title:'Titel',config_entry_id:'Unraid-Instanz',device_id:'Gerät',container_key:'Container',switch_entity:'Schalter zuordnen',update_entity:'Update zuordnen',layout:'Darstellung',show_status:'Status anzeigen',show_controls:'Steuerung anzeigen',show_containers:'Container anzeigen',show_updates:'Updates anzeigen',state_filter:'Container filtern',sort:'Sortierung',show_restart:'Neustart anzeigen',confirm_stop:'Stoppen bestätigen',confirm_restart:'Neustart bestätigen',start_expanded:'Aufgeklappt starten'},
  helpers: {title:'Eigener Kartentitel; Vorgabe ist der Gerätename.',config_entry_id:'Begrenzt die Auswahl auf diese Unraid-Instanz; Vorgabe sind alle Instanzen.',device_id:'Wählt ein Unraid-Gerät; Vorgabe ist das erste passende Gerät.',container_key:'Wählt einen Container anhand seiner Backendkennung; Vorgabe ist der einzige Container, sonst bitte auswählen.',switch_entity:'Ordnet bei älterem Backend einen Schalter ausdrücklich zu; Vorgabe ist die automatische Zuordnung.',update_entity:'Ordnet bei älterem Backend das passende Update ausdrücklich zu; Vorgabe ist die automatische Zuordnung.',layout:'Bestimmt den Umfang der Angaben; Vorgabe ist ausführlich.',show_status:'Zeigt Zustand und laufende Container; Vorgabe ist ein.',show_controls:'Zeigt verfügbare Start- und Stoppaktionen; Vorgabe ist ein.',show_containers:'Zeigt die Containerliste des Stacks; Vorgabe ist ein.',show_updates:'Zeigt zugeordnete verfügbare Updates; Vorgabe ist ein.',state_filter:'Zeigt alle, laufende oder gestoppte Container; Vorgabe ist alle.',sort:'Sortiert Container nach Name oder Zustand; Vorgabe ist Name.',show_restart:'Zeigt ausschließlich native Neustartaktionen; ohne Backendunterstützung nicht verfügbar. Vorgabe ist ein.',confirm_stop:'Fragt vor dem Stoppen nach; Vorgabe ist ein.',confirm_restart:'Fragt vor dem Neustart nach; Vorgabe ist ein.',start_expanded:'Öffnet die Containerliste beim Laden; Vorgabe ist ein.'},
  texte:{layout_compact:'Kompakt',layout_detailed:'Ausführlich',state_filter_all:'Alle',state_filter_running:'Laufend',state_filter_stopped:'Gestoppt',sort_name:'Name',sort_state:'Zustand'},
  stack:'Unraid-Stack',container:'Unraid-Container',stack_description:'Steuert einen Unraid-Compose-Stack und seine Container.',container_description:'Zeigt und steuert einen Unraid-Container.',empty:'Kein passendes Unraid-Gerät gefunden.',metadata:'Keine eindeutige Zuordnung verfügbar. Backend aktualisieren oder einen Schalter im Editor auswählen.',choose:'Bitte einen Container im Editor auswählen.',none:'Keine Container für diesen Filter.',start:'Starten',stop:'Stoppen',restart:'Neu starten',details:'Details',update:'Update',running:'Läuft',stopped:'Gestoppt',partial:'Teilweise gestartet',unavailable:'Nicht verfügbar',unknown:'Unbekannt',paused:'Pausiert',standalone:'Eigenständiger Container',expand:'Container aufklappen',collapse:'Container zuklappen',running_count:'{running} von {total} laufen',confirm_stop:'„{name}“ stoppen?',confirm_restart:'„{name}“ neu starten?',failed:'Aktion fehlgeschlagen. Bitte Zustand und Berechtigungen prüfen.',restart_missing:'Native Neustartfunktion fehlt. Dafür ist das aktualisierte Unraid-Backend erforderlich. Vorgabe ist ein.'
 },
 en: {
  labels: {title:'Title',config_entry_id:'Unraid instance',device_id:'Device',container_key:'Container',switch_entity:'Assign switch',update_entity:'Assign update',layout:'Layout',show_status:'Show status',show_controls:'Show controls',show_containers:'Show containers',show_updates:'Show updates',state_filter:'Filter containers',sort:'Sort order',show_restart:'Show restart',confirm_stop:'Confirm stop',confirm_restart:'Confirm restart',start_expanded:'Start expanded'},
  helpers: {title:'Custom card title; defaults to the device name.',config_entry_id:'Limits selection to this Unraid instance; defaults to all instances.',device_id:'Selects an Unraid device; defaults to the first matching device.',container_key:'Selects a container using its backend identity; defaults to the only container, otherwise select one.',switch_entity:'Explicitly assigns a switch on older backends; defaults to automatic matching.',update_entity:'Explicitly assigns the matching update on older backends; defaults to automatic matching.',layout:'Controls the amount of detail; defaults to detailed.',show_status:'Shows state and running count; enabled by default.',show_controls:'Shows available start and stop actions; enabled by default.',show_containers:'Shows the stack container list; enabled by default.',show_updates:'Shows matching available updates; enabled by default.',state_filter:'Shows all, running or stopped containers; defaults to all.',sort:'Sorts containers by name or state; defaults to name.',show_restart:'Shows native restart actions only; unavailable without backend support. Enabled by default.',confirm_stop:'Asks before stopping; enabled by default.',confirm_restart:'Asks before restarting; enabled by default.',start_expanded:'Expands the container list when loaded; enabled by default.'},
  texte:{layout_compact:'Compact',layout_detailed:'Detailed',state_filter_all:'All',state_filter_running:'Running',state_filter_stopped:'Stopped',sort_name:'Name',sort_state:'State'},
  stack:'Unraid stack',container:'Unraid container',stack_description:'Controls an Unraid Compose stack and its containers.',container_description:'Displays and controls an Unraid container.',empty:'No matching Unraid device found.',metadata:'No unambiguous mapping available. Update the backend or select a switch in the editor.',choose:'Select a container in the editor.',none:'No containers match this filter.',start:'Start',stop:'Stop',restart:'Restart',details:'Details',update:'Update',running:'Running',stopped:'Stopped',partial:'Partially running',unavailable:'Unavailable',unknown:'Unknown',paused:'Paused',standalone:'Standalone container',expand:'Expand containers',collapse:'Collapse containers',running_count:'{running} of {total} running',confirm_stop:'Stop “{name}”?',confirm_restart:'Restart “{name}”?',failed:'Action failed. Check the current state and permissions.',restart_missing:'Native restart is unavailable. The updated Unraid backend is required. Enabled by default.'
 }
};
const BUSCH_UNRAID_TEXT = TEXTE_BUSCH_UNRAID_STACK_CARD;
function buschUnraidDevices(core,kind,entry) {
 if(!core) return [];
 return [...core.devices.values()].filter(d=>(kind==='stack'?d.model==='Compose stack':['Compose stack','Docker container'].includes(d.model))&&(!entry||(d.config_entries||[]).includes(entry))&&core.getDeviceEntities(d.id).some(e=>e.platform==='unraid_ssh'&&(!entry||e.config_entry_id===entry))).sort((a,b)=>String(a.name_by_user||a.name||a.id).localeCompare(String(b.name_by_user||b.name||b.id)));
}
function buschUnraidAvailable(entity){return !!entity&&!['unavailable','unknown',undefined].includes(entity.state);}
function buschUnraidStatus(entity){if(!entity||entity.state==='unavailable')return 'unavailable';if(entity.state==='on')return 'running';if(entity.state==='off')return 'stopped';return 'unknown';}
function buschUnraidLegacy(entries){
 return entries.map(e=>{
  if(e.attributes.kind&&e.attributes.role)return e;
  const entry=e.config_entry_id,uid=e.registry?.unique_id;
  if(e.platform!=='unraid_ssh'||!entry||!e.device_id||typeof uid!=='string')return e;
  const prefix=e.domain==='switch'?entry+'_container_':e.domain==='update'?entry+'_update_':null;
  if(prefix&&uid.startsWith(prefix)&&uid.length>prefix.length){
   const name=uid.slice(prefix.length),modern=entries.filter(other=>other.config_entry_id===entry&&other.device_id===e.device_id&&other.platform==='unraid_ssh'&&other.attributes.kind==='container'&&other.attributes.role==='control'&&other.attributes.container_name===name&&other.attributes.container_key);
   const keys=[...new Set(modern.map(other=>other.attributes.container_key))];
   if(keys.length>1)return e;
   return {...e,attributes:{...e.attributes,kind:'container',role:e.domain==='switch'?'control':'update',config_entry_id:entry,container_key:keys[0]||'legacy:'+name,container_name:name,identity_status:'legacy'}};
  }
  const stackPrefix=entry+'_stack_';
  if(e.domain==='switch'&&uid.startsWith(stackPrefix)&&uid.length>stackPrefix.length)return {...e,attributes:{...e.attributes,kind:'stack',role:'control',config_entry_id:entry,stack_key:uid.slice(stackPrefix.length),identity_status:'legacy'}};
  return e;
 });
}
function buschUnraidModel(core,config,kind) {
 const devices=buschUnraidDevices(core,kind,config.config_entry_id),device=config.device_id?devices.find(d=>d.id===config.device_id):devices[0];
 const model={device:device||null,containers:[],selected:null,switch:null,restart:null,status:'unknown',running:0,total:0};
 if(!device)return model;
 const entries=buschUnraidLegacy(core.getDeviceEntities(device.id).filter(e=>e.platform==='unraid_ssh'&&(!config.config_entry_id||e.config_entry_id===config.config_entry_id)&&!e.registry?.disabled_by));
 const unique=rows=>rows.length===1?rows[0]:null;
 const explicit=(id,domain)=>unique(entries.filter(e=>e.entity_id===id&&e.domain===domain));
 const controls=entries.filter(e=>e.domain==='switch'&&e.attributes.kind==='container'&&e.attributes.role==='control'&&e.attributes.container_key);
 const keys=new Set(controls.map(e=>e.config_entry_id+'\0'+e.attributes.container_key));
 for(const key of keys){const candidates=controls.filter(e=>e.config_entry_id+'\0'+e.attributes.container_key===key),sw=unique(candidates);if(!sw)continue;
  const a=sw.attributes,related=entries.filter(e=>e.config_entry_id===sw.config_entry_id&&e.attributes.kind==='container'&&e.attributes.container_key===a.container_key);
  model.containers.push({key:a.container_key,name:a.container_name||sw.attributes.friendly_name||sw.entity_id,stack:a.stack_name||a.stack_key||(device.model==='Compose stack'?(device.name_by_user||device.name):null),image:a.image||'',switch:sw,restart:unique(related.filter(e=>e.domain==='button'&&e.attributes.role==='restart')),update:unique(related.filter(e=>e.domain==='update'&&e.attributes.role==='update')),status:a.container_state==='paused'?'paused':buschUnraidStatus(sw)});
 }
 const stack=unique(entries.filter(e=>e.domain==='switch'&&e.attributes.kind==='stack'&&e.attributes.role==='control'&&e.attributes.stack_key));
 model.switch=stack||explicit(config.switch_entity,'switch');
 model.restart=stack?unique(entries.filter(e=>e.domain==='button'&&e.attributes.role==='restart'&&e.attributes.kind==='stack'&&e.config_entry_id===stack.config_entry_id&&e.attributes.stack_key===stack.attributes.stack_key)):null;
 model.running=model.containers.filter(c=>c.status==='running').length;model.total=model.containers.length;
 const reportedRunning=stack?.attributes.running_containers,reportedTotal=stack?.attributes.total_containers;
 if(Number.isFinite(reportedRunning)&&Number.isFinite(reportedTotal)){model.running=reportedRunning;model.total=reportedTotal;}
 model.status=model.total?(model.running===model.total?'running':model.running===0?'stopped':'partial'):buschUnraidStatus(model.switch);
 if(!(Number.isFinite(reportedRunning)&&Number.isFinite(reportedTotal))&&model.containers.some(c=>['unavailable','unknown'].includes(c.status)))model.status=model.containers.some(c=>c.status==='unavailable')?'unavailable':'unknown';
 if(model.switch?.state==='unavailable')model.status='unavailable';
 if(kind==='container'){
  model.selected=config.container_key?model.containers.find(c=>c.key===config.container_key)||null:model.containers.length===1?model.containers[0]:null;
  if(!model.selected&&config.switch_entity){const sw=explicit(config.switch_entity,'switch');if(sw)model.selected={key:sw.entity_id,name:sw.attributes.friendly_name||device.name||sw.entity_id,switch:sw,restart:null,update:explicit(config.update_entity,'update'),status:buschUnraidStatus(sw),stack:device.model==='Compose stack'?(device.name_by_user||device.name):null};}
 }
 if(kind==='container'&&model.selected&&config.update_entity)model.selected={...model.selected,update:explicit(config.update_entity,'update')};
 model.containers.sort((a,b)=>config.sort==='state'?a.status.localeCompare(b.status)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
 return model;
}
const SCHEMA_BUSCH_UNRAID_STACK_CARD = [
 {name: "title", "selector": {"text": {}}},
 {name: "config_entry_id", "selector": {"config_entry": {"integration": "unraid_ssh"}}},
 {name: "device_id", "selector": {"select": {"options": []}}},
 {name: "switch_entity", "selector": {"entity": {"filter": {"integration": "unraid_ssh", "domain": "switch"}}}},
 {name: "layout", "selector": {"select": {"options": [{"value": "compact"}, {"value": "detailed"}]}}},
 {name: "show_status", "selector": {"boolean": {}}},
 {name: "show_controls", "selector": {"boolean": {}}},
 {name: "show_updates", "selector": {"boolean": {}}},
 {name: "show_containers", "selector": {"boolean": {}}},
 {name: "state_filter", "selector": {"select": {"options": [{"value": "all"}, {"value": "running"}, {"value": "stopped"}]}}},
 {name: "sort", "selector": {"select": {"options": [{"value": "name"}, {"value": "state"}]}}},
 {name: "start_expanded", "selector": {"boolean": {}}},
 {name: "show_restart", "selector": {"boolean": {}}},
 {name: "confirm_stop", "selector": {"boolean": {}}},
 {name: "confirm_restart", "selector": {"boolean": {}}}
];
const SCHEMA_BUSCH_UNRAID_CONTAINER_CARD = [
 {name: "title", "selector": {"text": {}}},
 {name: "config_entry_id", "selector": {"config_entry": {"integration": "unraid_ssh"}}},
 {name: "device_id", "selector": {"select": {"options": []}}},
 {name: "container_key", "selector": {"select": {"options": []}}},
 {name: "switch_entity", "selector": {"entity": {"filter": {"integration": "unraid_ssh", "domain": "switch"}}}},
 {name: "update_entity", "selector": {"entity": {"filter": {"integration": "unraid_ssh", "domain": "update"}}}},
 {name: "layout", "selector": {"select": {"options": [{"value": "compact"}, {"value": "detailed"}]}}},
 {name: "show_status", "selector": {"boolean": {}}},
 {name: "show_controls", "selector": {"boolean": {}}},
 {name: "show_updates", "selector": {"boolean": {}}},
 {name: "show_restart", "selector": {"boolean": {}}},
 {name: "confirm_stop", "selector": {"boolean": {}}},
 {name: "confirm_restart", "selector": {"boolean": {}}}
];
function buschUnraidSchema(core,config,kind){
 const model=buschUnraidModel(core,config,kind),base=kind==='stack'?SCHEMA_BUSCH_UNRAID_STACK_CARD:SCHEMA_BUSCH_UNRAID_CONTAINER_CARD;
 return base.map(field=>{
  if(field.name==='device_id')return {...field,selector:{select:{options:buschUnraidDevices(core,kind,config.config_entry_id).map(d=>({value:d.id,label:d.name_by_user||d.name||d.id}))}}};
  if(field.name==='container_key')return {...field,selector:{select:{options:model.containers.map(c=>({value:c.key,label:c.name}))}}};
  if(field.name==='switch_entity'||field.name==='update_entity')return {...field,selector:{entity:{filter:{integration:'unraid_ssh',domain:field.name==='switch_entity'?'switch':'update',...(model.device?{device_id:model.device.id}:{})}}}};
  if(field.name==='show_restart')return {...field,disabled:kind==='stack'?!model.restart&&!model.containers.some(c=>c.restart):!model.selected?.restart};
  return field;
 });
}
const BUSCH_UNRAID_STYLE = `
:host{display:block;min-width:0;container-type:inline-size;color:var(--primary-text-color);--unraid-space:var(--ha-space-4,16px);--unraid-small:var(--ha-space-2,8px)}
*{box-sizing:border-box;min-width:0}ha-card{display:block;overflow:hidden;padding:var(--unraid-space);font-family:inherit;color:var(--primary-text-color);background:var(--card-background-color)}
h2,.name{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--ha-font-size-l,18px);font-weight:var(--ha-font-weight-medium,500)}
p,.detail,.message{margin:0;overflow-wrap:anywhere;font-size:var(--ha-font-size-m,14px)}.detail{color:var(--secondary-text-color)}
.header{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:var(--unraid-small) var(--unraid-space);align-items:center;padding-bottom:var(--unraid-space)}
.card-icon,.row-icon{display:grid;place-items:center;flex:none;color:var(--primary-color);background:var(--secondary-background-color);border-radius:var(--ha-card-border-radius,12px)}.card-icon{width:48px;height:48px}.row-icon{width:40px;height:40px}
.header-main{display:grid;gap:var(--ha-space-1,4px);min-width:0}.header-main .detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.status-badge{display:inline-flex;align-items:center;gap:var(--ha-space-2,8px);justify-self:end;padding:var(--ha-space-1,4px) var(--ha-space-3,12px);border-radius:999px;font-size:var(--ha-font-size-s,12px);font-weight:var(--ha-font-weight-medium,500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;min-width:0;background:var(--secondary-background-color);color:var(--secondary-text-color)}
.status-badge::before{content:'';width:8px;height:8px;flex:none;border-radius:50%;background:currentColor}.status-running{color:var(--success-color,#16864b);background:color-mix(in srgb,var(--success-color,#16864b) 12%,var(--card-background-color))}.status-partial,.status-paused{color:var(--warning-color,#a76900);background:color-mix(in srgb,var(--warning-color,#a76900) 12%,var(--card-background-color))}.status-unavailable{color:var(--error-color);background:color-mix(in srgb,var(--error-color) 10%,var(--card-background-color))}
.actions{display:flex;flex-wrap:wrap;gap:var(--unraid-small)}.header>.actions{grid-column:2/-1;justify-content:flex-end}
button{font:inherit;color:var(--primary-color);background:var(--secondary-background-color);border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);padding:var(--unraid-small) var(--ha-space-3,12px);min-height:44px;cursor:pointer;overflow-wrap:anywhere;max-width:100%}button:disabled{color:var(--disabled-text-color);cursor:default}button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.danger{color:var(--error-color);border-color:color-mix(in srgb,var(--error-color) 35%,var(--divider-color));background:color-mix(in srgb,var(--error-color) 7%,var(--card-background-color))}.quiet{background:var(--card-background-color)}
.disclosure{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:var(--unraid-small);text-align:start;color:var(--primary-text-color);background:var(--secondary-background-color)}.disclosure::after{content:'⌄';font-size:1.25em;line-height:1}.disclosure[aria-expanded=false]::after{transform:rotate(-90deg)}
.rows{display:grid;margin-top:var(--unraid-small);border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);overflow:hidden}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--unraid-small);align-items:center;padding:var(--ha-space-3,12px)}.row+.row{border-top:1px solid var(--divider-color)}.row-identity{display:flex;align-items:center;gap:var(--ha-space-3,12px);min-width:0}.row-text{display:grid;gap:var(--ha-space-1,4px);min-width:0}.row .name{font-size:var(--ha-font-size-m,14px)}.row>.actions{grid-column:1/-1;justify-content:flex-end}.row .detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.message{margin-top:var(--unraid-space)}.error{color:var(--error-color)}.compact .detail{display:none}
@container (max-width:440px){.header{grid-template-columns:40px minmax(0,1fr);column-gap:var(--unraid-small)}.card-icon{width:40px;height:40px}.header>.status-badge{grid-column:2;justify-self:start}.header>.actions{grid-column:1/-1;justify-content:flex-start}.row>.status-badge{grid-column:1;justify-self:start}.row>.actions{justify-content:flex-start}.actions button{flex:1 1 calc(50% - var(--unraid-small))}}
`;
function buschUnraidNode(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function buschUnraidBadge(status,text){return buschUnraidNode('span',text,'status-badge status-'+status);}
function buschUnraidIcon(name,className){const holder=buschUnraidNode('span',undefined,className),icon=buschUnraidNode('ha-icon');holder.setAttribute('aria-hidden','true');icon.setAttribute('icon',name);holder.appendChild(icon);return holder;}
class BuschUnraidBaseCard extends HTMLElement {
 constructor(){super();this.attachShadow({mode:'open'});this._config={...BUSCH_UNRAID_DEFAULTS};this._expanded=true;this._generation=0;}
 setConfig(config){this._config={...BUSCH_UNRAID_DEFAULTS,...config};this._expanded=this._config.start_expanded;this._error=null;this._generation++;this._render();}
 set hass(hass){this._hass=hass;if(this.isConnected)this._connect();this._core?.attach(hass);this._render();}
 get hass(){return this._hass;}
 connectedCallback(){this._connect();this._render();}
 disconnectedCallback(){this._release?.();this._unwatch?.();this._unwatchDevice?.();this._unwatchDevice=null;this._watchDeviceId=null;this._release=this._unwatch=null;this._generation++;}
 _connect(){if(!this._hass||this._release)return;this._core=ensureBuschCore(1);this._release=this._core.retain(this._hass);this._unwatch=this._core.watch(()=>this._render());}
 getCardSize(){return this._kind==='stack'&&this._expanded?4:2;}
 getGridOptions(){return {columns:12,min_columns:3,rows:this.getCardSize()*2,min_rows:2};}
 _button(parent,text,action,disabled=false,destructive=false){const button=buschUnraidNode('button',text,destructive?'danger':'');button.type='button';button.disabled=disabled;button.addEventListener('click',action);parent.appendChild(button);return button;}
 _actions(parent,row,t){const actions=buschUnraidNode('div',undefined,'actions');
  if(this._config.show_controls&&row.switch){const running=row.status==='running'||row.status==='partial'||row.switch.state==='on';this._button(actions,running?t.stop:t.start,()=>this._action(running?'stop':'start',row),this._busy||!buschUnraidAvailable(row.switch),running);}
  if(this._config.show_controls&&this._config.show_restart&&row.restart)this._button(actions,t.restart,()=>this._action('restart',row),this._busy||row.restart.state==='unavailable');
  if(row.switch){const details=this._button(actions,t.details,()=>this._action('details',row));details.className='quiet';}
  if(this._config.show_updates&&row.update?.state==='on')this._button(actions,t.update,()=>this._action('update',row));
  if(actions.childNodes.length)parent.appendChild(actions);
 }
 async _action(action,row){
  const t=buschTexte(BUSCH_UNRAID_TEXT,this._hass);
  if(action==='details'||action==='update'){const entity=action==='update'?row.update:row.switch;if(entity)this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:entity.entity_id},bubbles:true,composed:true}));return;}
  if(this._busy)return;const entity=action==='restart'?row.restart:row.switch;
  if(!entity||entity.state==='unavailable'||(action!=='restart'&&!buschUnraidAvailable(entity)))return;
  if((action==='stop'&&this._config.confirm_stop)||(action==='restart'&&this._config.confirm_restart))if(!window.confirm(t['confirm_'+action].replace('{name}',row.name||'')))return;
  const generation=this._generation;this._busy=true;this._error=null;this._render();
  try{await this._hass.callService(action==='restart'?'button':'switch',action==='restart'?'press':action==='start'?'turn_on':'turn_off',{entity_id:entity.entity_id});}
  catch{if(generation===this._generation)this._error=t.failed;}
  finally{this._busy=false;this._render();}
 }
 _render(){if(!this.shadowRoot||!this._config)return;const t=buschTexte(BUSCH_UNRAID_TEXT,this._hass),m=buschUnraidModel(this._core,this._config,this._kind);if(this.isConnected&&this._watchDeviceId!==m.device?.id){this._unwatchDevice?.();this._watchDeviceId=m.device?.id;this._unwatchDevice=this._watchDeviceId?this._core.watchDevice?.(this._watchDeviceId,()=>this._render()):null;}const signature=JSON.stringify([this._config,m,this._expanded,!!this._busy,this._error,t]);if(signature===this._renderSignature)return;this._renderSignature=signature;const card=buschUnraidNode('ha-card'),style=buschUnraidNode('style',BUSCH_UNRAID_STYLE);card.className=this._config.layout;
  const header=buschUnraidNode('div',undefined,'header'),title=this._config.title||m.device?.name_by_user||m.device?.name||t[this._kind];
  const main=buschUnraidNode('div',undefined,'header-main'),titleNode=buschUnraidNode('h2',title);
  main.appendChild(titleNode);header.appendChild(buschUnraidIcon(this._kind==='stack'?'mdi:docker':'mdi:cube-outline','card-icon'));header.appendChild(main);card.appendChild(header);
  const message=text=>card.appendChild(buschUnraidNode('p',text,'message'));
  if(!m.device)message(t.empty);
  else if(this._kind==='container'){
   const row=m.selected;if(!row)message(m.containers.length?t.choose:t.metadata);else{if(!this._config.title)titleNode.textContent=row.name;if(this._config.show_status)header.appendChild(buschUnraidBadge(row.status,t[row.status]||t.unknown));main.appendChild(buschUnraidNode('p',row.stack||t.standalone,'detail'));if(row.image)main.appendChild(buschUnraidNode('p',row.image,'detail'));this._actions(header,row,t);}
  }else{
   if(this._config.show_status){header.appendChild(buschUnraidBadge(m.status,t[m.status]||t.unknown));main.appendChild(buschUnraidNode('p',t.running_count.replace('{running}',m.running).replace('{total}',m.total),'detail'));}
   this._actions(header,{...m,name:title},t);if(!m.switch&&!m.containers.length)message(t.metadata);
   if(this._config.show_containers&&m.containers.length){const expand=this._button(card,t.container_group.replace('{count}',m.containers.length),()=>{this._expanded=!this._expanded;this._render();});expand.className='disclosure';expand.setAttribute('aria-expanded',String(this._expanded));expand.setAttribute('aria-label',this._expanded?t.collapse:t.expand);
    if(this._expanded){const rows=buschUnraidNode('div',undefined,'rows'),visible=m.containers.filter(c=>this._config.state_filter==='all'||c.status===this._config.state_filter);if(!visible.length)rows.appendChild(buschUnraidNode('p',t.none,'message'));for(const row of visible){const item=buschUnraidNode('div',undefined,'row'),identity=buschUnraidNode('div',undefined,'row-identity'),texts=buschUnraidNode('div',undefined,'row-text');texts.appendChild(buschUnraidNode('div',row.name,'name'));if(row.image)texts.appendChild(buschUnraidNode('p',row.image,'detail'));identity.appendChild(buschUnraidIcon('mdi:cube-outline','row-icon'));identity.appendChild(texts);item.appendChild(identity);if(this._config.show_status)item.appendChild(buschUnraidBadge(row.status,t[row.status]||t.unknown));this._actions(item,row,t);rows.appendChild(item);}card.appendChild(rows);}
   }
  }
  if(this._error){const error=buschUnraidNode('p',this._error,'message error');error.setAttribute('role','alert');card.appendChild(error);}this.shadowRoot.replaceChildren(style,card);
 }
}
class BuschUnraidStackCard extends BuschUnraidBaseCard {
 get _kind(){return 'stack';}
 static getConfigElement(){return document.createElement('busch-unraid-stack-card-editor');}
 static getStubConfig(hass){if(!hass)return {type:'custom:busch-unraid-stack-card'};const core=ensureBuschCore(1);core.attach(hass);const device=buschUnraidDevices(core,'stack')[0];return {type:'custom:busch-unraid-stack-card',...(device?{device_id:device.id}:{})};}
}
class BuschUnraidContainerCard extends BuschUnraidBaseCard {
 get _kind(){return 'container';}
 static getConfigElement(){return document.createElement('busch-unraid-container-card-editor');}
 static getStubConfig(hass){if(!hass)return {type:'custom:busch-unraid-container-card'};const core=ensureBuschCore(1);core.attach(hass);const model=buschUnraidModel(core,{},'container');return {type:'custom:busch-unraid-container-card',...(model.device?{device_id:model.device.id}:{}),...(model.containers[0]?{container_key:model.containers[0].key}:{})};}
}
class BuschUnraidBaseEditor extends BuschEditorBase {
 setConfig(config){if(!this._acceptConfig(config))return;this._render();}
 set hass(hass){this._hass=hass;if(this.isConnected)this._connect();this._core?.attach(hass);this._render();}
 connectedCallback(){this._connect();this._render();}
 disconnectedCallback(){this._release?.();this._unwatch?.();this._release=this._unwatch=null;}
 _connect(){if(!this._hass||this._release)return;this._core=ensureBuschCore(1);this._release=this._core.retain(this._hass);this._unwatch=this._core.watch(()=>this._render());}
 _render(){if(!this._config||!this._hass)return;const t=buschTexte(BUSCH_UNRAID_TEXT,this._hass);if(!this._form){this._form=document.createElement('ha-form');this._form.addEventListener('value-changed',event=>{event.stopPropagation();const next={...this._config,...event.detail.value};let structural=false;if((next.config_entry_id||'')!==(this._config.config_entry_id||'')){delete next.device_id;delete next.container_key;delete next.switch_entity;delete next.update_entity;structural=true;}else if((next.device_id||'')!==(this._config.device_id||'')){delete next.container_key;delete next.switch_entity;delete next.update_entity;structural=true;}this._publishConfig(next);if(structural)this._render();});this.appendChild(this._form);}
  this._form.hass=this._hass;this._form.data={...BUSCH_UNRAID_DEFAULTS,...this._config};this._form.schema=buschSchemaMitTexten(buschUnraidSchema(this._core,this._config,this._kind),t);this._form.computeLabel=s=>t.labels[s.name]||s.name;this._form.computeHelper=s=>s.name==='show_restart'&&s.disabled?t.restart_missing:t.helpers[s.name]||'';
 }
}
class BuschUnraidStackEditor extends BuschUnraidBaseEditor {get _kind(){return 'stack';}}
class BuschUnraidContainerEditor extends BuschUnraidBaseEditor {get _kind(){return 'container';}}
if(!customElements.get?.('busch-unraid-stack-card'))customElements.define('busch-unraid-stack-card',BuschUnraidStackCard);
if(!customElements.get?.('busch-unraid-container-card'))customElements.define('busch-unraid-container-card',BuschUnraidContainerCard);
if(!customElements.get?.('busch-unraid-stack-card-editor'))customElements.define('busch-unraid-stack-card-editor',BuschUnraidStackEditor);
if(!customElements.get?.('busch-unraid-container-card-editor'))customElements.define('busch-unraid-container-card-editor',BuschUnraidContainerEditor);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==='busch-unraid-stack-card'))window.customCards.push({type:'busch-unraid-stack-card',name:buschTexte(TEXTE_BUSCH_UNRAID_STACK_CARD).stack,description:buschTexte(TEXTE_BUSCH_UNRAID_STACK_CARD).stack_description,preview:true,documentationURL:'https://github.com/luukkii123/ha-busch-cards'});
if(!window.customCards.some(c=>c.type==='busch-unraid-container-card'))window.customCards.push({type:'busch-unraid-container-card',name:buschTexte(TEXTE_BUSCH_UNRAID_CONTAINER_CARD).container,description:buschTexte(TEXTE_BUSCH_UNRAID_CONTAINER_CARD).container_description,preview:true,documentationURL:'https://github.com/luukkii123/ha-busch-cards'});
