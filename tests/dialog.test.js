"use strict";

// M28 (Buschcheck W4/F7): schedule block and day dialog and the calendar month picker use the shared
// BuschUI.dialogHistory, BuschUI.focusTrap and dialog skeleton. No card calls pushState itself any more.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./_testkit.cjs");
const { ladeKarte } = require("./laden");

const BUNDLE = path.join(__dirname, "..", "dist", "busch-cards.js");
const SOURCE = fs.readFileSync(BUNDLE, "utf8");
// Card code without comments (a comment may quote HA's own pushState).
const CARDS = SOURCE.slice(SOURCE.indexOf("/* END BUSCH SHARED UI */")).replace(/\/\*[\s\S]*?\*\//g, "");
const slice = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to, SOURCE.indexOf(from)));

test("M28: no card keeps its own dialog history; the only pushState left is navigate", () => {
  const calls = [...CARDS.matchAll(/history\.pushState\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['null, "", pfad'], "only the navigate action pushes a URL");
  assert.equal((CARDS.match(/BuschUI\.dialogHistory\(/g) || []).length, 2, "schedule and calendar picker");
  assert.equal((CARDS.match(/BuschUI\.focusTrap\(/g) || []).length, 2);
  assert.doesNotMatch(CARDS, /busch_schedule_dialog|busch_calendar_dialog/);
});

test("M28: block dialog anatomy: X left of the title, Delete in the foot left of Cancel and Save", () => {
  const html = slice('<dialog class="block-dialog"', "</dialog>");
  assert.match(html, /<div class="dlg-kopf busch-dialog-head">\s*<button class="dlg-x busch-dialog-close" data-act="cancel">[\s\S]*?<\/button>\s*<h2 id="busch-block-title" class="busch-dialog-title"><\/h2>\s*<\/div>/);
  assert.doesNotMatch(html.slice(0, html.indexOf("</h2>") + 20), /data-act="delete"/, "no delete in the head");
  assert.match(html, /<div class="body busch-dialog-content">/);
  assert.match(html, /<menu class="actions busch-dialog-foot">\s*<button class="busch-btn dlg-del" data-variant="destructive" data-act="delete"><\/button>\s*<button class="busch-btn" data-variant="secondary" data-act="cancel"><\/button>\s*<button class="busch-btn" data-variant="primary" data-act="ok"><\/button>\s*<\/menu>/);
  const day = slice('<dialog class="day-dialog"', "</dialog>");
  assert.match(day, /aria-modal="true" aria-labelledby="busch-day-title"/);
  assert.match(day, /<h2 id="busch-day-title" class="busch-dialog-title"><\/h2>/);
  assert.match(day, /<menu class="actions busch-dialog-foot">/);
  const css = slice("class BuschScheduleCard extends", "</style>");
  assert.match(css, /\.actions \.busch-btn\[hidden\] \{ display: none; \}/, "a new block hides Delete although .busch-btn sets display");
  const texte = ladeKarte(["TEXTE_BUSCH_SCHEDULE_CARD"]).TEXTE_BUSCH_SCHEDULE_CARD;
  for (const lang of ["de", "en"]) assert.ok(texte[lang].texte.loeschen, lang);
});

/** A schedule card with a stand-in native <dialog>, a browser-like history and document focus events. */
function schedule() {
  const env = kit.createEnvironment({ language: "de" });
  const entries = [{ state: null }];
  let index = 0;
  env.window.history = env.history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state) { entries.splice(index + 1); entries.push({ state }); index++; },
    replaceState(state) { entries[index] = { state }; },
    back() { if (index > 0) { index--; env.window.dispatchEvent(new env.Event("popstate")); } },
  };
  let confirmAnswer = false;
  env.window.confirm = () => confirmAnswer;
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-schedule-card");
  const dialog = env.document.createElement("dialog");
  dialog.open = false;
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; this.dispatchEvent(new env.Event("close")); };
  const msg = env.document.createElement("div");
  msg.className = "msg";
  const x = env.document.createElement("button");
  const ok = env.document.createElement("button");
  dialog.append(x, msg, ok);
  card.shadowRoot.append(dialog);
  env.document.body.appendChild(card);
  card._els = { blockDialog: dialog, dayDialog: env.document.createElement("dialog") };
  card._hass = { locale: { language: "de" }, states: {} };
  card._wackeln = () => { card.gewackelt = (card.gewackelt || 0) + 1; };
  return { env, card, dialog, msg, x, ok, history: env.history, index: () => index, confirm: (v) => { confirmAnswer = v; } };
}

test("M28: schedule dialog: one own entry, Back closes a clean dialog and returns the history to its start", () => {
  const w = schedule();
  w.card._dialogTarget = { day: "monday" };
  w.card._blockGeaendert = () => false;
  w.card._dialogOeffnen(w.dialog);
  assert.equal(w.dialog.open, true);
  assert.equal(w.index(), 1, "one own entry");
  assert.equal(w.history.state.buschUiDialog.name, "busch-schedule-card:block");
  assert.ok(w.dialog._buschFalle, "focus trap active");
  w.history.back();
  assert.equal(w.dialog.open, false, "Back closes");
  assert.equal(w.card._dialogTarget, null);
  assert.equal(w.dialog._buschFalle, null, "trap released");
  assert.equal(w.index(), 0);
});

test("M28: schedule dialog: Back with unsaved input puts the entry back, stays open and wobbles", () => {
  const w = schedule();
  w.card._dialogTarget = { day: "monday" };
  w.card._blockGeaendert = () => true;
  w.card._dialogOeffnen(w.dialog);
  w.history.back();
  assert.equal(w.dialog.open, true, "still open");
  assert.equal(w.index(), 1, "entry back on top, page not left");
  assert.equal(w.card.gewackelt, 1);
  assert.match(w.msg.textContent, /Ungespeicherte/);
  // An explicit close spends exactly this entry.
  w.card._dialogSchliessen(w.dialog);
  assert.equal(w.dialog.open, false);
  assert.equal(w.index(), 0, "no orphaned entry");
});

test("M28: schedule dialog: Tab stays inside the dialog via the shared focus trap", () => {
  const w = schedule();
  w.card._dialogTarget = { day: "monday" };
  w.card._blockGeaendert = () => false;
  w.card._dialogOeffnen(w.dialog);
  w.ok.focus();
  const tab = new w.env.KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true, cancelable: true });
  w.ok.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(w.card.shadowRoot.activeElement, w.x, "from the last control to the first");
  w.card._dialogSchliessen(w.dialog);
  const after = new w.env.KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true, cancelable: true });
  w.ok.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false, "trap gone after closing");
});

test("M28: calendar month picker uses the shared skeleton classes", () => {
  const env = kit.createEnvironment({ language: "de" });
  kit.loadScript(BUNDLE, { globals: env });
  const card = env.document.createElement("busch-calendar-card");
  card.setConfig({ entities: ["calendar.a"] });
  card._wahlBauen();
  const el = card._wahl.el;
  assert.ok(el.querySelector(".cal-wahl-kopf.busch-dialog-head"));
  assert.equal(el.querySelector(".busch-dialog-head").firstChild, card._wahl.x, "X first in the head");
  assert.ok(card._wahl.x.classList.contains("busch-dialog-close"));
  assert.ok(card._wahl.titel.classList.contains("busch-dialog-title"));
  assert.ok(el.querySelector(".cal-wahl-inhalt.busch-dialog-content .cal-wahl-raster"));
  assert.ok(el.querySelector(".cal-wahl-aktionen.busch-dialog-foot"));
});
