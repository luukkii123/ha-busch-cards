# busch-device-card — eine Entität, ihr ganzes Gerät

**Stand:** 09.09.2026
**Repo:** `ha-busch-cards` (Ordner `hacs/busch-cards/`), HACS-Kategorie Dashboard
**Datei:** `dist/busch-cards.js` — vierte Karte neben Zeitplan, Landkarte und Kalender

## 1. Das Problem

Ein Shelly hat vier Entitäten, ein Aqara-Sensor drei, ein Klimagerät zehn. Im
Dashboard steht davon meist eine — die Lampe, der Messwert — und wer wissen
will, was das Gerät sonst noch kann (Leistung, Signal, Firmware, Kindersicherung),
muss unter Einstellungen → Geräte suchen.

Gewünscht ist eine Karte, der man **irgendeine** Entität gibt und die daraus
**das Gerät** macht: Name, Hersteller, Modell, Bereich, das passende
Bedienelement oben und darunter alle übrigen Entitäten des Geräts, gruppiert
wie auf HAs Geräteseite. Welche Bedienelemente oben stehen, richtet sich nach
der Art der Entität und ist im Editor überschreibbar. Welche Entitäten unten
erscheinen, lässt sich über Labels eingrenzen.

**Genau ein Gerät je Karte.** Eine Geräteliste (alle Geräte eines Bereichs,
eines Herstellers) ist bewusst nicht Teil dieser Karte — Abschnitt 11.

## 2. Datenquelle — alles liegt schon im `hass`-Objekt

Die Karte braucht **keine Integration** und, bis auf die Label-Namen, keinen
Server-Aufruf. Belegt am Frontend-Quelltext (`dev`, gelesen 09.09.2026):

| Register | Ort | Genutzte Felder |
| --- | --- | --- |
| Entitäten | `hass.entities[entity_id]` (`EntityRegistryDisplayEntry`, `src/data/entity/entity_registry.ts`) | `device_id`, `area_id`, `labels` (IDs), `hidden`, `entity_category` (`config` / `diagnostic`), `platform`, `name`, `icon` |
| Geräte | `hass.devices[device_id]` (`DeviceRegistryEntry`, `src/data/device/device_registry.ts`) | `name`, `name_by_user`, `manufacturer`, `model`, `area_id`, `labels`, `id` |
| Bereiche | `hass.areas[area_id]` | `name`, `icon` |
| Labels | WebSocket `{ type: "config/label_registry/list" }` (`src/data/label/label_registry.ts`, `fetchLabelRegistry`) | `label_id`, `name`, `icon`, `color` |
| Zustände | `hass.states[entity_id]` | nur zum Durchreichen an HAs Bausteine |

`hass.entities` enthält **alle** registrierten Entitäten, nicht nur die des
Dashboards. Die Entitäten eines Geräts sind also ein Durchlauf:

```js
Object.values(hass.entities).filter((e) => e.device_id === deviceId && !e.hidden)
```

Die Label-Liste wird **einmal je Karteninstanz** geholt, beim ersten `hass`,
und im Modul zwischengespeichert (`devLabelCache`, ein Promise), damit zehn
Gerätekarten auf einer Seite einen Aufruf machen, nicht zehn. Schlägt der
Aufruf fehl, filtert die Karte weiter über die IDs; nur die Anzeige der
Label-Namen fällt aus (Abschnitt 9).

## 3. Geräteauflösung

```
entity  →  hass.entities[entity].device_id  →  hass.devices[device_id]
                                            →  hass.areas[device.area_id]
```

- **Anzeigename:** `device.name_by_user`, sonst `device.name`, sonst die
  Entitäts-ID. `title` in der Konfiguration überschreibt alles.
- **Untertitel:** `manufacturer · model · Bereichsname`, jeder Teil nur, wenn
  vorhanden; leere Teile fallen samt Trennpunkt weg.
- **Integration:** `hass.entities[entity].platform` — die Domain der
  Integration (`shelly`, `mqtt`, `zha`). Angezeigt als Brand-Icon
  `https://brands.home-assistant.io/_/<platform>/icon.png` vor dem Untertitel,
  16 px, mit `onerror` ausgeblendet. Das ist derselbe Bilddienst, den HA für
  seine Integrationsseiten nutzt; nichts wird ausgeliefert oder eingebettet.
- **Hauptentität** ist die angegebene Entität. Sie bestimmt die Vorlage
  (Abschnitt 4) und das Kopfzeilen-Icon (`hass.entities[entity].icon`, sonst
  das Zustands-Icon über `ha-state-icon`).

## 4. Darstellungsvorlagen

Die Vorlage legt fest, mit welchen **Features** HAs eigene Tile-Karte für die
Hauptentität erzeugt wird:

```js
const helfer = await window.loadCardHelpers();
const tile = helfer.createCardElement({
  type: "tile",
  entity: entityId,
  features: DEV_VORLAGEN[vorlage].features,
});
tile.hass = hass;
```

`createCardElement` ist die dokumentierte Helferschnittstelle
(`src/panels/lovelace/custom-card-helpers.ts`); die Kalenderkarte nutzt sie
schon. Die Feature-Typen sind in `src/panels/lovelace/card-features/types.ts`
belegt.

| Vorlage | Greift bei Domain | Features |
| --- | --- | --- |
| `light` | `light` | `light-brightness` |
| `climate` | `climate` | `target-temperature`, `climate-hvac-modes` |
| `cover` | `cover` | `cover-open-close`, `cover-position` |
| `fan` | `fan` | `fan-speed` |
| `media` | `media_player` | `media-player-volume-slider` |
| `lock` | `lock` | `lock-commands` |
| `switch` | `switch`, `input_boolean` | `toggle` |
| `generic` | alles andere | keine — das Tile zeigt Icon, Name, Zustand |

`template: auto` (Vorgabe) wählt nach der Tabelle; jeder andere Wert erzwingt
die Vorlage. Wer eine Vorlage auf eine Domain zwingt, die das Feature nicht
unterstützt (etwa `light` auf einen Sensor), bekommt ein Tile **ohne** dieses
Feature: HAs `hui-card-feature` rendert nicht unterstützte Features leer und
wirft nicht. Dasselbe gilt für ein Feature, das die installierte HA-Version
noch nicht kennt (`toggle` ist jünger als das Mindestmaß 2024.11 in
`hacs.json`): Das Tile erscheint dann ohne Feature, Icon-Tipp schaltet. Die Karte prüft das nicht selbst; das wäre eine Kopie von HAs
`supportsFeature`-Logik.

**Hersteller, Modell und Integration** bestimmen die Vorlage **nicht**. Sie
stehen im Untertitel. Eine Zuordnung „Shelly-Geräte so, Aqara-Geräte so" wäre
eine Regeltabelle im Editor — Abschnitt 11.

## 5. Entitätenliste — gruppiert wie HAs Geräteseite

Im aufgeklappten Zustand stehen unter dem Tile alle **übrigen** Entitäten des
Geräts (die Hauptentität nicht noch einmal). Die Gruppierung folgt
`ha-config-device-page.ts`, `_entitiesByCategory`, mit zwei bewussten
Vereinfachungen:

| Gruppe | Regel | Zustand |
| --- | --- | --- |
| **Steuerung** | keine `entity_category`, Domain nicht in der Sensorliste | offen |
| **Sensoren** | keine `entity_category`, Domain in `sensor, binary_sensor, calendar, camera, device_tracker, image, weather, event` | offen |
| **Konfiguration** | `entity_category === "config"` | eingeklappt, Kopf mit Zähler |
| **Diagnose** | `entity_category === "diagnostic"` | eingeklappt, Kopf mit Zähler |

Die Sensorliste ist HAs `SENSOR_ENTITIES` aus `src/common/const.ts` plus
`event`; HA führt `event` und `notify` als eigene Gruppen und Assist-Entitäten
als fünfte. Diese Karte faltet `event` in Sensoren und `notify` sowie Assist in
Steuerung — vier Gruppen reichen für eine Karte, sieben nicht.

Leere Gruppen werden nicht gezeichnet. Innerhalb einer Gruppe sortiert nach
Anzeigename (`hass.entities[id].name`, sonst `friendly_name` aus dem Zustand).

**Die Zeilen sind HAs Entities-Zeilen:**

```js
const zeile = helfer.createRowElement({ entity: entityId });
zeile.hass = hass;
```

Damit stimmen Formatierung, Einheiten, Toggle für Schalter, Klick öffnet
More-Info — für jede Domain, ohne dass diese Datei HAs Zustandslogik
nachbaut.

**Label-Filter:** Ist `labels` nicht leer, erscheinen nur Entitäten, deren
`labels`-Feld **mindestens eines** der gewählten Label enthält (Oder-Verknüpfung).
Die Hauptentität ist vom Filter ausgenommen — sonst kann die Karte sich selbst
leer filtern. Das Tile bleibt immer.

Gewählte Label werden in der Kopfzeile als Chips mit Icon und Farbe aus dem
Label-Register gezeigt; ohne Register nur die IDs.

## 6. Aktionen und Aufklappen

Die **Kopfzeile** ist die Klickfläche der Karte (Tile und Zeilen haben ihre
eigenen HA-Aktionen). Tippen und Halten sind einstellbar:

| Wert | Wirkung |
| --- | --- |
| `expand` | Entitätenliste auf-/zuklappen (Vorgabe für `tap_action`) |
| `more-info` | `hass-more-info` für die Hauptentität (Vorgabe für `hold_action`) |
| `toggle` | `homeassistant.toggle` auf die Hauptentität |
| `device-page` | HAs Geräteseite `/config/devices/device/<id>` über `history.pushState` + `location-changed` |
| `navigate` | Pfad aus `navigation_path`, gleicher Weg |
| `none` | nichts |

Das ist ein eigenes Auswahlfeld und **nicht** HAs `ui_action`-Selektor, weil
der `expand` und `device-page` nicht kennt. `perform-action`/`call-service`
fehlt absichtlich: Das Tile darunter bietet es für die Hauptentität selbst.

Halten wird wie in HA erkannt: `pointerdown` startet 500 ms, `pointerup` davor
ist Tippen, danach Halten; ein `pointermove` über 10 px bricht ab.

**Aufklappen** ist kein Popup: Es überlagert nichts und ersetzt nichts, also
gilt Regel 2 (Escape, Zurück) nicht. Der Pfeil in der Kopfzeile dreht sich,
die Liste erscheint darunter, die Karte wird höher. `start_expanded: true`
startet offen. Ein Mausklick auf den Pfeil klappt immer, unabhängig von
`tap_action`.

## 7. Aktualisieren ohne Flackern

`set hass(hass)` wird bei **jedem** Zustandswechsel im Haus aufgerufen. Die
Karte unterscheidet zwei Fälle:

1. **Struktur unverändert** — dieselbe Geräte-ID, dieselbe Menge sichtbarer
   Entitäts-IDs (als sortierte, verkettete Zeichenkette verglichen), dieselbe
   Konfiguration: nur `hass` an Tile, Zeilen und Kopfzeilen-Icon durchreichen.
   Kein DOM-Umbau.
2. **Struktur verändert** — Gerät gewechselt, Entität hinzugekommen oder
   ausgeblendet, Konfiguration neu: Tile und Zeilen neu erzeugen.

Die Helfer werden **einmal** geladen (`devHelfer`, Promise im Modul) und bis
zum Eintreffen zeigt die Karte Kopfzeile und den Hinweis „lädt".

## 8. Optionen

Alle im grafischen Editor, jede mit Label und Helper in Deutsch und Englisch
(`docs/ui-regeln.md`, Regel 3). Keine Option existiert nur in YAML.

| Option | Typ / Selektor | Standard | Wirkung |
| --- | --- | --- | --- |
| `entity` | `entity` (Pflicht) | — | Entität, über die das Gerät gefunden wird; zugleich Hauptentität |
| `title` | `text` | leer | Überschrift; leer = Gerätename |
| `template` | `select`: `auto` + die acht Vorlagen | `auto` | Darstellungsvorlage, siehe Abschnitt 4 |
| `labels` | `label { multiple: true }` | leer | nur Entitäten mit einem dieser Label; leer = alle |
| `show_subtitle` | `boolean` | `true` | Hersteller · Modell · Bereich unter dem Namen |
| `show_config` | `boolean` | `true` | Gruppe Konfiguration überhaupt zeigen |
| `show_diagnostic` | `boolean` | `true` | Gruppe Diagnose überhaupt zeigen |
| `start_expanded` | `boolean` | `false` | Liste beim Laden offen |
| `tap_action` | `select` (Abschnitt 6) | `expand` | Tippen auf die Kopfzeile |
| `hold_action` | `select` (Abschnitt 6) | `more-info` | Halten auf der Kopfzeile |
| `navigation_path` | `text` | leer | Ziel für `navigate`; ohne Wirkung sonst |

`getStubConfig(hass, entities)` wählt die erste Entität aus `entities`, die ein
`device_id` hat — damit zeigt die Vorschau im Kartenwähler sofort ein Gerät.
`getCardSize()` liefert 3 eingeklappt, 3 plus Zeilenzahl aufgeklappt.
`getGridOptions()`: `columns: 12, min_columns: 6, rows: "auto"`.

Auswahltexte der `select`-Felder kommen über `buschSchemaMitTexten` aus dem
Wörterbuch (`texte["template_light"]`, `texte["tap_action_expand"]`, …), wie
bei der Landkarte.

## 9. Fehler

| Fall | Verhalten |
| --- | --- |
| `entity` leer | Hinweis „Keine Entität gewählt" mit Verweis auf den Editor |
| Entität nicht in `hass.entities` | „`<id>` ist nicht registriert" — Karte bleibt, kein leerer Kasten |
| Entität ohne `device_id` | „`<id>` gehört zu keinem Gerät" |
| `hass.entities` fehlt (sehr altes HA) | „Braucht Home Assistant 2024.11 oder neuer" |
| `loadCardHelpers` fehlt oder scheitert | Kopfzeile und Untertitel bleiben; statt Tile und Zeilen ein Satz „Bausteine von Home Assistant nicht ladbar" |
| Label-Register nicht abrufbar | Filter greift über IDs; Chips zeigen die ID statt des Namens; keine Fehlermeldung |
| Gerät hat außer der Hauptentität nichts | Tile allein, kein Aufklapp-Pfeil, `tap_action: expand` tut nichts |
| Label-Filter lässt nichts übrig | Tile allein, Hinweis „Kein Eintrag mit diesen Labels" in der Liste |

Alle Texte aus `TEXTE_BUSCH_DEVICE_CARD`.

## 10. Namensraum

`dist/busch-cards.js` hat einen flachen Namensraum (Kalender-Spec, Abschnitt 4,
und `tests/namensraum.test.js`). Belegt sind unter anderem `CARD_VERSION`,
`buschSprache`, `buschTexte`, `buschSchemaMitTexten`, `buschFuellen`, alle
`cal*`/`CAL_*`, `MAP_*`, `SCHEDULE_*`, `clamp`, `queryDeepShadow`.

**Regel:** Jeder neue Name auf oberster Ebene beginnt mit `dev` bzw. `DEV_`:
`DEV_STANDARD`, `DEV_VORLAGEN`, `DEV_SENSOR_DOMAINS`, `devGeraetAufloesen`,
`devEntitaetenDesGeraets`, `devGruppieren`, `devVorlageWaehlen`,
`devLabelCache`, `devHelfer`. Ausnahmen wie bei den anderen Karten:
`SCHEMA_BUSCH_DEVICE_CARD`, `TEXTE_BUSCH_DEVICE_CARD`, `BuschDeviceCard`,
`BuschDeviceCardEditor`, `waehlerGeraet`. `CARD_VERSION` wird hochgezählt, nicht
neu deklariert. Nachweis: `tests/namensraum.test.js` (Modulparser).

## 11. Nicht enthalten

- **Mehrere Geräte je Karte** (alle Geräte eines Bereichs, Herstellers,
  Labels). Der Nutzer hat sich am 09.09.2026 für „genau ein Gerät" entschieden.
  Eine Liste wäre eine zweite Karte, kein Modus dieser.
- **Gerät ohne Entität finden** („das Gerät mit Label X in Bereich Y"). Der
  Eingang ist immer eine Entität.
- **Vorlage nach Hersteller oder Integration.** Wäre eine Regeltabelle im
  Editor; heute zählt die Domain. Nachrüstbar über ein weiteres Feld, ohne
  bestehende Konfigurationen zu brechen.
- **`perform-action` als Kopfzeilen-Aktion.** Das Tile bietet es.
- **Gerät bearbeiten** (umbenennen, Bereich zuweisen). Dafür gibt es
  `device-page`.
- **Deaktivierte Entitäten** und `hidden`-Entitäten werden nicht gezeigt,
  auch nicht über eine Option — HAs Geräteseite zeigt versteckte nur bei
  deaktiviertem Gerät.
- **Eigene Zustandsformatierung.** Alles, was einen Zustand anzeigt, ist ein
  HA-Baustein.

## 12. Nachweis

**Ohne Nachweis wird nicht getaggt** (`hacs/CLAUDE.md`, „Nicht verhandelbar").

1. **Node-Tests** (`tests/geraet.test.js`, `tests/geraet-editor.test.js`,
   Sandbox aus `tests/laden.js`), gegen eine `hass`-Attrappe mit echten
   Registerformen aus Abschnitt 2:
   - Auflösung: Entität → Gerät → Bereich; `name_by_user` schlägt `name`;
     Untertitel ohne leere Teile.
   - Entitätenmenge: nur dasselbe `device_id`, keine `hidden`, Hauptentität
     nicht doppelt.
   - Gruppierung: die vier Gruppen nach Abschnitt 5, `event` bei Sensoren,
     Sortierung nach Name, leere Gruppen fehlen.
   - Vorlagenwahl: jede Domain der Tabelle, `auto` gegen Zwang, unbekannte
     Domain → `generic`.
   - Label-Filter: Oder-Verknüpfung, Hauptentität ausgenommen, leer = alle.
   - Strukturvergleich (Abschnitt 7): gleiche Menge → kein Umbau.
   - Editor: jede Option der Spec im Schema, jedes Schemablatt mit Label und
     Helper in beiden Sprachen, jeder `select`-Wert mit Text.
   - `tests/namensraum.test.js` weiter grün.
2. **Statische UI-Regeln:** `python3 scripts/ui-regeln-pruefen.py --repo
   busch-cards` ohne Befund für die neue Karte.
3. **Playwright im Container** (`docs/render/render-geraet.py`, Messmodul
   `docs/render/regeln.py`): Regel 1 bei 320/480/960 px, hell und dunkel,
   eingeklappt und aufgeklappt, mit langem Gerätenamen und langem Untertitel.
   `loadCardHelpers` wird dort gestubbt (ein Tile- und ein Zeilen-Element
   fester Höhe) — die Messung gilt der **eigenen** Kopfzeile, den
   Gruppenköpfen und Chips; HAs Bausteine misst HA.
4. **Echtes Home Assistant**, je ein Bild:
   - eine Shelly-Lampe (`light` → Helligkeitsfeature, Leistung unter Sensoren,
     Firmware unter Diagnose),
   - ein Aqara-Sensor (`generic`, drei Sensoren, Batterie unter Diagnose),
   - ein Klimagerät (`climate` → Solltemperatur und Modi).
   Dazu: Aufklappen, Halten öffnet More-Info, `device-page` landet auf der
   Geräteseite, Label-Filter reduziert die Liste, `template: switch` auf die
   Lampe zwingen und das Ergebnis ansehen.
5. **Die drei anderen Karten im selben Dashboard erneut ansehen** — sie
   teilen sich die Datei. Das ist der Schritt gegen die Namenskollision.
6. Editor öffnen, jede Option einmal umstellen.

## 13. Auslieferung

- `CARD_VERSION` von `0.9.1` auf `0.10.0`.
- Eintrag in `window.customCards` mit `type: "busch-device-card"`, Name und
  Beschreibung nach `navigator.language`.
- `README.md`: Kopftabelle auf vier Karten, eigener Abschnitt mit Optionen
  und den drei Bildern aus Schritt 4.
- `hacs/CLAUDE.md`: Versionstabelle erst **nach** dem Tag.
- Commit und Push sind freigegeben; **Tag `v0.10.0` erst nach den vier Belegen
  aus `docs/ui-regeln.md`, „Abnahme"**, und nur, wenn der Nutzer den Tag
  ausdrücklich will.
