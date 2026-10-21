"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calMonatsGrenzen,
  calGruppiereNachTag,
  calSummeStunden,
  calEscape,
  calFormatUhrzeit,
  calFormatStunden,
  calListeHtml,
} = ladeKarte([
  "calMonatsGrenzen",
  "calGruppiereNachTag",
  "calSummeStunden",
  "calEscape",
  "calFormatUhrzeit",
  "calFormatStunden",
  "calListeHtml",
]);

const ACHT_STUNDEN = {
  start: { dateTime: "2026-08-03T08:00:00+02:00" },
  end: { dateTime: "2026-08-03T16:00:00+02:00" },
  summary: "DZ",
  uid: "a",
};

const HALBE_STUNDE = {
  start: { dateTime: "2026-08-04T08:00:00+02:00" },
  end: { dateTime: "2026-08-04T08:30:00+02:00" },
  summary: "TA",
  uid: "b",
};

const URLAUB = {
  start: { date: "2026-08-10" },
  end: { date: "2026-08-13" },
  summary: "Urlaub",
  uid: "c",
};

/**
 * Die Summe zaehlt seit v0.6.1 nur, was im GEZEIGTEN Monat liegt. Alle
 * Aufrufe geben deshalb die Monatsgrenzen mit — hier August 2026.
 */
const AUGUST = calMonatsGrenzen(new Date(2026, 7, 15), 0);

test("die Summe zaehlt Stunden und ganztaegige getrennt", () => {
  const s = calSummeStunden([ACHT_STUNDEN, HALBE_STUNDE, URLAUB], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 8.5);
  assert.strictEqual(s.ganztags, 1, "der Urlaub zaehlt als ein Termin, nicht als drei Tage");
  assert.strictEqual(s.tageMitTermin, 5, "3. + 4. + drei Urlaubstage");
});

/**
 * Befund 1, Gegenstueck zur alten Pruefung „dieselbe uid wird nur einmal
 * gezaehlt". Home Assistant gibt JEDER Instanz einer Serie dieselbe `uid` —
 * ein woechentlicher Fruehdienst kommt fuenfmal mit derselben Kennung. Wer
 * danach entdoppelt, wirft vier Dienste weg, und die Fusszeile widerspricht
 * der Liste darueber.
 */
test("gleiche uid an verschiedenen Tagen sind zwei Termine, keiner", () => {
  const zweiter = {
    ...ACHT_STUNDEN,
    start: { dateTime: "2026-08-10T08:00:00+02:00" },
    end: { dateTime: "2026-08-10T16:00:00+02:00" },
  };
  const s = calSummeStunden([ACHT_STUNDEN, zweiter], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 16, "beide Instanzen der Serie zaehlen");
  assert.strictEqual(s.tageMitTermin, 2, "und beide Tage");
});

test("Stunden werden mit Komma und einer Nachkommastelle gezeigt", () => {
  assert.strictEqual(calFormatStunden(168.5, "de-DE"), "168,5");
  assert.strictEqual(calFormatStunden(8, "de-DE"), "8,0");
});

test("Uhrzeiten sind zweistellig", () => {
  const d = new Date(2026, 7, 3, 8, 49);
  assert.strictEqual(calFormatUhrzeit(d, "de-DE"), "08:49");
});

test("HTML in Termintiteln wird entschaerft", () => {
  const boese = calEscape('<img src=x onerror="alert(1)">');
  assert.ok(!boese.includes("<img"), "spitze Klammern muessen ersetzt sein");
  assert.ok(boese.includes("&lt;img"));
  assert.strictEqual(calEscape('a & b "c"'), "a &amp; b &quot;c&quot;");
});

test("der Termintitel landet entschaerft in der Liste", () => {
  const boese = { ...ACHT_STUNDEN, summary: '<script>alert(1)</script>', uid: "x" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([boese], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(!html.includes("<script>"), "kein rohes script-Tag im HTML");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("ohne leere Tage stehen nur Tage mit Terminen in der Liste", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const html = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const zeilen = (html.match(/class="cal-tag[ "]/g) || []).length;
  assert.strictEqual(zeilen, 1, "nur der 3. August");
});

test("mit leeren Tagen steht jeder Tag des Monats in der Liste", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const html = calListeHtml(tage, {
    zeigeLeereTage: true, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const zeilen = (html.match(/class="cal-tag[ "]/g) || []).length;
  assert.strictEqual(zeilen, 31);
});

test("ganztaegige Termine zeigen keine Uhrzeit", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([URLAUB], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(html.includes("ganztägig"));
  assert.ok(html.includes("Urlaub"));
});

test("Beschreibung und Ort stehen im title der Zeile", () => {
  const mitOrt = { ...ACHT_STUNDEN, description: "Frühschicht", location: "Halle 2", uid: "o" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const html = calListeHtml(calGruppiereNachTag([mitOrt], start, ende), {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  assert.ok(html.includes('title="Frühschicht · Halle 2"'));
});

test("bei einem einzigen Kalender wird kein Farbpunkt gezeichnet", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const einer = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const mehrere = calListeHtml(tage, {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: true,
  });
  assert.ok(!einer.includes("cal-punkt"));
  assert.ok(mehrere.includes("cal-punkt"));
});

/* --------------------------------------------------------------------------
 * Fix-Runde 1
 * ------------------------------------------------------------------------ */

test("ein Termin mit unlesbarem Start zerstoert die Summe nicht", () => {
  const kaputt = {
    start: { dateTime: "morgen frueh" },
    end: { dateTime: "2026-08-06T10:00:00+02:00" },
    summary: "Unlesbar",
    uid: "k",
  };
  const s = calSummeStunden([ACHT_STUNDEN, kaputt], AUGUST.start, AUGUST.ende);
  assert.ok(!Number.isNaN(s.stunden), "eine NaN-Summe sieht falsch aus, nicht unvollstaendig");
  assert.strictEqual(s.stunden, 8, "die Stunden des gesunden Termins bleiben stehen");
});

test("cal-heute haengt an optionen.heute, nicht an der Uhr", () => {
  // Positiv: der gezeigte Monat ist August 2026, `heute` faellt hinein.
  const august = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const drin = calListeHtml(calGruppiereNachTag([], august.start, august.ende), {
    zeigeLeereTage: true, locale: "de-DE", farben: {}, mehrereKalender: false,
    heute: new Date(2026, 7, 12),
  });
  assert.ok(drin.includes("cal-heute"), "der 12. August muss hervorgehoben sein");

  // Negativ: der gezeigte Monat ist der LAUFENDE Monat der Uhr, `heute` liegt
  // aber in einem anderen. Wer die Uhr liest statt `optionen.heute`, markiert
  // hier faelschlich einen Tag — genau der Vormonatsfall aus der Spec.
  const laufend = calMonatsGrenzen(new Date(), 0);
  const anderswo = new Date(laufend.start.getFullYear(), laufend.start.getMonth() - 2, 12);
  const draussen = calListeHtml(calGruppiereNachTag([], laufend.start, laufend.ende), {
    zeigeLeereTage: true, locale: "de-DE", farben: {}, mehrereKalender: false,
    heute: anderswo,
  });
  assert.ok(!draussen.includes("cal-heute"), "ausserhalb des gezeigten Monats keine Hervorhebung");
});

test("fehlende farben in den Optionen werfen nicht", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  let html;
  assert.doesNotThrow(() => {
    html = calListeHtml(tage, { zeigeLeereTage: false, locale: "de-DE", mehrereKalender: true });
  }, "ein von Hand gebautes Optionsobjekt darf die Liste nicht sprengen");
  assert.ok(html.includes("cal-punkt"), "ohne Zuordnung greift die erste Palettenfarbe");
});

/* --------------------------------------------------------------------------
 * Fix-Runde 2 — REGRESSIONSSICHERUNG, nicht fehlergetrieben.
 *
 * Diese Pruefung war vom ersten Lauf an gruen: sie haelt das Verhalten fest,
 * das der praezisierte Kommentar in `calSummeStunden` beschreibt. Ihr Zweck
 * ist der Tag, an dem jemand `calGruppiereNachTag` einen Ersatztag gibt —
 * dann faellt sie um und zwingt die Entscheidung ans Licht, statt sie
 * stillschweigend geschehen zu lassen. Zeitunabhaengig, wird also nicht
 * nichtssagend.
 * ------------------------------------------------------------------------ */

test("kaputtes Ende bleibt sichtbar, kaputter Start verschwindet ganz", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const optionen = {
    zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
  };

  const kaputtesEnde = {
    start: { dateTime: "2026-08-05T08:00:00+02:00" },
    end: { dateTime: "morgen frueh" },
    summary: "Kaputtes Ende",
    uid: "e",
  };
  const mitEnde = calListeHtml(calGruppiereNachTag([kaputtesEnde], start, ende), optionen);
  assert.ok(mitEnde.includes("Kaputtes Ende"), "behaelt seinen Tag und bleibt sichtbar");
  assert.strictEqual(calSummeStunden([kaputtesEnde], AUGUST.start, AUGUST.ende).stunden, 0, "Dauer null, nicht NaN");
  assert.strictEqual(calSummeStunden([kaputtesEnde], AUGUST.start, AUGUST.ende).tageMitTermin, 1);

  const kaputterStart = {
    start: { dateTime: "morgen frueh" },
    end: { dateTime: "2026-08-06T10:00:00+02:00" },
    summary: "Kaputter Start",
    uid: "s",
  };
  const mitStart = calListeHtml(calGruppiereNachTag([kaputterStart], start, ende), optionen);
  assert.strictEqual(mitStart, "", "ohne lesbaren Start gibt es keinen Tag — kein Eintrag");
  assert.strictEqual(calSummeStunden([kaputterStart], AUGUST.start, AUGUST.ende).tageMitTermin, 0, "auch nicht in der Summe");
});

/* --------------------------------------------------------------------------
 * Nachbesserung v0.6.1 — Befunde 2, 3 und 4
 *
 * Alle drei erzeugen Zahlen, die dem widersprechen, was ueber ihnen in der
 * Liste steht. Deshalb pruefen sie jeweils BEIDES: die Summe und das, was in
 * der Liste sichtbar ist.
 * ------------------------------------------------------------------------ */

/** ISO-Zeichenkette aus lokaler Zeit — sonst haengt die Pruefung an der Zone. */
function calIsoZeit(jahr, monatNull, tag, stunde, minute) {
  return new Date(jahr, monatNull, tag, stunde, minute || 0, 0, 0).toISOString();
}

const LISTEN_OPTIONEN = {
  zeigeLeereTage: false, locale: "de-DE", farben: {}, mehrereKalender: false,
};

test("ein Termin ueber den Monatswechsel zaehlt nur den gezeigten Monat", () => {
  // 25.07. 00:00 bis 05.08. 16:00. Im August sichtbar sind der 1. bis 5.,
  // also 4 volle Tage + 16 Stunden = 112 h an 5 Tagen. Ungeschnitten waeren
  // es 272 h an 12 Tagen — die Zahl, die vor der Nachbesserung dastand.
  const urlaub = {
    uid: "u",
    summary: "Urlaub",
    start: { dateTime: calIsoZeit(2026, 6, 25, 0, 0) },
    end: { dateTime: calIsoZeit(2026, 7, 5, 16, 0) },
  };
  const s = calSummeStunden([urlaub], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 112, "nur der August-Anteil");
  assert.strictEqual(s.tageMitTermin, 5, "1. bis 5. August");
});

test("ein voller Monat ergibt glatte Stunden, nicht eine Millisekunde weniger", () => {
  const dauerlaeufer = {
    uid: "d",
    summary: "Dauerlaeufer",
    start: { dateTime: calIsoZeit(2026, 6, 20, 0, 0) },
    end: { dateTime: calIsoZeit(2026, 8, 10, 0, 0) },
  };
  const s = calSummeStunden([dauerlaeufer], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 31 * 24, "der ganze August, keine Sekunde mehr oder weniger");
  assert.strictEqual(s.tageMitTermin, 31);
});

test("ein ganztaegiger Termin mit gleichem Start- und Enddatum bleibt sichtbar", () => {
  // `end.date` ist ausschliessend; ist es GLEICH `start.date`, landete die
  // Rueckrechnung einen Tag VOR dem Start. Der Termin fiel aus der Liste,
  // stand aber als „1 ganztaegig" in der Fusszeile.
  const eintaegig = {
    uid: "g",
    summary: "Betriebsausflug",
    start: { date: "2026-08-04" },
    end: { date: "2026-08-04" },
  };
  const html = calListeHtml(
    calGruppiereNachTag([eintaegig], AUGUST.start, AUGUST.ende),
    LISTEN_OPTIONEN
  );
  assert.match(html, /Betriebsausflug/, "der Termin muss in der Liste stehen");
  const s = calSummeStunden([eintaegig], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.ganztags, 1);
  assert.strictEqual(s.tageMitTermin, 1, "genau der 4. August");
});

test("ein Rueckwaertstermin am selben Tag verkleinert die Summe nicht", () => {
  const rueckwaerts = {
    uid: "r1",
    summary: "Verdreht",
    start: { dateTime: calIsoZeit(2026, 7, 6, 12, 0) },
    end: { dateTime: calIsoZeit(2026, 7, 6, 8, 0) },
  };
  const s = calSummeStunden([ACHT_STUNDEN, rueckwaerts], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 8, "acht Stunden bleiben acht, nicht vier");
  assert.strictEqual(s.tageMitTermin, 2, "der 3. und der 6.");
});

test("ein Rueckwaertstermin ueber mehrere Tage bleibt sichtbar und zaehlt null", () => {
  const rueckwaerts = {
    uid: "r2",
    summary: "Weit verdreht",
    start: { dateTime: calIsoZeit(2026, 7, 12, 10, 0) },
    end: { dateTime: calIsoZeit(2026, 7, 10, 6, 0) },
  };
  const html = calListeHtml(
    calGruppiereNachTag([rueckwaerts], AUGUST.start, AUGUST.ende),
    LISTEN_OPTIONEN
  );
  assert.match(html, /Weit verdreht/, "er darf nicht aus der Liste fallen");
  const s = calSummeStunden([rueckwaerts], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 0, "keine minus 52 Stunden");
  assert.strictEqual(s.tageMitTermin, 1, "nur sein Starttag");
});

test("ein Termin ganz ausserhalb des gezeigten Monats zaehlt gar nicht", () => {
  const juli = {
    uid: "j",
    summary: "Juli",
    start: { dateTime: calIsoZeit(2026, 6, 10, 8, 0) },
    end: { dateTime: calIsoZeit(2026, 6, 10, 16, 0) },
  };
  const s = calSummeStunden([juli], AUGUST.start, AUGUST.ende);
  assert.strictEqual(s.stunden, 0);
  assert.strictEqual(s.tageMitTermin, 0);
  assert.strictEqual(s.ganztags, 0);
});
