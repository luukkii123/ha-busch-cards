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
Theme in hell und dunkel. Zwei eigene Variablen lassen sich im Theme
überschreiben:

```yaml
busch-schedule-color: "#e65100"        # Farbe der Blöcke
busch-schedule-track-color: "#37474f"  # Hintergrund der Tagesspur
```

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

- **Nutzt Home Assistant Vektorkacheln, ersetzt die Karte nichts.** Sie tauscht
  nur Rasterebenen; findet sie keine, bleibt die Grundkarte, wie sie ist, und
  eine Zeile in der Konsole sagt es. Vektorkacheln bringen ohnehin eigene
  dunkle Kartografie mit. Ein eigenes Leaflet nur für diesen Fall
  mitzuliefern wäre 200 kB für einen seltenen Sonderfall.
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
| `open_event_on_tap` | ja/nein | `true` | Klick auf eine Zeile öffnet den Kalender-Dialog |

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
getrennt gezählt („20 Tage · 168,5 h · 1 ganztägig"). Sie mit 24 Stunden zu
verrechnen würde die Summe verfälschen.

Die Summe zählt **nur den gezeigten Monat**: Ein Urlaub vom 25.07. bis 05.08.
steht im August mit seinen fünf August-Tagen im Fuß, nicht mit zwölf. Und ein
wiederkehrender Termin zählt so oft, wie er in der Liste steht — Home Assistant
gibt allen Instanzen einer Serie dieselbe Kennung, entdoppelt wird deshalb
nicht. Fuß und Liste sollen dasselbe sagen.

### Grenzen

- **Nur lesen.** Termine anlegen oder ändern kann die Karte nicht; ein Klick
  öffnet den Dialog von Home Assistant.
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
