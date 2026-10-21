# Entwicklung und Prüfung

Hintergrundwissen für Entwickler von Busch Cards: Designentscheidungen, interne
Verträge, Prüfbelege und Wiederholung der Läufe. Für Nutzer steht alles
Wichtige im [README](../README.md).

## Zeitplan-Karte: Regeln des Zeitplan-Helfers

Der Zeitplan-Helfer prüft streng. Die Karte hält sich daran, statt in einen
Fehler zu laufen:

- Blöcke dürfen sich **berühren** (`04:00` Ende, `04:00` Anfang), aber nicht
  überlappen. Beim Ziehen sind die Nachbarn deshalb harte Anschläge.
- Anfang muss **vor** dem Ende liegen; gleiche Zeiten sind ungültig.
- Ein Block darf bis Mitternacht laufen. Im Dialog gibt man dafür `00:00` als
  Endzeit an, im Balken steht `24:00`.
- `schedule/update` **ersetzt den ganzen Datensatz**. Die Karte schickt deshalb
  bei jedem Speichern Name, Icon, alle sieben Tage und ein etwaiges `data` je
  Block mit — sonst wäre nach dem ersten Ziehen das Icon weg.


## Zeitplan-Karte: Theme-Variablen im Detail

`--label-col` ist ein reines Innenmaß und steht auf `:host`; die beiden Farben
stehen dort **bewusst nicht**. Ein Theme setzt sie am Wurzelelement, von wo sie
die Karte durch Vererbung erreichen — und eine Vererbung verliert gegen jede
Regel, die das Element selbst trifft. Eine `:host`-Zeile für dieselbe Marke
würde den Haken also still totlegen. Genau das war am 09.09.2026 kurzzeitig der
Fall und ist in Chromium nachgemessen worden.

Stattdessen steht die Vorgabe an der Verwendungsstelle als Rückfall —
`var(--busch-schedule-color, var(--primary-color))` — und der Rückfall ist eine
HA-Variable, keine Hex-Farbe. Damit ist auch Regel 4 der
UI-Regeln der Projektverwaltung erfüllt: der statische Prüfer führt
beide Marken in seiner Liste `THEME_HAKEN` und besteht nur, solange der
Rückfall von Home Assistant kommt.

Der Nachweis, dass eine Theme-Angabe wirklich durchschlägt, läuft im
Playwright-Container mit: `render-zeitplan.py` misst die Blockfarbe erst ohne
Theme und dann mit `--busch-schedule-color: rgb(1, 2, 3)` am `<html>`.

## Landkarten-Karte: Warum sie nichts nachbaut

Sie erzeugt über `loadCardHelpers()` Home Assistants **eigene** `map`-Karte,
hängt sie in ihren Shadow-DOM und tauscht danach nur die Kachelebene an deren
`ha-map.leafletMap` aus. Alles Übrige — `entities` als Zeichenketten wie
Objekte, Zonenkreise, `hours_to_show`-Spuren, Genauigkeitsringe,
Personenbilder, `label_mode`, `attribute`, `unit`, `focus`, `name`, `color`,
`default_zoom`, `auto_fit`, `fit_zones`, `aspect_ratio`, `title`, `cluster`,
`scale_ruler` — funktioniert nicht *ähnlich*, sondern **identisch, weil es
dieselbe Karte ist**. Auch ein `custom:auto-entities` davor merkt keinen
Unterschied.

Nachbauen wäre der teurere Weg gewesen: vierzehn Optionen plus sechs Felder je
Entität, und bei jedem Home-Assistant-Update droht neue Abweichung.

**Der Preis, offen benannt:** Die Karte greift auf ein internes Element von
Home Assistant zu (`ha-map.leafletMap`). Ändert sich das, **fällt sie auf HAs
normale Karte mit deren eigenen Kacheln zurück** — nie auf ein leeres Feld.
Eine Zeile in der Browser-Konsole nennt dann den Grund. Der Rückfall ist
geprüft, nicht behauptet.

## Landkarten-Karte: Referer und Grenzen

**„403 Access blocked" auf den OpenStreetMap-Kacheln** war bis `0.16.2` ein
Fehler der Karte: Home Assistant liefert seine Oberfläche mit
`Referrer-Policy: no-referrer` aus, der Browser schickte den Kachelanfragen
also keinen Referer mit — und `tile.openstreetmap.org` antwortet darauf mit
einem Sperrbild statt der Karte. Seit `0.16.3` setzt die Karte an jeder
Kachel `referrerPolicy: strict-origin-when-cross-origin`: übertragen wird nur
der Ursprung (`http://<ha-adresse>:8123/`), nie der Dashboardpfad. Wer das
Sperrbild nach dem Update noch sieht, hat es im Browserspeicher —
einmal **Strg+F5**.

### Grenzen

- **Vektor-Grundkarten werden seit `0.8.0` ebenfalls ersetzt.** Home Assistant
  zeichnet seine Grundkarte je nach Version als Vektorkarte (MapLibre); deren
  URL lässt sich nicht tauschen. Die Karte legt dann eine **eigene
  Rasterebene** an — in einer eigenen Ebene mit `z-index: 250`, also über der
  Grundkarte, aber **unter** Routen und Markern. Die Vektorebene darunter wird
  entfernt, sofern sie sich zu erkennen gibt; sonst deckt die undurchsichtige
  Rasterebene sie ab.

  Dafür steckt **Leaflet 1.9.4** in der Datei — aus dem Kartenobjekt heraus ist
  keine `TileLayer`-Klasse erreichbar. Es wird **erst bei Bedarf ausgewertet**
  und **gar nicht**, wenn schon ein Leaflet auf der Seite liegt (etwa aus
  `ha-localtrack-cards`). Wer nur Zeitplan oder Kalender nutzt, zahlt nichts
  dafür — außer den Bytes beim Herunterladen: die Datei wächst dadurch von
  rund 92 kB auf rund 242 kB.
- **Kein Zwischenspeicher, kein Schlüssel.** Wer einen Anbieter mit Token
  braucht, trägt ihn in die eigene URL ein.
- **Kein eigenes Zeichnen.** Marker, Zonen und Spuren gehören der eingebauten
  Karte.

> Diese Karte lag bis zum 06.09.2026 als `localtrack-map-card` in
> [ha-localtrack-cards](https://github.com/luukkii123/ha-localtrack-cards).
> Sie brauchte Local Track nie und gehört deshalb hierher — zu den Karten ohne
> eigene Integration.

## Kalender-Karte: Summe und Klickverhalten

### Die Summe

`show_total` summiert die Dauern aller zeitgebundenen Termine des Monats.
**Ganztägige Termine gehen nicht in die Stundensumme ein**, sondern werden
getrennt gezählt und stehen linksbündig nebeneinander in der Fußzeile:
`20 Tage` `168,5 h` `1 ganztägig`. Sie mit 24 Stunden zu verrechnen würde die
Summe verfälschen. Die dritte Angabe erscheint nur, wenn es im Monat einen
ganztägigen Termin gab; die ersten beiden stehen deshalb an fester Stelle,
damit die Zeile nicht springt.

Die Summe zählt **nur den gezeigten Monat**: Ein Urlaub vom 25.07. bis 05.08.
steht im August mit seinen fünf August-Tagen im Fuß, nicht mit zwölf. Und ein
wiederkehrender Termin zählt so oft, wie er in der Liste steht — Home Assistant
gibt allen Instanzen einer Serie dieselbe Kennung, entdoppelt wird deshalb
nicht. Fuß und Liste sollen dasselbe sagen.

### Klick auf einen Termin

Seit `0.8.2` öffnet ein Klick auf eine Terminzeile **Home Assistants
Termin-Editor** — den mit den Eingabefeldern, nicht die Ansicht mit den
Knöpfen. Geht das nicht, fällt die Karte Stufe für Stufe zurück:

| Stufe | Was aufgeht | Wann |
| --- | --- | --- |
| 1 | **Editor** (`dialog-calendar-event-editor`) | Standardfall: Ändern erlaubt, kein ungeschützter Serientermin, `edit_on_tap: true` |
| 2 | **Ansicht** (`dialog-calendar-event-detail`) | Ändern nicht erlaubt · Serientermin ohne Instanzkennung · `edit_on_tap: false` · Editor nicht erreichbar |
| 3 | **Kalender-Entität** (`hass-more-info`) | Termin ohne Kennung · beide Dialoge nicht erreichbar |

**Serientermine gehen bewusst nur bis Stufe 2.** Fehlt einem wiederkehrenden
Termin die Instanzkennung, ändert der Editor **stillschweigend die ganze
Serie** — ohne Rückfrage, weil die Rückfrage genau an dieser Kennung hängt.
Der Ansichtsdialog hat einen Bearbeiten-Knopf und stellt sie korrekt. Ein
stillschweigend geänderter Serientermin ist ein Datenverlust, den niemand
bemerkt, bis es zu spät ist.

Was erlaubt ist, kommt aus `supported_features` der Kalender-Entität. **Der
Editor prüft das nicht selbst** — er kennt gar kein Feld dafür; die Karte
prüft Bit 4 (ändern) und nimmt sonst Stufe 2.

Die Karte kommt an beide Dialoge auf einem Umweg — Home Assistant gibt die
Ladefunktionen dafür nicht öffentlich heraus, und sie werden deshalb einmalig
aus HAs eigenem Kalenderelement abgegriffen. **Klappt das nicht** — weil eine
künftige HA-Fassung das Element umbenennt —, greift die nächste Stufe. Ein
Klick, der gar nichts tut, kommt dabei nicht heraus; in der Browser-Konsole
steht dann eine Zeile mit dem Grund.

Wer beim Verhalten von `0.8.1` bleiben will, setzt `edit_on_tap: false`; wer
den Klick ganz abschalten will, `open_event_on_tap: false`.

### Grenzen

- **Neue Termine legt die Karte nicht an.** Ändern und Löschen übernimmt HAs
  Dialog; einen Knopf „Termin hinzufügen" hat die Karte nicht.
- **Ein Kalender, der nicht antwortet, hält die anderen nicht auf.** Unter der
  Liste steht, welcher fehlt.
- **Termine ohne Tag im gezeigten Monat werden nicht angezeigt**, aber gezählt
  und in derselben Hinweiszeile genannt — stillschweigend verschwinden sie
  nicht. Die Zahl ist die Differenz aus geliefert und tatsächlich platziert,
  gilt also für jeden Grund, nicht nur für ein unlesbares Datum.

## Die Timeline-Karte ist umgezogen

Bis `v0.3.0` steckte in dieser Datei zusätzlich `busch-timeline-card` — der
Tages-Track einer Person auf der Landkarte, samt eingebettetem Leaflet. Sie hat
seit `v0.4.0` ein eigenes Repository:

**→ [`ha-localtrack-cards`](https://github.com/luukkii123/ha-localtrack-cards)**,
dort heißt sie `localtrack-timeline-card`.

Zwei Gründe. Erstens gehört sie zur Integration
[Local Track](https://github.com/luukkii123/ha-localtrack-integrations), nicht
zum Zeitplan-Helfer; ein gemeinsames Repo hieße eine gemeinsame Version und ein
gemeinsames Release für Karten, die nichts miteinander zu tun haben. Zweitens
musste, wer nur den Zeitplan-Editor wollte, bisher 200 kB Leaflet
mitinstallieren.

**Die Trennung hat einen Fehler behoben.** Beide Karten hatten eine Funktion
namens `formatClock`, jede mit eigener Bedeutung: die Zeitplan-Karte rechnete
Minuten seit Mitternacht in `HH:MM` um, die Timeline-Karte formatierte ein
`Date`. In einer gemeinsamen Datei liegen beide im selben Gültigkeitsbereich,
und die zweite Deklaration gewinnt — in `v0.3.0` bekam die Zeitplan-Karte also
die Timeline-Fassung und deutete ihre Minutenzahl als Zeitstempel. Jede Uhrzeit
im Balken stand als `01:00 AM` da. Seit `v0.4.0` gibt es `formatClock` in dieser
Datei genau einmal.

**Wer die alte Karte auf einem Dashboard hat**, ändert `type:` von
`custom:busch-timeline-card` auf `custom:localtrack-timeline-card` und
installiert das neue Repo. Die Optionen sind unverändert.

## Eine weitere Karte hinzufügen

Alles passiert in `dist/busch-cards.js`:

1. Klasse `extends HTMLElement` mit `setConfig(config)`, `set hass(hass)` und
   `getCardSize()`.
2. `customElements.define("busch-xyz-card", BuschXyzCard)`.
3. Eintrag in `window.customCards` anhängen, damit sie in der Kartenauswahl
   erscheint.

Der Dateiname bleibt `busch-cards.js` — er steht in `hacs.json` unter `filename`
und ist der Vertrag mit HACS. Wird er geändert, findet HACS die Karten nicht
mehr.

Gehört die neue Karte zu einer eigenen Integration, gehört sie **nicht hierher**,
sondern in ein eigenes Kartenrepo — siehe den Umzug oben. Dieses Repo ist die
Sammlung für alles, was zu keiner eigenen Integration gehört.

## Geprüft

**21.10.2026 – 0.20.0:** Kalender-Karte mit `read_only` (Vorgabe aus): Klick
öffnet nur HAs Ansichtsdialog mit `canEdit`/`canDelete` = false, nie den
Editor, auch nicht als Rückfall. Node 448 Tests, 447 bestanden, 0 Fehler,
1 bestehender Skip; `ui-regeln-pruefen.py` 0 Verstöße; `render-zeitplan.py`
und `render-kalender.py` bestanden (Kalender 666 Prüfungen, 0 Verstöße).
Natives HA nur lesend, `show-dialog` abgefangen: mit `read_only`
`dialog-calendar-event-detail` ohne Bearbeiten/Löschen, ohne die Option der
Editor; 0 PageErrors.

**21.10.2026 – 0.19.0:** Zeitplan-Karte mit `highlight_today` (Vorgabe an:
Akzentbalken, Tönung, fette Beschriftung, Uhrzeitlinie; Minutentakt, folgt der
HA-Zeitzoneneinstellung) und `read_only` (sperrt Ziehen, Plus, Block- und
Tagesdialog, Speichern). `node --check` grün; `ui-regeln-pruefen.py` 0 Verstöße;
Node 445 Tests, 444 bestanden, 0 Fehler, der bestehende Skip. Renderlauf
`render-zeitplan.py` mit fester Uhr (Mi 21.10.2026 13:45, Europe/Vienna):
Regel 1 0 Verstöße (180 geprüft), beide Dialoge Regel 2 bestanden,
Formular-Ausnahme und Theme-Haken bestanden; neue Prüfung Heute/Nur-Lesen
bestanden — genau Mittwoch markiert, Linie bei 57,29 %, nach echtem
Minutentakt Donnerstag 00:01 markiert, `highlight_today: false` ohne
Markierung, `read_only` ohne Plus/Griffe/Dialog/Schreibaufruf nach Tippen,
Ziehen, Enter und Tagesdialog. Bilder angesehen (hell 620 px, dunkel 320 px).

**14.10.2026 – 0.18.0 (#256/#257):** Zeitplan mit direkter Hinzufügen-Aktion,
stabilen Entwürfen und abgesichertem Schließtimer. Bestandsblock-Löschen fragt
mit Tag und Zeitbereich nach; neue Entwürfe können keine vorhandenen Blöcke
entfernen. Kalender-/Unraid-Fokus und Ansichtszustand bleiben bei Refreshs
erhalten. Unabhängige Schlussreview ohne verbleibende P1/P2-Befunde; native
Schedule-Abnahme zwölf Breiten-/Themefälle plus Regressionen, keine
PageErrors/Servicecalls. Kalender acht Breiten-/Themefälle ohne Textverstöße;
Unraid 41 Fälle. Node: 436 bestanden, 0 Fehler, ein bestehender Skip des
auto-entities-Referenzvergleichs. Belege und Grenzen:
lokaler Abnahmebericht.

**08.10.2026 – 0.17.0 (Unraid-Queue und R04):** Queueanzeige mit echten
Backendphasen, Positionen und Fortschritt: 216 synthetische sowie 216 native
bewachte Browserfälle bei sechs Breiten in Hell/Dunkel ohne Verstöße oder
Pagefehler. 435 Node-Tests bestanden, ein bestehender optionaler Vergleich
übersprungen. Syntaxprüfung und statische UI-Regeln ohne Fehler.
Zeitblockeditor mit Außenklick-/Dirty-Schutz, Fokusführung und idempotentem
Historyback: eigene vorherige und unabhängige bewachte native Zwölf-Fälle-
Läufe auf gleicher Produktbasis ohne Pagefehler. Der zuletzt um Reverse-Tab
und Dirty-Reduced-Motion erweiterte native Harnesslauf bestand die
Fallassertions, enthält aber drei Pagefehler unbekannter Ursache und ist
**nicht vollständig grün**. Einzelheiten und alle 26 Regelgrenzen:
lokale Queue-Abnahme und
lokale R04-Abnahme.
Keine produktiven Container-/VM-/Scheduleaktionen bei diesen Prüfungen.

**25.09.2026 – 0.15.2 (mobile Sections-Ansicht):** Die Gerätekarte addierte
Padding auf ihre Mindesthöhe; ihr zugeklappter Kopf maß dadurch 88–96 px.
Ohne diese Mindesthöhe misst er bei 320–480 px Kartenbreite 68–72 px, der
Pfeil bleibt 44 × 44 px groß. In Home Assistants Sections-Ansicht reservierte die
eingeklappte Unraid-Stack-Karte bei 360 px nur 248 px Rasterhöhe für 281 px
Inhalt; die folgende Überschrift überlappte sie um 9 px. Die dynamischen
Geräte- und Unraid-Karten geben deshalb keine feste `rows`-Zahl mehr an.
Die drei Stack-Aktionen stehen mobil in einer Reihe; bei 393 px sank die
eingeklappte Kartenhöhe von 275 auf 207 px. Der isolierte Test in der echten
HA-Ansicht zeigte bei 320/360/390/440/480 px gleiche Höhen für Karte und
Rasterzelle, 0 Überlappung, 0 horizontalen Überlauf und 0 Browserfehler;
bei 1280 px ebenfalls keine Überschneidung. 41 Unraid-Browserfälle samt
16 aufgeklappten Containern und neun Gerätefälle in Hell/Dunkel bestanden.
Lokal: 356 Node-Tests bestanden, ein bestehender Skip; Syntax und statische
UI-Regeln ohne Fehler. Keine produktiven Schaltaktionen ausgeführt.

**25.09.2026 – 0.15.1 (Snapshot-Hotfix):** Die Systemansicht blockierte
beim Start, weil der vollständige `get_states`-Snapshot rund 7.100 neue
Zustandsobjekte einzeln durch die globale Smart-Entities-Abfrage schickte.
Mehrere Änderungen werden jetzt im Index gesammelt und die Abfragen einmal
nach dem vollständigen Snapshot aktualisiert; eine einzelne Änderung bleibt
inkrementell. Der Regressionstest prüft unveränderte Vollsnapshots, echte
Zustandswechsel und den Einzelfall. Im isolierten echten HA-Browserlauf mit
der ursprünglichen Smart-Konfiguration dauerten rund 7.100 Index-Updates
58–120 ms bei 17 Abfrageberechnungen; die Karte blieb nach 2, 5 und 12
Sekunden bedienbar. Lokal: 354 Node-Tests bestanden, ein bestehender Skip;
Syntaxprüfung und statische UI-Regeln ohne Fehler. Chromium-Render für alle
sieben Kartentypen und das Smart-Editor-Mapping ohne Layoutverstoß bei
320/480/960 px in Hell und Dunkel. Mindestversion bleibt HA 2026.9.3.

**25.09.2026 – 0.15.0 (lokale Release-Abnahme):** Sieben Busch-Karten im
installierten Home Assistant 2026.9.3 mit isoliertem Testpräfix in einem
versteckten synthetischen Dashboard geöffnet. Bei jedem der sieben echten
`ha-form`-Editoren erzeugte eine Änderung sofort vollständige Config; nach
Visual → YAML → Visual, Speichern, Dashboard-Abschluss, Neuladen und erneutem
Öffnen blieben 7/7 Werte erhalten, ohne Frontendfehler. Die Testansicht wurde
gelöscht und ihre Abwesenheit in der Dashboardliste geprüft. Smart Entities:
die vollständige Featuretyp-Persistenzmatrix und 5 echte Tastatureingaben im
nativen Formular bestanden; einzelne native Dialogproben für Filter-,
Template-, Text-, Objekt-, JSON- und Picker-Suchfeld zeigten bei
A/E/C/D/Ctrl+K/Cmd+K keinen an das Dokument durchgereichten Tastendruck.
Der HA-Picker öffnete ein `WA-POPOVER`, das Escape schloss, während der
Karteneditor offen blieb. Die Shortcut-/Popover-Proben wurden getrennt
ausgeführt; ihr kombinierter Ablauf ist wegen Fokuswechseln nicht als ein
zusammenhängendes grünes Gate gewertet. Lokal: 352 Node-Tests bestanden,
1 bestehender Skip; Syntaxprüfung, statische UI-Regeln und Vertragslint ohne
Fehler. Browserprüfungen für alle sieben Karten bei 320/480/960 px in Hell
und Dunkel ohne Layoutbefund; 66/66 versionierte Baselines stimmen mit einem
frischen Chromium-Lauf überein. Die Projektregel liefert `dist/busch-cards.js`
ohne Build aus; gemeinsame UI-Bausteine sind daher im Bundle eingebettet.
Die Mindestversion im `hacs.json` entspricht der nativ geprüften HA-Version.
Eine zusätzliche rein lesende Offscreen-Probe mit echten HA-Backenddaten
montierte die sieben Karten nacheinander bei 320 px ohne Überlauf,
Frontendfehler oder Schaltaufruf; das Zeitplan-Modell wurde geladen. Beim
gleichzeitigen künstlichen Mount aller sieben Karten gab es zwei Fehler in
einem HA-Frontend-Chunk. Die sequenzielle Gegenprobe reproduzierte sie nicht;
die Ursache der Parallel-Initialisierung bleibt offen. Kartenaktionen und
sämtliche Backendzustände sind damit nicht vollständig live abgenommen.

**22.09.2026 – 0.14.0:** Eigener Filterbereich im Geräteeditor mit den
Include-/Exclude-Prädikaten von Smart Entities, einschließlich Zuständen,
verschachtelter Logik und Zeitfiltern. Filterchips erscheinen nicht mehr auf
der Karte. 433 Node-Tests samt Originalvergleich grün; Geräte-Browserregression,
12 Editorfälle und native HA-Formulare/Live-Gerät geprüft. Smart- und
Item-Mapper-Browserregressionen ebenfalls grün.

**22.09.2026 – 0.13.0:** Generische Ergebniskarten mit `item` und
`item_param`, sichere verschachtelte Objektpfade und unabhängige Kopien aller
Vorlagenoptionen. Visueller Editor in Deutsch/Englisch, explizites `device_name`
und Debug-Projektion. 425 Node-Tests inklusive Originalvergleich sowie mobile
Browsermatrizen für Mapping, Editor, Leerzustände und bestehende Smart-Ausgabe.

**22.09.2026 – 0.12.1:** Smart-Editor mit den Bereichen Filter, Zielkarte und
Weitere Optionen; mobile Regeln mit beschrifteten Eingaben und kompakter Auswahl.
Die Startvorschau verwendet die Sonnenintegration (sonst die kleinste vorhandene
Integration) und maximal sechs Treffer. Bestehende Konfigurationen bleiben erhalten.
Kalenderlisten scrollen innerhalb der Sections-Karte; Bearbeitungsvorschauen
bleiben auf 60 % der Bildschirmhöhe begrenzt.

**21.09.2026 – 0.12.0:** 413 Node-Tests einschließlich Originalvergleich gegen
auto-entities 1.16.1, Syntax/Namespace und statische UI-Prüfung grün.
Browsermatrizen: Smart 6, Unraid 24, bestehende Gerätekarte 54 Fälle bei
320/480/960 px in hell/dunkel ohne Befunde. Native HA-Editoren und Jinja-
Subscription zusätzlich im angemeldeten HA-Frontend geprüft. Serviceaktionen
in den Tests sind Attrappen, keine produktiven Containerneustarts.


**Stand 10.09.2026, `CARD_VERSION` `0.11.0`** — alle **vier** Karten gegen die
UI-Regeln der Projektverwaltung (verbindlich seit 09.09.2026). Veröffentlicht
als `v0.9.0` (UI-Regeln), `v0.9.1` (Landkarten-Fehler, siehe unten) und
`v0.10.0` (neue Gerätekarte `busch-device-card`) und `v0.10.1` (erster
Live-Befund an der Gerätekarte, siehe unten) und `v0.11.0` (Dienstaufrufe mit
Kontextvariablen, klappbare Gruppen, Label-Ausschluss).

Die Gerätekarte ist in diesem Lauf neu hinzugekommen und mit denselben vier
Belegen abgenommen worden: `node --check`, 206 Node-Tests, der statische
Regelprüfer über alle Repos und `docs/render/render-geraet.py` im
Playwright-Container. Kalender- und Zeitplan-Karte sind **nach** der Änderung
erneut gelaufen — sie teilen sich die Datei mit der neuen Karte, und genau dort
ist dieses Repo einmal an einer Namenskollision gescheitert.

**Der Live-Befund vom 09.09.2026 und was er über die Messung sagt.** Ein Anwender
meldete, dass `busch-map-card` die konfigurierten Entitäten nur bei der
Kachelvorlage „Home Assistant Standard" zeigt. Ursache: Home Assistant flacht
mit `.leaflet-pane { z-index: 0 !important }` alle Leaflet-Ebenen ein
(`src/components/map/ha-map.ts`), der von der Karte gesetzte `z-index: 250`
gilt dort also nicht — und `createPane` hängt die eigene Kachelebene ans Ende,
über die Marker. Behoben in `0.9.1`, indem die Ebene vor `overlayPane`
einsortiert wird; das stimmt mit und ohne die `z-index`-Angabe.

Die Lehre für die Prüfung: Die Marker waren in **jedem** Lauf im DOM, auch im
fehlerhaften. „Element vorhanden" hätte den Fehler nie gefunden, und
`elementFromPoint` fällt durch `pointer-events: none` hindurch. Erst die
**Malreihenfolge** der Ebenen unterscheidet. `mapcard.py` misst sie jetzt und
bringt HAs `z-index`-Regel in der Attrappe mit — ohne sie war die Attrappe
freundlicher als die Wirklichkeit.

| Beleg | Umfang | Ergebnis |
| --- | --- | --- |
| `node --check dist/busch-cards.js` | vor jedem Container-Lauf | fehlerfrei |
| `node --test tests/*.test.js` | 246 Prüfungen in 11 Dateien (seit 0.10.0 mit `geraet.test.js`, `geraet-editor.test.js`) | 246 grün, 0 rot |
| statischer UI-Regelprüfer der Projektverwaltung | Regel 3 (1–4) und Regel 4 (1) an der ausgelieferten Datei | 0 Verstöße, Exit 0 |
| `docs/render/render-zeitplan.py` (Playwright) | Zeitplan-Karte: Regel 1 bei 320/480/960 px in hell und dunkel, dazu **beide Dialoge geöffnet**; Regel 2 an beiden Dialogen | 0 Verstöße, Exit 0 |
| `docs/render/render-kalender.py` (Playwright) | Kalender-Karte, beide Ausprägungen: Regel 1 bei 320/480/960 px in hell und dunkel | 666 Textelemente geprüft, 0 Verstöße, Exit 0 |
| `docs/render/mapcard.py` (Playwright) | Landkarte: 57 Prüfungen, darunter Regel 1 an der Umhüllung und am Fehlerkasten sowie das Paar aus Anwesenheit und Malreihenfolge der Entitäten | alle bestanden, Exit 0; derselbe Lauf gegen `v0.9.0` scheitert an genau diesem Paar |
| `docs/render/render-geraet.py` (Playwright) | Gerätekarte, vier Ausprägungen (zugeklappt, aufgeklappt mit Label-Filter, Sensor-Gerät mit langen Namen, Fehlerfall): Regel 1 bei 320/480/960 px in hell und dunkel, dazu Verhalten (kein DOM-Umbau beim Zustandswechsel, Tippen/Halten, `device-page`, Gruppen klappen); Tile und Zeilen als Attrappe | 0 Verstöße, Exit 0; Kalender und Zeitplan danach unverändert grün |
| `docs/render/render-geraet.py`, Verhaltensteil (seit 0.11.0) | Kopfzeile antippen ruft den Dienst mit ersetztem Ziel und ersetzten Daten; eine Zeile antippen ruft ihn mit **ihrer** Entität; der Schalter einer Schalterzeile bleibt bedienbar und löst keinen eigenen Dienst aus; zugeklappt ist kein Bedienelement im DOM; jede Gruppe klappt | alle Sollwerte getroffen, Exit 0 |

Was die Messung im Einzelnen ergab:

- **Regel 1** — Zeitplan-Karte 140 Textelemente, Kalender 486 + 180, jeweils
  ohne Überlauf, ohne Rechteck außerhalb der Karte, ohne Überlappung. In den
  **geöffneten** Dialogen 54 bzw. 42 Elemente, ebenfalls ohne Befund. Die
  Gegenprobe (`regeln.selbsttest`) schlägt in beide Richtungen an: die
  fehlerhafte Sonde wird gemeldet, eine gewollte Kürzung nicht.
- **Regel 2** — beide Zeitplan-Dialoge bestehen alle fünf Prüfungen: Escape,
  `history.back()` ohne Seitenwechsel, Schließ-Knopf ohne verwaisten
  Verlaufseintrag, `elementFromPoint` in der Mitte, Klick auf den Scrim.
  **Das war der eigentliche Rückstand:** Bis hierher verließ die Zurück-Taste
  das Dashboard. Die Ausnahme für ein Formular mit ungespeicherten Änderungen
  ist eigens gemessen — Escape und Scrim lassen den Blockdialog dann offen und
  lösen das Wackeln aus, Abbrechen schließt ihn trotzdem.
- **Regel 3** — je Karte ein Wörterbuch `TEXTE_<TAG>` mit Deutsch und
  Englisch; jedes Schemafeld hat Label **und** Helper in beiden Sprachen, jeder
  Helper nennt die Vorgabe. Der Kartenwähler folgt `navigator.language`, Karte
  und Editor `hass.locale.language`.
- **Regel 4** — keine Hex-Farbe außerhalb eines `var()`-Rückfalls, keine
  fremde CSS-Marke, Abstände und Schriftgrößen über `--ha-space-*` und
  `--ha-font-*`.

Die Berichte liegen unter `docs/render/mapcard-ergebnis/report.json` sowie
(im Repo `hacs`) `docs/render/ergebnis-zeitplan/report.json` und
`docs/render/ergebnis-kalender/report.json`.

### Die Läufe selbst wiederholen

Die Kartentests laufen ohne Container:

```bash
node --check dist/busch-cards.js
node --test tests/*.test.js
```

**`node --test tests/` (ohne Muster) tut es nicht.** Node 22 versucht den
Ordner als Modul zu laden und bricht mit `MODULE_NOT_FOUND` ab — der Lauf
meldet dann „1 fail" statt 171 grüner Prüfungen, und `tests/laden.js` ist
ohnehin ein Helfer, keine Testdatei.

Playwright läuft auf diesem Server **nur** im Container. Der Aufruf braucht
**beide** Mounts: `/work` ist das Verzeichnis `docs/render` der übergeordneten Projektverwaltung — dort liegen die
Renderskripte der Zeitplan- und der Kalenderkarte **und** das gemeinsame
Messmodul `regeln.py` —, `/cards` ist dieses Repo:

```bash
docker run --rm \
  -v "/pfad/zu/hacs/docs/render:/work" \
  -v "/pfad/zu/busch-cards:/cards" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /work/render-zeitplan.py /cards/dist/busch-cards.js \
              /work/ergebnis-zeitplan'
```

Für die Kalenderkarte dasselbe mit `render-kalender.py` und
`/work/ergebnis-kalender`. Die Landkarte hat ihr Skript im Repo, mountet aber
ebenfalls beides — die Zeile steht im Kopf von `docs/render/mapcard.py`.
Ohne `/work` findet kein Skript `regeln.py` und der Lauf endet in einem
`ModuleNotFoundError`, bevor irgendetwas gemessen wird.

**Was diese Läufe nicht belegen:** Home Assistants echtes `ha-form` ist nicht
dabei — Editorbilder entstehen gegen eine Attrappe. Die Landkarte wird gegen
einen Nachbau von `hui-map-card` gemessen, nicht gegen die echte. Und das
native `<input type="time">` zeigt im Headless-Chromium AM/PM, unabhängig von
der Sprache; Dialogbilder mit Zeitfeldern sind dafür kein Beleg.

## Veröffentlichen

`CARD_VERSION` in `dist/busch-cards.js` hochziehen, committen, dann:

```bash
git tag v0.4.0 && git push origin v0.4.0
```

Das Release entsteht **automatisch**: `.github/workflows/release.yml` reagiert
auf den Tag, prüft `CARD_VERSION` gegen den Tag, legt das Release an und hängt
`busch-cards.js` als Asset dran. In HACS erscheint danach ein Update.

`.github/workflows/validate.yml` prüft bei jedem Push mit der HACS-Action, ob
das Repo installierbar bleibt.

## Entwicklertests

```sh
node --test tests/*.test.js
node --expose-gc tests/smart-benchmark.cjs /tmp/smart-benchmark.json
```

Für den Original-Differenztest `BUSCH_AUTO_ENTITIES_SOURCE` auf ein externes
Verzeichnis mit den unveränderten `src/{helpers,match,filter,sort,process_entity,
main}.ts` aus dem GitHub-Tag `thomasloven/lovelace-auto-entities` **v1.16.1**
setzen. Ohne diesen Quellenpfad wird nur dieser Referenzlauf als übersprungen
markiert; die lokalen Funktionsfixtures laufen weiter. TypeScript wird nur
für den isolierten Referenztest durch Nodes `stripTypeScriptTypes` gelesen;
das Produkt hat weiterhin keinen Buildschritt.

Browserharness: `docs/render/smart-entities.py` und `docs/render/unraid-cards.py`,
jeweils mit Bundlepfad und privatem Ausgabeordner. Sie testen synthetische
Daten und Schaltaufrufe über Attrappen, keine produktiven Containeraktionen.

### Gerätekarte: optionale Schnellsteuerung (lokaler UPDATED-Stand)

`quick_controls: true` aktiviert direkte Steuerung in der Kopfzeile, auch
zugeklappt. Vorgabe ist aus; bestehende Geräte-ID-, Entitäts-, Filter- und
Tile-Konfigurationen bleiben gültig. Das Hauptbedienelement folgt weiterhin
der ausgewählten Entität beziehungsweise der automatischen Geräteauswahl.
Licht/Schalter, Lüfter, Cover, Schloss, Klima, Medienplayer und Buttons bieten
nur passende HA-Funktionen an. Slider zeigen den aktuellen Wert mit Einheit;
beim Ziehen aktualisiert sich die Anzeige, erst die abgeschlossene Änderung
sendet einen Dienstaufruf. Nicht verfügbare Entitäten sind gesperrt.
Schlösser mit notwendiger Codeeingabe und Klima-Temperaturbereiche bleiben
über HAs native Details/Tile bedienbar. Ein explizit gewählter Button mit
Zustand `unknown` bleibt ausführbar. Geräte ohne Hauptentität zeigen keine
Schnellsteuerung.

Der Editor bietet `quick_controls` sowie `display_mode: auto|image|icon`,
`image` und `icon` mit deutschen und englischen Erklärungen. Media verwendet
wie die Unraid-Familie den gemeinsamen Resolver: vorhandenes geeignetes Bild,
dann eigenes Bild, eigenes beziehungsweise semantisches Icon; Bildfehler
fallen auf das Icon zurück. `image` ist eine Bildadresse, kein Image-Tag.

Geprüft am 30.09.2026 im lokalen Worktree: 48 synthetische Gerätefälle bei
320/480/960 px in beiden Themes, Tastatur-/Pointer-Abgrenzung, Touchziele,
Fokuserhalt, Mediafehler und Editor-Roundtrip; native HA 2026.9.3/2026.9.4
mit echten Form-/Tile-Komponenten und ausschließlich gemockten Diensten.
Skripte: `docs/render/device-quick-controls.py` und
`docs/render/live-ha-device-controls.py`. Keine Veröffentlichung oder
produktiven Schaltversuche in diesem Durchlauf.

### Gemeinsame UI-Quelle 0.3.0 – lokal geprüft am 30.09.2026

Das eigenständige Bundle enthält die physische Vanilla-JS-Quelle der lokalen
HACS-Verwaltung (`shared-ui/busch-ui.js`) identisch mit Versions-/SHA256-
Markern. Die gemeinsame Editorbasis, Config-/Event-/Keyboardhelper und
HA-Adapter werden im Produktpfad verwendet; Media/Status/Metrics und
HA-Spaces bleiben fachlich passend im vorhandenen Layout. Kein npm, Build,
Cross-Repo-Laufzeitimport oder zusätzlicher Karten-Core. HACS-Version
unverändert; dieser Stand wurde weder veröffentlicht noch installiert.

Native Komponenten-/Adaptermatrix auf HA 2026.9.3 und 2026.9.4: alle
Editoren gemeinsam mit den anderen drei unabhängigen Bundles geladen,
physische Texteingabe, vollständige Config, false/0/readonly/Echo/Fokus
und Keyboardguard geprüft. Je Version 15 Editoren × 6 Breiten-/Themefälle
(320/480/960, hell/dunkel), null Überlauf/Seitenfehler/Rejections.
Bestehende lokale Karten-/Editorproben ebenfalls grün; Laufartefakte privat.
Diese lesende Probe ergänzt die bisherigen Speicherrundläufe; sie ist kein
neuer vollständiger Visual/YAML-/Save-Reopen-/Portal-/IME-Gesamtnachweis.

Gemeinsame Source/API 0.3.0 ergänzt tatsächlich verwendete Header-/Action-/Sectionprimitives, scoped Card-/Editorstyles sowie DE/EN-Fieldtext und kopierende Validation mit fachlichen Normalisierungscallbacks. Bestehende Layouts und Configfelder bleiben erhalten; keine HACS-Releaseversion geändert.

### FRITZ!- und Netzwerkkarten – lokaler Stand vom 30.09.2026

`custom:busch-fritz-device-card` zeigt ein im Editor gewähltes natives
FRITZ!-Gerät. Die Auswahl allein über `device_id` reicht bei einer eindeutigen
Instanz. Router- und Repeaterfunktionen entstehen aus den tatsächlich
zugeordneten Registry-Entities, deren FRITZ!-Identifiern und dem dokumentierten
HA-Core-2026.9-Unique-ID-Vertrag. Entity-Namen werden nicht als Rollen gelesen.
Bei Mehrdeutigkeit stehen für jede Funktion manuelle Entity-Selektoren bereit;
diese werden weiterhin auf Gerät, Integration, Instanz und Domain geprüft.

WAN-Link und WAN-Erreichbarkeit werden im Statusheader getrennt angezeigt.
Ein vorhandener Link behauptet keine Internetverbindung; fehlende Rollen
werden nicht ersetzt. `show_status` steuert beide Statusanzeigen unabhängig
von `show_metrics`.

WAN-Verbindung, aktuelle/maximale Übertragungsraten, externe IPs, Volumina,
Geräte-/WAN-Laufzeit, CPU-**Temperatur**, WLAN-Switches und Firmware erscheinen
nur bei vorhandenen Daten. Sensor-Einheiten bleiben erhalten; Laufzeit-Sensoren
sind Startzeitpunkte. Es gibt keine erfundene CPU-Auslastung. Neustart,
WAN-Neuverbindung, WLAN und Firmwareinstallation verwenden native HA-Entities.
Installation benötigt die Update-Capability und ein verfügbares Update.
Fehlende oder nicht verfügbare Funktionen erzeugen keine wirkungslosen Buttons.

`custom:busch-network-card` und die FRITZ!-Clientsektion verwenden denselben
Resolver, dieselbe Query im Busch-Core und denselben Clientrenderer.
Standardquelle ist `device_tracker` mit `source_type: router`; die FRITZ!-Karte
begrenzt zusätzlich auf die eigene berichtende Instanz und Integration.
Die Query teilt Registrycaches, Ereignisverarbeitung und Zeitscheduler des
Cores. Eine einzelne Trackeränderung bewertet nur diesen Client; Änderungen
an fremden Sensoren bewerten die Clientfilter nicht erneut. Der Renderer
behält unveränderte Clientnodes und begrenzt die Anfangsliste auf 20 Einträge.

Alle Einstellungen sind im visuellen DE/EN-Editor verfügbar. Allgemein,
Datenquelle, Anzeige, Interaktion, Filter/Sortierung, manuelle Rollen und eigene
Aktionen verwenden native `ha-form`-Felder und die gemeinsame UI-Quelle 0.3.0.
Filter sind ein rekursiver strukturierter Builder; YAML ist nicht nötig.
Ungültige Zwischenwerte zeigen einen Inlinefehler und werden nicht als
unbeschränkte Query gespeichert. Unbekannte optionale Konfigwerte, `false`,
`0`, vollständige Snapshots und ausstehende HA-Echos bleiben erhalten.

Synthetisches Beispiel (alle Adressen stammen aus RFC 5737):

```yaml
type: custom:busch-network-card
title: Example network
source_type: router
filter:
  include:
    - and:
        - cidr: 192.0.2.0/24
        - or:
            - status: home
            - hostname: example-*
    - ip_range:
        from: 198.51.100.10
        to: 198.51.100.30
  exclude:
    - hostname: guest-*
sort:
  method: ip
  reverse: false
count: 20
columns: 1
show_network_device: true
show_last_changed: true
show_last_time_reachable: true
time_fallback: false
```

Include-Regeln sind ODER-verknüpft, ihre Felder UND-verknüpft. Excludes werden
danach mit ODER ausgeschlossen. Leeres Include umfasst alle Clients im
gewählten Scope. Unterstützt sind `state`, `status`, `integration`,
`config_entry`, `device`, `area`, `label`, `manufacturer`/
`device_manufacturer`, `name`, verschachtelte `attributes`, `ip`,
`ip_range: {from, to}`, `cidr`, `hostname`/`host_name`, `mac`,
`network_device`/`connected_via_device_id`, `last_changed`,
`last_time_reachable` sowie `and`, `or`, `not`. Exakte Werte, Globs und
Regex sind möglich; Zeitvergleiche beispielsweise `"> 2 h"`.
IPv4 verlangt vier Dezimaloktette von 0–255 ohne führende Nullen.
Bereiche sind inklusiv und geordnet; CIDR unterstützt `/0` bis `/32`.
Ungültige Regeln werden abgelehnt. IPv4 wird numerisch sortiert, valide IPv6
bleiben eine eigene Gruppe, ungültige/fehlende IPs zuletzt. Weitere
Sortierungen: Name, Hostname, Status, MAC, Hersteller, beide Zeitangaben und
belegter Verbindungspunkt. Gleiche Werte haben einen stabilen Entity-ID-Tie.

| Information | Bedeutung |
| --- | --- |
| Anwesenheit | Von HA gemeldetes `home`/`not_home`; kann FRITZ!-Karenz enthalten. Restore, `unknown` und `unavailable` ergeben keine behauptete Onlineverbindung. |
| Letzte Zustandsänderung | HAs `last_changed`, einschließlich möglicher Neustart-/Restoreeinflüsse. |
| Zuletzt als erreichbar erkannt | HAs `last_time_reachable`, zuletzt im Polling als aktiver Host beobachtet. |
| Zeitfallback | Optional ausschließlich in der Anzeige; deutlich als Zustandsänderung beschriftet. Filter und Sortierung der Erreichbar-Zeit bleiben am echten Erreichbar-Wert. |
| Verbindungspunkt | Nur eine tatsächlich gelieferte, im Device-Register vorhandene `connected_via_device_id`. Namen, berichtende Instanz und `via_device_id` beweisen keinen AP. |

Zukünftige oder nicht parsebare Zeitpunkte erscheinen unbekannt. Ein
Zeitfilter auf einem zukünftigen Zeitstempel wird frühestens ab dessen
Zeitpunkt ausgewertet, über den gemeinsamen Coretimer. Kein Timer pro Client. FRITZ!-Laufzeiten aus konstanten Startzeitstempeln
werden minutengenau über denselben gemeinsamen Coretimer weitergeführt;
die letzte entfernte Zeitkarte gibt ihren Timer frei.
Ohne belegte AP-ID bleibt der Verbindungspunkt unbekannt. Die vorhandene
Legacy-Discovery kann diese Angaben weglassen; die Karte ändert keine
FRITZ!-Option und enthält keine Routerzugangsdaten. Es wurde kein Companion
hinzugefügt, da bislang kein tatsächlicher Mesh-Identifier-Abgleich dessen
Notwendigkeit belegt.

Internetzugang und Wake-on-LAN werden über native HA-Switches/Buttons mit
identischer MAC, Client-Device und Config Entry aufgelöst. Anwesenheit ist
kein Internetzugangswert. `show_internet`, `show_wol`, `show_controls` und
Bestätigungen sind einstellbar. Anzeigename/Labels sind separate
Administratoraktionen über die Entity Registry: keine Entity-ID-Umbenennung
und keine festen persönlichen Labels. `label_ids` begrenzt angebotene Labels;
bereits zugewiesene Entitylabels können erhalten bleiben. Diese Aktionen
wurden ausschließlich mit Mocks geprüft.

Eigene Aktionen unterstützen HAs `tap_action`, `hold_action`,
`double_tap_action`, `confirmation`, Serviceziele und Daten. Ein leeres
Serviceziel wird mit dem aktuellen Client gefüllt; unbekannte Ziel-IDs und
leere Ziellisten werden abgelehnt. `{{ entity }}`, `{{ device }}`, `{{ area }}`
sind die vorhandenen begrenzten Platzhalter, kein ausführbarer Code.
Zusätzliche beschriftete Aktionen stehen in `actions` mit `name`, optional
`icon`, `variant` (`primary`, `secondary`, `danger`, `quiet`, `icon-only`,
`overflow`) und den drei HA-Aktionsfeldern. Enter/Space und Touch verwenden
dieselben Guards. Interaktive Aktionen klappen die Clientsektion nicht um.
Registryformulare erscheinen in nativen aufklappbaren Abschnitten im Client;
es wird kein eigener Popup-/Historydialog eingeführt.

Geprüft: vollständige Node-Suite einschließlich unveränderter offizieller
auto-entities-1.16.1-Vergleiche ohne Skips, synthetische Karten-/Editorgalerie
bei 320/480/960 hell/dunkel, native HA-Formen 2026.9.3 und 2026.9.4 mit
physischer Texteingabe, vollständigem Echo, Falsy-/Readonly-/Fokus-/Keyboard-
Vertrag. Native Dropdowns und Filterfelder werden gesondert geprüft;
synthetische Formattrappen belegen nur Layout/Verdrahtung. Einzelne native
Zwischenläufe enthielten `unknown_command`-Ablehnungen. Ein späterer Lauf
belegte den fehlenden `recorder/info`-Provider der minimalen Testinstanz;
Recorder registriert diesen Handler bei echtem Integrationsstart. Die
Ursache früherer Erstläufe wurde damit nicht rückwirkend bewiesen. Alle
Fehler bleiben in den privaten Prüfberichten erhalten; eine fehlerfreie
native Gesamtabnahme wird nicht behauptet. Echte FRITZ!-Registry-Picker,
Speichern/Visual-YAML-Reopen, Portal-/IME-Gesamtabnahme und Performancematrix
sind Teil der folgenden Gesamtprüfung. Keine Veröffentlichung, Installation,
Optionsänderung, produktive Dashboardänderung oder Geräteaktion erfolgt.

### Geprüft: lokaler UPDATED-Kandidat, 30.09.2026

Gemeinsame UI-Quelle/API **0.3.2**, bytegleich in vier eigenständigen Bundles.
Die native Familienabnahme umfasst 17 Editoren auf Home Assistant 2026.9.4
mit Frontend 20260826.7: physische Texteingabe, Visual/YAML/Visual,
nativer Save mit Serverantwort und Config-Readback, Reload und Reopen.
Readonly-Konfiguration, vollständige Snapshots und Erhalt von false/0 sind
separat geprüft; ein echter Netzwerk-Switch und Anzahl 0 wurden über native
Controls gespeichert. Verzögerte Echo-Proben: alle 17 Editoren grün.

Finale lokale Suiten: Busch 508/508 mit offiziellem auto-entities 1.16.1 ohne
Skips, Arrstack 1 vollständige Dateisuite, Shared UI 21/21. Vier Bundle-
Syntax-/Source-/Vertragsprüfungen und statische UI-Regeln ohne Verstöße.
Galerien: Unraid 126, Device 48, Network/FRITZ 144, Light 66 und Localtrack 14;
Arrstack prüft zusätzlich die bestehenden Screenshotbaselines. Die gemeinsame
Actionpaint-Probe umfasst beide Themen und alle Varianten inklusive danger-
Alias für destructive. Native Font-/Theme-Tokenprobe bei 320/480/960 ohne
horizontalen Overflow; Licht-/Dunkelwerte nur browserlokal gesetzt.

Die Kandidatenbytes wurden ausschließlich im Testbrowser geladen. Dies ist
kein Installationsnachweis; keine produktive Geräteaktion ausgeführt. Echte
Pickerwerte stimmen mit den HA-Registern überein. Beim Öffnen tritt jedoch
auch ohne Kandidaten im vorhandenen HA ein `lit-virtualizer`-Registrierungs-
konflikt auf; vollständige fehlerfreie Portal-/IME-Abnahme wird deshalb nicht
behauptet. Neue Backendrollen müssen nach regulärem Backendupdate geprüft werden.

Prüfbundle SHA256: `9d933d7064e7ecf57f03d50a8eaa8c4efe49de363c0124a312dce682339e5fa8`.

### Geprüft: Release 0.16.0, 30.09.2026

Diese Fassung enthält den oben geprüften UPDATED-Kandidaten mit gemeinsamer
UI-Quelle 0.3.2. Gegenüber den geprüften Bundlebytes wurde ausschließlich
`CARD_VERSION` erhöht. Die native Familienabnahme umfasst 17 Editoren mit
Speichern und Wiederöffnen; lokale Suiten und Darstellungsmatrizen sind oben
dokumentiert. Der vorhandene native Pickerkonflikt bleibt eine benannte Grenze.
Keine produktiven Geräteaktionen wurden für die Abnahme ausgeführt.

### Geprüft: Release 0.16.1, 01.10.2026

Die Editoren für Stack, Container und VM verwenden nur noch `device_id`.
Alte `config_entry_id`-Werte werden beim Speichern entfernt; die Karten
bestimmen den Integrationseintrag intern eindeutig aus dem gewählten Gerät.
Die Zuordnung wurde lesend gegen die vollständigen Live-Registrierungen
geprüft: 16 Stackgeräte, 16 Containergeräte und eine VM, jeweils genau ein
Integrationseintrag und vorhandene Steuer-Entities. Mit und ohne alten
Instanzwert ist das Ergebnis gleich. Im nativen Home-Assistant-Editor
(2026.9.3) bestanden alle drei Formulare samt Speichern und den Breiten
320/480/960 px ohne Überlauf oder Browserfehler.

Die Node-Suite bestand mit 422 Tests, einem bestehenden Skip und null
Fehlern. Syntaxprüfung und statische UI-Regeln für alle acht Repositories
waren grün. Chromium prüfte 41 ältere Unraid-Fälle und 126 Fälle der
aktuellen Stack-/Container-/VM-Familie bei 320/480/960 px in Hell/Dunkel
ohne Fehler; die weiteren Kartenrenderings bestanden ebenfalls. Zwei
synthetische Prüffälle wurden korrigiert: der mobile Stackabstand misst
jetzt die Metriken mit, und die Landkarten-Fehlerprobe berücksichtigt den
zwischengespeicherten Kartenhelfer. Es gab keine produktiven Schaltaktionen.

### Geprüft: Release 0.16.2, 01.10.2026

Die VM-Karte unterscheidet jetzt **Herunterfahren** (Gastanforderung) und
**Sofort ausschalten** (eigener Backendbutton ab Unraid SSH 0.6.1). Die harte
Aktion verlangt immer eine Bestätigung mit Datenverlustwarnung; sie ist auch
bei einem hängenden Herunterfahren verfügbar, bei ausgeschalteter VM nicht.
Es gibt keinen automatischen Wechsel vom schonenden zum harten Befehl.

428 Node-Tests bestanden, ein bestehender Skip. Syntax und statische
UI-Regeln für alle acht Repositories waren grün. Chromium prüfte 41 ältere
Unraid-Fälle und 180 Fälle der aktuellen Familie einschließlich `in_shutdown`
und laufender Updates mit und ohne echte Prozentangabe
bei 320/480/960 px in Hell/Dunkel ohne Überlauf oder Browserfehler. Die
weiteren Kartenrenderings bestanden. Drei Editoren wurden in Home Assistant
2026.9.3 nativ geprüft, einschließlich Speichern und 320/480/960 px ohne
Überlauf. Alle Aktionsprüfungen verwendeten synthetische Serviceaufrufe;
eine produktive VM wurde nicht geschaltet.

### Geprüft: Release 0.16.3, 02.10.2026

Die Landkarte schickt den OpenStreetMap-Kachelservern wieder einen Referer
(nur den Ursprung); ohne ihn lieferte `tile.openstreetmap.org` zeitweise das
Sperrbild „403 Access blocked". Ursache am 02.10.2026 nachgemessen: Home
Assistant sendet `Referrer-Policy: no-referrer`; dieselbe Kachel kam ohne
Referer als 6987-B-Sperrbild, mit Referer als 40083-B-Karte.

`docs/render/mapcard.py` stellt HAs Referrer-Regel jetzt nach und fängt die
echten Kachelanfragen in Chromium ab, als Paar: HAs eigene Ebene ohne Referer
(Gegenprobe), Vorlage `osm` über HAs Rasterebene und über die eigene Ebene mit
Ursprung. Gegen `0.16.2` rot (beide OSM-Fälle ohne Referer), gegen `0.16.3`
in zwei Läufen 60/60 grün, Regel 1 ohne Verstoß. 428 Node-Tests bestanden,
ein bestehender Skip; `node --check` und statische UI-Regeln grün.

### Unraid-Updatefortschritt (ab 0.17.0)

Stack- und Containerkarte lesen die echte `unraid_ssh`-Warteschlange (Backend
0.7.0): wartende Ziele behalten „In Warteschlange · Position …“, laufende
Ziele zeigen Vorbereitung, Image-Pull, Neuerstellung und Prüfung. Echte
`progress_percent`-Werte erhalten Prozenttext und Fortschrittsbalken; fehlende
Werte bleiben ohne Schätzung. Fertig/Fehler und konkrete nächste Aktion bleiben
sichtbar, Details lassen sich während eines Updates weiterhin öffnen.

Der Stack zeigt Backendzähler, aktuelles Ziel und Gesamtfortschritt. Dieser
zählt **abgearbeitete** Ziele, einschließlich getrennt ausgewiesener Fehler.
„Alle aktualisieren“ verwendet den nativen atomaren Stack-Button und bleibt
während des Batches gesperrt. State-Änderungen aktualisieren die Karte ohne
Neuladen. Ältere Backendversionen behalten ihre bisherige `in_progress`-Anzeige;
die Karte erfindet weder Queue noch Fortschritt. Offline gemeldete Entitäten
mit einem bekannten aktiven Backendauftrag verlieren ihren Wartezustand nicht.
