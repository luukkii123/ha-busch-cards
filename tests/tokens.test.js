"use strict";

// M63 (Buschcheck W13): type sizes, spacing and the inner radius of busch-cards come from tokens;
// headings and buttons stay in sentence case.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "dist", "busch-cards.js"), "utf8");
// Card code only: without the synced shared blocks and the vendored Leaflet line.
const CARDS = SOURCE.slice(SOURCE.indexOf("/* END BUSCH SHARED CORE */"))
  .split("\n").filter((line) => !line.startsWith("!function(t,e){")).join("\n");
const slice = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to, SOURCE.indexOf(from)));
const SCHEDULE_CSS = slice("class BuschScheduleCard extends", "</style>");
const CAL_STIL = slice("const CAL_STIL = `", "`;");
const INNER = "var(--busch-radius-inner, var(--ha-border-radius-md, 8px))";

/** `font-size: <n>px` that is not the fallback inside a var(). */
function fixedSizes(text) {
  const found = [];
  for (const m of text.matchAll(/font-size\s*:\s*([^;}"`]+)/g)) {
    const value = m[1].replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "");
    if (/\d+(?:\.\d+)?(?:px|em)\b/.test(value)) found.push(m[0].trim());
  }
  return found;
}

test("M63: no fixed font-size in px or em in the card code outside var() fallbacks", () => {
  // The device title (.dev-name) moves to the card header step in M61.
  assert.deepEqual(fixedSizes(CARDS).filter((rule) => !/1\.05em/.test(rule)), []);
});

test("M63: no capitals or letter spacing on headings and buttons of the cards", () => {
  assert.doesNotMatch(CARDS, /text-transform\s*:\s*uppercase/);
  assert.doesNotMatch(CARDS, /letter-spacing\s*:\s*0\.\d+em/);
});

test("M63: schedule type, spacing and radii on tokens; block time 12 px, dialog close 44 px", () => {
  assert.match(SCHEDULE_CSS, /\.block \{[^}]*font-size: var\(--ha-font-size-s, 12px\);/);
  assert.match(SCHEDULE_CSS, /\.ruler span \{[^}]*font-size: var\(--ha-font-size-xs, 10px\);/);
  assert.match(SCHEDULE_CSS, /\.day \{[^}]*gap: 0 var\(--ha-space-2, 8px\);[^}]*margin-bottom: var\(--ha-space-1, 4px\);/);
  assert.match(SCHEDULE_CSS, /\.dlg-kopf button \{[^}]*width: 44px;[^}]*height: 44px;/);
  for (const sel of [".day.today", ".track", ".block", ".fields input", ".choices button"]) {
    const rule = SCHEDULE_CSS.match(new RegExp("\\n\\s*" + sel.replace(/\./g, "\\.") + " \\{([^}]*)\\}"))[1];
    assert.ok(rule.includes("border-radius: " + INNER), sel + " uses the inner radius token");
  }
});

test("M63: calendar spacing and radii on tokens", () => {
  assert.match(CAL_STIL, /\.cal-tag \{[^}]*column-gap:var\(--ha-space-3, 12px\);[^}]*padding:0 var\(--ha-space-2, 8px\); border-radius:var\(--busch-radius-inner, var\(--ha-border-radius-md, 8px\)\);/);
  assert.match(CAL_STIL, /\.cal-lauf \{[^}]*gap:var\(--ha-space-1, 4px\) var\(--ha-space-2, 8px\); padding:var\(--ha-space-1, 4px\) 0;/);
  assert.match(CAL_STIL, /\.cal-fuss \{[^}]*gap:var\(--ha-space-6, 24px\);/);
  assert.match(CAL_STIL, /\.cal-monat \{[^}]*font-size:var\(--ha-font-size-l, 16px\);/);
  const radii = [...CAL_STIL.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(radii.filter((value) => /^\d+px$/.test(value.trim())), [], "no bare px radius");
});
