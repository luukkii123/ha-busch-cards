# Busch Cards

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/)
[![Release](https://img.shields.io/github/v/release/luukkii123/ha-busch-cards)](https://github.com/luukkii123/ha-busch-cards/releases)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)

**Drei Lovelace-Karten ohne eigene Integration: ein Zeitplan-Editor für
`schedule.*`-Helfer, die eingebaute Landkarte mit frei wählbaren Kacheln, und
eine Terminliste je Kalendermonat.**

| Karte | Wofür |
| --- | --- |
| `busch-schedule-card` | Zeitplan-Helfer direkt im Dashboard bearbeiten |
| `busch-map-card` | die eingebaute `map`-Karte, nur mit anderen Kacheln |
| `busch-calendar-card` | Termine eines Monats als Tagesliste |

![Die Zeitplan-Karte im hellen Theme](docs/preview.png)

**Kein Build-Schritt** — `dist/busch-cards.js` ist Quelltext *und* Auslieferung:
reines Vanilla-JS mit Custom Elements, keine Abhängigkeit, nichts wird
nachgeladen.

## Installation über HACS

1. HACS → ⋮ → **Custom repositories**
2. Repository: `https://github.com/luukkii123/ha-busch-cards`,
   Kategorie: **Dashboard**
3. **Busch Cards** herunterladen, Seite neu laden (Strg+F5)

Manuell: `dist/busch-cards.js` nach `<config>/www/busch-cards.js` kopieren und
unter Einstellungen → Dashboards → ⋮ → **Ressourcen** eintragen:
`/local/busch-cards.js`, Typ **JavaScript-Modul**.

Danach taucht die Karte in der Kartenauswahl auf — als **Busch Zeitplan**, mit
Vorschau und grafischem Editor.

Voraussetzung: Home Assistant **2024.11.0** oder neuer.

---

# `busch-schedule-card`

Zeitplan-Helfer (`schedule.*`) direkt im Dashboard bearbeiten. Home Assistant
bringt für Zeitpläne einen Editor mit, aber nur im Helfer-Dialog unter
Einstellungen — auf einer Dashboard-Karte gab es das bisher nicht.

```yaml
type: custom:busch-schedule-card
entity: schedule.pool_zeitplan
title: Poolpumpe        # optional, sonst der Name der Entität
first_day: auto         # auto | monday | sunday
step: 15                # Raster beim Ziehen, in Minuten
```

## Optionen

| Option | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `entity` | ja | — | eine `schedule.*`-Entität; alles andere wird abgelehnt |
| `title` | nein | Name der Entität | Überschrift der Karte |
| `first_day` | nein | `auto` | Wochenanfang; `auto` folgt der Einstellung in Home Assistant |
| `step` | nein | `15` | Raster beim Ziehen in Minuten, 1–60 (der Editor bietet 5–60 in Fünferschritten) |
| `icon` | nein | `mdi:calendar-clock` | nur der Rückfallwert — hat die Entität ein eigenes Icon, gewinnt das |

Wochentagsnamen und Uhrzeiten folgen der Sprache von Home Assistant. Die Karte
zeigt immer 24 Stunden, unabhängig von der 12/24-Stunden-Einstellung.

## Bedienung

| Geste | Wirkung |
| --- | --- |
| Auf freie Fläche ziehen | neuen Block in der gezogenen Länge anlegen |
| Auf freie Fläche tippen | Block über eine Stunde anlegen (oder so viel Platz ist) |
| Block ziehen | verschieben |
| Blockrand ziehen | Anfang oder Ende verschieben |
| Block antippen | Dialog mit Von/Bis und **Löschen** |
| Wochentag antippen | Tag leeren, oder seine Blöcke auf alle Tage / Mo–Fr / Sa+So kopieren |

Mit der Tastatur: Blöcke sind anspringbar, **Enter** oder **Leertaste** öffnet
den Dialog.

Gespeichert wird sofort nach jeder Änderung. Schlägt das fehl, springt die Karte
auf den letzten bestätigten Stand zurück und zeigt die Meldung von Home
Assistant an — ein halb gespeicherter Zeitplan entsteht nicht.

## Mobil und am Bildschirm

<img src="docs/preview-mobile.png" width="330" alt="Dieselbe Karte schmal, im dunklen Theme">

Der Umbruch hängt an der **Kartenbreite**, nicht an der Fenstergröße
(Container-Query) — eine schmale Spalte am großen Bildschirm bekommt also
dasselbe wie ein Handy: höhere Spuren zum Treffen mit dem Finger, ein Lineal nur
alle sechs Stunden, und Beschriftungen genau dann, wenn sie hineinpassen.

Waagrechtes Ziehen gehört der Karte, senkrechtes Wischen scrollt weiterhin die
Seite (`touch-action: pan-y`). Die Zeitfelder im Dialog sind native
`<input type="time">`, am Handy erscheint also der Systempicker.

> Das native Zeitfeld formatiert nach der **Sprache des Browsers**, nicht nach
> der Einstellung von Home Assistant. Bei deutschem Browser sind das 24 Stunden.

## Was die Karte über die Regeln von Home Assistant weiß

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

## Aussehen anpassen

Die Karte nutzt ausschließlich HA-eigene CSS-Variablen, folgt also dem gewählten
Theme in hell und dunkel. Drei eigene Variablen kennt sie zusätzlich:

| Variable | Vorgabe | Wirkung |
| --- | --- | --- |
| `--busch-schedule-color` | `--primary-color` | Farbe der Blöcke |
| `--busch-schedule-track-color` | `--divider-color` | Hintergrund der Tagesspur |
| `--label-col` | `40px` | Breite der Wochentagsspalte |

Die beiden Farben lassen sich wie bisher im **Theme** setzen:

```yaml
busch-schedule-color: "#e65100"        # Farbe der Blöcke
busch-schedule-track-color: "#37474f"  # Hintergrund der Tagesspur
```

`--label-col` ist ein reines Innenmaß und steht auf `:host`; die beiden Farben
stehen dort **bewusst nicht**. Ein Theme setzt sie am Wurzelelement, von wo sie
die Karte durch Vererbung erreichen — und eine Vererbung verliert gegen jede
Regel, die das Element selbst trifft. Eine `:host`-Zeile für dieselbe Marke
würde den Haken also still totlegen. Genau das war am 09.09.2026 kurzzeitig der
Fall und ist in Chromium nachgemessen worden.

Stattdessen steht die Vorgabe an der Verwendungsstelle als Rückfall —
`var(--busch-schedule-color, var(--primary-color))` — und der Rückfall ist eine
HA-Variable, keine Hex-Farbe. Damit ist auch Regel 4 der
[UI-Regeln](../docs/ui-regeln.md) erfüllt: `scripts/ui-regeln-pruefen.py` führt
beide Marken in seiner Liste `THEME_HAKEN` und besteht nur, solange der
Rückfall von Home Assistant kommt.

Der Nachweis, dass eine Theme-Angabe wirklich durchschlägt, läuft im
Playwright-Container mit: `render-zeitplan.py` misst die Blockfarbe erst ohne
Theme und dann mit `--busch-schedule-color: rgb(1, 2, 3)` am `<html>`.

## Grenzen

- Ein in YAML festgelegter Zeitplan (`editable: false`) wird nur **angezeigt**;
  die Speicher-API greift dort nicht. Die Karte schaltet dann in den Lesemodus.
- Zum Auflösen der `schedule_id` liest die Karte die Entitätsregistrierung. Ohne
  Adminrechte fällt sie auf den Namen hinter dem Punkt zurück — nach einer
  Umbenennung der Entität kann das danebengehen.
- Der Block-Dialog kennt nur Von und Bis. Das freie Feld `data` je Block wird
  unverändert durchgereicht, aber nicht angezeigt und nicht bearbeitet.

---

## Die Landkarten-Karte

`busch-map-card` ist die **eingebaute Map-Karte mit anderen Kacheln** — sonst
nichts. Aus einer bestehenden Karte wird sie, indem man **nur `type:` tauscht**:

```diff
- type: map
+ type: custom:busch-map-card
  entities: [person.beispiel]
  theme_mode: auto
  hours_to_show: 2
```

### Warum sie nichts nachbaut

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

### Kartenvorlagen

| `map_style` | Karte | hell/dunkel |
| --- | --- | --- |
| `ha` | Home-Assistant-Standard, Kacheln unangetastet | — |
| `osm` | OpenStreetMap | nur hell |
| `carto` *(Standard)* | CARTO Positron / Dark Matter | beides |
| `voyager` | CARTO Voyager | beides |
| `satellite` | Esri World Imagery | nur hell |
| `topo` | OpenTopoMap | nur hell |
| `custom` | eigene URL | beides |

```yaml
type: custom:busch-map-card
entities: [person.beispiel]
map_style: carto             # Vorlage, Standard: carto
tile_api_key: ""             # überschreibt den Helfer, meist leer lassen
tile_api_key_entity: ""      # Standard: input_text.carto_api_key
tile_url: ""                 # nur bei map_style: custom
tile_url_dark: ""            # optional; fehlt sie, gilt die helle auch dunkel
tile_attribution: ""         # Pflicht bei eigener URL
```

### CARTO braucht einen Schlüssel — einmal, nicht je Karte

**Ohne Schlüssel steht „API KEY REQUIRED" quer in den Kacheln.** Und zwar
still: CARTO antwortet mit `HTTP 200` und einer gültigen PNG-Datei, der
Schriftzug ist ins *Bild* eingebrannt. Wer nur den Statuscode prüft, hält
alles für in Ordnung.

Am 06.09.2026 auf Byte-Ebene nachgemessen, derselbe Kachelpfad:

| Anfrage | Antwort |
| --- | --- |
| ohne Schlüssel | 20 411 B |
| `?api_key=…` | 20 411 B — **identisch**, der Parameter wird ignoriert |
| `?key=…` | **22 692 B** — wirkt |

**Der Parameter heißt `key`.** Einen kostenlosen Schlüssel gibt es unter
[carto.com/basemaps/apikey](https://carto.com/basemaps/apikey).

**Er wird einmal im System hinterlegt, nicht in jeder Karte.** Lege einen
Helfer an — *Einstellungen → Geräte & Dienste → Helfer → Text*, Name
**CARTO API Key** (das ergibt `input_text.carto_api_key`), Modus
**Passwort**. Von dort lesen ihn **alle** Karten, auf allen Dashboards und
allen Geräten. Nur wer mehrere Anbieter mischt, zeigt je Karte mit
`tile_api_key_entity` auf einen anderen Helfer oder trägt mit
`tile_api_key` direkt einen ein — der Karteneintrag schlägt den Helfer.

Ändert sich der Helfer, zieht die Karte **ohne Neuladen** nach.

**Warum nicht im Kartenquelltext?** Dieses Repo ist öffentlich. Ein Schlüssel
darin stünde dauerhaft auf GitHub und in jedem Release-Asset.

**Er ist trotzdem nicht geheim.** Kachelschlüssel reisen in jeder einzelnen
Kachelanfrage mit und sind für jeden sichtbar, der das Dashboard öffnen kann —
das lässt sich bei Karten im Browser nicht vermeiden. Deshalb schränkt man sie
beim Anbieter auf die eigene Domain ein. `osm`, `satellite` und `topo`
brauchen keinen Schlüssel; sie bekommen auch keinen angehängt.

Alles über *Karte hinzufügen* einrichtbar: oben die Kachelfelder, darunter
Home Assistants **eigener** Map-Editor.

**Hell und dunkel folgen `theme_mode`** (`auto`/`light`/`dark`) wie bei der
eingebauten Karte. Sobald echte dunkle Kacheln im Spiel sind, **schaltet die
Karte HAs Dunkelfilter ab** — die eingebaute Karte invertiert sonst die
Kacheln (`invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2)
saturate(0.3)`), und beides zusammen ergibt Matsch. Bei `map_style: ha` bleibt
der Filter, wo er ist.

**Die Quellenangabe ist keine Kosmetik.** OpenStreetMap, CARTO, Esri und
OpenTopoMap verlangen sie in ihren Nutzungsbedingungen; für die mitgelieferten
Vorlagen setzt die Karte sie selbst. **Wer eine eigene URL einträgt, trägt auch
die eigene Angabe ein** — und prüft die Nutzungsbedingungen des Anbieters. Der
Kachelserver von OpenStreetMap ist für den Hausgebrauch gedacht, nicht für
Dauerlast.

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

---

## Die Kalender-Karte

`busch-calendar-card` zeigt die Termine eines **Kalendermonats als Tagesliste** —
eine Zeile je Tag, chronologisch, kein Wochenraster. Gedacht für Dienst- und
Arbeitszeiten, wo die Frage „wann und wie lange" lautet und nicht „wo im
Raster".

```yaml
type: custom:busch-calendar-card
title: Arbeitszeit
entities:
  - calendar.arbeitszeiten
month_offset: -1
show_total: true
```

### Optionen

**Alle Optionen sind im grafischen Karteneditor einstellbar.** Keine existiert
nur in YAML.

| Option | Typ | Standard | Wirkung |
| --- | --- | --- | --- |
| `entities` | Liste | leer | Kalender-Entitäten. Ein Eintrag ist entweder `calendar.x` oder `{entity, color}` |
| `month_offset` | Ganzzahl | `0` | Startmonat. `-1` ist der Vormonat, `1` der Folgemonat |
| `navigation` | ja/nein | `true` | Pfeile zum Blättern anzeigen |
| `show_empty_days` | ja/nein | `true` | Tage ohne Termin als leere Zeile zeigen |
| `show_total` | ja/nein | `false` | Fußzeile mit Summe der Termindauern |
| `title` | Text | leer | Überschrift über dem Monatsnamen |
| `open_event_on_tap` | ja/nein | `true` | Klick auf eine Zeile öffnet den Termin |
| `edit_on_tap` | ja/nein | `true` | Klick öffnet den Termin **zum Bearbeiten** — mit den Eingabefeldern statt der Ansicht |

`month_offset` ist bewusst eine Zahl und kein Auswahlfeld — so ist auch minus
drei möglich. Das Blättern über die Pfeile ändert die Konfiguration **nicht**:
sonst veränderte ein Blick in den Vormonat das Dashboard für alle.

### Farben

Jeder Kalender bekommt automatisch eine Farbe aus einer festen Palette, in der
Reihenfolge der Auswahl. Wer eine ändern will, findet **ab dem zweiten
Kalender** unter dem Formular je Kalender einen Farbwähler; in YAML ist es
`{entity, color}`. Bei einem einzigen Kalender wird kein Farbpunkt gezeichnet —
ein Punkt, der immer dieselbe Farbe hat, trägt keine Information.

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

**Stand 09.09.2026, `CARD_VERSION` `0.8.3`** — alle drei Karten gegen die
[UI-Regeln](../docs/ui-regeln.md) (verbindlich seit 09.09.2026). **Nicht
getaggt:** Diese Runde ändert die Version bewusst nicht, HACS liest den Tag.

| Beleg | Umfang | Ergebnis |
| --- | --- | --- |
| `node --check dist/busch-cards.js` | vor jedem Container-Lauf | fehlerfrei |
| `node --test tests/*.test.js` | 171 Prüfungen in 9 Dateien | 171 grün, 0 rot |
| `python3 ../scripts/ui-regeln-pruefen.py --repo busch-cards` | Regel 3 (1–4) und Regel 4 (1) an der ausgelieferten Datei | 0 Verstöße, Exit 0 |
| `docs/render/render-zeitplan.py` (Playwright) | Zeitplan-Karte: Regel 1 bei 320/480/960 px in hell und dunkel, dazu **beide Dialoge geöffnet**; Regel 2 an beiden Dialogen | 0 Verstöße, Exit 0 |
| `docs/render/render-kalender.py` (Playwright) | Kalender-Karte, beide Ausprägungen: Regel 1 bei 320/480/960 px in hell und dunkel | 666 Textelemente geprüft, 0 Verstöße, Exit 0 |
| `docs/render/mapcard.py` (Playwright) | Landkarte: 53 Prüfungen, darunter Regel 1 an der Umhüllung und am Fehlerkasten | alle bestanden, Exit 0 |

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
**beide** Mounts: `/work` ist `hacs/docs/render` — dort liegen die
Renderskripte der Zeitplan- und der Kalenderkarte **und** das gemeinsame
Messmodul `regeln.py` —, `/cards` ist dieses Repo:

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/docs/render:/work" \
  -v "/mnt/user/Data/Claude Projekte/hacs/busch-cards:/cards" \
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

## Lizenz

MIT — siehe [LICENSE](LICENSE).
