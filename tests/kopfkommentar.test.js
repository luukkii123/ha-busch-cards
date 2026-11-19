"use strict";

// M73 (#1321, D16): the bundle's header comment lists every card of the card picker. The test
// compares that list with the `window.customCards` entries the bundle registers when it loads,
// so a new card without a header entry (or a stale entry) turns it red.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");

/** The `- busch-…` lines of the bundle header (the first comment after the shared UI block). */
function headerCards(source) {
  const after = source.slice(source.indexOf("/* END BUSCH SHARED UI */"));
  const start = after.indexOf("/**");
  const header = after.slice(start, after.indexOf("*/", start) + 2);
  assert.match(header, /Busch Cards/, "bundle header found");
  return [...header.matchAll(/^ \*\s+- `([a-z0-9-]+)`/gm)].map((m) => m[1]);
}

function pickerCards() {
  const env = kit.createEnvironment({ language: "en" });
  kit.loadScript(BUNDLE, { globals: env });
  return env.window.customCards.map((c) => c.type);
}

test("M73: the header comment lists exactly the cards of window.customCards", () => {
  const header = headerCards(SOURCE);
  const picker = pickerCards();
  assert.ok(picker.length >= 7, `picker entries: ${picker.join(", ")}`);
  assert.deepEqual([...header].sort(), [...picker].sort());
  assert.equal(new Set(header).size, header.length, "no card listed twice");
});

test("M73: a new card without a header entry turns the comparison red", () => {
  const extra = SOURCE + '\nBuschUI.register("busch-new-card", class extends HTMLElement {}, '
    + '{ type: "busch-new-card", name: "New", description: "New.", preview: false });\n';
  const file = path.join(require("node:os").tmpdir(), `busch-cards-m73-${process.pid}.js`);
  fs.writeFileSync(file, extra);
  try {
    const env = kit.createEnvironment({ language: "en" });
    kit.loadScript(file, { globals: env });
    const picker = env.window.customCards.map((c) => c.type);
    assert.ok(picker.includes("busch-new-card"));
    assert.notDeepEqual([...headerCards(extra)].sort(), [...picker].sort());
  } finally {
    fs.rmSync(file, { force: true });
  }
});
