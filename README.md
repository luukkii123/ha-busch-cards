# Busch Cards

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/)
[![Release](https://img.shields.io/github/v/release/luukkii123/ha-busch-cards)](https://github.com/luukkii123/ha-busch-cards/releases)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)

**Ein Zeitplan-Editor als Lovelace-Karte: Zeitplan-Helfer (`schedule.*`) direkt
im Dashboard bearbeiten.**

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
