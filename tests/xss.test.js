"use strict";

// M19 (#1281, S5.4): every card of the bundle rendered with an XSS payload in each displayed
// text field; activeMarkup must stay empty. The only known, wanted active element is the
// device card's brand <img> (a fixed https URL with an encoded platform), named explicitly below.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kit = require("./_testkit.cjs");
const { installSubscriptions } = require("./abo-attrappe.js");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const descend = (node) => [node, ...(node.childNodes || []).flatMap(descend), ...(node.shadowRoot ? descend(node.shadowRoot) : [])];

function world(data) {
  const clock = kit.createClock();
  const env = kit.createEnvironment({ clock, globals: { performance } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({ clock, ...data });
  return { clock, env, ha };
}

async function mount(w, type, config) {
  const card = w.env.document.createElement(type);
  card.setConfig(config);
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  card.connectedCallback?.();
  w.ha.onUpdate((hass) => { card.hass = hass; });
  await w.clock.advance(200);
  card.hass = w.ha.hass;
  await w.clock.advance(50);
  return card;
}

function text(card) {
  return descend(card).map((n) => (n.nodeType === 3 ? n.textContent : "") + (n._innerHTML || "") + Object.values(n.attributes || {}).map((a) => a?.value ?? a).join(" ")).join("|");
}

for (const [i, payload] of kit.XSS_PAYLOADS.entries()) {
  test(`calendar card: payload ${i} in title, colour, summary, location, description and uid stays inert`, async () => {
    const termin = { summary: payload, location: payload, description: payload, uid: payload };
    const w = world({ states: { "calendar.a": { state: "on", attributes: { friendly_name: payload } }, "calendar.b": { state: "on", attributes: { friendly_name: payload } } } });
    w.ha.respond("call_api", ({ path: p }) => {
      if (!p.startsWith("calendars/calendar.a")) throw new Error(payload);
      return [
        { ...termin, start: { dateTime: "2027-01-12T08:00:00Z" }, end: { dateTime: "2027-01-12T10:00:00Z" } },
        { ...termin, uid: payload + "2", start: { date: "2027-01-20" }, end: { date: "2027-01-21" } },
      ];
    });
    // #1326: calendar.a through the subscription, calendar.b answers `events: null` and fails by REST too.
    installSubscriptions(w.ha, { calendar: (entity) => (entity === "calendar.a" ? [
      { ...termin, start: { dateTime: "2027-01-12T08:00:00Z" }, end: { dateTime: "2027-01-12T10:00:00Z" } },
      { ...termin, uid: payload + "2", start: { date: "2027-01-20" }, end: { date: "2027-01-21" } },
    ] : null) });
    const card = await mount(w, "busch-calendar-card", { title: payload, show_total: true, entities: [{ entity: "calendar.a", color: payload }, "calendar.b"] });
    assert.deepEqual([...kit.activeMarkup(card)], []);
    const html = text(card);
    assert.ok(html.includes(escape(payload)), "summary and title are rendered, escaped");
    assert.ok(html.includes("calendar.b"), "the failing calendar is reported");
  });

  test(`device card: payload ${i} in device, entity, area, label, state, unit and platform stays inert`, async () => {
    const w = world({
      states: {
        "sensor.x": { state: payload, attributes: { friendly_name: payload, unit_of_measurement: payload } },
        "switch.y": { state: "on", attributes: { friendly_name: payload } },
        "binary_sensor.z": { state: "off", attributes: { friendly_name: payload, device_class: payload } },
      },
      entities: {
        "sensor.x": { entity_id: "sensor.x", device_id: "dev", platform: payload, labels: ["l1"], name: payload },
        "switch.y": { entity_id: "switch.y", device_id: "dev", platform: payload, labels: [] },
        "binary_sensor.z": { entity_id: "binary_sensor.z", device_id: "dev", platform: payload, labels: [], entity_category: "diagnostic" },
      },
      devices: { dev: { id: "dev", name: payload, name_by_user: payload, manufacturer: payload, model: payload, area_id: "room", labels: ["l1"] } },
      areas: { room: { area_id: "room", name: payload } },
      labels: { l1: { label_id: "l1", name: payload, color: payload } },
    });
    const card = await mount(w, "busch-device-card", { device_id: "dev", start_expanded: true, groups_open: ["control", "sensor", "config", "diagnostic"], quick_controls: true });
    const found = [...kit.activeMarkup(card)];
    const images = descend(card).filter((n) => n.nodeType === 1 && String(n.localName || n.tagName).toLowerCase() === "img");
    // Known element: the brand icon; its src is a fixed host with encodeURIComponent(platform).
    assert.deepEqual(found, images.map(() => "img"));
    assert.ok(images.length <= 1);
    for (const img of images) {
      assert.equal(img.className, "dev-brand");
      assert.equal(img.src, `https://brands.home-assistant.io/_/${encodeURIComponent(payload)}/icon.png`);
    }
    assert.ok(text(card).includes(payload), "device name is rendered as text");
  });

  for (const kind of ["network", "fritz-device"]) {
    test(`${kind} card: payload ${i} in host, client, registry, device, AP, WLAN and sensor names stays inert`, async () => {
      const mac = "02:00:00:00:00:01";
      const ent = (id, device, unique_id, extra = {}) => [id, { entity_id: id, device_id: device, unique_id, platform: "fritz", config_entry_id: "entry", labels: [], ...extra }];
      const w = world({
        states: {
          "device_tracker.c": { state: "home", attributes: { source_type: "router", friendly_name: payload, host_name: payload, mac, ip: "192.0.2.10", connected_via_device_id: "ap", last_time_reachable: "2027-01-15T07:00:00Z" } },
          "switch.internet": { state: "on", attributes: { friendly_name: payload } },
          "button.wake": { state: "unknown", attributes: { friendly_name: payload } },
          "binary_sensor.wan": { state: "on", attributes: { friendly_name: payload } },
          "sensor.ip": { state: payload, attributes: { friendly_name: payload } },
          "sensor.rate": { state: "100", attributes: { friendly_name: payload, unit_of_measurement: payload } },
          "switch.wlan": { state: "on", attributes: { friendly_name: payload } },
          "button.reboot": { state: "unknown", attributes: { friendly_name: payload } },
          "update.firmware": { state: "on", attributes: { friendly_name: payload, supported_features: 1, installed_version: payload, latest_version: payload } },
        },
        entities: Object.fromEntries([
          ent("device_tracker.c", "client", mac + "_tracker", { name: payload }),
          ent("switch.internet", "client", mac + "_internet_access"),
          ent("button.wake", "client", mac + "_wake_on_lan"),
          ent("binary_sensor.wan", "router", "box-key-is_connected"),
          ent("sensor.ip", "router", "box-key-external_ip"),
          ent("sensor.rate", "router", "box-key-kb_s_received"),
          ent("switch.wlan", "router", "box-key-wi_fi_1", { name: payload }),
          ent("button.reboot", "router", "box-key-reboot"),
          ent("update.firmware", "router", "box-key-update"),
        ]),
        devices: {
          router: { id: "router", name: payload, name_by_user: payload, model: payload, manufacturer: payload, identifiers: [["fritz", "box-key"]], config_entries: ["entry"] },
          client: { id: "client", name: payload, manufacturer: payload, config_entries: ["entry"] },
          ap: { id: "ap", name: payload, identifiers: [["fritz", "ap-key"]], config_entries: ["entry"] },
        },
        labels: { l1: { label_id: "l1", name: payload } },
      });
      const card = await mount(w, `busch-${kind}-card`, {
        ...(kind === "fritz-device" ? { device_id: "router" } : {}),
        title: payload, show_rename: true, show_labels: true, label_ids: ["l1"],
        actions: [{ name: payload, variant: "secondary", tap_action: { action: "more-info" } }],
      });
      assert.deepEqual([...kit.activeMarkup(card)], []);
      const html = text(card);
      assert.ok(html.includes(payload), "client name is rendered as text");
      if (kind === "fritz-device") assert.ok(html.includes("192.0.2.10"), "client list is rendered");
    });
  }
}
