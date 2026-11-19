"use strict";

// M25 / W14.5 (#1311, user decision 19.11.2026): the month name in the calendar head opens a month picker
// (12 months, year ‹ ›). A choice jumps there; Escape, Cancel, the close button, the scrim and Back close it
// without a change; focus returns to the month name. History works like the schedule dialogs.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");

/** A browser-like history: back() fires popstate in a later task. */
function fakeHistory(env) {
  const entries = [{ state: null }];
  let index = 0;
  return {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    get index() { return index; },
    pushState(state) { entries.splice(index + 1); entries.push({ state }); index++; },
    replaceState(state) { entries[index] = { state }; },
    back() {
      if (index === 0) return;
      index--;
      env.setTimeout(() => env.window.dispatchEvent(new env.Event("popstate")), 0);
    },
  };
}

function world(language = "de") {
  const clock = kit.createClock(new Date(2026, 7, 15, 12, 0).getTime());
  const env = kit.createEnvironment({ clock, language, globals: { performance } });
  env.history = fakeHistory(env);
  // M28: BuschUI.dialogHistory works on window.history, as in the browser.
  env.window.history = env.history;
  kit.loadScript(BUNDLE, { globals: env });
  const ha = kit.createHass({ clock, language, states: { "calendar.a": { state: "off", attributes: { friendly_name: "A" } } } });
  ha.respond("call_api", () => []);
  return { clock, env, ha };
}

async function mount(w, config = {}) {
  const card = w.env.document.createElement("busch-calendar-card");
  card.setConfig({ entities: ["calendar.a"], ...config });
  w.env.document.body.appendChild(card);
  card.hass = { ...w.ha.hass, locale: { language: w.ha.hass.language || "de" } };
  await w.clock.advance(50);
  return card;
}

/** The kit DOM does not parse innerHTML: put the month button where the click handler and focus return look. */
function monthButton(w, card) {
  const button = w.env.document.createElement("button");
  button.className = "cal-monat cal-monat-knopf";
  button.dataset.schritt = "monat";
  card._koerper.appendChild(button);
  return button;
}

function key(w, target, name, extra = {}) {
  const event = new w.env.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event);
  return event;
}

const picker = (card) => card.querySelector(".cal-wahl");
const isOpen = (card) => Boolean(picker(card) && !picker(card).hidden);
const months = (card) => picker(card).querySelectorAll(".cal-wahl-monat");

test("M25 picker: the head renders the month name as a button that opens a dialog (navigation on), a plain name without navigation", async () => {
  const w = world();
  const card = await mount(w);
  assert.match(card._koerper.innerHTML,
    /<button class="cal-monat cal-monat-knopf" data-schritt="monat" aria-haspopup="dialog" aria-expanded="false" title="Monat wählen">August 2026<\/button>/);
  const ohne = await mount(w, { navigation: false });
  assert.match(ohne._koerper.innerHTML, /<span class="cal-monat">August 2026<\/span>/);
  assert.doesNotMatch(ohne._koerper.innerHTML, /cal-monat-knopf/);
});

test("M25 picker: a click on the month name opens it with title, year, 12 months and Cancel; the shown month is selected and focused", async () => {
  const w = world();
  const card = await mount(w);
  const before = w.env.history.length;
  monthButton(w, card).click();
  assert.ok(isOpen(card), "picker open");
  const dialog = picker(card);
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  const title = dialog.querySelector("h2");
  assert.equal(title.textContent, "Monat wählen");
  assert.equal(dialog.getAttribute("aria-labelledby"), title.id);
  assert.equal(dialog.querySelector(".cal-wahl-jahrzahl").textContent, "2026");
  assert.equal(months(card).length, 12);
  assert.deepEqual(months(card).map((b) => b.getAttribute("aria-label")).slice(0, 2), ["Januar 2026", "Februar 2026"]);
  const august = months(card)[7];
  assert.equal(august.getAttribute("aria-current"), "true");
  assert.equal(w.env.document.activeElement, august, "focus on the shown month");
  assert.deepEqual(dialog.querySelectorAll(".cal-wahl-aktionen button").map((b) => b.textContent), ["Abbrechen"]);
  assert.equal(dialog.querySelector(".cal-wahl-x").getAttribute("aria-label"), "Schließen");
  assert.equal(w.env.history.length, before + 1, "one own history entry");
  assert.equal(w.env.history.state.buschUiDialog.name, "busch-calendar-card:monat");
  assert.equal(card._karte.classList.contains("cal-wahl-offen"), true);
});

test("M25 picker: next year, then March jumps to March 2027 with one fresh fetch, closes and returns focus to the month name", async () => {
  const w = world();
  const card = await mount(w);
  monthButton(w, card).click();
  const dialog = picker(card);
  dialog.querySelector('.cal-pfeil[data-jahr="1"]').click();
  assert.equal(dialog.querySelector(".cal-wahl-jahrzahl").textContent, "2027");
  assert.equal(months(card)[2].getAttribute("aria-label"), "März 2027");
  assert.equal(months(card)[7].hasAttribute("aria-current"), false, "August 2027 is not the shown month");
  w.ha.resetStats();
  // The answer comes after the close, as on a real network.
  w.ha.behave("call_api", { delay: 100 });
  // The choice redraws the head synchronously and draws the month button anew; the kit DOM does
  // not parse innerHTML, so the redraw puts the new button where the browser would (M28: the
  // picker now closes in the same task instead of after popstate).
  let fresh = null;
  const render = card._render.bind(card);
  card._render = () => { render(); fresh = monthButton(w, card); };
  months(card)[2].click();
  card._render = render;
  assert.equal(card._versatzLaufend, 7, "August 2026 + 7 = March 2027");
  await w.clock.advance(10);
  assert.equal(isOpen(card), false, "closed after the choice");
  assert.equal(w.env.history.index, 0, "own entry consumed");
  assert.equal(w.env.document.activeElement, fresh, "focus back on the month name");
  await w.clock.advance(200);
  assert.equal(w.ha.count("call_api"), 1, "one fetch for the chosen month");
  const api = w.ha.log.filter((e) => e.kind === "api").at(-1);
  assert.ok(decodeURIComponent(api.message.path).includes("start=" + new Date(2027, 2, 1).toISOString()), api.message.path);
  assert.match(card._koerper.innerHTML, /März 2027/);
});

test("M25 picker: choosing the shown month closes without a fetch", async () => {
  const w = world();
  const card = await mount(w);
  monthButton(w, card).click();
  w.ha.resetStats();
  months(card)[7].click();
  await w.clock.advance(50);
  assert.equal(isOpen(card), false);
  assert.equal(card._versatzLaufend, 0);
  assert.equal(w.ha.count("call_api"), 0);
});

for (const [name, close] of [
  ["Escape", (w, card) => key(w, w.env.document.activeElement, "Escape")],
  ["Cancel", (w, card) => picker(card).querySelector(".cal-wahl-aktionen button").click()],
  ["the close button", (w, card) => picker(card).querySelector(".cal-wahl-x").click()],
  ["the scrim", (w, card) => picker(card).click()],
  ["Back", (w) => w.env.history.back()],
]) test(`M25 picker: ${name} closes without a change and focus returns to the month name`, async () => {
  const w = world();
  const card = await mount(w);
  const button = monthButton(w, card);
  button.click();
  picker(card).querySelector('.cal-pfeil[data-jahr="-1"]').click();
  w.ha.resetStats();
  close(w, card);
  await w.clock.advance(400);
  assert.equal(isOpen(card), false, "closed");
  assert.equal(card._versatzLaufend, 0, "month unchanged");
  assert.equal(w.ha.count("call_api"), 0, "no fetch");
  assert.equal(w.env.history.index, 0, "no orphaned history entry");
  assert.equal(w.env.document.activeElement, button, "focus back on the month name");
  assert.equal(card._karte.classList.contains("cal-wahl-offen"), false);
  // Reopening starts at the shown year again.
  button.click();
  assert.equal(picker(card).querySelector(".cal-wahl-jahrzahl").textContent, "2026");
});

test("M25 picker keyboard: arrows move through the grid, Home/End, Tab stays inside, Enter-click chooses", async () => {
  const w = world();
  const card = await mount(w);
  monthButton(w, card).click();
  const doc = w.env.document, m = months(card);
  assert.equal(doc.activeElement, m[7]);
  assert.equal(key(w, doc.activeElement, "ArrowRight").defaultPrevented, true);
  assert.equal(doc.activeElement, m[8]);
  key(w, doc.activeElement, "ArrowDown");
  assert.equal(doc.activeElement, m[11]);
  key(w, doc.activeElement, "ArrowUp");
  key(w, doc.activeElement, "ArrowLeft");
  assert.equal(doc.activeElement, m[7]);
  key(w, doc.activeElement, "Home");
  assert.equal(doc.activeElement, m[0]);
  key(w, doc.activeElement, "End");
  assert.equal(doc.activeElement, m[11]);
  // Focus trap: Tab from the last control goes to the first, Shift+Tab back.
  const buttons = picker(card).querySelectorAll("button");
  buttons.at(-1).focus();
  assert.equal(key(w, buttons.at(-1), "Tab").defaultPrevented, true);
  assert.equal(doc.activeElement, buttons[0]);
  key(w, buttons[0], "Tab", { shiftKey: true });
  assert.equal(doc.activeElement, buttons.at(-1));
  // Escape does not reach the dashboard.
  let reached = false;
  doc.body.addEventListener("keydown", () => { reached = true; });
  key(w, doc.activeElement, "Escape");
  assert.equal(reached, false);
  await w.clock.advance(50);
  assert.equal(isOpen(card), false);
});

test("M25 picker: a redraw while open (fresh data) keeps the picker and its year", async () => {
  const w = world();
  const card = await mount(w);
  monthButton(w, card).click();
  picker(card).querySelector('.cal-pfeil[data-jahr="1"]').click();
  card._render();
  await card._lade(0);
  assert.equal(isOpen(card), true);
  assert.equal(picker(card).querySelector(".cal-wahl-jahrzahl").textContent, "2027");
  assert.match(card._koerper.innerHTML, /aria-expanded="true"/);
});

test("M25 picker: dictionary de/en and CSS with 44 px targets inside the card", () => {
  const { TEXTE_BUSCH_CALENDAR_CARD: T } = kit.loadScript(BUNDLE, { expose: ["TEXTE_BUSCH_CALENDAR_CARD"] }).exposed;
  for (const k of ["monatWaehlen", "vorigesJahr", "naechstesJahr", "abbrechen", "schliessen", "monateIm"]) {
    assert.ok(T.de.texte[k] && T.en.texte[k], k);
  }
  assert.equal(T.en.texte.monatWaehlen, "Choose month");
  assert.equal(T.en.texte.abbrechen, "Cancel");
  const css = SOURCE.slice(SOURCE.indexOf("const CAL_STIL = `"), SOURCE.indexOf("`;", SOURCE.indexOf("const CAL_STIL = `")));
  assert.match(css, /\.cal-wahl \{[^}]*position:absolute;[^}]*inset:0;/);
  assert.match(css, /\.cal-wahl-offen \{[^}]*position:relative;/);
  assert.match(css, /\.cal-wahl-monat \{[^}]*min-height:44px;/);
  assert.match(css, /\.cal-monat-knopf \{[^}]*min-height:44px;/);
  assert.match(css, /\.cal-wahl-aktionen button \{[^}]*min-height:44px;/);
});

test("M25 header at 320 px: the controls wrap below the month instead of cutting the month name", async () => {
  const css = SOURCE.slice(SOURCE.indexOf("const CAL_STIL = `"), SOURCE.indexOf("`;", SOURCE.indexOf("const CAL_STIL = `")));
  // The header wraps, the three controls move as one group and stay right-aligned on their own line ...
  assert.match(css, /\.cal-kopf \{[^}]*flex-wrap:wrap;[^}]*justify-content:flex-end;/);
  assert.match(css, /\.cal-nav \{[^}]*display:flex;/);
  const card = await mount(world());
  assert.match(card._koerper.innerHTML, /<div class="cal-nav"><button class="cal-pfeil busch-btn" data-variant="secondary" data-schritt="-1"[^>]*>‹<\/button><button class="cal-pfeil cal-heute-knopf busch-btn" data-variant="secondary"[^>]*>[^<]*<\/button><button class="cal-pfeil busch-btn" data-variant="secondary" data-schritt="1"[^>]*>›<\/button><\/div>/);
  // ... and the month keeps its full width as flex basis (auto), so the line breaks before it is shortened.
  assert.match(css, /\.cal-monat \{[^}]*flex:1 1 auto;/);
});
