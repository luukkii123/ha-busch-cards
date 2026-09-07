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
| `open_event_on_tap` | ja/nein | `true` | Klick auf eine Zeile öffnet den Termin (bis `0.8.0`: den Kalender-Dialog) |
| `edit_on_tap` | ja/nein | `true` | Klick öffnet den Termin **zum Bearbeiten** (seit `0.8.2`). Aus = Ansichtsdialog wie in `0.8.1` |

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
│  20 Tage  168,5 h  1 ganztägig       │   ← nur bei show_total
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
zeigt sie in Stunden mit einer Nachkommastelle. Jeder Wert steht in einem
eigenen Element, **linksbündig nebeneinander mit 24 px Abstand**
(`justify-content: flex-start; gap: 24px`). Kein Trennzeichen dazwischen: Auf
dem Bildschirm trennt sie der Abstand. **Ganztägige Termine gehen nicht in die
Stundensumme ein**, sondern werden getrennt gezählt. Sie mit 24 Stunden zu
verrechnen würde die Summe verfälschen.

**Warum linksbündig und nicht über die Breite verteilt:** „1 ganztägig"
erscheint nur, wenn der Monat einen ganztägigen Termin hatte — ein reiner
Dienstplan-Monat zeigt dauerhaft **zwei** Werte. Mit `space-between` saßen die
beiden dann in den gegenüberliegenden Ecken, 436 px Leerraum dazwischen
(gemessen im Chromium, Fußzeile 560 px breit), und die Zeile sprang, je nachdem
ob Urlaub im Monat lag. Mit festem Abstand stehen die ersten beiden Werte immer
an derselben Stelle.

**Wer den Fuß misst, liest die Spans einzeln** (`.cal-fuss span`).
`textContent` des Kastens kennt den Raum zwischen ihnen nicht und liefert
„20 Tage168,5 h2 ganztägig" am Stück. In `v0.7.1` wurde daraufhin kurz ein
Mittelpunkt eingebaut und alles in einen Span gelegt — das änderte die
Darstellung, damit die Messung einfacher wird. Zurückgenommen: Die Messung
passt sich der Darstellung an, nicht umgekehrt.

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
- **Termine anlegen.** Die Karte zeigt an; ändern und löschen übernimmt seit
  `0.8.1` HAs eigener Dialog, seit `0.8.2` direkt dessen Editor (siehe unten).
  Einen Knopf „Termin hinzufügen" gibt es nicht.
- ~~**Einen Dialog für den einzelnen Termin.**~~ **Seit `0.8.1` enthalten.**
  Die ursprüngliche Begründung — „Home Assistant bietet dafür keine
  öffentliche Schnittstelle" — stimmte für die Schnittstelle, aber nicht für
  die Lage: `showCalendarEventDetailDialog` feuert schlicht ein
  `show-dialog`-Ereignis, und das kann jede Karte feuern. Nicht öffentlich ist
  allein das darin mitgereichte `dialogImport`, eine Closure über einen
  bundle-internen Import.

  **Der Weg daran vorbei, am ausgelieferten Frontend belegt** (HA 2026.8.3,
  `frontend_latest/` heruntergeladen und durchsucht): HA sein eigenes
  `ha-full-calendar` bauen lassen, dessen `_handleEventClick` auf einer
  **nicht eingehängten** Sonde aufrufen und `dialogImport` aus dem dabei
  gefeuerten Ereignis abgreifen. Die Sonde hängt in keinem Dokument, ihr
  Ereignis erreicht also niemanden. Geholt wird einmal und gemerkt.

  **Der Preis wird bezahlt, nicht verschwiegen:** Abhängigkeit von einem
  HA-Internum. Jeder Schritt ist einzeln abgefangen; scheitert einer, öffnet
  der Klick den Info-Dialog der Kalender-Entität wie bis `0.8.0`. **Ein toter
  Klick ist ausgeschlossen** — und das ist unter Node geprüft, während der
  Sondenweg selbst es nicht sein kann: er braucht HAs echtes Frontend, und
  eine Attrappe belegte nur die Attrappe.
- ~~**Den Editor mit den Eingabefeldern.**~~ **Seit `0.8.2` enthalten.**
  `showCalendarEventEditDialog` feuert ebenfalls nur ein `show-dialog`, mit
  `dialogTag: "dialog-calendar-event-editor"`. Sein Vertrag ist
  `{ calendarId?, selectedDate?, entry?, canDelete?, updated }`; **Pflicht ist
  genau ein Feld: `updated`** — es wird nach jedem Erfolg unbedingt abgewartet,
  und fehlt es, wirft der Dialog nach dem Speichern. `entry` hat genau die
  flache Form, die `calNormalisiereTermin()` ohnehin erzeugt.

  **Der Editor gibt es nicht geschenkt:** Ein einmal geöffneter Ansichtsdialog
  registriert ihn *nicht* mit, sein Ladeauftrag zieht das Editor-Modul nicht
  nach. Gut ist dagegen, dass beide Ladefunktionen im selben Teilstück des
  Frontends liegen — **eine einzige Sonde holt beide**, indem sie nacheinander
  `_handleEventClick(…)` und `_createEvent()` aufruft; unterschieden wird am
  `dialogTag`.

  **Die Falle dabei, und sie ist scharf:** Auf einer nicht eingehängten Sonde
  gibt es `this.calendar` nicht. Der Standardwert von `_activeView` ist
  `"dayGridMonth"` und trifft einen Zweig, der auf `this.calendar.view`
  zugreift — die Sonde würde **vor** dem Feuern werfen. Deshalb vorher
  `sonde._activeView = "listWeek"`, das trifft keinen der drei Zweige. Aus dem
  Quelltext hergeleitet, **nicht gemessen**.

  **`canEdit` gibt es beim Editor nicht.** Er prüft die
  Änderungsberechtigung nirgends; das muss die Karte tun (Bit 4 von
  `supported_features`).

  **Der Serienschutz ist die wichtigste Einschränkung.** Fehlt bei einem
  wiederkehrenden Termin die Instanzkennung `recurrence_id`, sendet der Editor
  beim Speichern einen leeren String — und der bedeutet „alle Vorkommen". Der
  Nutzer bekommt keine Rückfrage, weil die Rückfrage genau an dieser Kennung
  hängt. **Ob HA für gewöhnliche Instanzen einer Serie überhaupt eine eigene
  Kennung liefert, ist unbelegt** und steht seit der Vorrunde als offener
  Punkt. Solange das so ist: `rrule` ohne `recurrence_id` → Stufe 2.

  **Drei Stufen, jede fällt auf die nächste** (`calStufeWaehlen`,
  `calStufenFolge`): Editor → Ansicht → Kalender-Entität. Unter Node geprüft
  sind die Stufenwahl, der Serienschutz, die Berechtigungsprüfung, der
  Standardwert der Option und der Rückfall bei einer werfenden Stufe. Nicht
  prüfbar bleibt die Sonde selbst.
- **Wochen- oder Rasteransicht.** Es ist eine Liste. Für ein Raster gibt es die
  eingebaute Kalenderkarte.
