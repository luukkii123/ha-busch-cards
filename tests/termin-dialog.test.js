"use strict";

/* ────────────────────────────────────────────────────────────────────────────
 * Der Termin-Dialog
 *
 * Ein Klick auf eine Terminzeile soll Home Assistants eigenen
 * `dialog-calendar-event-detail` oeffnen — den, in dem man den Termin wirklich
 * bearbeiten und loeschen kann.
 *
 * WAS HIER BELEGT WIRD und was nicht:
 *
 *   Belegt ist alles, was ohne Home Assistants Frontend auskommt — die
 *   Umformung der Rohdaten in die normalisierte Form, die Ableitung der
 *   Berechtigungen aus `supported_features`, das Wiederfinden des Termins zu
 *   einer angeklickten Zeile, der Bau der Dialogparameter, und vor allem:
 *   dass der Klick auf den Entitaets-Dialog zurueckfaellt, sobald irgendein
 *   Schritt des Sondenwegs scheitert.
 *
 *   NICHT belegt ist der Sondenweg selbst — das Abgreifen von HAs
 *   `dialogImport` aus dem `show-dialog`-Ereignis einer nicht eingehaengten
 *   `ha-full-calendar`. Der braucht HAs echtes Frontend. Eine Attrappe, die
 *   `_handleEventClick` nachbaut und brav ein Ereignis feuert, wuerde nur
 *   belegen, dass die Attrappe funktioniert. Deshalb steht hier keine.
 *   Diesen Teil belegt erst der Klick des Nutzers in der laufenden Anlage.
 * ────────────────────────────────────────────────────────────────────────── */

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calNormalisiereTermin,
  calBerechtigungen,
  calTerminAusZeile,
  calDialogParameter,
  CAL_DIALOG_TAG,
} = ladeKarte([
  "calNormalisiereTermin",
  "calBerechtigungen",
  "calTerminAusZeile",
  "calDialogParameter",
  "CAL_DIALOG_TAG",
]);

/* ------------------------------------------------------------------------
 * 1. Die normalisierte Form
 *
 * Home Assistant benutzt intern eine flache Form (`src/data/calendar.ts`):
 * `{ summary, dtstart, dtend, description, location, uid, recurrence_id,
 * rrule }`. Die REST-Antwort aus `calendars/…` liefert stattdessen
 * `start`/`end` als Objekte mit `dateTime` ODER `date`.
 * ---------------------------------------------------------------------- */

test("ein Termin mit Uhrzeit wird in die flache Form gebracht", () => {
  const eintrag = calNormalisiereTermin({
    summary: "Zahnarzt",
    description: "Kontrolle",
    location: "Hauptstr. 1",
    uid: "abc123",
    recurrence_id: "20260904T100000",
    rrule: "FREQ=WEEKLY",
    start: { dateTime: "2026-09-04T10:00:00+02:00" },
    end: { dateTime: "2026-09-04T11:00:00+02:00" },
  });
  assert.strictEqual(eintrag.summary, "Zahnarzt");
  assert.strictEqual(eintrag.dtstart, "2026-09-04T10:00:00+02:00");
  assert.strictEqual(eintrag.dtend, "2026-09-04T11:00:00+02:00");
  assert.strictEqual(eintrag.description, "Kontrolle");
  assert.strictEqual(eintrag.location, "Hauptstr. 1");
  assert.strictEqual(eintrag.uid, "abc123");
  assert.strictEqual(eintrag.recurrence_id, "20260904T100000");
  assert.strictEqual(eintrag.rrule, "FREQ=WEEKLY");
});

test("ein ganztaegiger Termin nimmt `date` statt `dateTime`", () => {
  const eintrag = calNormalisiereTermin({
    summary: "Urlaub",
    uid: "u1",
    start: { date: "2026-09-10" },
    end: { date: "2026-09-15" },
  });
  assert.strictEqual(eintrag.dtstart, "2026-09-10");
  assert.strictEqual(eintrag.dtend, "2026-09-15");
});

test("`dateTime` schlaegt `date`, wenn beides dasteht", () => {
  const eintrag = calNormalisiereTermin({
    uid: "u1",
    start: { dateTime: "2026-09-10T08:00:00", date: "2026-09-10" },
    end: { dateTime: "2026-09-10T09:00:00", date: "2026-09-11" },
  });
  assert.strictEqual(eintrag.dtstart, "2026-09-10T08:00:00");
  assert.strictEqual(eintrag.dtend, "2026-09-10T09:00:00");
});

test("ohne lesbaren Start gibt es keine Form, sondern null", () => {
  assert.strictEqual(calNormalisiereTermin(null), null);
  assert.strictEqual(calNormalisiereTermin(undefined), null);
  assert.strictEqual(calNormalisiereTermin({}), null);
  assert.strictEqual(calNormalisiereTermin({ start: {} }), null);
  assert.strictEqual(calNormalisiereTermin({ end: { date: "2026-09-10" } }), null);
});

test("fehlende Texte werden leer, fehlende Kennungen bleiben undefiniert", () => {
  const eintrag = calNormalisiereTermin({ start: { date: "2026-09-10" } });
  assert.strictEqual(eintrag.summary, "");
  assert.strictEqual(eintrag.description, "");
  assert.strictEqual(eintrag.location, "");
  assert.strictEqual(eintrag.dtend, "");
  // KEIN leerer String: `""` waere eine Kennung, die es nicht gibt. HA
  // uebergibt `uid` an `deleteCalendarEvent` — ein leerer String loeschte
  // nichts und meldete auch nichts.
  assert.strictEqual(eintrag.uid, undefined);
  assert.strictEqual(eintrag.recurrence_id, undefined);
  assert.strictEqual(eintrag.rrule, undefined);
});

test("die interne Kennzeichnung der Karte wandert nicht in die Form", () => {
  const eintrag = calNormalisiereTermin({
    uid: "u1",
    start: { date: "2026-09-10" },
    _entity: "calendar.a",
    _idx: 3,
  });
  assert.strictEqual(eintrag._entity, undefined);
  assert.strictEqual(eintrag._idx, undefined);
});

/* ------------------------------------------------------------------------
 * 2. Die Berechtigungen
 *
 * `supported_features` der Kalender-Entitaet, Bitmaske:
 * 1 = anlegen, 2 = loeschen, 4 = aendern. Zum Abgleich:
 * `calendar.arbeitszeiten` hat in der Anlage des Nutzers 7 — kann also alles.
 * ---------------------------------------------------------------------- */

function zustand(merkmale) {
  return merkmale === undefined
    ? { attributes: {} }
    : { attributes: { supported_features: merkmale } };
}

test("7 heisst: aendern und loeschen sind beide erlaubt", () => {
  const r = calBerechtigungen(zustand(7));
  assert.strictEqual(r.canEdit, true);
  assert.strictEqual(r.canDelete, true);
});

test("die einzelnen Bits werden auseinandergehalten", () => {
  assert.deepStrictEqual(
    { ...calBerechtigungen(zustand(1)) },
    { canEdit: false, canDelete: false },
    "1 ist nur anlegen"
  );
  assert.deepStrictEqual(
    { ...calBerechtigungen(zustand(2)) },
    { canEdit: false, canDelete: true }
  );
  assert.deepStrictEqual(
    { ...calBerechtigungen(zustand(4)) },
    { canEdit: true, canDelete: false }
  );
  assert.deepStrictEqual(
    { ...calBerechtigungen(zustand(6)) },
    { canEdit: true, canDelete: true }
  );
});

test("ohne Zustand oder ohne Merkmale ist nichts erlaubt — nicht geraten", () => {
  for (const z of [undefined, null, {}, zustand(), zustand(0), zustand("kaputt")]) {
    const r = calBerechtigungen(z);
    assert.strictEqual(r.canEdit, false, `canEdit bei ${JSON.stringify(z)}`);
    assert.strictEqual(r.canDelete, false, `canDelete bei ${JSON.stringify(z)}`);
  }
});

/* ------------------------------------------------------------------------
 * 3. Vom Klick zurueck zum Termin
 *
 * Die Zeile im HTML traegt `data-idx`, `data-uid`, `data-entity` und
 * `data-rid`. Der Index ist der schnelle Weg; Kennung und Kalender sind die
 * Gegenprobe, damit ein veralteter Index nicht den FALSCHEN Termin oeffnet.
 * ---------------------------------------------------------------------- */

const T = (uid, entity, idx, rid) => ({
  uid,
  _entity: entity,
  _idx: idx,
  recurrence_id: rid,
  start: { dateTime: "2026-09-04T10:00:00" },
});

test("der Index trifft den Termin direkt", () => {
  const liste = [T("a", "calendar.a", 0), T("b", "calendar.a", 1)];
  const treffer = calTerminAusZeile(liste, { idx: "1", uid: "b", entity: "calendar.a" });
  assert.strictEqual(treffer, liste[1]);
});

test("ein veralteter Index oeffnet nicht den falschen Termin", () => {
  const liste = [T("a", "calendar.a", 0), T("b", "calendar.a", 1)];
  // Der Index zeigt auf „a", die Zeile meint aber „b" — Kennung schlaegt Index.
  const treffer = calTerminAusZeile(liste, { idx: "0", uid: "b", entity: "calendar.a" });
  assert.strictEqual(treffer, liste[1]);
});

test("dieselbe Kennung in zwei Kalendern wird am Kalender getrennt", () => {
  const liste = [T("gleich", "calendar.a", 0), T("gleich", "calendar.b", 1)];
  const treffer = calTerminAusZeile(liste, { idx: "99", uid: "gleich", entity: "calendar.b" });
  assert.strictEqual(treffer, liste[1]);
});

test("zwei Wiederholungen mit derselben Kennung trennt die Wiederholungskennung", () => {
  const liste = [
    T("serie", "calendar.a", 0, "20260904T100000"),
    T("serie", "calendar.a", 1, "20260911T100000"),
  ];
  const treffer = calTerminAusZeile(liste, {
    idx: "",
    uid: "serie",
    entity: "calendar.a",
    rid: "20260911T100000",
  });
  assert.strictEqual(treffer, liste[1]);
});

test("findet sich nichts, ist die Antwort null und kein zufaelliger Termin", () => {
  const liste = [T("a", "calendar.a", 0)];
  assert.strictEqual(calTerminAusZeile(liste, { idx: "0", uid: "x", entity: "calendar.a" }), null);
  assert.strictEqual(calTerminAusZeile(liste, { idx: "0", uid: "a", entity: "calendar.z" }), null);
  assert.strictEqual(calTerminAusZeile([], { idx: "0", uid: "a", entity: "calendar.a" }), null);
  assert.strictEqual(calTerminAusZeile(undefined, { uid: "a", entity: "calendar.a" }), null);
  assert.strictEqual(calTerminAusZeile([T("a", "calendar.a", 0)], undefined), null);
});

/* ------------------------------------------------------------------------
 * 4. Die Dialogparameter
 * ---------------------------------------------------------------------- */

test("die Parameter tragen alles, was HAs Dialog braucht", () => {
  const p = calDialogParameter(
    "calendar.arbeitszeiten",
    {
      uid: "abc",
      summary: "Spaetdienst",
      recurrence_id: "20260904T100000",
      rrule: "FREQ=WEEKLY",
      start: { dateTime: "2026-09-04T14:00:00" },
      end: { dateTime: "2026-09-04T22:00:00" },
    },
    "#3f6fb5",
    zustand(7)
  );
  assert.strictEqual(p.calendarId, "calendar.arbeitszeiten");
  assert.strictEqual(p.color, "#3f6fb5");
  assert.strictEqual(p.canEdit, true);
  assert.strictEqual(p.canDelete, true);
  assert.strictEqual(p.entry.uid, "abc");
  assert.strictEqual(p.entry.dtstart, "2026-09-04T14:00:00");
  assert.strictEqual(p.entry.rrule, "FREQ=WEEKLY");
  assert.strictEqual(p.entry.recurrence_id, "20260904T100000");
});

test("ohne Kennung gibt es keine Parameter — der Dialog waere zum Bearbeiten kaputt", () => {
  const ohneUid = calDialogParameter(
    "calendar.a",
    { summary: "namenlos", start: { date: "2026-09-04" } },
    "#000",
    zustand(7)
  );
  assert.strictEqual(ohneUid, null);
  assert.strictEqual(calDialogParameter("calendar.a", null, "#000", zustand(7)), null);
});

test("eine Entitaet ohne Rechte ergibt einen reinen Anzeigedialog", () => {
  const p = calDialogParameter(
    "calendar.nurlesen",
    { uid: "abc", start: { date: "2026-09-04" } },
    "#000",
    zustand(0)
  );
  assert.strictEqual(p.canEdit, false);
  assert.strictEqual(p.canDelete, false);
});

test("der Dialogname ist der von Home Assistant ausgelieferte", () => {
  assert.strictEqual(CAL_DIALOG_TAG, "dialog-calendar-event-detail");
});

/* ------------------------------------------------------------------------
 * 5. Der Rueckfall an der laufenden Karte
 *
 * Die eiserne Regel: NIEMALS ein toter Klick. Scheitert irgendein Schritt
 * des Sondenwegs, oeffnet der Klick weiterhin den Info-Dialog der
 * Kalender-Entitaet — genau wie bis v0.8.0.
 * ---------------------------------------------------------------------- */

/**
 * Eine DOM-Attrappe, die zusaetzlich `dispatchEvent` mitschreibt. Was der
 * Sondenweg braucht (`window.loadCardHelpers`, `customElements.whenDefined`),
 * wird je Test EINZELN zugegeben — so ist an jedem Test ablesbar, welcher
 * Schritt gerade fehlt.
 */
function attrappe(umgebung) {
  const ereignisse = [];
  const machElement = () => ({
    style: {},
    innerHTML: "",
    textContent: "",
    kinder: [],
    setAttribute() {},
    addEventListener() {},
    appendChild(kind) {
      this.kinder.push(kind);
    },
  });
  const zusatz = {
    HTMLElement: class {
      constructor() {
        this.kinder = [];
      }
      appendChild(kind) {
        this.kinder.push(kind);
      }
      dispatchEvent(ereignis) {
        ereignisse.push(ereignis);
        return true;
      }
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = (init || {}).detail;
      }
    },
    document: { createElement: machElement },
    window: { customCards: [] },
    ...(umgebung || {}),
  };
  return { zusatz, ereignisse };
}

function terminImMonat(zusatzfelder) {
  const jetzt = new Date();
  const von = new Date(jetzt.getFullYear(), jetzt.getMonth(), 5, 10, 0, 0);
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), 5, 11, 0, 0);
  return {
    uid: "gut",
    summary: "Zahnarzt",
    start: { dateTime: von.toISOString() },
    end: { dateTime: bis.toISOString() },
    ...(zusatzfelder || {}),
  };
}

function ruhe() {
  return new Promise((fertig) => setImmediate(fertig));
}

async function bauKarte(umgebung, konfig) {
  const { zusatz, ereignisse } = attrappe(umgebung);
  const { BuschCalendarCard } = ladeKarte(["BuschCalendarCard"], zusatz);
  const karte = new BuschCalendarCard();
  karte.setConfig({ entities: ["calendar.a"], ...(konfig || {}) });
  karte.hass = {
    locale: { language: "de-DE" },
    states: {
      "calendar.a": { last_changed: "1", attributes: { supported_features: 7 } },
    },
    callApi: async () => [terminImMonat()],
  };
  await ruhe();
  return { karte, ereignisse };
}

test("die geladene Zeile traegt Index, Kennung und Kalender", async () => {
  const { karte } = await bauKarte();
  assert.strictEqual(karte._alleTermine[0]._idx, 0, "der Index wird beim Laden gesetzt");
  const html = karte._koerper.innerHTML;
  assert.match(html, /data-idx="0"/);
  assert.match(html, /data-uid="gut"/);
  assert.match(html, /data-entity="calendar\.a"/);
});

test("ohne loadCardHelpers oeffnet der Klick den Entitaets-Dialog", async () => {
  // `window` hat hier bewusst KEIN `loadCardHelpers` — genau der Fall einer
  // Home-Assistant-Version, die die Helfer nicht hergibt.
  const { karte, ereignisse } = await bauKarte();
  await karte._oeffneTermin({ idx: "0", uid: "gut", entity: "calendar.a", rid: "" });
  assert.strictEqual(ereignisse.length, 1, "genau ein Ereignis, kein toter Klick");
  assert.strictEqual(ereignisse[0].type, "hass-more-info");
  assert.strictEqual(ereignisse[0].detail.entityId, "calendar.a");
});

test("eine Sonde ohne `_handleEventClick` faellt ebenfalls sauber zurueck", async () => {
  // Die Helfer sind da, `ha-full-calendar` gilt als definiert — aber das
  // Element kennt die Klickbehandlung nicht (umbenannt, andere HA-Version).
  const { karte, ereignisse } = await bauKarte({
    window: {
      customCards: [],
      loadCardHelpers: async () => ({ createCardElement: async () => ({}) }),
    },
    customElements: { define() {}, whenDefined: async () => {} },
  });
  await karte._oeffneTermin({ idx: "0", uid: "gut", entity: "calendar.a", rid: "" });
  assert.strictEqual(ereignisse.length, 1);
  assert.strictEqual(ereignisse[0].type, "hass-more-info");
});

test("werfen die Helfer, bleibt es beim Entitaets-Dialog", async () => {
  const { karte, ereignisse } = await bauKarte({
    window: {
      customCards: [],
      loadCardHelpers: async () => {
        throw new Error("kaputt");
      },
    },
    customElements: { define() {}, whenDefined: async () => {} },
  });
  await karte._oeffneTermin({ idx: "0", uid: "gut", entity: "calendar.a", rid: "" });
  assert.strictEqual(ereignisse.length, 1);
  assert.strictEqual(ereignisse[0].type, "hass-more-info");
});

test("der Sondenweg wird nur EINMAL versucht, nicht bei jedem Klick", async () => {
  let versuche = 0;
  const { karte } = await bauKarte({
    window: {
      customCards: [],
      loadCardHelpers: async () => {
        versuche += 1;
        throw new Error("kaputt");
      },
    },
    customElements: { define() {}, whenDefined: async () => {} },
  });
  const zeile = { idx: "0", uid: "gut", entity: "calendar.a", rid: "" };
  await karte._oeffneTermin(zeile);
  await karte._oeffneTermin(zeile);
  await karte._oeffneTermin(zeile);
  assert.strictEqual(versuche, 1, "gescheitert ist gescheitert — kein Nachbohren je Klick");
});

test("ist der Schalter aus, passiert gar nichts", async () => {
  const { karte, ereignisse } = await bauKarte(undefined, { open_event_on_tap: false });
  await karte._oeffneTermin({ idx: "0", uid: "gut", entity: "calendar.a", rid: "" });
  assert.strictEqual(ereignisse.length, 0);
});

test("eine Zeile ohne Kalender loest kein Ereignis aus", async () => {
  const { karte, ereignisse } = await bauKarte();
  await karte._oeffneTermin({ idx: "0", uid: "gut", entity: "", rid: "" });
  assert.strictEqual(ereignisse.length, 0);
});

test("die Beschriftung im Editor spricht vom Termin, nicht vom Kalender", () => {
  // Seit 09.09.2026 stehen die Beschriftungen im Woerterbuch der Karte
  // (`docs/ui-regeln.md`, Regel 3) — deutsch UND englisch.
  const { TEXTE_BUSCH_CALENDAR_CARD } = ladeKarte(["TEXTE_BUSCH_CALENDAR_CARD"]);
  assert.match(TEXTE_BUSCH_CALENDAR_CARD.de.labels.open_event_on_tap, /Termin/);
  assert.doesNotMatch(
    TEXTE_BUSCH_CALENDAR_CARD.de.labels.open_event_on_tap,
    /Kalender/,
    "die alte Beschriftung versprach den Kalender-Dialog"
  );
  assert.match(TEXTE_BUSCH_CALENDAR_CARD.en.labels.open_event_on_tap, /event/i);
  assert.doesNotMatch(
    TEXTE_BUSCH_CALENDAR_CARD.en.labels.open_event_on_tap,
    /calendar/i
  );
});
