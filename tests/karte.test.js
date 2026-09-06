"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calNormalisiereKonfig,
  calPalette,
  calZaehleNichtGezeigt,
  calHinweisText,
  calMonatsGrenzen,
  calGruppiereNachTag,
} = ladeKarte([
  "calNormalisiereKonfig",
  "calPalette",
  "calZaehleNichtGezeigt",
  "calHinweisText",
  "calMonatsGrenzen",
  "calGruppiereNachTag",
]);

test("eine Liste aus Zeichenketten wird zu Objekten mit Palettenfarbe", () => {
  const k = calNormalisiereKonfig({ entities: ["calendar.a", "calendar.b"] });
  assert.strictEqual(k.entities.length, 2);
  assert.strictEqual(k.entities[0].entity, "calendar.a");
  assert.strictEqual(k.entities[0].color, calPalette[0]);
  assert.strictEqual(k.entities[1].color, calPalette[1]);
});

test("eine eigene Farbe schlaegt die Palette", () => {
  const k = calNormalisiereKonfig({
    entities: [{ entity: "calendar.a", color: "#ff0000" }],
  });
  assert.strictEqual(k.entities[0].color, "#ff0000");
});

test("die Palette wiederholt sich bei vielen Kalendern", () => {
  const viele = Array.from({ length: 8 }, (_, i) => `calendar.k${i}`);
  const k = calNormalisiereKonfig({ entities: viele });
  assert.strictEqual(k.entities[6].color, calPalette[0], "der siebte faengt vorne an");
});

test("die Standardwerte stimmen mit der Spec ueberein", () => {
  const k = calNormalisiereKonfig({ entities: [] });
  assert.strictEqual(k.month_offset, 0);
  assert.strictEqual(k.navigation, true);
  assert.strictEqual(k.show_empty_days, true);
  assert.strictEqual(k.show_total, false);
  assert.strictEqual(k.open_event_on_tap, true);
});

test("gesetzte Werte werden nicht ueberschrieben", () => {
  const k = calNormalisiereKonfig({
    entities: ["calendar.a"], month_offset: -1, navigation: false,
    show_empty_days: false, show_total: true, title: "Arbeitszeit",
  });
  assert.strictEqual(k.month_offset, -1);
  assert.strictEqual(k.navigation, false);
  assert.strictEqual(k.show_empty_days, false);
  assert.strictEqual(k.show_total, true);
  assert.strictEqual(k.title, "Arbeitszeit");
});

test("eine fehlende entities-Angabe ergibt eine leere Liste, keinen Absturz", () => {
  const k = calNormalisiereKonfig({});
  // ABWEICHUNG vom Auftragstext: dort steht `deepStrictEqual(k.entities, [])`.
  // Das kann NIE gruen werden, egal wie die Karte gebaut ist. Die Liste
  // entsteht in der vm-Sandbox und traegt deren `Array.prototype`;
  // `deepStrictEqual` vergleicht den Prototyp mit und meldet
  // "same structure but not reference-equal". Nachgemessen:
  // `Array.isArray` true, `length` 0, `getPrototypeOf(...) === Array.prototype`
  // false. Geprueft wird deshalb dasselbe realmuebergreifend.
  assert.ok(Array.isArray(k.entities), "es muss eine Liste sein");
  assert.strictEqual(k.entities.length, 0);
});

/* ------------------------------------------------------------------------
 * Uebersprungene Termine in der Hinweiszeile
 *
 * Die Zahl kommt seit v0.6.1 aus der TAGESSCHLEIFE selbst: geliefert minus
 * tatsaechlich platziert. Vorher bildete eine zweite Funktion die
 * Auslassbedingung von `calGruppiereNachTag` nach und zaehlte nur den
 * unlesbaren Start — alles, was aus einem anderen Grund aus der Liste fiel,
 * verschwand stillschweigend. Zwei Nachbildungen derselben Bedingung laufen
 * frueher oder spaeter auseinander; eine Differenz kann das nicht.
 * ---------------------------------------------------------------------- */

const SEPTEMBER = calMonatsGrenzen(new Date(2026, 8, 15), 0);

/** Zaehlt so, wie die Karte es tut: erst gruppieren, dann die Differenz. */
function nichtGezeigt(termine, grenzen) {
  const g = grenzen || SEPTEMBER;
  return calZaehleNichtGezeigt(termine, calGruppiereNachTag(termine, g.start, g.ende));
}

test("ein Termin ohne lesbares Startdatum wird gezaehlt", () => {
  const termine = [
    { start: { dateTime: "2026-09-04T10:00:00" }, end: { dateTime: "2026-09-04T11:00:00" } },
    { start: { dateTime: "morgen frueh" }, end: { dateTime: "2026-09-04T11:00:00" } },
    { start: { date: "kein Datum" } },
    { end: { dateTime: "2026-09-04T11:00:00" } },
    null,
  ];
  assert.strictEqual(nichtGezeigt(termine), 4);
});

test("gueltige Starts zaehlen nicht mit, ganztaegige eingeschlossen", () => {
  const termine = [
    { start: { date: "2026-09-04" }, end: { date: "2026-09-05" } },
    { start: { dateTime: "2026-09-04T10:00:00" } },
  ];
  assert.strictEqual(nichtGezeigt(termine), 0);
  assert.strictEqual(nichtGezeigt([]), 0);
  assert.strictEqual(calZaehleNichtGezeigt(undefined, []), 0);
});

test("auch was aus einem anderen Grund als dem Startdatum faellt, wird gezaehlt", () => {
  // Ein Termin, der ganz im Vormonat liegt: lesbares Datum, aber kein Tag im
  // gezeigten Monat. Die alte, nachgebildete Bedingung zaehlte ihn nicht —
  // er verschwand ohne ein Wort.
  const termine = [
    { uid: "a", start: { dateTime: "2026-09-04T10:00:00" }, end: { dateTime: "2026-09-04T11:00:00" } },
    { uid: "vormonat", start: { dateTime: "2026-08-04T10:00:00" }, end: { dateTime: "2026-08-04T11:00:00" } },
  ];
  assert.strictEqual(nichtGezeigt(termine), 1);
});

test("die Zahl deckt sich mit dem, was wirklich aus der Liste faellt", () => {
  const termine = [
    { uid: "a", start: { dateTime: "2026-09-04T10:00:00" }, end: { dateTime: "2026-09-04T11:00:00" } },
    { uid: "b", start: { date: "2026-09-06" }, end: { date: "2026-09-07" } },
    { uid: "c", start: { dateTime: "kaputt" }, end: { dateTime: "2026-09-08T11:00:00" } },
    { uid: "d", start: { date: "auch kaputt" } },
  ];
  const tage = calGruppiereNachTag(termine, SEPTEMBER.start, SEPTEMBER.ende);
  const gezeigt = new Set();
  for (const tag of tage) for (const t of tag.termine) gezeigt.add(t.uid);
  assert.strictEqual(gezeigt.size, 2, "nur a und b stehen im Monat");
  assert.strictEqual(
    gezeigt.size + calZaehleNichtGezeigt(termine, tage),
    termine.length,
    "gezaehlt wird genau das, was nicht dargestellt wird"
  );
});

test("die Hinweiszeile nennt die Zahl der uebersprungenen Termine", () => {
  const text = calHinweisText([], 3);
  assert.match(text, /3/, "die Zahl selbst muss dastehen");
  assert.match(text, /Termine/);
  assert.match(text, /nicht angezeigt/);
});

test("bei genau einem uebersprungenen Termin steht die Einzahl", () => {
  const text = calHinweisText([], 1);
  assert.match(text, /1 Termin ohne Tag im gezeigten Monat/);
  assert.doesNotMatch(text, /1 Termine/);
});

test("nicht erreichbarer Kalender und uebersprungene Termine stehen zusammen", () => {
  const text = calHinweisText(["calendar.a"], 2);
  assert.match(text, /calendar\.a/);
  assert.match(text, /2 Termine/);
});

test("ohne Fehler und ohne uebersprungene Termine bleibt die Zeile leer", () => {
  assert.strictEqual(calHinweisText([], 0), "");
  assert.strictEqual(calHinweisText(undefined, 0), "");
});

/* ------------------------------------------------------------------------
 * Die Kartenklasse selbst, mit einer DOM-Attrappe
 *
 * Bis hierher sind nur die beiden Funktionen belegt. Was noch fehlt, ist die
 * Verdrahtung: dass `_lade()` wirklich zaehlt und `_render()` die Zahl
 * wirklich in die Hinweiszeile schreibt. Dafuer reicht eine Attrappe, die
 * genau das kann, was die Klasse anfasst — `appendChild`, `addEventListener`,
 * `innerHTML`. Was sie NICHT belegt: wie ein Browser das Ergebnis darstellt.
 * ---------------------------------------------------------------------- */

function calAttrappe() {
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
  return {
    HTMLElement: class {
      constructor() {
        this.kinder = [];
      }
      appendChild(kind) {
        this.kinder.push(kind);
      }
    },
    document: { createElement: machElement },
  };
}

/** Ein Termin am 5. des laufenden Monats — der Monat, den die Karte holt. */
function calTerminImMonat(titel) {
  const jetzt = new Date();
  const von = new Date(jetzt.getFullYear(), jetzt.getMonth(), 5, 10, 0, 0);
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), 5, 11, 0, 0);
  return {
    uid: "gut",
    summary: titel || "Zahnarzt",
    start: { dateTime: von.toISOString() },
    end: { dateTime: bis.toISOString() },
  };
}

/** Wartet, bis die von `set hass` angestossene Ladung durch ist. */
function calRuhe() {
  return new Promise((fertig) => setImmediate(fertig));
}

function calBauKarte(callApi, entities, zusatz) {
  const { BuschCalendarCard } = ladeKarte(["BuschCalendarCard"], calAttrappe());
  const karte = new BuschCalendarCard();
  karte.setConfig({ entities: entities || ["calendar.a"], ...(zusatz || {}) });
  karte.hass = {
    locale: { language: "de-DE" },
    states: { "calendar.a": { last_changed: "1" }, "calendar.b": { last_changed: "1" } },
    callApi,
  };
  return karte;
}

test("die Hinweiszeile der laufenden Karte nennt die uebersprungenen Termine", async () => {
  const karte = calBauKarte(async () => [
    calTerminImMonat(),
    { uid: "x", start: { dateTime: "morgen frueh" } },
    { uid: "y", start: { date: "irgendwann" } },
  ]);
  await calRuhe();
  const html = karte._koerper.innerHTML;
  assert.match(html, /cal-hinweis/, "die Zeile muss ueberhaupt da sein");
  assert.match(html, /2 Termine ohne Tag im gezeigten Monat, nicht angezeigt/);
  assert.match(html, /Zahnarzt/, "der lesbare Termin steht weiterhin in der Liste");
});

test("ohne kaputte Termine gibt es gar keine Hinweiszeile", async () => {
  const karte = calBauKarte(async () => [calTerminImMonat()]);
  await calRuhe();
  assert.doesNotMatch(karte._koerper.innerHTML, /cal-hinweis/);
});

test("nicht erreichbarer Kalender und uebersprungene Termine in einer Zeile", async () => {
  const karte = calBauKarte(
    async (verb, pfad) => {
      if (pfad.includes("calendar.b")) throw new Error("kaputt");
      return [calTerminImMonat(), { uid: "x", start: { dateTime: "nie" } }];
    },
    ["calendar.a", "calendar.b"]
  );
  await calRuhe();
  const html = karte._koerper.innerHTML;
  assert.match(html, /Nicht erreichbar: calendar\.b/);
  assert.match(html, /1 Termin ohne Tag im gezeigten Monat/);
  assert.match(html, /Zahnarzt/, "der erreichbare Kalender wird nicht mitgerissen");
});

test("beim Blaettern bleibt die alte Liste stehen, sie blitzt nicht leer", async () => {
  let antwort = [calTerminImMonat()];
  const karte = calBauKarte(async () => antwort);
  await calRuhe();
  assert.match(karte._koerper.innerHTML, /Zahnarzt/);

  const vorherigerVersatz = karte._versatzLaufend;
  antwort = [];
  karte._blaettern(1);
  // Direkt nach dem Klick, VOR der Antwort des naechsten Monats:
  assert.strictEqual(karte._versatzLaufend, vorherigerVersatz + 1, "der Monat ist weiter");
  assert.doesNotMatch(karte._koerper.innerHTML, /Wird geladen/);
  assert.match(karte._koerper.innerHTML, /Zahnarzt/, "die alte Liste steht noch");
  await calRuhe();
  assert.doesNotMatch(karte._koerper.innerHTML, /Zahnarzt/, "danach ist der neue Monat da");
});

test("der Blaetterzustand wandert nicht in die Konfiguration", async () => {
  const karte = calBauKarte(async () => []);
  await calRuhe();
  karte._blaettern(1);
  karte._blaettern(1);
  await calRuhe();
  assert.strictEqual(karte._versatzLaufend, 2);
  assert.strictEqual(karte._config.month_offset, 0, "die Konfiguration bleibt unberuehrt");
});

test("ein mehrtaegiger Termin bekommt kein Feld ans Original geheftet", async () => {
  const jetzt = new Date();
  const original = {
    uid: "urlaub",
    summary: "Urlaub",
    start: { date: calIsoTag(new Date(jetzt.getFullYear(), jetzt.getMonth(), 5)) },
    end: { date: calIsoTag(new Date(jetzt.getFullYear(), jetzt.getMonth(), 8)) },
  };
  const karte = calBauKarte(async () => [original]);
  await calRuhe();
  assert.strictEqual(original._entity, undefined, "das Original bleibt unangetastet");
  const tage = karte._tage.filter((t) => t.termine.length);
  assert.strictEqual(tage.length, 3, "der Termin steht an drei Tagen");
  const objekte = new Set(tage.map((t) => t.termine[0]));
  assert.strictEqual(objekte.size, 1, "und zwar als ein und dasselbe Objekt");
  assert.strictEqual(tage[0].termine[0]._entity, "calendar.a");
});

function calIsoTag(datum) {
  const m = String(datum.getMonth() + 1).padStart(2, "0");
  const t = String(datum.getDate()).padStart(2, "0");
  return `${datum.getFullYear()}-${m}-${t}`;
}

/* ------------------------------------------------------------------------
 * Fix-Runde 1: Wettlauf beim Blaettern und zweiter setConfig
 * ---------------------------------------------------------------------- */

/**
 * Ein `callApi`, dessen Antworten von Hand und in beliebiger Reihenfolge
 * freigegeben werden. Anders laesst sich ein Wettlauf nicht nachstellen —
 * mit `async () => …` loest immer die zuerst gestartete Anfrage zuerst auf,
 * und genau der Fall ist der harmlose.
 */
function calSteuerbaresApi() {
  const warteschlange = [];
  return {
    warteschlange,
    callApi: () => new Promise((fertig) => warteschlange.push(fertig)),
  };
}

test("die zuletzt gestartete Ladung gewinnt, auch wenn eine alte spaeter antwortet", async () => {
  const { callApi, warteschlange } = calSteuerbaresApi();
  const karte = calBauKarte(callApi);
  // Vor und gleich wieder zurueck: Ladung 1 und Ladung 3 holen DENSELBEN
  // Monat mit DERSELBEN Kalenderanzahl. Eine inhaltliche Marke waere hier
  // doppelt und koennte die beiden nicht auseinanderhalten.
  karte._blaettern(1);
  karte._blaettern(-1);
  assert.strictEqual(warteschlange.length, 3, "drei Ladungen sind angestossen");

  warteschlange[2]([calTerminImMonat("NEU")]); // die zuletzt gestartete
  await calRuhe();
  assert.match(karte._koerper.innerHTML, /NEU/, "die frische Antwort steht da");

  warteschlange[1]([]); // ueberholt
  warteschlange[0]([calTerminImMonat("ALT")]); // ueberholt, antwortet aber spaeter
  await calRuhe();
  await calRuhe();

  assert.match(karte._koerper.innerHTML, /NEU/, "die veraltete Antwort darf nicht gewinnen");
  assert.doesNotMatch(karte._koerper.innerHTML, /ALT/);
});

test("ein zweiter setConfig laedt nach, statt auf der Ladeanzeige zu haengen", async () => {
  let aufrufe = 0;
  const karte = calBauKarte(async () => {
    aufrufe += 1;
    return [calTerminImMonat()];
  });
  await calRuhe();
  assert.match(karte._koerper.innerHTML, /Zahnarzt/);
  const vorher = aufrufe;

  // Genau das, was ein Benutzer im Editor tut: eine Einstellung aendern,
  // ohne die Entitaetsliste anzufassen. `_ladeWennVeraendert()` loest hier
  // NICHT nach, sein Stempel haengt nur an den Entitaeten.
  karte.setConfig({ entities: ["calendar.a"], title: "Neue Ueberschrift" });
  await calRuhe();
  await calRuhe();

  assert.doesNotMatch(karte._koerper.innerHTML, /Wird geladen/, "keine haengende Ladeanzeige");
  assert.match(karte._koerper.innerHTML, /Zahnarzt/, "die Liste steht wieder da");
  assert.match(karte._koerper.innerHTML, /Neue Ueberschrift/, "die neue Einstellung greift");
  assert.strictEqual(aufrufe, vorher + 1, "genau eine Nachladung, keine Schleife");
});

/* ------------------------------------------------------------------------
 * Nachbesserung v0.6.1 — die Fusszeile der laufenden Karte
 *
 * Beides ist nur an der zusammengesetzten Karte pruefbar: dass die Teile
 * ueberhaupt getrennt werden, und dass `_render()` der Summe die Grenzen des
 * gezeigten Monats mitgibt. Eine Summenfunktion, die schneiden KANN, aber
 * ungeschnitten aufgerufen wird, ist so falsch wie eine, die es nicht kann.
 * ---------------------------------------------------------------------- */

/**
 * Die Werte der Fusszeile EINZELN, nicht als ein Text.
 *
 * Der Kasten ist ein Flexkasten mit `justify-content: space-between`; getrennt
 * werden die Werte durch den Raum zwischen den Spans, nicht durch ein Zeichen.
 * `textContent` sieht diesen Raum nicht und liefert „6 Tage25,7 h1 ganztägig"
 * am Stueck. Wer daraufhin ein Trennzeichen einbaut, aendert die DARSTELLUNG,
 * damit die MESSUNG einfacher wird — genau der falsche Weg herum, einmal
 * gegangen und wieder zurueckgenommen. Deshalb liest diese Pruefung die Spans.
 */
function calFussTeile(html) {
  const kasten = html.match(/<div class="cal-fuss">([\s\S]*?)<\/div>/);
  if (!kasten) return [];
  return [...kasten[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((t) => t[1]);
}

test("die Fusszeile stellt jeden Wert in eine eigene Spalte", async () => {
  const karte = calBauKarte(async () => [calTerminImMonat()], ["calendar.a"], {
    show_total: true,
  });
  await calRuhe();
  const teile = calFussTeile(karte._koerper.innerHTML);
  assert.strictEqual(teile.length, 2, "ein Span je Wert — hier Tage und Stunden");
  assert.match(teile[0], /^\d+ Tage$/, "die Tage stehen fuer sich");
  assert.match(teile[1], /^[\d,]+ h$/, "die Stunden auch");
  for (const teil of teile) {
    assert.doesNotMatch(teil, /·/, "der Raum trennt, kein Zeichen im Text");
  }
});

/**
 * Die Layoutentscheidung selbst, als Text festgehalten. Sie ist am Bild
 * getroffen worden — mit `space-between` sassen bei ZWEI Werten "3 Tage" und
 * "25,7 h" in den gegenueberliegenden Ecken, 436 px Leerraum dazwischen, und
 * die Zeile sprang, je nachdem ob der Monat einen ganztaegigen Termin hatte.
 * Diese Pruefung ersetzt das Bild nicht, sie haelt nur fest, dass die
 * Entscheidung nicht versehentlich zurueckgedreht wird.
 */
test("die Fusszeile steht linksbuendig mit festem Abstand", () => {
  const { CAL_STIL } = ladeKarte(["CAL_STIL"]);
  const regel = CAL_STIL.match(/\.cal-fuss \{[^}]*\}/);
  assert.ok(regel, "es muss eine Regel fuer .cal-fuss geben");
  assert.match(regel[0], /gap:\s*24px/, "fester Abstand statt verteilter Leerraum");
  assert.doesNotMatch(
    regel[0],
    /space-between/,
    "verteilt reisst die Werte bei nur zwei Angaben in die Ecken"
  );
});

test("ein ganztaegiger Termin bekommt die dritte Spalte", async () => {
  const jetzt = new Date();
  const tag = (t) =>
    `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
  const karte = calBauKarte(
    async () => [calTerminImMonat(), { uid: "g", summary: "Urlaub", start: { date: tag(10) }, end: { date: tag(13) } }],
    ["calendar.a"],
    { show_total: true }
  );
  await calRuhe();
  const teile = calFussTeile(karte._koerper.innerHTML);
  assert.strictEqual(teile.length, 3, "Tage, Stunden, ganztaegig");
  assert.match(teile[2], /^1 ganztägig$/);
});

test("die Fusszeile der Karte schneidet auf den gezeigten Monat", async () => {
  const jetzt = new Date();
  const von = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 25, 0, 0, 0);
  const bis = new Date(jetzt.getFullYear(), jetzt.getMonth(), 5, 16, 0, 0);
  const karte = calBauKarte(
    async () => [{ uid: "u", summary: "Urlaub", start: { dateTime: von.toISOString() }, end: { dateTime: bis.toISOString() } }],
    ["calendar.a"],
    { show_total: true }
  );
  await calRuhe();
  const teile = calFussTeile(karte._koerper.innerHTML);
  assert.deepStrictEqual(
    teile,
    ["5 Tage", "112,0 h"],
    "vom Monatsersten bis zum 5. um 16 Uhr — fuenf Tage, nicht zwoelf"
  );
});
