"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
 *
 * `zusatz` ersetzt einzelne Einträge der Sandbox-Umgebung — gedacht für eine
 * reichere DOM-Attrappe, mit der sich die Kartenklasse selbst ausführen lässt.
 * Ersetzt wird jeweils der ganze Eintrag, nicht in die Tiefe gemischt.
 */
function ladeKarte(namen, zusatz) {
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
  Object.assign(kontext, zusatz || {});
  kontext.globalThis = kontext;
  vm.createContext(kontext);
  const sammler = `\n;({ ${namen.join(", ")} });`;
  return vm.runInContext(quelle() + sammler, kontext);
}

/**
 * Alle Deklarationen, die am Zeilenanfang stehen, in Reihenfolge. Das ist das
 * GROBE Netz: Es liest hübsche Namen für die Fehlermeldung heraus, aber es
 * sieht nur die Spalte 0. Der eigentliche Nachweis, dass kein Name doppelt
 * vergeben ist, kommt von `modulFehler()` darunter — dieses Muster hier hat
 * genau daran vorbeigesehen (`  function clamp(…)` mit zwei Leerzeichen).
 */
function topLevelNamen() {
  const namen = [];
  for (const zeile of quelle().split("\n")) {
    const treffer = zeile.match(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
    if (treffer) namen.push(treffer[1]);
  }
  return namen;
}

let pruefZaehler = 0;

/**
 * Fragt den Parser von Node selbst, statt ein Textmuster über die Datei zu
 * legen: Die Quelle wird als **ES-Modul** geprüft — so, wie Home Assistant sie
 * lädt (Lovelace-Ressource vom Typ „JavaScript-Modul"), und so, wie sie im
 * Browser wirklich ausgewertet wird.
 *
 * Warum ausgerechnet Modul-Semantik? Weil sie den blinden Fleck schließt,
 * ohne ein zweites Mal raten zu müssen:
 *
 *   In einem SKRIPT sind zwei gleichnamige `function`-Deklarationen auf
 *   oberster Ebene erlaubt. Die zweite gewinnt still — genau der Unfall, den
 *   dieses Repo fürchtet, weil sich drei Karten eine Datei und einen
 *   Gültigkeitsbereich teilen. `node --check` auf eine `.js`-Datei schweigt
 *   dazu, gemessen.
 *
 *   In einem MODUL zählen auch Funktionen auf oberster Ebene als lexikalische
 *   Deklarationen. Eine doppelte ist dort ein SyntaxError — unabhängig von
 *   der Einrückung, weil ein Parser keine Spalten liest, sondern Blöcke.
 *   Deklarationen INNERHALB einer Funktion oder Klasse haben ihren eigenen
 *   Gültigkeitsbereich und lösen deshalb keinen Fehlalarm aus.
 *
 * Ergebnis: `null`, wenn alles sauber ist, sonst die Fehlerzeile von Node.
 * `text` ist optional; ohne Angabe wird die ausgelieferte Datei geprüft.
 */
function modulFehler(text) {
  const datei = path.join(
    os.tmpdir(),
    `busch-cards-pruefung-${process.pid}-${(pruefZaehler += 1)}.mjs`
  );
  fs.writeFileSync(datei, text === undefined ? quelle() : text);
  try {
    execFileSync(process.execPath, ["--check", datei], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return null;
  } catch (fehler) {
    const ausgabe = String(fehler.stderr || fehler.message || "");
    const zeile = ausgabe
      .split("\n")
      .map((z) => z.trim())
      .find((z) => /Error:/.test(z));
    return zeile || ausgabe.trim() || "unbekannter Parserfehler";
  } finally {
    fs.rmSync(datei, { force: true });
  }
}

module.exports = { ladeKarte, topLevelNamen, modulFehler, quelle, KARTE };
