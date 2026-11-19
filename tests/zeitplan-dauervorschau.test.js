"use strict";

// M76 (#1321, F14): the schedule block dialog shows a live duration preview: duration text and the
// day with the other blocks and the edited one. On a phone (<= 450 px, full screen) the preview is a
// vertical day column that takes the free height, so the dialog has no large empty area (Regel 2 keeps
// full screen and the fixed actions).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const CARD = SOURCE.slice(SOURCE.indexOf("class BuschScheduleCard extends"), SOURCE.indexOf("class BuschScheduleCardEditor"));
const CSS = CARD.slice(0, CARD.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");

function setup(language = "de", blocks = [[360, 480], [720, 840]]) {
  const env = kit.createEnvironment({ language });
  const { exposed } = kit.loadScript(BUNDLE, { globals: env, expose: ["TEXTE_BUSCH_SCHEDULE_CARD"] });
  const card = env.document.createElement("busch-schedule-card");
  card._hass = { locale: { language }, states: {} };
  card._config = { entity: "schedule.test", step: 15 };
  // The kit DOM does not parse the template; this mirrors the block dialog parts the preview uses.
  const dialog = env.document.createElement("dialog");
  const mk = (tag, cls) => { const el = env.document.createElement(tag); el.className = cls; dialog.appendChild(el); return el; };
  const von = mk("input", "f-from"), bis = mk("input", "f-to"), dauer = mk("div", "dauer"), spur = mk("div", "v-spur");
  card._els = { blockDialog: dialog };
  card._model = { monday: blocks.map(([start, end], i) => ({ start, end, _key: "k" + i })) };
  card._dialogTarget = { day: "monday", key: "k0", isNew: false };
  return { card, von, bis, dauer, spur, t: exposed.TEXTE_BUSCH_SCHEDULE_CARD[language].texte };
}
const segs = (spur) => spur.children.map((s) => ({ cls: s.className, a: s.style["--v-a"], b: s.style["--v-b"] }));

test("M76: the block dialog shows the duration of the edited block and its place in the day", () => {
  const { card, von, bis, dauer, spur, t } = setup();
  von.value = "06:00"; bis.value = "08:30";
  card._dauerVorschau();
  assert.equal(t.dauer, "Dauer: {dauer}");
  assert.equal(dauer.textContent, "Dauer: 2 Std. 30 Min.");
  const s = segs(spur);
  assert.equal(s.length, 2, "one other block and the edited one");
  assert.deepEqual(s.find((x) => x.cls.includes("v-andere")), { cls: "v-seg v-andere", a: "50%", b: "8.333%" });
  const dieser = s.find((x) => x.cls.includes("v-dieser"));
  assert.equal(dieser.a, "25%");
  assert.equal(dieser.b, "10.417%");
});

test("M76: the preview follows the fields: midnight end, overlap marked, invalid range without a segment", () => {
  const { card, von, bis, dauer, spur, t } = setup();
  von.value = "20:00"; bis.value = "00:00";
  card._dauerVorschau();
  assert.equal(dauer.textContent, "Dauer: 4 Std.");
  von.value = "11:30"; bis.value = "12:30";
  card._dauerVorschau();
  assert.ok(segs(spur).some((x) => x.cls === "v-seg v-dieser v-konflikt"), "overlap with 12:00-14:00 marked");
  assert.equal(dauer.textContent, "Dauer: 1 Std.");
  von.value = "10:00"; bis.value = "09:00";
  card._dauerVorschau();
  assert.equal(dauer.textContent, t.dauerOffen);
  assert.ok(!segs(spur).some((x) => x.cls.includes("v-dieser")));
});

test("M76: English duration texts", () => {
  const { card, von, bis, dauer } = setup("en");
  von.value = "06:00"; bis.value = "06:45";
  card._dauerVorschau();
  assert.equal(dauer.textContent, "Duration: 45 min");
});

test("M76: the dialog template carries the preview, the fields update it, opening fills it", () => {
  assert.match(CARD, /<div class="dauer"><\/div>\s*<div class="vorschau" aria-hidden="true">/);
  assert.match(CARD, /addEventListener\("input", \(\) => this\._dauerVorschau\(\)\)/);
  const open = CARD.slice(CARD.indexOf("  _openDialogForBlock("), CARD.indexOf("  _blockStand()"));
  assert.match(open, /this\._dauerVorschau\(\);/);
});

test("M76: on a phone the preview is a vertical day column that fills the free height", () => {
  const phone = CSS.match(/@media \(max-width: 450px\) \{([\s\S]*?)\n        \}/);
  assert.ok(phone, "phone media query");
  assert.match(phone[1], /\.block-dialog \.body \{[^}]*display: flex;[^}]*flex-direction: column;/);
  assert.match(phone[1], /\.block-dialog \.vorschau \{[^}]*flex: 1 1 auto;[^}]*min-height: 160px;/);
  assert.match(phone[1], /\.block-dialog \.v-seg \{[^}]*top: var\(--v-a\);[^}]*height: var\(--v-b\);/);
  assert.match(CSS, /\.v-seg \{[^}]*--v-a: 0%;[^}]*--v-b: 0%;/, "the custom properties are defined in the card (rule 4)");
});
