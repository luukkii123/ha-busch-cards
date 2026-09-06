# busch-calendar-card — Umsetzungsplan

> **Für agentische Umsetzer:** PFLICHT-TEILSKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe.
> Schritte nutzen Kästchen (`- [ ]`) zur Nachverfolgung.

**Ziel:** Eine zweite Lovelace-Karte in `dist/busch-cards.js`, die Termine als
Liste je Kalendermonat zeigt, mit Monatsversatz und Blätterpfeilen.

**Architektur:** Reine Rechenfunktionen (Monatsgrenzen, Gruppierung, Summe,
HTML-Erzeugung) sind vom DOM getrennt und werden unter Node getestet. Die
Kartenklasse ruft nur noch diese Funktionen auf und hängt das Ergebnis in
`innerHTML`. Der Editor nutzt `ha-form` mit einem Schema plus einen eigenen
Abschnitt für die Farben je Kalender.

**Technik:** Vanilla JavaScript, Custom Elements, kein Build-Schritt, keine
Abhängigkeit. Tests mit dem eingebauten `node --test` und `node:vm`.

**Spec:** `docs/superpowers/specs/2026-09-06-kalenderkarte-design.md`

## Globale Vorgaben

- **Kein `npm`, keine `package.json`, keine Abhängigkeit.** Das Repo liegt auf
  einer SMB-Share. Nur eingebaute Node-Bausteine (`node:test`, `node:assert`,
  `node:vm`, `node:fs`).
- **Kein Build-Schritt.** `dist/busch-cards.js` ist genau das, was ausgeliefert
  wird.
- **Jeder neue Name auf oberster Ebene beginnt mit `cal`.** Bereits belegt:
  `CARD_VERSION`, `SCHEDULE_DAYS`, `MINUTES_PER_DAY`, `SCHEDULE_CARD_SCHEMA`,
  `SCHEDULE_LABELS`, `parseScheduleTime`, `formatScheduleTime`, `formatClock`,
  `toInputTime`, `clamp`, `freeRange`, `gapAt`.
- **Kartenname:** `busch-calendar-card`, Editor `busch-calendar-card-editor`,
  Klassen `BuschCalendarCard` und `BuschCalendarCardEditor`.
- **Sprache im Code:** Bezeichner und Kommentare deutsch, passend zum Bestand.
- **Zeitzone:** alles in lokaler Zeit rechnen, nie in UTC.
- **`CARD_VERSION`** wird am Ende auf `"0.5.0"` gesetzt, nicht früher.
- Nach **jeder** Änderung an `dist/busch-cards.js`:
  `node --check dist/busch-cards.js`.

---

### Aufgabe 1: Testgerüst und Namensraum-Wächter

Der historische Fehler dieses Repos war ein doppelt deklariertes `formatClock`.
Diese Aufgabe baut den Wächter, der genau das findet, **bevor** neuer Code
dazukommt.

**Dateien:**
- Anlegen: `tests/laden.js`
- Anlegen: `tests/namensraum.test.js`
- Anlegen: `.gitignore` (nur falls noch nicht vorhanden, siehe Schritt 6)

**Schnittstellen:**
- Erzeugt: `ladeKarte()` aus `tests/laden.js`. Gibt ein Objekt mit den
  Top-Level-Namen der Karte zurück, die im zweiten Argument genannt werden.
  Aufruf: `ladeKarte(["calMonatsGrenzen", "calSummeStunden"])`.
- Erzeugt: `topLevelNamen()` aus `tests/laden.js`. Gibt ein Array aller
  Top-Level-Deklarationsnamen der Datei zurück, in Reihenfolge des Vorkommens.

- [ ] **Schritt 1: Ladehilfe schreiben**

`tests/laden.js`:

```js
"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const KARTE = path.join(__dirname, "..", "dist", "busch-cards.js");

function quelle() {
  return fs.readFileSync(KARTE, "utf8");
}

/**
 * Lädt die Karte in einer Sandbox mit gestubbten Browser-Objekten und gibt
 * die genannten Top-Level-Namen zurück.
 *
 * `const` und `class` auf oberster Ebene landen NICHT als Eigenschaft am
 * globalen Objekt. Deshalb wird ein Ausdruck angehängt, der im selben
 * Gültigkeitsbereich läuft und die Namen einsammelt.
 */
function ladeKarte(namen) {
  const kontext = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    window: { customCards: [] },
    customElements: { define() {} },
    HTMLElement: class {},
    document: {
      createElement() {
        return {
          style: {},
          setAttribute() {},
          addEventListener() {},
          appendChild() {},
        };
      },
    },
  };
  kontext.globalThis = kontext;
  vm.createContext(kontext);
  const sammler = `\n;({ ${namen.join(", ")} });`;
  return vm.runInContext(quelle() + sammler, kontext);
}

/**
 * Alle Top-Level-Deklarationen der Datei, in Reihenfolge.
 * Top-Level heißt hier: die Zeile beginnt ohne Einrückung mit dem
 * Schlüsselwort. Das trifft für diese Datei zu, sie ist flach aufgebaut.
 */
function topLevelNamen() {
  const namen = [];
  for (const zeile of quelle().split("\n")) {
    const treffer = zeile.match(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
    if (treffer) namen.push(treffer[1]);
  }
  return namen;
}

module.exports = { ladeKarte, topLevelNamen, quelle, KARTE };
```

- [ ] **Schritt 2: Den Wächter-Test schreiben**

`tests/namensraum.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { topLevelNamen } = require("./laden.js");

test("kein Top-Level-Name ist doppelt vergeben", () => {
  const namen = topLevelNamen();
  const gesehen = new Set();
  const doppelt = [];
  for (const name of namen) {
    if (gesehen.has(name)) doppelt.push(name);
    gesehen.add(name);
  }
  assert.deepStrictEqual(
    doppelt,
    [],
    `Doppelte Top-Level-Namen: ${doppelt.join(", ")}. ` +
      "Die zweite Deklaration gewinnt still und bricht die andere Karte."
  );
});

test("die Datei laesst sich in der Sandbox ausfuehren", () => {
  const { ladeKarte } = require("./laden.js");
  const werte = ladeKarte(["CARD_VERSION"]);
  assert.match(werte.CARD_VERSION, /^\d+\.\d+\.\d+$/);
});
```

- [ ] **Schritt 3: Tests laufen lassen, müssen grün sein**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards"
node --test tests/
```

Erwartet: beide Tests bestehen. Wenn `ladeKarte` scheitert, fehlt ein Stub im
Kontext. Die Fehlermeldung nennt das fehlende Objekt, ergänze es in
`tests/laden.js` und lauf erneut.

- [ ] **Schritt 4: Beweisen, dass der Wächter wirklich anschlägt**

Füge **vorübergehend** ans Ende von `dist/busch-cards.js` an:

```js
function clamp(a) { return a; }
```

Dann:

```bash
node --test tests/
```

Erwartet: `kein Top-Level-Name ist doppelt vergeben` **schlägt fehl** und nennt
`clamp`. Ein Wächter, den man nie hat rot werden sehen, ist kein Wächter.

- [ ] **Schritt 5: Die Dublette wieder entfernen**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards"
git checkout -- dist/busch-cards.js
node --test tests/
```

Erwartet: wieder grün.

- [ ] **Schritt 6: Commit**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards"
git add tests/
git commit -m "Tests: Sandbox-Lader und Waechter gegen doppelte Top-Level-Namen

Der Waechter wurde einmal absichtlich rot gesehen, mit einer
kuenstlichen clamp-Dublette.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 2: Monatsgrenzen

**Dateien:**
- Anlegen: `tests/monat.test.js`
- Ändern: `dist/busch-cards.js` (anhängen, vor `customElements.define`)

**Schnittstellen:**
- Verbraucht: `ladeKarte` aus Aufgabe 1.
- Erzeugt: `calMonatsGrenzen(basis, versatz)` gibt `{ start, ende }` zurück,
  beides `Date` in lokaler Zeit. `start` ist der Monatserste um 00:00:00.000,
  `ende` der Monatsletzte um 23:59:59.999.
- Erzeugt: `calMonatsName(datum, locale)` gibt `"September 2026"` zurück.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/monat.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const { calMonatsGrenzen, calMonatsName } = ladeKarte([
  "calMonatsGrenzen",
  "calMonatsName",
]);

test("Versatz null liefert den laufenden Monat vollstaendig", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 8, 6), 0);
  assert.strictEqual(start.getFullYear(), 2026);
  assert.strictEqual(start.getMonth(), 8);
  assert.strictEqual(start.getDate(), 1);
  assert.strictEqual(start.getHours(), 0);
  assert.strictEqual(ende.getDate(), 30, "September hat 30 Tage");
  assert.strictEqual(ende.getHours(), 23);
  assert.strictEqual(ende.getMinutes(), 59);
});

test("Versatz minus eins am 6. Oktober liefert den ganzen September", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 9, 6), -1);
  assert.strictEqual(start.getMonth(), 8, "September");
  assert.strictEqual(start.getDate(), 1);
  assert.strictEqual(ende.getMonth(), 8);
  assert.strictEqual(ende.getDate(), 30);
});

test("Versatz minus eins im Januar springt ins Vorjahr", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 0, 15), -1);
  assert.strictEqual(start.getFullYear(), 2025);
  assert.strictEqual(start.getMonth(), 11, "Dezember");
  assert.strictEqual(ende.getDate(), 31);
});

test("Versatz plus eins im Dezember springt ins Folgejahr", () => {
  const { start } = calMonatsGrenzen(new Date(2026, 11, 20), 1);
  assert.strictEqual(start.getFullYear(), 2027);
  assert.strictEqual(start.getMonth(), 0, "Januar");
});

test("Februar im Schaltjahr hat 29 Tage", () => {
  const { ende } = calMonatsGrenzen(new Date(2028, 1, 10), 0);
  assert.strictEqual(ende.getDate(), 29);
});

test("Februar im Normaljahr hat 28 Tage", () => {
  const { ende } = calMonatsGrenzen(new Date(2026, 1, 10), 0);
  assert.strictEqual(ende.getDate(), 28);
});

test("der Monatsname nennt Monat und Jahr", () => {
  assert.strictEqual(calMonatsName(new Date(2026, 8, 1), "de-DE"), "September 2026");
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

```bash
node --test tests/monat.test.js
```

Erwartet: FEHLER, `calMonatsGrenzen is not defined`.

- [ ] **Schritt 3: Umsetzen**

In `dist/busch-cards.js`, **vor** der Zeile
`customElements.define("busch-schedule-card", BuschScheduleCard);` einfügen:

```js
/* ==========================================================================
 * busch-calendar-card — Terminliste je Kalendermonat
 *
 * Alle Namen auf oberster Ebene beginnen mit `cal`. Diese Datei hat einen
 * flachen Gueltigkeitsbereich: ein zweites `clamp` oder `formatClock` wuerde
 * die Zeitplan-Karte still kaputtmachen.
 * ========================================================================== */

/**
 * Erster und letzter Moment des Zielmonats, in lokaler Zeit.
 * `new Date(jahr, monat + 1, 0)` ist der letzte Tag des Monats davor — das
 * erledigt Monatslaengen und Schaltjahre ohne eigene Tabelle.
 */
function calMonatsGrenzen(basis, versatz) {
  const jahr = basis.getFullYear();
  const monat = basis.getMonth() + (versatz || 0);
  return {
    start: new Date(jahr, monat, 1, 0, 0, 0, 0),
    ende: new Date(jahr, monat + 1, 0, 23, 59, 59, 999),
  };
}

function calMonatsName(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", {
    month: "long",
    year: "numeric",
  });
}
```

- [ ] **Schritt 4: Tests laufen lassen, müssen grün sein**

```bash
node --check dist/busch-cards.js && node --test tests/
```

Erwartet: alle Tests bestehen, auch der Namensraum-Wächter.

- [ ] **Schritt 5: Commit**

```bash
git add dist/busch-cards.js tests/monat.test.js
git commit -m "Kalenderkarte: Monatsgrenzen rechnen auf Kalendertagen

Deckt Jahreswechsel in beide Richtungen und Schaltjahre ab.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 3: Termine lesen und nach Tagen gruppieren

Das ist der Kern. Hier steckt der Fallstrick mit den ganztägigen Terminen.

**Dateien:**
- Anlegen: `tests/gruppieren.test.js`
- Ändern: `dist/busch-cards.js`

**Schnittstellen:**
- Verbraucht: `calMonatsGrenzen` aus Aufgabe 2.
- Erzeugt: `calIstGanztags(termin)` → `boolean`.
- Erzeugt: `calStartDatum(termin)` → `Date` in lokaler Zeit.
- Erzeugt: `calEndDatum(termin)` → `Date` in lokaler Zeit. Bei ganztägigen
  Terminen wird das **exklusive** Enddatum um einen Tag zurückgesetzt, damit es
  den letzten betroffenen Tag bezeichnet.
- Erzeugt: `calTagesSchluessel(datum)` → `"2026-09-01"`.
- Erzeugt: `calGruppiereNachTag(termine, start, ende)` → Array von
  `{ schluessel, datum, tagNummer, wochentag, istWochenende, termine: [] }`,
  ein Eintrag je Tag des Monats, chronologisch, auch für Tage ohne Termin.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/gruppieren.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const {
  calMonatsGrenzen,
  calIstGanztags,
  calStartDatum,
  calEndDatum,
  calTagesSchluessel,
  calGruppiereNachTag,
} = ladeKarte([
  "calMonatsGrenzen",
  "calIstGanztags",
  "calStartDatum",
  "calEndDatum",
  "calTagesSchluessel",
  "calGruppiereNachTag",
]);

// Echte Form aus calendar.arbeitszeiten, August 2026.
const ZEITTERMIN = {
  start: { dateTime: "2026-08-03T08:49:13+02:00" },
  end: { dateTime: "2026-08-03T16:15:08+02:00" },
  summary: "DZ",
  description: "",
  location: null,
  uid: "4ab16f20-8f7e-11f1-8f38-e45f0129325d",
};

// Ganztaegig: Datum statt Zeitstempel, Ende ist AUSSCHLIESSEND.
const GANZTAGS_EIN_TAG = {
  start: { date: "2026-08-04" },
  end: { date: "2026-08-05" },
  summary: "Feiertag",
  uid: "ganztags-1",
};

const GANZTAGS_DREI_TAGE = {
  start: { date: "2026-08-10" },
  end: { date: "2026-08-13" },
  summary: "Urlaub",
  uid: "ganztags-3",
};

test("zeitgebundene und ganztaegige Termine werden unterschieden", () => {
  assert.strictEqual(calIstGanztags(ZEITTERMIN), false);
  assert.strictEqual(calIstGanztags(GANZTAGS_EIN_TAG), true);
});

test("ein ganztaegiges Datum wird als lokaler Tag gelesen, nicht als UTC", () => {
  const d = calStartDatum(GANZTAGS_EIN_TAG);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 7, "August");
  assert.strictEqual(d.getDate(), 4, "nicht der 3. — new Date('2026-08-04') waere UTC");
  assert.strictEqual(d.getHours(), 0);
});

test("das ausschliessende Ende eines Ganztagstermins wird zurueckgesetzt", () => {
  const e = calEndDatum(GANZTAGS_EIN_TAG);
  assert.strictEqual(e.getDate(), 4, "ein eintaegiger Termin endet an seinem eigenen Tag");
});

test("der Tagesschluessel ist stabil und nullgepolstert", () => {
  assert.strictEqual(calTagesSchluessel(new Date(2026, 8, 1)), "2026-09-01");
  assert.strictEqual(calTagesSchluessel(new Date(2026, 11, 31)), "2026-12-31");
});

test("jeder Tag des Monats bekommt einen Eintrag, auch die leeren", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ZEITTERMIN], start, ende);
  assert.strictEqual(tage.length, 31, "August hat 31 Tage");
  assert.strictEqual(tage[0].tagNummer, 1);
  assert.strictEqual(tage[30].tagNummer, 31);
  assert.strictEqual(tage[2].termine.length, 1, "der 3. hat den Termin");
  assert.strictEqual(tage[0].termine.length, 0, "der 1. ist leer");
});

test("ein mehrtaegiger Ganztagstermin erscheint an jedem betroffenen Tag", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([GANZTAGS_DREI_TAGE], start, ende);
  assert.strictEqual(tage[9].termine.length, 1, "10. August");
  assert.strictEqual(tage[10].termine.length, 1, "11. August");
  assert.strictEqual(tage[11].termine.length, 1, "12. August");
  assert.strictEqual(tage[12].termine.length, 0, "13. August NICHT, Ende ist ausschliessend");
});

test("Wochenenden sind gekennzeichnet", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([], start, ende);
  // 1. August 2026 ist ein Samstag.
  assert.strictEqual(tage[0].istWochenende, true, "Sa 01.08.");
  assert.strictEqual(tage[1].istWochenende, true, "So 02.08.");
  assert.strictEqual(tage[2].istWochenende, false, "Mo 03.08.");
});

test("Termine eines Tages stehen in zeitlicher Reihenfolge", () => {
  const spaet = { ...ZEITTERMIN, start: { dateTime: "2026-08-03T18:00:00+02:00" },
                  end: { dateTime: "2026-08-03T19:00:00+02:00" }, uid: "spaet" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([spaet, ZEITTERMIN], start, ende);
  assert.strictEqual(tage[2].termine[0].uid, ZEITTERMIN.uid, "08:49 vor 18:00");
  assert.strictEqual(tage[2].termine[1].uid, "spaet");
});

test("ganztaegige Termine stehen vor den zeitgebundenen desselben Tages", () => {
  const ganztagsAm3 = { start: { date: "2026-08-03" }, end: { date: "2026-08-04" },
                        summary: "Feiertag", uid: "g3" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ZEITTERMIN, ganztagsAm3], start, ende);
  assert.strictEqual(tage[2].termine[0].uid, "g3");
});

test("Termine ausserhalb des Monats werden verworfen", () => {
  const juli = { start: { dateTime: "2026-07-30T08:00:00+02:00" },
                 end: { dateTime: "2026-07-30T09:00:00+02:00" }, uid: "juli" };
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([juli], start, ende);
  const summe = tage.reduce((n, t) => n + t.termine.length, 0);
  assert.strictEqual(summe, 0);
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

```bash
node --test tests/gruppieren.test.js
```

Erwartet: FEHLER, `calIstGanztags is not defined`.

- [ ] **Schritt 3: Umsetzen**

Direkt hinter `calMonatsName` in `dist/busch-cards.js` einfügen:

```js
function calIstGanztags(termin) {
  return Boolean(termin && termin.start && termin.start.date && !termin.start.dateTime);
}

/**
 * Ein reines Datum wird von Hand zerlegt. `new Date("2026-08-04")` liest die
 * Zeichenkette als UTC-Mitternacht — westlich von Greenwich ergaebe das den
 * 3. August. Der Konstruktor mit Zahlen nimmt lokale Zeit.
 */
function calDatumAusText(text) {
  const teile = String(text).split("-").map(Number);
  return new Date(teile[0], teile[1] - 1, teile[2], 0, 0, 0, 0);
}

function calStartDatum(termin) {
  return calIstGanztags(termin)
    ? calDatumAusText(termin.start.date)
    : new Date(termin.start.dateTime);
}

/**
 * Bei ganztaegigen Terminen ist `end.date` AUSSCHLIESSEND: ein eintaegiger
 * Termin am 4. hat das Ende am 5. Hier wird auf den letzten betroffenen Tag
 * zurueckgerechnet.
 */
function calEndDatum(termin) {
  if (!calIstGanztags(termin)) return new Date(termin.end.dateTime);
  const roh = calDatumAusText(termin.end.date);
  return new Date(roh.getFullYear(), roh.getMonth(), roh.getDate() - 1, 23, 59, 59, 999);
}

function calTagesSchluessel(datum) {
  const m = String(datum.getMonth() + 1).padStart(2, "0");
  const t = String(datum.getDate()).padStart(2, "0");
  return `${datum.getFullYear()}-${m}-${t}`;
}

/**
 * Ein Eintrag je Tag des Monats, auch fuer Tage ohne Termin.
 * Die Tage werden ueber ihre Nummer erzeugt, nicht durch Hochzaehlen eines
 * Date-Objekts: das bliebe an der Sommerzeitgrenze haengen.
 */
function calGruppiereNachTag(termine, start, ende) {
  const tage = [];
  const nachSchluessel = new Map();
  for (let n = 1; n <= ende.getDate(); n += 1) {
    const datum = new Date(start.getFullYear(), start.getMonth(), n);
    const eintrag = {
      schluessel: calTagesSchluessel(datum),
      datum,
      tagNummer: n,
      wochentag: datum.getDay(),
      istWochenende: datum.getDay() === 0 || datum.getDay() === 6,
      termine: [],
    };
    tage.push(eintrag);
    nachSchluessel.set(eintrag.schluessel, eintrag);
  }

  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;
    const von = calStartDatum(termin);
    const bis = calEndDatum(termin);
    // Jeden betroffenen Tag anfassen, damit mehrtaegige Termine ueberall stehen.
    let lauf = new Date(von.getFullYear(), von.getMonth(), von.getDate());
    const letzter = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
    let sicherung = 0;
    while (lauf <= letzter && sicherung < 400) {
      const treffer = nachSchluessel.get(calTagesSchluessel(lauf));
      if (treffer) treffer.termine.push(termin);
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }
  }

  for (const tag of tage) {
    tag.termine.sort((a, b) => {
      const ga = calIstGanztags(a);
      const gb = calIstGanztags(b);
      if (ga !== gb) return ga ? -1 : 1;
      return calStartDatum(a) - calStartDatum(b);
    });
  }

  return tage;
}
```

- [ ] **Schritt 4: Tests laufen lassen, müssen grün sein**

```bash
node --check dist/busch-cards.js && node --test tests/
```

Erwartet: alle Tests bestehen.

- [ ] **Schritt 5: Commit**

```bash
git add dist/busch-cards.js tests/gruppieren.test.js
git commit -m "Kalenderkarte: Termine nach Tagen gruppieren

Ganztagstermine werden als lokale Tage gelesen, nicht als UTC, und ihr
ausschliessendes Enddatum wird zurueckgerechnet. Mehrtaegige Termine
erscheinen an jedem betroffenen Tag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 4: Summe, Formatierung, HTML-Erzeugung

**Dateien:**
- Anlegen: `tests/darstellung.test.js`
- Ändern: `dist/busch-cards.js`

**Schnittstellen:**
- Verbraucht: `calIstGanztags`, `calStartDatum`, `calEndDatum`,
  `calGruppiereNachTag` aus Aufgabe 3.
- Erzeugt: `calSummeStunden(termine)` → `{ stunden, ganztags, tageMitTermin }`.
  Rechnet über die **Originalliste**, nicht über die gruppierten Tage, damit
  mehrtägige Termine nicht mehrfach zählen. Doppelte `uid` werden übersprungen.
- Erzeugt: `calEscape(text)` → HTML-sichere Zeichenkette.
- Erzeugt: `calFormatUhrzeit(datum, locale)` → `"08:49"`.
- Erzeugt: `calFormatStunden(zahl, locale)` → `"168,5"`.
- Erzeugt: `calListeHtml(tage, optionen)` → HTML-Zeichenkette der Tagesliste.
  `optionen`: `{ zeigeLeereTage, locale, farben, mehrereKalender }`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/darstellung.test.js`:

```js
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

test("die Summe zaehlt Stunden und ganztaegige getrennt", () => {
  const s = calSummeStunden([ACHT_STUNDEN, HALBE_STUNDE, URLAUB]);
  assert.strictEqual(s.stunden, 8.5);
  assert.strictEqual(s.ganztags, 1, "der Urlaub zaehlt als ein Termin, nicht als drei Tage");
  assert.strictEqual(s.tageMitTermin, 5, "3. + 4. + drei Urlaubstage");
});

test("dieselbe uid wird nur einmal gezaehlt", () => {
  const s = calSummeStunden([ACHT_STUNDEN, ACHT_STUNDEN]);
  assert.strictEqual(s.stunden, 8);
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
  const zeilen = (html.match(/class="cal-tag"/g) || []).length;
  assert.strictEqual(zeilen, 1, "nur der 3. August");
});

test("mit leeren Tagen steht jeder Tag des Monats in der Liste", () => {
  const { start, ende } = calMonatsGrenzen(new Date(2026, 7, 15), 0);
  const tage = calGruppiereNachTag([ACHT_STUNDEN], start, ende);
  const html = calListeHtml(tage, {
    zeigeLeereTage: true, locale: "de-DE", farben: {}, mehrereKalender: false,
  });
  const zeilen = (html.match(/class="cal-tag"/g) || []).length;
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
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

```bash
node --test tests/darstellung.test.js
```

Erwartet: FEHLER, `calSummeStunden is not defined`.

- [ ] **Schritt 3: Umsetzen**

Hinter `calGruppiereNachTag` einfügen:

```js
const calPalette = ["#3f8fd4", "#e08a3c", "#5aa469", "#b5559b", "#c95c5c", "#7d7fd4"];

/**
 * Summe ueber die ORIGINALLISTE, nicht ueber die gruppierten Tage: ein
 * dreitaegiger Urlaub steht dort dreimal und wuerde dreifach zaehlen.
 */
function calSummeStunden(termine) {
  const gesehen = new Set();
  const tage = new Set();
  let ms = 0;
  let ganztags = 0;
  for (const termin of termine || []) {
    if (!termin || !termin.start) continue;
    const kennung = termin.uid || JSON.stringify(termin.start) + (termin.summary || "");
    if (gesehen.has(kennung)) continue;
    gesehen.add(kennung);

    const von = calStartDatum(termin);
    const bis = calEndDatum(termin);
    let lauf = new Date(von.getFullYear(), von.getMonth(), von.getDate());
    const letzter = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
    let sicherung = 0;
    while (lauf <= letzter && sicherung < 400) {
      tage.add(calTagesSchluessel(lauf));
      lauf = new Date(lauf.getFullYear(), lauf.getMonth(), lauf.getDate() + 1);
      sicherung += 1;
    }

    if (calIstGanztags(termin)) ganztags += 1;
    else ms += bis - von;
  }
  return { stunden: ms / 3600000, ganztags, tageMitTermin: tage.size };
}

function calEscape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calFormatUhrzeit(datum, locale) {
  return datum.toLocaleTimeString(locale || "de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calFormatStunden(zahl, locale) {
  return zahl.toLocaleString(locale || "de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function calWochentagKurz(datum, locale) {
  return datum.toLocaleDateString(locale || "de-DE", { weekday: "short" });
}

function calTerminHtml(termin, optionen) {
  const farbe = optionen.farben[termin._entity] || calPalette[0];
  const punkt = optionen.mehrereKalender
    ? `<span class="cal-punkt" style="background:${calEscape(farbe)}"></span>`
    : "";
  const zeit = calIstGanztags(termin)
    ? "ganztägig"
    : `${calFormatUhrzeit(calStartDatum(termin), optionen.locale)} – ` +
      `${calFormatUhrzeit(calEndDatum(termin), optionen.locale)}`;
  // Beschreibung und Ort landen im `title`, weil es keinen Termin-Dialog gibt.
  const hinweis = [termin.description, termin.location].filter(Boolean).join(" · ");
  return (
    `<div class="cal-termin" data-uid="${calEscape(termin.uid || "")}" ` +
    `data-entity="${calEscape(termin._entity || "")}" ` +
    `title="${calEscape(hinweis)}">` +
    `${punkt}<span class="cal-zeit">${calEscape(zeit)}</span>` +
    `<span class="cal-titel">${calEscape(termin.summary || "(ohne Titel)")}</span>` +
    `</div>`
  );
}

function calListeHtml(tage, optionen) {
  const heuteSchluessel = calTagesSchluessel(new Date());
  const zeilen = [];
  for (const tag of tage) {
    if (!optionen.zeigeLeereTage && tag.termine.length === 0) continue;
    const klassen = ["cal-tag"];
    if (tag.istWochenende) klassen.push("cal-wochenende");
    if (tag.schluessel === heuteSchluessel) klassen.push("cal-heute");
    if (tag.termine.length === 0) klassen.push("cal-leer");
    const inhalt = tag.termine.length
      ? tag.termine.map((t) => calTerminHtml(t, optionen)).join("")
      : `<div class="cal-termin cal-nichts"></div>`;
    zeilen.push(
      `<div class="${klassen.join(" ")}">` +
        `<div class="cal-datum">` +
        `<span class="cal-wt">${calEscape(calWochentagKurz(tag.datum, optionen.locale))}</span>` +
        `<span class="cal-nr">${tag.tagNummer}.</span>` +
        `</div>` +
        `<div class="cal-inhalt">${inhalt}</div>` +
        `</div>`
    );
  }
  return zeilen.join("");
}
```

- [ ] **Schritt 4: Tests laufen lassen, müssen grün sein**

```bash
node --check dist/busch-cards.js && node --test tests/
```

Erwartet: alle Tests bestehen.

- [ ] **Schritt 5: Commit**

```bash
git add dist/busch-cards.js tests/darstellung.test.js
git commit -m "Kalenderkarte: Summe, Formatierung und HTML-Erzeugung

Termintitel werden entschaerft, bevor sie ins innerHTML gehen. Die
Stundensumme rechnet ueber die Originalliste, damit mehrtaegige Termine
nicht mehrfach zaehlen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 5: Die Kartenklasse

**Dateien:**
- Ändern: `dist/busch-cards.js`
- Anlegen: `tests/karte.test.js`

**Schnittstellen:**
- Verbraucht: alles aus den Aufgaben 2 bis 4.
- Erzeugt: `calNormalisiereKonfig(config)` → `{ entities: [{entity, color, label}],
  month_offset, navigation, show_empty_days, show_total, title, open_event_on_tap }`.
  Nimmt sowohl `["calendar.x"]` als auch `[{entity: "calendar.x", color: "#f00"}]`.
- Erzeugt: Klasse `BuschCalendarCard` mit `setConfig`, `set hass`,
  `getCardSize`, `static getConfigElement`, `static getStubConfig`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/karte.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { ladeKarte } = require("./laden.js");

const { calNormalisiereKonfig, calPalette } = ladeKarte([
  "calNormalisiereKonfig",
  "calPalette",
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
  assert.deepStrictEqual(k.entities, []);
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

```bash
node --test tests/karte.test.js
```

Erwartet: FEHLER, `calNormalisiereKonfig is not defined`.

- [ ] **Schritt 3: Normalisierung und Kartenklasse umsetzen**

Hinter `calListeHtml` einfügen:

```js
const CAL_STANDARD = {
  month_offset: 0,
  navigation: true,
  show_empty_days: true,
  show_total: false,
  title: "",
  open_event_on_tap: true,
};

function calNormalisiereKonfig(config) {
  const roh = Array.isArray(config && config.entities) ? config.entities : [];
  const entities = roh.map((eintrag, i) => {
    const objekt = typeof eintrag === "string" ? { entity: eintrag } : { ...eintrag };
    return {
      entity: objekt.entity,
      color: objekt.color || calPalette[i % calPalette.length],
      label: objekt.label || "",
    };
  }).filter((e) => Boolean(e.entity));
  return { ...CAL_STANDARD, ...config, entities };
}

const CAL_STIL = `
  .cal-kopf { display:flex; align-items:center; justify-content:space-between;
    padding:12px 16px 8px; }
  .cal-monat { font-size:1.1em; font-weight:600; color:var(--primary-text-color); }
  .cal-pfeil { background:none; border:none; cursor:pointer; padding:6px 10px;
    color:var(--secondary-text-color); font-size:1.2em; line-height:1; border-radius:6px; }
  .cal-pfeil:hover { background:var(--divider-color); color:var(--primary-text-color); }
  .cal-titel-zeile { padding:12px 16px 0; font-weight:600;
    color:var(--primary-text-color); }
  .cal-liste { padding:0 8px 8px; }
  .cal-tag { display:flex; gap:12px; padding:6px 8px; border-radius:8px;
    border-bottom:1px solid var(--divider-color); }
  .cal-tag:last-child { border-bottom:none; }
  .cal-wochenende { background:var(--secondary-background-color); }
  .cal-heute { outline:2px solid var(--primary-color); outline-offset:-2px; }
  .cal-datum { display:flex; gap:6px; min-width:64px; align-items:baseline;
    color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
  .cal-nr { font-weight:600; color:var(--primary-text-color); }
  .cal-inhalt { flex:1; min-width:0; }
  .cal-termin { display:flex; gap:8px; align-items:baseline; padding:2px 0;
    cursor:pointer; }
  .cal-leer .cal-termin { cursor:default; min-height:1.2em; }
  .cal-punkt { width:8px; height:8px; border-radius:50%; flex:none;
    align-self:center; }
  .cal-zeit { color:var(--secondary-text-color); font-variant-numeric:tabular-nums;
    white-space:nowrap; }
  .cal-titel { color:var(--primary-text-color); overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .cal-fuss { display:flex; justify-content:space-between; padding:10px 16px;
    border-top:1px solid var(--divider-color); color:var(--secondary-text-color); }
  .cal-hinweis { padding:12px 16px; color:var(--error-color, #db4437); }
  .cal-leermeldung { padding:16px; color:var(--secondary-text-color); }
`;

class BuschCalendarCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("busch-calendar-card-editor");
  }

  static getStubConfig(hass) {
    const ersterKalender = hass
      ? Object.keys(hass.states).find((id) => id.startsWith("calendar."))
      : undefined;
    return {
      type: "custom:busch-calendar-card",
      entities: ersterKalender ? [ersterKalender] : [],
      month_offset: 0,
    };
  }

  setConfig(config) {
    this._config = calNormalisiereKonfig(config);
    this._versatzLaufend = this._config.month_offset;
    this._tage = null;
    this._fehler = [];
    this._geladenFuer = null;
    this._render();
  }

  set hass(hass) {
    const ersterAufruf = !this._hass;
    this._hass = hass;
    if (ersterAufruf) this._lade();
    else this._ladeWennVeraendert();
  }

  getCardSize() {
    return this._config && this._config.show_empty_days ? 12 : 6;
  }

  _ladeWennVeraendert() {
    if (!this._config || !this._hass) return;
    const stempel = this._config.entities
      .map((e) => {
        const zustand = this._hass.states[e.entity];
        return zustand ? `${e.entity}:${zustand.last_changed}` : `${e.entity}:fehlt`;
      })
      .join("|");
    if (stempel !== this._letzterStempel) {
      this._letzterStempel = stempel;
      this._lade();
    }
  }

  async _lade() {
    if (!this._hass || !this._config) return;
    const { start, ende } = calMonatsGrenzen(new Date(), this._versatzLaufend);
    const marke = `${start.getTime()}-${this._config.entities.length}`;
    this._geladenFuer = marke;

    if (this._config.entities.length === 0) {
      this._tage = [];
      this._alleTermine = [];
      this._fehler = [];
      this._render();
      return;
    }

    const anfragen = this._config.entities.map((e) =>
      this._hass.callApi(
        "GET",
        `calendars/${e.entity}?start=${encodeURIComponent(start.toISOString())}` +
          `&end=${encodeURIComponent(ende.toISOString())}`
      )
    );
    const ergebnisse = await Promise.allSettled(anfragen);
    if (this._geladenFuer !== marke) return; // zwischenzeitlich weitergeblättert

    const alle = [];
    const fehler = [];
    ergebnisse.forEach((r, i) => {
      const eintrag = this._config.entities[i];
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        for (const termin of r.value) {
          alle.push({ ...termin, _entity: eintrag.entity });
        }
      } else {
        fehler.push(eintrag.entity);
      }
    });

    this._alleTermine = alle;
    this._tage = calGruppiereNachTag(alle, start, ende);
    this._fehler = fehler;
    this._render();
  }

  _blaettern(schritt) {
    this._versatzLaufend += schritt;
    this._lade();
    this._render();
  }

  /**
   * Home Assistant hat KEINE oeffentliche Schnittstelle, um einen einzelnen
   * Termin als Dialog zu oeffnen. Der Klick oeffnet deshalb den
   * Info-Dialog der Kalender-Entitaet. Beschreibung und Ort des Termins
   * stehen zusaetzlich im `title` der Zeile und erscheinen beim Ueberfahren.
   * Das ist bewusst weniger, als ein Termin-Dialog waere — es tut aber nicht
   * so, als koennte es mehr.
   */
  _oeffneTermin(uid, entity) {
    if (!this._config.open_event_on_tap || !entity) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render() {
    if (!this._config) return;
    const locale = (this._hass && this._hass.locale && this._hass.locale.language) || "de-DE";
    const { start } = calMonatsGrenzen(new Date(), this._versatzLaufend);

    if (!this._karte) {
      this._karte = document.createElement("ha-card");
      const stil = document.createElement("style");
      stil.textContent = CAL_STIL;
      this._karte.appendChild(stil);
      this._koerper = document.createElement("div");
      this._karte.appendChild(this._koerper);
      this.appendChild(this._karte);

      this._koerper.addEventListener("click", (ereignis) => {
        const pfeil = ereignis.target.closest(".cal-pfeil");
        if (pfeil) {
          this._blaettern(Number(pfeil.dataset.schritt));
          return;
        }
        const zeile = ereignis.target.closest(".cal-termin");
        if (zeile && zeile.dataset.uid) {
          this._oeffneTermin(zeile.dataset.uid, zeile.dataset.entity);
        }
      });
    }

    const farben = {};
    for (const e of this._config.entities) farben[e.entity] = e.color;

    const kopf =
      (this._config.title
        ? `<div class="cal-titel-zeile">${calEscape(this._config.title)}</div>`
        : "") +
      `<div class="cal-kopf">` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="-1" aria-label="Voriger Monat">‹</button>`
        : `<span></span>`) +
      `<span class="cal-monat">${calEscape(calMonatsName(start, locale))}</span>` +
      (this._config.navigation
        ? `<button class="cal-pfeil" data-schritt="1" aria-label="Naechster Monat">›</button>`
        : `<span></span>`) +
      `</div>`;

    let rumpf;
    if (this._config.entities.length === 0) {
      rumpf = `<div class="cal-leermeldung">Kein Kalender gewählt. Im Karteneditor einen auswählen.</div>`;
    } else if (this._tage === null) {
      rumpf = `<div class="cal-leermeldung">Wird geladen …</div>`;
    } else {
      const liste = calListeHtml(this._tage, {
        zeigeLeereTage: this._config.show_empty_days,
        locale,
        farben,
        mehrereKalender: this._config.entities.length > 1,
      });
      rumpf = liste
        ? `<div class="cal-liste">${liste}</div>`
        : `<div class="cal-leermeldung">Keine Termine in diesem Monat.</div>`;
    }

    let fuss = "";
    if (this._config.show_total && this._tage) {
      const s = calSummeStunden(this._alleTermine || []);
      const teile = [`${s.tageMitTermin} Tage`, `${calFormatStunden(s.stunden, locale)} h`];
      if (s.ganztags) teile.push(`${s.ganztags} ganztägig`);
      fuss = `<div class="cal-fuss">${teile.map((t) => `<span>${calEscape(t)}</span>`).join("")}</div>`;
    }

    const hinweis = (this._fehler || []).length
      ? `<div class="cal-hinweis">Nicht erreichbar: ${calEscape(this._fehler.join(", "))}</div>`
      : "";

    this._koerper.innerHTML = kopf + rumpf + fuss + hinweis;
  }
}
```

- [ ] **Schritt 4: Tests laufen lassen, müssen grün sein**

```bash
node --check dist/busch-cards.js && node --test tests/
```

Erwartet: alle Tests bestehen, auch der Namensraum-Wächter.

**Zum Stilblock:** Ein CSS-Syntaxfehler fällt keinem dieser Tests auf. Der
Browser wirft die kaputte Regel still weg. Prüfe den Block deshalb im Bild aus
Aufgabe 7, nicht nur im Test.

- [ ] **Schritt 5: Commit**

```bash
git add dist/busch-cards.js tests/karte.test.js
git commit -m "Kalenderkarte: Kartenklasse mit Blaettern und Fehlerbehandlung

Ein nicht erreichbarer Kalender wirft die uebrigen nicht weg. Der
Blaetterzustand bleibt im Speicher und wandert nicht in die Konfiguration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 6: Editor, Anmeldung, Version

**Dateien:**
- Ändern: `dist/busch-cards.js`
- Ändern: `README.md`

**Schnittstellen:**
- Verbraucht: `calNormalisiereKonfig`, `calPalette`.
- Erzeugt: `CAL_CARD_SCHEMA`, `CAL_LABELS`, Klasse `BuschCalendarCardEditor`.

- [ ] **Schritt 1: Editor und Anmeldung schreiben**

Hinter `BuschCalendarCard` einfügen:

```js
const CAL_CARD_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "entities",
    selector: { entity: { domain: "calendar", multiple: true } },
  },
  {
    name: "month_offset",
    selector: { number: { min: -24, max: 24, step: 1, mode: "box" } },
  },
  {
    type: "grid",
    schema: [
      { name: "navigation", selector: { boolean: {} } },
      { name: "show_empty_days", selector: { boolean: {} } },
      { name: "show_total", selector: { boolean: {} } },
      { name: "open_event_on_tap", selector: { boolean: {} } },
    ],
  },
];

const CAL_LABELS = {
  title: "Überschrift",
  entities: "Kalender",
  month_offset: "Monatsversatz (-1 = Vormonat)",
  navigation: "Pfeile zum Blättern",
  show_empty_days: "Leere Tage zeigen",
  show_total: "Summe in der Fußzeile",
  open_event_on_tap: "Klick öffnet den Kalender",
};

class BuschCalendarCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...CAL_STANDARD, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /** Der Entitaetsselektor liefert Zeichenketten. Eigene Farben, die schon
   *  gesetzt waren, muessen dabei erhalten bleiben. */
  _verschmelzeEntities(neueListe) {
    const alt = new Map();
    for (const e of this._config.entities || []) {
      if (typeof e === "object" && e.entity) alt.set(e.entity, e);
    }
    return (neueListe || []).map((id) => (alt.has(id) ? alt.get(id) : id));
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = CAL_CARD_SCHEMA;
      this._form.computeLabel = (schema) => CAL_LABELS[schema.name] || schema.name;
      this._form.addEventListener("value-changed", (ereignis) => {
        ereignis.stopPropagation();
        const werte = { ...ereignis.detail.value };
        werte.entities = this._verschmelzeEntities(werte.entities);
        this._config = { ...this._config, ...werte };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
        this._renderFarben();
      });
      this.appendChild(this._form);

      this._farbFeld = document.createElement("div");
      this._farbFeld.style.padding = "8px 0 0";
      this.appendChild(this._farbFeld);
    }

    this._form.hass = this._hass;
    // ha-form erwartet flache Zeichenketten im Entitaetsselektor.
    this._form.data = {
      ...this._config,
      entities: (this._config.entities || []).map((e) =>
        typeof e === "string" ? e : e.entity
      ),
    };
    this._renderFarben();
  }

  _renderFarben() {
    const normal = calNormalisiereKonfig(this._config);
    if (normal.entities.length < 2) {
      this._farbFeld.innerHTML = "";
      return;
    }
    this._farbFeld.innerHTML =
      `<div style="font-weight:600;margin:8px 0 4px">Farben</div>` +
      normal.entities
        .map((e) => {
          const name =
            (this._hass.states[e.entity] &&
              this._hass.states[e.entity].attributes.friendly_name) ||
            e.entity;
          return (
            `<label style="display:flex;align-items:center;gap:10px;padding:4px 0">` +
            `<input type="color" data-entity="${calEscape(e.entity)}" value="${calEscape(e.color)}">` +
            `<span>${calEscape(name)}</span></label>`
          );
        })
        .join("");

    for (const feld of this._farbFeld.querySelectorAll("input[type=color]")) {
      feld.addEventListener("change", (ereignis) => {
        const id = ereignis.target.dataset.entity;
        const liste = calNormalisiereKonfig(this._config).entities.map((e) => ({
          entity: e.entity,
          color: e.entity === id ? ereignis.target.value : e.color,
          ...(e.label ? { label: e.label } : {}),
        }));
        this._config = { ...this._config, entities: liste };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
      });
    }
  }
}

customElements.define("busch-calendar-card", BuschCalendarCard);
customElements.define("busch-calendar-card-editor", BuschCalendarCardEditor);

window.customCards.push({
  type: "busch-calendar-card",
  name: "Busch Kalender",
  description: "Termine als Monatsliste, mit Monatsversatz und Blättern.",
  preview: true,
  documentationURL: "https://github.com/luukkii123/ha-busch-cards",
});
```

**Wichtig:** Dieser Block gehört **hinter** den bestehenden
`window.customCards.push({ type: "busch-schedule-card", ... })`-Aufruf, denn
`window.customCards` wird dort angelegt.

- [ ] **Schritt 2: Version hochziehen**

In `dist/busch-cards.js`, Zeile 18:

```js
const CARD_VERSION = "0.5.0";
```

- [ ] **Schritt 3: Prüfen**

```bash
node --check dist/busch-cards.js && node --test tests/
```

Erwartet: alle Tests grün, Namensraum-Wächter grün.

- [ ] **Schritt 4: README ergänzen**

Füge in `README.md` einen Abschnitt zur neuen Karte ein: Kartentyp
`custom:busch-calendar-card`, die Optionstabelle aus Abschnitt 5 der Spec, und
ein YAML-Beispiel:

```yaml
type: custom:busch-calendar-card
title: Arbeitszeit
entities:
  - calendar.arbeitszeiten
month_offset: -1
show_total: true
```

- [ ] **Schritt 5: Commit**

```bash
git add dist/busch-cards.js README.md
git commit -m "Kalenderkarte: Editor, Anmeldung und Version 0.5.0

Alle Optionen sind im grafischen Editor einstellbar. Farben je Kalender
erscheinen erst ab dem zweiten Kalender.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 7: Nachweis im Chromium

**Ohne Messung wird nicht ausgeliefert.** Der Anblick allein ist kein Beweis.
Die Zahl der gerenderten Tageszeilen wird aus dem DOM ausgelesen und in eine
`report.json` geschrieben.

**Dateien:**
- Anlegen: `../docs/render/render-kalender.py` — liegt **außerhalb** des Repos,
  neben `render-zeitplan.py`, und wird nicht mitcommittet
- Anlegen: `docs/render/kalender/` im Repo, für die Bilder

**Muster:** `hacs/docs/render/render-zeitplan.py`. **Lies dieses Skript
vollständig, bevor du schreibst.** Es liefert die Datei über einen lokalen
HTTP-Server aus, setzt die CSS-Variablen des hellen Standardthemes, ersetzt
`ha-card` durch eine Attrappe und schreibt die tatsächlich gerenderten Texte
nach `report.json`. Übernimm diesen Aufbau. Auf dem Unraid-Server läuft
Playwright **nur im Container**, das lokal installierte scheitert an fehlendem
`libnspr4` und `libnss3`.

**Der Unterschied zum Zeitplan-Skript:** Die Kalenderkarte holt ihre Daten über
`hass.callApi`. Die Attrappe muss diese Methode bereitstellen und für August
2026 eine feste Terminliste liefern.

- [ ] **Schritt 1: Das Renderskript schreiben**

Aufruf: `render-kalender.py <pfad/busch-cards.js> <ausgabeordner> [breite]`

Der `hass`-Ersatz auf der Seite:

```js
const TERMINE = [
  {start:{dateTime:"2026-08-03T08:49:13+02:00"}, end:{dateTime:"2026-08-03T16:15:08+02:00"},
   summary:"DZ", description:"", location:null, uid:"e1"},
  {start:{dateTime:"2026-08-04T06:30:00+02:00"}, end:{dateTime:"2026-08-04T16:00:00+02:00"},
   summary:"TA", description:"", location:null, uid:"e2"},
  {start:{dateTime:"2026-08-05T09:00:07+02:00"}, end:{dateTime:"2026-08-05T17:44:54+02:00"},
   summary:"DZ", description:"", location:null, uid:"e3"},
  {start:{date:"2026-08-10"}, end:{date:"2026-08-13"},
   summary:"Urlaub", description:"drei Tage", location:"zu Hause", uid:"e4"},
];

const hass = {
  locale: { language: "de-DE" },
  states: {
    "calendar.arbeitszeiten": {
      state: "off",
      last_changed: "2026-08-01T00:00:00+02:00",
      attributes: { friendly_name: "Arbeitszeiten" },
    },
  },
  callApi: async (methode, pfad) => {
    if (!pfad.startsWith("calendars/")) return [];
    return TERMINE;
  },
};
```

**Die Uhr der Seite muss auf August 2026 stehen**, sonst rechnet
`month_offset: 0` einen anderen Monat aus. Setze sie in Playwright mit
`page.clock.install(time=datetime(2026, 8, 15, 12, 0))` **vor** dem Laden der
Seite. Steht die Uhr daneben, misst du einen leeren Monat und hältst das für
einen Fehler der Karte.

Gerendert werden **zwei** Karten auf derselben Seite:

```js
const a = document.createElement("busch-calendar-card");
a.setConfig({ entities: ["calendar.arbeitszeiten"], month_offset: 0,
              show_total: true, title: "Arbeitszeit" });
a.hass = hass;

const b = document.createElement("busch-calendar-card");
b.setConfig({ entities: ["calendar.arbeitszeiten"], month_offset: 0,
              show_empty_days: false, show_total: true });
b.hass = hass;
```

- [ ] **Schritt 2: Die Messung nach `report.json` schreiben**

Nach `page.wait_for_selector(".cal-tag")` aus dem DOM auslesen. Der
Auslesecode als einzeiliger Ausdruck, damit er in `page.evaluate` passt:

```python
AUSLESEN = (
    "() => [...document.querySelectorAll('busch-calendar-card')].map((k) => ({"
    "  monat: k.querySelector('.cal-monat') && k.querySelector('.cal-monat').textContent,"
    "  tageZeilen: k.querySelectorAll('.cal-tag').length,"
    "  ersteZeile: k.querySelector('.cal-tag .cal-datum')"
    "    && k.querySelector('.cal-tag .cal-datum').textContent.trim(),"
    "  letzteZeile: (() => { const a = [...k.querySelectorAll('.cal-tag .cal-datum')];"
    "    return a.length ? a[a.length - 1].textContent.trim() : null; })(),"
    "  termine: k.querySelectorAll('.cal-termin[data-uid]').length,"
    "  fuss: k.querySelector('.cal-fuss') && k.querySelector('.cal-fuss').textContent.trim(),"
    "}))"
)
bericht = page.evaluate(AUSLESEN)
```

- [ ] **Schritt 3: Laufen lassen und die Zahlen prüfen**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/docs/render"
python3 render-kalender.py ../../busch-cards/dist/busch-cards.js kalender 620
cat kalender/report.json
```

**Sollwerte.** Stimmt eine Zeile nicht, ist die Karte falsch, nicht der Sollwert:

| Feld | Karte A, leere Tage an | Karte B, leere Tage aus |
| --- | --- | --- |
| `monat` | `August 2026` | `August 2026` |
| `tageZeilen` | `31` | `6` |
| `ersteZeile` enthält | `1.` | `3.` |
| `letzteZeile` enthält | `31.` | `12.` |
| `fuss` enthält | `1 ganztägig` | `1 ganztägig` |

`tageZeilen = 31` ist **der** Nachweis, dass die Karte auf Monatsgrenzen rechnet
und nicht auf einem gleitenden Fenster ab heute. Karte B zeigt sechs Zeilen: den
3., 4. und 5. sowie den 10., 11. und 12. für den dreitägigen Urlaub.

Die Stundensumme aus den drei zeitgebundenen Terminen:

```
03.08.  08:49:13 – 16:15:08  =  7,432 h
04.08.  06:30:00 – 16:00:00  =  9,500 h
05.08.  09:00:07 – 17:44:54  =  8,746 h
                       Summe = 25,7 h  (auf eine Stelle gerundet)
```

Im Fuß muss `25,7 h` stehen, dazu `5 Tage` und `1 ganztägig`.

- [ ] **Schritt 4: Die Bilder wirklich ansehen**

```bash
ls kalender/
```

Ein CSS-Syntaxfehler aus Aufgabe 5 schlägt in keinem Test an. Der Browser
verwirft die kaputte Regel still, und die Karte sieht falsch aus, ohne dass
irgendetwas meldet. Prüfe am Bild: fluchten die Datumsspalten, ist der Fuß
abgesetzt, sind Wochenenden erkennbar, bricht nichts waagrecht aus.

- [ ] **Schritt 5: Die Zeitplan-Karte gegenprüfen**

**Nicht optional.** Die neue Karte teilt sich die Datei mit der Zeitplan-Karte.

```bash
python3 render-zeitplan.py ../../busch-cards/dist/busch-cards.js zeitplan-nach-kalender
cat zeitplan-nach-kalender/report.json
```

Die `blockTexts` müssen dieselben Uhrzeiten zeigen wie im Bestand unter
`docs/render/zeitplan/report.json`, im Format `08:00` und **nicht** `01:00 AM`.
Genau dieser Vergleich hat den `formatClock`-Fehler von v0.3.0 sichtbar gemacht.

- [ ] **Schritt 6: Bilder ins Repo und committen**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards"
mkdir -p docs/render/kalender
cp ../docs/render/kalender/*.png docs/render/kalender/
git add docs/render/kalender
git commit -m "Kalenderkarte: Nachweis aus Chromium

August 2026 mit 31 Tageszeilen gemessen, Summe 25,7 h, ein ganztaegiger
Termin. Zeitplan-Karte zeigt unveraenderte Uhrzeiten.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Aufgabe 8: Ausliefern

Erst wenn Aufgabe 7 die Sollwerte getroffen hat.

- [ ] **Schritt 1: Alles noch einmal prüfen**

```bash
cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards"
node --check dist/busch-cards.js && node --test tests/ && git status --short
```

Erwartet: Tests grün, sauberer Arbeitsbaum.

- [ ] **Schritt 2: Version bestätigen**

```bash
grep -n 'CARD_VERSION = ' dist/busch-cards.js
```

Erwartet: `0.5.0`. Steht dort `0.4.0`, wurde Aufgabe 6 Schritt 2 übersprungen.

- [ ] **Schritt 3: Hochschieben und taggen**

```bash
git push origin main
git tag v0.5.0
git push origin v0.5.0
```

**HACS liest den Tag, nicht `main`.** Ohne Tag ändert sich für den Nutzer
nichts, und jede spätere Prüfung im laufenden Home Assistant misst weiter die
alte Fassung.

- [ ] **Schritt 4: In Home Assistant aktualisieren**

HACS öffnen, `Busch Cards` auf `v0.5.0` aktualisieren, Browser hart neu laden.
Dann die Karte einsetzen:

```yaml
type: custom:busch-calendar-card
title: Arbeitszeit
entities:
  - calendar.arbeitszeiten
month_offset: -1
show_total: true
```

Heute ist der 06.09.2026. Die Karte muss den **vollständigen August 2026**
zeigen, 31 Tage, erster bis letzter. `calendar.arbeitszeiten` hatte in diesem
Monat an 20 von 31 Tagen einen Eintrag, der 3. August lief von 08:49 bis 16:15.

- [ ] **Schritt 5: Die alte Karte nicht anfassen**

Die bisherige `custom:calendar-card-pro` in der Ansicht `lukas-arbeitszeit`
bleibt stehen. **Ob sie weicht, entscheidet der Nutzer.** Die neue Karte wird
daneben gesetzt, nicht an ihre Stelle.

- [ ] **Schritt 6: `hacs/CLAUDE.md` fortschreiben**

Versionstabelle oben auf `ha-busch-cards` `v0.5.0` setzen, unter „HIER
WEITERMACHEN" den Stand festhalten, und `docs/render/render-kalender.py` im
Abschnitt „Karten im Browser prüfen" nennen. Diese Datei liegt **außerhalb**
des Repos und wird nicht mitcommittet.
