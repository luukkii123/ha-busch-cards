"use strict";

// M26 (Buschcheck W2/E6): text colours of busch-cards reach 4.5:1 in the light and dark theme values the
// render scripts use (THEMA_CSS of hacs/docs/render/regeln.py). Computed from the declared CSS (var() with
// fallback, color-mix in srgb), the same WCAG formula as hacs/scripts/kontrast_touch.py; the final render
// run measures it in the browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "dist", "busch-cards.js"), "utf8");
// CSS without comments (a comment may quote a declaration).
const slice = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to, SOURCE.indexOf(from))).replace(/\/\*[\s\S]*?\*\//g, "");
const SCHEDULE = slice("class BuschScheduleCard extends", "</style>");
const CAL = slice("const CAL_STIL = `", "`;");
const NET = slice("const BUSCH_NETWORK_STYLE=", "`;");
const SMART = slice("const BUSCH_SMART_EDITOR_CSS", "`;");
const DEV = slice("const DEV_STIL = `", "`;");
const SHARED = slice("/* BEGIN BUSCH SHARED UI", "/* END BUSCH SHARED UI");

const THEMA = {
  light: { "primary-color": "#03a9f4", "primary-text-color": "#212121", "secondary-text-color": "#727272", "card-background-color": "#ffffff",
    "secondary-background-color": "#e5e5e5", "error-color": "#db4437", "warning-color": "#ffa600", "success-color": "#43a047", "text-primary-color": "#ffffff" },
  dark: { "primary-color": "#03a9f4", "primary-text-color": "#e1e1e1", "secondary-text-color": "#9b9b9b", "card-background-color": "#1c1c1c",
    "secondary-background-color": "#202020", "error-color": "#db4437", "warning-color": "#ffa600", "success-color": "#43a047", "text-primary-color": "#212121" },
};

/** Splits "a, b" at the top level (commas inside parentheses stay). */
function args(text) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}
/** A custom property declared in the card CSS (`--name: value;`), value with balanced parentheses. */
function definition(css, name) {
  const i = css.indexOf(name + ":");
  if (i < 0) return null;
  let depth = 0, j = i + name.length + 1;
  for (; j < css.length; j++) {
    if (css[j] === "(") depth++;
    else if (css[j] === ")") depth--;
    else if ((css[j] === ";" || css[j] === "}") && depth === 0) break;
  }
  return css.slice(i + name.length + 1, j).trim();
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Colour of a declared value; `under` is the surface below (for mixes with transparent). */
function farbe(wert, t, css, under) {
  wert = wert.trim();
  if (/^#[0-9a-f]{6}$/i.test(wert)) return hex(wert);
  if (/^#[0-9a-f]{3}$/i.test(wert)) return hex("#" + [...wert.slice(1)].map((c) => c + c).join(""));
  if (wert === "transparent") return under;
  let m = wert.match(/^var\((--[\w-]+)(?:,([\s\S]*))?\)$/);
  if (m) {
    const name = m[1].slice(2);
    if (t[name]) return hex(t[name]);
    const def = definition(css, m[1]);
    if (def) return farbe(def, t, css, under);
    assert.ok(m[2] !== undefined, "unknown token " + m[1]);
    return farbe(m[2], t, css, under);
  }
  m = wert.match(/^color-mix\(in srgb,([\s\S]*)\)$/);
  if (m) {
    const [a, b] = args(m[1]);
    const pa = a.match(/^([\s\S]*?)\s+(\d+)%$/);
    const ca = farbe(pa[1], t, css, under), cb = farbe(b, t, css, under), p = Number(pa[2]) / 100;
    return ca.map((v, i) => v * p + cb[i] * (1 - p));
  }
  throw new Error("colour not understood: " + wert);
}
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = c.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const quote = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
function regel(css, sel) {
  const i = css.indexOf(sel + " {") >= 0 ? css.indexOf(sel + " {") : css.indexOf(sel + "{");
  assert.ok(i >= 0, "rule " + sel);
  return css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
}
/** Value of `prop` in a rule body (balanced parentheses, the first declaration of that name). */
const wert = (block, prop) => {
  const m = block.match(new RegExp("(?:^|[;{\\s])" + prop + ":"));
  return m ? definition(block.slice(m.index), prop) : null;
};

const CARD = "var(--card-background-color)";
// [label, css, rule, background: "background" of the same rule or a colour expression]
const FAELLE = [
  ["schedule block time", SCHEDULE, ".block", "background"],
  ["schedule today label", SCHEDULE, ".day.today .label", "color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color))"],
  ["schedule Save", SCHEDULE, '.actions .busch-btn[data-variant="primary"]', "background"],
  ["schedule Delete", SCHEDULE, '.actions .busch-btn[data-variant="destructive"]', CARD],
  ["schedule dialog message", SCHEDULE, ".dlg .msg", CARD],
  ["schedule clear day", SCHEDULE, ".choices button.danger", CARD],
  ["calendar time on weekend", CAL, ".cal-zeit", "var(--secondary-background-color)"],
  ["calendar time today", CAL, ".cal-zeit", "color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color))"],
  ["calendar weekday on weekend", CAL, ".cal-datum", "var(--secondary-background-color)"],
  ["calendar today date", CAL, ".cal-heute .cal-wt, .cal-heute .cal-nr", "color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color))"],
  ["calendar picker current month", CAL, ".cal-wahl-jetzt", "color-mix(in srgb, var(--primary-color) 16%, var(--card-background-color))"],
  ["network success badge", NET, ".status-success", "var(--secondary-background-color)"],
  ["network warning badge", NET, ".status-warning", "var(--secondary-background-color)"],
  ["network error badge", NET, ".status-error", "var(--secondary-background-color)"],
  ["network neutral badge", NET, ".status-unknown,.status-unavailable,.status-neutral", "var(--secondary-background-color)"],
  // Bildprüfung 19.11.: network/FRITZ buttons are the shared .busch-btn (transparent, framed); their colours come from Shared UI.
  ["network danger button", SHARED, ":where(.busch-btn[data-variant=destructive]),:where(.busch-btn[data-variant=danger])", CARD],
  ["network secondary button", SHARED, ":where(.busch-btn[data-variant=secondary])", CARD],
  ["network primary button", SHARED, ":where(.busch-btn[data-variant=primary])", "background"],
  ["smart editor button", SMART, "button", CARD],
  // Run karten-20261119-164604: icons measured in the render harness (its ha-icon draws a glyph).
  ["schedule plus icon", SCHEDULE, ".day .add-block", "background"],
  ["device icon", DEV, ".dev-icon", "var(--secondary-background-color)"],
  // The device card shows the shared state block; its error icon colour comes from Shared UI 0.5.0 (no local override).
  ["device error state icon", SHARED, ".busch-state[data-kind=error] .busch-state-icon", CARD],
];

test("M26: text colours of busch-cards reach 4.5:1 in light and dark (blocks, today marks, buttons, badges, errors, icons)", () => {
  const lines = [];
  for (const [label, css, sel, grund] of FAELLE) for (const [name, t] of Object.entries(THEMA)) {
    const block = regel(css, sel), card = hex(t["card-background-color"]);
    const bg = farbe(grund === "background" ? wert(block, "background") : grund, t, css, card);
    const fg = farbe(wert(block, "color"), t, css, bg);
    const q = quote(fg, bg);
    if (q < 4.5) lines.push(`${label} ${name}: ${q.toFixed(2)}:1`);
  }
  assert.deepEqual(lines, []);
});

// The today bar was pure HA blue (E6, accent); since the user decision of 19.11. (#1320, no exception for graphics) it is
// primary 60 % with the text colour (3:1 on its tint, see the #1320 test below).
test("M26: the schedule colour hook stays the whole block surface; HA blue stays surface, frame and accent (today bar mixed, #1320)", () => {
  assert.match(regel(SCHEDULE, ".block"), /background: var\(--busch-schedule-color, color-mix\(in srgb, var\(--primary-color\) 50%, var\(--card-background-color, #fff\)\)\);/);
  assert.match(regel(SCHEDULE, ".day.today"), /box-shadow: inset 3px 0 0 color-mix\(in srgb, var\(--primary-color\) 60%, var\(--primary-text-color\)\);/);
  assert.match(regel(SCHEDULE, ".day.today .label"), /font-weight: var\(--ha-font-weight-bold, 700\);/, "today is not marked by colour alone");
});

test("M26: the device card has no local override of the shared state icon colour", () => {
  assert.doesNotMatch(DEV, /busch-state-icon/);
});

// M79 (#1320, user decision 19.11.): coloured symbols are non-text graphics (WCAG 1.4.11) and reach 3:1 on their surface,
// also next to a text. The schedule head icon of an active schedule uses HA's --state-active-color (amber by default,
// the render themes leave it unset, so the primary colour falls in); the network card/row icon sits on the grey tile.
test("M79: coloured symbols of busch-cards reach 3:1 on their surface (schedule head icon on, network card/row icon)", () => {
  const SYMBOLE = [
    ["schedule head icon on", SCHEDULE, ".head.on ha-icon", CARD],
    ["network card/row icon", NET, ".card-icon,.row-icon", "var(--secondary-background-color)"],
  ];
  const themen = { ...THEMA, "light HA amber": { ...THEMA.light, "state-active-color": "#ffc107" }, "dark HA amber": { ...THEMA.dark, "state-active-color": "#ffc107" } };
  const lines = [], all = [];
  for (const [label, css, sel, grund] of SYMBOLE) for (const [name, t] of Object.entries(themen)) {
    const block = regel(css, sel), bg = farbe(grund, t, css, hex(t["card-background-color"]));
    const q = quote(farbe(wert(block, "color"), t, css, bg), bg);
    all.push(`${label} ${name}: ${q.toFixed(2)}:1`);
    if (q < 3) lines.push(all.at(-1));
  }
  assert.equal(all.length, 8);
  assert.deepEqual(lines, []);
});

// #1320 (Etappe I, Kontrast-Rest, user decision: no exception for graphics): operated controls and information-carrying
// graphics reach 3:1 (WCAG 1.4.11) in light and dark: the device quick range (accent colour on the grey control) and the
// busy ring of the power button, the schedule track frame against the card, the block frame against the track, the grips
// inside and outside a block, the today bar on its tint, the block preview segments against their track and the card,
// and the calendar dot's ring against the card.
test("#1320: controls and graphics of busch-cards reach 3:1 (quick range, busy ring, schedule track/block/grips/today/preview, calendar dot)", () => {
  const SCHED_THEMA = Object.fromEntries(Object.entries(THEMA).map(([n, t]) => [n, { ...t, "divider-color": n === "light" ? "#e0e0e0" : "#474747" }]));
  const first = (css, re) => { const m = css.match(re); assert.ok(m, String(re)); return m[1].trim(); };
  const lines = [], all = [];
  for (const [name, t] of Object.entries(SCHED_THEMA)) {
    const card = hex(t["card-background-color"]), f = (w, under = card) => farbe(w, t, SCHEDULE + DEV + CAL, under);
    const grau = f("var(--secondary-background-color)"), spur = f(wert(regel(SCHEDULE, ".track"), "background-color"));
    const block = f(wert(regel(SCHEDULE, ".block"), "background")), heute = f(wert(regel(SCHEDULE, ".day.today"), "background"), card);
    const griffInnen = (() => { const r = SCHEDULE.match(/\}\s*\.handle::after \{([^}]*)\}/); assert.ok(r, "grip mark"); return r[1]; })();
    const opacity = Number(wert(griffInnen, "opacity") ?? 1);
    const vspur = f(wert(regel(SCHEDULE, ".v-spur"), "background"));
    const faelle = [
      ["quick range accent/control", f(wert(regel(DEV, ".dev-quick button,.dev-quick input,.dev-quick select"), "accent-color")), grau],
      ["quick busy ring/button", f(first(DEV, /\.dev-quick button\.dev-quick-pending \{[^}]*box-shadow:inset 0 0 0 2px ([^;]+);/)), grau],
      ["schedule track frame/card", f(first(SCHEDULE, /\.track \{[^}]*box-shadow: inset 0 0 0 1px ([^;]+);/)), card],
      ["schedule block frame/track", f(first(SCHEDULE, /\.block \{[^}]*box-shadow: inset 0 0 0 2px ([^;]+);/)), spur],
      ["schedule grip inside/block", f(wert(griffInnen, "background")).map((v, i) => v * opacity + block[i] * (1 - opacity)), block],
      ["schedule grip outside/track", f(first(SCHEDULE, /@container block[^]*?\.handle::after \{ background: ([^;]+);/)), spur],
      ["schedule today bar/tint", f(first(SCHEDULE, /\.day\.today \{[^}]*box-shadow: inset 3px 0 0 ([^;]+);/)), heute],
      ...[".v-seg", ".v-seg.v-dieser", ".v-seg.v-konflikt"].flatMap((sel) => [[`preview ${sel}/track`, f(wert(regel(SCHEDULE, sel), "background")), vspur], [`preview ${sel}/card`, f(wert(regel(SCHEDULE, sel), "background")), card]]),
      ["calendar dot ring/card", f(first(CAL, /\.cal-punkt \{[^}]*border:\s*1px solid ([^;]+);/)), card],
    ];
    for (const [label, fg, bg] of faelle) {
      const q = quote(fg, bg); all.push(`${label} ${name}: ${q.toFixed(2)}:1`);
      if (q < 3) lines.push(all.at(-1));
    }
  }
  assert.equal(all.length, 28);
  assert.deepEqual(lines, []);
});
