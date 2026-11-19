"use strict";

// M25 (Buschcheck F3/W14): compact month list. Every day stays in the list, but
// consecutive empty days of the same kind (weekday/weekend) share one line;
// date and first event sit on one baseline; a "Today" button; getCardSize from rows.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");
const { ladeKarte } = require("./laden.js");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
const { calMonatsGrenzen, calGruppiereNachTag, calListeHtml, calZeilen, TEXTE_BUSCH_CALENDAR_CARD } = ladeKarte([
  "calMonatsGrenzen", "calGruppiereNachTag", "calListeHtml", "calZeilen", "TEXTE_BUSCH_CALENDAR_CARD",
]);

// The fixture of render-kalender.py (August 2026): the finding image kalender-karte-a-480-light.png.
const TERMINE = [
  { start: { dateTime: "2026-08-03T08:49:13+02:00" }, end: { dateTime: "2026-08-03T16:15:08+02:00" }, summary: "DZ", uid: "e1" },
  { start: { dateTime: "2026-08-04T06:30:00+02:00" }, end: { dateTime: "2026-08-04T16:00:00+02:00" }, summary: "TA", uid: "e2" },
  { start: { dateTime: "2026-08-05T09:00:07+02:00" }, end: { dateTime: "2026-08-05T17:44:54+02:00" }, summary: "DZ", uid: "e3" },
  { start: { date: "2026-08-10" }, end: { date: "2026-08-13" }, summary: "Urlaub", uid: "e4" },
];
const AUGUST = calMonatsGrenzen(new Date(2026, 7, 15), 0);
const tage = () => calGruppiereNachTag(TERMINE.map((t, i) => ({ ...t, _idx: i })), AUGUST.start, AUGUST.ende);

test("M25: empty days of one kind share one line, event days keep their own row", () => {
  const zeilen = calZeilen(tage(), true);
  const art = Array.from(zeilen, (z) => (z.art === "lauf" ? `${z.tage[0].tagNummer}-${z.tage.at(-1).tagNummer}` : String(z.tag.tagNummer)));
  assert.deepEqual(art, ["1-2", "3", "4", "5", "6-7", "8-9", "10", "11", "12", "13-14", "15-16", "17-21", "22-23", "24-28", "29-30", "31-31"]);
  // Without empty days only event days remain, as before.
  assert.deepEqual(Array.from(calZeilen(tage(), false), (z) => z.tag.tagNummer), [3, 4, 5, 10, 11, 12]);
});

test("M25: the list still names every day of the month, now 16 lines instead of 31", () => {
  const html = calListeHtml(tage(), { zeigeLeereTage: true, locale: "de-DE", heute: new Date(2026, 7, 15) });
  assert.equal((html.match(/class="cal-tag[ "]/g) || []).length, 31);
  assert.equal((html.match(/class="cal-lauf[ "]/g) || []).length, 10);
  assert.match(html, /<div class="cal-lauf cal-wochenende-lauf"><div class="cal-tag cal-wochenende cal-heute cal-leer">/);
});

test("M25: all-day events read as a chip, times stay tabular", () => {
  const html = calListeHtml(tage(), { zeigeLeereTage: false, locale: "de-DE" });
  assert.match(html, /<span class="cal-zeit cal-ganztags">ganztägig<\/span>/);
  // The clock text depends on the container time zone; the class does not.
  assert.match(html, /<span class="cal-zeit">\d\d:\d\d – \d\d:\d\d<\/span>/);
});

test("M25: CSS puts date and event on one baseline in a fixed date column", () => {
  const css = SOURCE.slice(SOURCE.indexOf("const CAL_STIL = `"), SOURCE.indexOf("`;", SOURCE.indexOf("const CAL_STIL = `")));
  assert.match(css, /\.cal-tag \{[^}]*display:grid;[^}]*grid-template-columns:64px minmax\(0, 1fr\);[^}]*align-items:baseline;/);
  assert.match(css, /\.cal-lauf \{[^}]*display:flex;[^}]*flex-wrap:wrap;/);
  assert.match(css, /\.cal-heute \{[^}]*box-shadow:inset 3px 0 0 var\(--primary-color\)/);
  assert.match(css, /\.cal-zeit \{[^}]*font-variant-numeric:tabular-nums;/);
});

function world() {
  const clock = kit.createClock(new Date(2026, 7, 15, 12, 0).getTime());
  const env = kit.createEnvironment({ clock, globals: { performance } });
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({ clock, language: "de", states: { "calendar.a": { state: "off", attributes: { friendly_name: "A" } } } });
  ha.respond("call_api", () => JSON.parse(JSON.stringify(TERMINE)));
  return { clock, env, ha };
}

async function mount(w, config) {
  const card = w.env.document.createElement("busch-calendar-card");
  card.setConfig({ entities: ["calendar.a"], ...config });
  w.env.document.body.appendChild(card);
  card.hass = w.ha.hass;
  await w.clock.advance(50);
  return card;
}

test("M25: the Today button returns from another month, a second tap does nothing", async () => {
  const w = world();
  const card = await mount(w, { month_offset: 0, title: "Arbeitszeit" });
  assert.match(card._koerper.innerHTML, /<button class="cal-pfeil cal-heute-knopf busch-btn" data-variant="secondary" data-schritt="heute" aria-label="Zum aktuellen Monat" title="Zum aktuellen Monat">Heute<\/button>/);
  card._blaettern(-2);
  await w.clock.advance(50);
  assert.equal(card._versatzLaufend, -2);
  w.ha.resetStats();
  // The kit DOM does not parse innerHTML: put the button where the click handler looks for it.
  const knopf = w.env.document.createElement("button");
  knopf.className = "cal-pfeil cal-heute-knopf";
  knopf.dataset.schritt = "heute";
  card._koerper.appendChild(knopf);
  knopf.click();
  await w.clock.advance(50);
  assert.equal(card._versatzLaufend, 0, "back to the running month");
  assert.equal(w.ha.count("call_api"), 1, "one fresh fetch for the running month");
  // Already in the running month: Today does nothing, no fetch.
  w.ha.resetStats();
  const again = w.env.document.createElement("button");
  again.className = "cal-pfeil cal-heute-knopf";
  again.dataset.schritt = "heute";
  card._koerper.appendChild(again);
  again.click();
  await w.clock.advance(50);
  assert.equal(w.ha.count("call_api"), 0);
  assert.equal(TEXTE_BUSCH_CALENDAR_CARD.en.texte.heute, "Today");
  assert.equal(TEXTE_BUSCH_CALENDAR_CARD.en.texte.zumAktuellenMonat, "Go to the current month");
});

test("M25: getCardSize follows the rendered lines instead of a fixed 12", async () => {
  const w = world();
  const voll = await mount(w, { month_offset: 0, title: "Arbeitszeit", show_total: true });
  const kompakt = await mount(w, { month_offset: 0, show_empty_days: false });
  // 6 event rows à 49 px + 10 shared lines à 33 px + head 95 px + footer 40 px + 8 px → 767 px → 16 units of 50 px.
  assert.equal(voll.getCardSize(), 16);
  // 6 event rows + head 64 px + 8 px = 366 px → 8.
  assert.equal(kompakt.getCardSize(), 8);
});
