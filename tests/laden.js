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
