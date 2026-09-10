# busch-device-card 0.11.0 — Umsetzungsplan

> **Für agentische Umsetzer:** PFLICHT-TEILSKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe.
> Schritte nutzen Kästchen (`- [ ]`) zur Nachverfolgung.

**Ziel:** Die Gerätekarte bekommt Dienstaufrufe mit Kontextvariablen auf
Kopfzeile und Entitätenzeilen, klappbare Gruppen mit einstellbarem
Startzustand, einen echten Zuklapp-Zustand und einen ausschließenden
Label-Filter.

**Architektur:** Alle neuen Entscheidungen sind **reine Funktionen** ohne DOM
(Migration, Aktionsnormalisierung, Kontext, Platzhalter, Zielfüllung,
Gruppenwahl, Schemafilterung) und laufen unter Node. Die Kartenklasse ruft nur
noch auf. Aktionen führt **eine** Funktion aus, `devFuehreAus`, für Kopfzeile
und Zeilen gleichermaßen. Zeilenklicks werden nicht abgefangen, sondern über
HAs `hass-more-info`-Ereignis am Listencontainer erkannt.

**Technik:** Vanilla JavaScript, Custom Elements, kein Build, keine
Abhängigkeit. Tests mit `node --test` und `node:vm` über `tests/laden.js`.
Darstellung im Playwright-Container mit `docs/render/regeln.py`.

**Spec:** `docs/superpowers/specs/2026-09-10-geraetekarte-aktionen-design.md`
(Vorgänger: `…/2026-09-09-geraetekarte-design.md`)

## Globale Vorgaben

- **Kein `npm`, keine `package.json`, keine Abhängigkeit.** Nur eingebaute
  Node-Bausteine. Die Datei liegt auf einer SMB-Share.
- **Kein Build.** `dist/busch-cards.js` ist Quelle und Auslieferung.
- **Testbefehl ist `node --test tests/*.test.js`.** `node --test tests/`
  scheitert unter Node 22 mit `MODULE_NOT_FOUND`.
- **Jeder neue Name auf oberster Ebene beginnt mit `dev` oder `DEV_`.**
  Ausnahmen bleiben `SCHEMA_BUSCH_DEVICE_CARD`, `TEXTE_BUSCH_DEVICE_CARD`,
  `BuschDeviceCard`, `BuschDeviceCardEditor`, `waehlerGeraet`.
- **`SCHEMA_BUSCH_DEVICE_CARD` bleibt ein Objektliteral auf oberster Ebene**
  mit **allen** Feldern. `scripts/ui-regeln-pruefen.py` liest es über
  Klammernpaarung aus dem Quelltext; eine berechnete Schemafunktion wäre für
  die Prüfung unsichtbar. Gefiltert wird erst im Editor.
- **Nutzersichtbarer Text nur in `TEXTE_BUSCH_DEVICE_CARD`**, beide Sprachen,
  jedes Schemablatt mit `labels` **und** `helpers`, jeder Helper endet mit
  einem Punkt und nennt die Vorgabe.
- **Kein `config.<schlüssel>` ohne Schemafeld** (Regel 3.3).
- **Regel 1:** einzeilige Textcontainer tragen
  `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`;
  mehrzeilige `overflow-wrap:anywhere`.
- **`CARD_VERSION`** wird erst in Aufgabe 8 auf `"0.11.0"` gesetzt.
- Nach **jeder** Änderung an `dist/busch-cards.js`:
  `node --check dist/busch-cards.js` **und** `node --test tests/*.test.js`.
- Sandbox-Falle: Listen und Objekte aus der Karte tragen einen fremden
  `Array.prototype`. **Kein `deepStrictEqual`** darauf; vergleichen über
  `JSON.stringify`, `length` und Index.
- **Fremde Arbeit nicht mitcommitten.** In `hacs/` arbeitet eine zweite
  Sitzung an `ha-unraid-ssh-integrations`. Immer `git add <pfad>`, nie
  `git add -A`, und vor jedem Commit im `hacs`-Repo `git status` lesen.

---

### Aufgabe 1: Migration und Aktionsnormalisierung

**Dateien:**
- Ändern: `tests/geraet.test.js` (anhängen)
- Ändern: `dist/busch-cards.js` — im `dev`-Abschnitt, direkt hinter
  `DEV_VORLAGEN`

**Schnittstellen:**
- Erzeugt: `DEV_GRUPPEN_WERTE` = `["control","sensor","config","diagnostic"]`.
- Erzeugt: `DEV_HA_AKTIONEN` = `["more-info","toggle","navigate","url","perform-action","none"]`.
- Erzeugt: `DEV_ARTEN` = `["expand","device-page","ha"]`.
- Erzeugt: `devAktionNormalisieren(wert, altPfad) → {action, …} | undefined`.
- Erzeugt: `devMigriereKonfig(config) → config` — idempotent.
- Erzeugt: `devArtVon(aktion) → "expand" | "device-page" | "ha"`.
- Ändert: `DEV_STANDARD` — `show_config`/`show_diagnostic`/`navigation_path`
  raus, `labels_hide`/`groups`/`groups_open`/`row_tap_action`/`row_hold_action`
  rein, `tap_action`/`hold_action` werden Objekte.
- Entfällt: `DEV_AKTIONEN` (die alte Zeichenkettenliste).

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

An `tests/geraet.test.js` anhängen; oben im `ladeKarte`-Aufruf die Namen
`DEV_GRUPPEN_WERTE`, `DEV_HA_AKTIONEN`, `DEV_ARTEN`, `devAktionNormalisieren`,
`devMigriereKonfig`, `devArtVon` ergänzen und `DEV_AKTIONEN` dort streichen:

```js
/* ── Aktionsform und Migration (Spec 0.11.0, Abschnitt 3) ──────────────── */

test("eine Zeichenkette wird zur Objektform, ein Objekt bleibt", () => {
  assert.strictEqual(devAktionNormalisieren("expand").action, "expand");
  assert.strictEqual(devAktionNormalisieren({ action: "toggle" }).action, "toggle");
  assert.strictEqual(devAktionNormalisieren(undefined), undefined);
  assert.strictEqual(devAktionNormalisieren(null), undefined);
  assert.strictEqual(devAktionNormalisieren({}), undefined, "ohne action ist es keine Aktion");
});

test("die alte call-service-Form wird zu perform-action", () => {
  const a = devAktionNormalisieren({ action: "call-service", service: "light.turn_on", service_data: { x: 1 } });
  assert.strictEqual(a.action, "perform-action");
  assert.strictEqual(a.perform_action, "light.turn_on");
  assert.strictEqual(a.service, undefined);
  assert.strictEqual(JSON.stringify(a.data), '{"x":1}');
  assert.strictEqual(a.service_data, undefined);
});

test("ein altes navigation_path wandert in die Navigationsaktion", () => {
  const a = devAktionNormalisieren("navigate", "/lovelace/geraete");
  assert.strictEqual(a.navigation_path, "/lovelace/geraete");
  // Ein bereits gesetzter Pfad gewinnt.
  const b = devAktionNormalisieren({ action: "navigate", navigation_path: "/a" }, "/b");
  assert.strictEqual(b.navigation_path, "/a");
});

test("devArtVon trennt eigene Arten von HAs Arten", () => {
  assert.strictEqual(devArtVon({ action: "expand" }), "expand");
  assert.strictEqual(devArtVon({ action: "device-page" }), "device-page");
  assert.strictEqual(devArtVon({ action: "perform-action" }), "ha");
  assert.strictEqual(devArtVon({ action: "more-info" }), "ha");
  assert.strictEqual(devArtVon(undefined), "ha");
  assert.strictEqual(JSON.stringify(DEV_ARTEN), '["expand","device-page","ha"]');
});

test("die Migration bildet jede Zeile der Spec-Tabelle ab", () => {
  const alt = {
    entity: "light.decke",
    tap_action: "expand",
    hold_action: "more-info",
    navigation_path: "/lovelace/x",
    show_config: false,
    show_diagnostic: true,
  };
  const neu = devMigriereKonfig(alt);
  assert.strictEqual(neu.tap_action.action, "expand");
  assert.strictEqual(neu.hold_action.action, "more-info");
  assert.strictEqual(neu.navigation_path, undefined, "der alte Schluessel verschwindet");
  assert.strictEqual(neu.show_config, undefined);
  assert.strictEqual(neu.show_diagnostic, undefined);
  assert.strictEqual(JSON.stringify(neu.groups), '["control","sensor","diagnostic"]');
});

test("show_diagnostic false nimmt nur die Diagnose heraus", () => {
  const neu = devMigriereKonfig({ entity: "x.y", show_diagnostic: false });
  assert.strictEqual(JSON.stringify(neu.groups), '["control","sensor","config"]');
});

test("die Migration ist idempotent", () => {
  const alt = { entity: "light.decke", tap_action: "navigate", navigation_path: "/x", show_config: false };
  const einmal = devMigriereKonfig(alt);
  const zweimal = devMigriereKonfig(einmal);
  assert.strictEqual(JSON.stringify(zweimal), JSON.stringify(einmal));
  assert.strictEqual(zweimal.tap_action.navigation_path, "/x");
});

test("eine Konfiguration ohne Altlasten bleibt unveraendert", () => {
  const neu = { entity: "light.decke", groups: ["control"], tap_action: { action: "expand" } };
  assert.strictEqual(JSON.stringify(devMigriereKonfig(neu)), JSON.stringify(neu));
});

test("die neuen Vorgaben stehen in DEV_STANDARD", () => {
  assert.strictEqual(JSON.stringify(DEV_STANDARD.groups), '["control","sensor","config","diagnostic"]');
  assert.strictEqual(JSON.stringify(DEV_STANDARD.groups_open), '["control"]');
  assert.strictEqual(JSON.stringify(DEV_STANDARD.labels_hide), "[]");
  assert.strictEqual(DEV_STANDARD.tap_action.action, "expand");
  assert.strictEqual(DEV_STANDARD.hold_action.action, "more-info");
  assert.strictEqual(DEV_STANDARD.row_tap_action.action, "more-info");
  assert.strictEqual(DEV_STANDARD.row_hold_action.action, "none");
  assert.strictEqual(DEV_STANDARD.show_config, undefined, "abgeloest durch groups");
  assert.strictEqual(DEV_STANDARD.navigation_path, undefined, "steckt jetzt in der Aktion");
  assert.strictEqual(JSON.stringify(DEV_HA_AKTIONEN),
    '["more-info","toggle","navigate","url","perform-action","none"]');
  assert.strictEqual(JSON.stringify(DEV_GRUPPEN_WERTE),
    '["control","sensor","config","diagnostic"]');
});
```

Außerdem in derselben Datei die **bestehenden** Erwartungen anpassen, die auf
der alten Form stehen:

- Im Test „die Vorgaben stimmen mit Spec Abschnitt 8 ueberein" werden
  `k.tap_action` / `k.hold_action` jetzt Objekte: `assert.strictEqual(k.tap_action.action, "expand")`
  und `assert.strictEqual(k.hold_action.action, "more-info")`. Die Zeilen zu
  `show_config`, `show_diagnostic` und `navigation_path` werden ersetzt durch
  `assert.strictEqual(JSON.stringify(k.groups), '["control","sensor","config","diagnostic"]')`
  und `assert.strictEqual(JSON.stringify(k.groups_open), '["control"]')`.
- Im Test „gesetzte Werte bleiben, labels wird immer eine Liste" wird
  `tap_action: "toggle"` zu `tap_action: { action: "toggle" }` und die
  Behauptung zu `assert.strictEqual(k.tap_action.action, "toggle")`.
- Der Test „ein unbekannter Aktionswert faellt auf die Vorgabe zurueck" prüft
  jetzt: `devNormalisiereKonfig({ entity: "x.y", tap_action: { action: "fliegen" } }).tap_action.action`
  ist `"fliegen"` — **unbekannte Aktionen werden nicht mehr zurückgesetzt**,
  sondern von `devFuehreAus` schlicht ignoriert (Spec Abschnitt 3.3, Zeile
  „`none`, unbekannt"). Der Testname wird zu
  „eine unbekannte Aktion bleibt stehen und tut spaeter nichts".
- Der Test „show_config / show_diagnostic blenden ihre Gruppe ganz aus" wird in
  Aufgabe 3 durch den Gruppentest ersetzt; hier vorerst unverändert lassen, er
  schlägt bis Aufgabe 3 fehl. **Damit er nicht stört, in Aufgabe 1 gleich
  mitziehen:** `devNormalisiereKonfig({ entity: "light.decke", groups: ["sensor"] })`
  und Erwartung `"sensor"`.

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `cd "/mnt/user/Data/Claude Projekte/hacs/busch-cards" && node --test tests/geraet.test.js`
Erwartet: FAIL — `DEV_GRUPPEN_WERTE is not defined`.

- [ ] **Schritt 3: Umsetzen**

In `dist/busch-cards.js` den Block `const DEV_STANDARD = { … };` und
`const DEV_AKTIONEN = […];` **ersetzen** durch:

```js
const DEV_GRUPPEN_WERTE = ["control", "sensor", "config", "diagnostic"];

/** Die Aktionen, die Home Assistant selbst übersetzt. `assist` fehlt
 *  bewusst — sein Dialog kommt über einen bundle-internen Import, an den
 *  eine Karte nicht herankommt (Spec Abschnitt 2). */
const DEV_HA_AKTIONEN = ["more-info", "toggle", "navigate", "url", "perform-action", "none"];

/** Die Art einer Kopfzeilen-Geste im Editor. `ha` heißt: HAs eigener
 *  Aktionseditor entscheidet, was drinsteht. */
const DEV_ARTEN = ["expand", "device-page", "ha"];

const DEV_STANDARD = {
  title: "",
  template: "auto",
  labels: [],
  labels_hide: [],
  groups: ["control", "sensor", "config", "diagnostic"],
  groups_open: ["control"],
  show_subtitle: true,
  start_expanded: false,
  tap_action: { action: "expand" },
  hold_action: { action: "more-info" },
  row_tap_action: { action: "more-info" },
  row_hold_action: { action: "none" },
};

/**
 * Eine Aktion in HAs Objektform bringen.
 *
 * `altPfad` ist das `navigation_path` aus einer Konfiguration vor `0.11.0`,
 * wo der Pfad neben der Aktion stand statt in ihr.
 */
function devAktionNormalisieren(wert, altPfad) {
  if (wert === undefined || wert === null) return undefined;
  const a = typeof wert === "string" ? { action: wert } : { ...wert };
  if (!a.action || typeof a.action !== "string") return undefined;
  if (a.action === "call-service") {
    a.action = "perform-action";
    if (a.service && !a.perform_action) a.perform_action = a.service;
    if (a.service_data && !a.data) a.data = a.service_data;
    delete a.service;
    delete a.service_data;
  }
  if (a.action === "navigate" && !a.navigation_path && altPfad) a.navigation_path = altPfad;
  return a;
}

/**
 * Eine Konfiguration aus `0.10.x` auf die Form von `0.11.0` bringen.
 * **Idempotent** — ein zweiter Durchlauf ändert nichts mehr.
 */
function devMigriereKonfig(config) {
  const k = { ...(config || {}) };
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    const a = devAktionNormalisieren(k[feld], k.navigation_path);
    if (a === undefined) delete k[feld];
    else k[feld] = a;
  }
  delete k.navigation_path;
  if (k.show_config !== undefined || k.show_diagnostic !== undefined) {
    const vorhanden = Array.isArray(k.groups) ? k.groups : DEV_GRUPPEN_WERTE;
    const weg = [];
    if (k.show_config === false) weg.push("config");
    if (k.show_diagnostic === false) weg.push("diagnostic");
    k.groups = DEV_GRUPPEN_WERTE.filter((g) => vorhanden.includes(g) && !weg.includes(g));
    delete k.show_config;
    delete k.show_diagnostic;
  }
  return k;
}

/** Welche Art hat diese Aktion im Editor? */
function devArtVon(aktion) {
  const a = aktion && aktion.action;
  return a === "expand" || a === "device-page" ? a : "ha";
}
```

Und `devNormalisiereKonfig` ersetzen durch:

```js
function devNormalisiereKonfig(config) {
  const roh = devMigriereKonfig(config);
  const k = { ...DEV_STANDARD, ...roh };
  k.entity = typeof roh.entity === "string" ? roh.entity : "";
  for (const feld of ["labels", "labels_hide"]) {
    if (typeof roh[feld] === "string") k[feld] = [roh[feld]];
    else if (Array.isArray(roh[feld])) k[feld] = roh[feld].filter((l) => typeof l === "string");
    else k[feld] = [];
  }
  for (const [feld, erlaubt] of [["groups", DEV_GRUPPEN_WERTE], ["groups_open", DEV_GRUPPEN_WERTE]]) {
    const liste = Array.isArray(roh[feld]) ? roh[feld] : DEV_STANDARD[feld];
    k[feld] = erlaubt.filter((w) => liste.includes(w));
  }
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    k[feld] = devAktionNormalisieren(k[feld]) || { ...DEV_STANDARD[feld] };
  }
  if (typeof k.title !== "string") k.title = "";
  return k;
}
```

- [ ] **Schritt 4: Prüfen, muss grün sein**

Run: `node --check dist/busch-cards.js && node --test tests/*.test.js`
Erwartet: alle grün. `namensraum.test.js` bleibt grün.

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Aktionen in HAs Objektform, Migration der Kurzform"
```

---

### Aufgabe 2: Kontext, Platzhalter, Zielfüllung, Ausführung

**Dateien:**
- Ändern: `tests/geraet.test.js` (anhängen)
- Ändern: `dist/busch-cards.js` — hinter `devArtVon`

**Schnittstellen:**
- Consumes: `devAktionNormalisieren`, `devArtVon` aus Aufgabe 1.
- Erzeugt: `devKontext(entityId, geraet, bereich) → {entity, device, area}`.
- Erzeugt: `devPlatzhalterErsetzen(wert, kontext) → wert` (rekursiv).
- Erzeugt: `devZielFuellen(aktion, kontext) → aktion`.
- Erzeugt: `devNavigiere(pfad)` — `history.pushState` + `location-changed`.
- Erzeugt: `devFuehreAus(karte, hass, aktion, kontext)`.
- Erwartet von der Kartenklasse (Aufgabe 5): `karte._umschalten()` und
  `karte._zeigeDienstFehler(fehler)`; beide werden vor dem Aufruf auf
  `typeof … === "function"` geprüft, damit `devFuehreAus` auch ohne Karte läuft.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Namen `devKontext`, `devPlatzhalterErsetzen`, `devZielFuellen`, `devFuehreAus`
im `ladeKarte`-Aufruf ergänzen, dann anhängen:

```js
/* ── Kontext und Platzhalter (Spec 0.11.0, Abschnitt 4) ────────────────── */

const KONTEXT = { entity: "sensor.a", device: "d1", area: "wohnzimmer" };

test("devKontext liest Entitaet, Geraet und Bereich", () => {
  const k = devKontext("sensor.a", { id: "d1" }, { area_id: "wohnzimmer" });
  assert.strictEqual(k.entity, "sensor.a");
  assert.strictEqual(k.device, "d1");
  assert.strictEqual(k.area, "wohnzimmer");
  const ohne = devKontext("", null, null);
  assert.strictEqual(ohne.entity, "");
  assert.strictEqual(ohne.device, "");
  assert.strictEqual(ohne.area, "");
});

test("die drei Platzhalter werden ersetzt, mit und ohne Leerzeichen", () => {
  assert.strictEqual(devPlatzhalterErsetzen("{{ entity }}", KONTEXT), "sensor.a");
  assert.strictEqual(devPlatzhalterErsetzen("{{entity}}", KONTEXT), "sensor.a");
  assert.strictEqual(devPlatzhalterErsetzen("{{ device }}", KONTEXT), "d1");
  assert.strictEqual(devPlatzhalterErsetzen("{{ area }}", KONTEXT), "wohnzimmer");
  assert.strictEqual(devPlatzhalterErsetzen("vor {{ entity }} nach", KONTEXT), "vor sensor.a nach");
});

test("Platzhalter greifen in der Tiefe, durch Objekte und Listen", () => {
  const ein = { a: { b: ["{{ entity }}", { c: "{{ device }}" }] }, d: 7, e: true, f: null };
  const aus = devPlatzhalterErsetzen(ein, KONTEXT);
  assert.strictEqual(JSON.stringify(aus), '{"a":{"b":["sensor.a",{"c":"d1"}]},"d":7,"e":true,"f":null}');
  assert.strictEqual(JSON.stringify(ein.a.b[0]), '"{{ entity }}"', "die Vorlage bleibt unberuehrt");
});

test("ein unbekannter Ausdruck bleibt woertlich stehen", () => {
  assert.strictEqual(devPlatzhalterErsetzen("{{ state }}", KONTEXT), "{{ state }}");
  assert.strictEqual(devPlatzhalterErsetzen("{{ entity | upper }}", KONTEXT), "{{ entity | upper }}");
});

test("ein leerer Bereich ergibt eine leere Zeichenkette, keinen Platzhalter", () => {
  assert.strictEqual(devPlatzhalterErsetzen("x{{ area }}y", { entity: "a", device: "b", area: "" }), "xy");
});

test("ein leeres Ziel fuellt sich mit der Entitaet des Kontexts", () => {
  const a = devZielFuellen({ action: "perform-action", perform_action: "x.y" }, KONTEXT);
  assert.strictEqual(JSON.stringify(a.target), '{"entity_id":"sensor.a"}');
  const b = devZielFuellen({ action: "perform-action", perform_action: "x.y", target: {} }, KONTEXT);
  assert.strictEqual(JSON.stringify(b.target), '{"entity_id":"sensor.a"}');
});

test("ein gesetztes Ziel bleibt unangetastet, auch eine fremde Entitaet", () => {
  const a = devZielFuellen(
    { action: "perform-action", perform_action: "x.y", target: { entity_id: "light.fremd" } }, KONTEXT);
  assert.strictEqual(JSON.stringify(a.target), '{"entity_id":"light.fremd"}');
  const b = devZielFuellen({ action: "toggle" }, KONTEXT);
  assert.strictEqual(b.target, undefined, "nur perform-action bekommt ein Ziel");
});

/* ── Ausfuehrung (Spec 0.11.0, Abschnitt 3.3) ──────────────────────────── */

/** Eine Karten-Attrappe, die nur mitschreibt. */
function karteAttrappe() {
  return {
    umschaltungen: 0, ereignisse: [], fehler: [],
    _umschalten() { this.umschaltungen += 1; },
    _zeigeDienstFehler(f) { this.fehler.push(String(f)); },
    dispatchEvent(ev) { this.ereignisse.push(ev); },
  };
}

/** Eine hass-Attrappe, die Dienstaufrufe mitschreibt. */
function hassAttrappe(werfen) {
  return {
    aufrufe: [],
    callService(domain, dienst, daten, ziel) {
      this.aufrufe.push({ domain, dienst, daten, ziel });
      return werfen ? Promise.reject(new Error("Dienst kaputt")) : Promise.resolve();
    },
  };
}

test("perform-action ruft den Dienst mit ersetztem Ziel und ersetzten Daten", async () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  devFuehreAus(karte, hass, {
    action: "perform-action", perform_action: "label.add",
    target: { entity_id: "{{ entity }}" }, data: { label_id: "geprueft", geraet: "{{ device }}" },
  }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(hass.aufrufe.length, 1);
  assert.strictEqual(hass.aufrufe[0].domain, "label");
  assert.strictEqual(hass.aufrufe[0].dienst, "add");
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].ziel), '{"entity_id":"sensor.a"}');
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].daten), '{"label_id":"geprueft","geraet":"d1"}');
});

test("perform-action ohne Ziel nimmt die Entitaet des Kontexts", async () => {
  const hass = hassAttrappe(false);
  devFuehreAus(karteAttrappe(), hass, { action: "perform-action", perform_action: "homeassistant.turn_on" }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(JSON.stringify(hass.aufrufe[0].ziel), '{"entity_id":"sensor.a"}');
});

test("ein Dienst ohne Punkt ruft nichts auf", async () => {
  const hass = hassAttrappe(false);
  for (const wert of [undefined, "", "licht", ".turn_on", "light."]) {
    devFuehreAus(karteAttrappe(), hass, { action: "perform-action", perform_action: wert }, KONTEXT);
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(hass.aufrufe.length, 0);
});

test("ein fehlgeschlagener Dienstaufruf landet bei der Karte, nicht im Nichts", async () => {
  const karte = karteAttrappe();
  devFuehreAus(karte, hassAttrappe(true), { action: "perform-action", perform_action: "x.y" }, KONTEXT);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(karte.fehler.length, 1);
  assert.ok(/Dienst kaputt/.test(karte.fehler[0]));
});

test("toggle, more-info, expand und none tun genau eines", async () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  devFuehreAus(karte, hass, { action: "toggle" }, KONTEXT);
  assert.strictEqual(JSON.stringify(hass.aufrufe[0]),
    '{"domain":"homeassistant","dienst":"toggle","daten":{"entity_id":"sensor.a"}}');
  devFuehreAus(karte, hass, { action: "more-info" }, KONTEXT);
  assert.strictEqual(karte.ereignisse.length, 1);
  assert.strictEqual(karte.ereignisse[0].detail.entityId, "sensor.a");
  devFuehreAus(karte, hass, { action: "expand" }, KONTEXT);
  assert.strictEqual(karte.umschaltungen, 1);
  devFuehreAus(karte, hass, { action: "none" }, KONTEXT);
  devFuehreAus(karte, hass, { action: "gibtsnicht" }, KONTEXT);
  devFuehreAus(karte, hass, undefined, KONTEXT);
  assert.strictEqual(hass.aufrufe.length, 1, "keine weiteren Dienstaufrufe");
  assert.strictEqual(karte.ereignisse.length, 1);
  assert.strictEqual(karte.umschaltungen, 1);
});

test("navigate und url ohne Pfad tun nichts", () => {
  const karte = karteAttrappe();
  const hass = hassAttrappe(false);
  // Ohne Pfad darf nichts passieren und nichts werfen.
  devFuehreAus(karte, hass, { action: "navigate" }, KONTEXT);
  devFuehreAus(karte, hass, { action: "url" }, KONTEXT);
  assert.strictEqual(hass.aufrufe.length, 0);
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet.test.js` — FAIL, `devKontext is not defined`.

- [ ] **Schritt 3: Umsetzen**

Hinter `devArtVon` einfügen:

```js
/** Der Kontext, in dem eine Aktion läuft. */
function devKontext(entityId, geraet, bereich) {
  return {
    entity: entityId || "",
    device: (geraet && geraet.id) || "",
    area: (bereich && (bereich.area_id || bereich.id)) || "",
  };
}

/**
 * Drei Platzhalter, rekursiv in jeder Zeichenkette ersetzt. **Kein Jinja.**
 * Was nicht auf dieses Muster passt, bleibt wörtlich stehen — so sieht der
 * Nutzer im Dienstaufruf, dass sein Ausdruck nicht gegriffen hat.
 */
function devPlatzhalterErsetzen(wert, kontext) {
  if (typeof wert === "string") {
    return wert.replace(/\{\{\s*(entity|device|area)\s*\}\}/g, (ganz, name) => {
      const w = kontext[name];
      return w === undefined || w === null ? ganz : String(w);
    });
  }
  if (Array.isArray(wert)) return wert.map((x) => devPlatzhalterErsetzen(x, kontext));
  if (wert && typeof wert === "object") {
    const aus = {};
    for (const s of Object.keys(wert)) aus[s] = devPlatzhalterErsetzen(wert[s], kontext);
    return aus;
  }
  return wert;
}

/** Ein leeres Ziel füllt sich mit der Entität des Kontexts. */
function devZielFuellen(aktion, kontext) {
  if (!aktion || aktion.action !== "perform-action") return aktion;
  const z = aktion.target;
  const leer = !z || (typeof z === "object" && Object.keys(z).length === 0);
  if (!leer || !kontext.entity) return aktion;
  return { ...aktion, target: { entity_id: kontext.entity } };
}

/** So navigiert HA selbst (`src/common/navigate.ts`). */
function devNavigiere(pfad) {
  history.pushState(null, "", pfad);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/**
 * Die einzige Stelle, die eine Aktion ausführt — für Kopfzeile und Zeilen.
 * `karte` darf fehlen; dann entfallen die Wege, die sie brauchen.
 */
function devFuehreAus(karte, hass, aktion, kontext) {
  const art = aktion && aktion.action;
  if (!art || art === "none") return;

  if (art === "expand") {
    if (karte && typeof karte._umschalten === "function") karte._umschalten();
    return;
  }
  if (art === "device-page") {
    if (kontext.device) devNavigiere(`/config/devices/device/${kontext.device}`);
    return;
  }
  if (art === "more-info") {
    if (!kontext.entity || !karte) return;
    karte.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: kontext.entity }, bubbles: true, composed: true,
    }));
    return;
  }
  if (art === "toggle") {
    if (kontext.entity && hass) hass.callService("homeassistant", "toggle", { entity_id: kontext.entity });
    return;
  }
  if (art === "navigate") {
    if (aktion.navigation_path) devNavigiere(aktion.navigation_path);
    return;
  }
  if (art === "url") {
    if (aktion.url_path && typeof window !== "undefined" && typeof window.open === "function") {
      window.open(aktion.url_path, "_blank", "noreferrer");
    }
    return;
  }
  if (art === "perform-action") {
    const voll = String(aktion.perform_action || "");
    const punkt = voll.indexOf(".");
    if (punkt <= 0 || punkt === voll.length - 1) {
      console.warn(`busch-device-card: perform-action ohne gültigen Dienst: "${voll}"`);
      return;
    }
    if (!hass || typeof hass.callService !== "function") return;
    const gefuellt = devZielFuellen(aktion, kontext);
    const daten = devPlatzhalterErsetzen(gefuellt.data || {}, kontext);
    const ziel = gefuellt.target ? devPlatzhalterErsetzen(gefuellt.target, kontext) : undefined;
    Promise.resolve()
      .then(() => hass.callService(voll.slice(0, punkt), voll.slice(punkt + 1), daten, ziel))
      .catch((fehler) => {
        if (karte && typeof karte._zeigeDienstFehler === "function") karte._zeigeDienstFehler(fehler);
      });
  }
}
```

- [ ] **Schritt 4: Prüfen**

Run: `node --check dist/busch-cards.js && node --test tests/*.test.js`

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Kontextvariablen, Zielfuellung und Aktionsausfuehrung"
```

---

### Aufgabe 3: Gruppen und Label-Ausschluss

**Dateien:**
- Ändern: `tests/geraet.test.js`
- Ändern: `dist/busch-cards.js` — `devLabelFilter` und `devGruppieren`

**Schnittstellen:**
- Consumes: `DEV_GRUPPEN_WERTE` aus Aufgabe 1.
- Ändert: `devLabelFilter(eintraege, labels, labelsHide) → [eintrag]`.
- Erzeugt: `devGruppenSichtbar(konfig) → ["control", …]`.
- Erzeugt: `devGruppeOffen(konfig, gruppe) → boolean`.
- Ändert: `devGruppieren` nutzt `devGruppenSichtbar` statt `show_config`/`show_diagnostic`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Namen `devGruppenSichtbar`, `devGruppeOffen` ergänzen, dann anhängen:

```js
/* ── Negativfilter und Gruppen (Spec 0.11.0, Abschnitte 7 und 8) ───────── */

test("labels_hide entfernt Eintraege, Ausschluss schlaegt Einschluss", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  // sensor.decke_energie traegt beide Labels, sensor.decke_leistung nur l_energie.
  const nurEnergie = devLabelFilter(alle, [], ["l_wichtig"]).map((e) => e.entity_id);
  assert.ok(!nurEnergie.includes("sensor.decke_energie"), "der Eintrag mit l_wichtig faellt weg");
  assert.ok(nurEnergie.includes("sensor.decke_leistung"));
  const beides = devLabelFilter(alle, ["l_energie"], ["l_wichtig"]).map((e) => e.entity_id).sort();
  assert.strictEqual(beides.join(","), "sensor.decke_leistung",
    "erst einschliessen, dann ausschliessen — der Eintrag mit beiden verschwindet");
});

test("beide Listen leer laesst alles stehen", () => {
  const alle = devEntitaetenDesGeraets(baueHass(), "d1", "light.decke");
  assert.strictEqual(devLabelFilter(alle, [], []).length, alle.length);
  assert.strictEqual(devLabelFilter(alle, undefined, undefined).length, alle.length);
});

test("devGruppenSichtbar haelt die feste Reihenfolge ein", () => {
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({ groups: ["diagnostic", "control"] })),
    '["control","diagnostic"]');
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({ groups: [] })), "[]");
  assert.strictEqual(JSON.stringify(devGruppenSichtbar({})),
    '["control","sensor","config","diagnostic"]', "ohne Angabe alle vier");
});

test("devGruppeOffen liest groups_open", () => {
  assert.strictEqual(devGruppeOffen({ groups_open: ["control", "sensor"] }, "sensor"), true);
  assert.strictEqual(devGruppeOffen({ groups_open: ["control"] }, "sensor"), false);
  assert.strictEqual(devGruppeOffen({}, "control"), false);
});

test("groups steuert, welche Gruppen ueberhaupt erscheinen", () => {
  const h = baueHass();
  const alle = devEntitaetenDesGeraets(h, "d1", "light.decke");
  const nurSensoren = devNormalisiereKonfig({ entity: "light.decke", groups: ["sensor"] });
  assert.strictEqual(devGruppieren(h, alle, nurSensoren).map((g) => g.gruppe).join(","), "sensor");
  const leer = devNormalisiereKonfig({ entity: "light.decke", groups: [] });
  assert.strictEqual(devGruppieren(h, alle, leer).length, 0);
});

test("ein groups_open-Wert ausserhalb von groups stoert nicht", () => {
  const k = devNormalisiereKonfig({ entity: "light.decke", groups: ["sensor"], groups_open: ["config"] });
  assert.strictEqual(JSON.stringify(k.groups), '["sensor"]');
  assert.strictEqual(devGruppeOffen(k, "config"), true, "der Wert bleibt stehen");
  const h = baueHass();
  const gruppen = devGruppieren(h, devEntitaetenDesGeraets(h, "d1", "light.decke"), k);
  assert.strictEqual(gruppen.map((g) => g.gruppe).join(","), "sensor", "gezeichnet wird nur, was in groups steht");
});
```

Den alten Test „show_config / show_diagnostic blenden ihre Gruppe ganz aus"
löschen — er ist durch „groups steuert, welche Gruppen ueberhaupt erscheinen"
ersetzt.

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet.test.js` — FAIL, `devGruppenSichtbar is not defined`.

- [ ] **Schritt 3: Umsetzen**

`devLabelFilter` ersetzen:

```js
/**
 * Erst einschließen, dann ausschließen. **Ausschluss schlägt Einschluss** —
 * ein Eintrag mit beiden Labels verschwindet.
 */
function devLabelFilter(eintraege, labels, labelsHide) {
  const ein = Array.isArray(labels) ? labels : [];
  const aus = Array.isArray(labelsHide) ? labelsHide : [];
  let liste = eintraege.slice();
  if (ein.length) {
    liste = liste.filter((e) => Array.isArray(e.labels) && e.labels.some((l) => ein.includes(l)));
  }
  if (aus.length) {
    liste = liste.filter((e) => !(Array.isArray(e.labels) && e.labels.some((l) => aus.includes(l))));
  }
  return liste;
}

/** Welche Gruppen erscheinen, in fester Reihenfolge. */
function devGruppenSichtbar(konfig) {
  const g = Array.isArray(konfig.groups) ? konfig.groups : DEV_GRUPPEN_WERTE;
  return DEV_GRUPPEN_WERTE.filter((w) => g.includes(w));
}

/** Startet diese Gruppe offen? */
function devGruppeOffen(konfig, gruppe) {
  const g = Array.isArray(konfig.groups_open) ? konfig.groups_open : [];
  return g.includes(gruppe);
}
```

In `devGruppieren` die beiden Zeilen

```js
    if (gruppe === "config" && !konfig.show_config) continue;
    if (gruppe === "diagnostic" && !konfig.show_diagnostic) continue;
```

ersetzen durch

```js
    if (!sichtbar.includes(gruppe)) continue;
```

und oben in der Funktion, vor der Schleife, ergänzen:

```js
  const sichtbar = devGruppenSichtbar(konfig);
```

- [ ] **Schritt 4: Prüfen**

Run: `node --check dist/busch-cards.js && node --test tests/*.test.js`

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: Gruppenwahl ueber groups/groups_open, Label-Ausschluss"
```

---

### Aufgabe 4: Wörterbuch, Schema, Schemafilterung

**Dateien:**
- Ändern: `tests/geraet-editor.test.js`
- Ändern: `dist/busch-cards.js` — `SCHEMA_BUSCH_DEVICE_CARD`,
  `TEXTE_BUSCH_DEVICE_CARD`, neu `devSchemaFuer`

**Schnittstellen:**
- Consumes: `DEV_HA_AKTIONEN`, `DEV_ARTEN`, `DEV_GRUPPEN_WERTE`, `devArtVon`.
- Ändert: `SCHEMA_BUSCH_DEVICE_CARD` — volles Literal mit fünfzehn Blättern.
- Erzeugt: `devSchemaFuer(konfig) → schema` — gefilterte Kopie für den Editor.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

In `tests/geraet-editor.test.js` die Liste `OPTIONEN_DER_SPEC` ersetzen und
`devSchemaFuer`, `DEV_ARTEN`, `DEV_HA_AKTIONEN`, `DEV_GRUPPEN_WERTE`,
`devArtVon` in `ladeKarte` ergänzen; `DEV_AKTIONEN` dort streichen:

```js
/** Spec 0.11.0, Abschnitt 9: dreizehn Konfigurationsschluessel … */
const OPTIONEN_DER_SPEC = [
  "entity", "title", "template", "labels", "labels_hide", "groups", "groups_open",
  "show_subtitle", "start_expanded", "tap_action", "hold_action",
  "row_tap_action", "row_hold_action",
];
/** … plus zwei Felder, die nur im Editor leben. */
const NUR_EDITOR = ["tap_kind", "hold_kind"];
```

Den bestehenden Test „jede Option der Spec steht im Schema, und nichts
darueber hinaus" ersetzen durch:

```js
test("das Schema enthaelt jede Option der Spec plus die zwei Editorfelder", () => {
  const namen = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).map((b) => b.name).sort().join(",");
  assert.strictEqual(namen, OPTIONEN_DER_SPEC.concat(NUR_EDITOR).sort().join(","));
});
```

Den Test „die Auswahlfelder bieten genau die Werte der Spec" ersetzen durch:

```js
test("die Auswahlfelder bieten genau die Werte der Spec", () => {
  const blaetter = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD);
  const werte = (name) => blaetter.find((b) => b.name === name).selector.select.options.map((o) => o.value);
  assert.strictEqual(werte("template").join(","), ["auto"].concat(Object.keys(DEV_VORLAGEN)).join(","));
  assert.strictEqual(werte("tap_kind").join(","), DEV_ARTEN.join(","));
  assert.strictEqual(werte("hold_kind").join(","), DEV_ARTEN.join(","));
  assert.strictEqual(werte("groups").join(","), DEV_GRUPPEN_WERTE.join(","));
  assert.strictEqual(werte("groups_open").join(","), DEV_GRUPPEN_WERTE.join(","));
  for (const feld of ["groups", "groups_open"]) {
    assert.strictEqual(blaetter.find((b) => b.name === feld).selector.select.multiple, true, feld);
  }
});

test("die vier Aktionsfelder nutzen HAs eigenen Aktionseditor, ohne assist", () => {
  const blaetter = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD);
  for (const feld of ["tap_action", "hold_action", "row_tap_action", "row_hold_action"]) {
    const b = blaetter.find((x) => x.name === feld);
    assert.ok(b.selector.ui_action, feld + " braucht den ui_action-Selektor");
    assert.strictEqual(b.selector.ui_action.actions.join(","), DEV_HA_AKTIONEN.join(","), feld);
    assert.ok(!b.selector.ui_action.actions.includes("assist"), feld + " darf assist nicht anbieten");
  }
});

test("labels_hide ist ein Label-Selektor mit Mehrfachauswahl", () => {
  const b = schemaBlaetter(SCHEMA_BUSCH_DEVICE_CARD).find((x) => x.name === "labels_hide");
  assert.strictEqual(b.selector.label.multiple, true);
});

/* ── Schemafilterung fuer den Editor (Spec 0.11.0, Abschnitt 10) ───────── */

test("devSchemaFuer zeigt HAs Aktionseditor nur bei der Art ha", () => {
  const namen = (k) => schemaBlaetter(devSchemaFuer(k)).map((b) => b.name);
  const expand = namen({ tap_action: { action: "expand" }, hold_action: { action: "device-page" } });
  assert.ok(!expand.includes("tap_action"), "bei expand kein HA-Editor");
  assert.ok(!expand.includes("hold_action"), "bei device-page kein HA-Editor");
  assert.ok(expand.includes("tap_kind") && expand.includes("hold_kind"));
  const ha = namen({ tap_action: { action: "perform-action" }, hold_action: { action: "more-info" } });
  assert.ok(ha.includes("tap_action") && ha.includes("hold_action"));
});

test("devSchemaFuer laesst die Zeilenfelder immer stehen und aendert das Original nicht", () => {
  const vorher = JSON.stringify(SCHEMA_BUSCH_DEVICE_CARD);
  const namen = schemaBlaetter(devSchemaFuer({ tap_action: { action: "expand" } })).map((b) => b.name);
  assert.ok(namen.includes("row_tap_action") && namen.includes("row_hold_action"));
  assert.strictEqual(JSON.stringify(SCHEMA_BUSCH_DEVICE_CARD), vorher, "das Literal bleibt unberuehrt");
});
```

Und den Wörterbuchtest um die neuen Auswahlwerte erweitern — den bestehenden
Test „jeder Auswahlwert hat einen Text, jede Gruppe und jeder Fehler auch"
ersetzen durch:

```js
for (const sprache of ["de", "en"]) {
  test(`${sprache}: jeder Auswahlwert hat einen Text, jede Gruppe und jeder Fehler auch`, () => {
    const t = TEXTE_BUSCH_DEVICE_CARD[sprache].texte;
    for (const v of ["auto"].concat(Object.keys(DEV_VORLAGEN))) assert.ok(t[`template_${v}`], `template_${v}`);
    for (const a of DEV_ARTEN) {
      assert.ok(t[`tap_kind_${a}`], `tap_kind_${a}`);
      assert.ok(t[`hold_kind_${a}`], `hold_kind_${a}`);
    }
    for (const g of DEV_GRUPPEN_WERTE) {
      assert.ok(t[`groups_${g}`], `groups_${g}`);
      assert.ok(t[`groups_open_${g}`], `groups_open_${g}`);
      assert.ok(t[`gruppe_${g}`], `gruppe_${g}`);
    }
    for (const f of ["keineEntitaet", "altesHa", "nichtRegistriert", "keinGeraet",
                     "helferFehlt", "laden", "keineTreffer", "dienstFehler"]) {
      assert.ok(t[f], f);
    }
  });
}
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet-editor.test.js` — FAIL, `devSchemaFuer is not defined`.

- [ ] **Schritt 3: Schema ersetzen**

`SCHEMA_BUSCH_DEVICE_CARD` vollständig ersetzen:

```js
const SCHEMA_BUSCH_DEVICE_CARD = [
  { name: "entity", required: true, selector: { entity: {} } },
  { name: "title", selector: { text: {} } },
  {
    name: "template",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto" }, { value: "light" }, { value: "climate" }, { value: "cover" },
          { value: "fan" }, { value: "media" }, { value: "lock" }, { value: "switch" },
          { value: "generic" },
        ],
      },
    },
  },
  { name: "labels", selector: { label: { multiple: true } } },
  { name: "labels_hide", selector: { label: { multiple: true } } },
  {
    name: "groups",
    selector: {
      select: {
        multiple: true, mode: "list",
        options: [
          { value: "control" }, { value: "sensor" }, { value: "config" }, { value: "diagnostic" },
        ],
      },
    },
  },
  {
    name: "groups_open",
    selector: {
      select: {
        multiple: true, mode: "list",
        options: [
          { value: "control" }, { value: "sensor" }, { value: "config" }, { value: "diagnostic" },
        ],
      },
    },
  },
  {
    type: "grid",
    schema: [
      { name: "show_subtitle", selector: { boolean: {} } },
      { name: "start_expanded", selector: { boolean: {} } },
    ],
  },
  {
    name: "tap_kind",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "expand" }, { value: "device-page" }, { value: "ha" }],
      },
    },
  },
  {
    name: "tap_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "hold_kind",
    selector: {
      select: {
        mode: "dropdown",
        options: [{ value: "expand" }, { value: "device-page" }, { value: "ha" }],
      },
    },
  },
  {
    name: "hold_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "row_tap_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
  {
    name: "row_hold_action",
    selector: {
      ui_action: {
        actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"],
      },
    },
  },
];

/**
 * Die gefilterte Kopie für den Editor: HAs Aktionseditor erscheint nur, wenn
 * die Art darüber `ha` ist. Das Literal oben bleibt vollständig, weil
 * `scripts/ui-regeln-pruefen.py` es aus dem Quelltext liest und eine
 * berechnete Schemafunktion nicht lesen könnte.
 */
function devSchemaFuer(konfig) {
  const weg = [];
  if (devArtVon(konfig && konfig.tap_action) !== "ha") weg.push("tap_action");
  if (devArtVon(konfig && konfig.hold_action) !== "ha") weg.push("hold_action");
  return SCHEMA_BUSCH_DEVICE_CARD.filter((e) => !weg.includes(e.name));
}
```

- [ ] **Schritt 4: Wörterbuch ergänzen**

In `TEXTE_BUSCH_DEVICE_CARD.de.labels` die Einträge `show_config`,
`show_diagnostic` und `navigation_path` **streichen** und ergänzen:

```js
      labels_hide: "Entitäten mit Label verbergen",
      groups: "Gruppen zeigen",
      groups_open: "Gruppen offen starten",
      tap_kind: "Tippen auf die Kopfzeile",
      hold_kind: "Halten auf der Kopfzeile",
      tap_action: "Aktion beim Tippen",
      hold_action: "Aktion beim Halten",
      row_tap_action: "Tippen auf eine Zeile",
      row_hold_action: "Halten auf einer Zeile",
```

Die Einträge `tap_action` und `hold_action` in `labels` **ersetzen** die alten
gleichnamigen; `de.helpers` ebenso, dort `show_config`, `show_diagnostic`,
`navigation_path` streichen und ergänzen:

```js
      labels_hide: "Entitäten mit einem dieser Labels erscheinen nicht. Schlägt die Auswahl darüber. Vorgabe: keines.",
      groups: "Welche Gruppen unter dem Bedienelement überhaupt erscheinen. Vorgabe: alle vier.",
      groups_open: "Welche dieser Gruppen offen starten. Die übrigen sind zugeklappt und öffnen sich per Klick. Vorgabe: nur Steuerung.",
      tap_kind: "Aufklappen zeigt Bedienelement und Entitäten. Geräteseite öffnet die Seite von Home Assistant. Bei Aktion von Home Assistant erscheint darunter dessen eigener Editor. Vorgabe: Aufklappen.",
      hold_kind: "Dasselbe für einen halben Sekunde langen Griff. Vorgabe: Aktion von Home Assistant.",
      tap_action: "Der Aktionseditor von Home Assistant. In Ziel und Daten setzt {{ entity }} die Hauptentität ein, {{ device }} das Gerät, {{ area }} den Bereich. Kein Jinja, nur diese drei. Vorgabe: Details öffnen.",
      hold_action: "Derselbe Editor für das Halten. Dieselben drei Platzhalter. Vorgabe: Details öffnen.",
      row_tap_action: "Was ein Tippen auf eine Entitätenzeile tut. {{ entity }} ist dann die angetippte Zeile. Ein leeres Ziel füllt sich mit ihr. Vorgabe: Details öffnen.",
      row_hold_action: "Dasselbe für das Halten auf einer Zeile. Vorgabe: nichts.",
```

In `de.texte` ergänzen:

```js
      tap_kind_expand: "Aufklappen",
      "tap_kind_device-page": "Geräteseite öffnen",
      tap_kind_ha: "Aktion von Home Assistant",
      hold_kind_expand: "Aufklappen",
      "hold_kind_device-page": "Geräteseite öffnen",
      hold_kind_ha: "Aktion von Home Assistant",
      groups_control: "Steuerung",
      groups_sensor: "Sensoren",
      groups_config: "Konfiguration",
      groups_diagnostic: "Diagnose",
      groups_open_control: "Steuerung",
      groups_open_sensor: "Sensoren",
      groups_open_config: "Konfiguration",
      groups_open_diagnostic: "Diagnose",
      dienstFehler: "Dienst fehlgeschlagen: {fehler}",
```

Dieselben Blöcke auf Englisch in `en`:

```js
      // labels
      labels_hide: "Hide entities with label",
      groups: "Show groups",
      groups_open: "Groups open at start",
      tap_kind: "Tap on the header",
      hold_kind: "Hold on the header",
      tap_action: "Action on tap",
      hold_action: "Action on hold",
      row_tap_action: "Tap on a row",
      row_hold_action: "Hold on a row",
      // helpers
      labels_hide: "Entities carrying one of these labels do not appear. Beats the selection above. Default: none.",
      groups: "Which groups appear below the control at all. Default: all four.",
      groups_open: "Which of those start open. The rest are collapsed and open on click. Default: controls only.",
      tap_kind: "Expand shows the control and the entities. Device page opens Home Assistant's own page. With Home Assistant action its editor appears below. Default: expand.",
      hold_kind: "The same for a half-second press. Default: Home Assistant action.",
      tap_action: "Home Assistant's action editor. In target and data, {{ entity }} inserts the main entity, {{ device }} the device, {{ area }} the area. No Jinja, just these three. Default: open details.",
      hold_action: "The same editor for holding. The same three placeholders. Default: open details.",
      row_tap_action: "What a tap on an entity row does. {{ entity }} is the tapped row then. An empty target fills itself with it. Default: open details.",
      row_hold_action: "The same for holding a row. Default: nothing.",
      // texte
      tap_kind_expand: "Expand",
      "tap_kind_device-page": "Open device page",
      tap_kind_ha: "Home Assistant action",
      hold_kind_expand: "Expand",
      "hold_kind_device-page": "Open device page",
      hold_kind_ha: "Home Assistant action",
      groups_control: "Controls",
      groups_sensor: "Sensors",
      groups_config: "Configuration",
      groups_diagnostic: "Diagnostic",
      groups_open_control: "Controls",
      groups_open_sensor: "Sensors",
      groups_open_config: "Configuration",
      groups_open_diagnostic: "Diagnostic",
      dienstFehler: "Action failed: {fehler}",
```

- [ ] **Schritt 5: Prüfen**

Run:
```bash
node --check dist/busch-cards.js && node --test tests/*.test.js
python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards
```
Erwartet: Tests grün. Der Regelprüfer meldet noch R3.3 für die Schlüssel, die
die Karte erst in Aufgabe 5 liest — notieren, nicht beheben.

- [ ] **Schritt 6: Commit**

```bash
git add tests/geraet-editor.test.js dist/busch-cards.js
git commit -m "busch-device-card: Schema und Woerterbuch fuer Aktionen, Gruppen und Ausschluss"
```

---

### Aufgabe 5: Die Kartenklasse

**Dateien:**
- Ändern: `dist/busch-cards.js` — `DEV_STIL`, `BuschDeviceCard`
- Ändern: `tests/geraet.test.js` (Kartengrößen)

**Schnittstellen:**
- Consumes: alles aus Aufgabe 1 bis 4.
- Erzeugt: `karte._umschalten()`, `karte._zeigeDienstFehler(fehler)`.

- [ ] **Schritt 1: Stil ergänzen**

In `DEV_STIL` ergänzen (die bestehenden Regeln bleiben):

```css
  /* Ohne diese Zeile bliebe das Bedienelement beim Zuklappen stehen: die
     Regel `.dev-tile { padding: ... }` gewinnt sonst gegen die UA-Vorgabe
     fuer [hidden] nicht immer. Dieselbe Absicherung hat `.dev-liste` schon. */
  .dev-tile[hidden] { display:none !important; }
  .dev-chip-aus .dev-chip-text { text-decoration: line-through; }
  .dev-chip-aus { opacity: .55; }
  .dev-zeile { display:block; }
  .dev-dienstfehler { padding:0 var(--ha-space-4, 16px) var(--ha-space-2, 8px);
    color:var(--error-color); font-size:.85em; overflow-wrap:anywhere; }
  .dev-dienstfehler[hidden] { display:none; }
```

Und die Regel `.dev-gruppe-kopf { … cursor:default; }` auf `cursor:pointer`
ändern, weil jetzt **jede** Gruppe klappbar ist; die Klasse `dev-klappbar`
entfällt aus dem Stil.

- [ ] **Schritt 2: Gerüst und Umschalten**

In `_geruest()` hinter `this._hinweis` ergänzen:

```js
    this._dienstFehler = document.createElement("div");
    this._dienstFehler.className = "dev-dienstfehler";
    this._dienstFehler.hidden = true;
```

und in die `append`-Zeile aufnehmen:

```js
    this._karte.append(this._kopf, this._chips, this._dienstFehler,
                       this._tileBehaelter, this._liste, this._hinweis);
```

Neue Methoden an der Klasse:

```js
  /** Auf- und zuklappen. `devFuehreAus` ruft das für die Aktion `expand`. */
  _umschalten() {
    this._offen = !this._offen;
    this._zeigeListe();
  }

  /** Ein fehlgeschlagener Dienstaufruf, zwei Sekunden sichtbar. */
  _zeigeDienstFehler(fehler) {
    if (!this._dienstFehler) return;
    const t = this._texte;
    this._dienstFehler.textContent = buschFuellen(t.dienstFehler, {
      fehler: (fehler && fehler.message) || String(fehler),
    });
    this._dienstFehler.hidden = false;
    if (this._fehlerUhr) clearTimeout(this._fehlerUhr);
    this._fehlerUhr = setTimeout(() => { this._dienstFehler.hidden = true; }, 2000);
  }

  /** Der Kontext der Kopfzeile: die Hauptentität dieser Karte. */
  _kopfKontext() {
    return devKontext(this._config.entity,
      this._auf && this._auf.geraet, this._auf && this._auf.bereich);
  }
```

- [ ] **Schritt 3: Gesten der Kopfzeile auf `devFuehreAus` umstellen**

In `_bindeKopf()` die drei Aufrufe von `this._aktion(...)` ersetzen:

```js
      timer = setTimeout(() => {
        timer = null; gehalten = true;
        devFuehreAus(this, this._hass, this._config.hold_action, this._kopfKontext());
      }, 500);
```
```js
      if (!gehalten && warTimer) {
        devFuehreAus(this, this._hass, this._config.tap_action, this._kopfKontext());
      }
```
```js
    this._pfeil.addEventListener("click", (e) => { e.stopPropagation(); this._umschalten(); });
```
```js
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        devFuehreAus(this, this._hass, this._config.tap_action, this._kopfKontext());
      }
```

Die alte Methode `_aktion(name)` und die alte `_navigiere(pfad)` **löschen** —
beides steckt jetzt in `devFuehreAus` und `devNavigiere`.

- [ ] **Schritt 4: Zeilenhorcher im Gerüst**

In `_geruest()`, nach dem `appendChild`, ergänzen:

```js
    // Zeilen antippen: HAs Zeilen feuern beim Tippen auf den Namensbereich
    // `hass-more-info`. Genau das wird hier abgefangen — KEIN Klick-Abfangen,
    // sonst wäre der Schalter einer Schalterzeile unbedienbar.
    // Eigene `more-info`-Ereignisse feuert die Karte an SICH; `_liste` ist ihr
    // Kind, kein Vorfahre, also greift dieser Horcher dort nicht.
    this._liste.addEventListener("hass-more-info", (ereignis) => {
      const id = ereignis.detail && ereignis.detail.entityId;
      if (!id) return;
      if (this._haltVerbraucht) {
        this._haltVerbraucht = false;
        ereignis.stopPropagation();
        return;
      }
      const aktion = this._config.row_tap_action;
      if (!aktion || aktion.action === "more-info") return;
      ereignis.stopPropagation();
      devFuehreAus(this, this._hass, aktion,
        devKontext(id, this._auf && this._auf.geraet, this._auf && this._auf.bereich));
    });
```

- [ ] **Schritt 5: Chips mit Ausschluss**

`_zeichneChips()` ersetzen:

```js
  _zeichneChips() {
    if (!this._chips || !this._config) return;
    this._chips.textContent = "";
    const male = (id, aus) => {
      const e = this._labels && this._labels.get(id);
      const chip = document.createElement("span");
      chip.className = aus ? "dev-chip dev-chip-aus" : "dev-chip";
      const farbe = devLabelFarbe(e);
      if (farbe) chip.style.setProperty("--dev-chip-farbe", farbe);
      const punkt = document.createElement("span");
      punkt.className = "dev-chip-punkt";
      const text = document.createElement("span");
      text.className = "dev-chip-text";
      text.textContent = (e && e.name) || id;
      chip.append(punkt, text);
      this._chips.appendChild(chip);
    };
    for (const id of this._config.labels) male(id, false);
    for (const id of this._config.labels_hide) male(id, true);
  }
```

- [ ] **Schritt 6: Filter, Gruppen und Zeilenrahmen in `_render` und `_baueBausteine`**

In `_render()` die Filterzeile ersetzen:

```js
    const gefiltert = devLabelFilter(alle, this._config.labels, this._config.labels_hide);
```

In `_baueBausteine()` den Gruppenkopf-Block ersetzen — **jede** Gruppe ist
klappbar, und jede Zeile bekommt einen Rahmen mit Halte-Erkennung:

```js
    for (const g of gruppen) {
      const block = document.createElement("div");
      block.className = "dev-gruppe";
      block.dataset.gruppe = g.gruppe;
      const kopf = document.createElement("button");
      kopf.className = "dev-gruppe-kopf";
      kopf.type = "button";
      const pfeil = document.createElement("ha-icon");
      pfeil.className = "dev-gruppe-pfeil";
      pfeil.setAttribute("icon", "mdi:chevron-down");
      pfeil.icon = "mdi:chevron-down";
      kopf.appendChild(pfeil);
      if (this._zu[g.gruppe] === undefined) this._zu[g.gruppe] = !devGruppeOffen(this._config, g.gruppe);
      if (this._zu[g.gruppe]) block.classList.add("dev-zu");
      kopf.addEventListener("click", () => {
        this._zu[g.gruppe] = !this._zu[g.gruppe];
        block.classList.toggle("dev-zu", this._zu[g.gruppe]);
      });
      const text = document.createElement("span");
      text.className = "dev-gruppe-text";
      text.textContent = `${t["gruppe_" + g.gruppe]} (${g.ids.length})`;
      kopf.appendChild(text);
      const zeilen = document.createElement("div");
      zeilen.className = "dev-zeilen";
      for (const id of g.ids) {
        try {
          const voll = devAnzeigename(this._hass, this._hass.entities[id]);
          const kurz = devKurzname(voll, geraeteName, devDomainName(t, id));
          const zeile = helfer.createRowElement({ entity: id, name: kurz });
          const rahmen = document.createElement("div");
          rahmen.className = "dev-zeile";
          rahmen.dataset.entity = id;
          rahmen.appendChild(zeile);
          this._bindeZeile(rahmen, id);
          this._zeilen.push(zeile);
          zeilen.appendChild(rahmen);
        } catch (e) { /* eine kaputte Zeile reisst die anderen nicht mit */ }
      }
      block.append(kopf, zeilen);
      this._liste.appendChild(block);
    }
```

Und in `setConfig` das `this._zu = { config: true, diagnostic: true };` ersetzen
durch `this._zu = {};`, damit `groups_open` beim nächsten Aufbau greift.

Neue Methode für das Halten auf einer Zeile:

```js
  /**
   * Halten auf einer Zeile. Der Rahmen hört nur zu: kein eigener
   * Klick-Behandler, kein `pointer-events`, damit jedes Bedienelement der
   * Zeile erreichbar bleibt. Löst das Halten aus, wird das danach folgende
   * `hass-more-info` einmal geschluckt (`_haltVerbraucht`).
   */
  _bindeZeile(rahmen, entityId) {
    let timer = null;
    let start = null;
    const abbrechen = () => { if (timer) { clearTimeout(timer); timer = null; } };
    rahmen.addEventListener("pointerdown", (e) => {
      const aktion = this._config.row_hold_action;
      if (!aktion || aktion.action === "none") return;
      start = { x: e.clientX, y: e.clientY };
      abbrechen();
      timer = setTimeout(() => {
        timer = null;
        this._haltVerbraucht = true;
        devFuehreAus(this, this._hass, aktion,
          devKontext(entityId, this._auf && this._auf.geraet, this._auf && this._auf.bereich));
      }, 500);
    });
    rahmen.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) abbrechen();
    });
    rahmen.addEventListener("pointerup", () => { abbrechen(); start = null; });
    rahmen.addEventListener("pointercancel", abbrechen);
    rahmen.addEventListener("pointerleave", abbrechen);
  }
```

- [ ] **Schritt 7: Zugeklappt heißt zugeklappt**

`_zeigeListe()` ersetzen:

```js
  _zeigeListe() {
    // Zugeklappt bleiben nur Icon, Name, Untertitel und die Marken stehen —
    // auch das Bedienelement verschwindet (Spec 0.11.0, Abschnitt 6).
    const offen = Boolean(this._offen) && !this._helferFehlt;
    this._pfeil.hidden = Boolean(this._helferFehlt);
    this._tileBehaelter.hidden = !offen;
    this._liste.hidden = !offen;
    this._karte.classList.toggle("dev-offen", offen);
    const t = this._texte;
    this._kopf.setAttribute("aria-expanded", String(offen));
    this._pfeil.setAttribute("title", offen ? t.zuklappen : t.aufklappen);
  }
```

Im Fehlerzweig von `_render()` zusätzlich `this._dienstFehler.hidden = true;`
setzen. Und `getCardSize` ersetzen:

```js
  getCardSize() {
    return this._offen ? 3 + (this._zeilenZahl || 0) : 2;
  }
```

`getStubConfig` um `start_expanded: true` ergänzen:

```js
    return { type: "custom:busch-device-card", entity: treffer, start_expanded: true };
```

- [ ] **Schritt 8: Test für die Kartengröße anhängen**

An `tests/geraet.test.js`:

```js
test("getStubConfig startet aufgeklappt, damit die Vorschau etwas zeigt", () => {
  const stub = BuschDeviceCard.getStubConfig(baueHass(), ["light.decke"]);
  assert.strictEqual(stub.start_expanded, true);
  assert.strictEqual(stub.entity, "light.decke");
});

test("die Vorgabe von start_expanded bleibt aus", () => {
  assert.strictEqual(DEV_STANDARD.start_expanded, false);
  assert.strictEqual(devNormalisiereKonfig({ entity: "light.decke" }).start_expanded, false);
});
```

- [ ] **Schritt 9: Prüfen**

Run:
```bash
node --check dist/busch-cards.js && node --test tests/*.test.js
python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards
```
Erwartet: alles grün, der Regelprüfer **ohne** Befund. Bleibt einer, ist er zu
beheben, nicht in die Ausnahmeliste zu schreiben.

- [ ] **Schritt 10: Commit**

```bash
git add tests/geraet.test.js dist/busch-cards.js
git commit -m "busch-device-card: zugeklappt zeigt nur das Geraet, Gruppen klappen, Zeilen reagieren"
```

---

### Aufgabe 6: Der Editor

**Dateien:**
- Ändern: `dist/busch-cards.js` — `BuschDeviceCardEditor`
- Ändern: `tests/geraet-editor.test.js`

**Schnittstellen:**
- Consumes: `devSchemaFuer`, `devArtVon`, `devMigriereKonfig`, `DEV_STANDARD`.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Die beiden bestehenden Editor-Tests am Dateiende ersetzen durch:

```js
test("der Editor gibt ha-form das gefilterte Schema und die Art als Datenfeld", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function (k) { this._angehaengt = k; };
  ed.setConfig({ entity: "light.decke" });
  ed.hass = baueHass();
  const form = ed._form;
  assert.strictEqual(form.tag, "ha-form");
  assert.strictEqual(form.data.entity, "light.decke");
  assert.strictEqual(form.data.tap_kind, "expand", "aus der Vorgabe abgeleitet");
  assert.strictEqual(form.data.hold_kind, "ha");
  const namen = form.schema.flatMap((e) => (e.schema ? e.schema.map((x) => x.name) : [e.name]));
  assert.ok(!namen.includes("tap_action"), "bei expand kein HA-Editor");
  assert.ok(namen.includes("hold_action"), "bei ha schon");
  assert.strictEqual(form.computeLabel({ name: "labels_hide" }), "Entitäten mit Label verbergen");
  assert.ok(/Vorgabe/.test(form.computeHelper({ name: "groups" })));
});

test("die Art zu wechseln schreibt die Aktion um und setzt das Schema neu", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function () {};
  let gemeldet = null;
  ed.dispatchEvent = (ev) => { gemeldet = ev.detail.config; };
  ed.setConfig({ type: "custom:busch-device-card", entity: "light.decke" });
  ed.hass = baueHass();
  ed._form.on_value_changed({
    stopPropagation() {},
    detail: { value: { ...ed._form.data, tap_kind: "ha" } },
  });
  assert.strictEqual(gemeldet.tap_action.action, "more-info", "die Art ha startet bei more-info");
  assert.strictEqual(gemeldet.tap_kind, undefined, "die Art landet nie in der Konfiguration");
  assert.strictEqual(gemeldet.hold_kind, undefined);
  const namen = ed._form.schema.flatMap((e) => (e.schema ? e.schema.map((x) => x.name) : [e.name]));
  assert.ok(namen.includes("tap_action"), "das Schema ist neu gesetzt");
});

test("eine gesetzte HA-Aktion bleibt erhalten, Vorgaben fallen heraus", () => {
  const dokument = domAttrappe();
  const { BuschDeviceCardEditor: Editor } = ladeKarte(["BuschDeviceCardEditor"],
    { document: dokument, CustomEvent: EreignisStub });
  const ed = new Editor();
  ed.appendChild = function () {};
  let gemeldet = null;
  ed.dispatchEvent = (ev) => { gemeldet = ev.detail.config; };
  ed.setConfig({ type: "custom:busch-device-card", entity: "light.decke" });
  ed.hass = baueHass();
  ed._form.on_value_changed({
    stopPropagation() {},
    detail: {
      value: {
        ...ed._form.data, tap_kind: "ha",
        tap_action: { action: "perform-action", perform_action: "label.add" },
        labels_hide: [], groups: ["control", "sensor", "config", "diagnostic"],
      },
    },
  });
  assert.strictEqual(gemeldet.tap_action.perform_action, "label.add");
  assert.strictEqual(gemeldet.labels_hide, undefined, "leere Vorgabe faellt heraus");
  assert.strictEqual(gemeldet.groups, undefined, "die Vorgabe aller vier Gruppen faellt heraus");
  assert.strictEqual(gemeldet.hold_action, undefined, "unveraenderte Vorgabe faellt heraus");
});
```

- [ ] **Schritt 2: Test laufen lassen, muss fehlschlagen**

Run: `node --test tests/geraet-editor.test.js` — FAIL, `form.data.tap_kind` ist `undefined`.

- [ ] **Schritt 3: Editor ersetzen**

```js
class BuschDeviceCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = devMigriereKonfig(config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /** Die Daten, die `ha-form` sieht: Konfiguration plus die zwei Arten. */
  _daten() {
    return {
      ...DEV_STANDARD,
      ...this._config,
      tap_kind: devArtVon(this._config.tap_action || DEV_STANDARD.tap_action),
      hold_kind: devArtVon(this._config.hold_action || DEV_STANDARD.hold_action),
    };
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._texte = buschTexte(TEXTE_BUSCH_DEVICE_CARD, this._hass);
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._texte.labels[s.name] || s.name;
      this._form.computeHelper = (s) => this._texte.helpers[s.name] || "";
      this._form.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        this._uebernehmen(event.detail.value);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = buschSchemaMitTexten(devSchemaFuer(this._config), this._texte);
    this._form.data = this._daten();
  }

  /**
   * Aus den Formulardaten wieder eine Konfiguration machen.
   *
   * Die beiden Art-Felder werden entfernt: `ha-form` reicht bei
   * `value-changed` immer das ganze Datenobjekt zurück, und ungefiltert
   * stünden sie im Dashboard-YAML.
   */
  _uebernehmen(werte) {
    const neu = { ...this._config, ...werte };
    for (const geste of ["tap", "hold"]) {
      const art = werte[geste + "_kind"];
      const feld = geste + "_action";
      if (art === "expand" || art === "device-page") neu[feld] = { action: art };
      else if (devArtVon(neu[feld]) !== "ha") neu[feld] = { action: "more-info" };
      delete neu[geste + "_kind"];
    }
    // Vorgaben nicht ins YAML schreiben.
    for (const [k, v] of Object.entries(DEV_STANDARD)) {
      if (JSON.stringify(neu[k]) === JSON.stringify(v)) delete neu[k];
    }
    this._emit(neu);
  }

  _emit(config) {
    this._config = config;
    this._render();
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }
}
```

- [ ] **Schritt 4: Prüfen**

Run:
```bash
node --check dist/busch-cards.js && node --test tests/*.test.js
python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards
```
Erwartet: alles grün, Regelprüfer ohne Befund.

- [ ] **Schritt 5: Commit**

```bash
git add tests/geraet-editor.test.js dist/busch-cards.js
git commit -m "busch-device-card: Editor mit Art-Auswahl und HAs Aktionseditor"
```

---

### Aufgabe 7: Nachweis im Chromium

**Dateien:**
- Ändern: `../docs/render/render-geraet.py`
- Erzeugt: `../docs/render/geraet/report.json` und Bilder (nicht im Repo)

- [ ] **Schritt 1: Attrappe erweitern**

In der Helfer-Attrappe die Zeilen so bauen, dass sie sich wie HAs Zeilen
verhalten — eine Namensfläche, die `hass-more-info` feuert, und bei einer
Schalterzeile zusätzlich ein Knopf, der es **nicht** feuert:

```js
  window.__dienste = [];
  class StubRow extends HTMLElement {
    set hass(v) { this._hass = v; this.dataset.hassGesetzt = String((Number(this.dataset.hassGesetzt) || 0) + 1); }
    connectedCallback() {
      if (this._auf) return;
      this._auf = true;
      const name = document.createElement('span');
      name.className = 'stub-name';
      name.textContent = this.dataset.text;
      /* So macht es HAs Zeile: ein aufsteigendes, komponiertes Ereignis. */
      name.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info',
        { detail: { entityId: this.dataset.entity }, bubbles: true, composed: true })));
      this.appendChild(name);
      if (this.dataset.entity.startsWith('switch.')) {
        const knopf = document.createElement('button');
        knopf.className = 'stub-toggle';
        knopf.textContent = 'AN/AUS';
        /* Ein Schalter feuert KEIN more-info — er ruft direkt den Dienst. */
        knopf.addEventListener('click', () => window.__hass.callService(
          'homeassistant', 'toggle', { entity_id: this.dataset.entity }));
        this.appendChild(knopf);
      }
    }
  }
```

und in `createRowElement`:

```js
    createRowElement(cfg) {
      window.__helferAufrufe.push('row:' + JSON.stringify(cfg));
      const r = document.createElement('stub-row');
      r.className = 'stub-row';
      r.dataset.entity = cfg.entity;
      r.dataset.text = (cfg.name || cfg.entity) + '  \\u2014  ' + cfg.entity;
      return r;
    },
```

`callService` der `hass`-Attrappe schreibt jetzt vollständig mit:

```js
    async callService(d, s, daten, ziel) {
      window.__dienste.push({ dienst: d + '.' + s, daten: daten, ziel: ziel });
    },
```

- [ ] **Schritt 2: Karten der Seite auf die neuen Optionen bringen**

```js
  window.__a = mk('karte-a', { entity: 'light.decke' });
  window.__b = mk('karte-b', { entity: 'light.decke', start_expanded: true,
    labels: ['l_energie', 'l_wichtig'], labels_hide: ['l_wichtig'],
    groups_open: ['control', 'sensor'],
    title: 'Eine absichtlich viel zu lange \\u00dcberschrift, die gek\\u00fcrzt werden muss, damit Regel 1 h\\u00e4lt',
    tap_action: { action: 'perform-action', perform_action: 'label.add',
                  data: { label_id: 'geprueft', geraet: '{{ device }}' } },
    row_tap_action: { action: 'perform-action', perform_action: 'label.add',
                      data: { label_id: 'zeile' } } });
  window.__c = mk('karte-c', { entity: 'sensor.aqara_temp', start_expanded: true,
    groups_open: ['sensor'], hold_action: { action: 'device-page' } });
  window.__d = mk('karte-d', { entity: 'sensor.ohne_geraet' });
```

- [ ] **Schritt 3: Auslesen und Verhalten erweitern**

`AUSLESEN` um zwei Felder ergänzen:

```
    tileSichtbar: k.querySelector('.dev-tile') ? !k.querySelector('.dev-tile').hidden : null,
    chipsAus: [...k.querySelectorAll('.dev-chip-aus .dev-chip-text')].map(c => c.textContent),
```

`VERHALTEN` um diese Messungen ergänzen, vor dem `return aus;`:

```js
    // 7. Zugeklappt ist kein Bedienelement sichtbar.
    aus.aTileSichtbarZu = !window.__a.querySelector('.dev-tile').hidden;
    // 8. Kopfzeile antippen ruft den Dienst mit ersetzten Daten.
    window.__dienste.length = 0;
    const kb = window.__b.querySelector('.dev-kopf');
    const evb = (t) => kb.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: 10, clientY: 10 }));
    evb('pointerdown'); evb('pointerup');
    await new Promise(r => setTimeout(r, 50));
    aus.dienstNachKopfTipp = JSON.parse(JSON.stringify(window.__dienste));
    // 9. Eine Zeile antippen ruft ihn mit IHRER Entitaet.
    window.__dienste.length = 0;
    const zeile = window.__b.querySelector('.dev-zeilen .stub-name');
    aus.zeileText = zeile.textContent;
    zeile.click();
    await new Promise(r => setTimeout(r, 50));
    aus.dienstNachZeilenTipp = JSON.parse(JSON.stringify(window.__dienste));
    // 10. Der Schalter einer Schalterzeile bleibt bedienbar und loest KEINEN
    //     eigenen Dienst der Karte aus.
    window.__dienste.length = 0;
    window.__c.querySelectorAll('.dev-gruppe').forEach(g => g.classList.remove('dev-zu'));
    const schalter = document.querySelector('#karte-b .stub-toggle')
      || document.querySelector('.stub-toggle');
    aus.schalterGefunden = Boolean(schalter);
    if (schalter) { schalter.click(); await new Promise(r => setTimeout(r, 50)); }
    aus.dienstNachSchalter = JSON.parse(JSON.stringify(window.__dienste));
    // 11. Jede Gruppe klappt, auch Sensoren.
    const sens = window.__b.querySelector('.dev-gruppe[data-gruppe=sensor]');
    aus.sensorZuVorher = sens ? sens.classList.contains('dev-zu') : null;
    if (sens) sens.querySelector('.dev-gruppe-kopf').click();
    aus.sensorZuNachher = sens ? sens.classList.contains('dev-zu') : null;
```

Damit der Schalter überhaupt vorkommt, muss `karte-b` ihn zeigen. Der
Label-Filter von `karte-b` lässt ihn nicht durch; deshalb eine **fünfte**
Karte anlegen, die alles zeigt:

```js
  window.__e = mk('karte-e', { entity: 'light.decke', start_expanded: true,
    groups_open: ['control', 'sensor', 'config', 'diagnostic'],
    row_hold_action: { action: 'perform-action', perform_action: 'label.remove' } });
```

und in Schritt 10 `document.querySelector('#karte-e .stub-toggle')` nehmen.
`#karte-e` in die Liste der gemessenen Karten aufnehmen
(`for kennung in ("#karte-a", "#karte-b", "#karte-c", "#karte-d", "#karte-e")`)
und in die Screenshot-Schleife (`for kennung in ("a","b","c","d","e")`).

- [ ] **Schritt 4: Laufen lassen**

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /work/render-geraet.py /cards/dist/busch-cards.js /work/geraet'
```

Erwartet Exit 0. Danach `report.json` **lesen**, diese Sollwerte:

| Feld | Sollwert |
| --- | --- |
| `page_errors`, `console_errors`, `request_failures` | leer |
| `karten[0].tileSichtbar` | `false` (karte-a ist zu) |
| `karten[1].tileSichtbar` | `true` |
| `karten[1].chipsAus` | `["Wichtig"]` |
| `karten[1].gruppen` | nur `sensor`, eine Zeile `Leistung` (Ausschluss hat `Energie` entfernt) |
| `verhalten.aTileSichtbarZu` | `false` |
| `verhalten.dienstNachKopfTipp` | ein Eintrag `label.add`, `daten.geraet` gleich `d1`, `ziel.entity_id` gleich `light.decke` |
| `verhalten.dienstNachZeilenTipp` | ein Eintrag `label.add`, `ziel.entity_id` gleich `sensor.decke_leistung` |
| `verhalten.schalterGefunden` | `true` |
| `verhalten.dienstNachSchalter` | genau ein Eintrag `homeassistant.toggle` mit der Schalterentität, **kein** `label.*` |
| `verhalten.sensorZuVorher/Nachher` | `false` / `true` |
| `ui_regeln_zaehlung.*` | `ueberlauf`, `ausserhalb`, `ueberlappung` je 0 |
| `ui_selbsttest.ueberlauf_erkannt` | `true` |
| `umgebung.wsAufrufe` | genau **ein** `config/label_registry/list` |

Ein abweichender Wert ist ein Fehler der Karte oder der Attrappe — erst
klären, welcher, dann beheben, dann **neu laufen lassen**.

- [ ] **Schritt 5: Die Bilder wirklich ansehen**

`geraet-a.png` (zugeklappt, nur Kopfzeile), `geraet-b.png` (Chips mit
durchgestrichener Marke), `geraet-e.png` (alle vier Gruppen offen) und je ein
320-px-Bild hell und dunkel mit dem Read-Werkzeug öffnen. Ein grüner Bericht
allein ist kein Beleg.

- [ ] **Schritt 6: Kalender und Zeitplan gegenprüfen**

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /work/render-kalender.py /cards/dist/busch-cards.js /work/kalender-nach-geraet && \
      python3 /work/render-zeitplan.py /cards/dist/busch-cards.js /work/zeitplan-nach-geraet'
```

Erwartet: beide Exit 0, `tageZeilen` 31 im laufenden Monat und 31 im Vormonat,
`amPm` 0. Das ist der Schritt gegen die Namenskollision.

- [ ] **Schritt 7: Commit**

Vorher im `hacs`-Repo `git status` lesen — dort arbeitet eine zweite Sitzung.
Nur die eine Datei vorlegen:

```bash
cd .. && git add docs/render/render-geraet.py \
  && git commit -m "render-geraet.py: Dienstaufrufe, Zeilenklicks und Zuklappen messen" \
  && cd busch-cards
```

---

### Aufgabe 8: Echte Daten, README, Version, Ausliefern

**Dateien:**
- Ändern: `README.md`, `dist/busch-cards.js`, `../CLAUDE.md`, `../docs/stand.md`

- [ ] **Schritt 1: Gegen echte Registerdaten laufen**

Über den Home-Assistant-MCP-Server ein Gerät holen (`ha_get_device` mit einer
Entität, dann `ha_get_entity` für dessen Entitäten), daraus ein `hass`-Objekt
bauen und die reinen Funktionen darauf laufen lassen — Vorlage ist der Lauf
vom 10.09.2026, der den Befund zu `devKurzname` gefunden hat. Zu prüfen:
Gruppen, Ausschlussfilter mit einem echt vergebenen Label, und ob
`devZielFuellen` für eine echte Entität ein brauchbares Ziel liefert.
Auffälligkeiten beheben, bevor getaggt wird.

- [ ] **Schritt 2: README**

Im Abschnitt `busch-device-card` die Optionstabelle auf die dreizehn
Schlüssel bringen, die Aktionsform als YAML zeigen, die drei Platzhalter
nennen und das Verhalten beim Zuklappen beschreiben. Den Abschnitt „Geprüft"
oben auf `0.11.0` und das heutige Datum setzen und die Nachweiszeile für
`render-geraet.py` um Dienstaufrufe und Zeilenklicks ergänzen.

- [ ] **Schritt 3: Version**

`CARD_VERSION` von `"0.10.1"` auf `"0.11.0"`.
Run: `node --check dist/busch-cards.js && node --test tests/*.test.js`

- [ ] **Schritt 4: Die vier Abnahme-Belege**

```bash
cd .. && for f in busch-cards/dist/*.js; do node --check "$f" || exit 1; done
python3 scripts/ui-regeln-pruefen.py
cd busch-cards
```
Erwartet: fehlerfrei und `GESAMT 0 Verstöße`. Beleg 3 ist der Lauf aus
Aufgabe 7, Beleg 4 sind README und `docs/stand.md`.

- [ ] **Schritt 5: Commit, Push, Tag**

```bash
git add README.md dist/busch-cards.js
git commit -m "busch-device-card 0.11.0: Aktionen, Kontext, Gruppen, Negativfilter"
git push origin main
git tag -a v0.11.0 -m "v0.11.0 — Dienstaufrufe mit Kontext, klappbare Gruppen, Label-Ausschluss"
git push origin v0.11.0
```

Danach warten, bis `Release` und `Validate` auf dem Tag **grün** sind
(GitHub-API mit dem Token aus
`/mnt/user/appdata/claude-code/secrets/gh-token`), und prüfen, dass das
Release `busch-cards.js` als Anhang trägt.

- [ ] **Schritt 6: In HACS installieren und belegen**

Über den MCP-Server: `ha_manage_hacs` mit `action: "update_information"`, dann
mit `action: "download"` und `version: "v0.11.0"`. **Beleg:**

```bash
curl -s -o /tmp/live.js http://192.168.1.17:8123/hacsfiles/ha-busch-cards/busch-cards.js
grep -oE 'CARD_VERSION = "[^"]+"' /tmp/live.js
md5sum /tmp/live.js dist/busch-cards.js
```

Beide Summen müssen gleich sein und die Version `0.11.0` lauten.

- [ ] **Schritt 7: Übergabe fortschreiben**

`../docs/stand.md` um einen Block für `0.11.0` ergänzen (Belege, was der Lauf
gegen echte Daten ergab, und was **nicht** belegt ist), und in `../CLAUDE.md`
die Versionstabelle auf `v0.11.0` sowie Punkt 7 unter „HIER WEITERMACHEN".
Vorher `git status` im `hacs`-Repo lesen und nur die eigenen Dateien vorlegen.

- [ ] **Schritt 8: Meldung**

```bash
"/mnt/user/Data/Claude Projekte/scripts/ha-notify.sh" \
  "HACS: busch-device-card 0.11.0 — Dienstaufrufe mit Kontext, klappbare Gruppen, Label-Ausschluss; ausgeliefert und installiert" \
  --agent "HACS"
```
