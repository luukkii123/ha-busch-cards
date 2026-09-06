# busch-calendar-card — Monatsliste mit Monatsversatz

**Stand:** 06.09.2026
**Repo:** `ha-busch-cards` (Ordner `hacs/busch-cards/`), HACS-Kategorie Dashboard
**Datei:** `dist/busch-cards.js` — zweite Karte neben `busch-schedule-card`

## 1. Das Problem

In der Ansicht `lukas-arbeitszeit` steht heute eine `custom:calendar-card-pro` mit

```yaml
start_date: "-31"
days_to_show: 30
```

Das ist ein **gleitendes Fenster ab heute**, kein Kalendermonat. Am 6. Oktober
zeigt sie den 5. September bis 5. Oktober: der September ist vorn abgeschnitten,
hinten hängen fünf Oktobertage dran.

Gewünscht ist eine Liste, die auf **Kalendergrenzen** rechnet. Versatz minus eins
bedeutet: erster bis letzter Tag des Vormonats, vollständig, unabhängig davon,
der wievielte heute ist.

## 2. Datenquelle

Die Karte holt Termine über die REST-Route des Frontends:

```js
hass.callApi("GET", `calendars/${entityId}?start=${startIso}&end=${endIso}`)
```

**Belegte Antwortform** (echte Daten aus `calendar.arbeitszeiten`, August 2026):

```json
[{"start": {"dateTime": "2026-08-03T08:49:13+02:00"},
  "end":   {"dateTime": "2026-08-03T16:15:08+02:00"},
  "summary": "DZ", "description": "", "location": null,
  "uid": "4ab16f20-8f7e-11f1-8f38-e45f0129325d",
  "recurrence_id": null, "rrule": null}]
```

- `start`/`end` sind **verschachtelte Objekte**, nicht flache Zeichenketten.
- Ein **zeitgebundener** Termin hat `dateTime` mit Zonenversatz.
- Ein **ganztägiger** Termin hat stattdessen `date` (`YYYY-MM-DD`), und das
  Enddatum ist **exklusiv**. Ein eintägiger Ganztagstermin am 4. Juli hat
  `end.date = "2026-07-05"`.
- `description` kann leer sein, `location` `null`.

Je gewählter Kalender ein Aufruf, alle parallel über `Promise.allSettled`.
`allSettled` und nicht `all`: ein kaputter Kalender darf die anderen nicht
mitreißen (siehe Abschnitt 7).

## 3. Monatsrechnung

```js
const heute = new Date();
const start = new Date(heute.getFullYear(), heute.getMonth() + versatz, 1, 0, 0, 0, 0);
const ende  = new Date(heute.getFullYear(), heute.getMonth() + versatz + 1, 0, 23, 59, 59, 999);
```

`new Date(jahr, monat, 0)` liefert den letzten Tag des Vormonats, das erledigt
Schaltjahre und Monatslängen ohne eigene Tabelle. Der Monatswechsel über die
Jahresgrenze funktioniert, weil `getMonth() + versatz` auch negativ sein darf:
Januar plus minus eins ergibt den Dezember des Vorjahres.

Gerechnet wird in **lokaler Zeit**, nicht in UTC. Ein Termin am 1. September um
00:30 Uhr Ortszeit gehört in den September, auch wenn er in UTC noch im August
liegt.

**Der Blätterzustand steht nicht in der Konfiguration.** Ein interner Zähler
`_versatzLaufend` startet bei `month_offset` und ändert sich beim Klick auf die
Pfeile. Ein Klick speichert also nichts im Dashboard, verursacht keinen
Speichervorgang und stört keine zweite Person, die dieselbe Ansicht offen hat.
Beim Neuladen der Seite steht die Karte wieder auf dem konfigurierten Versatz.

## 4. Namensraum — die eiserne Regel dieser Datei

`dist/busch-cards.js` hat einen **flachen Namensraum**. Belegt sind dort
auf oberster Ebene bereits:

```
CARD_VERSION, SCHEDULE_DAYS, MINUTES_PER_DAY, SCHEDULE_CARD_SCHEMA,
SCHEDULE_LABELS, parseScheduleTime, formatScheduleTime, formatClock,
toInputTime, clamp, freeRange, gapAt
```

Genau hier ist dieses Repo schon einmal gescheitert: `formatClock` war zweimal
als Top-Level-`function` deklariert, die zweite gewann, und die Zeitplan-Karte
zeigte falsche Uhrzeiten. Kein Test hat das gefunden.

**Regel:** Jeder neue Name auf oberster Ebene beginnt mit `cal`.
Also `calFormatUhrzeit`, `calMonatsGrenzen`, `calPalette`, `CAL_CARD_SCHEMA`,
`CAL_LABELS`. `CARD_VERSION` wird geteilt und nur hochgezählt, nicht neu
deklariert.

**Nachweis, dass die Regel eingehalten ist:** nach der Änderung prüft ein
Durchlauf die Datei mit dem **Parser von Node selbst**, und zwar als
**ES-Modul** — so lädt Home Assistant sie auch. In Modul-Semantik ist eine
doppelte Deklaration auf oberster Ebene ein `SyntaxError`, Funktionen
eingeschlossen; in Skript-Semantik wäre sie erlaubt und die zweite gewönne
still.

Das ersetzt das frühere Textmuster, das nur Deklarationen in **Spalte 0**
gesehen hat. Gemessen: `  function clamp(a,b,c){return 999}` mit zwei
führenden Leerzeichen ans Dateiende gehängt, danach liefert `clamp(5,0,1)` in
der Sandbox `999` — das Muster blieb still, `node --check` auf die `.js`-Datei
ebenfalls, die Modulprüfung meldet
`SyntaxError: Identifier 'clamp' has already been declared`. Ein Parser liest
Blöcke, keine Spalten; eingerückte Deklarationen **innerhalb** einer Funktion
oder Klasse lösen deshalb keinen Fehlalarm aus. Die Namensliste am Zeilenanfang
bleibt als grobes Netz für lesbare Fehlermeldungen erhalten.

Rest-Lücke, bewusst offen: zwei gleichnamige `var` auf oberster Ebene sind auch
im Modul erlaubt. Die Datei benutzt kein `var` auf oberster Ebene.

## 5. Optionen

Alle Optionen sind im grafischen Karteneditor einstellbar. Keine Option
existiert nur in YAML.

| Option | Typ | Standard | Wirkung |
| --- | --- | --- | --- |
| `entities` | Liste | leer | Kalender-Entitäten. Eintrag ist entweder `calendar.x` oder `{entity, color}` |
| `month_offset` | Ganzzahl | `0` | Startmonat. `-1` ist der Vormonat, `1` der Folgemonat |
| `navigation` | ja/nein | `true` | Pfeile zum Blättern anzeigen |
| `show_empty_days` | ja/nein | `true` | Tage ohne Termin als leere Zeile zeigen |
| `show_total` | ja/nein | `false` | Fußzeile mit Summe der Termindauern |
| `title` | Text | leer | Überschrift über dem Monatsnamen |
| `open_event_on_tap` | ja/nein | `true` | Klick auf eine Zeile öffnet den Kalender-Dialog |

`month_offset` ist bewusst eine Zahl und kein Auswahlfeld, damit auch minus drei
möglich ist.

### Farben

Die Karte vergibt Farben automatisch aus einer festen Palette, in der Reihenfolge
der gewählten Kalender:

```js
const calPalette = ["#3f8fd4", "#e08a3c", "#5aa469", "#b5559b", "#c95c5c", "#7d7fd4"];
```

Wer eine Farbe ändern will, überschreibt sie je Kalender. Ein Pflichtfeld pro
Kalender gäbe es nicht: die Palette greift, solange nichts gesetzt ist.

Bei **einem** Kalender wird der Farbpunkt nicht gezeichnet. Ein Punkt, der immer
dieselbe Farbe hat, trägt keine Information.

**Keine Beschriftung je Kalender.** Bis `v0.7.0` nahm die Konfiguration ein
`label` entgegen, normalisierte es — und zeichnete es nirgends. Es gibt keinen
Ort dafür: Die Karte hat keine Legende, und bei einem einzigen Kalender fehlt
sogar der Farbpunkt, an dem eine Beschriftung hängen könnte. Die Option ist
deshalb in `v0.7.1` entfernt und nicht nachgebaut worden.

## 6. Darstellung

Eine Zeile je Tag des Monats, chronologisch. Kein Wochenraster.

```
┌──────────────────────────────────────┐
│  ‹      September 2026        ›      │
├──────────────────────────────────────┤
│  Mo  01.   08:00 – 16:30   DZ        │
│  Di  02.   06:30 – 16:00   TA        │
│  Mi  03.                             │   ← leerer Tag
│  Do  04.   ganztägig       Urlaub    │
├──────────────────────────────────────┤
│  20 Tage   168,5 h   1 ganztägig    │   ← nur bei show_total
└──────────────────────────────────────┘
```

- Wochentag und Tageszahl links, feste Breite, damit die Spalten fluchten.
- Mehrere Termine an einem Tag: weitere Zeilen unter demselben Datum, das Datum
  steht nur einmal.
- **Heute** wird hervorgehoben, aber nur wenn der gezeigte Monat der laufende
  ist. Im Vormonat gibt es kein Heute.
- Samstage und Sonntage bekommen einen gedämpften Hintergrund.
- Farben, Abstände und Schrift kommen aus den Themenvariablen von Home
  Assistant (`--primary-text-color`, `--secondary-text-color`, `--divider-color`,
  `--ha-card-background`). Keine fest verdrahteten Farben außer der Palette.

### Die Summe

`show_total` summiert die Dauern aller zeitgebundenen Termine des Monats und
zeigt sie in Stunden mit einer Nachkommastelle. Die Teile sind durch einen
**Mittelpunkt** getrennt („20 Tage · 168,5 h · 2 ganztägig"); ohne ihn steht
dort „20 Tage168,5 h2 ganztägig" in einem Wort. **Ganztägige Termine gehen
nicht in die Stundensumme ein**, sondern werden getrennt gezählt. Sie mit 24
Stunden zu verrechnen würde die Summe verfälschen.

Drei Regeln, die die Summe an das binden, was in der Liste darüber steht:

- **Auf den Monat geschnitten.** Ein Termin vom 25.07. bis 05.08. zählt im
  August-Fuß mit seinem August-Anteil (rund 112 h an 5 Tagen), nicht mit seiner
  ganzen Länge (272 h an 12 Tagen).
- **Keine Entdopplung über `uid`.** Home Assistant gibt jeder Instanz einer
  wiederkehrenden Serie dieselbe `uid`. Wer entdoppelt, wirft alle Folgetermine
  weg: fünf Zeilen in der Liste, „8 h / 1 Tag" darunter.
- **Kein negativer Beitrag.** Endet ein Termin vor seinem Start, fällt das Ende
  auf den Start zurück — dieselbe Regel wie bei einem fehlenden oder unlesbaren
  Ende. Er bleibt mit Dauer null sichtbar, statt die Summe zu verkleinern.

## 7. Fehler

| Fall | Verhalten |
| --- | --- |
| Ein Kalender antwortet nicht | Die anderen werden angezeigt. Unter der Liste steht, welcher Kalender fehlt. Kein Abbruch |
| Kein Termin im Monat | Monatsname und leere Liste. Keine Fehlermeldung, das ist ein gültiger Zustand |
| `entities` leer | Hinweis „Kein Kalender gewählt" mit Verweis auf den Editor |
| Entität existiert nicht | Name wird genannt, übrige Kalender laufen weiter |
| Abruf noch unterwegs | Die alte Liste bleibt stehen, bis die neue da ist. Kein Leerblitzen beim Blättern |

## 8. Nachweis

**Ohne Nachweis wird nicht ausgeliefert.** Die Prüfschritte in dieser Reihenfolge:

1. `node --check dist/busch-cards.js` — fängt Syntaxfehler ab, bevor irgendein
   Container startet.
2. Datei als ES-Modul durch den Parser von Node schicken; eine doppelte
   Deklaration auf oberster Ebene ist dort ein Fehler (Abschnitt 4).
3. Karte im Browser gegen die laufende Installation, Kalender
   `calendar.arbeitszeiten`, `month_offset: -1`. **Nachweis ist ein Bild, auf dem
   der vollständige Vormonat steht, erster bis letzter Tag.**
4. Blättern: einmal zurück, einmal vor. Der Monatsname und die Liste müssen sich
   ändern, die Karte darf nicht leer bleiben.
5. **Die Zeitplan-Karte im selben Dashboard erneut ansehen.** Sie teilt sich die
   Datei mit der neuen Karte. Zeigt sie weiter richtige Uhrzeiten, ist die
   Namenskollision aus Abschnitt 4 ausgeschlossen.
6. Editor öffnen, jede Option einmal umstellen, prüfen dass die Karte reagiert.

Schritt 5 ist nicht optional. Er ist der einzige Schritt, der den historischen
Fehler dieses Repos direkt adressiert.

## 9. Auslieferung

- `CARD_VERSION` von `0.4.0` auf `0.5.0`.
- Eintrag in `window.customCards` mit `type: "busch-calendar-card"`.
- `README.md` um einen Abschnitt zur neuen Karte ergänzen.
- Commit, **Tag `v0.5.0`**, push. HACS liest den Tag, nicht `main`: ohne Tag
  ändert sich für den Nutzer nichts.
- Danach in Home Assistant aktualisieren und die Karte in der Ansicht
  `lukas-arbeitszeit` einsetzen.

## 10. Nicht enthalten

- **Wetter.** Die jetzige Karte zeigt es, die neue nicht. Für einen vergangenen
  Monat liefert die Vorhersage nichts, bei `month_offset: -1` bliebe die Spalte
  dauerhaft leer. Nachrüstbar, falls gewünscht.
- **Termine anlegen oder ändern.** Die Karte zeigt an.
- **Einen Dialog für den einzelnen Termin.** Home Assistant bietet dafür keine
  öffentliche Schnittstelle. Der Klick öffnet den Info-Dialog der
  Kalender-Entität; Beschreibung und Ort des Termins stehen im `title` der
  Zeile und erscheinen beim Überfahren. Das ist bewusst weniger als ein
  Termin-Dialog, tut aber nicht so, als wäre es mehr.
- **Wochen- oder Rasteransicht.** Es ist eine Liste. Für ein Raster gibt es die
  eingebaute Kalenderkarte.
