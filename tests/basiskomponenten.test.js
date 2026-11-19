"use strict";

// M62 (Buschcheck W12): the own button variants of busch-cards become the shared .busch-btn,
// partial-data and failure hints become the shared .busch-notice.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");
const { load, fixture } = require("./network-fixture");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const slice = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to, SOURCE.indexOf(from)));
const SCHEDULE = slice("class BuschScheduleCard extends", "class BuschScheduleCardEditor");
const CAL_STIL = slice("const CAL_STIL = `", "`;");

test("M62: schedule dialog actions are .busch-btn, Cancel framed (secondary), Save filled (primary)", () => {
  assert.match(SCHEDULE, /<button class="busch-btn" data-variant="secondary" data-act="cancel"><\/button>\s*<button class="busch-btn" data-variant="primary" data-act="ok"><\/button>/);
  const day = SCHEDULE.slice(SCHEDULE.indexOf('<dialog class="day-dialog"'));
  assert.match(day, /<button class="busch-btn" data-variant="secondary" data-act="cancel"><\/button>/);
  const css = SCHEDULE.slice(SCHEDULE.indexOf("<style>"), SCHEDULE.indexOf("</style>"));
  assert.doesNotMatch(css, /\.actions button \{/, "no own action button variant left");
  assert.doesNotMatch(css, /text-transform:\s*uppercase/, "no capitals in the schedule dialogs");
  assert.match(SCHEDULE, /ui\.textContent = BuschUI\.cardStyles;/, "the shared styles reach the shadow root");
});

test("M62: calendar arrows, Today and the picker's Cancel are .busch-btn secondary", async () => {
  assert.match(SOURCE, /<button class="cal-pfeil busch-btn" data-variant="secondary" data-schritt="-1"/);
  assert.match(SOURCE, /<button class="cal-pfeil cal-heute-knopf busch-btn" data-variant="secondary" data-schritt="heute"/);
  assert.doesNotMatch(CAL_STIL, /text-transform:\s*uppercase/);
  const pfeil = CAL_STIL.match(/\.cal-pfeil \{([^}]*)\}/)[1];
  assert.doesNotMatch(pfeil, /border:|background:/, "frame and surface come from .busch-btn");
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-calendar-card");
  card.setConfig({ entities: ["calendar.a"], navigation: true });
  card._wahlBauen();
  const cancel = card._wahl.abbrechen;
  assert.ok(cancel.classList.contains("busch-btn"));
  assert.equal(cancel.dataset.variant, "secondary");
  for (const arrow of [card._wahl.zurueck, card._wahl.vor]) {
    assert.ok(arrow.classList.contains("busch-btn") && arrow.classList.contains("cal-pfeil"));
    assert.equal(arrow.dataset.variant, "secondary");
  }
});

test("M62: the calendar hint for partial data is the shared warning notice", () => {
  assert.match(SOURCE, /<div class="cal-hinweis busch-notice" data-tone="warning" role="status"><ha-icon class="busch-notice-icon" icon="mdi:alert-outline" aria-hidden="true"><\/ha-icon><div class="busch-notice-text">\$\{calEscape\(hinweisText\)\}<\/div><\/div>/);
  const rule = CAL_STIL.match(/\.cal-hinweis \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /error-color/, "no red body text");
});

test("M62: a failed device service call shows the shared error notice", () => {
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-device-card");
  card._geruest();
  card._zeigeDienstFehler(new Error("kaputt"));
  const notice = card._dienstFehler;
  assert.ok(notice.classList.contains("busch-notice"));
  assert.equal(notice.dataset.tone, "error");
  assert.equal(notice.getAttribute("role"), "alert");
  assert.equal(notice.hidden, false);
  const [icon, text] = notice.children;
  assert.equal(icon.className, "busch-notice-icon");
  assert.equal(text.className, "busch-notice-text");
  assert.match(text.textContent, /kaputt/);
});

test("M62: ambiguous FRITZ capabilities are a warning notice", () => {
  const l = load(), f = fixture(l);
  f.add("button.duplicate", "router", "box-key-reboot", "unknown");
  f.refresh();
  const card = new l.BuschFritzDeviceCard();
  card._core = f.core;
  card.setConfig({ device_id: "router" });
  card._hass = f.hass;
  card._render();
  const all = [];
  (function walk(n) { for (const c of n.children || []) { all.push(c); walk(c); } })(card.shadowRoot);
  const notice = all.find((n) => n.className === "busch-notice");
  assert.ok(notice, "notice present");
  assert.equal(notice.dataset.tone, "warning");
  assert.equal(notice.children[1].textContent, l.BUSCH_NETWORK_TEXT.en.ambiguous);
  card.disconnectedCallback();
});
