# R04 — Zeitblockeditor, lokaler Stand 08.10.2026

Teil von #156, ausschließlich lokaler Commit; keine Version zusätzlich erhöht
und keine Veröffentlichung/Installation dieses R04-Commits freigegeben.

Bearbeitungsdialog bleibt bei Außenklick offen, auch ohne Änderungen. Dirty
Escape und Browser/mobile Back erhalten Eingaben und zeigen eine verständliche
Statusmeldung. Explizites Abbrechen fordert bei Dirty eine konkrete
Verwerfbestätigung; Ablehnen erhält den Editor. Native Dialogfokussierung wird
durch eine Tab/ShiftTab-Schleife ergänzt. Nach Schließen kehrt Fokus zum
Auslöser zurück, nach Speichern mit ersetzten Zeitblöcken zum Tagesfeld.
ARIA-Dialogtitel, Statusmeldung und Reduced Motion ergänzt. Tagesaktionsmenü
bleibt ein flüchtiges Popover mit unverändertem Außenklick/Escape-Verhalten.

## Tatsächliche Prüfung und Ursachenbefund

`docs/render/schedule-r04.py`: zwölf synthetische und zwölf in der bestehenden
HA-Instanz mit tatsächlichen HA-Komponenten ausgeführte Fälle, je sechs
Breiten 320/360/390/480/768/960 px und Light/Dark. Realer Keyboard-Enter öffnet,
14 Tabs und 14 Shift+Tabs bleiben im Dialog. Clean Escape/Back schließen und geben Fokus zurück;
Dirty Escape/Back schützen; Dirty Cancel ablehnen/akzeptieren und Speichern
prüfen Datenerhalt. Reale Außenklickprobe bei 480/768/960; mobil Vollbild ohne
außenliegenden Punkt ausdrücklich nicht anwendbar. URL bleibt unverändert.
Reduced Motion tatsächlicher Browsercheck am Dirty-/Wackelzustand. Alle zwölf Fälle je Umgebung ohne
Pagefehler/Serviceaufruf; Screenshots privat außerhalb Git unter
`hacs-unraid-queue/r04-native` und `r04-synthetic`, Editorbilder angesehen.

Der echte HA-Host deckte zwei zusätzlich relevante Fehler auf:

1. Native Tab-Ende ließ Fokus aus dem Editor gelangen: explizite Schleife
   hält den ersten/letzten fokussierbaren Dialogcontrol zusammen.
2. Ein Escape löste im nativen HA-Host zweimal `cancel` aus, bevor `popstate`
   eintraf. History-Instrumentierung zeigte zwei Aufrufe derselben
   `_dialogSchliessen`-Instanz: zuerst normaler Cancel, dann target-null-
   Zweig. Das zweite Back verließ die Seite bis zur vorherigen Browserseite.
   Ein **pro Dialoginstanz** gesetztes Closing-Flag macht den Schließweg
   idempotent; es wird beim nächsten Öffnen zurückgesetzt. Keine globale
   Crossdialog-Sperre. Die frühe HA-Reloadvermutung ist damit widerlegt.

History nutzt eigenen Marker und erhält vorhandene Hoststate-Schlüssel; die
native `opensDialog`-Konvention wurde am tatsächlich installierten HA-Bundle
und am offiziellen Dialogmanager gegengeprüft. Kein breiter popstate-
Captureblock implementiert. Quellenreferenz:
[HA make-dialog-manager](https://github.com/home-assistant/frontend/blob/dev/src/dialogs/make-dialog-manager.ts).

Neue drei Node-Regressionen: Clean Scrim, doppeltes Cancel mit genau einem
Historyback, Dirty Escape/abgelehntes/akzeptiertes Cancel. Komplettsuite nach
R04: 436 Fälle, 435 bestanden, ein bestehender externer auto-entities-
Differenztest übersprungen. Statischer UI-Prüfer und Diffcheck separat gefahren.
Zentraler Zeitplanrenderer unterscheidet Editor (`dialog_typ='bearbeitung'`)
vom flüchtigen Tagesmenü und bestätigt die explizite Verwerfaktion.

## Alle 26 Regeln im Änderungsumfang

| ID | Prüfung / Grenze |
|---|---|
| R01 | Ein zentraler Editor-/Schließweg, Escape/Knopf/Back übereinstimmend; Browser/Node. |
| R02 | Keine Auswahl-/Bulkänderung. |
| R03 | Enter, 14 Tabs, Escape tatsächlich je zwölf synthetische/native Fälle; zusätzlicher Reverse-Tab-Lauf siehe begrenzten Nachweis unten. |
| R04 | Clean/Dirty-Scrim geschützt, Focus-Trap und Rückgabe, Dirty Escape/Back, explicit cancel geprüft. |
| R05 | Back verbraucht pro Dialog genau einen Eintrag, URL bleibt; doppelte Cancelregression. Forward/Deep-link anderer Karten nicht erneut geprüft. |
| R06 | Sechs Breiten, native Vollbild bei Mobile und Desktopmodal; Außenklick nur wo physisch erreichbar. |
| R07 | HA-Hostkarte, kein eigenes PWA; Installations-/Offlineprobe nicht Teil von R04. |
| R08 | Zentraler Zeitblockeditor, keine zweite Formularimplementierung. |
| R09 | Bestehende HA-Tokens/Icons/Felder; reale Light/Dark-Editorbilder betrachtet. |
| R10 | Dirty-Verwerfen ablehnen/akzeptieren und Save mit frei belegbaren Blockdaten tatsächlich geprüft. |
| R11 | Dirty-Statusmeldung, Schließen idempotent. Speicherdienst hier synthetisch, kein Produktivsave. |
| R12 | Verständliche Handlungsoptionen bei Dirty; vorhandene Backendfehler nicht verändert. |
| R13 | Konkrete Verwerfbestätigung erhält Abbruchweg. Bestehende Zeitblocklöschung fachlich unverändert. |
| R14 | Kein neuer großer Daten-/Suchpfad. |
| R15 | Bestehende Ziehpfade unverändert; Änderung durch Tastatur-Editor tatsächlich geprüft. |
| R16 | Dialogtitel/Status-Semantik, echter Fokus/Tab und Reduced Motion; Screenreader/Zoom/Kontrastfeldmessung ungeprüft. |
| R17 | Clean/Dirty/blocked close/explicit discard behandelt; Busy-Save unverändert. |
| R18 | Kein neuer Datenlade-/Offlinepfad; Formularzustand erhalten. |
| R19 | Keine Browserberechtigung. |
| R20 | Ein Listener pro geöffnetem Dialog, Entfernung beim Schließen/Disconnect; keine Feld-WebVitalsmessung. |
| R21 | Keine neue Benutzerpräferenz; Dirtywerte bleiben bis Save/ausdrücklichem Verwerfen. |
| R22 | Sichtbare Abbrechen/Speichern-Schaltflächen bleiben; keine Kernfunktion nur Shortcut. |
| R23 | Gleicher Editor/Geschäftslogik mobile Vollbild und Desktopdialog, Browsermatrix. |
| R24 | Vollbild-Scrim nicht physisch messbar: Ersatz echte Tab/Escape/Back-/Dirtyprüfung; keine pauschale Vollabnahme. |
| R25 | Keine neuen Optionen oder Settingsmenüs. |
| R26 | Neue Dirtymeldungen Deutsch/Englisch; Begriffe Zeitblock/Abbrechen/Speichern konsistent. |

Keine HA-Konfiguration/Dashboard-/Schedule-/Container-/VM-Serviceaktion;
kein produktives Speichern. #139 bleibt umfassender Gesamt-Audit der übrigen
Karten/Hostdialoge. Unabhängiger R04-Review durch zweiten Agenten abgeschlossen:
kein blockierender Produktbefund; eigene guarded native12Cases ohne
Pagefehler/Kandidaten-Serviceaufruf bestanden. Gemeinsamer
`docs/render/readonly_guard.py` sperrt native WS-Mutationen und sämtliche
HTTP-Schreibmethoden vor Seitenstart; normale Browser-Mod-Verbindungsaufnahme
ist ein Lese-/Subscriptionpfad. Blockierte Hintergrund-Updates werden nach
Messagetyp gezählt, ohne Nutzdaten aufzuzeichnen. Eine einmalige spätere
Hoststart-Timeoutprobe wurde mit de-DE Locale erneut erfolgreich ausgeführt.
Das unterscheidet Kandidaten-Serviceaufrufe von Host-Hintergrundverkehr; Todo #156 wird zentral koordiniert.


### Grenze des zuletzt erweiterten Harnesslaufs

Nach den grünen eigenen und unabhängig bewachten nativen Zwölf-Fälle-Läufen
auf Produktbasis `8fe1b5a` wurde ausschließlich der Browser-Harness erweitert:
zusätzlich 14 Shift-Tabs sowie Reduced Motion bei tatsächlich ausgelöstem
Dirty-Escape. Der synthetische erweiterte Lauf bestand zwölf Fälle ohne
Pagefehler. Im erweiterten nativen Lauf bestanden ebenfalls sämtliche zwölf
Fallassertions und die abschließende Dirty-Reduced-Motion-Assertion; die
Gesamtprüfung ist dennoch **nicht grün**, weil drei `pageerror`-Ereignisse die
abschließende Fehlerfreiheit-Assertion verletzten.

Der vorhandene Report zeichnet dazu jeweils nur den Playwright-Typ `Error`
und eine leere Scriptlocations-Liste auf. Fehlermeldung, vollständiger Stack,
Zeitpunkt und Trace wurden nicht gespeichert. Die Ursache sowie eine
Zuordnung zum HA-Host oder Kandidaten bleiben deshalb ungeklärt; die Fehler
werden nicht als harmlose Hostfehler eingestuft. Zwischen den grünen Läufen
und diesem Harnesslauf gab es keinen Produktcodewechsel. Als gesonderter
Abnahmebeleg bleibt der unabhängige bewachte Zwölf-Fälle-Lauf auf `8fe1b5a`
mit null Pagefehlern und null Kandidaten-Serviceaufrufen erhalten. Die
zusätzlichen Shift-Tab-/Dirty-Reduced-Motion-Assertions ersetzen diesen Beleg
nicht und begründen keine fehlerfreie native Gesamtprüfung des erweiterten
Harnesses. Todo #156 wird vom Koordinator ausdrücklich mit dieser Grenze
abgenommen.
