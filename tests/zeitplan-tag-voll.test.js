"use strict";

// M77 (#1321, W21): a fully booked day explains its locked plus button. Tooltip (title) and
// aria-describedby "Tag ist voll belegt" from the dictionary; no fading opacity, the locked plus
// reaches >= 3:1 in the dark theme (non-text contrast, WCAG 1.4.11; same theme values as kontrast.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function mount(model, language = "de") {
  const env = kit.createEnvironment({ language });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_SCHEDULE_CARD"] });
  const card = env.document.createElement("busch-schedule-card");
  card._hass = { locale: { language }, states: { "schedule.test": { state: "off", attributes: { editable: true } } } };
  card._config = { entity: "schedule.test", first_day: "monday", step: 15, highlight_today: false, read_only: false };
  const shell = env.document.createElement("ha-card");
  const days = env.document.createElement("div");
  // The kit DOM does not parse the template; these mirror its hidden description nodes.
  const bedienung = env.document.createElement("div");
  bedienung.id = "busch-block-bedienung";
  bedienung.hidden = true;
  const tagVoll = env.document.createElement("div");
  tagVoll.id = "busch-tag-voll";
  tagVoll.className = "tag-voll";
  tagVoll.hidden = true;
  shell.append(days);
  card.shadowRoot.append(shell, bedienung, tagVoll);
  card._els = { card: shell, days, hint: env.document.createElement("div"), status: env.document.createElement("div"), bedienung, tagVoll };
  card._model = Object.fromEntries(DAYS.map((day) => [day, (model[day] || []).map(([start, end]) => ({ start, end }))]));
  card._renderDays();
  return { card, days, texte: exposed.TEXTE_BUSCH_SCHEDULE_CARD };
}
const plus = (days, day) => days.querySelector(`.day[data-day="${day}"] .add-block`);

test("M77: the plus of a full day is locked, with tooltip and aria-describedby 'Tag ist voll belegt'", () => {
  const { card, days, texte } = mount({ saturday: [[0, 1440]] });
  const add = plus(days, "saturday");
  assert.equal(add.disabled, true);
  assert.equal(texte.de.texte.tagVoll, "Tag ist voll belegt");
  assert.equal(add.title, "Samstag: Tag ist voll belegt");
  const id = add.getAttribute("aria-describedby");
  assert.ok(id, "aria-describedby set");
  const description = card.shadowRoot.getElementById(id);
  assert.ok(description, "description in the same shadow root");
  assert.equal(description.textContent, "Tag ist voll belegt");
});

test("M77: a day with room keeps its add tooltip and no full-day description; the text follows the language", () => {
  const { days } = mount({ saturday: [[0, 1440]], monday: [[480, 720]] });
  const add = plus(days, "monday");
  assert.equal(add.disabled, false);
  assert.equal(add.getAttribute("aria-describedby"), null);
  assert.doesNotMatch(add.title, /voll belegt/);
  const en = mount({ sunday: [[0, 1440]] }, "en");
  assert.equal(en.texte.en.texte.tagVoll, "Day is fully booked");
  assert.equal(plus(en.days, "sunday").title, "Sunday: Day is fully booked");
});

test("M77: a day that frees up loses the full-day description again", () => {
  const { card, days } = mount({ saturday: [[0, 1440]] });
  card._model.saturday = [{ start: 0, end: 600 }];
  card._renderDays();
  const add = plus(days, "saturday");
  assert.equal(add.disabled, false);
  assert.equal(add.getAttribute("aria-describedby"), null);
});

/** WCAG relative luminance contrast of two hex colours. */
function ratio(a, b) {
  const lum = (h) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("M77: the locked plus is not faded by opacity and reaches >= 3:1 in the dark theme", () => {
  const css = SOURCE.slice(SOURCE.indexOf("class BuschScheduleCard extends"), SOURCE.indexOf("</style>", SOURCE.indexOf("class BuschScheduleCard extends")))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/\.day \.add-block:disabled\s*\{([^}]*)\}/);
  assert.ok(rule, "disabled rule");
  assert.doesNotMatch(rule[1], /opacity/);
  const color = rule[1].match(/color:\s*var\(--secondary-text-color/);
  assert.ok(color, "locked plus uses --secondary-text-color");
  // HA dark theme: secondary text #9b9b9b on card #1c1c1c; light: #727272 on #ffffff.
  assert.ok(ratio("#9b9b9b", "#1c1c1c") >= 3);
  assert.ok(ratio("#727272", "#ffffff") >= 3);
});
