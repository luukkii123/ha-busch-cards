// M79 (Abschlusstor 24.11.2026): every synthetic render script that writes images installs the shared ha-icon stand-in,
// so symbols are real MDI glyphs (measured with 3:1) instead of empty squares, and reports it.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const DIR = path.join(__dirname, "..", "docs", "render");
const AUSNAHMEN = {
  "render-kalender-fuss.py": "the calendar footer shows no symbol",
  "native-network-editors.py": "runs in the real HA frontend, which has the real ha-icon",
};
test("M79: synthetic render scripts with screenshots install the ha-icon stand-in and report ha_icon", () => {
  const fehlt = [];
  for (const name of fs.readdirSync(DIR).filter(n => n.endsWith(".py"))) {
    const src = fs.readFileSync(path.join(DIR, name), "utf8");
    if (!src.includes("screenshot(") || name.startsWith("live-ha-") || AUSNAHMEN[name]) continue;
    if (!/ha_icon_attrappe\(/.test(src) || !/ha_icon_fehlend\(/.test(src)) fehlt.push(name);
  }
  assert.deepEqual(fehlt, []);
});
