"use strict";

/* ────────────────────────────────────────────────────────────────────────────
 * Der Editor-Dialog und die Stufenwahl
 *
 * Ab v0.8.2 oeffnet ein Klick nicht mehr die ANSICHT eines Termins, sondern
 * direkt HAs Editor (`dialog-calendar-event-editor`) mit den Eingabefeldern.
 * Weil das nicht immer geht, gibt es drei Stufen, und jede faellt auf die
 * naechste:
 *
 *   1. Editor        — direkt in die Eingabefelder
 *   2. Ansicht       — der Stand von v0.8.1, mit Knoepfen zum Bearbeiten
 *   3. Entitaet      — HAs Info-Dialog der Kalender-Entitaet
 *
 * WAS HIER BELEGT WIRD: die Stufenwahl (welche Stufe bei welcher Lage), der
 * Serienschutz, die Berechtigungspruefung, die neue Option samt Standardwert,
 * und dass eine Stufe, die zur Laufzeit wirft, auf die naechste faellt.
 *
 * WAS HIER NICHT BELEGT WIRD: der Sondenweg, mit dem die beiden Ladefunktionen
 * abgegriffen werden — und darin besonders die `_activeView`-Falle. Der
 * braucht HAs echtes Frontend. Statt ihn nachzubauen, setzen die Kartentests
 * unten das GEMERKTE Ergebnis der Sonde (`calDialogVersuch`) vor: das ist der
 * Zustand nach der Sonde, nicht die Sonde selbst.
 * ────────────────────────────────────────────────────────────────────────── */

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calStufeWaehlen,
  calStufenFolge,
  calAendertGanzeSerie,
  calEditorParameter,
  CAL_STUFE_EDITOR,
  CAL_STUFE_ANSICHT,
  CAL_STUFE_ENTITAET,
  CAL_EDITOR_DIALOG_TAG,
  CAL_DIALOG_TAG,
  CAL_STANDARD,
} = ladeKarte([
  "calStufeWaehlen",
  "calStufenFolge",
  "calAendertGanzeSerie",
  "calEditorParameter",
  "CAL_STUFE_EDITOR",
  "CAL_STUFE_ANSICHT",
  "CAL_STUFE_ENTITAET",
  "CAL_EDITOR_DIALOG_TAG",
  "CAL_DIALOG_TAG",
  "CAL_STANDARD",
]);

/** Eine Lage, in der die oberste Stufe erlaubt waere. Jeder Test verdreht
 *  davon genau EIN Feld — so ist ablesbar, woran die Stufe haengt. */
function lage(abweichung) {
  return {
    editOnTap: true,
    hatEditorImport: true,
    hatAnsichtImport: true,
    rechte: { canEdit: true, canDelete: true },
    eintrag: { uid: "abc", dtstart: "2026-09-04T10:00:00" },
    ...(abweichung || {}),
  };
}

/* ------------------------------------------------------------------------
 * 1. Die Namen der Stufen und der Dialoge
 * ---------------------------------------------------------------------- */

test("der Editor-Dialog heisst so, wie HA ihn ausliefert", () => {
  assert.strictEqual(CAL_EDITOR_DIALOG_TAG, "dialog-calendar-event-editor");
  assert.notStrictEqual(CAL_EDITOR_DIALOG_TAG, CAL_DIALOG_TAG);
});

/* ------------------------------------------------------------------------
 * 2. Die Stufenwahl
 * ---------------------------------------------------------------------- */

test("ist alles erlaubt und erreichbar, oeffnet der Klick den Editor", () => {
  assert.strictEqual(calStufeWaehlen(lage()), CAL_STUFE_EDITOR);
});

test("ohne abgegriffene Editor-Ladefunktion bleibt es bei der Ansicht", () => {
  // Belegt am ausgelieferten Buendel: ein einmal geoeffneter Ansichtsdialog
  // registriert den Editor NICHT mit. Ohne Ladefunktion bringt ein Ereignis
  // mit dem Editor-Namen gar nichts — also gar nicht erst feuern.
  assert.strictEqual(
    calStufeWaehlen(lage({ hatEditorImport: false })),
    CAL_STUFE_ANSICHT
  );
});

test("fehlen BEIDE Ladefunktionen, bleibt nur der Entitaets-Dialog", () => {
  assert.strictEqual(
    calStufeWaehlen(lage({ hatEditorImport: false, hatAnsichtImport: false })),
    CAL_STUFE_ENTITAET
  );
});

test("ohne Kennung gibt es keinen der beiden Dialoge", () => {
  // Beide brauchen `uid`; ohne sie liefen Speichern und Loeschen ins Leere.
  assert.strictEqual(calStufeWaehlen(lage({ eintrag: { dtstart: "x" } })), CAL_STUFE_ENTITAET);
  assert.strictEqual(calStufeWaehlen(lage({ eintrag: null })), CAL_STUFE_ENTITAET);
  assert.strictEqual(calStufeWaehlen(undefined), CAL_STUFE_ENTITAET);
});

/* ------------------------------------------------------------------------
 * 3. Die Berechtigung — der Editor prueft sie NICHT selbst
 *
 * Am ausgelieferten Buendel nachgelesen: `dialog-calendar-event-editor`
 * kennt kein `canEdit` und prueft die Aenderungsberechtigung nirgends. Die
 * Karte muss es tun, sonst zeigt sie Eingabefelder fuer einen Kalender, der
 * die Aenderung hinterher ablehnt.
 * ---------------------------------------------------------------------- */

test("ohne Bit 4 wird der Editor nicht geoeffnet, sondern die Ansicht", () => {
  assert.strictEqual(
    calStufeWaehlen(lage({ rechte: { canEdit: false, canDelete: true } })),
    CAL_STUFE_ANSICHT
  );
});

test("fehlen die Rechte ganz, gilt das als nicht erlaubt", () => {
  assert.strictEqual(calStufeWaehlen(lage({ rechte: undefined })), CAL_STUFE_ANSICHT);
});

/* ------------------------------------------------------------------------
 * 4. Der Serienschutz
 *
 * Fehlt bei einem wiederkehrenden Termin die Instanzkennung
 * `recurrence_id`, sendet der Editor beim Speichern einen LEEREN String —
 * und das bedeutet „alle Vorkommen". Der Nutzer bekommt keine Rueckfrage,
 * weil die Rueckfrage genau an dieser Kennung haengt. Ein stillschweigend
 * geaenderter Serientermin ist ein Datenverlust, den niemand bemerkt.
 *
 * Ob HA fuer gewoehnliche Instanzen einer Serie ueberhaupt eine eigene
 * Kennung liefert, ist UNBELEGT. Deshalb: Wiederholungsregel ohne
 * Instanzkennung → Ansichtsdialog, der stellt die Rueckfrage korrekt.
 * ---------------------------------------------------------------------- */

test("ein Serientermin OHNE Instanzkennung geht nie in den Editor", () => {
  const eintrag = { uid: "serie", dtstart: "x", rrule: "FREQ=WEEKLY" };
  assert.strictEqual(calAendertGanzeSerie(eintrag), true);
  assert.strictEqual(calStufeWaehlen(lage({ eintrag })), CAL_STUFE_ANSICHT);
});

test("ein Serientermin MIT Instanzkennung darf in den Editor", () => {
  const eintrag = {
    uid: "serie",
    dtstart: "x",
    rrule: "FREQ=WEEKLY",
    recurrence_id: "20260904T100000",
  };
  assert.strictEqual(calAendertGanzeSerie(eintrag), false);
  assert.strictEqual(calStufeWaehlen(lage({ eintrag })), CAL_STUFE_EDITOR);
});

test("ein Einzeltermin ohne Wiederholungsregel ist keine Serie", () => {
  assert.strictEqual(calAendertGanzeSerie({ uid: "a", dtstart: "x" }), false);
  assert.strictEqual(calAendertGanzeSerie({ uid: "a", rrule: "" }), false);
  assert.strictEqual(calAendertGanzeSerie(null), false);
});

test("der Serienschutz greift auch dann, wenn alles andere erlaubt waere", () => {
  // Genau die Lage, in der ein Fehler unbemerkt bliebe: volle Rechte, beide
  // Ladefunktionen da, Schalter an — und trotzdem nur die Ansicht.
  const eintrag = { uid: "serie", dtstart: "x", rrule: "FREQ=DAILY;COUNT=10" };
  assert.strictEqual(calStufeWaehlen(lage({ eintrag })), CAL_STUFE_ANSICHT);
});

/* ------------------------------------------------------------------------
 * 5. Die neue Option `edit_on_tap`
 * ---------------------------------------------------------------------- */

test("`edit_on_tap` ist standardmaessig an", () => {
  assert.strictEqual(CAL_STANDARD.edit_on_tap, true);
});

test("ist `edit_on_tap` aus, bleibt es beim Ansichtsdialog wie in v0.8.1", () => {
  assert.strictEqual(calStufeWaehlen(lage({ editOnTap: false })), CAL_STUFE_ANSICHT);
});

test("`edit_on_tap` aus schaltet den Klick NICHT ab — dafuer gibt es die andere Option", () => {
  assert.notStrictEqual(calStufeWaehlen(lage({ editOnTap: false })), CAL_STUFE_ENTITAET);
});

/* ------------------------------------------------------------------------
 * 6. Die Stufenfolge — jede Stufe faellt auf die naechste
 * ---------------------------------------------------------------------- */

test("die Folge ab einer Stufe enthaelt alle darunter, in Reihenfolge", () => {
  // `Array.from`, weil die Karte in einer eigenen VM-Welt laeuft: ihre Arrays
  // haben einen anderen Prototyp, und `deepStrictEqual` vergleicht den mit.
  const folge = (stufe) => Array.from(calStufenFolge(stufe));
  assert.deepStrictEqual(folge(CAL_STUFE_EDITOR), [
    CAL_STUFE_EDITOR,
    CAL_STUFE_ANSICHT,
    CAL_STUFE_ENTITAET,
  ]);
  assert.deepStrictEqual(folge(CAL_STUFE_ANSICHT), [CAL_STUFE_ANSICHT, CAL_STUFE_ENTITAET]);
  assert.deepStrictEqual(folge(CAL_STUFE_ENTITAET), [CAL_STUFE_ENTITAET]);
});

test("jede Folge endet am Entitaets-Dialog — nie an einem toten Klick", () => {
  for (const stufe of [CAL_STUFE_EDITOR, CAL_STUFE_ANSICHT, CAL_STUFE_ENTITAET, "unsinn"]) {
    const folge = calStufenFolge(stufe);
    assert.strictEqual(folge[folge.length - 1], CAL_STUFE_ENTITAET, `Folge ab ${stufe}`);
  }
});

/* ------------------------------------------------------------------------
 * 7. Die Editor-Parameter
 *
 * Vertrag am Buendel: `{ calendarId?, selectedDate?, entry?, canDelete?,
 * updated }`. Pflicht ist genau EIN Feld: `updated` — es wird nach jedem
 * Erfolg unbedingt abgewartet, und fehlt es, wirft der Dialog nach dem
 * Speichern. `updated` haengt die Karte an, weil es an ihre Instanz gebunden
 * ist; alles andere baut diese Funktion.
 * ---------------------------------------------------------------------- */

function zustand(merkmale) {
  return { attributes: { supported_features: merkmale } };
}

test("die Editor-Parameter tragen Kalender, Eintrag und Loeschrecht", () => {
  const p = calEditorParameter(
    "calendar.arbeitszeiten",
    {
      uid: "abc",
      summary: "Spaetdienst",
      start: { dateTime: "2026-09-04T14:00:00" },
      end: { dateTime: "2026-09-04T22:00:00" },
    },
    zustand(7)
  );
  assert.strictEqual(p.calendarId, "calendar.arbeitszeiten");
  assert.strictEqual(p.canDelete, true);
  assert.strictEqual(p.entry.uid, "abc");
  assert.strictEqual(p.entry.dtstart, "2026-09-04T14:00:00");
  assert.strictEqual(p.entry.summary, "Spaetdienst");
});

test("`canEdit` steht NICHT in den Editor-Parametern", () => {
  // Der Editor kennt das Feld nicht. Es dort hineinzuschreiben, waere ein
  // Versprechen, das niemand einloest — die Pruefung macht die Karte.
  const p = calEditorParameter("calendar.a", { uid: "a", start: { date: "2026-09-04" } }, zustand(7));
  assert.strictEqual("canEdit" in p, false);
});

test("ohne Kennung gibt es keine Editor-Parameter", () => {
  assert.strictEqual(
    calEditorParameter("calendar.a", { start: { date: "2026-09-04" } }, zustand(7)),
    null
  );
  assert.strictEqual(calEditorParameter("calendar.a", null, zustand(7)), null);
});

/* ------------------------------------------------------------------------
 * 8. Die Karte: welche Stufe wirklich gefeuert wird
 *
 * `calDialogVersuch` — die gemerkte Zusage der EINEN Sonde — wird vorbelegt.
 * Damit ist der Zustand NACH der Sonde gesetzt, ohne die Sonde nachzubauen.
 * ---------------------------------------------------------------------- */

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
        if (this._wirftBei && this._wirftBei(ereignis)) {
          throw new Error("Dialog liess sich nicht oeffnen");
        }
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

/**
 * Baut die Karte mit vorbelegter Sonden-Zusage.
 * `importe` sagt, welche der beiden Ladefunktionen als abgegriffen gilt.
 */
async function bauKarte(optionen) {
  const o = optionen || {};
  const { zusatz, ereignisse } = attrappe();
  zusatz.__pruefImporte = {
    ansicht: o.ansicht === false ? null : () => Promise.resolve(),
    editor: o.editor === false ? null : () => Promise.resolve(),
  };
  const { BuschCalendarCard } = ladeKarte(
    ["BuschCalendarCard"],
    zusatz,
    "calDialogVersuch = Promise.resolve(__pruefImporte);"
  );
  const karte = new BuschCalendarCard();
  karte.setConfig({ entities: ["calendar.a"], ...(o.konfig || {}) });
  if (o.wirftBei) karte._wirftBei = o.wirftBei;
  karte.hass = {
    locale: { language: "de-DE" },
    states: {
      "calendar.a": {
        last_changed: "1",
        attributes: { supported_features: o.merkmale === undefined ? 7 : o.merkmale },
      },
    },
    callApi: async () => [terminImMonat(o.termin)],
  };
  await ruhe();
  return { karte, ereignisse };
}

const ZEILE = { idx: "0", uid: "gut", entity: "calendar.a", rid: "" };

function dialogNamen(ereignisse) {
  return ereignisse.map((e) =>
    e.type === "show-dialog" ? e.detail.dialogTag : e.type
  );
}

test("Stufe 1: der Klick oeffnet den Editor", async () => {
  const { karte, ereignisse } = await bauKarte();
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_EDITOR_DIALOG_TAG]);
  const p = ereignisse[0].detail.dialogParams;
  assert.strictEqual(p.calendarId, "calendar.a");
  assert.strictEqual(p.entry.uid, "gut");
  assert.strictEqual(typeof p.updated, "function", "ohne `updated` wirft der Dialog");
});

test("Stufe 2: ohne Editor-Ladefunktion kommt der Ansichtsdialog", async () => {
  const { karte, ereignisse } = await bauKarte({ editor: false });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_DIALOG_TAG]);
});

test("Stufe 3: ohne beide Ladefunktionen kommt der Entitaets-Dialog", async () => {
  const { karte, ereignisse } = await bauKarte({ editor: false, ansicht: false });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), ["hass-more-info"]);
});

test("ohne Bit 4 nimmt die Karte Stufe 2, obwohl der Editor da waere", async () => {
  const { karte, ereignisse } = await bauKarte({ merkmale: 2 });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_DIALOG_TAG]);
});

test("ein Serientermin ohne Instanzkennung nimmt Stufe 2", async () => {
  const { karte, ereignisse } = await bauKarte({ termin: { rrule: "FREQ=WEEKLY" } });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_DIALOG_TAG]);
});

test("ein Serientermin MIT Instanzkennung nimmt Stufe 1", async () => {
  const { karte, ereignisse } = await bauKarte({
    termin: { rrule: "FREQ=WEEKLY", recurrence_id: "20260905T100000" },
  });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_EDITOR_DIALOG_TAG]);
});

test("`edit_on_tap: false` laesst es beim Ansichtsdialog von v0.8.1", async () => {
  const { karte, ereignisse } = await bauKarte({ konfig: { edit_on_tap: false } });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_DIALOG_TAG]);
});

test("wirft der Editor beim Oeffnen, faellt die Karte auf die Ansicht", async () => {
  const { karte, ereignisse } = await bauKarte({
    wirftBei: (e) => e.type === "show-dialog" && e.detail.dialogTag === CAL_EDITOR_DIALOG_TAG,
  });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [CAL_EDITOR_DIALOG_TAG, CAL_DIALOG_TAG]);
});

test("werfen BEIDE Dialoge, bleibt der Entitaets-Dialog", async () => {
  const { karte, ereignisse } = await bauKarte({
    wirftBei: (e) => e.type === "show-dialog",
  });
  await karte._oeffneTermin(ZEILE);
  assert.deepStrictEqual(dialogNamen(ereignisse), [
    CAL_EDITOR_DIALOG_TAG,
    CAL_DIALOG_TAG,
    "hass-more-info",
  ]);
});

test("`open_event_on_tap: false` schaltet den Klick ganz ab", async () => {
  const { karte, ereignisse } = await bauKarte({ konfig: { open_event_on_tap: false } });
  await karte._oeffneTermin(ZEILE);
  assert.strictEqual(ereignisse.length, 0);
});

/* ------------------------------------------------------------------------
 * 9. Die Option im Karteneditor
 * ---------------------------------------------------------------------- */

test("`edit_on_tap` steht im Schema und hat eine deutsche Beschriftung", () => {
  const { CAL_CARD_SCHEMA, CAL_LABELS } = ladeKarte(["CAL_CARD_SCHEMA", "CAL_LABELS"]);
  const namen = [];
  const sammle = (schema) => {
    for (const e of schema) {
      if (Array.isArray(e.schema)) sammle(e.schema);
      else if (e.name) namen.push(e.name);
    }
  };
  sammle(CAL_CARD_SCHEMA);
  assert.ok(namen.includes("edit_on_tap"), "die Option fehlt im Schema");
  assert.match(CAL_LABELS.edit_on_tap, /[Bb]earbeiten/);
});
