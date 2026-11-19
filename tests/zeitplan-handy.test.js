"use strict";

// M24 (Buschcheck F2): schedule card on a phone. 44 px tracks, grips with a
// 24 px hit area, blocks named with weekday and time, hint for the plus button.
// The card runs _renderDays on the kit DOM; the pointer logic is untouched.
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
  const hint = env.document.createElement("div");
  const status = env.document.createElement("div");
  // The kit DOM does not parse the template; this mirrors its hidden description node.
  const bedienung = env.document.createElement("div");
  bedienung.id = "busch-block-bedienung";
  bedienung.className = "block-bedienung";
  bedienung.hidden = true;
  shell.append(days, hint);
  card.shadowRoot.append(shell, bedienung);
  card._els = { card: shell, days, hint, status, bedienung };
  card._model = Object.fromEntries(DAYS.map((day) => [day, (model[day] || []).map(([start, end]) => ({ start, end }))]));
  card._renderDays();
  card._renderStatus("");
  return { card, days, hint, texte: exposed.TEXTE_BUSCH_SCHEDULE_CARD };
}

const blocks = (days, day) => days.querySelectorAll(`.day[data-day="${day}"] .block`);

test("M24: every block is named with its weekday and time range", () => {
  const { days } = mount({ monday: [[480, 720]], thursday: [[600, 620]], sunday: [[0, 1440]] });
  assert.equal(blocks(days, "monday")[0].getAttribute("aria-label"), "Montag: 08:00–12:00");
  assert.equal(blocks(days, "thursday")[0].getAttribute("aria-label"), "Donnerstag: 10:00–10:20");
  assert.equal(blocks(days, "sunday")[0].getAttribute("aria-label"), "Sonntag: 00:00–24:00");
  const en = mount({ tuesday: [[60, 90]] }, "en");
  assert.equal(blocks(en.days, "tuesday")[0].getAttribute("aria-label"), "Tuesday: 01:00–01:30");
});

test("M24: blocks describe their keyboard action through a hidden description", () => {
  const { card, days } = mount({ monday: [[480, 720]] });
  const block = blocks(days, "monday")[0];
  const id = block.getAttribute("aria-describedby");
  assert.ok(id, "block has aria-describedby");
  const description = card.shadowRoot.getElementById(id);
  assert.ok(description, "description lives in the same shadow root");
  assert.equal(description.textContent, "Enter öffnet die Bearbeitung.");
  assert.match(SOURCE, /<div id="busch-block-bedienung" class="block-bedienung" hidden><\/div>/, "template keeps it hidden");
});

test("M24: hint names the plus button as the alternative to dragging", () => {
  const { hint, texte } = mount({ monday: [[480, 720]] });
  assert.match(hint.textContent, /Oder auf das Plus tippen\.$/);
  assert.match(texte.en.texte.hinweisZiehen, /Or tap the plus\.$/);
  assert.equal(texte.de.texte.blockBedienung, "Enter öffnet die Bearbeitung.");
  assert.equal(texte.en.texte.blockBedienung, "Press Enter to edit.");
});

test("M24: blocks at the day edges keep their grip inside the track", () => {
  const { days } = mount({ monday: [[0, 60], [600, 1440]] });
  const [first, last] = blocks(days, "monday");
  assert.ok(first.classList.contains("at-start") && !first.classList.contains("at-end"));
  assert.ok(last.classList.contains("at-end") && !last.classList.contains("at-start"));
});

test("M24: the plus buttons stand out while the whole plan is empty", () => {
  const empty = mount({});
  assert.ok(empty.days.querySelectorAll(".add-block").every((button) => button.classList.contains("hervor")));
  const filled = mount({ friday: [[60, 120]] });
  assert.ok(filled.days.querySelectorAll(".add-block").every((button) => !button.classList.contains("hervor")));
});

test("M24: phone CSS gives the track 44 px and each grip a 24 px hit area", () => {
  const css = SOURCE.slice(SOURCE.indexOf("class BuschScheduleCard"), SOURCE.indexOf("class BuschScheduleCardEditor"));
  assert.match(css, /@container \(max-width: 460px\) \{\s*\.track \{ height: 44px; \}/);
  assert.match(css, /\.handle \{[^}]*width: 24px;/);
  // Short blocks move their grips outward so a 20-minute block stays grippable.
  assert.match(css, /@container block \(max-width: 47\.98px\) \{[^@]*\.handle\.start \{ left: -24px; \}[^@]*\.handle\.end \{ right: -24px; \}/);
  // The block no longer clips its grips; the captions clip themselves (rule 1).
  const block = css.match(/\n {8}\.block \{([^}]*)\}/)[1];
  assert.doesNotMatch(block, /overflow: hidden/);
  assert.match(css, /\.block \.cap-short, \.block \.cap-full \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*min-width: 0;/);
});

test("M24: _onPointerDown stays byte-identical to the 0.26.0 logic", () => {
  const start = SOURCE.indexOf("  _onPointerDown(event) {");
  const end = SOURCE.indexOf("  _onPointerMove(event) {");
  const body = SOURCE.slice(start, end);
  const hash = require("node:crypto").createHash("sha256").update(body).digest("hex");
  assert.equal(hash, "83dadb787c0362c67da5029d98523d8d1d88d73d000aad94fae61bca6e2ada2b");
});
