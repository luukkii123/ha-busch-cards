"use strict";

// M46: the embedded Leaflet stays byte-identical to upstream leaflet.js 1.9.4
// (unpkg, only the trailing sourceMappingURL line removed). The hash is the
// same in ha-localtrack-cards; both repos update Leaflet together.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LEAFLET_JS_SHA256 = "dc71f8a6880bc3ca1bd9fa8dc5f1af48c702dc510b0a78240a07c5feed7ce935";
// Read as latin1 so every byte maps to one char and hashes back unchanged.
const TEXT = fs.readFileSync(path.join(__dirname, "..", "dist", "busch-cards.js"), "latin1");

function vendorBloecke(text) {
  const re = /\/\* BEGIN VENDOR ([\w.-]+) (\S+) sha256:([0-9a-f]{64}) \*\/\n([\s\S]*?)^\/\* END VENDOR \1 \*\//gm;
  return Array.from(text.matchAll(re), (m) => ({ name: m[1], version: m[2], hash: m[3], body: m[4] }));
}

const sha256 = (body) => crypto.createHash("sha256").update(Buffer.from(body, "latin1")).digest("hex");

test("genau ein Vendor-Block leaflet 1.9.4, Marker vollstaendig", () => {
  const bloecke = vendorBloecke(TEXT);
  assert.deepEqual(bloecke.map((b) => `${b.name} ${b.version}`), ["leaflet 1.9.4"]);
  assert.equal(TEXT.split("/* BEGIN VENDOR ").length - 1, 1);
  assert.equal(TEXT.split("/* END VENDOR ").length - 1, 1);
});

test("Leaflet-Block entspricht dem Upstream-Hash", () => {
  const [leaflet] = vendorBloecke(TEXT);
  assert.equal(leaflet.hash, LEAFLET_JS_SHA256);
  assert.equal(sha256(leaflet.body), LEAFLET_JS_SHA256);
  assert.ok(leaflet.body.startsWith("/* @preserve\n * Leaflet 1.9.4, a JS library"));
  assert.ok(!leaflet.body.includes("sourceMappingURL"));
});

test("Leaflet bleibt in leafletLaden(), also erst bei Bedarf ausgewertet", () => {
  const start = TEXT.indexOf("function leafletLaden()");
  const begin = TEXT.indexOf("/* BEGIN VENDOR leaflet ");
  const ende = TEXT.indexOf("/* END VENDOR leaflet */");
  const catchStelle = TEXT.indexOf("} catch (error) {", begin);
  assert.ok(start >= 0 && start < begin && begin < ende && ende < catchStelle);
});
