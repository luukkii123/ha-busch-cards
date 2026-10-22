'use strict';
// busch-unraid-docker-card: Gruppierung, Zählung, Zustände, Ausklappen,
// Menüeinträge je Fähigkeit, Service-Aufrufe, Bestätigung, Filter, Sortierung,
// echte Bilder (entity_picture) und Editor-Schema DE/EN.
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Werte aus der VM-Sandbox stammen aus einem anderen Realm: über JSON vergleichen.
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor(tag = 'div') { this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = {}; this.className = ''; this.title = ''; this._text = ''; this.isConnected = false; }
  attachShadow() { this.shadowRoot = new Element('#shadow'); return this.shadowRoot; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((n) => n.textContent).join(''); }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  append(...n) { for (const x of n) this.appendChild(x); }
  replaceChildren(...n) { this.childNodes = []; this.append(...n); }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  toggleAttribute(k, on) { if (on) this.attributes[k] = ''; else delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatchEvent(e) { this.event = e; (this.events ||= []).push(e); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 10, top: 10, right: 110, bottom: 74, width: 100, height: 64 }; }
  all() { return [this, ...this.childNodes.flatMap((c) => c.all())]; }
  querySelectorAll(sel) { const cls = sel.replace(/^\./, '').split(':')[0]; return this.all().slice(1).filter((n) => sel === 'button' ? n.tagName === 'BUTTON' : String(n.className).split(/\s+/).includes(cls)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  click() { for (const fn of this.listeners.click || []) fn({ stopPropagation() {} }); }
}

function load(language = 'de') {
  const source = fs.readFileSync(path.join(__dirname, '../dist/busch-cards.js'), 'utf8');
  const registered = new Map();
  const body = new Element('body');
  const document = { createElement: (tag) => { if (!registered.has(tag)) return new Element(tag); const n = new (registered.get(tag))(); n.tagName = tag.toUpperCase(); return n; }, body, querySelectorAll: (sel) => body.all().filter((n) => n.tagName === sel.toUpperCase()) };
  const history = { stack: [null], get state() { return this.stack.at(-1); }, pushState(s) { this.stack.push(s); }, back() { this.stack.pop(); } };
  const window = { customCards: [], confirm: () => true, innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {}, scrollX: 0, scrollY: 0 };
  const context = { performance, setTimeout, clearTimeout, HTMLElement: Element, customElements: { define: (k, v) => registered.set(k, v), get: (k) => registered.get(k) }, window, history, navigator: { language }, console, CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } }, document };
  vm.createContext(context);
  vm.runInContext(source, context);
  const pick = vm.runInContext('({buschUnraidDockerModel,buschUnraidServers,buschUnraidSchema,BuschUnraidDockerCard,BuschUnraidDockerEditor,TEXTE_BUSCH_UNRAID_DOCKER_CARD,SCHEMA_BUSCH_UNRAID_DOCKER_CARD,BUSCH_UNRAID_DOCKER_DEFAULTS})', context);
  return { ...pick, context, registered, body, history };
}

const BILD = (n) => `/api/unraid_ssh/icons/${n}.png`; // echte Integrationsform, kein Fake-Icon
function fixture() {
  const core = { devices: new Map(), entities: new Map(), getDeviceEntities(id) { return [...this.entities.values()].filter((e) => e.device_id === id); } };
  core.devices.set('server', { id: 'server', name: 'Tower', model: 'Unraid', config_entries: ['entry'] });
  core.devices.set('media', { id: 'media', name: 'Tower Stack media', model: 'Compose stack', config_entries: ['entry'] });
  core.devices.set('tools', { id: 'tools', name: 'Tower Stack tools', model: 'Compose stack', config_entries: ['entry'] });
  core.devices.set('solo', { id: 'solo', name: 'Tower webserver', model: 'Docker container', config_entries: ['entry'] });
  core.devices.set('paused', { id: 'paused', name: 'Tower cache', model: 'Docker container', config_entries: ['entry'] });
  core.devices.set('gone', { id: 'gone', name: 'Tower broken', model: 'Docker container', config_entries: ['entry'] });
  core.devices.set('vm', { id: 'vm', name: 'Tower VM win', model: 'Virtual machine', config_entries: ['entry'] });
  const ent = (id, device, state, attributes) => core.entities.set(id, { entity_id: id, device_id: device, platform: 'unraid_ssh', config_entry_id: 'entry', domain: id.split('.')[0], state, attributes: { config_entry_id: 'entry', ...attributes }, registry: {} });
  ent('sensor.tower_cpu', 'server', '12', { kind: 'server', role: 'cpu' });
  const container = (key, device, state, extra = {}) => {
    const base = { kind: 'container', container_key: key, container_name: key, stack_name: extra.stack || null, container_state: extra.container_state || (state === 'on' ? 'running' : 'exited'), ...(extra.picture === false ? {} : { entity_picture: BILD(key) }) };
    ent(`switch.${key}`, device, state, { ...base, role: 'control' });
    if (extra.restart !== false) ent(`button.${key}_restart`, device, 'unknown', { ...base, role: 'restart' });
    if (extra.update) ent(`update.${key}`, device, extra.update, { ...base, role: 'update' });
  };
  container('media', 'media', 'on', { stack: 'media', update: 'on' });
  container('media-db', 'media', 'on', { stack: 'media', update: 'off' });
  container('media-worker', 'media', 'off', { stack: 'media', picture: false });
  ent('switch.stack_media', 'media', 'on', { kind: 'stack', role: 'control', stack_key: 'media', stack_name: 'media', running_containers: 2, total_containers: 3 });
  ent('button.stack_media_restart', 'media', 'unknown', { kind: 'stack', role: 'restart', stack_key: 'media' });
  ent('button.stack_media_update_all', 'media', 'unknown', { kind: 'stack', role: 'update_all', stack_key: 'media' });
  container('tools-a', 'tools', 'off', { stack: 'tools', restart: false });
  ent('switch.stack_tools', 'tools', 'off', { kind: 'stack', role: 'control', stack_key: 'tools', stack_name: 'tools', running_containers: 0, total_containers: 1 });
  container('webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss', 'solo', 'on', { update: 'off' });
  container('cache', 'paused', 'on', { container_state: 'paused', restart: false });
  container('broken', 'gone', 'unavailable', { picture: false, restart: false });
  ent('switch.vm_win', 'vm', 'on', { kind: 'vm', role: 'control', vm_key: 'win' });
  return core;
}
const modell = (l, core, config = {}) => l.buschUnraidDockerModel(core, { ...l.BUSCH_UNRAID_DOCKER_DEFAULTS, device_id: 'server', ...config });

test('gruppiert je Compose-Stack eine Kachel und je Einzelcontainer eine Kachel, ohne VMs', () => {
  const l = load(), m = modell(l, fixture());
  same(m.tiles.map((t) => `${t.type}:${t.name}`), ['container:broken', 'container:cache', 'stack:media', 'stack:tools', 'container:webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss']);
  same(m.tiles.find((t) => t.name === 'media').containers.map((c) => c.name), ['media', 'media-db', 'media-worker']);
  assert.ok(!JSON.stringify(m.tiles).includes('switch.vm_win'));
});

test('Zählung x/y: Stack aus Backendzahlen, Kopfzeile über alle Container', () => {
  const l = load(), m = modell(l, fixture());
  const media = m.tiles.find((t) => t.name === 'media');
  assert.equal(media.running, 2); assert.equal(media.total, 3); assert.equal(media.status, 'partial');
  assert.equal(m.total, 7); assert.equal(m.running, 3); // media 2 + webserver; pausiert und nicht verfügbar zählen nicht
});

test('Zustände: partial, stopped, paused, unavailable mit Text und Symbol', () => {
  const l = load(), core = fixture(), card = karte(l, core);
  const status = Object.fromEntries(card.shadowRoot.querySelectorAll('.tile-main').map((b) => [b.dataset.key, b.querySelector('.tile-status-text').textContent]));
  const icon = (key) => card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === key).querySelector('.tile-status');
  assert.equal(status['stack:media'], '2/3 gestartet'); assert.match(icon('stack:media').className, /sem-warning/);
  assert.equal(status['stack:tools'], 'Gestoppt · 0/1'); assert.match(icon('stack:tools').className, /sem-neutral/);
  assert.equal(status['container:cache'], 'Pausiert'); assert.match(icon('container:cache').className, /sem-warning/);
  assert.equal(status['container:broken'], 'Nicht verfügbar'); assert.match(icon('container:broken').className, /sem-error/);
  assert.equal(status['container:webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss'], 'Gestartet');
  core.entities.get('switch.media-worker').state = 'on'; core.entities.get('switch.stack_media').attributes.running_containers = 3;
  card._render();
  assert.equal(card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === 'stack:media').querySelector('.tile-status-text').textContent, '3/3 gestartet');
});

function karte(l, core, config = {}, language = 'de') {
  const card = new l.BuschUnraidDockerCard();
  card._core = core; card._hass = { locale: { language }, callService: async (...args) => (card.calls ||= []).push(args) };
  card.setConfig({ device_id: 'server', ...config });
  return card;
}
const tiles = (card) => card.shadowRoot.querySelectorAll('.tile').map((t) => t.dataset.key);

test('Ausklappen blendet Stack-Container direkt hinter der Stack-Kachel ein, erneut ein', () => {
  const l = load(), card = karte(l, fixture());
  assert.ok(!tiles(card).includes('container:media'));
  const toggle = card.shadowRoot.querySelectorAll('.tile-toggle').find((b) => b.dataset.key === 'stack:media');
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  toggle.click();
  const order = tiles(card), at = order.indexOf('stack:media');
  same(order.slice(at, at + 4), ['stack:media', 'container:media', 'container:media-db', 'container:media-worker']);
  assert.equal(card.shadowRoot.querySelectorAll('.tile').filter((t) => /\bchild\b/.test(t.className)).length, 3);
  card.shadowRoot.querySelectorAll('.tile-toggle').find((b) => b.dataset.key === 'stack:media').click();
  assert.ok(!tiles(card).includes('container:media'));
});

test('start_expanded klappt alle Stacks beim Laden auf; Zustand bleibt lokal je Karte', () => {
  const l = load(), core = fixture(), a = karte(l, core, { start_expanded: true }), b = karte(l, core);
  assert.ok(tiles(a).includes('container:media') && tiles(a).includes('container:tools-a'));
  assert.ok(!tiles(b).includes('container:media'));
});

test('Shift+Plus klappt alle auf, Shift+Minus alle zu, nicht in Textfeldern', () => {
  const l = load(), card = karte(l, fixture()), key = (k, target = {}) => card.listeners.keydown[0]({ key: k, shiftKey: true, target, preventDefault() {} });
  key('+'); assert.ok(tiles(card).includes('container:media') && tiles(card).includes('container:tools-a'));
  key('-', { tagName: 'INPUT' }); assert.ok(tiles(card).includes('container:media'));
  key('-'); assert.ok(!tiles(card).includes('container:media'));
});

const items = (l, card, key) => { const t = l.TEXTE_BUSCH_UNRAID_DOCKER_CARD.de.texte; const row = [...card._lastModel.tiles, ...card._lastModel.tiles.flatMap((x) => x.containers || [])].find((r) => r.key === key); return { row, list: card._menuItems(row, t) }; };

test('Menüeinträge nur für vorhandene Fähigkeiten', () => {
  const l = load(), card = karte(l, fixture());
  same(items(l, card, 'stack:media').list.map((i) => i.key), ['toggle', 'start', 'stop', 'restart', 'update_all', 'details']);
  same(items(l, card, 'stack:tools').list.map((i) => i.key), ['toggle', 'start', 'details']);
  same(items(l, card, 'container:webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss').list.map((i) => i.key), ['stop', 'restart', 'details']);
  same(items(l, card, 'container:media').list.map((i) => i.key), ['stop', 'restart', 'update', 'details']);
  same(items(l, card, 'container:cache').list.map((i) => i.key), ['stop', 'details']);
  const broken = items(l, card, 'container:broken').list;
  same(broken.map((i) => i.key), ['start', 'details']); assert.equal(broken[0].disabled, true);
  for (const k of ['pause', 'edit', 'remove']) assert.ok(!JSON.stringify(card._lastModel).includes(`"key":"${k}"`));
});

test('Aktionen rufen den richtigen Service; Stoppen/Neustart fragen nach', async () => {
  const l = load(), card = karte(l, fixture()); let gefragt = [];
  l.context.window.confirm = (text) => { gefragt.push(text); return true; };
  const run = async (key, action) => { const { list } = items(l, card, key); await list.find((i) => i.key === action).run(); };
  await run('stack:media', 'stop'); await run('stack:tools', 'start'); await run('stack:media', 'restart'); await run('stack:media', 'update_all'); await run('container:media', 'restart');
  same(card.calls.map((c) => [c[0], c[1], c[2].entity_id]), [
    ['switch', 'turn_off', 'switch.stack_media'], ['switch', 'turn_on', 'switch.stack_tools'], ['button', 'press', 'button.stack_media_restart'], ['button', 'press', 'button.stack_media_update_all'], ['button', 'press', 'button.media_restart']]);
  same(gefragt, ['„media“ stoppen?', '„media“ neu starten?', '„media“ neu starten?']);
  l.context.window.confirm = () => false; await run('container:media', 'stop');
  assert.equal(card.calls.length, 5);
  await run('container:media', 'update'); await run('stack:media', 'details');
  same(card.events.map((e) => [e.type, e.detail.entityId]), [['hass-more-info', 'update.media'], ['hass-more-info', 'switch.stack_media']]);
});

test('Bestätigung lässt sich abschalten wie bei den übrigen Unraid-Karten', async () => {
  const l = load(), card = karte(l, fixture(), { confirm_stop: false }); let gefragt = 0;
  l.context.window.confirm = () => { gefragt++; return true; };
  await items(l, card, 'stack:media').list.find((i) => i.key === 'stop').run();
  assert.equal(gefragt, 0); assert.equal(card.calls.length, 1);
});

test('Gestoppte ausblenden: gestoppte Stacks und Container fehlen, Leerzustand', () => {
  const l = load(), core = fixture(), card = karte(l, core, { hide_stopped: true, start_expanded: true });
  assert.ok(!tiles(card).includes('stack:tools')); assert.ok(!tiles(card).includes('container:media-worker'));
  assert.ok(tiles(card).includes('container:cache'));
  for (const e of core.entities.values()) if (e.domain === 'switch' && e.entity_id !== 'switch.broken') { e.state = 'off'; e.attributes.container_state = 'exited'; e.attributes.running_containers = 0; }
  card._render();
  assert.equal(tiles(card).length, 1); // nur broken (unavailable) bleibt sichtbar
  core.entities.get('switch.broken').state = 'off'; card._render();
  assert.equal(card.shadowRoot.querySelector('.message').textContent, 'Alle Container sind gestoppt und ausgeblendet.');
});

test('Sortierung nach Zustand: laufend vor teilweise vor pausiert vor gestoppt vor nicht verfügbar', () => {
  const l = load(), m = modell(l, fixture(), { sort: 'state' });
  same(m.tiles.map((t) => t.name), ['webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss', 'media', 'cache', 'tools', 'broken']);
  same(m.tiles.find((t) => t.name === 'media').containers.map((c) => c.name), ['media', 'media-db', 'media-worker']);
});

test('Bilder: entity_picture der Integration, Stack übernimmt Hauptcontainer, Fallback nur ohne Bild', () => {
  const l = load(), core = fixture(), card = karte(l, core, { start_expanded: true });
  const media = (key) => card.shadowRoot.querySelectorAll('.tile').find((t) => t.dataset.key === key).querySelector('.tile-icon').childNodes[0];
  assert.equal(media('container:media').tagName, 'IMG'); assert.equal(media('container:media').attributes.src, BILD('media'));
  assert.equal(media('stack:media').attributes.src, BILD('media'));
  assert.equal(media('container:media-worker').tagName, 'HA-ICON'); assert.equal(media('container:media-worker').attributes.icon, 'mdi:cube-outline');
  assert.equal(media('stack:tools').attributes.src, BILD('tools-a'));
  core.entities.get('switch.tools-a').attributes.entity_picture = undefined; card._render();
  assert.equal(media('stack:tools').attributes.icon, 'mdi:docker');
  // Ladefehler fällt auf das Icon zurück
  const img = media('container:media'); img.listeners.error[0]();
  assert.equal(media('container:media').tagName, 'HA-ICON');
});

test('lange Namen: Tooltip und eigener Ellipsenstil', () => {
  const l = load(), card = karte(l, fixture()), long = 'webserver-mit-einem-sehr-langen-namen-der-abgeschnitten-werden-muss';
  const name = card.shadowRoot.querySelectorAll('.tile-name').find((n) => n.textContent === long);
  assert.equal(name.title, long);
  assert.match(l.context.window.customCards ? vm.runInContext('BUSCH_UNRAID_DOCKER_STYLE', l.context) : '', /\.tile-name\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0/);
});

test('Menü öffnet mit Verlaufseintrag, Escape schließt und gibt den Fokus zurück', async () => {
  const l = load(), card = karte(l, fixture());
  const main = card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === 'stack:media');
  main.click();
  const menu = l.body.childNodes.find((n) => n.tagName === 'BUSCH-UNRAID-DOCKER-MENU');
  assert.ok(menu); assert.equal(l.history.state.buschUnraidDockerMenu, menu._id);
  assert.equal(main.attributes['aria-expanded'], 'true');
  assert.equal(menu.shadowRoot.querySelector('.menu-title').textContent, 'media');
  same(menu.shadowRoot.querySelectorAll('.item').map((b) => b.dataset.action), ['toggle', 'start', 'stop', 'restart', 'update_all', 'details']);
  assert.equal(menu.shadowRoot.querySelectorAll('.item')[0].focused, true);
  menu.listeners.keydown[0]({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(!l.body.childNodes.includes(menu)); assert.equal(l.history.state, null);
  const again = card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === 'stack:media');
  assert.equal(again.focused, true);
});

test('Menüeintrag „Ausklappen“ klappt den Stack auf', async () => {
  const l = load(), card = karte(l, fixture());
  card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === 'stack:media').click();
  const menu = l.body.childNodes.find((n) => n.tagName === 'BUSCH-UNRAID-DOCKER-MENU');
  await menu.shadowRoot.querySelectorAll('.item')[0].listeners.click[0]({ stopPropagation() {} });
  assert.ok(tiles(card).includes('container:media'));
});

test('Editor-Schema: Server-Auswahl, alle Felder mit Label und Helper in DE/EN, keine VM-/Alle-Apps-Option', () => {
  const l = load(), core = fixture();
  const schema = l.buschUnraidSchema(core, {}, 'docker');
  same(schema.map((f) => f.name), ['device_id', 'title', 'hide_stopped', 'sort', 'start_expanded', 'columns', 'confirm_stop', 'confirm_restart']);
  same(schema[0].selector.select.options.map((o) => o.value), ['server']);
  for (const lang of ['de', 'en']) for (const f of schema) {
    assert.ok(l.TEXTE_BUSCH_UNRAID_DOCKER_CARD[lang].labels[f.name], `${lang} label ${f.name}`);
    assert.match(l.TEXTE_BUSCH_UNRAID_DOCKER_CARD[lang].helpers[f.name], /\.$/, `${lang} helper ${f.name}`);
  }
  assert.equal(l.BUSCH_UNRAID_DOCKER_DEFAULTS.start_expanded, false); assert.equal(l.BUSCH_UNRAID_DOCKER_DEFAULTS.hide_stopped, false); assert.equal(l.BUSCH_UNRAID_DOCKER_DEFAULTS.columns, 'auto');
  for (const lang of ['de', 'en']) {
    const editor = new l.BuschUnraidDockerEditor(); editor._core = core; editor._hass = { locale: { language: lang } };
    editor.setConfig({ device_id: 'server' });
    const sortField = editor._form.schema.find((f) => f.name === 'sort');
    assert.equal(sortField.selector.select.options[1].label, lang === 'de' ? 'Zustand' : 'State');
    assert.equal(editor._form.computeLabel({ name: 'device_id' }), lang === 'de' ? 'Unraid-Server' : 'Unraid server');
    assert.equal(editor._form.data.start_expanded, false);
  }
  assert.ok(!JSON.stringify(schema).match(/all_apps|vm/));
});

test('Registrierung, getStubConfig mit echtem Server, englische Texte', () => {
  const l = load('en'), core = fixture();
  assert.ok(l.registered.has('busch-unraid-docker-card') && l.registered.has('busch-unraid-docker-card-editor'));
  const entry = l.context.window.customCards.find((c) => c.type === 'busch-unraid-docker-card');
  assert.equal(entry.name, 'Unraid Docker'); assert.ok(entry.preview && entry.documentationURL);
  same({ ...l.BuschUnraidDockerCard.getStubConfig() }, { type: 'custom:busch-unraid-docker-card' });
  const card = karte(l, core, {}, 'en');
  assert.equal(card.shadowRoot.querySelector('h2')?.textContent ?? card.shadowRoot.all().find((n) => n.tagName === 'H2').textContent, 'Docker containers');
  assert.equal(card.shadowRoot.querySelectorAll('.tile-main').find((b) => b.dataset.key === 'stack:media').querySelector('.tile-status-text').textContent, '2/3 started');
});

test('ohne Server: Leerzustand mit nächster Aktion; einziger Server wird automatisch gewählt', () => {
  const l = load(), core = fixture();
  assert.equal(l.buschUnraidDockerModel(core, { device_id: '' }).server.id, 'server');
  core.devices.delete('server');
  const card = karte(l, core, { device_id: '' });
  assert.equal(card.shadowRoot.querySelector('.message').textContent, 'Kein Unraid-Server gefunden. Bitte im Editor einen Server wählen.');
});

test('Unraid SSH 0.8.0: Anzeigename und Stackbild des Backends haben Vorrang', () => {
  const l = load(), core = fixture();
  const sw = core.entities.get('switch.stack_media');
  sw.attributes.stack_display_name = 'Media Center'; sw.attributes.entity_picture = '/local/unraid_ssh/entry/stack.png';
  core.entities.get('switch.stack_tools').attributes.entity_picture = BILD('eigenes-stackbild');
  const card = karte(l, core, { start_expanded: true });
  const tile = (key) => card.shadowRoot.querySelectorAll('.tile').find((t) => t.dataset.key === key);
  assert.equal(tile('stack:media').querySelector('.tile-name').textContent, 'Media Center');
  assert.equal(tile('stack:media').querySelector('.tile-icon').childNodes[0].attributes.src, '/local/unraid_ssh/entry/stack.png');
  assert.equal(tile('stack:tools').querySelector('.tile-icon').childNodes[0].attributes.src, BILD('eigenes-stackbild'));
  assert.match(tile('container:media').querySelector('.tile-main').attributes['aria-label'], /In Media Center/);
  // Sortierung nach Anzeigename: „Media Center“ bleibt zwischen cache und tools
  same(card._lastModel.tiles.map((t) => t.name).slice(1, 4), ['cache', 'Media Center', 'tools']);
});
