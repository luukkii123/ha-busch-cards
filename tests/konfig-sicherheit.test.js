"use strict";

// M69 (#1281, S9): configuration values that reach markup or CSS fall back to safe values.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ladeKarte } = require("./laden.js");
const { activeMarkup } = require("./_testkit.cjs");

const NAMEN = ["BuschMapCard", "calNormalisiereKonfig", "calFarbeGueltig", "calPalette"];

function stil(karte, config) {
  const card = Object.create(karte.BuschMapCard.prototype);
  card._config = { map_style: "custom", tile_url: "https://tiles.example.invalid/{z}/{x}/{y}.png", ...config };
  return { card, stil: card._stil() };
}

/** Leaflet's attribution control renders its entries with innerHTML; this stand-in keeps the string. */
function quellenangabe(karte, text) {
  const eintraege = [];
  const map = { attributionControl: { addAttribution: (t) => eintraege.push(t), removeAttribution() {} } };
  const { card } = stil(karte, {});
  card._setzeQuellenangabe(map, { options: {} }, text);
  return eintraege.join("");
}

test("tile_attribution with an img payload yields no img in the attribution field", () => {
  const karte = ladeKarte(NAMEN);
  const { stil: s } = stil(karte, { tile_attribution: "<img src=x onerror=alert(1)>" });
  assert.deepEqual([...activeMarkup(s.attribution)], []);
  assert.deepEqual([...activeMarkup(quellenangabe(karte, s.attribution))], []);
  assert.ok(s.attribution.includes("&lt;img"), "payload stays visible as text");
});

test("a harmless tile_attribution stays visible unchanged", () => {
  const karte = ladeKarte(NAMEN);
  const { stil: s } = stil(karte, { tile_attribution: "Tiles © Example Maps" });
  assert.equal(s.attribution, "Tiles © Example Maps");
  assert.equal(stil(karte, {}).stil.attribution, "");
});

test("calendar colour 'red;background:url(//x)' falls back to the palette (Node: strict syntax check)", () => {
  const karte = ladeKarte(NAMEN);
  const config = karte.calNormalisiereKonfig({
    entities: [
      { entity: "calendar.a", color: "red;background:url(//x)" },
      { entity: "calendar.b", color: "#123456" },
      { entity: "calendar.c", color: 'blue" onclick="x' },
      { entity: "calendar.d", color: "rgb(10, 20, 30)" },
      { entity: "calendar.e", color: "var(--red-color)" },
      { entity: "calendar.f", color: "url(//x)" },
    ],
  });
  const farben = config.entities.map((e) => e.color);
  assert.deepEqual(farben, [karte.calPalette[0], "#123456", karte.calPalette[2], "rgb(10, 20, 30)", "var(--red-color)", karte.calPalette[5]]);
});

test("calendar colours use CSS.supports when the browser offers it", () => {
  const gefragt = [];
  const CSS = { supports: (eigenschaft, wert) => { gefragt.push([eigenschaft, wert]); return wert === "rebeccapurple"; } };
  const karte = ladeKarte(NAMEN, { CSS });
  assert.equal(karte.calFarbeGueltig("rebeccapurple"), true);
  assert.equal(karte.calFarbeGueltig("notacolor"), false);
  assert.equal(karte.calFarbeGueltig("red;background:url(//x)"), false, "rejected before CSS.supports");
  assert.deepEqual(gefragt.map((g) => g.join("=")), ["color=rebeccapurple", "color=notacolor"]);
  const config = karte.calNormalisiereKonfig({ entities: [{ entity: "calendar.a", color: "notacolor" }] });
  assert.equal(config.entities[0].color, karte.calPalette[0]);
});
