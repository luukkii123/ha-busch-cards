"use strict";

// M42 (Buschcheck D8): busch-cards registers every element and picker entry through BuschUI.register,
// so a second copy of the module (two resource URLs, a cache parameter) loads cleanly.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const CARDS = SOURCE.slice(SOURCE.indexOf("/* END BUSCH SHARED UI */")).replace(/\/\*[\s\S]*?\*\//g, "");

const TAGS = [
  "busch-schedule-card", "busch-map-card", "busch-calendar-card", "busch-device-card",
  "busch-smart-entities", "busch-network-card", "busch-fritz-device-card",
];

test("M42: the bundle loads twice into one realm without NotSupportedError or duplicate picker entries", () => {
  const env = kit.createEnvironment({ language: "de" });
  const defined = [];
  const define = env.customElements.define;
  // The kit registry throws on a second definition, like the browser's NotSupportedError.
  env.customElements.define = (name, cls) => { defined.push(name); define(name, cls); };
  env.window.customElements = env.customElements;
  env.globalThis = env;
  vm.createContext(env);
  // Each module has its own scope in the browser; the wrapper gives each copy one.
  for (let copy = 0; copy < 2; copy++) vm.runInContext(`(() => {\n${SOURCE}\n})();`, env, { filename: BUNDLE });
  for (const tag of TAGS) {
    assert.equal(defined.filter((name) => name === tag).length, 1, tag + " defined once");
    assert.equal(defined.filter((name) => name === tag + "-editor").length, 1, tag + "-editor defined once");
    assert.equal(env.window.customCards.filter((entry) => entry.type === tag).length, 1, tag + " one picker entry");
  }
  assert.equal(env.window.customCards.length, TAGS.length);
});

test("M42: no direct customElements.define or customCards.push left in the card code", () => {
  assert.doesNotMatch(CARDS, /customElements\.define\(/);
  assert.doesNotMatch(CARDS, /customCards\.push\(/);
  assert.equal((CARDS.match(/BuschUI\.register\(/g) || []).length, TAGS.length * 2);
});
