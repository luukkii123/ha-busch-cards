# busch-device-card 0.11.0 — Aktionen, Kontext, Gruppen, Negativfilter

**Stand:** 10.09.2026
**Repo:** `ha-busch-cards` (Ordner `hacs/busch-cards/`), HACS-Kategorie Dashboard
**Datei:** `dist/busch-cards.js`, Abschnitt `busch-device-card`
**Baut auf:** `docs/superpowers/specs/2026-09-09-geraetekarte-design.md` (Fassung `0.10.1`)

## 1. Was der Nutzer will

Vier Wünsche vom 10.09.2026, nachdem `0.10.1` im Dashboard stand:

1. **Zugeklappt soll wirklich zugeklappt sein.** Heute steht auch im
   zugeklappten Zustand das Bedienelement da, und die Gruppe Sensoren ist
   immer offen. Gewünscht: zugeklappt bleiben nur Icon, Gerätename und die
   Gerätedaten; alles andere erscheint erst beim Aufklappen. Jede Gruppe soll
   klappbar sein, mit einstellbarem Startzustand.
2. **Labels sollen auch ausschließen können**, nicht nur einschließen.
3. **Die Kopfzeile soll Dienste ausführen können**, mit der Oberfläche, die
   man von anderen Karten kennt.
4. **Eine angetippte Entitätenzeile ebenso** — und der Dienst soll die
   angeklickte Entität als Ziel bekommen können.

## 2. Die eine Machbarkeitsfrage, die das Design bestimmt

Home Assistant hat für Aktionen einen fertigen Editor, `hui-action-editor`,
erreichbar über den Selektor `ui_action`. Sein Auswahlfeld entsteht so
(`src/panels/lovelace/components/hui-action-editor.ts`, gelesen 10.09.2026):

```js
...actions.map((actn) => ({
  value: actn,
  label: this.hass.localize(`ui.panel.lovelace.editor.action-editor.actions.${actn}`),
}))
```

`localize` wird **ohne Rückfallwert** aufgerufen. Ein eigener Eintrag wie
`expand` hätte dort keinen Text — eine leere Zeile im Auswahlfeld. Das
verletzt `docs/ui-regeln.md`, Regel 3 („jedes Feld erklärt, zweisprachig").

Eine Karte kann keine Übersetzungen in HA nachladen. Also **teilt sich jede
Geste in zwei Felder**: eine eigene, zweisprachig beschriftete Auswahl für die
Art, und darunter — nur bei der Art „Aktion von Home Assistant" — HAs eigenen
Editor. Gespeichert wird trotzdem **ein** Schlüssel in HAs Objektform.

Die Voreinstellung des Selektors nennt genau die Aktionen, die HA selbst
übersetzt:

```js
{ selector: { ui_action: { actions: ["more-info", "toggle", "navigate", "url", "perform-action", "none"] } } }
```

`assist` fehlt bewusst: Der Assist-Dialog kommt über einen bundle-internen
Import, an den eine Karte nicht herankommt (dieselbe Lage wie beim
Kalender-Dialog, siehe `calHoleDialogImporte`). Ein Eintrag, der nichts tut,
wäre schlimmer als keiner.

## 3. Aktionen — Datenform und Ausführung

### 3.1 Die gespeicherte Form

Ein Aktionsfeld hält HAs Objektform:

```yaml
tap_action:
  action: perform-action        # more-info | toggle | navigate | url | perform-action | none | expand | device-page
  perform_action: label.add     # nur bei perform-action
  target: { entity_id: "{{ entity }}" }
  data: { label_id: geprueft }
  navigation_path: /lovelace/geraete   # nur bei navigate
  url_path: https://…                  # nur bei url
```

`expand` und `device-page` sind die beiden **eigenen** Arten. Sie tauchen in
HAs Editor nie auf, nur in der Auswahl darüber.

### 3.2 Migration der Kurzform aus `0.10.x`

`devMigriereKonfig(config)` läuft vor der Normalisierung und ist **idempotent**:

| Alt | Neu |
| --- | --- |
| `tap_action: "expand"` (Zeichenkette) | `tap_action: { action: "expand" }` |
| `hold_action: "more-info"` | `hold_action: { action: "more-info" }` |
| `action: "navigate"` + `navigation_path: "/x"` auf oberster Ebene | `{ action: "navigate", navigation_path: "/x" }`, oberste Ebene entfällt |
| `action: "call-service"`, `service: "x.y"` | `action: "perform-action"`, `perform_action: "x.y"` |
| `show_config: false` | `"config"` fehlt in `groups` |
| `show_diagnostic: false` | `"diagnostic"` fehlt in `groups` |

`navigation_path`, `show_config` und `show_diagnostic` verschwinden als
eigene Schlüssel. Eine Konfiguration aus `0.10.1` funktioniert weiter, ohne
dass jemand sie anfasst.

### 3.3 Ausführung

`devFuehreAus(karte, hass, aktion, kontext)` — die einzige Stelle, die
Aktionen ausführt, für Kopfzeile **und** Zeilen:

| `action` | Was passiert |
| --- | --- |
| `expand` | Karte auf-/zuklappen. Bei einer Zeile ohne Wirkung |
| `device-page` | `/config/devices/device/<geräte-id>` |
| `more-info` | Ereignis `hass-more-info` mit `{{ entity }}` des Kontexts |
| `toggle` | `homeassistant.toggle` auf `{{ entity }}` |
| `navigate` | `history.pushState` + Ereignis `location-changed` am `window` |
| `url` | `window.open(url_path, "_blank", "noreferrer")` |
| `perform-action` | `hass.callService(domain, dienst, data, target)` |
| `none`, unbekannt | nichts |

`perform-action` ohne `perform_action`, oder mit einem Wert ohne Punkt, tut
nichts und schreibt eine Warnung in die Konsole. Ein fehlgeschlagener
Dienstaufruf wird gefangen; die Karte bleibt stehen und zeigt den Fehlertext
zwei Sekunden lang unter der Kopfzeile (`texte.dienstFehler`).

**Nicht unterstützt:** `assist` (Abschnitt 2) und `confirmation`. HAs
Aktionseditor bietet `confirmation` selbst nicht an; wer eine Rückfrage
braucht, ruft ein Skript auf, das sie stellt. Steht so im Hilfetext.

## 4. Kontextvariablen

`devKontext(entityId, geraet, bereich)` liefert:

```js
{ entity: "sensor.keller_flurlicht_linkquality", device: "ecd6cde3…", area: "k_flur" }
```

Bei der **Kopfzeile** ist `entity` die Hauptentität der Karte, bei einer
**Zeile** die angetippte Entität. `device` und `area` gehören immer zum Gerät
der Karte.

`devPlatzhalterErsetzen(wert, kontext)` läuft **rekursiv** über `target` und
`data`, durch Objekte und Listen hindurch, und ersetzt in jeder Zeichenkette:

| Platzhalter | Wert |
| --- | --- |
| `{{ entity }}` | Entitäts-ID |
| `{{ device }}` | Geräte-ID |
| `{{ area }}` | Bereichs-ID, leer wenn das Gerät keinem Bereich zugewiesen ist |

Erlaubt ist auch die Schreibweise ohne Leerzeichen (`{{entity}}`). Sonst
nichts: **kein Jinja**, keine Bedingungen, keine Filter. Ein unbekannter
Ausdruck wie `{{ state }}` bleibt unverändert stehen, statt still zu
verschwinden — so sieht der Nutzer im Dienstaufruf, dass er nicht gegriffen
hat. Der Hilfetext des Feldes nennt die drei Namen.

`devZielFuellen(aktion, kontext)`: Hat eine `perform-action` **kein** `target`
oder ein leeres, wird `target: { entity_id: kontext.entity }` gesetzt. Ein
gesetztes Ziel bleibt unangetastet, auch wenn es eine andere Entität nennt.

Reihenfolge: erst `devZielFuellen`, dann `devPlatzhalterErsetzen`.

## 5. Zeilen antippen, ohne die Schalter kaputtzumachen

**Klicks werden nicht abgefangen.** Wer alle Klicks auf einer Zeile schluckt,
macht den Schalter einer Schalterzeile unbedienbar — und genau der ist der
Grund, HAs Zeilen überhaupt zu benutzen.

Stattdessen: HAs Entitätenzeilen feuern beim Antippen des Namensbereichs ein
`hass-more-info`-Ereignis, das aufsteigt und Schattengrenzen überquert. Die
Karte hört **auf dem Listencontainer** darauf:

```js
this._liste.addEventListener("hass-more-info", (ereignis) => {
  const id = ereignis.detail && ereignis.detail.entityId;
  if (!id) return;
  if (this._haltVerbraucht) { ereignis.stopPropagation(); this._haltVerbraucht = false; return; }
  const aktion = this._config.row_tap_action;
  if (!aktion || aktion.action === "more-info") return;   // HAs Weg bleibt
  ereignis.stopPropagation();
  devFuehreAus(this, this._hass, aktion, devKontext(id, geraet, bereich));
});
```

Der Schalter einer Schalterzeile feuert **kein** `hass-more-info` und bleibt
deshalb unberührt. Ist keine Zeilenaktion eingestellt, ändert sich gar nichts
gegenüber `0.10.1`.

**Halten auf einer Zeile** braucht Zeigerereignisse. Jede Zeile bekommt einen
Rahmen (`div.dev-zeile`), darauf dieselbe 500-ms-Erkennung wie die Kopfzeile
(Bewegung über 10 px bricht ab). Löst das Halten aus, wird `_haltVerbraucht`
gesetzt; das danach folgende `hass-more-info` wird geschluckt, damit nicht
beides passiert.

Der Rahmen hört nur zu. Er hat keinen eigenen Klick-Behandler und ändert
`pointer-events` nicht, damit jedes Bedienelement der Zeile erreichbar bleibt.

**Keine Schleife.** Führt eine Zeilenaktion selbst `more-info` aus, feuert die
Karte das Ereignis an **sich** (`this`), nicht in der Liste. Der Weg nach oben
führt an `_liste` vorbei, weil `_liste` ein Kind der Karte ist und kein
Vorfahre. Der Horcher greift also nur bei Ereignissen, die wirklich aus einer
Zeile kommen.

## 6. Zugeklappt heißt zugeklappt

| Zustand | Sichtbar |
| --- | --- |
| **zu** | Icon, Gerätename, Untertitel (wenn `show_subtitle`), Label-Marken, Pfeil |
| **offen** | zusätzlich das Bedienelement und alle sichtbaren Gruppen |

Das ist die Änderung gegenüber `0.10.1`, wo das Bedienelement immer stand.

**Der Pfeil ist immer sichtbar**, sobald ein Gerät aufgelöst wurde — auch bei
einem Gerät mit nur einer Entität, denn zugeklappt ist selbst das
Bedienelement weg. Nur im Fehlerfall (Abschnitt 9 des Vorgänger-Specs) fehlt
er. Die Regel „`hatListe`" aus `0.10.1` entfällt damit.

`getCardSize()` liefert zugeklappt `2`, offen `3 + Zeilenzahl`.

`getStubConfig` setzt zusätzlich `start_expanded: true`, damit die Vorschau im
Kartenwähler etwas zeigt. Die **Vorgabe** von `start_expanded` bleibt `false`.

## 7. Gruppen

Zwei Mehrfachauswahlen lösen `show_config` und `show_diagnostic` ab:

| Feld | Werte | Vorgabe |
| --- | --- | --- |
| `groups` | `control`, `sensor`, `config`, `diagnostic` | alle vier |
| `groups_open` | dieselben vier | nur `control` |

`groups` sagt, welche Gruppe überhaupt gezeichnet wird; `groups_open`, welche
offen startet. Ein Wert in `groups_open`, der nicht in `groups` steht, wird
still übergangen. **Jede** Gruppe bekommt jetzt einen Klapp-Pfeil und einen
Zähler im Kopf, nicht mehr nur Konfiguration und Diagnose.

Der Klappzustand lebt nur im Speicher; ein Klick schreibt nichts in die
Konfiguration zurück. Nach einem Neuladen gilt wieder `groups_open`.

## 8. Label-Filter mit Ausschluss

`devLabelFilter(eintraege, labels, labelsHide)`:

1. Ist `labels` nicht leer, bleiben nur Einträge mit **mindestens einem**
   dieser Labels.
2. Danach fallen alle Einträge weg, die **mindestens eines** aus `labels_hide`
   tragen. **Ausschluss schlägt Einschluss** — ein Eintrag mit beiden Labels
   verschwindet.
3. Beide leer: alles bleibt.

Die Hauptentität steht nicht in der Liste und ist von beidem unberührt.

In der Kopfzeile erscheinen beide Sorten als Marken: eingeschlossene wie
bisher, ausgeschlossene **durchgestrichen** und mit halber Deckkraft
(`.dev-chip-aus`). Ohne diese Anzeige sähe niemand, warum die Liste kurz ist.

## 9. Optionen

Dreizehn Schlüssel. Alle im Editor, jeder mit Beschriftung und Hilfetext in
Deutsch und Englisch.

| Option | Typ | Vorgabe | Wirkung |
| --- | --- | --- | --- |
| `entity` | Entität, Pflicht | — | wie `0.10.1` |
| `title` | Text | leer | wie `0.10.1` |
| `template` | Auswahl | `auto` | wie `0.10.1` |
| `labels` | Labels, mehrfach | leer | nur Entitäten mit einem dieser Labels |
| `labels_hide` | Labels, mehrfach | leer | Entitäten mit einem dieser Labels verbergen |
| `groups` | Auswahl, mehrfach | alle vier | welche Gruppen erscheinen |
| `groups_open` | Auswahl, mehrfach | `control` | welche Gruppen offen starten |
| `show_subtitle` | ja/nein | an | Hersteller · Modell · Bereich |
| `start_expanded` | ja/nein | aus | Karte startet aufgeklappt |
| `tap_action` | Aktion | `{action: expand}` | Tippen auf die Kopfzeile |
| `hold_action` | Aktion | `{action: more-info}` | Halten auf der Kopfzeile |
| `row_tap_action` | Aktion | `{action: more-info}` | Tippen auf eine Zeile |
| `row_hold_action` | Aktion | `{action: none}` | Halten auf einer Zeile |

Dazu **zwei Felder, die nur im Editor leben** und in keiner Konfiguration
landen: `tap_kind` und `hold_kind`. Sie halten die Art der Kopfzeilen-Aktion
(`expand`, `device-page`, `ha`) und werden aus dem gespeicherten Wert
abgeleitet. Die Zeilenfelder brauchen so etwas nicht: `expand` ergibt dort
keinen Sinn und `device-page` führt zum selben Gerät wie die Kopfzeile, also
bieten sie direkt HAs Editor an.

## 10. Der Editor

`SCHEMA_BUSCH_DEVICE_CARD` bleibt ein **Objektliteral auf oberster Ebene** mit
**allen** Feldern. Das ist keine Stilfrage: `scripts/ui-regeln-pruefen.py`
liest die Konstante über Klammernpaarung aus dem Quelltext und kann eine
berechnete Schemafunktion nicht lesen (siehe den Kopf des Skripts, „Die
vereinbarte Wörterbuchform"). Ein Schema aus einer Funktion wäre für die
Prüfung unsichtbar.

`devSchemaFuer(konfig)` liefert dem Editor eine **gefilterte Kopie**: das Feld
`tap_action` erscheint nur, wenn `tap_kind === "ha"`, `hold_action` nur bei
`hold_kind === "ha"`. Der Prüfer sieht weiterhin das volle Literal und
verlangt für jedes Feld Beschriftung und Hilfetext; die bekommt jedes.

Beim `value-changed` setzt der Editor das Schema neu, wenn sich eine Art
geändert hat, und schreibt die Konfiguration:

- Art `expand` oder `device-page` → `tap_action = { action: <art> }`
- Art `ha` → `tap_action` bleibt, was HAs Editor liefert; war vorher eine
  eigene Art gesetzt, startet es bei `{ action: "more-info" }`

Die beiden Art-Felder werden vor dem Melden **aus den Daten entfernt**. HAs
`ha-form` reicht bei `value-changed` immer das ganze Datenobjekt zurück, also
auch `tap_kind` und `hold_kind`; ungefiltert stünden sie im Dashboard-YAML und
der Regelprüfer fände einen Schlüssel ohne Wirkung.

Vorgaben wandern wie bisher nicht in die Konfiguration: Ein Feld, das seinem
Standardwert entspricht, wird gelöscht. Für die Aktionsfelder heißt das ein
Vergleich über `JSON.stringify`, weil es Objekte sind.

## 11. Namensraum

Fortsetzung von Abschnitt 10 des Vorgänger-Specs: jeder neue Name auf oberster
Ebene beginnt mit `dev` oder `DEV_`.

Neu: `DEV_GRUPPEN_WERTE`, `DEV_HA_AKTIONEN`, `DEV_ARTEN`,
`devMigriereKonfig`, `devAktionNormalisieren`, `devKontext`,
`devPlatzhalterErsetzen`, `devZielFuellen`, `devFuehreAus`, `devArtVon`,
`devSchemaFuer`, `devGruppenSichtbar`, `devGruppeOffen`.

Geändert: `devLabelFilter` bekommt ein drittes Argument.
Entfällt: `DEV_AKTIONEN` (die alte Zeichenkettenliste).

Nachweis wie bisher über `tests/namensraum.test.js`, das die Datei als
ES-Modul durch den Parser schickt.

## 12. Fehler

Zusätzlich zu den Fällen aus `0.10.1`:

| Fall | Verhalten |
| --- | --- |
| `perform-action` ohne `perform_action` | nichts, Warnung in der Konsole |
| `perform_action` ohne Punkt (`"licht"`) | nichts, Warnung in der Konsole |
| Dienstaufruf wirft | Fehlertext zwei Sekunden unter der Kopfzeile, Karte bleibt |
| `navigate` ohne Pfad | nichts |
| `url` ohne Pfad | nichts |
| Platzhalter unbekannt | bleibt wörtlich stehen |
| `{{ area }}` ohne Bereich | leere Zeichenkette |
| `groups` leer | keine Gruppe, nur Kopfzeile und Bedienelement |
| Zeilenaktion gesetzt, Zeile ohne `hass-more-info` | keine Wirkung, kein Fehler |

## 13. Nachweis

**Ohne Nachweis wird nicht getaggt** (`hacs/CLAUDE.md`, „Nicht verhandelbar").
Die vier Belege aus `docs/ui-regeln.md`, „Abnahme", und darüber hinaus:

1. **Node-Tests** gegen die Attrappe aus `tests/geraet-attrappe.js`:
   Migration (jede Zeile der Tabelle in 3.2, und zweimal angewandt ergibt
   dasselbe), Kontext, Platzhalter in Tiefe, Zielfüllung, Label-Filter mit
   Ausschluss und Vorrang, Gruppen sichtbar und offen, Schemafilterung,
   Ableitung der Art, Wörterbuch vollständig in beiden Sprachen.
2. **Statischer Regelprüfer** über alle sieben Repos ohne Befund.
3. **Chromium-Lauf** `docs/render/render-geraet.py`, erweitert um:
   - eine Attrappe, die `callService` **mitschreibt**, statt sie nur
     entgegenzunehmen;
   - eine Zeilen-Attrappe, die auf Tippen `hass-more-info` feuert **und**
     eine Schalterzeile mit einem Knopf, der es **nicht** feuert;
   - Sollwerte: Kopfzeile antippen ruft den Dienst mit dem ersetzten Ziel;
     eine Zeile antippen ruft ihn mit **ihrer** Entität; der Schalter der
     Schalterzeile bleibt bedienbar und löst **keinen** Dienst aus;
     zugeklappt ist kein Bedienelement im DOM; jede Gruppe klappt.
   - Regel 1 wie bisher bei 320/480/960 px, hell und dunkel.
4. **Kalender- und Zeitplan-Karte** danach erneut messen — sie teilen sich die
   Datei.
5. **Echte Registerdaten** aus der laufenden Installation über den
   Home-Assistant-MCP-Server, wie am 10.09.2026: ein Gerät holen, die reinen
   Funktionen darauf laufen lassen, das Ergebnis lesen. Der Befund zu
   `devKurzname` ist genau so entstanden.

## 14. Auslieferung

- `CARD_VERSION` auf `0.11.0`.
- `README.md`: Abschnitt der Gerätekarte neu schreiben — Optionstabelle,
  Aktionsformat, die drei Platzhalter, das Verhalten beim Zuklappen.
- Commit und Push sind freigegeben. **Tag `v0.11.0` erst nach den vier
  Belegen**, dann Release über den Workflow, danach in HACS „Update
  information" und installieren.
- `hacs/CLAUDE.md` und `docs/stand.md` fortschreiben.

## 15. Nicht enthalten

- **`assist` als Aktion** (Abschnitt 2).
- **`confirmation`** an einer Aktion (Abschnitt 3.3).
- **Echtes Jinja** in Ziel und Daten. Drei Platzhalter, sonst nichts.
- **Klappzustand merken.** Die Karte schreibt nichts zurück; nach dem Neuladen
  gilt wieder `groups_open` und `start_expanded`.
- **Mehrere Geräte je Karte** — unverändert offen aus dem Vorgänger-Spec.
- **Eigene Zeilendarstellung.** Zeilen bleiben HAs Bausteine.
